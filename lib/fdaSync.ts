/**
 * lib/fdaSync.ts — FDA discovery rebuild (June 2026)
 *
 * Three entry points, reflecting the three things FDA ingest actually does:
 *
 *   1. syncExistingDeviceFromFDA(aletiaId, externalIdValue, idType)
 *      Refresh an existing device's FDA-derived fields. Used when we already
 *      know which aletia_id maps to which identifier — no identity gating.
 *      (Now applies the graduation rule — BUG-010 — on clearance.)
 *
 *   2. bulkSyncAllDevices()
 *      Walk device_external_ids (fda_k_number / fda_de_novo / fda_pma rows),
 *      call #1 for each. This is what the scheduled bulk sync calls.
 *
 *   3. ingestFdaDevice(input: FdaIngestInput)
 *      Process a discovered identifier (K… / DEN… / P…) through the 4d gate.
 *      Used by the rebuilt discovery path (PUT /api/fda-sync). Takes the
 *      already-known fields from the FDA published list OR the supplementary
 *      sweep, so it does NOT re-fetch clearance data per device, and it now
 *      handles De Novo (which has no openFDA single-record lookup).
 *
 * Rebuild changes (June 2026):
 *   - ingestFdaDevice signature changed from (kNumber, idType) to (input):
 *     it now accepts list-/sweep-provided device fields + a list-membership
 *     flag + a provenance source. The ONLY caller is the PUT discovery handler.
 *     (grep `ingestFdaDevice(` before committing to confirm.)
 *   - buildFdaDeviceSeed no longer writes device_name into intended_use, and
 *     ai_ml_integral is set from list membership (was blanket-true).
 *   - Graduation rule: a recorded clearance sets pipeline_stage = null.
 *   - On-list devices auto-create; sweep-only devices route to review
 *     (autoCreate=false) rather than auto-creating — they are not list-
 *     confirmed AI, so they must not spring into the curated index.
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
  identifier: string
  action: 'updated_existing' | 'created_new' | 'queued_for_review' | 'already_queued' | 'failed' | 'skipped_class_1'
  aletia_id: string | null
  error?: string
}

type FdaIdType = 'fda_k_number' | 'fda_de_novo' | 'fda_pma'

/**
 * Normalised discovery input. The FDA list seed and the supplementary sweep
 * both produce these — fully populated — so ingest does not re-fetch openFDA
 * per device. `onList` drives ai_ml_integral and the auto-create policy.
 */
export interface FdaIngestInput {
  identifier: string
  id_type: FdaIdType
  device_name?: string | null
  applicant?: string | null
  product_code?: string | null
  decision_date?: string | null
  clearance_type?: '510k' | 'De Novo' | 'PMA'
  /** Membership of the FDA published AI/ML list. */
  onList: boolean
  /** Provenance for device_external_ids.source. */
  source: 'fda_list' | 'fda_sweep'
}

// Identifier shape guards, per pathway.
const ID_SHAPE: Record<FdaIdType, RegExp> = {
  fda_k_number: /^K\d+/i,
  fda_de_novo:  /^DEN\d+/i,
  fda_pma:      /^P\d+/i,
}

const CLEARANCE_TYPE_BY_ID: Record<FdaIdType, '510k' | 'De Novo' | 'PMA'> = {
  fda_k_number: '510k',
  fda_de_novo:  'De Novo',
  fda_pma:      'PMA',
}

// Classification is keyed by product_code and effectively immutable across a
// run; cache it so a 1,451-device list seed makes ~85 lookups, not ~1,451.
const classificationCache = new Map<string, Awaited<ReturnType<typeof getClassificationByProductCode>>>()

