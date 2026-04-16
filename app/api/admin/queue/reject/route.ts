/**
 * app/api/admin/queue/reject/route.ts
 *
 * Mark a queue entry as rejected. Non-destructive — the row stays in
 * ingestion_review_queue with status='rejected' so it can be re-opened.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getServiceClient, getAdminActor, writeAudit, AdminAuthError } from '@/lib/adminAudit';

export async function POST(req: NextRequest) {
  let actor;
  try {
    actor = await getAdminActor();
  } catch (e) {
    if (e instanceof AdminAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  if (actor.role === 'readonly') {
    return NextResponse.json({ error: 'Readonly admin cannot reject entries' }, { status: 403 });
  }

  const { queue_id, review_note } = await req.json();
  if (!queue_id) return NextResponse.json({ error: 'queue_id required' }, { status: 400 });

  const admin = getServiceClient();

  const { data: queueRow, error: loadErr } = await admin
    .from('ingestion_review_queue')
    .select('status')
    .eq('queue_id', queue_id)
    .single();

  if (loadErr || !queueRow) return NextResponse.json({ error: 'Queue entry not found' }, { status: 404 });
  if (queueRow.status !== 'pending') {
    return NextResponse.json({ error: `Entry is already ${queueRow.status}` }, { status: 409 });
  }

  const { error } = await admin
    .from('ingestion_review_queue')
    .update({
      status: 'rejected',
      reviewed_at: new Date().toISOString(),
      reviewed_by: actor.email,
      review_note: review_note ?? null,
    })
    .eq('queue_id', queue_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    actor, action: 'queue.reject',
    target_table: 'ingestion_review_queue', target_id: queue_id,
    payload: { review_note },
    req,
  });

  return NextResponse.json({ ok: true });
}
