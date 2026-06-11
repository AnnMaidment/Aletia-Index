/**
 * app/api/admin/queue/merge-preview/route.ts
 *
 * Compute the field-level merge diff between a queue row and a chosen merge
 * target, for the drawer to render. This runs EXACTLY the same code path the
 * accept route applies (buildIncomingFields → computeMergeDiff over the
 * authoritative device_master row + the queue's raw_data), so what the
 * operator sees in the diff panel is precisely what resolveMergePatch will
 * write when they accept. The drawer never computes from stale client data
 * and never sends values back — only keep/use_incoming decisions.
 *
 * Also returns the target's CURRENT claim state, refreshed at preview time —
 * the claim status embedded in possible_merge_candidates is as old as the
 * candidate computation and a listing can be claimed in between.
 *
 * Body:     { queue_id: string, target_aletia_id: string }
 * Response: {
 *   diffs: FieldDiff[],
 *   target: { aletia_id, name, claimed_at, claimed_by_email },
 * }
 */

import { NextResponse, type NextRequest } from 'next/server'
import {
  getAdminActor,
  getServiceClient,
  AdminAuthError,
} from '@/lib/adminAudit'
import { computeMergeDiff, buildIncomingFields } from '@/lib/mergeDiff'

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

  let body: { queue_id?: string; target_aletia_id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body.queue_id || !body.target_aletia_id) {
    return NextResponse.json(
      { error: 'queue_id and target_aletia_id required' },
      { status: 400 },
    )
  }

  const admin = getServiceClient()

  const [{ data: queueRow, error: qErr }, { data: target, error: tErr }] =
    await Promise.all([
      admin
        .from('ingestion_review_queue')
        .select('queue_id, source, device_name, manufacturer, raw_data')
        .eq('queue_id', body.queue_id)
        .single(),
      admin
        .from('device_master')
        .select('aletia_id, name, manufacturer_name, intended_use, eu_risk_class, claimed_at, claimed_by_email')
        .eq('aletia_id', body.target_aletia_id)
        .maybeSingle(),
    ])

  if (qErr || !queueRow) {
    return NextResponse.json({ error: 'Queue entry not found' }, { status: 404 })
  }
  if (tErr || !target) {
    return NextResponse.json(
      { error: `Target device ${body.target_aletia_id} not found` },
      { status: 404 },
    )
  }

  const incoming = buildIncomingFields(
    queueRow.source,
    (queueRow.raw_data ?? {}) as Record<string, unknown>,
    {
      device_name: queueRow.device_name ?? null,
      manufacturer: queueRow.manufacturer ?? null,
    },
  )

  const diffs = computeMergeDiff(
    {
      name:              target.name,
      manufacturer_name: target.manufacturer_name,
      intended_use:      target.intended_use,
      eu_risk_class:     target.eu_risk_class,
    },
    incoming,
  )

  return NextResponse.json({
    diffs,
    target: {
      aletia_id:        target.aletia_id,
      name:             target.name,
      claimed_at:       target.claimed_at,
      claimed_by_email: target.claimed_by_email,
    },
  })
}
