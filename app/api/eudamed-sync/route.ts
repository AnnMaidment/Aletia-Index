/**
 * app/api/eudamed-sync/route.ts — EUDAMED discovery ingest (June 2026).
 *
 * The EU analogue of /api/fda-sync. Drives discovery off the EMDN allow-list
 * (lib/eudamedList.ts) through the 4d gate (lib/eudamedSync.ts).
 *
 * Endpoints:
 *   PUT                                 → discovery: fetch AI-candidate EU devices
 *                                         for a batch of allow-list EMDN codes and
 *                                         run each through the 4d gate.
 *       ?offset= &limit=                  batch cursor OVER THE ALLOW-LIST CODES
 *                                         (default offset=0, limit=3 — each code is
 *                                         fully paginated internally, so a small
 *                                         code-batch keeps us under the serverless
 *                                         timeout). Returns next_offset.
 *       ?include_only=true                drop 'queue'-confidence (uncorroborated)
 *                                         candidates; only emit corroborated ones.
 *       ?auto_create=true                 allow the no-match branch to create
 *                                         (default false — precision over recall).
 *       ?delay_ms=                        per-request pause override.
 *   POST                                → ingest a single normalised record (body
 *                                         is an EudamedDeviceRecord). Lets the admin
 *                                         portal push one device through the gate.
 *   GET                                 → health check / endpoint listing.
 *
 * Auth: x-sync-token must equal SYNC_SECRET (or CRON_SECRET, for the scheduled
 * monthly re-pull). Same convention the cron work in TODO will wire.
 *
 * Schedule (add to vercel.json crons alongside the rest — monthly is plenty
 * given the EUDAMED legacy backfill runs through 27 Nov 2026):
 *   { "path": "/api/eudamed-sync?auto_create=false", "schedule": "0 4 1 * *" }
 */

import { NextRequest, NextResponse } from 'next/server';
import { AI_EMDN_ALLOWLIST, EUDAMED_HEURISTIC_VERSION } from '@/lib/eudamedList';
import { fetchEudamedAiMlDevices, type EudamedDeviceRecord } from '@/lib/eudamed';
import { ingestEudamedDevice, type EudamedIngestResult } from '@/lib/eudamedSync';

export const maxDuration = 60;

const SYNC_SECRET = process.env.SYNC_SECRET;
const CRON_SECRET = process.env.CRON_SECRET;

function isAuthorised(req: NextRequest): boolean {
  if (!SYNC_SECRET && !CRON_SECRET) return true; // no secret set — open (dev only)
  const token =
    req.headers.get('x-sync-token') ??
    req.headers.get('authorization')?.replace('Bearer ', '') ??
    null;
  return token === SYNC_SECRET || token === CRON_SECRET;
}

type Counters = Record<EudamedIngestResult['action'], number>;
const emptyCounters = (): Counters => ({
  updated_existing: 0,
  created_new: 0,
  queued_for_review: 0,
  already_queued: 0,
  skipped_prior_decision: 0,
  failed: 0,
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT — discovery over a batch of allow-list EMDN codes
// ─────────────────────────────────────────────────────────────────────────────

export async function PUT(req: NextRequest) {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const offset = Math.max(0, parseInt(req.nextUrl.searchParams.get('offset') ?? '0', 10) || 0);
    const limit = Math.min(
      Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') ?? '3', 10) || 3),
      AI_EMDN_ALLOWLIST.length,
    );
    const includeOnly = req.nextUrl.searchParams.get('include_only') === 'true';
    const autoCreate = req.nextUrl.searchParams.get('auto_create') === 'true';
    const delayMs = Math.max(0, parseInt(req.nextUrl.searchParams.get('delay_ms') ?? '0', 10) || 0);

    const codeSlice = AI_EMDN_ALLOWLIST.slice(offset, offset + limit);
    if (codeSlice.length === 0) {
      return NextResponse.json({
        source: 'EUDAMED',
        message: 'offset beyond allow-list length — nothing to process',
        allowlist_total: AI_EMDN_ALLOWLIST.length,
        offset,
        done: true,
      });
    }

    const records = await fetchEudamedAiMlDevices({
      codes: codeSlice,
      includeOnly,
      delayMs: delayMs || undefined,
    });

    const counters = emptyCounters();
    const results: EudamedIngestResult[] = [];
    for (const record of records) {
      const result = await ingestEudamedDevice(record, { autoCreate });
      results.push(result);
      counters[result.action]++;
    }

    const processedEnd = offset + codeSlice.length;
    const nextOffset = processedEnd < AI_EMDN_ALLOWLIST.length ? processedEnd : null;

    return NextResponse.json({
      source: 'EUDAMED',
      heuristic_version: EUDAMED_HEURISTIC_VERSION,
      allowlist_total: AI_EMDN_ALLOWLIST.length,
      codes_processed: codeSlice,
      offset,
      limit,
      next_offset: nextOffset,
      done: nextOffset === null,
      auto_create: autoCreate,
      include_only: includeOnly,
      candidates_fetched: records.length,
      counters,
      sample: results.slice(0, 20),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — ingest a single normalised record (admin-portal push)
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  let body: Partial<EudamedDeviceRecord> & { auto_create?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.uuid) {
    return NextResponse.json({ error: 'uuid (EUDAMED udiDiData record UUID) is required' }, { status: 400 });
  }

  // Fill the record shape with safe defaults so a partial push still ingests.
  const record: EudamedDeviceRecord = {
    basic_udi: body.basic_udi ?? '',
    primary_di: body.primary_di ?? null,
    uuid: body.uuid,
    device_name: body.device_name ?? null,
    manufacturer_name: body.manufacturer_name ?? null,
    manufacturer_srn: body.manufacturer_srn ?? null,
    risk_class: body.risk_class ?? null,
    emdn_code: body.emdn_code ?? null,
    emdn_description: body.emdn_description ?? null,
    certificate_number: body.certificate_number ?? null,
    certificate_expiry: body.certificate_expiry ?? null,
    notified_body: body.notified_body ?? null,
    notified_body_srn: body.notified_body_srn ?? null,
    legislation: body.legislation ?? null,
    device_status: body.device_status ?? null,
    medical_purpose: body.medical_purpose ?? null,
    is_software: body.is_software ?? false,
    keyword_hit: body.keyword_hit ?? false,
    matched_emdn: body.matched_emdn ?? 'manual',
    confidence: body.confidence ?? 'queue',
  };

  const result = await ingestEudamedDevice(record, { autoCreate: body.auto_create ?? false });
  return NextResponse.json(result, { status: result.action === 'failed' ? 500 : 200 });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — health check
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  return NextResponse.json({
    message: [
      'Aletia EUDAMED discovery ingest (EU leg).',
      `Heuristic: EMDN cndCode allow-list ${EUDAMED_HEURISTIC_VERSION} (${AI_EMDN_ALLOWLIST.length} codes).`,
      '',
      '  PUT  ?offset=&limit=        — discovery over a batch of allow-list codes (default limit=3)',
      '       ?include_only=true     — only corroborated (software/keyword) candidates',
      '       ?auto_create=true      — allow no-match branch to create (default false)',
      '  POST                        — ingest one normalised EudamedDeviceRecord (body)',
      '',
      'Cross-jurisdiction matches are fuzzy; most devices route to the review queue.',
      'The admin accept route writes the EU regional_registrations row on merge.',
    ].join('\n'),
  });
}
