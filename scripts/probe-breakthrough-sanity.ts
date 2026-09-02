/**
 * scripts/probe-breakthrough-sanity.ts
 *
 * POSITIVE CONTROL for the "No breakthrough-sourced rows found" result.
 * READ-ONLY. Writes nothing.
 *
 *   npx tsx scripts/probe-breakthrough-sanity.ts
 *
 * WHY THIS EXISTS. probe-breakthrough-aiml.ts reported zero rows. Zero is also
 * exactly what PostgREST returns when Row Level Security is on and the key in
 * use has no SELECT policy for that table — no error, no warning, an empty
 * array. RLS went on across the whole schema on 26 Aug and the legacy
 * service_role key was deactivated during the rotation, so "empty" and
 * "invisible" are currently indistinguishable without a control.
 *
 * A zero you cannot tell apart from a permissions failure is not a finding.
 * This script establishes whether the client can see anything at all before
 * anyone believes a count of nothing.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');

  console.log(`\nkey in use: ${key.slice(0, 12)}…  (${key.startsWith('sb_secret_') ? 'NEW secret key' : key.startsWith('sb_publishable_') ? '⚠ PUBLISHABLE — RLS APPLIES' : 'legacy JWT'})\n`);

  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const count = async (table: string, apply?: (q: any) => any) => {
    let q = sb.from(table).select('*', { count: 'exact', head: true });
    if (apply) q = apply(q);
    const { count: n, error } = await q;
    return error ? `ERROR: ${error.message}` : String(n ?? 0);
  };

  console.log('── positive control: can this key see anything? ──────────────────');
  console.log(`  device_master  (all rows)          : ${await count('device_master')}`);
  console.log(`  device_external_ids (all rows)     : ${await count('device_external_ids')}`);
  console.log(`  ingestion_review_queue (all rows)  : ${await count('ingestion_review_queue')}`);
  console.log(`\n  If device_master is ~1,267 the key is fine and a zero below is REAL.`);
  console.log(`  If these are 0 or ERROR, the zero was a permissions artefact.\n`);

  console.log('── the breakthrough question ─────────────────────────────────────');
  console.log(`  breakthrough_designation IS TRUE   : ${await count('device_master', q => q.eq('breakthrough_designation', true))}`);
  console.log(`  breakthrough_designation IS FALSE  : ${await count('device_master', q => q.eq('breakthrough_designation', false))}`);
  console.log(`  breakthrough_designation IS NULL   : ${await count('device_master', q => q.is('breakthrough_designation', null))}`);
  console.log(`  id_value LIKE 'BREAKTHROUGH:%'     : ${await count('device_external_ids', q => q.like('id_value', 'BREAKTHROUGH:%'))}`);
  console.log(`  id_value ILIKE '%breakthrough%'    : ${await count('device_external_ids', q => q.ilike('id_value', '%breakthrough%'))}   <- looser, catches a different prefix`);
  console.log(`  id_type = 'legacy_unclassified'    : ${await count('device_external_ids', q => q.eq('id_type', 'legacy_unclassified'))}`);

  console.log('\n── ai_ml_integral across the whole index ─────────────────────────');
  console.log(`  ai_ml_integral IS TRUE             : ${await count('device_master', q => q.eq('ai_ml_integral', true))}`);
  console.log(`  ai_ml_integral IS FALSE            : ${await count('device_master', q => q.eq('ai_ml_integral', false))}`);
  console.log(`  ai_ml_integral IS NULL             : ${await count('device_master', q => q.is('ai_ml_integral', null))}   <- one COALESCE away from asserting AI`);
  console.log(`  live & public (not excluded/merged) : ${await count('device_master', q => q.eq('excluded', false).is('merged_into', null))}`);
  console.log('');
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
