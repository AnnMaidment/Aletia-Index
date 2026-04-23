import { SupabaseClient } from '@supabase/supabase-js'
import { findMergeCandidates } from './matchingCandidates'
import type { ExternalIdType, AnomalyType } from './types'

// =============================================================================
// Shared 4d-gate helper for ingest paths (Workstream A2b)
//
// Every ingest path that discovers an external identifier (K-number, MHRA ID,
// NCT, etc.) goes through the same decision tree:
//
//   1. Is (id_type, id_value) already in device_external_ids?
//      → YES: update last_seen_at, return updated_existing with aletia_id
//
//   2. Are there merge candidates (manufacturer match + Dice on device name)?
//      → YES: insert a queue row with possible_merge_candidates populated,
//             return queued_for_review. Admin decides.
//
//   3. Neither: insert a new device_master row (aletia_id auto-allocated),
//      insert primary device_external_ids row, return created_new.
//
// This is the "never auto-merge" discipline: the only auto-action is on
// exact identifier match; everything else routes through admin.
// =============================================================================

export type IngestDecision =
  | { action: 'updated_existing';   aletia_id: string }
  | { action: 'created_new';        aletia_id: string }
  | { action: 'queued_for_review';  queue_id: string; candidateCount: number }
  | { action: 'already_queued';     queue_id: string }
  | { action: 'failed';             error: string }

export interface ProcessExternalIdentifierInput {
  supabase: SupabaseClient

  // The external identifier we're processing.
  id_type:       ExternalIdType
  id_value:      string
  jurisdiction:  string | null

  // Provenance — what ingest path called this, and what queue source/reason to use if we queue.
  source:        string              // for device_external_ids.source, e.g. 'ct_gov_ingest'
  queueSource:   string              // for ingestion_review_queue.source, e.g. 'clinical_trials'
  reviewReason:  string              // for ingestion_review_queue.review_reason, e.g. 'possible_merge'

  // Matching signals — passed through to findMergeCandidates.
  manufacturerName: string | null
  deviceName:       string | null

  // For the queue row's raw_data, and generally for debugging.
  payload:       unknown

  /**
   * Fields to insert into device_master when creating a new device.
   * aletia_id is auto-allocated by the DB default; don't include it here.
   * Callers should include manufacturer_link, manufacturer_name, name,
   * intended_use, data_source, pipeline_stage, approval_status etc. — the
   * shape that their source naturally populates.
   *
   * Ignored when autoCreate is false. Can be omitted in that case.
   */
  deviceSeed?: Record<string, unknown>

  /**
   * If false, the "no hit, no candidates" branch queues for review instead
   * of auto-creating. Used by paths where new devices shouldn't spring into
   * existence without admin review (e.g. CT.gov academic sponsors —
   * a hospital running a trial on a commercial device shouldn't cause a
   * brand-new device row to appear).
   *
   * Default: true (the normal 4d behaviour).
   */
  autoCreate?: boolean
}

/**
 * Core 4d-gate entry point. Never throws; always returns an IngestDecision.
 * Errors during DB operations return { action: 'failed', error }.
 */
