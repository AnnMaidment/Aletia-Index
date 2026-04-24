/**
 * lib/mhraSync.ts — A2b rewrite
 *
 * Three entry points, reflecting the three things MHRA ingest actually does —
 * structurally identical to lib/fdaSync.ts.
 *
 *   1. syncExistingDeviceFromMHRA(aletiaId, externalIdValue, gmdnTerm)
 *      Refresh an existing device's MHRA-derived fields. Caller must already
 *      know which aletia_id maps to which MHRA device ID. gmdnTerm is needed
 *      because PARD has no direct-lookup-by-ID endpoint; we re-fetch via
 *      searchDevices and filter by DEVICE_ID client-side.
 *
 *   2. bulkSyncAllMhraDevices()
 *      Walk device_external_ids (mhra_device_id rows), resolve gmdn_term from
 *      regional_registrations, call #1 for each. This is what the scheduled
 *      bulk sync calls.
 *
 *   3. ingestMhraDevice(device, manufacturer)
 *      Process a PARD-returned MhraDevice where we don't know yet whether
 *      it's new to Aletia. Goes through the 4d gate — exact identifier match
 *      updates; fuzzy match queues for admin review; no match creates a new
 *      device via the atomic RPC.
 *
 * Key differences from pre-A2b:
 *   - The MHRA DEVICE_ID is no longer synthesised into a 'MHRA-47392' string
 *     and used as device_master.device_id. The raw numeric ID (as string)
 *     lives in device_external_ids with id_type='mhra_device_id'.
 *   - bulkSyncAllMhraDevices joins through device_external_ids rather than
 *     regional_registrations. regional_registrations keeps gmdn_term, which
 *     we still need to look up per device to re-fetch from PARD.
 *   - Discovery goes through ingestMhraDevice → 4d gate, so a new PARD device
 *     matching an existing FDA-only device gets queued for merge review
 *     rather than creating a duplicate.
 *   - Writes use the service-role client; the anon client is no longer used.
 */

import { createAdminClient } from './supabase-admin'
import {
  searchMhraDevicesByGmdn,
  deriveMhraHealthStatus,
  mapMhraClassification,
  type MhraDevice,
  type MhraManufacturer,
} from './mhra'
import { processExternalIdentifier, logIngestionAnomaly } from './ingestion'

// ─────────────────────────────────────────────────────────────────────────────
// Result shapes
// ─────────────────────────────────────────────────────────────────────────────

export interface MhraSyncResult {
  aletia_id:                string | null
  external_id_value:        string           // raw numeric ID as string, e.g. "47392"
  gmdn_term:                string
  success:                  boolean
  health_status?:           'Green' | 'Amber' | 'Red'
  risk_class?:              string
  stale_registration_alert: boolean          // true if not updated in 2+ years
  error?:                   string
}

export interface MhraIngestResult {
  external_id_value: string
  action: 'updated_existing' | 'created_new' | 'queued_for_review' | 'already_queued' | 'failed'
  aletia_id: string | null
  error?:   string
}

// ─────────────────────────────────────────────────────────────────────────────
// (1) Sync one existing device's MHRA-derived fields
// ─────────────────────────────────────────────────────────────────────────────

