/**
 * lib/breakthroughIngest.ts — A2b rewrite
 *
 * FDA Breakthrough marketing-authorisations ingest — enriches existing
 * device_master rows with breakthrough_designation = true, or creates new
 * pre-approval listings for companies we haven't seen yet.
 *
 * Key A2b changes:
 *   - ulid() synthesis is gone. New pre-approval devices are created via the
 *     create_device_atomic RPC (atomic device_master + device_external_ids
 *     insert). The identifier is a synthetic legacy_unclassified value
 *     `BREAKTHROUGH:{applicant}__{trade-name}` that a subsequent FDA-sync
 *     match will merge into via the 4d gate once the device lands a real
 *     K-number.
 *   - findMergeCandidates replaces the old ad-hoc findExistingDevice loop.
 *     Same signal (manufacturer exact + Dice on device name) but in one
 *     shared service instead of two divergent implementations.
 *   - Medium-confidence manufacturer matches with a strong name-Dice hit
 *     now enrich the existing device; previously they were always queued.
 *   - Rows with no matches go through the same review queue as every other
 *     ingest path, with possible_merge_candidates populated for context.
 *
 * Source: https://www.fda.gov/media/108305/download
 * Column headers change occasionally — see normalizeRow for tolerated aliases.
 */

import * as XLSX from 'xlsx'
import { createAdminClient } from './supabase-admin'
import { matchManufacturer } from './matchManufacturer'
import { findMergeCandidates } from './matchingCandidates'
import { logIngestionAnomaly } from './ingestion'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const FDA_EXCEL_URL = 'https://www.fda.gov/media/108305/download'

// Name-Dice threshold above which we treat a medium-confidence manufacturer
// match as strong enough to enrich the candidate without admin review. Tuned
// conservatively — the 4d-gate confidence bands in matchingCandidates use
// 0.85 as the high-confidence ceiling for medium-mfg matches, so we align.
const ENRICH_DICE_THRESHOLD = 0.85

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface FDABreakthroughRow {
  applicantName:     string
  deviceTradeName:   string
  deviceDescription: string
  indication:        string
  dateGranted:       string | null
  submissionType:    string
}