export async function processExternalIdentifier(
  input: ProcessExternalIdentifierInput
): Promise<IngestDecision> {
  const {
    supabase,
    id_type, id_value, jurisdiction,
    source, queueSource, reviewReason,
    manufacturerName, deviceName,
    payload, deviceSeed,
    autoCreate = true,
  } = input

  // Basic shape assertion — never proceed with an empty id_value.
  if (!id_value || !id_value.trim()) {
    return { action: 'failed', error: 'empty id_value' }
  }

  // ── 1. Exact identifier match? ────────────────────────────────────────────
  const { data: hit, error: hitErr } = await supabase
    .from('device_external_ids')
    .select('aletia_id')
    .eq('id_type',  id_type)
    .eq('id_value', id_value)
    .limit(1)
    .maybeSingle()

  if (hitErr) {
    return { action: 'failed', error: `device_external_ids lookup failed: ${hitErr.message}` }
  }

  if (hit) {
    // Update last_seen_at so we can tell how fresh our knowledge of this ID is.
    const { error: updateErr } = await supabase
      .from('device_external_ids')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id_type',  id_type)
      .eq('id_value', id_value)

    if (updateErr) {
      // Non-fatal — we still know the aletia_id, caller can proceed.
      console.warn(`[ingestion] last_seen_at bump failed for ${id_type}/${id_value}:`, updateErr.message)
    }

    return { action: 'updated_existing', aletia_id: hit.aletia_id }
  }

  // ── 2. Already queued for review? (dedup by queueSource + id_value) ───────
  const { data: existingQueue, error: queueLookupErr } = await supabase
    .from('ingestion_review_queue')
    .select('queue_id')
    .eq('source',    queueSource)
    .eq('source_id', id_value)
    .eq('status',    'pending')      // only dedup against un-actioned queue rows
    .limit(1)
    .maybeSingle()

  if (queueLookupErr) {
    return { action: 'failed', error: `queue dedup lookup failed: ${queueLookupErr.message}` }
  }

  if (existingQueue) {
    return { action: 'already_queued', queue_id: existingQueue.queue_id }
  }

  // ── 3. Compute merge candidates ───────────────────────────────────────────
  const candidates = await findMergeCandidates({
    manufacturerName,
    deviceName,
    supabase,
  })

  // ── 3a. Candidates found → queue for admin review ────────────────────────
  // ── 3b. Or autoCreate is false → always queue at this point ──────────────
  if (candidates.length > 0 || !autoCreate) {
    const { data: queueRow, error: queueErr } = await supabase
      .from('ingestion_review_queue')
      .insert({
        source: queueSource,
        source_id: id_value,
        device_name: deviceName,
        manufacturer: manufacturerName,
        raw_data: payload,
        review_reason: reviewReason,
        possible_merge_candidates: candidates.length > 0 ? candidates : null,
        status: 'pending',
      })
      .select('queue_id')
      .single()

    if (queueErr || !queueRow) {
      return {
        action: 'failed',
        error: `queue insert failed: ${queueErr?.message ?? 'unknown'}`,
      }
    }

    return {
      action: 'queued_for_review',
      queue_id: queueRow.queue_id,
      candidateCount: candidates.length,
    }
  }

  // ── 4. No hit, no candidates, autoCreate allowed → create new device ─────
  //     device_master.aletia_id is auto-allocated via the sequence DEFAULT.
  //     Do NOT include aletia_id in deviceSeed.
  if (!deviceSeed) {
    // Sanity check: with autoCreate=true we expect a deviceSeed. Not passing
    // one is a programming error.
    return {
      action: 'failed',
      error: 'autoCreate=true but deviceSeed was not provided',
    }
  }

  const { data: newDevice, error: createErr } = await supabase
    .from('device_master')
    .insert(deviceSeed)
    .select('aletia_id')
    .single()

  if (createErr || !newDevice) {
    return {
      action: 'failed',
      error: `device_master insert failed: ${createErr?.message ?? 'unknown'}`,
    }
  }

  const { error: extIdErr } = await supabase
    .from('device_external_ids')
    .insert({
      aletia_id:     newDevice.aletia_id,
      id_type,
      id_value,
      jurisdiction,
      is_primary:    true,
      source,
    })

  if (extIdErr) {
    // This is bad — we created a device but couldn't attach its primary ID.
    // Could arguably be a hard error, but we have an aletia_id and the device
    // is in the DB. Surface loudly and let caller decide.
    console.error(
      `[ingestion] CRITICAL: created device_master ${newDevice.aletia_id} ` +
      `but failed to insert primary device_external_ids row (${id_type}/${id_value}): ${extIdErr.message}`
    )
    await logIngestionAnomaly(supabase, {
      source: queueSource,
      anomaly_type: 'classification_failed',
      identifier_value: id_value,
      identifier_type_expected: id_type,
      context: { error: extIdErr.message, aletia_id: newDevice.aletia_id },
      aletia_id: newDevice.aletia_id,
    })
  }

  return { action: 'created_new', aletia_id: newDevice.aletia_id }
}

// =============================================================================
// Anomaly logging — write to ingestion_anomalies
//
// Callers use this whenever they encounter data they can't classify, parse,
// or expect. Intentionally fire-and-forget: if the anomaly log itself fails,
// we log to console and keep going. Losing an anomaly is better than halting
// a production sync.
// =============================================================================

export interface LogAnomalyInput {
  source:                    string
  anomaly_type:              AnomalyType
  identifier_value?:         string | null
  identifier_type_expected?: string | null
  context?:                  Record<string, unknown> | null
  aletia_id?:                string | null
}

export async function logIngestionAnomaly(
  supabase: SupabaseClient,
  input: LogAnomalyInput,
): Promise<void> {
  const { error } = await supabase
    .from('ingestion_anomalies')
    .insert({
      source:                   input.source,
      anomaly_type:             input.anomaly_type,
      identifier_value:         input.identifier_value ?? null,
      identifier_type_expected: input.identifier_type_expected ?? null,
      context:                  input.context ?? null,
      aletia_id:                input.aletia_id ?? null,
    })

  if (error) {
    console.warn(
      `[ingestion-anomaly-log-failed] source=${input.source} type=${input.anomaly_type}: ${error.message}`
    )
  }
}
