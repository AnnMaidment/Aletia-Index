/**
 * scripts/verify-sec003.ts
 *
 * Verifies that SEC-003 actually closed the claim-token exposure, using the
 * PUBLISHABLE key — the same key that ships in the site's JavaScript and that
 * an attacker would use. READ-ONLY.
 *
 *   npx tsx scripts/verify-sec003.ts
 *
 * Every check is paired with a POSITIVE CONTROL. A failed query proves nothing
 * on its own — a wrong URL, an expired key or a typo'd table name all fail the
 * same way as a successful revoke. The controls establish that the client can
 * reach the database and read what it is still supposed to read, so that a
 * failure on the token columns means what we want it to mean.
 *
 * (This is the same trap the breakthrough probe fell into on 31 Aug: it
 * reported zero rows, and zero is also what RLS returns when a key has no
 * policy.)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let pass = 0, fail = 0;

async function control(label: string, run: () => Promise<{ error: unknown }>) {
  const { error } = await run();
  if (error) { fail++; console.log(`  ✗ CONTROL BROKEN  ${label}\n      ${(error as { message?: string }).message}`); }
  else { pass++; console.log(`  ✓ control ok       ${label}`); }
}

async function sealed(label: string, run: () => Promise<{ error: unknown; data: unknown }>) {
  const { error, data } = await run();
  if (error) { pass++; console.log(`  ✓ SEALED           ${label}\n      rejected: ${(error as { message?: string }).message}`); }
  else if (Array.isArray(data) && data.length === 0) { pass++; console.log(`  ✓ SEALED           ${label}  (no rows returned)`); }
  else {
    // NEVER print the value. This script tests for an exposed secret; echoing
    // the secret into a terminal, a screenshot or a chat is the same leak by
    // another route. Report the SHAPE only: which columns came back, and
    // whether each held a value. (Learned the hard way on 31 Aug — the first
    // version of this script printed two live claim tokens into a transcript.)
    fail++;
    const row = Array.isArray(data) && data.length ? (data[0] as Record<string, unknown>) : {};
    const shape = Object.entries(row)
      .map(([k, v]) => `${k}=${v === null ? 'null' : '<redacted, non-null>'}`)
      .join(', ');
    console.log(`  ✗ STILL EXPOSED    ${label}\n      the query succeeded and returned: ${shape || '(empty row)'}`);
  }
}

async function main() {
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local');
  console.log(`\nkey: ${key.slice(0, 14)}…  (${key.startsWith('sb_publishable_') ? 'publishable — correct for this test' : key.startsWith('sb_secret_') ? '⚠ SECRET KEY — this test is meaningless, put the PUBLISHABLE key here' : 'legacy JWT'})`);
  console.log(`url: ${url}\n`);

  const anon = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  console.log('── controls: the public site must still work ─────────────────────');
  await control('device_master rows are readable',
    () => anon.from('device_master').select('aletia_id, name, manufacturer_name').limit(1));
  await control('manufacturers rows are readable',
    () => anon.from('manufacturers').select('name, hq_location, tier, claimed_at, website, contact_visible').limit(1));
  await control('the /device/[id] embed shape still resolves',
    () => anon.from('device_master').select('aletia_id, manufacturers(name, hq_location)').limit(1));

  console.log('\n── the exposure: all three must now be sealed ────────────────────');
  await sealed('device_master.claim_token',
    () => anon.from('device_master').select('aletia_id, claim_token').limit(1));
  await sealed('manufacturers.claim_token',
    () => anon.from('manufacturers').select('id, claim_token').limit(1));
  await sealed('claim_requests.token  (whole table sealed)',
    () => anon.from('claim_requests').select('id, token').limit(1));

  console.log('\n── personal data on public tables ────────────────────────────────');
  await sealed('device_master.claimed_by_email',
    () => anon.from('device_master').select('aletia_id, claimed_by_email').limit(1));
  await sealed('manufacturers.contact_email',
    () => anon.from('manufacturers').select('id, contact_email').limit(1));

  console.log(`\n${'─'.repeat(66)}`);
  if (fail === 0) console.log(`  ✅ ${pass}/${pass} — SEC-003 is closed and the public site still reads.\n`);
  else console.log(`  ❌ ${fail} check(s) failed. Read them above before believing anything.\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
