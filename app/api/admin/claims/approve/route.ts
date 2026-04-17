/**
 * app/api/admin/claims/approve/route.ts
 *
 * Approves a claim_request. Side effects:
 *   1. claim_requests.status = 'approved'
 *   2. Target record (device_master OR manufacturers) gets claimed_at +
 *      claimed_by_email set from the request, if not already claimed.
 *   3. audit_log entry with action='claim.approve'
 *
 * NOTE: This does NOT send a fresh claim-invite email or create the
 * Supabase Auth user. That's the claim completion flow's job, triggered
 * when the requester follows their original verification link. Admin
 * approval here simply unblocks the request — the original token is
 * still what the requester uses to finish.
 *
 * If the original token has expired, admins should reject and tell the
 * manufacturer to re-request via the public claim form.
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

  // Load the request
  const { data: reqRow, error: rErr } = await admin
    .from('claim_requests')
    .select('id, device_id, manufacturer_id, requester_email, status, token_expires_at')
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

  const tokenExpired = reqRow.token_expires_at
    ? new Date(reqRow.token_expires_at) < new Date()
    : false;

  // Update the claim_requests row
  const { error: uErr } = await admin
    .from('claim_requests')
    .update({ status: 'approved' })
    .eq('id', requestId);

  if (uErr) {
    return NextResponse.json(
      { error: `Failed to update request: ${uErr.message}` },
      { status: 500 }
    );
  }

  // Stamp the target as admin-approved (claimed_by_email is set; claimed_at
  // stays null until the requester completes the flow and auth user is created)
  let targetTable: string | null = null;
  let targetId: string | null = null;
  if (reqRow.device_id) {
    targetTable = 'device_master';
    targetId = reqRow.device_id;
    await admin
      .from('device_master')
      .update({ claimed_by_email: reqRow.requester_email })
      .eq('device_id', reqRow.device_id)
      .is('claimed_at', null);   // don't overwrite if already completed
  } else if (reqRow.manufacturer_id) {
    targetTable = 'manufacturers';
    targetId = reqRow.manufacturer_id;
    await admin
      .from('manufacturers')
      .update({ claimed_by_email: reqRow.requester_email })
      .eq('id', reqRow.manufacturer_id)
      .is('claimed_at', null);
  }

  await writeAudit({
    actor,
    action: 'claim.approve',
    target_table: 'claim_requests',
    target_id: requestId,
    payload: {
      requester_email: reqRow.requester_email,
      target_table: targetTable,
      target_id: targetId,
      token_expired: tokenExpired,
      note: note ?? null,
    },
    req,
  });

  return NextResponse.json({
    ok: true,
    requestId,
    tokenExpired,
    warning: tokenExpired
      ? 'Original verification token has expired. Requester must re-request via the public claim form to complete.'
      : undefined,
  });
}
