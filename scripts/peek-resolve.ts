import { config } from "dotenv"
config({ path: ".env.local" })
import { createAdminClient } from "../lib/supabase-admin"

const subs = ["K252856", "K252452", "K251096", "K250042", "K240926"]

async function main() {
  const admin = createAdminClient()
  const { data } = await admin
    .from("device_external_ids")
    .select("id_value, aletia_id")
    .eq("id_type", "fda_k_number")
    .in("id_value", subs)
  console.log("rows found:", data?.length ?? 0)
  console.log(data)
  const distinct = new Set((data ?? []).map(r => r.aletia_id))
  console.log("distinct aletia_ids these 5 K-numbers map to:", distinct.size, [...distinct])
}
main().catch(e => { console.error(e); process.exit(1) })