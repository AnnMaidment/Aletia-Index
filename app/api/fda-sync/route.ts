/**
 * app/api/fda-sync/route.ts — A2b (MHRA portions updated 24 April)
 *
 * FDA endpoints:
 *   POST                              → sync one existing device by aletia_id + external id
 *   GET   ?bulk=true                  → bulk re-sync all FDA devices via device_external_ids
 *   PATCH                             → backfill manufacturer_name for rows missing it
 *   PUT                               → seed FDA devices through the 4d gate
 *   GET   (no params)                 → health check / endpoint listing
 *
 * MHRA endpoints (rewritten 24 April — no MHRA- prefix, 4d gate on seed):
 *   POST  ?source=mhra                → resync one existing MHRA device by aletia_id
 *   GET   ?bulk=true&source=mhra      → bulk re-sync all MHRA devices
 *   PUT   ?source=mhra                → seed MHRA devices through the 4d gate
 *
 * Auth: SYNC_SECRET header (x-sync-token). Admin portal uses its own auth.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  syncExistingDeviceFromFDA,
  bulkSyncAllDevices,
  ingestFdaDevice,
} from '@/lib/fdaSync'
import { createAdminClient } from '@/lib/supabase-admin'

const SYNC_SECRET = process.env.SYNC_SECRET

function isAuthorised(req: NextRequest): boolean {
  if (!SYNC_SECRET) return true // No secret set — open (dev only)
  return req.headers.get('x-sync-token') === SYNC_SECRET
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — sync a single existing device
// ─────────────────────────────────────────────────────────────────────────────
//
// FDA body:
//   { aletia_id, external_id_value, id_type: 'fda_k_number'|'fda_de_novo'|'fda_pma' }
//
// MHRA body:
//   { aletia_id, external_id_value, gmdn_term }
//
export async function POST(req: NextRequest) {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const source = req.nextUrl.searchParams.get('source')

  // ─── MHRA path (A2b) ────────────────────────────────────────────────────
  if (source === 'mhra') {
    let body: { aletia_id?: string; external_id_value?: string; gmdn_term?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { aletia_id, external_id_value, gmdn_term } = body
    if (!aletia_id || !external_id_value || !gmdn_term) {
      return NextResponse.json(
        { error: 'aletia_id, external_id_value, and gmdn_term are all required for MHRA sync' },
        { status: 400 },
      )
    }

    const { syncExistingDeviceFromMHRA } = await import('@/lib/mhraSync')
    const result = await syncExistingDeviceFromMHRA(aletia_id, external_id_value, gmdn_term)
    return NextResponse.json(result, { status: result.success ? 200 : 500 })
  }

  // ─── FDA path ────────────────────────────────────────────────────────────
  let body: { aletia_id?: string; external_id_value?: string; id_type?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { aletia_id, external_id_value, id_type } = body

  if (!aletia_id) {
    return NextResponse.json({ error: 'aletia_id is required' }, { status: 400 })
  }
  if (!external_id_value) {
    return NextResponse.json({ error: 'external_id_value is required' }, { status: 400 })
  }
  if (!id_type || !['fda_k_number', 'fda_de_novo', 'fda_pma'].includes(id_type)) {
    return NextResponse.json(
      { error: "id_type must be one of: 'fda_k_number', 'fda_de_novo', 'fda_pma'" },
      { status: 400 },
    )
  }

  const result = await syncExistingDeviceFromFDA(
    aletia_id,
    external_id_value,
    id_type as 'fda_k_number' | 'fda_de_novo' | 'fda_pma',
  )
  return NextResponse.json(result, { status: result.success ? 200 : 500 })
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH — backfill manufacturer_name for FDA devices where null
// ─────────────────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { get510kByKNumber } = await import('@/lib/fda')

  // Find devices with a K-number in device_external_ids but null manufacturer_name.
  // Post-A2b: we join rather than filtering by device_id shape.
  const { data: targets, error: queryErr } = await admin
    .from('device_external_ids')
    .select('aletia_id, id_value, device_master!inner(aletia_id, manufacturer_name)')
    .eq('id_type', 'fda_k_number')
    .is('device_master.manufacturer_name', null)

  if (queryErr) {
    return NextResponse.json({ error: queryErr.message }, { status: 500 })
  }
  if (!targets?.length) {
    return NextResponse.json({ message: 'Nothing to backfill' })
  }

  let updated = 0
  for (const row of targets) {
    await new Promise((r) => setTimeout(r, 300))
    const clearance = await get510kByKNumber(row.id_value)
    if (clearance?.applicant) {
      await admin
        .from('device_master')
        .update({ manufacturer_name: clearance.applicant })
        .eq('aletia_id', row.aletia_id)
      updated++
    }
  }

  return NextResponse.json({ total: targets.length, updated })
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — health check, bulk sync
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    if (!isAuthorised(req)) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    }

    const source = req.nextUrl.searchParams.get('source')
    const isBulk = req.nextUrl.searchParams.get('bulk') === 'true'

    // ─── MHRA bulk re-sync ────────────────────────────────────────────────
    if (source === 'mhra' && isBulk) {
      const { bulkSyncAllMhraDevices } = await import('@/lib/mhraSync')
      const results = await bulkSyncAllMhraDevices()
      const succeeded   = results.filter((r) => r.success).length
      const staleAlerts = results.filter((r) => r.stale_registration_alert).length

      return NextResponse.json({
        source: 'MHRA',
        total: results.length,
        succeeded,
        failed: results.length - succeeded,
        stale_registration_alerts: staleAlerts,
        results,
      })
    }

    // ─── FDA: health check ────────────────────────────────────────────────
    if (!isBulk) {
      return NextResponse.json({
        message: [
          'Aletia Multi-Jurisdiction Sync endpoint (A2b).',
          '',
          'FDA:',
          '  POST                         — sync one existing device by aletia_id + external_id_value + id_type',
          '  GET  ?bulk=true              — bulk re-sync all FDA devices',
          '  PATCH                        — backfill manufacturer_name',
          '  PUT                          — seed FDA AI/ML devices through the 4d gate',
          '',
          'MHRA:',
          '  POST ?source=mhra            — resync one existing MHRA device by aletia_id + external_id_value + gmdn_term',
          '  GET  ?bulk=true&source=mhra  — bulk re-sync all MHRA devices',
          '  PUT  ?source=mhra            — seed MHRA devices through the 4d gate',
        ].join('\n'),
      })
    }

    // ─── FDA bulk sync ────────────────────────────────────────────────────
    const results = await bulkSyncAllDevices()
    const succeeded = results.filter((r) => r.success).length
    const recallAlerts = results.filter((r) => r.recall_alert).length

    return NextResponse.json({
      source: 'FDA',
      total: results.length,
      succeeded,
      failed: results.length - succeeded,
      recall_alerts: recallAlerts,
      results,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT — seed / discovery
// ─────────────────────────────────────────────────────────────────────────────
//
// Each returned device/identifier goes through the 4d gate (ingestFdaDevice /
// ingestMhraDevice). The gate decides whether to update an existing device,
// queue for merge review, or create a new one atomically.

export async function PUT(req: NextRequest) {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const source = req.nextUrl.searchParams.get('source')

  // ─── MHRA seed — A2b 4d gate ────────────────────────────────────────────
  if (source === 'mhra') {
    const { searchAllMhraAIMLDevices } = await import('@/lib/mhra')
    const { ingestMhraDevice, resolveMhraManufacturer } = await import('@/lib/mhraSync')

    const devices = await searchAllMhraAIMLDevices()
    if (!devices.length) {
      return NextResponse.json({ message: 'No MHRA devices returned from PARD' })
    }

    const results = []
    const counters = {
      updated_existing: 0,
      created_new: 0,
      queued_for_review: 0,
      already_queued: 0,
      failed: 0,
    }

    for (const device of devices) {
      await new Promise((r) => setTimeout(r, 200))

      let manufacturer = null
      try {
        manufacturer = await resolveMhraManufacturer(device)
      } catch {
        // Non-fatal — ingestMhraDevice falls back to "MHRA Manufacturer {ID}".
      }

      const result = await ingestMhraDevice(device, manufacturer)
      results.push(result)
      counters[result.action]++
    }

    return NextResponse.json({
      source: 'MHRA',
      message: `Processed ${devices.length} MHRA device identifiers through the 4d gate`,
      total: devices.length,
      counters,
      sample: results.slice(0, 20),
    })
  }

  // ─── FDA seed — A2b 4d gate ─────────────────────────────────────────────
  try {
    const { searchAllAIMLDevices } = await import('@/lib/fda')
    const devices = await searchAllAIMLDevices()

    if (!devices.length) {
      return NextResponse.json({ message: 'No devices returned from FDA' })
    }

    const results = []
    const counters = {
      updated_existing: 0,
      created_new: 0,
      queued_for_review: 0,
      already_queued: 0,
      skipped_class_1: 0,
      failed: 0,
    }

    for (const d of devices) {
      // Respect openFDA rate limits between calls (ingestFdaDevice itself
      // does multiple openFDA lookups internally).
      await new Promise((resolve) => setTimeout(resolve, 350))

      const result = await ingestFdaDevice(d.k_number, 'fda_k_number')
      results.push(result)
      counters[result.action]++
    }

    return NextResponse.json({
      source: 'FDA',
      message: `Processed ${devices.length} K-numbers through the 4d gate`,
      total: devices.length,
      counters,
      // Truncate full results in the response if the caller wants them back;
      // otherwise they can query ingestion_review_queue / ingestion_anomalies.
      sample: results.slice(0, 20),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
