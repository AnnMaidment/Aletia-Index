/**
 * lib/fdaSync.ts — A2b rewrite
 *
 * Three entry points, reflecting the three things FDA ingest actually does:
 *
 *   1. syncExistingDeviceFromFDA(aletiaId, kNumber, idType)
 *      Refresh an existing device's FDA-derived fields. Used when we already
 *      know which aletia_id maps to which K-number — no identity gating needed.
 *
 *   2. bulkSyncAllDevices()
 *      Walk device_external_ids (fda_k_number / fda_de_novo / fda_pma rows),
 *      call #1 for each. This is what the scheduled bulk sync calls.
 *
 *   3. ingestFdaDevice(kNumber, clearanceType)
 *      Process a K-number where we don't know yet whether it's new to Aletia.
 *      Goes through the 4d gate — exact identifier match updates; fuzzy match
 *      queues for admin review; no match creates a new device.
 *      This is what the seed/discovery path (PUT /api/fda-sync) now uses.
 *
 * Key differences from pre-A2b:
 *   - The K-number is no longer conflated with the device's identity. aletia_id
 *     is the identity; K-numbers live in device_external_ids.
 *   - bulkSyncAllDevices joins through device_external_ids rather than
 *     relying on regional_registrations.device_link being the K-number.
 *   - Discovery uses the 4d gate so a new K-number that matches an existing
 *     multi-jurisdiction device (e.g. an MHRA-only record whose FDA clearance
 *     we're learning about for the first time) gets merged rather than
 *     creating a duplicate.
 *   - Writes use the service-role client. Pre-A2b used the anon client which
 *     worked only because RLS was permissive; tightening this is good hygiene.
 */

import { createAdminClient } from './supabase-admin'
import {
  get510kByKNumber,
  getPMAByNumber,
  getRecallsByKNumber,
  getAdverseEventCount,
  getClassificationByProductCode,
} from './fda'
import { processExternalIdentifier, logIngestionAnomaly } from './ingestion'
import type { ExternalIdType } from './types'

export interface SyncResult {
  aletia_id: string | null
  success: boolean
  updated_fields: string[]
  recall_alert: boolean
  error?: string
}

export interface IngestResult {
  k_number: string
  action: 'updated_existing' | 'created_new' | 'queued_for_review' | 'already_queued' | 'failed' | 'skipped_class_1'
  aletia_id: string | null
  error?: string
}

type FdaIdType = 'fda_k_number' | 'fda_de_novo' | 'fda_pma'

// ─────────────────────────────────────────────────────────────────────────────
// Health status derivation — unchanged from pre-A2b
// ─────────────────────────────────────────────────────────────────────────────

function deriveHealthStatus(
  hasActiveRecall: boolean,
  adverseEventCount: number,
): 'Green' | 'Amber' | 'Red' {
  if (hasActiveRecall) return 'Red'
  if (adverseEventCount > 50) return 'Amber'
  return 'Green'
}

// ─────────────────────────────────────────────────────────────────────────────
// (1) Sync one existing device's FDA-derived fields
// ─────────────────────────────────────────────────────────────────────────────

