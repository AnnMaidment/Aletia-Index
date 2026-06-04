/**
 * app/api/fda-sync/route.ts — FDA discovery rebuild (June 2026)
 *
 * FDA endpoints:
 *   POST                              → sync one existing device by aletia_id + external id
 *   GET   ?bulk=true                  → bulk re-sync all FDA devices via device_external_ids
 *   PATCH                             → backfill manufacturer_name for rows missing it
 *   PUT                               → discovery: FDA published AI/ML list seed, then
 *                                       a recency-filtered supplementary sweep
 *   GET   (no params)                 → health check / endpoint listing
 *
 * MHRA endpoints (unchanged):
 *   POST  ?source=mhra                → resync one existing MHRA device by aletia_id
 *   GET   ?bulk=true&source=mhra      → bulk re-sync all MHRA devices
 *   PUT   ?source=mhra                → seed MHRA devices through the 4d gate
 *
 * Auth: SYNC_SECRET header (x-sync-token). Admin portal uses its own auth.
 *
 * NOTE on the FDA PUT (discovery): the list seed (~1,451 devices) and the
 * sweep are too large to finish inside a Free/Hobby serverless timeout in one
 * call, so PUT is batched + resumable via ?phase / ?offset / ?limit and returns
 * a `next_offset` cursor. Run it in a loop against the deployed endpoint, or run
 * it locally (no timeout) where it can complete in a single call.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  syncExistingDeviceFromFDA,
  bulkSyncAllDevices,
  ingestFdaDevice,
  type IngestResult,
} from '@/lib/fdaSync'
import { createAdminClient } from '@/lib/supabase-admin'

// Allow the longest duration the plan permits; for a full one-shot seed run the
// route locally (where no platform timeout applies) or drive the batches.
export const maxDuration = 60

const SYNC_SECRET = process.env.SYNC_SECRET

function isAuthorised(req: NextRequest): boolean {
  if (!SYNC_SECRET) return true // No secret set — open (dev only)
  return req.headers.get('x-sync-token') === SYNC_SECRET
}

// yyyy-mm-dd minus N days (UTC). Falls back to today for an unparseable input.
function isoMinusDays(iso: string, days: number): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00Z`) : new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

// Digits-only date key so we can compare ISO (yyyy-mm-dd) against openFDA values
// (which may arrive as yyyymmdd) without format mismatches.
const dateKey = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

type FdaCounters = Record<IngestResult['action'], number>
const emptyCounters = (): FdaCounters => ({
  updated_existing: 0,
  created_new: 0,
  queued_for_review: 0,
  already_queued: 0,
  skipped_class_1: 0,
  failed: 0,
})

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

  // ─── MHRA path ──────────────────────────────────────────────────────────
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
          'Aletia Multi-Jurisdiction Sync endpoint (FDA discovery rebuild).',
          '',
          'FDA:',
          '  POST                         — sync one existing device by aletia_id + external_id_value + id_type',
          '  GET  ?bulk=true              — bulk re-sync all FDA devices',
          '  PATCH                        — backfill manufacturer_name',
          '  PUT  ?phase=list             — seed from the FDA published AI/ML list (default)',
          '  PUT  ?phase=sweep            — supplementary openFDA sweep (recency-filtered)',
          '       &offset=&limit=         — batch cursor (default offset=0, limit=100)',
          '       &sweep_since=YYYY-MM-DD — override the sweep recency cutoff',
          '       &delay_ms=              — optional per-device pause',
          '',
          'MHRA:',
          '  POST ?source=mhra            — resync one existing MHRA device',
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
// PUT — discovery
//
// FDA (rebuilt): the FDA published AI/ML list is the authoritative seed
// (phase=list, onList=true → auto-create). A supplementary openFDA sweep
// (phase=sweep, onList=false → queued for review) catches recent devices not
// yet on the list, bounded by a recency cutoff so it doesn't re-import the
// broad over-capture being pruned. Each identifier flows through the 4d gate
// via ingestFdaDevice. Batched + resumable; see the GET health check.
// ─────────────────────────────────────────────────────────────────────────────

export async function PUT(req: NextRequest) {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const source = req.nextUrl.searchParams.get('source')

  // ─── MHRA seed — 4d gate (unchanged) ────────────────────────────────────
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

  // ─── FDA discovery — list seed first, recency-filtered sweep second ──────
  try {
    const phase = (req.nextUrl.searchParams.get('phase') ?? 'list') === 'sweep' ? 'sweep' : 'list'
    const offset = Math.max(0, parseInt(req.nextUrl.searchParams.get('offset') ?? '0', 10) || 0)
    const limit = Math.min(
      Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') ?? '100', 10) || 100),
      1000,
    )
    const delayMs = Math.max(0, parseInt(req.nextUrl.searchParams.get('delay_ms') ?? '0', 10) || 0)

    const counters = emptyCounters()
    const results: IngestResult[] = []
    const pause = () => (delayMs ? new Promise((r) => setTimeout(r, delayMs)) : Promise.resolve())

    // ── Phase: list seed ────────────────────────────────────────────────
    if (phase === 'list') {
      const { fetchFdaAiMlList } = await import('@/lib/fdaList')
      const list = await fetchFdaAiMlList()

      if (!list.length) {
        return NextResponse.json(
          { error: 'FDA published list returned no entries — verify the CSV media URL still resolves.' },
          { status: 502 },
        )
      }

      const slice = list.slice(offset, offset + limit)
      for (const e of slice) {
        const result = await ingestFdaDevice({
          identifier: e.identifier,
          id_type: e.id_type,
          device_name: e.device_name,
          applicant: e.applicant,
          product_code: e.product_code,
          decision_date: e.decision_date,
          clearance_type: e.pathway,
          onList: true,
          source: 'fda_list',
        })
        results.push(result)
        counters[result.action]++
        await pause()
      }

      const processedEnd = offset + slice.length
      const nextOffset = processedEnd < list.length ? processedEnd : null

      return NextResponse.json({
        source: 'FDA',
        phase: 'list',
        list_total: list.length,
        offset,
        limit,
        processed: slice.length,
        next_offset: nextOffset,
        done: nextOffset === null,
        counters,
        sample: results.slice(0, 20),
      })
    }

    // ── Phase: supplementary sweep ──────────────────────────────────────
    const { fetchFdaAiMlList } = await import('@/lib/fdaList')
    const { searchAllAIMLForSweep } = await import('@/lib/fda')
    const [list, sweep] = await Promise.all([fetchFdaAiMlList(), searchAllAIMLForSweep()])

    // Recency cutoff: newest list decision_date minus a 90-day buffer (the
    // published list lags, so include a window before its latest entry).
    // Override with ?sweep_since=YYYY-MM-DD.
    const listMax = list.reduce(
      (m, e) => (e.decision_date && e.decision_date > m ? e.decision_date : m),
      '0000-00-00',
    )
    const cutoff = req.nextUrl.searchParams.get('sweep_since') ?? isoMinusDays(listMax, 90)
    const cutoffKey = dateKey(cutoff)

    const seeded = new Set(list.map((e) => `${e.id_type}:${e.identifier}`))
    const candidates = sweep.filter(
      (r) =>
        !seeded.has(`${r.id_type}:${r.identifier}`) &&
        dateKey(r.decision_date) !== '' &&
        dateKey(r.decision_date) >= cutoffKey,
    )

    const slice = candidates.slice(offset, offset + limit)
    for (const r of slice) {
      const result = await ingestFdaDevice({
        identifier: r.identifier,
        id_type: r.id_type,
        device_name: r.device_name,
        applicant: r.applicant,
        product_code: r.product_code,
        decision_date: r.decision_date,
        onList: false,
        source: 'fda_sweep',
      })
      results.push(result)
      counters[result.action]++
      await pause()
    }

    const processedEnd = offset + slice.length
    const nextOffset = processedEnd < candidates.length ? processedEnd : null

    return NextResponse.json({
      source: 'FDA',
      phase: 'sweep',
      cutoff,
      sweep_total: sweep.length,
      candidates: candidates.length,
      offset,
      limit,
      processed: slice.length,
      next_offset: nextOffset,
      done: nextOffset === null,
      counters,
      sample: results.slice(0, 20),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
