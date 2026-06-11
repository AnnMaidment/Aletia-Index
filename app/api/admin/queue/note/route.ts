/**
 * app/api/admin/queue/note/route.ts
 *
 * Save (or clear) review_note on a PENDING queue row without dispositioning
 * it. This is the "park" path: the queue rewrite must never force a
 * disposition, and the 68 multi-candidate eudamed_sync rows whose candidates
 * are suspected FDA fragments need to be left in the queue with a note until
 * the FDA dedup pass (NEXT-WORK-PLAN-2026-06-10). Status is untouched.
 *
 * Body: { queue_id: string, review_note: string | null }
 *
 * Side effects:
 *   - queue row: review_note updated; status / reviewed_at / reviewed_by
 *     untouched (the row is still pending and still un-reviewed)
 *   - audit_log entry with action='queue.note'
 */

import { NextResponse, type NextRequest } from 'next/server'
import {
  getAdminActor,
  getServiceClient,
  writeAudit,
  AdminAuthError,
} from '@/lib/adminAudit'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let actor
  try {
    actor = await getAdminActor()
  } catch (e) {
    if (e instanceof AdminAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    throw e
  }
  if (actor.role === 'readonly') {
    return NextResponse.json(
      { error: 'Readonly admin cannot edit queue notes' },
      { status: 403 },
    )
  }

  let body: { queue_id?: string; review_note?: string | null }
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
    .select('queue_id, status')
    .eq('queue_id', body.queue_id)
    .single()

  if (qErr || !queueRow) {
    return NextResponse.json({ error: 'Queue entry not found' }, { status: 404 })
  }
  if (queueRow.status !== 'pending') {
    // Notes on dispositioned rows belong to the disposition that wrote them.
    return NextResponse.json(
      { error: `Entry is already ${queueRow.status} — note is part of that disposition` },
      { status: 409 },
    )
  }

  const note = (body.review_note ?? '').trim() || null

  const { error: uErr } = await admin
    .from('ingestion_review_queue')
    .update({ review_note: note })
    .eq('queue_id', body.queue_id)

  if (uErr) {
    return NextResponse.json({ error: uErr.message }, { status: 500 })
  }

  await writeAudit({
    actor,
    action: 'queue.note',
    target_table: 'ingestion_review_queue',
    target_id: body.queue_id,
    payload: { review_note: note },
    req,
  })

  return NextResponse.json({ ok: true, queue_id: body.queue_id, review_note: note })
}