export interface BreakthroughIngestResult {
  total:               number
  enrichedExisting:    number
  createdPreApproval:  number
  queuedForReview:     number
  skippedNoMfgName:    number
  errors:              string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function runBreakthroughIngest(): Promise<BreakthroughIngestResult> {
  const supabase = createAdminClient()

  const result: BreakthroughIngestResult = {
    total:               0,
    enrichedExisting:    0,
    createdPreApproval:  0,
    queuedForReview:     0,
    skippedNoMfgName:    0,
    errors:              [],
  }

  // ── Step 1: Download and parse the FDA Excel file ───────────────────────
  let rows: FDABreakthroughRow[]
  try {
    rows = await fetchFDAExcel()
  } catch (err) {
    result.errors.push(`Failed to fetch FDA Excel: ${String(err)}`)
    return result
  }

  result.total = rows.length
  console.log(`[breakthrough-ingest] Fetched ${rows.length} rows from FDA`)

  // ── Step 2: Process each row ────────────────────────────────────────────
  for (const row of rows) {
    try {
      await processRow(row, supabase, result)
    } catch (err) {
      result.errors.push(
        `Error processing "${row.deviceTradeName}" (${row.applicantName}): ${String(err)}`,
      )
    }
  }

  console.log('[breakthrough-ingest] Complete:', result)
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Row processor — A2b: 4d gate for identity, UPDATE for enrichment
// ─────────────────────────────────────────────────────────────────────────────

async function processRow(
  row: FDABreakthroughRow,
  supabase: ReturnType<typeof createAdminClient>,
  result: BreakthroughIngestResult,
): Promise<void> {
  const designationDate = parseDate(row.dateGranted)

  // Skip rows without a manufacturer name — can't do anything useful.
  if (!row.applicantName.trim()) {
    result.skippedNoMfgName++
    await logIngestionAnomaly(supabase, {
      source:       'fda_breakthrough',
      anomaly_type: 'missing_required_field',
      context: { row, reason: 'empty applicantName' },
    })
    return
  }

  // ── Match manufacturer ──────────────────────────────────────────────────
  const manufacturerMatch = await matchManufacturer(row.applicantName, supabase)

  // No manufacturer match at all → queue for manual review (admin may add
  // the manufacturer, then merge the queue entry into a created device).
  if (!manufacturerMatch) {
    await queueForReview(row, supabase, 'no_manufacturer_match', null)
    result.queuedForReview++
    return
  }

  // ── Find merge candidates via the shared 4d service ─────────────────────
  // Returns scored candidates (high/medium/low). We use this both to detect
  // existing devices to enrich AND to populate possible_merge_candidates on
  // review queue rows.
  const candidates = await findMergeCandidates({
    supabase,
    manufacturerName: row.applicantName,
    deviceName:       row.deviceTradeName,
  })

  // ── Enrichment path: strong candidate → UPDATE its breakthrough fields ──
  // A high-confidence candidate is mfr-exact + Dice > 0.85 — that's the same
  // signal the old findExistingDevice loop was ineptly approximating.
  const topCandidate = candidates[0]
  const canEnrichDirectly =
    topCandidate !== undefined &&
    (
      topCandidate.confidence === 'high'
      ||
      // Medium-mfg + strong name-Dice: safe to enrich. The 4d gate treats
      // this as medium overall, but for enrichment (append-only) the risk
      // is bounded: worst case we flag a sibling device as breakthrough,
      // which admin can revert via Module 3 later.
      (
        topCandidate.matched_on.manufacturer === 'medium'
        &&
        topCandidate.matched_on.device_name_dice >= ENRICH_DICE_THRESHOLD
      )
    )

  if (canEnrichDirectly) {
    const { error } = await supabase
      .from('device_master')
      .update({
        breakthrough_designation:      true,
        breakthrough_designation_date: designationDate,
      })
      .eq('aletia_id', topCandidate.aletia_id)

    if (error) {
      result.errors.push(
        `Enrich failed for ${topCandidate.aletia_id} (${row.deviceTradeName}): ${error.message}`,
      )
      return
    }
    result.enrichedExisting++
    return
  }

  // ── Candidates but none strong enough → queue with candidate list ───────
  if (candidates.length > 0) {
    await queueForReview(row, supabase, 'possible_merge', candidates)
    result.queuedForReview++
    return
  }

  // ── No candidates at all. High-confidence mfg → create new listing. ─────
  // Medium/low mfg + no device candidates → queue.
  if (manufacturerMatch.confidence !== 'high') {
    await queueForReview(row, supabase, 'low_confidence_no_device_match', null)
    result.queuedForReview++
    return
  }

  // ── Create new pre-approval listing atomically ──────────────────────────
  await createPreApprovalListing(row, manufacturerMatch.id, designationDate, supabase, result)
}

// ─────────────────────────────────────────────────────────────────────────────
// Create a new pre-approval listing via the atomicity RPC
// ─────────────────────────────────────────────────────────────────────────────
//
// We don't have a real external identifier at designation time (no K-number
// until a 510(k) is filed). Use a synthetic legacy_unclassified value so
// device_external_ids always has a primary row per the app-level invariant.
// When the device later lands a real K-number via fdaSync, the 4d gate will
// match it as a merge candidate (manufacturer + name Dice) and admin can
// merge the new K-number in — the synthetic identifier stays as a historical
// breakthrough-marker, is_primary gets updated to the K-number.

async function createPreApprovalListing(
  row:             FDABreakthroughRow,
  manufacturerId:  string,
  designationDate: string | null,
  supabase:        ReturnType<typeof createAdminClient>,
  result:          BreakthroughIngestResult,
): Promise<void> {
  const syntheticId =
    `BREAKTHROUGH:${sanitise(row.applicantName)}__${sanitise(row.deviceTradeName)}`

  const { data: newAletiaId, error } = await supabase.rpc('create_device_atomic', {
    p_device: {
      manufacturer_link:             manufacturerId,
      manufacturer_name:             row.applicantName,
      name:                          row.deviceTradeName,
      intended_use:                  row.deviceTradeName,
      approval_status:               'pre_approval',
      data_source:                   'aletia_research',
      pipeline_stage:                'pre_submission',
      health_status:                 'Amber',
      ai_ml_integral:                true,
      breakthrough_designation:      true,
      breakthrough_designation_date: designationDate,
    },
    p_external_id: {
      id_type:    'legacy_unclassified',
      id_value:   syntheticId,
      source:     'fda_breakthrough',
      is_primary: true,
    },
    p_trial: null,
  })

  if (error || !newAletiaId) {
    result.errors.push(
      `createPreApprovalListing failed for "${row.deviceTradeName}" (${row.applicantName}): ${error?.message ?? 'unknown'}`,
    )
    await logIngestionAnomaly(supabase, {
      source:                   'fda_breakthrough',
      anomaly_type:             'classification_failed',
      identifier_value:         syntheticId,
      identifier_type_expected: 'legacy_unclassified',
      context: { error: error?.message, row },
    })
    return
  }

  result.createdPreApproval++
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue a row for admin review, with optional candidate list attached
// ─────────────────────────────────────────────────────────────────────────────

async function queueForReview(
  row:        FDABreakthroughRow,
  supabase:   ReturnType<typeof createAdminClient>,
  reason:     string,
  candidates: Awaited<ReturnType<typeof findMergeCandidates>> | null,
): Promise<void> {
  // Dedup against an already-queued pending row with the same synthetic source_id.
  const syntheticSourceId =
    `${sanitise(row.applicantName)}__${sanitise(row.deviceTradeName)}`

  const { data: existing } = await supabase
    .from('ingestion_review_queue')
    .select('queue_id')
    .eq('source',    'fda_breakthrough')
    .eq('source_id', syntheticSourceId)
    .eq('status',    'pending')
    .limit(1)
    .maybeSingle()

  if (existing) {
    // Already queued — update the candidates field in case they shifted, but
    // don't create a duplicate.
    if (candidates && candidates.length > 0) {
      await supabase
        .from('ingestion_review_queue')
        .update({ possible_merge_candidates: candidates })
        .eq('queue_id', existing.queue_id)
    }
    return
  }

  const { error } = await supabase
    .from('ingestion_review_queue')
    .insert({
      source:                    'fda_breakthrough',
      source_id:                 syntheticSourceId,
      device_name:               row.deviceTradeName,
      manufacturer:              row.applicantName,
      raw_data:                  { ...row, review_reason: reason },
      review_reason:             reason,
      possible_merge_candidates: candidates && candidates.length > 0 ? candidates : null,
      status:                    'pending',
    })

  if (error) throw error
}

// ─────────────────────────────────────────────────────────────────────────────
// FDA Excel fetch & parse
// ─────────────────────────────────────────────────────────────────────────────

async function fetchFDAExcel(): Promise<FDABreakthroughRow[]> {
  const response = await fetch(FDA_EXCEL_URL, {
    headers: { 'User-Agent': 'Aletia-Ingest/1.0' },
  })

  if (!response.ok) {
    throw new Error(`FDA fetch failed: ${response.status} ${response.statusText}`)
  }

  const buffer = await response.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

  return raw.map((r) => normalizeRow(r))
}

// The FDA column headers change occasionally — map by likely names.
function normalizeRow(r: Record<string, unknown>): FDABreakthroughRow {
  const get = (...keys: string[]): string => {
    for (const k of keys) {
      const val = r[k] ?? r[k.toLowerCase()] ?? r[k.toUpperCase()]
      if (val && typeof val === 'string' && val.trim()) return val.trim()
    }
    return ''
  }

  return {
    applicantName:     get('Applicant Name', 'Applicant', 'Company Name', 'Company'),
    deviceTradeName:   get('Device Trade Name', 'Trade Name', 'Device Name', 'Product Name'),
    deviceDescription: get('Device Description', 'Description'),
    indication:        get('Indication', 'Indication for Use', 'Intended Use'),
    dateGranted:       get('Date Granted', 'Date', 'Granted Date') || null,
    submissionType:    get('Submission Type', 'Type'),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseDate(raw: string | null): string | null {
  if (!raw) return null
  const d = new Date(raw)
  if (isNaN(d.getTime())) return null
  return d.toISOString().split('T')[0] // YYYY-MM-DD
}

// Sanitise for use in a synthetic identifier — drop whitespace and quotes,
// keep the string stable so repeated ingests of the same row map to the same
// value (idempotent).
function sanitise(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\s"'\\/]+/g, '_')
    .replace(/[^a-z0-9_.-]/g, '')
    .slice(0, 80)
}
