/**
 * app/api/admin/queue/duplicate/route.ts
 *
 * Marks an ingestion_review_queue entry as a duplicate of an existing
 * device_master row. Does NOT modify device_master — this is strictly a
 * queue disposition. If you want to *enrich* the existing device with
 * data from the queue entry, that's a separate flow (future: queue/merge).
 *
 * Body:
 *   { queueId: string, targetDeviceId: string, note?: string }
 *
 * Side effects:
 *   - queue row: status='duplicate', reviewed_at=now(), reviewed_by=email,
 *     review_note=note, raw_data.duplicate_of = targetDeviceId
 *   - audit_log entry with action='queue.duplicate'
 */

import { NextResponse, type NextRequest } from 'next/server';
import {
  getAdminActor,
  getServiceClient,
  writeAudit,
  AdminAuthError,
} from '@/lib/adminAudit';

export const dynamic = 'force-dynamic';

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

  let body: { queueId?: string; targetDeviceId?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { queueId, targetDeviceId, note } = body;
  if (!queueId || !targetDeviceId) {
    return NextResponse.json(
      { error: 'queueId and targetDeviceId required' },
      { status: 400 }
    );
  }

  const admin = getServiceClient();

  // 1. Verify queue entry exists and is pending
  const { data: queueRow, error: qErr } = await admin
    .from('ingestion_review_queue')
    .select('queue_id, status, raw_data, device_name, manufacturer, source')
    .eq('queue_id', queueId)
    .single();

  if (qErr || !queueRow) {
    return NextResponse.json({ error: 'Queue entry not found' }, { status: 404 });
  }
  if (queueRow.status !== 'pending') {
    return NextResponse.json(
      { error: `Queue entry already ${queueRow.status}` },
      { status: 409 }
    );
  }

  // 2. Verify target device exists
  const { data: device, error: dErr } = await admin
    .from('device_master')
    .select('aletia_id, manufacturer_name')
    .eq('aletia_id', targetDeviceId)
    .single();

  if (dErr || !device) {
    return NextResponse.json(
      { error: `Target device ${targetDeviceId} not found in device_master` },
      { status: 404 }
    );
  }

  // 3. Mutate queue row
  const mergedRawData = {
    ...(queueRow.raw_data ?? {}),
    duplicate_of: targetDeviceId,
    duplicate_marked_at: new Date().toISOString(),
    duplicate_marked_by: actor.email,
  };

  const { error: uErr } = await admin
    .from('ingestion_review_queue')
    .update({
      status: 'duplicate',
      reviewed_at: new Date().toISOString(),
      reviewed_by: actor.email,
      review_note: note ?? null,
      raw_data: mergedRawData,
    })
    .eq('queue_id', queueId);

  if (uErr) {
    return NextResponse.json(
      { error: `Failed to update queue: ${uErr.message}` },
      { status: 500 }
    );
  }

  // 4. Audit
  await writeAudit({
    actor,
    action: 'queue.duplicate',
    target_table: 'ingestion_review_queue',
    target_id: queueId,
    payload: {
      duplicate_of: targetDeviceId,
      device_name: queueRow.device_name,
      manufacturer: queueRow.manufacturer,
      source: queueRow.source,
      note: note ?? null,
    },
    req,
  });

  return NextResponse.json({ ok: true, queueId, duplicateOf: targetDeviceId });
}