async function classifyProductCode(productCode: string) {
  if (!productCode) return null
  if (classificationCache.has(productCode)) return classificationCache.get(productCode)!
  const result = await getClassificationByProductCode(productCode)
  classificationCache.set(productCode, result)
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Health status derivation — unchanged
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
//     (now applies the graduation rule on clearance — BUG-010)
// ─────────────────────────────────────────────────────────────────────────────

export async function syncExistingDeviceFromFDA(
  aletiaId: string,
  externalIdValue: string,
  idType: FdaIdType,
): Promise<SyncResult> {
  const admin = createAdminClient()
  const updatedFields: string[] = []

  try {
    const clearanceData = idType === 'fda_k_number'
      ? await get510kByKNumber(externalIdValue)
      : idType === 'fda_pma'
        ? await getPMAByNumber(externalIdValue)
        : null   // De Novo: no dedicated openFDA lookup, fall through to defaults

    const productCode = clearanceData?.product_code ?? ''
    const classification = productCode ? await classifyProductCode(productCode) : null

    if (productCode && !classification) {
      return {
        aletia_id: aletiaId,
        success: false,
        updated_fields: [],
        recall_alert: false,
        error: 'Device is Class I — out of scope for Aletia Index',
      }
    }

    const recalls = idType === 'fda_k_number'
      ? await getRecallsByKNumber(externalIdValue)
      : []

    const hasActiveRecall = recalls.some((r) => r.status?.toLowerCase() === 'ongoing')

    const deviceName = clearanceData?.device_name ?? aletiaId
    const { total_events } = await getAdverseEventCount(deviceName)

    const health_status = deriveHealthStatus(hasActiveRecall, total_events)

    const deviceUpdate: Record<string, unknown> = {
      health_status,
      last_automated_sync: new Date().toISOString(),
      // Graduation rule (BUG-010 / B4): recording an FDA clearance means the
      // device has a regulatory approval, so it is no longer in pipeline.
      pipeline_stage: null,
    }
    updatedFields.push('pipeline_stage')

    if (clearanceData?.applicant) {
      deviceUpdate.manufacturer_name = clearanceData.applicant
      updatedFields.push('manufacturer_name')
    }

    if (clearanceData?.device_name) {
      deviceUpdate.name = clearanceData.device_name
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

    // Fill intended_use only if it's currently null. (We no longer seed
    // intended_use with the device name; this leaves room for a real source.)
    if (clearanceData?.device_name) {
      await admin
        .from('device_master')
        .update({ intended_use: clearanceData.device_name })
        .eq('aletia_id', aletiaId)
        .is('intended_use', null)
    }

    if (clearanceData) {
      const regRecord = {
        device_link:       aletiaId,
        country:           'US',
        regulatory_body:   'FDA',
        clearance_type:    clearanceData.clearance_type,
        external_id_value: externalIdValue,
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
// (2) Bulk re-sync — walk device_external_ids (unchanged)
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
// (3) Discovery / seed — one identifier at a time, through the 4d gate
//
// Called by PUT /api/fda-sync. The FDA list seed and the supplementary sweep
// both produce FdaIngestInput records (fully populated), so this no longer
// re-fetches clearance data per device. It still classifies the product code
// (cached) for the Class-I filter and accountability tier.
// ─────────────────────────────────────────────────────────────────────────────

export async function ingestFdaDevice(input: FdaIngestInput): Promise<IngestResult> {
  const admin = createAdminClient()
  const { identifier, id_type, onList, source } = input

  // ── Shape check ──────────────────────────────────────────────────────────
  if (!identifier || !ID_SHAPE[id_type].test(identifier)) {
    await logIngestionAnomaly(admin, {
      source: 'fda_sync',
      anomaly_type: 'unknown_identifier_shape',
      identifier_value: identifier,
      identifier_type_expected: id_type,
    })
    return {
      identifier,
      action: 'failed',
      aletia_id: null,
      error: `identifier did not match expected shape for ${id_type}`,
    }
  }

  // ── Resolve device fields. Prefer the provided (list/sweep) data; only fall
  //    back to an openFDA lookup if fields are missing AND a lookup exists.
  //    De Novo has no lookup — it must arrive fully populated (the list does). ─
  let device_name = input.device_name ?? null
  let applicant = input.applicant ?? null
  let product_code = input.product_code ?? null
  const decision_date = input.decision_date ?? null

  if ((!device_name || !product_code) && id_type !== 'fda_de_novo') {
    const fetched = id_type === 'fda_pma'
      ? await getPMAByNumber(identifier)
      : await get510kByKNumber(identifier)
    if (fetched) {
      device_name = device_name ?? fetched.device_name
      applicant = applicant ?? fetched.applicant
      product_code = product_code ?? fetched.product_code
    }
  }

  if (!product_code) {
    // No product code → can't classify → can't tier or Class-I filter.
    // For a De Novo with no provided code this is a data gap, not a crash.
    await logIngestionAnomaly(admin, {
      source: 'fda_sync',
      anomaly_type: 'classification_failed',
      identifier_value: identifier,
      identifier_type_expected: id_type,
      context: { reason: 'no product_code available', source },
    })
  }

  // ── Class I filter / classification (cached per product code) ─────────────
  const classification = product_code ? await classifyProductCode(product_code) : null
  if (product_code && !classification) {
    return { identifier, action: 'skipped_class_1', aletia_id: null }
  }

  const clearance_type = input.clearance_type ?? CLEARANCE_TYPE_BY_ID[id_type]

  const payload = {
    identifier,
    id_type,
    device_name,
    applicant,
    product_code,
    decision_date,
    clearance_type,
    on_fda_list: onList,
    source,
    fetched_at: new Date().toISOString(),
  }

  // ── 4d gate ────────────────────────────────────────────────────────────────
  // On-list devices are FDA-confirmed AI → auto-create. Sweep-only devices are
  // NOT list-confirmed → autoCreate=false routes any no-match to review rather
  // than minting an unconfirmed device into the curated index.
  const decision = await processExternalIdentifier({
    supabase:     admin,
    id_type,
    id_value:     identifier,
    jurisdiction: 'US',
    source,
    queueSource:  'fda_sync',
    // Reuse the production-proven review_reason value. A dedicated reason like
    // 'sweep_unconfirmed_ai' would label sweep finds more precisely, but only
    // adopt it after confirming ingestion_review_queue.review_reason has no
    // CHECK constraint that would reject a new value.
    reviewReason: 'possible_merge',
    manufacturerName: applicant,
    deviceName:       device_name,
    payload,
    autoCreate:  onList,
    deviceSeed:  buildFdaDeviceSeed(
      { applicant, device_name, clearance_type, decision_date, product_code },
      classification,
      { aiMlIntegral: onList },
    ),
  })

  // ── Post-gate enrichment for create/update paths ──────────────────────────
  if (decision.action === 'updated_existing' || decision.action === 'created_new') {
    await admin
      .from('regional_registrations')
      .upsert(
        {
          device_link:       decision.aletia_id,
          country:           'US',
          regulatory_body:   'FDA',
          clearance_type,
          external_id_value: identifier,
          last_updated:      new Date().toISOString(),
        },
        { onConflict: 'device_link,country,regulatory_body' },
      )

    // Graduation rule (BUG-010): recording a clearance graduates the device
    // out of pipeline. Applied on the update path too (create path sets it via
    // the seed). Never touches ai_ml_integral, so a list-confirmed device is
    // not downgraded by a later sweep hit.
    if (decision.action === 'updated_existing') {
      await admin
        .from('device_master')
        .update({ pipeline_stage: null })
        .eq('aletia_id', decision.aletia_id)
    }

    return { identifier, action: decision.action, aletia_id: decision.aletia_id }
  }

  if (decision.action === 'queued_for_review' || decision.action === 'already_queued') {
    return { identifier, action: decision.action, aletia_id: null }
  }

  return { identifier, action: 'failed', aletia_id: null, error: decision.error }
}

// ─────────────────────────────────────────────────────────────────────────────
// device_master seed builder for FDA auto-create path
// ─────────────────────────────────────────────────────────────────────────────

interface FdaClearanceData {
  applicant?: string | null
  device_name?: string | null
  clearance_type?: string | null
  decision_date?: string | null
  product_code?: string | null
}

interface FdaClassification {
  device_class?: string
}

function buildFdaDeviceSeed(
  clearance: FdaClearanceData,
  classification: FdaClassification | null,
  opts: { aiMlIntegral: boolean },
): Record<string, unknown> {
  const tierMap: Record<string, number> = { '2': 2, '3': 4 }
  const tier = classification?.device_class
    ? tierMap[classification.device_class] ?? 2
    : null

  return {
    // aletia_id omitted — sequence DEFAULT allocates.
    manufacturer_name:   clearance.applicant ?? null,
    name:                clearance.device_name ?? null,
    // FIX: do NOT mirror the device name into intended_use. Leave it null for a
    // real source (FDA Indications-for-Use sourcing lands after the prune).
    intended_use:        null,
    country_of_origin:   'US',
    health_status:       'Green',              // derived properly on next full sync
    aletia_verified:     false,
    approval_status:     'approved',
    data_source:         'registry_sync',
    accountability_tier: tier,
    last_automated_sync: new Date().toISOString(),
    excluded:            false,
    // Graduation rule on the create path: a cleared/approved device is not in
    // pipeline.
    pipeline_stage:      null,
    // FIX: list membership, not a blanket true. Sweep-only devices reach the
    // create path only via admin promotion; auto-discovery sets this from
    // onList (false for sweep-only, which are queued, not auto-created).
    ai_ml_integral:      opts.aiMlIntegral,
  }
}
