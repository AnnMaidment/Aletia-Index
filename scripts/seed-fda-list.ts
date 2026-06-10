/**
 * scripts/seed-fda-list.ts
 *
 * Seeds device_master from the FDA's published AI/ML list — the authoritative
 * discovery seed. Standalone local equivalent of the PUT ?phase=list route, so
 * it runs the same way as the other scripts (no dev server, no HTTP, no Vercel
 * timeout). Each list entry flows through the 4d gate via ingestFdaDevice:
 *   - identifier already known          → updated_existing (graduation applied)
 *   - matches a merge candidate         → queued_for_review
 *   - new                               → created_new (auto-create; onList=true)
 *
 * This is the step that must run BEFORE the prune: it creates the ~1,000 list
 * devices not yet in the DB and reconciles the ones already there, so the prune
 * keeps the full list (~1,430) instead of only the handful already present.
 *
 * Run from repo root (writes to prod via the service-role key in .env.local):
 *   npx tsx scripts/seed-fda-list.ts --limit 20     # smoke test: first 20 entries only
 *   npx tsx scripts/seed-fda-list.ts                # full run
 *   npx tsx scripts/seed-fda-list.ts --offset 800   # resume from entry 800
 *   npx tsx scripts/seed-fda-list.ts --delay-ms 50  # add a pause between devices
 *
 * Requires .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * After this completes, re-run the prune dry-run — "on the FDA list — KEEP"
 * should jump toward ~1,430 and the prune fraction should fall under the 90%
 * guard. If it does NOT jump, stop: stored identifiers aren't matching the list.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { fetchFdaAiMlList } from '../lib/fdaList'
import { ingestFdaDevice, type IngestResult } from '../lib/fdaSync'

function intArg(flag: string, fallback: number): number {
  const i = process.argv.indexOf(flag)
  if (i === -1 || i + 1 >= process.argv.length) return fallback
  const n = parseInt(process.argv[i + 1], 10)
  return Number.isFinite(n) ? n : fallback
}

const OFFSET = Math.max(0, intArg('--offset', 0))
const LIMIT = intArg('--limit', -1) // -1 ⇒ no cap
const DELAY_MS = Math.max(0, intArg('--delay-ms', 0))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  console.log('\n=== FDA list seed ===')

  const list = await fetchFdaAiMlList()
  if (!list.length) {
    console.error('ABORT: FDA list returned no entries — verify the CSV media URL still resolves.')
    process.exit(1)
  }

  const end = LIMIT >= 0 ? Math.min(OFFSET + LIMIT, list.length) : list.length
  const slice = list.slice(OFFSET, end)
  console.log(`List has ${list.length} entries; processing ${slice.length} (offset ${OFFSET}…${end}).\n`)

  const counters: Record<IngestResult['action'], number> = {
    updated_existing: 0,
    created_new: 0,
    queued_for_review: 0,
    already_queued: 0,
    skipped_class_1: 0,
    failed: 0,
  }
  const failures: { identifier: string; error?: string }[] = []

  let done = 0
  for (const e of slice) {
    const result = await ingestFdaDevice({
      identifier: e.identifier,
      id_type: e.id_type,
      device_name: e.device_name,
      applicant: e.applicant,
      product_code: e.product_code,
      decision_date: e.decision_date,
      clearance_type: e.pathway,
      onList: true,
      source: 'fda_list',
    })

    counters[result.action]++
    if (result.action === 'failed') failures.push({ identifier: result.identifier, error: result.error })

    done++
    if (done % 50 === 0 || done === slice.length) {
      const c = counters
      console.log(
        `  ${done}/${slice.length}  ` +
        `created=${c.created_new} updated=${c.updated_existing} ` +
        `queued=${c.queued_for_review + c.already_queued} ` +
        `skippedClassI=${c.skipped_class_1} failed=${c.failed}`,
      )
    }

    if (DELAY_MS) await sleep(DELAY_MS)
  }

  console.log('\n=== Summary ===')
  console.log(`Processed          : ${slice.length}`)
  console.log(`  created_new      : ${counters.created_new}`)
  console.log(`  updated_existing : ${counters.updated_existing}`)
  console.log(`  queued_for_review: ${counters.queued_for_review}`)
  console.log(`  already_queued   : ${counters.already_queued}`)
  console.log(`  skipped_class_1  : ${counters.skipped_class_1}`)
  console.log(`  failed           : ${counters.failed}`)

  if (failures.length) {
    console.log(`\nFirst ${Math.min(15, failures.length)} failures:`)
    for (const f of failures.slice(0, 15)) console.log(`  ${f.identifier}: ${f.error ?? 'unknown'}`)
  }

  console.log('\nNext: re-run the prune dry-run and confirm "on the FDA list — KEEP" ≈ list size.')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
