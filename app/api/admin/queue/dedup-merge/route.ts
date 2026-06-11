/**
 * app/api/admin/queue/dedup-merge/route.ts
 *
 * Disposition for an fda_dedup queue row: COLLAPSE sibling device_master rows
 * (same product, multiple FDA submissions) into a survivor. This is distinct
 * from /accept's merge — that appends a queued identifier to a target and writes
 * a regional_registration; a dedup absorbs EXISTING device rows and tombstones
 * them via merged_into.
 *
 * The operator may pick a survivor other than the proposed one and absorb a
 * SUBSET of the cluster (the brand-family split). Both survivor and absorbed
 * must be members of the cluster carried in the queue row's raw_data — the
 * route will not absorb arbitrary devices.
 *
 * Per absorbed row:
 *   - re-point its external-id rows to the survivor (skipping any (id_type,
 *     id_value) the survivor already holds — unique-index safe), so the survivor
 *     accumulates every submission number
 *   - set device_master.merged_into = survivor (tombstone; reversible; never DELETE)
 *   - regional_registrations are NOT moved (unique (device_link,country,
 *     regulatory_body)); tombstoned with their device via merged_into
 *
 * The queue row is then marked accepted with a record of what was absorbed. If
 * the operator absorbed only a subset, the unselected members stay as separate
 * devices and the row still closes (the cluster has been reviewed).
 *
 * Body: { queue_id, survivor_aletia_id, absorbed_aletia_ids: string[], review_note? }
 */

import { NextResponse, type NextRequest } from 'next/server'
import {
  getAdminActor,
  getServiceClient,
  writeAudit,
  AdminAuthError,
} from '@/lib/adminAudit'
import { planAbsorbFromIds, type ExternalIdRow } from '@/lib/fdaDedup'

export const dynamic = 'force-dynamic'

interface DedupMember { aletia_id: string }
interface DedupRaw { kind?: string; proposed_survivor?: string; members?: DedupMember[] }

export async function POST(req: NextRequest) {
  let actor
  try {
    actor = await getAdminActor()
  } catch (e) {
    if (e instanceof AdminAuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  }
  if (actor.role === 'readonly') {
    return NextResponse.json({ error: 'Readonly admin cannot apply a dedup merge' }, { status: 403 })
  }

  let body: {
    queue_id?: string
    survivor_aletia_id?: string
    absorbed_aletia_ids?: string[]
    review_note?: string | null
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const { queue_id, survivor_aletia_id } = body
  const absorbed = (body.absorbed_aletia_ids ?? []).filter((a) => a && a !== survivor_aletia_id)
  if (!queue_id || !survivor_aletia_id || absorbed.length === 0) {
    return NextResponse.json(
      { error: 'queue_id, survivor_aletia_id and a non-empty absorbed_aletia_ids are required' },
      { status: 400 },
    )
  }

  const admin = getServiceClient()

  // Load the queue row and validate it's an open fda_dedup cluster.
  const { data: queueRow, error: qErr } = await admin
    .from('ingestion_review_queue')
    .select('queue_id, source, status, raw_data')
    .eq('queue_id', queue_id)
    .single()
  if (qErr || !queueRow) return NextResponse.json({ error: 'Queue entry not found' }, { status: 404 })
  if (queueRow.source !== 'fda_dedup') {
    return NextResponse.json({ error: 'Not an fda_dedup row — use /accept' }, { status: 400 })
  }
  if (queueRow.status !== 'pending') {
    return NextResponse.json({ error: `Entry is already ${queueRow.status}` }, { status: 409 })
  }

  // Survivor + absorbed must all be members of the cluster.
  const raw = (queueRow.raw_data ?? {}) as DedupRaw
  const memberIds = new Set((raw.members ?? []).map((m) => m.aletia_id))
  if (!memberIds.has(survivor_aletia_id)) {
    return NextResponse.json({ error: 'survivor is not a member of this cluster' }, { status: 400 })
  }
  const stray = absorbed.filter((a) => !memberIds.has(a))
  if (stray.length) {
    return NextResponse.json({ error: `absorbed not in cluster: ${stray.join(', ')}` }, { status: 400 })
  }

  // Confirm the devices are live (not already merged/excluded) before touching them.
  const involved = [survivor_aletia_id, ...absorbed]
  const { data: devices, error: dErr } = await admin
    .from('device_master')
    .select('aletia_id, merged_into, excluded')
    .in('aletia_id', involved)
  if (dErr) return NextResponse.json({ error: `device lookup failed: ${dErr.message}` }, { status: 500 })
  const survivorRow = devices?.find((d) => d.aletia_id === survivor_aletia_id)
  if (!survivorRow) return NextResponse.json({ error: 'survivor not found' }, { status: 404 })
  if (survivorRow.merged_into) {
    return NextResponse.json({ error: 'survivor is itself already merged into another device' }, { status: 409 })
  }
  const alreadyGone = (devices ?? []).filter((d) => absorbed.includes(d.aletia_id) && d.merged_into)
  if (alreadyGone.length) {
    return NextResponse.json(
      { error: `already merged: ${alreadyGone.map((d) => d.aletia_id).join(', ')} — re-open the cluster` },
      { status: 409 },
    )
  }

  // Build the absorb plan from live external ids.
  const { data: idRows, error: iErr } = await admin
    .from('device_external_ids')
    .select('id, aletia_id, id_type, id_value')
    .in('aletia_id', involved)
  if (iErr) return NextResponse.json({ error: `external_ids fetch failed: ${iErr.message}` }, { status: 500 })

  const byDevice = new Map<string, ExternalIdRow[]>()
  for (const r of (idRows ?? []) as ExternalIdRow[]) {
    const arr = byDevice.get(r.aletia_id) ?? []
    arr.push(r)
    byDevice.set(r.aletia_id, arr)
  }
  const plan = planAbsorbFromIds(survivor_aletia_id, absorbed, byDevice)

  // Apply: re-point ids, then tombstone.
  const now = new Date().toISOString()
  for (const m of plan.idMoves) {
    const { error } = await admin
      .from('device_external_ids')
      .update({ aletia_id: survivor_aletia_id, is_primary: false, last_seen_at: now })
      .eq('id', m.external_id_row_id)
    if (error) {
      return NextResponse.json(
        { error: `id re-point failed (${m.id_value}): ${error.message} — partial state; check ${survivor_aletia_id}` },
        { status: 500 },
      )
    }
  }
  const { error: tErr } = await admin
    .from('device_master')
    .update({ merged_into: survivor_aletia_id })
    .in('aletia_id', plan.absorbed)
  if (tErr) {
    return NextResponse.json({ error: `tombstone failed: ${tErr.message}` }, { status: 500 })
  }

  // Close the queue row.
  await admin
    .from('ingestion_review_queue')
    .update({
      status: 'accepted',
      reviewed_at: now,
      reviewed_by: actor.email,
      review_note: body.review_note ?? null,
      raw_data: { ...(raw as Record<string, unknown>), applied: { survivor: survivor_aletia_id, absorbed: plan.absorbed, id_moves: plan.idMoves.length } },
    })
    .eq('queue_id', queue_id)

  await writeAudit({
    actor,
    action: 'queue.dedup_merge',
    target_table: 'device_master',
    target_id: survivor_aletia_id,
    payload: { queue_id, survivor: survivor_aletia_id, absorbed: plan.absorbed, id_moves: plan.idMoves.length },
    req,
  })

  return NextResponse.json({
    ok: true,
    survivor: survivor_aletia_id,
    absorbed: plan.absorbed,
    id_moves: plan.idMoves.length,
  })
}