export async function syncExistingDeviceFromFDA(
  aletiaId: string,
  externalIdValue: string,
  idType: FdaIdType,
): Promise<SyncResult> {
  const admin = createAdminClient()
  const updatedFields: string[] = []

  try {
    // ── Fetch FDA clearance data by identifier type ───────────────────────
    const clearanceData = idType === 'fda_k_number'
      ? await get510kByKNumber(externalIdValue)
      : idType === 'fda_pma'
        ? await getPMAByNumber(externalIdValue)
        : null   // De Novo: no dedicated helper, fall through to defaults

    const productCode = clearanceData?.product_code ?? ''

    // ── Classification check — Class I is out of scope ────────────────────
    const classification = productCode
      ? await getClassificationByProductCode(productCode)
      : null

    if (productCode && !classification) {
      return {
        aletia_id: aletiaId,
        success: false,
        updated_fields: [],
        recall_alert: false,
        error: 'Device is Class I — out of scope for Aletia Index',
      }
    }

    // ── Fetch recalls and adverse events ──────────────────────────────────
    const recalls = idType === 'fda_k_number'
      ? await getRecallsByKNumber(externalIdValue)
      : []

    const hasActiveRecall = recalls.some((r) => r.status?.toLowerCase() === 'ongoing')

    const deviceName = clearanceData?.device_name ?? aletiaId
    const { total_events } = await getAdverseEventCount(deviceName)

    const health_status = deriveHealthStatus(hasActiveRecall, total_events)

    // ── Update device_master ──────────────────────────────────────────────
    // NOTE: we update, not upsert. The device is known to exist (aletiaId is
    // the PK). Upsert here would risk an accidental insert with default values.
    const deviceUpdate: Record<string, unknown> = {
      health_status,
      last_automated_sync: new Date().toISOString(),
    }

    if (clearanceData?.applicant) {
      deviceUpdate.manufacturer_name = clearanceData.applicant
      updatedFields.push('manufacturer_name')
    }

    if (clearanceData?.device_name) {
      deviceUpdate.name = clearanceData.device_name           // NEW in A2b
      // Don't overwrite intended_use if it's already been set richer elsewhere.
      // We'll fill it only if null.
      updatedFields.push('name')
    }

    if (classification?.device_class) {
      const tierMap: Record<string, number> = { '2': 2, '3': 4 }
      deviceUpdate.accountability_tier = tierMap[classification.device_class] ?? 2
      updatedFields.push('accountability_tier')
    }

    updatedFields.push('health_status', 'last_automated_sync')

    const { error: deviceErr } = await admin
      .from('device_master')
      .update(deviceUpdate)
      .eq('aletia_id', aletiaId)

    if (deviceErr) {
      throw new Error(`device_master update failed: ${deviceErr.message}`)
    }

    // Fill intended_use only if it's currently null.
    if (clearanceData?.device_name) {
      await admin
        .from('device_master')
        .update({ intended_use: clearanceData.device_name })
        .eq('aletia_id', aletiaId)
        .is('intended_use', null)
    }

    // ── Upsert regional_registrations with external_id_value ──────────────
    if (clearanceData) {
      const regRecord = {
        device_link:       aletiaId,
        country:           'US',
        regulatory_body:   'FDA',
        clearance_type:    clearanceData.clearance_type,
        external_id_value: externalIdValue,           // NEW in A2b
        last_updated:      new Date().toISOString(),
      }

      const { error: regErr } = await admin
        .from('regional_registrations')
        .upsert(regRecord, { onConflict: 'device_link,country,regulatory_body' })

      if (regErr) {
        console.warn(`[fdaSync] regional_registrations upsert warning: ${regErr.message}`)
      } else {
        updatedFields.push('regional_registrations')
      }
    }

    // Touch last_seen_at on the external_ids row. Minor bookkeeping.
    await admin
      .from('device_external_ids')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('aletia_id', aletiaId)
      .eq('id_type', idType)
      .eq('id_value', externalIdValue)

    return {
      aletia_id: aletiaId,
      success: true,
      updated_fields: updatedFields,
      recall_alert: hasActiveRecall,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[fdaSync] syncExistingDeviceFromFDA failed for ${aletiaId}/${externalIdValue}:`, message)
    return {
      aletia_id: aletiaId,
      success: false,
      updated_fields: [],
      recall_alert: false,
      error: message,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// (2) Bulk re-sync — walk device_external_ids
//
// Joins through device_external_ids rather than regional_registrations, because
// in A2b, regional_registrations.external_id_value is populated lazily (as each
// sync runs), but device_external_ids has a row for every device from the
// A2b backfill. Using it as the source of truth ensures we don't miss any
// FDA-linked device.
// ─────────────────────────────────────────────────────────────────────────────

export async function bulkSyncAllDevices(): Promise<SyncResult[]> {
  const admin = createAdminClient()

  const { data: fdaIds, error } = await admin
    .from('device_external_ids')
    .select('aletia_id, id_type, id_value')
    .in('id_type', ['fda_k_number', 'fda_de_novo', 'fda_pma'])

  if (error || !fdaIds) {
    console.error('[fdaSync] Could not fetch FDA identifiers for bulk sync:', error?.message)
    return []
  }

  const results: SyncResult[] = []

  for (const row of fdaIds) {
    // 300ms delay between FDA calls to respect openFDA rate limits.
    await new Promise((resolve) => setTimeout(resolve, 300))

    const result = await syncExistingDeviceFromFDA(
      row.aletia_id,
      row.id_value,
      row.id_type as FdaIdType,
    )
    results.push(result)
  }

  return results
}

// ─────────────────────────────────────────────────────────────────────────────
// (3) Discovery / seed — one K-number at a time, through the 4d gate
//
// Called by the PUT /api/fda-sync endpoint when seeding. Each K-number
// returned by openFDA goes through here. New K-numbers create devices;
// known K-numbers update them; ambiguous matches queue for admin review.
// ─────────────────────────────────────────────────────────────────────────────

export async function ingestFdaDevice(
  externalIdValue: string,
  idType: FdaIdType = 'fda_k_number',
): Promise<IngestResult> {
  const admin = createAdminClient()

  // Shape check. openFDA should only produce valid shapes but defend anyway.
  if (idType === 'fda_k_number' && !/^K[0-9]+$/.test(externalIdValue)) {
    await logIngestionAnomaly(admin, {
      source: 'fda_sync',
      anomaly_type: 'unknown_identifier_shape',
      identifier_value: externalIdValue,
      identifier_type_expected: 'fda_k_number',
    })
    return {
      k_number: externalIdValue,
      action: 'failed',
      aletia_id: null,
      error: 'identifier did not match ^K[0-9]+$',
    }
  }

  // Fetch openFDA data up front — the 4d gate needs manufacturer + device
  // name for candidate matching, and we also need classification info before
  // committing to a create.
  const clearanceData = idType === 'fda_k_number'
    ? await get510kByKNumber(externalIdValue)
    : idType === 'fda_pma'
      ? await getPMAByNumber(externalIdValue)
      : null

  if (!clearanceData) {
    return {
      k_number: externalIdValue,
      action: 'failed',
      aletia_id: null,
      error: 'openFDA returned no data',
    }
  }

  // Class I — not our scope. Skip without error.
  const productCode = clearanceData.product_code ?? ''
  const classification = productCode
    ? await getClassificationByProductCode(productCode)
    : null

  if (productCode && !classification) {
    return {
      k_number: externalIdValue,
      action: 'skipped_class_1',
      aletia_id: null,
    }
  }

  // ── 4d gate ──────────────────────────────────────────────────────────────
  const decision = await processExternalIdentifier({
    supabase:    admin,
    id_type:     idType,
    id_value:    externalIdValue,
    jurisdiction: 'US',
    source:      'fda_sync',
    queueSource: 'fda_sync',
    reviewReason: 'possible_merge',
    manufacturerName: clearanceData.applicant ?? null,
    deviceName:       clearanceData.device_name ?? null,
    payload: {
      ...clearanceData,
      fetched_at: new Date().toISOString(),
    },
    autoCreate: true,
    deviceSeed: buildFdaDeviceSeed(clearanceData, classification),
  })

  // ── Post-gate: regional_registrations enrichment for create/update paths ─
  if (decision.action === 'updated_existing' || decision.action === 'created_new') {
    // For a freshly-created device, a regional_registrations row doesn't yet
    // exist. For an updated one, it may or may not. Upsert handles both.
    await admin
      .from('regional_registrations')
      .upsert(
        {
          device_link:       decision.aletia_id,
          country:           'US',
          regulatory_body:   'FDA',
          clearance_type:    clearanceData.clearance_type,
          external_id_value: externalIdValue,
          last_updated:      new Date().toISOString(),
        },
        { onConflict: 'device_link,country,regulatory_body' },
      )

    return {
      k_number: externalIdValue,
      action: decision.action,
      aletia_id: decision.aletia_id,
    }
  }

  if (decision.action === 'queued_for_review' || decision.action === 'already_queued') {
    return {
      k_number: externalIdValue,
      action: decision.action,
      aletia_id: null,
    }
  }

  // action === 'failed'
  return {
    k_number: externalIdValue,
    action: 'failed',
    aletia_id: null,
    error: decision.error,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// device_master seed builder for FDA auto-create path
// ─────────────────────────────────────────────────────────────────────────────

interface FdaClearanceData {
  applicant?: string
  device_name?: string
  clearance_type?: string
  decision_date?: string
  product_code?: string
}

interface FdaClassification {
  device_class?: string
}

function buildFdaDeviceSeed(
  clearance: FdaClearanceData,
  classification: FdaClassification | null,
): Record<string, unknown> {
  const tierMap: Record<string, number> = { '2': 2, '3': 4 }
  const tier = classification?.device_class
    ? tierMap[classification.device_class] ?? 2
    : null

  return {
    // aletia_id omitted — sequence DEFAULT allocates.
    manufacturer_name:   clearance.applicant ?? null,
    name:                clearance.device_name ?? null,
    intended_use:        clearance.device_name ?? null,
    country_of_origin:   'US',
    health_status:       'Green',              // derived properly on next full sync cycle
    aletia_verified:     false,
    approval_status:     'approved',
    data_source:         'registry_sync',
    accountability_tier: tier,
    last_automated_sync: new Date().toISOString(),
    excluded:            false,
    ai_ml_integral:      true,                 // FDA seed path only runs over AI/ML product codes, so this is safe
  }
}
