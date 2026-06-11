/**
 * scripts/fda-dedup-apply.ts
 *
 * Apply the SCRIPTED tier of the FDA same-product dedup: Band A clusters only
 * (exact manufacturer + exact normalised name + single product code — the clean
 * version merges with no false positive on inspection). Bands B and C are NOT
 * touched here; they go through the queue UI via the seeder.
 *
 * Discipline mirrors the 5 June prune: dry-run → verify → SNAPSHOT → --apply,
 * fully reversible, never DELETE.
 *
 * Per cluster (survivor = earliest clearance; see lib/fdaDedup.ts):
 *   1. Re-point the absorbed rows' external-id rows to the survivor, so the
 *      survivor accumulates every submission number (skipping any (id_type,
 *      id_value) the survivor already holds — unique-index safe).
 *   2. Set device_master.merged_into = survivor on the absorbed rows (tombstone;
 *      they stay queryable and reversible). regional_registrations are NOT moved
 *      (unique (device_link,country,regulatory_body) would collide); they're
 *      tombstoned with their device via merged_into.
 *
 * Drift guard: --expect N asserts the Band-A cluster count matches what you
 * reviewed in the detector report; aborts on mismatch so you never apply a
 * different set than you eyeballed.
 *
 * Post-apply invariant: every FDA-list submission still resolves to exactly one
 * in-scope (merged_into IS NULL, excluded = false) device.
 *
 *   npx tsx scripts/fda-dedup-apply.ts                  # DRY RUN — plan only
 *   npx tsx scripts/fda-dedup-apply.ts --expect 47      # assert cluster count first
 *   npx tsx scripts/fda-dedup-apply.ts --apply --expect 47
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { writeFileSync } from 'fs'
import { createAdminClient } from '../lib/supabase-admin'
import { loadDedupFacts } from './_fdaDedupLoad'
import { clusterDevices, planAbsorb, type AbsorbPlan } from '../lib/fdaDedup'

const APPLY = process.argv.includes('--apply')
const expectArg = process.argv.indexOf('--expect')
const EXPECT = expectArg !== -1 ? parseInt(process.argv[expectArg + 1], 10) : null

async function main() {
  const admin = createAdminClient()
  const { facts, externalIdsByDevice } = await loadDedupFacts()

  const bandA = clusterDevices(facts).filter((c) => c.band === 'A' && c.members.length >= 2)

  console.log(`\n=== FDA dedup APPLY (Band A only) — ${APPLY ? 'APPLY' : 'DRY RUN'} ===`)
  console.log(`Band A clusters: ${bandA.length}`)

  if (EXPECT !== null && bandA.length !== EXPECT) {
    console.error(`\nABORT: --expect ${EXPECT} but found ${bandA.length} Band-A clusters.`)
    console.error('The data changed since you reviewed the report. Re-run the detector and re-confirm.')
    process.exit(1)
  }
  if (EXPECT === null) {
    console.warn('\n[warn] No --expect given. Strongly recommended: pass the Band-A count')
    console.warn('       from the detector report so an applied set can never drift from a reviewed one.')
  }

  const planned = bandA.map((c) => ({ cluster: c, plan: planAbsorb(c, externalIdsByDevice) }))
  const plans = planned.map((p) => p.plan)
  const totalAbsorbed = plans.reduce((n, p) => n + p.absorbed.length, 0)
  const totalIdMoves = plans.reduce((n, p) => n + p.idMoves.length, 0)

  // Name lookup so the dry-run plan is reviewable (not just ALT IDs).
  const nameOf = new Map<string, string>()
  for (const { cluster } of planned) {
    for (const m of cluster.members) nameOf.set(m.aletia_id, m.name ?? '(no name)')
  }

  console.log(`Rows to absorb (tombstone): ${totalAbsorbed}`)
  console.log(`External-id rows to re-point: ${totalIdMoves}`)

  // Safety guard — Band A should be exact-name + single-code merges. A large or
  // empty result means something is off (e.g. list fetch failed → no codes). Abort.
  if (APPLY && (bandA.length === 0 || totalAbsorbed > 400)) {
    console.error(`\nABORT: implausible Band-A size (clusters=${bandA.length}, absorbed=${totalAbsorbed}).`)
    console.error('Investigate the normalisation before applying.')
    process.exit(1)
  }

  // Plan print — survivor + each absorbed WITH NAMES. Clusters of 3+ members are
  // flagged so the bigger auto-merges get a closer look.
  const big = planned.filter((p) => p.cluster.members.length >= 3)
  if (big.length) {
    console.log(`\n⚠ ${big.length} Band-A cluster(s) have 3+ members — review these first:`)
    for (const { cluster, plan } of big) {
      console.log(`  ${plan.survivor} "${nameOf.get(plan.survivor)}" (${cluster.manufacturerKey}) ← ${plan.absorbed.length}`)
    }
  }

  for (const { plan } of planned) {
    console.log(`\n  survivor ${plan.survivor}  "${nameOf.get(plan.survivor)}"`)
    for (const a of plan.absorbed) {
      console.log(`    ← ${a}  "${nameOf.get(a)}"`)
    }
    for (const m of plan.idMoves) {
      console.log(`       move ${m.id_type}:${m.id_value}  (${m.from_aletia_id} → ${plan.survivor})`)
    }
  }

  if (!APPLY) {
    console.log('\nDry run only. SNAPSHOT the DB, then re-run with --apply --expect <count>.')
    return
  }

  // ── Apply ───────────────────────────────────────────────────────────────────
  const rollback: Array<{
    survivor: string
    absorbed: string[]
    idMoves: AbsorbPlan['idMoves']
  }> = []
  let appliedClusters = 0
  let failed = 0

  for (const p of plans) {
    const doneMoves: AbsorbPlan['idMoves'] = []
    try {
      // 1. Re-point external-id rows to survivor. Demote to non-primary: the
      //    survivor keeps its own primary (earliest clearance); absorbed
      //    submissions attach as additional non-primary ids. Without this the
      //    one-primary-per-device unique index rejects the move.
      for (const m of p.idMoves) {
        const { error } = await admin
          .from('device_external_ids')
          .update({ aletia_id: p.survivor, is_primary: false, last_seen_at: new Date().toISOString() })
          .eq('id', m.external_id_row_id)
        if (error) throw new Error(`id re-point ${m.id_value}: ${error.message}`)
        doneMoves.push(m) // record AS we go, so a partial cluster is reversible
      }
      // 2. Tombstone the absorbed rows.
      const { error: tErr } = await admin
        .from('device_master')
        .update({ merged_into: p.survivor })
        .in('aletia_id', p.absorbed)
      if (tErr) throw new Error(`tombstone: ${tErr.message}`)

      rollback.push({ survivor: p.survivor, absorbed: p.absorbed, idMoves: p.idMoves })
      appliedClusters++
    } catch (e) {
      failed++
      // Capture whatever moved before the failure so nothing is unrecoverable.
      if (doneMoves.length) rollback.push({ survivor: p.survivor, absorbed: [], idMoves: doneMoves })
      console.error(`  cluster ${p.survivor} FAILED: ${(e as Error).message}`)
    }
  }

  const file = `scripts/fda-dedup-apply.rollback.${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(file, JSON.stringify(rollback, null, 2))
  console.log(`\nApplied ${appliedClusters} clusters (${failed} failed). Rollback file: ${file}`)
  console.log('Reverse = move each idMove back to from_aletia_id and clear merged_into on absorbed.')

  await checkInvariant(admin)
}

/**
 * Every FDA-list submission must resolve to exactly one in-scope device after
 * the merge (no on-list device lost, no submission double-owned). We check the
 * submissions we actually moved/own rather than the whole list, against the
 * live external-id → device-status join.
 */
