/**
 * scripts/seed-eudamed.ts
 *
 * Consume the Step 0A crosswalk output (eudamed-crosswalk-results.json) into the
 * ingestion_review_queue as the EUDAMED seed review set. Per EUDAMED-STEP-0A-
 * FINDINGS.md §6: Session 2 CONSUMES the crosswalk matches — it does NOT
 * re-derive them. Each EU device becomes ONE pending queue row (source
 * 'eudamed_sync') keyed on its euUuid, with possible_merge_candidates carrying
 * EVERY distinct FDA device it matched (confidence-sorted), so the operator
 * sees all candidates and picks at merge time.
 *
 * We do NOT auto-merge: cross-jurisdiction has no shared namespace, so every
 * match is a strict-threshold fuzzy claim and goes through admin review.
 *
 * CROSSWALK JSON SHAPE (confirmed live, 9 June 2026):
 *   { confirmed: [...], probable: [...] }, each entry a (FDA submission, EU
 *   device) PAIR:
 *     { fda: { name, manufacturer, submission, productCode }, tier,
 *       euUuid, euTradeName, euManufacturer, nameDice, mfrDice }
 *   One euUuid often appears in several pairs (one EU device ↔ many FDA
 *   submissions, frequently distinct aletia_ids — e.g. successive 510(k)s of
 *   one product). We GROUP by euUuid and aggregate candidates. There is NO
 *   basic UDI and NO aletia_id in the file: the EU device is keyed by euUuid
 *   (id_type 'eudamed_udi_di'); FDA submissions are resolved to aletia_ids here.
 *
 * REVERSIBLE: only inserts pending queue rows. --apply writes a rollback file.
 * Prod is Free-plan (no automated backups) - snapshot first.
 *
 *   npx tsx scripts/seed-eudamed.ts                 # DRY RUN - counts + a mapped sample
 *   npx tsx scripts/seed-eudamed.ts --apply         # write pending queue rows
 *   npx tsx scripts/seed-eudamed.ts --apply --probable-only
 *   npx tsx scripts/seed-eudamed.ts --apply --confirmed-only
 *   npx tsx scripts/seed-eudamed.ts --file path/to/results.json
 *
 * Requires .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { readFileSync, writeFileSync } from 'fs'
import { createAdminClient } from '../lib/supabase-admin'
import type { MergeCandidate, MergeCandidateConfidence, ExternalIdType } from '../lib/types'

const APPLY = process.argv.includes('--apply')
const PROBABLE_ONLY = process.argv.includes('--probable-only')
const CONFIRMED_ONLY = process.argv.includes('--confirmed-only')
const fileArgIdx = process.argv.indexOf('--file')
const RESULTS_FILE = fileArgIdx !== -1 ? process.argv[fileArgIdx + 1] : 'eudamed-crosswalk-results.json'

// FDA submission -> external-id type. K... = 510(k); DEN... = De Novo; P... = PMA.
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

const num = (v: unknown): number => (typeof v === 'number' ? v : 0)
const confRank: Record<MergeCandidateConfidence, number> = { high: 0, medium: 1, low: 2 }

// One matched FDA submission for an EU device, pre-resolution.
interface PairMatch {
  submission: string
  confidence: MergeCandidateConfidence
  nameDice: number
  mfrDice: number
}

// One grouped EU device.
interface EuGroup {
  euUuid: string
  device_name: string | null
  manufacturer_name: string | null
  matches: PairMatch[]
  bestTier: MergeCandidateConfidence
}

async function main() {
  const admin = createAdminClient()

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(RESULTS_FILE, 'utf8'))
  } catch (err) {
    console.error(`Could not read ${RESULTS_FILE}: ${(err as Error).message}`)
    console.error('Pass --file <path> if the crosswalk JSON is elsewhere.')
    process.exit(1)
  }

  const root = parsed as Record<string, unknown>
  const confirmedRaw = (root.confirmed as CrosswalkEntry[]) ?? []
  const probableRaw = (root.probable as CrosswalkEntry[]) ?? []
  console.log(`\n=== EUDAMED crosswalk seed (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`)
  console.log(`Source: ${RESULTS_FILE}`)
  console.log(`Parsed: ${confirmedRaw.length} confirmed, ${probableRaw.length} probable pairs\n`)

  // ── Group pairs by euUuid ──────────────────────────────────────────────────
  const groups = new Map<string, EuGroup>()
  const addPair = (e: CrosswalkEntry, confidence: MergeCandidateConfidence) => {
    const euUuid = e.euUuid?.trim()
    const submission = e.fda?.submission?.trim()
    if (!euUuid || !submission) return
    let g = groups.get(euUuid)
    if (!g) {
      g = {
        euUuid,
        device_name: e.euTradeName ?? null,
        manufacturer_name: e.euManufacturer ?? null,
        matches: [],
        bestTier: confidence,
      }
      groups.set(euUuid, g)
    }
    g.matches.push({ submission, confidence, nameDice: num(e.nameDice), mfrDice: num(e.mfrDice) })
    if (confRank[confidence] < confRank[g.bestTier]) g.bestTier = confidence
  }
  if (!PROBABLE_ONLY) confirmedRaw.forEach((e) => addPair(e, 'high'))
  if (!CONFIRMED_ONLY) probableRaw.forEach((e) => addPair(e, 'medium'))

  console.log(`Grouped into ${groups.size} distinct EU devices ` +
    `(${[...groups.values()].filter((g) => g.matches.length > 1).length} match >1 FDA submission)\n`)

  // ── Batch-resolve ALL submissions → aletia_id in a few queries ─────────────
  const allSubs = [...new Set([...groups.values()].flatMap((g) => g.matches.map((m) => m.submission)))]
  const subToAletia = new Map<string, string>()
  const CHUNK = 200
  for (const idType of ['fda_k_number', 'fda_de_novo', 'fda_pma'] as ExternalIdType[]) {
    const relevant = allSubs.filter((s) => fdaIdTypeForSubmission(s) === idType)
    for (let i = 0; i < relevant.length; i += CHUNK) {
      const slice = relevant.slice(i, i + CHUNK)
      if (!slice.length) continue
      const { data } = await admin
        .from('device_external_ids')
        .select('id_value, aletia_id')
        .eq('id_type', idType)
        .in('id_value', slice)
      for (const r of data ?? []) subToAletia.set(r.id_value, r.aletia_id)
    }
  }

  // Pull claim status + existing ids for every resolved aletia_id, batched.
  const resolvedAletiaIds = [...new Set([...subToAletia.values()])]
  const devInfo = new Map<string, { claimed_by_email: string | null; existing_ids: { id_type: ExternalIdType; id_value: string }[] }>()
  for (let i = 0; i < resolvedAletiaIds.length; i += CHUNK) {
    const slice = resolvedAletiaIds.slice(i, i + CHUNK)
    if (!slice.length) continue
    const { data } = await admin
      .from('device_master')
      .select('aletia_id, claimed_by_email, external_ids:device_external_ids (id_type, id_value)')
      .in('aletia_id', slice)
    for (const d of data ?? []) {
      const existing_ids = Array.isArray(d.external_ids)
        ? d.external_ids.map((e: { id_type: string; id_value: string }) => ({ id_type: e.id_type as ExternalIdType, id_value: e.id_value }))
        : []
      devInfo.set(d.aletia_id, { claimed_by_email: d.claimed_by_email ?? null, existing_ids })
    }
  }

  // ── Build one queue row per EU device, candidates aggregated ───────────────
  let sampleShown = false
  let inserted = 0
  let skippedNoCandidate = 0
  let skippedDuplicate = 0
  let failed = 0
  const createdQueueIds: string[] = []
  const unresolved = new Set<string>()

  for (const g of groups.values()) {
    // distinct aletia_id → best (submission, dice) for that device
    const byAletia = new Map<string, { confidence: MergeCandidateConfidence; nameDice: number; mfrDice: number; submission: string }>()
    for (const m of g.matches) {
      const aletia = subToAletia.get(m.submission)
      if (!aletia) { unresolved.add(m.submission); continue }
      const cur = byAletia.get(aletia)
      if (!cur || confRank[m.confidence] < confRank[cur.confidence] || m.nameDice > cur.nameDice) {
        byAletia.set(aletia, { confidence: m.confidence, nameDice: m.nameDice, mfrDice: m.mfrDice, submission: m.submission })
      }
    }
    if (byAletia.size === 0) { skippedNoCandidate++; continue }

    const candidates: MergeCandidate[] = [...byAletia.entries()]
      .map(([aletia_id, v]) => ({
        aletia_id,
        confidence: v.confidence,
        matched_on: {
          manufacturer: v.mfrDice >= 0.9 ? 'exact' : v.mfrDice >= 0.5 ? 'medium' : 'none',
          device_name_dice: v.nameDice,
        },
        existing_ids: devInfo.get(aletia_id)?.existing_ids ?? [],
        claimed_by_email: devInfo.get(aletia_id)?.claimed_by_email ?? null,
      } as MergeCandidate))
      .sort((a, b) => confRank[a.confidence] - confRank[b.confidence] || b.matched_on.device_name_dice - a.matched_on.device_name_dice)

    const rawData = {
      eu_uuid: g.euUuid,
      device_name: g.device_name,
      manufacturer_name: g.manufacturer_name,
      fda_submissions: g.matches.map((m) => m.submission),
      notified_body: null,
      legislation: null,
      risk_class: null,
      source: 'eudamed_sync',
      crosswalk_bucket: g.bestTier === 'high' ? 'confirmed' : 'probable',
      candidate_count: candidates.length,
      seeded_at: new Date().toISOString(),
    }

    if (!sampleShown) {
      console.log('First mapped sample (verify before --apply):')
      console.log(JSON.stringify({ source_id: g.euUuid, queue_raw_data: rawData, candidates }, null, 2))
      console.log('')
      sampleShown = true
    }

    if (!APPLY) { inserted++; continue }

    const { data: dup } = await admin
      .from('ingestion_review_queue')
      .select('queue_id')
      .eq('source', 'eudamed_sync')
      .eq('source_id', g.euUuid)
      .eq('status', 'pending')
      .maybeSingle()
    if (dup) { skippedDuplicate++; continue }

    const { data: row, error } = await admin
      .from('ingestion_review_queue')
      .insert({
        source: 'eudamed_sync',
        source_id: g.euUuid,
        device_name: g.device_name,
        manufacturer: g.manufacturer_name,
        raw_data: rawData,
        review_reason: 'cross_jurisdiction_match',
        possible_merge_candidates: candidates,
        status: 'pending',
      })
      .select('queue_id')
      .single()

    if (error || !row) { failed++; console.warn(`  insert failed for ${g.euUuid}: ${error?.message}`); continue }
    createdQueueIds.push(row.queue_id)
    inserted++
  }

  console.log('=== Summary ===')
  console.log(`${APPLY ? 'Inserted' : 'Would insert'} (one row per EU device): ${inserted}`)
  console.log(`Skipped - no resolvable FDA candidate: ${skippedNoCandidate}`)
  console.log(`Unresolved FDA submissions (not in index): ${unresolved.size}`)
  if (unresolved.size) console.log(`  e.g.: ${[...unresolved].slice(0, 10).join(', ')}`)
  if (APPLY) {
    console.log(`Skipped - already pending: ${skippedDuplicate}`)
    console.log(`Failed: ${failed}`)
    const rollback = `eudamed-seed-rollback-${Date.now()}.json`
    writeFileSync(rollback, JSON.stringify({ created_queue_ids: createdQueueIds }, null, 2))
    console.log(`\nRollback written: ${rollback}`)
    console.log('Undo SQL: DELETE FROM ingestion_review_queue WHERE queue_id = ANY(<created_queue_ids>);')
  } else {
    console.log('\nDRY RUN - no writes. Re-run with --apply once the sample looks right.')
  }
}

main().catch((err) => {
  console.error('seed-eudamed failed:', err)
  process.exit(1)
})
