/**
 * app/api/queue-sync/route.ts — A2b rewrite
 *
 * Post-A2b, the purpose of this route is narrow and retention-focused:
 *
 *   POST  → retry-enrich legacy pre-A2b PCCP queue rows now that
 *           device_external_ids has been backfilled. For each 'pending' row
 *           from the 'oleary_csv' source, look up its submission_number in
 *           device_external_ids, and if it resolves to an aletia_id, apply
 *           pccp_status/authorized_date/source to that device and mark the
 *           queue row 'approved'. If no match, leave the row pending — the
 *           admin queue UI (next session) handles review.
 *
 *   GET   → queue summary counters, unchanged.
 *
 * What changed vs. pre-A2b:
 *   - denovoSync removed entirely. ingestFdaDevice handles De Novo via idType.
 *   - No longer calls syncExistingDeviceFromFDA(deviceId, deviceId, ...) —
 *     that function now takes (aletiaId, externalIdValue) and looking the
 *     first one up by shape (starts-with-K) is wrong in A2b.
 *   - No longer writes device_master.device_id (the column doesn't exist).
 *   - POST does NOT process freshly-ingested queue rows. PCCP no longer
 *     queues anything under A2b (enrichment-only, see lib/pccpIngest.ts);
 *     the only pending 'oleary_csv' rows are the ~487 inherited from the
 *     first PCCP ingest run, which predates device_external_ids.
 *
 * Auth: SYNC_SECRET header (x-sync-token).
 *
 * PowerShell:
 *   Invoke-RestMethod -Uri "http://localhost:3000/api/queue-sync" `
 *     -Method Post `
 *     -Headers @{ "x-sync-token" = $env:SYNC_SECRET }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'

const PCCP_SOURCE = 'oleary_csv'

// ─────────────────────────────────────────────────────────────────────────────
// POST — retry-enrich legacy PCCP queue rows against device_external_ids
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = createAdminClient()

  // Auth
  const token = req.headers.get('x-sync-token')
  if (token !== process.env.SYNC_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch pending legacy PCCP queue rows.
  const { data: pending, error: fetchErr } = await supabase
    .from('ingestion_review_queue')
    .select('queue_id, source_id, pccp_authorized_date')
    .eq('status',  'pending')
    .eq('source',  PCCP_SOURCE)

  if (fetchErr) {
    return NextResponse.json(
      { error: `Failed to fetch queue: ${fetchErr.message}` },
      { status: 500 },
    )
  }

  if (!pending?.length) {
    return NextResponse.json({
      success:   true,
      message:   'No pending PCCP queue rows to retry',
      processed: 0,
    })
  }

  // Bulk-look-up all submission numbers in device_external_ids in one query.
  const submissionIds = pending
    .map((row) => (row.source_id ?? '').toUpperCase().replace(/\s+/g, '').trim())
    .filter(Boolean)

  const { data: extIdHits, error: extErr } = await supabase
    .from('device_external_ids')
    .select('aletia_id, id_value')
    .in('id_type', ['fda_k_number', 'fda_de_novo', 'fda_pma'])
    .in('id_value', submissionIds)

  if (extErr) {
    return NextResponse.json(
      { error: `device_external_ids fetch failed: ${extErr.message}` },
      { status: 500 },
    )
  }

  const aletiaIdByIdValue = new Map<string, string>()
  for (const row of extIdHits ?? []) {
    aletiaIdByIdValue.set(row.id_value, row.aletia_id)
  }

  // Process each pending row.
  const results = {
    total_pending:      pending.length,
    enriched:           0,    // row resolved → pccp applied → queue approved
    still_unresolved:   0,    // no device_external_ids hit → leave pending
    errors:             [] as string[],
  }

  const now = new Date().toISOString()

  for (const row of pending) {
    const submissionId = (row.source_id ?? '').toUpperCase().replace(/\s+/g, '').trim()
    if (!submissionId) {
      results.still_unresolved++
      continue
    }

    const aletiaId = aletiaIdByIdValue.get(submissionId)
    if (!aletiaId) {
      // Device not yet known to Aletia via any FDA identifier. Leave pending
      // for admin review via Module 2 (next session). Don't log here — we'd
      // spam the anomaly log every run; pccpIngest logs the first sighting.
      results.still_unresolved++
      continue
    }

    // Apply PCCP enrichment to the resolved device.
    const { error: updateErr } = await supabase
      .from('device_master')
      .update({
        pccp_status:          'approved',
        pccp_authorized_date: row.pccp_authorized_date,
        pccp_source:          PCCP_SOURCE,
      })
      .eq('aletia_id', aletiaId)

    if (updateErr) {
      results.errors.push(`Update failed for ${aletiaId} (${submissionId}): ${updateErr.message}`)
      continue
    }

    // Mark the queue row approved.
    const { error: queueUpdErr } = await supabase
      .from('ingestion_review_queue')
      .update({
        status:      'approved',
        reviewed_at: now,
        reviewed_by: 'queue-sync-retry',
        review_note: `Auto-resolved via device_external_ids → ${aletiaId}`,
      })
      .eq('queue_id', row.queue_id)

    if (queueUpdErr) {
      results.errors.push(`Queue status update failed for ${row.queue_id}: ${queueUpdErr.message}`)
      continue
    }

    results.enriched++
  }

  return NextResponse.json(
    {
      success: results.errors.length === 0,
      ...results,
      ran_at: now,
    },
    { status: results.errors.length > 0 ? 207 : 200 },
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — queue summary (counters only)
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = createAdminClient()

  const token = req.headers.get('x-sync-token')
  if (token !== process.env.SYNC_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('ingestion_review_queue')
    .select('status, source, source_id')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const pending = data.filter((r) => r.status === 'pending')
  const summary = {
    total:    data.length,
    pending:  pending.length,
    approved: data.filter((r) => r.status === 'approved').length,
    rejected: data.filter((r) => r.status === 'rejected').length,

    // By-source breakdown, pending only — matches the sources we now support.
    pending_by_source: {
      oleary_csv:            pending.filter((r) => r.source === PCCP_SOURCE).length,
      fda_sync:              pending.filter((r) => r.source === 'fda_sync').length,
      mhra_sync:             pending.filter((r) => r.source === 'mhra_sync').length,
      clinical_trials:       pending.filter((r) => r.source === 'clinical_trials').length,
      fda_breakthrough:      pending.filter((r) => r.source === 'fda_breakthrough').length,
      scarlet_eudamed_sync:  pending.filter((r) => r.source === 'scarlet_eudamed_sync').length,
      other:                 pending.filter((r) =>
        ![
          PCCP_SOURCE,
          'fda_sync',
          'mhra_sync',
          'clinical_trials',
          'fda_breakthrough',
          'scarlet_eudamed_sync',
        ].includes(r.source ?? ''),
      ).length,
    },

    // Back-compat breakdown for existing dashboards that keyed off submission-number shape.
    pending_submission_shapes: {
      k_numbers: pending.filter((r) => (r.source_id ?? '').startsWith('K')).length,
      denovos:   pending.filter((r) => (r.source_id ?? '').startsWith('DEN')).length,
      pma:       pending.filter((r) => (r.source_id ?? '').startsWith('P')).length,
    },
  }

  return NextResponse.json(summary)
}
