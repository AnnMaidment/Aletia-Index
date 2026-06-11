/**
 * scripts/backfill-eudamed-rawdata.ts
 *
 * Backfill raw_data on pending 'eudamed_sync' queue rows from the live EUDAMED
 * udiDiData detail endpoint. The crosswalk seed (scripts/seed-eudamed.ts) only
 * carried trade name + manufacturer from the crosswalk JSON — risk_class was
 * seeded null and medical_purpose absent — so the queue rewrite's merge diff
 * has no eu_risk_class to offer as an enrich row. This recovers what the
 * detail endpoint actually serves (live-confirmed 9 June 2026):
 *
 *   RETRIEVABLE:  riskClass.code → risk_class (parsed, e.g. 'Class IIb'),
 *                 tradeName.textByDefaultLanguage (fills a null device name),
 *                 cndNomenclatures[0] → emdn_code/emdn_description,
 *                 additionalDescription, deviceStatus.type.code.
 *   NOT RETRIEVABLE (do not expect them here): medical_purpose, notified_body,
 *                 legislation, certificates — all live on the Basic UDI record,
 *                 which the public API does not serve as of 9 June 2026
 *                 (EUDAMED-STEP-0A-FINDINGS.md §2 correction). Deferred to the
 *                 post-NB-mandate backfill. intended_use therefore stays absent
 *                 from EU merge diffs for now — that is correct, not a gap.
 *
 * Merge-into raw_data, never replace: existing keys are preserved; only the
 * fetched fields (+ backfilled_at) are added/updated. device_name in raw_data
 * is only filled when currently null/empty — the crosswalk name was what the
 * candidates were scored against, so it is not overwritten.
 *
 * REVERSIBLE-ish: raw_data is mutated in place (queue rows only — device_master
 * untouched). --apply writes a rollback file with each row's prior raw_data.
 * Prod is Free-plan (no automated backups) — snapshot first anyway.
 *
 *   npx tsx scripts/backfill-eudamed-rawdata.ts            # DRY RUN — fetch + report, no writes
 *   npx tsx scripts/backfill-eudamed-rawdata.ts --apply    # write
 *   npx tsx scripts/backfill-eudamed-rawdata.ts --limit 5  # probe a few first
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { writeFileSync } from 'fs'
import { createAdminClient } from '../lib/supabase-admin'
import { fetchUdiDetail, parseRiskClass } from '../lib/eudamed'

const APPLY = process.argv.includes('--apply')
const limitArg = process.argv.indexOf('--limit')
const LIMIT = limitArg !== -1 ? parseInt(process.argv[limitArg + 1], 10) : Infinity

// EUDAMED rate-limits aggressively; same polite delay the probe/client use.
const REQUEST_DELAY_MS = 400
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface QueueRowSlim {
  queue_id: string
  source_id: string
  device_name: string | null
  raw_data: Record<string, unknown> | null
}

async function main() {
  const admin = createAdminClient()

  // Page through every pending eudamed_sync row (227 expected; PAGE well above).
  const rows: QueueRowSlim[] = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await admin
      .from('ingestion_review_queue')
      .select('queue_id, source_id, device_name, raw_data')
      .eq('source', 'eudamed_sync')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .range(from, from + 499)
    if (error) {
      console.error(`Queue fetch failed: ${error.message}`)
      process.exit(1)
    }
    rows.push(...((data ?? []) as QueueRowSlim[]))
    if (!data || data.length < 500) break
  }

  console.log(`\n=== EUDAMED raw_data backfill (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`)
  console.log(`Pending eudamed_sync rows: ${rows.length}${Number.isFinite(LIMIT) ? ` (limited to ${LIMIT})` : ''}\n`)

  const work = rows.slice(0, Number.isFinite(LIMIT) ? LIMIT : rows.length)
  const rollback: Array<{ queue_id: string; raw_data: unknown }> = []
  let updated = 0
  let alreadyBackfilled = 0
  let fetchFailed = 0
  let writeFailed = 0
  let gotRiskClass = 0
  let filledName = 0
  let sampleShown = false

  for (const row of work) {
    const raw = (row.raw_data ?? {}) as Record<string, unknown>

    if (raw.backfilled_at) {
      alreadyBackfilled++
      continue
    }

    await sleep(REQUEST_DELAY_MS)
    const detail = await fetchUdiDetail(row.source_id)
    if (!detail) {
      fetchFailed++
      console.warn(`  detail fetch failed for ${row.source_id} (${row.device_name ?? 'no name'})`)
      continue
    }

    const riskClass = parseRiskClass(detail.riskClass?.code)
    const tradeName = detail.tradeName?.textByDefaultLanguage ?? null
    const emdn = detail.cndNomenclatures?.find((c) => c.code) ?? null

    const patch: Record<string, unknown> = {
      risk_class: riskClass,                                          // was seeded null
      emdn_code: emdn?.code ?? null,
      emdn_description: emdn?.description?.textByDefaultLanguage ?? null,
      additional_description: detail.additionalDescription ?? null,
      device_status: detail.deviceStatus?.type?.code ?? null,
      backfilled_at: new Date().toISOString(),
    }
    // Fill raw_data.device_name only when the crosswalk left it empty.
    const existingName = typeof raw.device_name === 'string' ? raw.device_name.trim() : ''
    if (!existingName && tradeName) {
      patch.device_name = tradeName
      filledName++
    }
    if (riskClass) gotRiskClass++

    if (!sampleShown) {
      console.log('First fetched sample (verify before --apply):')
      console.log(JSON.stringify({ queue_id: row.queue_id, source_id: row.source_id, patch }, null, 2))
      console.log('')
      sampleShown = true
    }

    if (!APPLY) {
      updated++
      continue
    }

    rollback.push({ queue_id: row.queue_id, raw_data: row.raw_data })
    const { error } = await admin
      .from('ingestion_review_queue')
      .update({ raw_data: { ...raw, ...patch } })
      .eq('queue_id', row.queue_id)
      .eq('status', 'pending') // never touch a row dispositioned mid-run
    if (error) {
      writeFailed++
      console.warn(`  update failed for ${row.queue_id}: ${error.message}`)
      continue
    }
    updated++
  }

  if (APPLY && rollback.length) {
    const file = `scripts/backfill-eudamed-rawdata.rollback.${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    writeFileSync(file, JSON.stringify(rollback, null, 2))
    console.log(`Rollback file (prior raw_data per row): ${file}`)
  }

  console.log('\n=== Summary ===')
  console.log(`${APPLY ? 'Updated' : 'Would update'}: ${updated}`)
  console.log(`Risk class recovered: ${gotRiskClass}`)
  console.log(`device_name filled (was empty): ${filledName}`)
  console.log(`Skipped — already backfilled: ${alreadyBackfilled}`)
  console.log(`Detail fetch failed: ${fetchFailed}`)
  if (APPLY) console.log(`Write failed: ${writeFailed}`)
  if (!APPLY) console.log('\nDry run only — re-run with --apply to write.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
