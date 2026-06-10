/**
 * app/api/eudamed-scarlet-sync/route.ts — PARKED (9 June 2026).
 *
 * RETIRED, not patched. This route was the on-demand "Scarlet NB (3022)
 * enrichment" stopgap. It is broken under A2a/A2b: it queries the dead
 * device_master.device_id / device_master.eudamed_basic_udi columns and writes
 * A2a-era device_master fields (ce_mark_status, ce_certificate_number,
 * ce_notified_body, …) that the A2b model moved to device_external_ids +
 * regional_registrations.
 *
 * It is superseded by the EUDAMED discovery ingest:
 *   - lib/eudamedList.ts   — EMDN cndCode allow-list (the AI-isolation heuristic)
 *   - lib/eudamed.ts       — public-surface client + fetchEudamedAiMlDevices()
 *   - lib/eudamedSync.ts   — ingestEudamedDevice() through the 4d gate
 *   - app/api/eudamed-sync/route.ts — the replacement endpoint
 *
 * Per EUDAMED-REINGEST-SPEC.md (locked decision 1) and EUDAMED-STEP-0A-FINDINGS.md
 * §6: park, don't patch. Kept as a tombstone so old links/crons fail loudly with
 * a pointer rather than silently running against dead columns.
 *
 * The single-NB approach (Scarlet only) was also too narrow — the new ingest
 * discovers across the whole EMDN allow-list, not one notified body.
 */

import { NextResponse } from 'next/server';

const PARKED = {
  error: 'Gone — this route is retired.',
  replaced_by: '/api/eudamed-sync',
  reason:
    'eudamed-scarlet-sync queried dead A2a columns (device_master.device_id / eudamed_basic_udi) ' +
    'and was single-NB. Use the EUDAMED discovery ingest (EMDN allow-list → 4d gate).',
  see: 'EUDAMED-STEP-0A-FINDINGS.md §6; EUDAMED-REINGEST-SPEC.md',
} as const;

export async function POST() {
  return NextResponse.json(PARKED, { status: 410 });
}

export async function GET() {
  return NextResponse.json(PARKED, { status: 410 });
}
