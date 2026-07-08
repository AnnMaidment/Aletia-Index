/**
 * app/api/admin/queue/extract-specialty/route.ts
 *
 * Re-run the deterministic specialty extractor over ingestion_review_queue
 * rows. This replaces a stale copy of the (pre-atomic) accept route that lived
 * here previously and never called the extractor at all.
 *
 * Auth mirrors the other admin queue routes: getAdminActor() gates access,
 * readonly admins are rejected, and the run is recorded with writeAudit().
 *
 * POST body (all optional — defaults match the CLI script):
 *   {
 *     source?: string,                              // e.g. 'clinical_trials'; omit for all (fda_dedup auto-skipped)
 *     status?: 'pending'|'approved'|'rejected'|'duplicate'|'all',  // default 'pending'
 *     force?: boolean,                              // overwrite already-populated rows
 *     dryRun?: boolean,                             // compute only, no writes
 *     limit?: number                                // cap rows processed
 *   }
 *
 * Returns the ExtractResult summary as JSON.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getServiceClient, getAdminActor, writeAudit, AdminAuthError } from '@/lib/adminAudit';
import { extractQueueSpecialty, type ExtractOptions } from '@/lib/extractQueueSpecialty';

interface Body {
  source?: string;
  status?: ExtractOptions['status'];
  force?: boolean;
  dryRun?: boolean;
  limit?: number;
}

export async function POST(req: NextRequest) {
  let actor;
  try {
    actor = await getAdminActor();
  } catch (e) {
    if (e instanceof AdminAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  if (actor.role === 'readonly') {
    return NextResponse.json({ error: 'Readonly admin cannot run extraction' }, { status: 403 });
  }

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    // Empty body is fine — run with defaults.
    body = {};
  }

  const opts: ExtractOptions = {
    source: body.source,
    status: body.status,
    force: !!body.force,
    dryRun: !!body.dryRun,
    limit: typeof body.limit === 'number' ? body.limit : undefined,
  };

  const admin = getServiceClient();

  let result;
  try {
    result = await extractQueueSpecialty(admin, opts);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Extraction failed' }, { status: 500 });
  }

  await writeAudit({
    actor,
    action: opts.dryRun ? 'queue.extract_specialty_dryrun' : 'queue.extract_specialty',
    target_table: 'ingestion_review_queue',
    target_id: `extract-specialty:${opts.source ?? 'all'}`,
    payload: {
      options: opts,
      scanned: result.scanned,
      updated: result.updated,
      skipped_cluster_source: result.skipped_cluster_source,
      no_specialty_found: result.no_specialty_found,
      by_confidence: result.by_confidence,
    },
    req,
  });

  return NextResponse.json({ ok: true, result });
}
