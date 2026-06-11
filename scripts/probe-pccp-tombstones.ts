/** READ-ONLY: PCCP data sitting on rows the dedup just tombstoned. Writes nothing. */
import { config } from 'dotenv'; config({ path: '.env.local' })
import { createAdminClient } from '../lib/supabase-admin'
async function main() {
  const admin = createAdminClient()
  // device_master rows that are merged (tombstones) but still carry PCCP status
  const { data, error } = await admin
    .from('device_master')
    .select('aletia_id, merged_into, pccp_status, pccp_authorized_date')
    .not('merged_into', 'is', null)
    .not('pccp_status', 'is', null)
  if (error) { console.error(error.message); process.exit(1) }
  if (!data || data.length === 0) {
    console.log('OK — no tombstoned device carries PCCP status. Nothing stranded.')
  } else {
    console.log(`${data.length} tombstoned device(s) carry PCCP status (would re-attach to survivor on next PCCP run):`)
    for (const r of data) console.log(`  ${r.aletia_id} → merged_into ${r.merged_into}  pccp=${r.pccp_status}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
