/**
 * scripts/recompute-eudamed-candidates.ts
 *
 * Post-FDA-dedup crosswalk re-run (STATE "Next priority" item 2).
 *
 * The 227 pending eudamed_sync queue rows were seeded (seed-eudamed.ts, 9 Jun)
 * by resolving crosswalk FDA submissions -> aletia_ids BEFORE the 10 Jun
 * same-product dedup. Repeat submissions of one product then resolved to
 * DISTINCT aletia_ids, producing 68 multi-candidate rows (held via
 * park-with-note). The dedup re-pointed absorbed rows' external ids onto their
 * survivors, so re-resolving the SAME submissions now lands on collapsed
 * identities — most multi-candidate rows should fall to a single survivor,
 * and any single-candidate row pointing at a tombstone gets re-pointed.
 *
 * This script does NOT touch EUDAMED and does NOT re-derive matches: per
 * EUDAMED-STEP-0A-FINDINGS §6 it CONSUMES the existing crosswalk snapshot
 * (eudamed-crosswalk-results.json — same dice scores, same tiers) and only
 * re-resolves submission -> aletia_id against the post-dedup index. It is the
 * "deliberate re-scoring pass" the candidates route's header reserves for a
 * script (never a drawer side effect).
 *
 * Per pending eudamed_sync row:
 *   - group the row's crosswalk pairs by euUuid (== queue source_id)
 *   - re-resolve each FDA submission via device_external_ids
 *   - follow device_master.merged_into if a resolved id is tombstoned
 *     (belt-and-braces; the dedup re-pointed ids, so this should log zero)
 *   - drop candidates whose device is excluded or still tombstoned
 *   - rebuild possible_merge_candidates exactly as the seed built them
 *     (best submission per aletia_id, confidence-sorted) with fresh
 *     existing_ids / claimed_by_email
 *   - update the row only if the candidate set changed; raw_data gains
 *     candidate_count + recandidated_at, nothing else moves. review_note,
 *     status, device_name, manufacturer are untouched.
 *
 * REVERSIBLE: --apply writes a rollback file carrying each updated row's
 * prior possible_merge_candidates + prior raw_data. Prod is Free-plan (no
 * automated backups) — snapshot ingestion_review_queue first.
 *
 *   npx tsx scripts/recompute-eudamed-candidates.ts                       # DRY RUN — full report, no writes
 *   npx tsx scripts/recompute-eudamed-candidates.ts --expect 0           # pre-assert the write-set count (aborts on mismatch)
 *   npx tsx scripts/recompute-eudamed-candidates.ts --apply --expect <N> # write updates + rollback file (N = "Rows changing" from the dry-run)
 *   npx tsx scripts/recompute-eudamed-candidates.ts --file path/to/results.json
 *
 * DRIFT GUARD: --expect N asserts the number of rows that WILL change equals N,
 * so an applied set can never drift from the dry-run you reviewed (mirrors
 * fda-dedup-apply.ts). The hard invariants (candidates-still-tombstoned = 0,
 * no-crosswalk-entry = 0) abort --apply before any write.
 *
 * Requires .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { readFileSync, writeFileSync } from 'fs'
import { createAdminClient } from '../lib/supabase-admin'
import type { MergeCandidate, MergeCandidateConfidence, ExternalIdType } from '../lib/types'

const APPLY = process.argv.includes('--apply')
const expectArg = process.argv.indexOf('--expect')
const EXPECT = expectArg !== -1 ? parseInt(process.argv[expectArg + 1], 10) : null
const fileArgIdx = process.argv.indexOf('--file')
const RESULTS_FILE = fileArgIdx !== -1 ? process.argv[fileArgIdx + 1] : 'eudamed-crosswalk-results.json'
const CHUNK = 200

// FDA submission -> external-id type. K... = 510(k); DEN... = De Novo; P... = PMA.
// (Same mapping as seed-eudamed.ts.)
function fdaIdTypeForSubmission(submission: string): ExternalIdType {
  const s = submission.trim().toUpperCase()
  if (s.startsWith('DEN')) return 'fda_de_novo'
  if (s.startsWith('P')) return 'fda_pma'
  return 'fda_k_number'
}

interface CrosswalkEntry {
  fda?: { name?: string; manufacturer?: string; submission?: string; productCode?: string }
  tier?: string
  euUuid?: string
  euTradeName?: string
  euManufacturer?: string
  nameDice?: number
  mfrDice?: number
}

interface PairMatch {
  submission: string
  confidence: MergeCandidateConfidence
  nameDice: number
  mfrDice: number
}

interface QueueRow {
  queue_id: string
  source_id: string
  status: string
  review_note: string | null
  possible_merge_candidates: MergeCandidate[] | null
  raw_data: Record<string, unknown> | null
}

const num = (v: unknown): number => (typeof v === 'number' ? v : 0)
const confRank: Record<MergeCandidateConfidence, number> = { high: 0, medium: 1, low: 2 }

function candidateIds(c: MergeCandidate[] | null): string[] {
  return (c ?? []).map((x) => x.aletia_id).sort()
}
function sameIdSet(a: MergeCandidate[] | null, b: MergeCandidate[]): boolean {
  const A = candidateIds(a)
  const B = candidateIds(b)
  return A.length === B.length && A.every((v, i) => v === B[i])
}

async function main() {
  const admin = createAdminClient()

  // ── 1. Crosswalk pairs grouped by euUuid (the queue rows' source_id) ───────
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(RESULTS_FILE, 'utf8'))
  } catch (err) {
    console.error(`Could not read ${RESULTS_FILE}: ${(err as Error).message}`)
    console.error('Pass --file <path> if the crosswalk JSON is elsewhere.')
    process.exit(1)
  }
  const root = parsed as Record<string, unknown>
  const pairs: Array<{ e: CrosswalkEntry; conf: MergeCandidateConfidence }> = [
    ...(((root.confirmed as CrosswalkEntry[]) ?? []).map((e) => ({ e, conf: 'high' as const }))),
    ...(((root.probable as CrosswalkEntry[]) ?? []).map((e) => ({ e, conf: 'medium' as const }))),
  ]
  const matchesByEu = new Map<string, PairMatch[]>()
  for (const { e, conf } of pairs) {
    const euUuid = e.euUuid?.trim()
    const submission = e.fda?.submission?.trim()
    if (!euUuid || !submission) continue
    const list = matchesByEu.get(euUuid) ?? []
    list.push({ submission, confidence: conf, nameDice: num(e.nameDice), mfrDice: num(e.mfrDice) })
    matchesByEu.set(euUuid, list)
  }

  console.log(`\n=== EUDAMED candidate recompute (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`)
  console.log(`Crosswalk source: ${RESULTS_FILE} — ${matchesByEu.size} distinct EU devices\n`)

  // ── 2. Pending eudamed_sync queue rows ─────────────────────────────────────
  const queueRows: QueueRow[] = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await admin
      .from('ingestion_review_queue')
      .select('queue_id, source_id, status, review_note, possible_merge_candidates, raw_data')
      .eq('source', 'eudamed_sync')
      .eq('status', 'pending')
      .order('queue_id')
      .range(from, from + 499)
    if (error) {
      console.error(`Queue fetch failed: ${error.message}`)
      process.exit(1)
    }
    queueRows.push(...((data ?? []) as QueueRow[]))
    if (!data || data.length < 500) break
  }
  console.log(`Pending eudamed_sync rows: ${queueRows.length}`)

  // ── 3. Batch-resolve all relevant submissions -> aletia_id (post-dedup) ───
  const allSubs = [
    ...new Set(
      queueRows.flatMap((r) => (matchesByEu.get(r.source_id) ?? []).map((m) => m.submission)),
    ),
  ]
  const subToAletia = new Map<string, string>()
  for (const idType of ['fda_k_number', 'fda_de_novo', 'fda_pma'] as ExternalIdType[]) {
    const relevant = allSubs.filter((s) => fdaIdTypeForSubmission(s) === idType)
    for (let i = 0; i < relevant.length; i += CHUNK) {
      const slice = relevant.slice(i, i + CHUNK)
      if (!slice.length) continue
      const { data, error } = await admin
        .from('device_external_ids')
        .select('id_value, aletia_id')
        .eq('id_type', idType)
        .in('id_value', slice)
      if (error) {
        console.error(`external_ids fetch failed: ${error.message}`)
        process.exit(1)
      }
      for (const r of data ?? []) subToAletia.set(r.id_value, r.aletia_id)
    }
  }

  // ── 4. Device info for resolved ids: tombstone/excluded guards + freshness ─
  type DevInfo = {
    merged_into: string | null
    excluded: boolean
    claimed_by_email: string | null
    existing_ids: { id_type: ExternalIdType; id_value: string }[]
  }
  const devInfo = new Map<string, DevInfo>()
  const fetchDevices = async (ids: string[]) => {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK).filter((id) => !devInfo.has(id))
      if (!slice.length) continue
      const { data, error } = await admin
        .from('device_master')
        .select('aletia_id, merged_into, excluded, claimed_by_email, external_ids:device_external_ids (id_type, id_value)')
        .in('aletia_id', slice)
      if (error) {
        console.error(`device_master fetch failed: ${error.message}`)
        process.exit(1)
      }
      for (const d of data ?? []) {
        const existing_ids = Array.isArray(d.external_ids)
          ? d.external_ids.map((e: { id_type: string; id_value: string }) => ({
              id_type: e.id_type as ExternalIdType,
              id_value: e.id_value,
            }))
          : []
        devInfo.set(d.aletia_id, {
          merged_into: d.merged_into ?? null,
          excluded: d.excluded === true,
          claimed_by_email: d.claimed_by_email ?? null,
          existing_ids,
        })
      }
    }
  }
  await fetchDevices([...new Set(subToAletia.values())])

  // Follow merged_into one hop if any resolved id is somehow still a tombstone
  // (the dedup re-pointed ids, so this should stay at zero — log loudly if not).
  let tombstoneHops = 0
  const resolveSurvivor = async (aletia: string): Promise<string | null> => {
    let info = devInfo.get(aletia)
    if (!info) return aletia // unknown — keep, surfaces in the report
    if (info.merged_into) {
      tombstoneHops++
      const survivor = info.merged_into
      if (!devInfo.has(survivor)) await fetchDevices([survivor])
      info = devInfo.get(survivor)
      if (info?.excluded) return null
      return survivor
    }
    if (info.excluded) return null
    return aletia
  }

  // ── 5. Rebuild candidates per row; collect updates ─────────────────────────
  type Update = {
    queue_id: string
    source_id: string
    review_note: string | null
    before: MergeCandidate[] | null
    after: MergeCandidate[]
    raw_before: Record<string, unknown> | null
  }
  const updates: Update[] = []
  let unchanged = 0
  let noCrosswalkEntry = 0
  let allCandidatesDropped = 0
  let candidatesStillTombstoned = 0 // INVARIANT — must be 0 (catches multi-hop chains the 1-hop resolveSurvivor can't)
  const distBefore: Record<string, number> = {}
  const distAfter: Record<string, number> = {}
  const bump = (d: Record<string, number>, n: number) => {
    const k = n >= 3 ? '3+' : String(n)
    d[k] = (d[k] ?? 0) + 1
  }

  for (const row of queueRows) {
    const matches = matchesByEu.get(row.source_id)
    bump(distBefore, (row.possible_merge_candidates ?? []).length)
    if (!matches || !matches.length) {
      noCrosswalkEntry++
      bump(distAfter, (row.possible_merge_candidates ?? []).length)
      continue
    }

    // Best (submission, dice) per surviving aletia_id — seed-eudamed logic.
    const byAletia = new Map<
      string,
      { confidence: MergeCandidateConfidence; nameDice: number; mfrDice: number; submission: string }
    >()
    for (const m of matches) {
      const raw = subToAletia.get(m.submission)
      if (!raw) continue
      const aletia = await resolveSurvivor(raw)
      if (!aletia) continue
      const cur = byAletia.get(aletia)
      if (!cur || confRank[m.confidence] < confRank[cur.confidence] || m.nameDice > cur.nameDice) {
        byAletia.set(aletia, {
          confidence: m.confidence,
          nameDice: m.nameDice,
          mfrDice: m.mfrDice,
          submission: m.submission,
        })
      }
    }

    if (byAletia.size === 0) {
      allCandidatesDropped++
      bump(distAfter, (row.possible_merge_candidates ?? []).length)
      continue // leave the row as-is; surfaces in the report for manual review
    }

    const candidates: MergeCandidate[] = [...byAletia.entries()]
      .map(
        ([aletia_id, v]) =>
          ({
            aletia_id,
            confidence: v.confidence,
            matched_on: {
              manufacturer: v.mfrDice >= 0.9 ? 'exact' : v.mfrDice >= 0.5 ? 'medium' : 'none',
              device_name_dice: v.nameDice,
            },
            existing_ids: devInfo.get(aletia_id)?.existing_ids ?? [],
            claimed_by_email: devInfo.get(aletia_id)?.claimed_by_email ?? null,
          }) as MergeCandidate,
      )
      .sort(
        (a, b) =>
          confRank[a.confidence] - confRank[b.confidence] ||
          b.matched_on.device_name_dice - a.matched_on.device_name_dice,
      )

    bump(distAfter, candidates.length)

    // Post-pass invariant: no rebuilt candidate may still point at a tombstone.
    // resolveSurvivor hops once; this catches a survivor that is itself merged
    // (a multi-hop chain) — should be 0 given Band A produced single-hop merges.
    for (const c of candidates) {
      if (devInfo.get(c.aletia_id)?.merged_into) candidatesStillTombstoned++
    }

    if (sameIdSet(row.possible_merge_candidates, candidates)) {
      unchanged++
      continue
    }
    updates.push({
      queue_id: row.queue_id,
      source_id: row.source_id,
      review_note: row.review_note,
      before: row.possible_merge_candidates,
      after: candidates,
      raw_before: row.raw_data,
    })
  }

  // ── 6. Report ───────────────────────────────────────────────────────────────
  const collapsedToSingle = updates.filter(
    (u) => (u.before ?? []).length > 1 && u.after.length === 1,
  )
  const stillMulti = updates.filter((u) => u.after.length > 1)
  const heldNotes = updates.filter((u) => u.review_note)

  console.log('\n=== Report ===')
  console.log(`Candidate-count distribution before: ${JSON.stringify(distBefore)}`)
  console.log(`Candidate-count distribution after:  ${JSON.stringify(distAfter)}`)
  console.log(`Rows changing: ${updates.length}`)
  console.log(`  multi -> single (the dedup payoff): ${collapsedToSingle.length}`)
  console.log(`  still multi-candidate after recompute: ${stillMulti.length} (genuine multi-product fuzz — work in the drawer)`)
  console.log(`Rows unchanged: ${unchanged}`)
  console.log(`Rows with no crosswalk entry for source_id: ${noCrosswalkEntry}${noCrosswalkEntry ? ' (unexpected — investigate)' : ''}`)
  console.log(`Rows whose candidates all dropped (excluded/unresolvable): ${allCandidatesDropped}${allCandidatesDropped ? ' (left untouched — review manually)' : ''}`)
  console.log(`Tombstone hops needed: ${tombstoneHops}${tombstoneHops ? ' (UNEXPECTED — dedup should have re-pointed ids; check before trusting)' : ' (as expected)'}`)
  console.log(`Candidates still pointing at a tombstone after pass: ${candidatesStillTombstoned}${candidatesStillTombstoned ? ' (INVARIANT VIOLATION — multi-hop chain; do NOT apply)' : ' (clean)'}`)
  if (heldNotes.length) {
    console.log(`\nUpdated rows still carrying a hold note (clear in the drawer as you work them): ${heldNotes.length}`)
  }
  if (stillMulti.length) {
    console.log('\nStill-multi sample (first 10):')
    for (const u of stillMulti.slice(0, 10)) {
      console.log(`  ${u.source_id}: ${u.after.map((c) => c.aletia_id).join(', ')}`)
    }
  }
  if (collapsedToSingle.length) {
    console.log('\nCollapse sample (first 5):')
    for (const u of collapsedToSingle.slice(0, 5)) {
      console.log(
        `  ${u.source_id}: [${candidateIds(u.before).join(', ')}] -> ${u.after[0].aletia_id}`,
      )
    }
  }

  // ── Drift guard + invariant gate ────────────────────────────────────────────
  // --expect N asserts the write set equals the count you reviewed in the dry-run.
  // Runs in both modes, so `--expect N` alone is a standalone pre-assert.
  if (EXPECT !== null && updates.length !== EXPECT) {
    console.error(`\nABORT: --expect ${EXPECT} but ${updates.length} rows would change.`)
    console.error('The crosswalk JSON or the index changed since you reviewed the dry-run. Re-run the dry-run and re-confirm.')
    process.exit(1)
  }
  if (APPLY && EXPECT === null) {
    console.warn('\n[warn] No --expect given. Strongly recommended: pass the "Rows changing" count')
    console.warn('       from the dry-run so an applied set can never drift from a reviewed one.')
  }
  // Hard invariants — never write if either is violated. Dry-run still completes
  // so the full report is visible; only --apply aborts.
  if (APPLY && (candidatesStillTombstoned > 0 || noCrosswalkEntry > 0)) {
    console.error(`\nABORT: invariant violated — candidatesStillTombstoned=${candidatesStillTombstoned}, noCrosswalkEntry=${noCrosswalkEntry}.`)
    console.error('Investigate before applying; the re-point is not clean.')
    process.exit(1)
  }

  if (!APPLY) {
    console.log('\nDRY RUN — no writes. Re-run with --apply --expect <Rows changing> once the report looks right.')
    return
  }

  // ── 7. Apply + rollback ─────────────────────────────────────────────────────
  let applied = 0
  let failed = 0
  for (const u of updates) {
    const rawAfter = {
      ...(u.raw_before ?? {}),
      candidate_count: u.after.length,
      recandidated_at: new Date().toISOString(),
    }
    const { error } = await admin
      .from('ingestion_review_queue')
      .update({ possible_merge_candidates: u.after, raw_data: rawAfter })
      .eq('queue_id', u.queue_id)
      .eq('status', 'pending') // never touch a row dispositioned mid-run
    if (error) {
      failed++
      console.warn(`  update failed for ${u.queue_id} (${u.source_id}): ${error.message}`)
      continue
    }
    applied++
  }

  const rollback = `eudamed-recandidate-rollback-${Date.now()}.json`
  writeFileSync(
    rollback,
    JSON.stringify(
      {
        applied_at: new Date().toISOString(),
        rows: updates.map((u) => ({
          queue_id: u.queue_id,
          source_id: u.source_id,
          prior_possible_merge_candidates: u.before,
          prior_raw_data: u.raw_before,
        })),
      },
      null,
      2,
    ),
  )
  console.log(`\n=== Apply summary ===`)
  console.log(`Updated: ${applied}  Failed: ${failed}`)
  console.log(`Rollback written: ${rollback}`)
  console.log('Undo: per row, restore prior_possible_merge_candidates + prior_raw_data by queue_id.')
}

main().catch((err) => {
  console.error('recompute-eudamed-candidates failed:', err)
  process.exit(1)
})
