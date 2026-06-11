/**
 * app/api/admin/queue/candidates/route.ts
 *
 * Compute merge candidates for a queue row that predates the 4d gate's
 * possible_merge_candidates column (~487 legacy rows have null). Called by the
 * queue drawer on open when a row has no candidates; the result is PERSISTED
 * back to the row so it's computed once — the next open (and the row's
 * context-sensitive primary button) reads it straight from the row.
 *
 * Rows that already have candidates are returned as-is, never recomputed —
 * the stored candidates are what the 4d gate / crosswalk seed scored, and
 * recomputing on every open would silently shift what the operator is acting
 * on. (Re-scoring is a deliberate future pass, not a drawer side effect.)
 *
 * Body:     { queue_id: string }
 * Response: { candidates: MergeCandidate[], computed: boolean }
 *           computed=true when this call ran findMergeCandidates (and
 *           persisted); false when stored candidates were returned.
 */

import { NextResponse, type NextRequest } from 'next/server'
import {
  getAdminActor,
  getServiceClient,
  AdminAuthError,
} from '@/lib/adminAudit'
import { findMergeCandidates } from '@/lib/matchingCandidates'
import type { MergeCandidate } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    await getAdminActor()
  } catch (e) {
    if (e instanceof AdminAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    throw e
  }

  let body: { queue_id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body.queue_id) {
    return NextResponse.json({ error: 'queue_id required' }, { status: 400 })
  }

  const admin = getServiceClient()

  const { data: queueRow, error: qErr } = await admin
    .from('ingestion_review_queue')
    .select('queue_id, status, device_name, manufacturer, possible_merge_candidates')
    .eq('queue_id', body.queue_id)
    .single()

  if (qErr || !queueRow) {
    return NextResponse.json({ error: 'Queue entry not found' }, { status: 404 })
  }

  // Already computed (4d gate, crosswalk seed, or a previous call here).
  if (queueRow.possible_merge_candidates != null) {
    return NextResponse.json({
      candidates: queueRow.possible_merge_candidates as MergeCandidate[],
      computed: false,
    })
  }

  const candidates = await findMergeCandidates({
    manufacturerName: queueRow.manufacturer ?? null,
    deviceName: queueRow.device_name ?? null,
    supabase: admin,
  })

  // Persist — including the empty result. [] stored means "computed, none
  // found" (the row's primary button can safely say "Accept as new device");
  // null means "never computed". findMergeCandidates returns [] on internal
  // DB errors too, which would mislabel a transient failure as "no
  // candidates" — acceptable here because the stakes are a suggestion list,
  // and a wrong [] still routes through the same never-auto-merge review.
  const { error: uErr } = await admin
    .from('ingestion_review_queue')
    .update({ possible_merge_candidates: candidates })
    .eq('queue_id', body.queue_id)

  if (uErr) {
    // Persisting failed but the computation is good — return it anyway so the
    // drawer can render; the next open just recomputes.
    console.warn(`[queue.candidates] persist failed for ${body.queue_id}: ${uErr.message}`)
  }

  return NextResponse.json({ candidates, computed: true })
}