async function checkInvariant(admin: ReturnType<typeof createAdminClient>) {
  console.log('\n=== Invariant check ===')
  // Pull ALL FDA external ids + their device's status (paginated — the join
  // otherwise caps at 1000 rows and undercounts).
  type Row = {
    id_value: string
    device_master: { merged_into: string | null; excluded: boolean } | { merged_into: string | null; excluded: boolean }[]
  }
  const rows: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('device_external_ids')
      .select('id_value, id_type, device_master!inner(merged_into, excluded)')
      .in('id_type', ['fda_k_number', 'fda_de_novo', 'fda_pma'])
      .range(from, from + 999)
    if (error) {
      console.warn(`  invariant check skipped (join failed): ${error.message}`)
      return
    }
    rows.push(...((data ?? []) as Row[]))
    if (!data || data.length < 1000) break
  }
  const inScopeCount = new Map<string, number>()
  for (const r of rows) {
    const dm = Array.isArray(r.device_master) ? r.device_master[0] : r.device_master
    if (dm && dm.merged_into === null && dm.excluded === false) {
      inScopeCount.set(r.id_value, (inScopeCount.get(r.id_value) ?? 0) + 1)
    }
  }
  const doubled = [...inScopeCount.entries()].filter(([, n]) => n > 1)
  if (doubled.length === 0) {
    console.log(`  OK — all ${inScopeCount.size} FDA submissions resolve to exactly one in-scope device.`)
  } else {
    console.error(`  FAIL — ${doubled.length} submissions resolve to >1 in-scope device:`)
    for (const [sub, n] of doubled.slice(0, 20)) console.error(`    ${sub}: ${n}`)
  }
  console.log('\nAlso run pccpIngest in dry-run separately: anomaly count must not rise.')
}

main().catch((e) => { console.error(e); process.exit(1) })
