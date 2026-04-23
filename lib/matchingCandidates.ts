import { SupabaseClient } from '@supabase/supabase-js'
import { matchManufacturer, stringSimilarity } from './matchManufacturer'
import type {
  MergeCandidate,
  MergeCandidateConfidence,
  ExternalIdType,
} from './types'

// =============================================================================
// Merge candidate suggestion service (Workstream A2b — 4d gate)
//
// Given an incoming manufacturer + device name + payload, return a scored
// list of existing devices in device_master that might be the same device.
//
// The logic is deliberately conservative: we never auto-merge on anything
// but exact (id_type, id_value) match. This service's output is suggestions
// for admin review, written into ingestion_review_queue.possible_merge_candidates
// and rendered in the admin queue UI.
//
// Scoring has two axes:
//   1. Manufacturer match confidence (via matchManufacturer: high/medium/none)
//   2. Dice coefficient on device name (0..1)
//
// The two axes combine into a single confidence band (high/medium/low) via
// classifyConfidence() below. Thresholds come from the A2b design session
// 22 April — expected to be tuned once we see real merge-candidate data.
// =============================================================================

export interface FindMergeCandidatesInput {
  manufacturerName: string | null
  deviceName: string | null
  supabase: SupabaseClient
  /** Extra raw payload from the ingest source; unused today, reserved for future scoring signals. */
  payload?: unknown
}

// Thresholds — tune later per 22 April design notes.
const LOW_CUTOFF  = 0.65   // strictly exceeded — below this is not a candidate
const MID_CUTOFF  = 0.70   // inclusive lower bound for 'medium' when mfr exact
const HIGH_CUTOFF = 0.85   // strictly exceeded for 'high' or medium-via-medium-mfr

/**
 * Find devices in device_master that might be the same as the incoming
 * (manufacturer, deviceName) pair. Used by every ingest path's 4d gate.
 *
 * Returns an array sorted by confidence descending, Dice score descending
 * as tiebreaker. Empty array means "no candidates — safe to create new".
 *
 * Never throws on DB errors — logs and returns []. Rationale: ingest paths
 * failing-closed (queue for review when in doubt) is safer than throwing
 * and halting an entire sync run.
 */
export async function findMergeCandidates(
  input: FindMergeCandidatesInput
): Promise<MergeCandidate[]> {
  const { manufacturerName, deviceName, supabase } = input

  // Without a manufacturer we have no anchor for candidate search.
  // Caller will create a new device (or, if it wants, route to admin review
  // as 'no-mfr-match' — that's its call).
  if (!manufacturerName || !manufacturerName.trim()) {
    return []
  }

  const mfrMatch = await matchManufacturer(manufacturerName, supabase)
  if (!mfrMatch) {
    return []
  }

  // Pull every device currently linked to this manufacturer, along with its
  // external IDs and claim status.
  const { data: rows, error } = await supabase
    .from('device_master')
    .select(`
      aletia_id,
      name,
      claimed_by_email,
      external_ids:device_external_ids (id_type, id_value)
    `)
    .eq('manufacturer_link', mfrMatch.id)

  if (error) {
    // Don't swallow silently — surface for debugging — but don't halt ingest.
    // Caller can inspect the returned [] and decide whether to queue.
    console.error('[matchingCandidates] device_master lookup failed:', error)
    return []
  }

  if (!rows || rows.length === 0) {
    return []
  }

  const incoming = (deviceName ?? '').trim().toLowerCase()

  const scored: MergeCandidate[] = []
  for (const row of rows) {
    const candName = (row.name ?? '').trim().toLowerCase()

    // Dice only meaningful when both sides have a name. Zero score when
    // either side is missing — falls through classifyConfidence() to null
    // (not a candidate) in every path.
    const dice = incoming && candName
      ? stringSimilarity(incoming, candName)
      : 0

    const band = classifyConfidence(mfrMatch.confidence, dice)
    if (!band) continue

    // Narrow the embedded external_ids rows to the typed shape.
    const existing_ids = Array.isArray(row.external_ids)
      ? row.external_ids.map((e: { id_type: string; id_value: string }) => ({
          id_type:  e.id_type as ExternalIdType,
          id_value: e.id_value,
        }))
      : []

    scored.push({
      aletia_id: row.aletia_id,
      confidence: band,
      matched_on: {
        manufacturer: mfrMatch.confidence === 'high'
          ? 'exact'
          : mfrMatch.confidence === 'medium'
            ? 'medium'
            : 'none',
        device_name_dice: dice,
      },
      existing_ids,
      claimed_by_email: row.claimed_by_email ?? null,
    })
  }

  // High > medium > low, tiebreak by Dice score descending.
  const bandRank: Record<MergeCandidateConfidence, number> = {
    high: 3, medium: 2, low: 1,
  }
  scored.sort((a, b) => {
    const byBand = bandRank[b.confidence] - bandRank[a.confidence]
    if (byBand !== 0) return byBand
    return b.matched_on.device_name_dice - a.matched_on.device_name_dice
  })

  return scored
}

/**
 * Apply the A2b confidence-band rules:
 *   - high:   mfr exact   AND Dice > 0.85
 *   - medium: (mfr exact   AND 0.70 <= Dice <= 0.85)
 *             OR (mfr medium AND Dice > 0.85)
 *   - low:    anything Dice > 0.65 otherwise
 *   - null:   below 0.65, not a candidate
 *
 * Per 22 April design, intentionally conservative: a candidate that fails
 * the Dice floor is never returned, even with exact manufacturer match.
 * If you want "manufacturer-only" matches surfaced (e.g., tiny manufacturer
 * with one device), handle that in the calling ingest path rather than
 * loosening this floor.
 */
function classifyConfidence(
  mfrConfidence: 'high' | 'medium' | 'low',
  dice: number,
): MergeCandidateConfidence | null {
  if (mfrConfidence === 'high') {
    if (dice > HIGH_CUTOFF) return 'high'
    if (dice >= MID_CUTOFF) return 'medium'
    if (dice > LOW_CUTOFF)  return 'low'
    return null
  }
  if (mfrConfidence === 'medium') {
    if (dice > HIGH_CUTOFF) return 'medium'
    if (dice > LOW_CUTOFF)  return 'low'
    return null
  }
  // matchManufacturer only returns high/medium or null today; defensive.
  return null
}
