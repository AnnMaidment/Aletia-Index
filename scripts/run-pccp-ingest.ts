/**
 * scripts/run-pccp-ingest.ts
 *
 * Runs the authoritative PCCP ingest (same as POST /api/pccp-ingest, minus the
 * HTTP token layer). Use this once after the FDA dedup so the `approved` PCCP
 * status on absorbed submissions re-resolves onto their survivors (the moved
 * external ids now point at the survivor). The ingest only ever SETS 'approved'
 * from the FDA feed — it never downgrades — so it can't clobber existing status.
 *
 * Run BEFORE deploying the `merged_into IS NULL` read filter, so survivors carry
 * the approved status before the tombstones are hidden.
 *
 *   npx tsx scripts/run-pccp-ingest.ts
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
import { runPCCPIngest } from '../lib/pccpIngest'

async function main() {
  console.log('Running PCCP ingest…')
  const r = await runPCCPIngest()
  console.log('\n=== PCCP ingest result ===')
  console.log(`confirmed PCCP devices in feed: ${r.confirmed_pccp_devices}`)
  console.log(`enriched (status written):      ${r.enriched_existing}`)
  console.log(`already up to date:             ${r.already_up_to_date}`)
  console.log(`unmatched (anomaly logged):     ${r.unmatched_logged}   <-- must NOT jump vs before the dedup`)
  console.log(`errors:                         ${r.errors.length}`)
  for (const e of r.errors.slice(0, 20)) console.log(`   - ${e}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
