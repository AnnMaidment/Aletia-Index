/**
 * scripts/fda-dedup-detect.ts   (READ-ONLY — no writes, ever)
 *
 * Detect same-product clusters among FDA-origin device_master rows and print a
 * banded report. Clustering lives in lib/fdaDedup.ts (shared with the apply
 * script, so report == what gets collapsed). This script only loads data and
 * reports. The merge-apply is scripts/fda-dedup-apply.ts (Band A) + a queue
 * seeder for B+C.
 *
 *   npx tsx scripts/fda-dedup-detect.ts                  # report to stdout
 *   npx tsx scripts/fda-dedup-detect.ts --json out.json  # + cluster JSON
 *   npx tsx scripts/fda-dedup-detect.ts --min 2          # min cluster size (default 2)
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { writeFileSync } from 'fs'
import { loadDedupFacts } from './_fdaDedupLoad'
import { clusterDevices, type Cluster } from '../lib/fdaDedup'

const jsonArg = process.argv.indexOf('--json')
const JSON_OUT = jsonArg !== -1 ? process.argv[jsonArg + 1] : null
const minArg = process.argv.indexOf('--min')
const MIN_CLUSTER = minArg !== -1 ? parseInt(process.argv[minArg + 1], 10) : 2

async function main() {
  const { facts } = await loadDedupFacts()
  const clusters = clusterDevices(facts)
    .filter((c) => c.members.length >= MIN_CLUSTER)
    .sort((a, b) => a.band.localeCompare(b.band) || b.members.length - a.members.length)

  report(clusters, facts.length)

  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify(clusters, null, 2))
    console.log(`\nCluster JSON written to ${JSON_OUT}`)
  }
}

function report(clusters: Cluster[], totalFdaDevices: number) {
  const byBand = { A: 0, B: 0, C: 0 }
  let absorbed = 0
  for (const c of clusters) { byBand[c.band]++; absorbed += c.members.length - 1 }

  console.log('\n=== FDA dedup — DRY-RUN cluster report ===')
  console.log(`FDA-attached in-scope devices scanned: ${totalFdaDevices}`)
  console.log(`Clusters found (size >= ${MIN_CLUSTER}): ${clusters.length}`)
  console.log(`  Band A (scriptable — exact name + single code): ${byBand.A}`)
  console.log(`  Band B (review — exact name, codes differ):      ${byBand.B}`)
  console.log(`  Band C (must queue — fuzzy family):              ${byBand.C}`)
  console.log(`Rows that would be absorbed (count drop): ${absorbed}`)
  console.log(`Projected device count after merge: ${totalFdaDevices - absorbed} (FDA-attached only)`)
  console.log('\n--- Decision 4 input ---')
  console.log(`If Band A alone is scripted: ${byBand.A} clusters auto, ${byBand.B + byBand.C} queued.`)
  console.log(`If all queued: ${clusters.length} merge proposals into the Session-1 queue UI.`)

  console.log('\n=== Clusters ===')
  for (const c of clusters) {
    console.log(`\n[Band ${c.band}] ${c.manufacturerKey}  "${c.nameKey}"  codes=[${c.productCodes.join(',') || '—'}]`)
    console.log(`  ${c.reason}`)
    console.log(`  survivor → ${c.proposedSurvivor}`)
    for (const m of c.members) {
      const mark = m.aletia_id === c.proposedSurvivor ? '  *survivor*' : ''
      console.log(`    ${m.aletia_id}  "${m.name ?? ''}"  subs=[${m.fdaIds.join(',')}]  `
        + `codes=[${m.productCodes.join(',') || '—'}]  decided=${m.earliestDecision ?? '?'}${mark}`)
    }
  }
  console.log('\nNOTHING WAS WRITTEN. This is a detection report only.')
}

main().catch((e) => { console.error(e); process.exit(1) })
