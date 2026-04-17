/**
 * app/api/admin/queue/extract-specialty/route.ts
 *
 * Runs the specialty-extraction batch job against ingestion_review_queue.
 * Thin HTTP wrapper around lib/extractQueueSpecialty.extractQueueSpecialty().
 *
 * Body (all optional):
 *   {
 *     force?: boolean,
 *     limit?: number,
 *     dryRun?: boolean,
 *     status?: 'pending' | 'approved' | 'rejected' | 'duplicate' | 'all',
 *     source?: string
 *   }
 */

import { NextResponse, type NextRequest } from 'next/server';
import {
  getAdminActor,
  getServiceClient,
  writeAudit,
  AdminAuthError,
} from '@/lib/adminAudit';
import { extractQueueSpecialty } from '@/lib/extractQueueSpecialty';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let actor;
  try {
    actor = await getAdminActor();
  } catch (e) {
    if (e instanceof AdminAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  let body: {
    force?: boolean;
    limit?: number;
    dryRun?: boolean;
    status?: 'pending' | 'approved' | 'rejected' | 'duplicate' | 'all';
    source?: string;
  } = {};
  try {
    const text = await req.text();
    if (text.trim()) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const admin = getServiceClient();

  let result;
  try {
    result = await extractQueueSpecialty(admin, {
      force: body.force,
      limit: body.limit,
      dryRun: body.dryRun,
      status: body.status,
      source: body.source,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: `Extraction failed: ${e?.message ?? 'unknown error'}` },
      { status: 500 }
    );
  }

  await writeAudit({
    actor,
    action: body.dryRun ? 'queue.extract_specialty.dry_run' : 'queue.extract_specialty',
    target_table: 'ingestion_review_queue',
    payload: {
      options: {
        force: body.force ?? false,
        limit: body.limit ?? null,
        dryRun: body.dryRun ?? false,
        status: body.status ?? 'pending',
        source: body.source ?? null,
      },
      summary: {
        scanned: result.scanned,
        updated: result.updated,
        skipped_already_populated: result.skipped_already_populated,
        skipped_no_raw_data: result.skipped_no_raw_data,
        no_specialty_found: result.no_specialty_found,
        by_confidence: result.by_confidence,
        error_count: result.errors.length,
      },
    },
    req,
  });

  return NextResponse.json(result);
}