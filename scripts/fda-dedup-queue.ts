/**
 * scripts/fda-dedup-queue.ts
 *
 * Seed Band B + Band C same-product clusters into the review queue as dedup
 * proposals. Band A is scripted (scripts/fda-dedup-apply.ts); this is the
 * "queue B+C" half of Decision 4.
 *
 * One queue row per cluster (source='fda_dedup'). The cluster travels in
 * raw_data; the admin drawer renders it as a "collapse these N into the
 * survivor" panel where the operator can re-pick the survivor and select a
 * subset to absorb (the brand-family split, e.g. Aidoc BriefCase). The disposition
 * is applied by /api/admin/queue/dedup-merge, NOT the ordinary accept route
 * (which can't tombstone a sibling device_master row).
 *
 * Idempotent: skips a cluster that already has a pending fda_dedup row for its
 * proposed survivor. Dry-run default; --apply inserts; rollback file lists the
 * created queue_ids.
 *
 *   npx tsx scripts/fda-dedup-queue.ts            # DRY RUN
 *   npx tsx scripts/fda-dedup-queue.ts --apply
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { writeFileSync } from 'fs'
import { createAdminClient } from '../lib/supabase-admin'
import { loadDedupFacts } from './_fdaDedupLoad'
import { clusterDevices, type Cluster } from '../lib/fdaDedup'

const APPLY = process.argv.includes('--apply')

interface DedupRawData {
  kind: 'fda_dedup'
  band: 'B' | 'C'
  proposed_survivor: string
  name_key: string
  product_codes: string[]
  members: Array<{
    aletia_id: string
    name: string | null
    fda_ids: string[]
    product_codes: string[]
    earliest_decision: string | null
  }>
}

function toRawData(c: Cluster): DedupRawData {
  return {
    kind: 'fda_dedup',
    band: c.band as 'B' | 'C',
    proposed_survivor: c.proposedSurvivor,
    name_key: c.nameKey,
    product_codes: c.productCodes,
    members: c.members.map((m) => ({
      aletia_id: m.aletia_id,
      name: m.name,
      fda_ids: m.fdaIds,
      product_codes: m.productCodes,
      earliest_decision: m.earliestDecision,
    })),
  }
}

async function main() {
  const admin = createAdminClient()
  const { facts } = await loadDedupFacts()
  const clusters = clusterDevices(facts).filter((c) => c.band !== 'A' && c.members.length >= 2)

  console.log(`\n=== FDA dedup queue seeder (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`)
  console.log(`Band B+C clusters: ${clusters.length}`)
  console.log(`  Band B: ${clusters.filter((c) => c.band === 'B').length}`)
  console.log(`  Band C: ${clusters.filter((c) => c.band === 'C').length}`)

  // Idempotency: existing pending fda_dedup rows keyed by survivor (source_id).
  const { data: existing, error: exErr } = await admin
    .from('ingestion_review_queue')
    .select('source_id')
    .eq('source', 'fda_dedup')
    .eq('status', 'pending')
  if (exErr) { console.error(`existing-row check failed: ${exErr.message}`); process.exit(1) }
  const already = new Set((existing ?? []).map((r) => r.source_id as string))

  const created: string[] = []
  let skipped = 0
  let inserted = 0

  for (const c of clusters) {
    if (already.has(c.proposedSurvivor)) { skipped++; continue }

    const survivorFacts = c.members.find((m) => m.aletia_id === c.proposedSurvivor)
    const row = {
      source: 'fda_dedup',
      source_id: c.proposedSurvivor,
      device_name: survivorFacts?.name ?? null,
      manufacturer: survivorFacts?.manufacturer_name ?? null,
      review_reason: `fda_same_product_${c.band}`,
      raw_data: toRawData(c),
      possible_merge_candidates: null,
      status: 'pending',
    }

    if (!APPLY) {
      if (inserted < 2) console.log(`\nwould insert:\n${JSON.stringify(row, null, 2)}`)
      inserted++
      continue
    }

    const { data, error } = await admin
      .from('ingestion_review_queue')
      .insert(row)
      .select('queue_id')
      .single()
    if (error) { console.error(`  insert failed for ${c.proposedSurvivor}: ${error.message}`); continue }
    created.push(data.queue_id as string)
    inserted++
  }

  if (APPLY && created.length) {
    const file = `scripts/fda-dedup-queue.rollback.${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    writeFileSync(file, JSON.stringify({ created_queue_ids: created }, null, 2))
    console.log(`\nRollback file: ${file}`)
    console.log('Undo: DELETE FROM ingestion_review_queue WHERE queue_id = ANY(<created_queue_ids>);')
  }

  console.log(`\n${APPLY ? 'Inserted' : 'Would insert'}: ${inserted}; skipped (already queued): ${skipped}`)
  if (!APPLY) console.log('Dry run only — re-run with --apply to insert.')
}

main().catch((e) => { console.error(e); process.exit(1) })
