/**
 * app/api/admin/claims/reject/route.ts
 *
 * Rejects a claim_request. Sets status='rejected' and records the reason
 * in the audit log (the claim_requests table has no review_note column).
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

  let body: { requestId?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { requestId, note } = body;
  if (!requestId) {
    return NextResponse.json({ error: 'requestId required' }, { status: 400 });
  }

  const admin = getServiceClient();

  const { data: reqRow, error: rErr } = await admin
    .from('claim_requests')
    .select('id, device_id, manufacturer_id, requester_email, status')
    .eq('id', requestId)
    .single();

  if (rErr || !reqRow) {
    return NextResponse.json({ error: 'Claim request not found' }, { status: 404 });
  }
  if (reqRow.status !== 'pending') {
    return NextResponse.json(
      { error: `Request already ${reqRow.status}` },
      { status: 409 }
    );
  }

  const { error: uErr } = await admin
    .from('claim_requests')
    .update({ status: 'rejected' })
    .eq('id', requestId);

  if (uErr) {
    return NextResponse.json(
      { error: `Failed to update request: ${uErr.message}` },
      { status: 500 }
    );
  }

  await writeAudit({
    actor,
    action: 'claim.reject',
    target_table: 'claim_requests',
    target_id: requestId,
    payload: {
      requester_email: reqRow.requester_email,
      device_id: reqRow.device_id,
      manufacturer_id: reqRow.manufacturer_id,
      note: note ?? null,
    },
    req,
  });

  return NextResponse.json({ ok: true, requestId });
}
