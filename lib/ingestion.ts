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
//   3. Neither: call create_device_atomic RPC (atomic device_master +
//      device_external_ids insert), return created_new.
//
// This is the "never auto-merge" discipline: the only auto-action is on
// exact identifier match; everything else routes through admin.
//
// Durability of human decisions (25 August):
//   The queue dedup step used to filter `.eq('status', 'pending')`, so it only
//   saw un-actioned rows. Once a human rejected a row (or marked it duplicate),
//   the next run of the same source could not see that decision, fell through
//   to step 3, and inserted a fresh pending row — the same rejected candidate
//   came back on every sweep, forever. The DB does not stop this either: the
//   unique index on (source, source_id) is PARTIAL — `WHERE status = 'pending'`
//   (baseline migration, idx_review_queue_source_id) — so a terminal row and a
//   new pending row happily coexist.
//
//   The dedup now reads the LATEST queue row for (source, source_id) whatever
//   its status, and a terminal decision suppresses re-queueing:
//     pending             → already_queued        (an open row is waiting)
//     rejected|duplicate  → skipped_prior_decision (a human already said no)
//     approved            → skipped_prior_decision + anomaly
//
//   `approved` deserves the anomaly: an approved queue row means a device was
//   created or merged, so step 1 should have matched the identifier. Reaching
//   step 2 with an approved row means the accept did not write this
//   (id_type, id_value) — the Mark-duplicate path is the known benign case
//   (queue disposition only, device_master untouched), a lost external id is
//   the pathological one. Either way, do not re-queue; make it visible.
//
//   Escape hatch: pass reconsiderPriorDecisions = true to ignore terminal rows
//   and queue anyway. For deliberate re-review sweeps (e.g. after the scope
//   rules change), never for routine cron ingest.
//
// Atomicity note (24 April):
//   The create branch used to do device_master.insert() followed by a
//   separate device_external_ids.insert(), which surfaced twice on staging
//   as orphan device_master rows when the second insert failed. The create
//   branch now calls create_device_atomic(...) RPC which wraps both writes
//   (and optionally a device_trials insert) in a single transaction. If any
//   step fails, the whole transaction rolls back.
// =============================================================================

/** Terminal queue statuses — a human has decided; re-queueing would undo that. */
export type PriorQueueDecision = 'approved' | 'rejected' | 'duplicate'

