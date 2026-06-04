/**
 * scripts/prune-offlist-fda.ts
 *
 * Prunes the FDA over-capture produced by the old product-code discovery: marks
 * device_master.excluded = true for FDA-origin devices whose SOLE claim to
 * inclusion was an off-list FDA seed. Part of the FDA discovery rebuild.
 *
 * A device is pruned iff ALL of these hold:
 *   1. it has at least one FDA external id (fda_k_number / fda_de_novo / fda_pma)
 *   2. NONE of its FDA external ids are on the freshly-fetched FDA AI/ML list
 *   3. it has NO non-FDA external id (no MHRA id, no NCT, …)
 *   4. it has NO regional_registration from a non-FDA body (MHRA/EU/…)
 *   5. it is not already excluded
 *
 * (2)+(3)+(4) is the conservative reading of "sole claim to inclusion": a
 * device registered in another jurisdiction, or carrying any non-FDA identifier,
 * is kept. We check ALL of a device's FDA ids, not just the primary, so a device
 * that is on the list under any of its identifiers survives.
 *
 * REVERSIBLE: this only sets excluded = true (never DELETE). Each apply run
 * writes a rollback file listing exactly the aletia_ids it changed, plus the
 * SQL to undo it. Prod is Free-plan with no automated backups — snapshot first.
 *
 * Run from repo root, AFTER the list-seed PUT has run (so the index reflects
 * the list) and AFTER a manual DB snapshot:
 *   npx tsx scripts/prune-offlist-fda.ts                 # DRY RUN (default) — counts + samples, no writes
 *   npx tsx scripts/prune-offlist-fda.ts --apply         # write excluded = true
 *   npx tsx scripts/prune-offlist-fda.ts --apply --force  # bypass the >90% safety abort
 *
 * Requires .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { writeFileSync } from 'fs'
import { createAdminClient } from '../lib/supabase-admin'
import { fetchFdaAiMlList } from '../lib/fdaList'

const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')

const FDA_ID_TYPES = new Set(['fda_k_number', 'fda_de_novo', 'fda_pma'])

// Safety thresholds.
const MIN_LIST_ENTRIES = 1000     // a shorter list ⇒ truncated/failed fetch ⇒ refuse to prune
const MAX_PRUNE_FRACTION = 0.9    // pruning >90% of FDA devices ⇒ almost certainly wrong

const norm = (s: string | null | undefined) => (s ?? '').trim().toUpperCase()

type ExternalIdRow = { aletia_id: string; id_type: string; id_value: string }
type MasterRow = { aletia_id: string; name: string | null; manufacturer_name: string | null; excluded: boolean | null }
type RegRow = { device_link: string; regulatory_body: string | null }

// Read every row of a query, paging past Supabase's 1000-row response cap.
async function pageAll<T>(make: () => any): Promise<T[]> {
  const out: T[] = []
  const size = 1000
  let from = 0
  for (;;) {
    const { data, error } = await make().range(from, from + size - 1)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    out.push(...(data as T[]))
    if (data.length < size) break
    from += size
  }
  return out
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

async function main() {
  console.log(`\n=== FDA off-list prune ${APPLY ? '(APPLY — will write excluded=true)' : '(DRY RUN — no writes)'} ===\n`)

  const supabase = createAdminClient()

  // ── 1. Fresh FDA list → set of normalised identifiers ────────────────────
  const list = await fetchFdaAiMlList()
  const listIds = new Set(list.map((e) => norm(e.identifier)))
  console.log(`FDA published list: ${list.length} entries (${listIds.size} distinct identifiers).`)

  if (list.length < MIN_LIST_ENTRIES) {
    console.error(
      `\nABORT: the list returned only ${list.length} entries (< ${MIN_LIST_ENTRIES}). ` +
      `That looks like a truncated or failed fetch — pruning now would wrongly exclude ` +
      `on-list devices. Verify the CSV media URL, then re-run.`,
    )
    process.exit(1)
  }

  // ── 2. Load the graph: master rows, all external ids, non-FDA registrations ─
  const [masters, extIds, regs] = await Promise.all([
    pageAll<MasterRow>(() =>
      supabase.from('device_master').select('aletia_id, name, manufacturer_name, excluded'),
    ),
    pageAll<ExternalIdRow>(() =>
      supabase.from('device_external_ids').select('aletia_id, id_type, id_value'),
    ),
    pageAll<RegRow>(() =>
      supabase.from('regional_registrations').select('device_link, regulatory_body'),
    ),
  ])

  console.log(`Loaded ${masters.length} devices, ${extIds.length} external ids, ${regs.length} regional registrations.\n`)

  // ── 3. Index the relationships ───────────────────────────────────────────
  const fdaIdsByDevice = new Map<string, string[]>()   // aletia_id → FDA id_values
  const hasNonFdaExtId = new Set<string>()             // aletia_id with any non-FDA external id
  for (const r of extIds) {
    if (FDA_ID_TYPES.has(r.id_type)) {
      const arr = fdaIdsByDevice.get(r.aletia_id) ?? []
      arr.push(r.id_value)
      fdaIdsByDevice.set(r.aletia_id, arr)
    } else {
      hasNonFdaExtId.add(r.aletia_id)
    }
  }

  const hasNonFdaReg = new Set<string>()               // aletia_id with a non-FDA registration
  for (const r of regs) {
    if (r.regulatory_body && r.regulatory_body.toUpperCase() !== 'FDA') {
      hasNonFdaReg.add(r.device_link)
    }
  }

  const masterById = new Map(masters.map((m) => [m.aletia_id, m]))

  // ── 4. Classify each FDA-linked device ───────────────────────────────────
  const toPrune: MasterRow[] = []
  const keptOnList: string[] = []
  const keptCrossJurisdiction: MasterRow[] = []
  let alreadyExcluded = 0
  let fdaLinked = 0

  for (const [aletiaId, fdaIds] of fdaIdsByDevice) {
    const m = masterById.get(aletiaId)
    if (!m) continue // external id without a master row — skip (shouldn't happen)
    fdaLinked++

    if (m.excluded) { alreadyExcluded++; continue }

    const onList = fdaIds.some((v) => listIds.has(norm(v)))
    if (onList) { keptOnList.push(aletiaId); continue }

    if (hasNonFdaExtId.has(aletiaId) || hasNonFdaReg.has(aletiaId)) {
      keptCrossJurisdiction.push(m)
      continue
    }

    toPrune.push(m)
  }

  // ── 5. Report ────────────────────────────────────────────────────────────
  console.log('=== Counts ===')
  console.log(`Total devices                       : ${masters.length}`)
  console.log(`FDA-linked devices                  : ${fdaLinked}`)
  console.log(`  already excluded (skipped)        : ${alreadyExcluded}`)
  console.log(`  on the FDA list — KEEP            : ${keptOnList.length}`)
  console.log(`  off-list but cross-jurisdiction   — KEEP : ${keptCrossJurisdiction.length}`)
  console.log(`  off-list, FDA-only  — PRUNE       : ${toPrune.length}`)
  console.log(`Projected FDA-in-scope after prune  : ${keptOnList.length + keptCrossJurisdiction.length}\n`)

  const sample = (rows: MasterRow[], n: number) =>
    rows.slice(0, n).map((m) => `    ${m.aletia_id}  ${(m.name ?? '∅').slice(0, 48)}  [${(m.manufacturer_name ?? '∅').slice(0, 28)}]`)

  console.log('Sample to PRUNE (first 15):')
  console.log(sample(toPrune, 15).join('\n') || '    (none)')
  console.log('\nSample KEPT via other jurisdiction (first 10):')
  console.log(sample(keptCrossJurisdiction, 10).join('\n') || '    (none)')
  console.log('')

  // ── 6. Safety abort on implausible prune size ────────────────────────────
  const fraction = fdaLinked > 0 ? toPrune.length / fdaLinked : 0
  if (toPrune.length > 0 && fraction > MAX_PRUNE_FRACTION && !FORCE) {
    console.error(
      `ABORT: would prune ${(fraction * 100).toFixed(1)}% of FDA-linked devices ` +
      `(> ${(MAX_PRUNE_FRACTION * 100).toFixed(0)}%). This usually means the list ` +
      `didn't match stored identifiers. Inspect the sample above; re-run with --force ` +
      `only if it is genuinely correct.`,
    )
    process.exit(1)
  }

  if (!APPLY) {
    console.log('(DRY RUN — nothing written. Re-run with --apply to set excluded=true.)')
    return
  }

  if (toPrune.length === 0) {
    console.log('Nothing to prune. Done.')
    return
  }

  // ── 7. Write rollback file BEFORE mutating ───────────────────────────────
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const pruneIds = toPrune.map((m) => m.aletia_id)
  const rollbackPath = `scripts/prune-offlist-fda.rollback.${stamp}.json`
  writeFileSync(
    rollbackPath,
    JSON.stringify(
      {
        excluded_at: new Date().toISOString(),
        list_entries: list.length,
        count: pruneIds.length,
        note: 'Reverse with: UPDATE device_master SET excluded=false WHERE aletia_id = ANY(...) — see rollback_sql.',
        rollback_sql: `update device_master set excluded = false where aletia_id in (${pruneIds.map((id) => `'${id}'`).join(', ')});`,
        aletia_ids: pruneIds,
      },
      null,
      2,
    ),
  )
  console.log(`Wrote rollback file: ${rollbackPath}`)

  // ── 8. Apply in batches ──────────────────────────────────────────────────
  let updated = 0
  let failed = 0
  for (const batch of chunk(pruneIds, 500)) {
    const { error } = await supabase
      .from('device_master')
      .update({ excluded: true })
      .in('aletia_id', batch)
    if (error) {
      console.error(`  batch update failed (${batch.length} ids): ${error.message}`)
      failed += batch.length
    } else {
      updated += batch.length
    }
  }

  console.log(`\n=== Applied ===`)
  console.log(`Marked excluded=true : ${updated}`)
  if (failed) console.log(`Failed               : ${failed} (rollback file still lists all intended ids)`)
  console.log(`\nTo reverse this run:\n  psql/SQL editor →  (see rollback_sql in ${rollbackPath})`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