export async function syncExistingDeviceFromMHRA(
  aletiaId:        string,
  externalIdValue: string,       // raw numeric MHRA device ID as string
  gmdnTerm:        string,
): Promise<MhraSyncResult> {
  const admin = createAdminClient()

  const result: MhraSyncResult = {
    aletia_id:                aletiaId,
    external_id_value:        externalIdValue,
    gmdn_term:                gmdnTerm,
    success:                  false,
    stale_registration_alert: false,
  }

  try {
    // ── Re-fetch via PARD (no direct-lookup-by-ID endpoint) ─────────────────
    const devices = await searchMhraDevicesByGmdn(gmdnTerm)
    if (!devices?.length) {
      // Device no longer in PARD results — mark Red on device_master.
      await admin
        .from('device_master')
        .update({
          health_status:       'Red',
          last_automated_sync: new Date().toISOString(),
        })
        .eq('aletia_id', aletiaId)

      result.health_status = 'Red'
      result.error = `No PARD devices returned for GMDN term "${gmdnTerm}"`
      return result
    }

    // ── Match by DEVICE_ID ────────────────────────────────────────────────
    const deviceIdNum = parseInt(externalIdValue, 10)
    if (!Number.isFinite(deviceIdNum)) {
      await logIngestionAnomaly(admin, {
        source:                   'mhra_sync',
        anomaly_type:             'unknown_identifier_shape',
        identifier_value:         externalIdValue,
        identifier_type_expected: 'mhra_device_id',
        aletia_id:                aletiaId,
        context: { phase: 'syncExistingDeviceFromMHRA', gmdn_term: gmdnTerm },
      })
      result.error = `Non-numeric mhra_device_id: ${externalIdValue}`
      return result
    }

    const device = devices.find((d) => d.DEVICE_ID === deviceIdNum)
    if (!device) {
      // PARD no longer returns this device for that GMDN term. Could be a
      // registration lapse, a GMDN reclassification, or a data drift. Mark
      // Red and log an anomaly for triage.
      await admin
        .from('device_master')
        .update({
          health_status:       'Red',
          last_automated_sync: new Date().toISOString(),
        })
        .eq('aletia_id', aletiaId)

      await logIngestionAnomaly(admin, {
        source:                   'mhra_sync',
        anomaly_type:             'missing_required_field',
        identifier_value:         externalIdValue,
        identifier_type_expected: 'mhra_device_id',
        aletia_id:                aletiaId,
        context: { phase: 'syncExistingDeviceFromMHRA', gmdn_term: gmdnTerm, reason: 'device not in PARD results' },
      })

      result.health_status = 'Red'
      result.error = `Device ID ${externalIdValue} not in PARD results for "${gmdnTerm}"`
      return result
    }

    // ── Derive fields ─────────────────────────────────────────────────────
    const healthStatus = deriveMhraHealthStatus(device)
    const riskClass    = mapMhraClassification(device.DEVICE_SUB_TYPE_DESC)
    const staleAlert   = healthStatus === 'Amber'

    // ── Update device_master ──────────────────────────────────────────────
    // NOTE: update, not upsert. The device exists (we looked it up by aletia_id).
    const deviceUpdate: Record<string, unknown> = {
      health_status:       healthStatus,
      last_automated_sync: new Date().toISOString(),
    }

    // Fill name / intended_use only if they're currently null. Don't
    // overwrite manufacturer-claimed or admin-edited values.
    if (device.GMDN_TERM_NAME) {
      const { data: existing } = await admin
        .from('device_master')
        .select('name, intended_use')
        .eq('aletia_id', aletiaId)
        .maybeSingle()

      if (existing?.name == null)         deviceUpdate.name         = device.GMDN_TERM_NAME
      if (existing?.intended_use == null) deviceUpdate.intended_use = device.GMDN_TERM_NAME
    }

    const { error: deviceErr } = await admin
      .from('device_master')
      .update(deviceUpdate)
      .eq('aletia_id', aletiaId)

    if (deviceErr) {
      throw new Error(`device_master update failed: ${deviceErr.message}`)
    }

    // ── Upsert regional_registrations with external_id_value ──────────────
    const regRecord = {
      device_link:       aletiaId,
      country:           'GB',
      regulatory_body:   'MHRA',
      clearance_type:    'UKCA',
      device_class:      riskClass,
      gmdn_code:         String(device.GMDN_CODE),
      gmdn_term:         device.GMDN_TERM_NAME,
      external_id_value: externalIdValue,
      last_updated:      device.LAST_UPDATED_DATE,
    }

    const { error: regErr } = await admin
      .from('regional_registrations')
      .upsert(regRecord, { onConflict: 'device_link,country,regulatory_body' })

    if (regErr) {
      console.warn(`[mhraSync] regional_registrations upsert warning: ${regErr.message}`)
    }

    // ── Touch last_seen_at on the external_ids row ────────────────────────
    await admin
      .from('device_external_ids')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('aletia_id', aletiaId)
      .eq('id_type',   'mhra_device_id')
      .eq('id_value',  externalIdValue)

    result.success                  = true
    result.health_status             = healthStatus
    result.risk_class                = riskClass
    result.stale_registration_alert  = staleAlert
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[mhraSync] syncExistingDeviceFromMHRA failed for ${aletiaId}/${externalIdValue}:`, message)
    result.error = message
    return result
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// (2) Bulk re-sync — walk device_external_ids
// ─────────────────────────────────────────────────────────────────────────────

export async function bulkSyncAllMhraDevices(): Promise<MhraSyncResult[]> {
  const admin = createAdminClient()

  // Walk device_external_ids for MHRA IDs. Join through regional_registrations
  // to pull the gmdn_term we need to re-fetch from PARD. Two queries is cleaner
  // than a nested select here; MHRA device counts are small (<100 today).
  const { data: mhraIds, error: extErr } = await admin
    .from('device_external_ids')
    .select('aletia_id, id_value')
    .eq('id_type', 'mhra_device_id')

  if (extErr || !mhraIds) {
    console.error('[mhraSync] Could not fetch MHRA identifiers for bulk sync:', extErr?.message)
    return []
  }

  if (mhraIds.length === 0) {
    console.info('[mhraSync] No MHRA devices in device_external_ids; nothing to sync')
    return []
  }

  // Fetch GMDN terms in one query.
  const aletiaIds = mhraIds.map((r) => r.aletia_id)
  const { data: regs, error: regErr } = await admin
    .from('regional_registrations')
    .select('device_link, gmdn_term')
    .eq('regulatory_body', 'MHRA')
    .in('device_link', aletiaIds)

  if (regErr) {
    console.error('[mhraSync] Could not fetch regional_registrations for bulk sync:', regErr.message)
    return []
  }

  // Map aletia_id → gmdn_term.
  const termByAletiaId = new Map<string, string | null>()
  for (const r of regs ?? []) {
    termByAletiaId.set(r.device_link, r.gmdn_term ?? null)
  }

  const results: MhraSyncResult[] = []
  for (const row of mhraIds) {
    // PARD rate-limit politeness: 300ms between calls.
    await new Promise((resolve) => setTimeout(resolve, 300))

    const gmdnTerm = termByAletiaId.get(row.aletia_id)
    if (!gmdnTerm) {
      // Missing GMDN term — can't re-fetch. Log anomaly and skip.
      await logIngestionAnomaly(admin, {
        source:                   'mhra_sync',
        anomaly_type:             'missing_required_field',
        identifier_value:         row.id_value,
        identifier_type_expected: 'mhra_device_id',
        aletia_id:                row.aletia_id,
        context: { phase: 'bulkSyncAllMhraDevices', reason: 'no gmdn_term in regional_registrations' },
      })
      results.push({
        aletia_id:                row.aletia_id,
        external_id_value:        row.id_value,
        gmdn_term:                '(missing)',
        success:                  false,
        stale_registration_alert: false,
        error: 'No gmdn_term in regional_registrations; cannot re-fetch from PARD',
      })
      continue
    }

    const result = await syncExistingDeviceFromMHRA(row.aletia_id, row.id_value, gmdnTerm)
    results.push(result)
  }

  return results
}

// ─────────────────────────────────────────────────────────────────────────────
// (3) Discovery / seed — one PARD device at a time, through the 4d gate
// ─────────────────────────────────────────────────────────────────────────────

export async function ingestMhraDevice(
  device:       MhraDevice,
  manufacturer: MhraManufacturer | null,
): Promise<MhraIngestResult> {
  const admin = createAdminClient()

  const externalIdValue = String(device.DEVICE_ID)

  // Shape check — PARD should only give us numeric IDs, but defend.
  if (!/^[0-9]+$/.test(externalIdValue)) {
    await logIngestionAnomaly(admin, {
      source:                   'mhra_sync',
      anomaly_type:             'unknown_identifier_shape',
      identifier_value:         externalIdValue,
      identifier_type_expected: 'mhra_device_id',
      context: { gmdn_term: device.GMDN_TERM_NAME },
    })
    return {
      external_id_value: externalIdValue,
      action:            'failed',
      aletia_id:         null,
      error:             'MHRA DEVICE_ID is non-numeric',
    }
  }

  const manufacturerName =
    manufacturer?.MAN_ORGANISATION_NAME
    ?? `MHRA Manufacturer ${device.MAN_ORGANISATION_ID}`

  const riskClass = mapMhraClassification(device.DEVICE_SUB_TYPE_DESC)

  // ── 4d gate ─────────────────────────────────────────────────────────────
  const decision = await processExternalIdentifier({
    supabase:    admin,
    id_type:     'mhra_device_id',
    id_value:    externalIdValue,
    jurisdiction: 'GB',
    source:      'mhra_sync',
    queueSource: 'mhra_sync',
    reviewReason: 'possible_merge',
    manufacturerName,
    deviceName:   device.GMDN_TERM_NAME ?? null,
    payload: {
      DEVICE_ID:            device.DEVICE_ID,
      MAN_ORGANISATION_ID:  device.MAN_ORGANISATION_ID,
      GMDN_CODE:            device.GMDN_CODE,
      GMDN_TERM_NAME:       device.GMDN_TERM_NAME,
      DEVICE_SUB_TYPE_DESC: device.DEVICE_SUB_TYPE_DESC,
      DEVICE_REG_STATUS_CODE: device.DEVICE_REG_STATUS_CODE,
      DEVICE_TYPE_NAME:     device.DEVICE_TYPE_NAME,
      LAST_UPDATED_DATE:    device.LAST_UPDATED_DATE,
      gmdn_term:            device.GMDN_TERM_NAME,   // duplicated for queue-row display
      gmdn_code:            String(device.GMDN_CODE),
      device_class:         riskClass,
      manufacturer_name:    manufacturerName,
      fetched_at:           new Date().toISOString(),
    },
    autoCreate: true,
    deviceSeed: {
      manufacturer_name:   manufacturerName,
      name:                device.GMDN_TERM_NAME ?? null,
      intended_use:        device.GMDN_TERM_NAME ?? null,
      country_of_origin:   manufacturer?.MAN_COUNTRY ?? 'GB',
      health_status:       deriveMhraHealthStatus(device),
      aletia_verified:     false,
      approval_status:     'approved',                 // MHRA PARD means registered/approved
      data_source:         'registry_sync',
      last_automated_sync: new Date().toISOString(),
      excluded:            false,
      ai_ml_integral:      true,   // seed path filters to AI/ML GMDN terms only
      // external_legacy_id defaults to id_value in the RPC — no need to pass it.
    },
  })

  // ── Post-gate: regional_registrations enrichment for update/create ──────
  if (decision.action === 'updated_existing' || decision.action === 'created_new') {
    const { error: regErr } = await admin
      .from('regional_registrations')
      .upsert(
        {
          device_link:       decision.aletia_id,
          country:           'GB',
          regulatory_body:   'MHRA',
          clearance_type:    'UKCA',
          device_class:      riskClass,
          gmdn_code:         String(device.GMDN_CODE),
          gmdn_term:         device.GMDN_TERM_NAME,
          external_id_value: externalIdValue,
          last_updated:      device.LAST_UPDATED_DATE,
        },
        { onConflict: 'device_link,country,regulatory_body' },
      )

    if (regErr) {
      console.warn(
        `[mhraSync] regional_registrations upsert warning for ${decision.aletia_id}: ${regErr.message}`,
      )
    }

    return {
      external_id_value: externalIdValue,
      action:            decision.action,
      aletia_id:         decision.aletia_id,
    }
  }

  if (decision.action === 'queued_for_review' || decision.action === 'already_queued') {
    return {
      external_id_value: externalIdValue,
      action:            decision.action,
      aletia_id:         null,
    }
  }

  // action === 'failed'
  return {
    external_id_value: externalIdValue,
    action:            'failed',
    aletia_id:         null,
    error:             decision.error,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed helper — resolve manufacturer details for a device from PARD.
//
// PARD has no direct lookup-by-ID endpoint for manufacturers. We search by
// name fragment and filter by organisation ID client-side. Only called during
// seeding; subsequent syncs don't need this because we store manufacturer_name
// on device_master.
// ─────────────────────────────────────────────────────────────────────────────

export async function resolveMhraManufacturer(
  device: MhraDevice,
): Promise<MhraManufacturer | null> {
  try {
    // Import lazily because this is only used from the PUT seed path.
    const { searchMhraManufacturer } = await import('./mhra')
    const results = await searchMhraManufacturer('')
    if (!results) return null
    return results.find((m) => m.MAN_ORGANISATION_ID === device.MAN_ORGANISATION_ID) ?? null
  } catch {
    return null
  }
}