export type IngestDecision =
  | { action: 'updated_existing';   aletia_id: string }
  | { action: 'created_new';        aletia_id: string }
  | { action: 'queued_for_review';  queue_id: string; candidateCount: number }
  | { action: 'already_queued';     queue_id: string }
  | { action: 'skipped_prior_decision'; queue_id: string; prior_status: PriorQueueDecision }
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
   * external_legacy_id defaults to id_value if omitted — the RPC fills it.
   * Callers should include manufacturer_link, manufacturer_name, name,
   * intended_use, data_source, pipeline_stage, approval_status etc.
   *
   * Ignored when autoCreate is false. Can be omitted in that case.
   */
  deviceSeed?: Record<string, unknown>

  /**
   * Optional trial payload for CT.gov-style ingest paths. When present,
   * create_device_atomic inserts a matching device_trials row in the same
   * transaction. Keys must match device_trials columns (see RPC contract).
   *
   * Only meaningful when we're creating a new device. On updated_existing
   * / queued paths, the trial payload is ignored by this helper; the
   * relevant ingest path should handle it separately (via its own UPSERT
   * into device_trials for updated_existing, or the queue row's raw_data
   * for queued_for_review).
   */
  trialSeed?: Record<string, unknown>

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

  /**
   * If true, a terminal queue decision (rejected / duplicate / approved) on
   * this (queueSource, id_value) is ignored and the row may be queued again.
   *
   * Default: false — human decisions are durable. Set true ONLY for a
   * deliberate re-review sweep after the inclusion rules themselves change.
   * Never for routine/cron ingest: that is exactly the loop this flag's
   * default exists to close.
   */
  reconsiderPriorDecisions?: boolean
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
    payload, deviceSeed, trialSeed,
    autoCreate = true,
    reconsiderPriorDecisions = false,
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

  // ── 2. Already queued, or already decided? ────────────────────────────────
  // Dedup by (queueSource, id_value) across ALL statuses — not just pending.
  // The latest row wins: a fresh pending row means work is outstanding, a
  // terminal row means a human already ruled on this identifier. See the
  // "Durability of human decisions" note in the header.
  const { data: queueRows, error: queueLookupErr } = await supabase
    .from('ingestion_review_queue')
    .select('queue_id, status')
    .eq('source',    queueSource)
    .eq('source_id', id_value)
    .order('created_at', { ascending: false })
    .limit(1)

  if (queueLookupErr) {
    return { action: 'failed', error: `queue dedup lookup failed: ${queueLookupErr.message}` }
  }

  const existingQueue = queueRows?.[0] ?? null

  if (existingQueue) {
    const priorStatus = String(existingQueue.status)

    if (priorStatus === 'pending') {
      // An open row is already waiting for review. Never duplicate it, and
      // never treat it as a decision — it is simply outstanding work.
      return { action: 'already_queued', queue_id: existingQueue.queue_id }
    }

    if (!reconsiderPriorDecisions) {
      // 'approved' here is an integrity signal, not a routine skip: an approved
      // row should have produced a device_external_ids entry that step 1 would
      // have matched. Log it, then suppress like any other terminal decision.
      if (priorStatus === 'approved') {
        await logIngestionAnomaly(supabase, {
          source:                   queueSource,
          anomaly_type:             'unexpected_field_value',
          identifier_value:         id_value,
          identifier_type_expected: id_type,
          context: {
            phase:    'queue_dedup',
            reason:   'approved queue row exists but identifier has no device_external_ids entry',
            queue_id: existingQueue.queue_id,
            note:     'benign if the row was accepted as a merge/duplicate; investigate otherwise',
          },
        })
      }

      return {
        action:       'skipped_prior_decision',
        queue_id:     existingQueue.queue_id,
        prior_status: priorStatus as PriorQueueDecision,
      }
    }
    // reconsiderPriorDecisions === true → fall through and queue again.
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
  //     Call create_device_atomic RPC. It does device_master insert +
  //     device_external_ids insert (+ optional device_trials insert) in a
  //     single transaction. Atomic. If anything fails, all roll back.
  if (!deviceSeed) {
    // Sanity check: with autoCreate=true we expect a deviceSeed. Not passing
    // one is a programming error.
    return {
      action: 'failed',
      error: 'autoCreate=true but deviceSeed was not provided',
    }
  }

  const { data: newAletiaId, error: rpcErr } = await supabase.rpc(
    'create_device_atomic',
    {
      p_device:      deviceSeed,
      p_external_id: {
        id_type,
        id_value,
        jurisdiction,
        source,
        is_primary: true,
      },
      p_trial:       trialSeed ?? null,
    },
  )

  if (rpcErr || !newAletiaId) {
    // The RPC rolled the transaction back; no orphan row exists. Surface the
    // error to the caller. Unique-violation on (id_type, id_value) comes
    // through as SQLSTATE 23505 in rpcErr.code — callers may want to map
    // that to a user-facing "identifier already belongs to another device"
    // error, but at this layer it's just another failure.
    const msg = rpcErr?.message ?? 'create_device_atomic returned null'

    // Log anomaly so we can see patterns of RPC failures in ingestion_anomalies.
    await logIngestionAnomaly(supabase, {
      source:                   queueSource,
      anomaly_type:             'classification_failed',
      identifier_value:         id_value,
      identifier_type_expected: id_type,
      context: {
        error:        msg,
        error_code:   (rpcErr as { code?: string } | null)?.code ?? null,
        phase:        'create_device_atomic',
      },
    })

    return { action: 'failed', error: `create_device_atomic failed: ${msg}` }
  }

  // RPC returns text (the new aletia_id) as RETURNS text; Supabase SDK gives
  // us a string directly. Defensive cast in case a future shape change makes
  // it an object.
  const aletiaId = typeof newAletiaId === 'string' ? newAletiaId : String(newAletiaId)

  return { action: 'created_new', aletia_id: aletiaId }
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
