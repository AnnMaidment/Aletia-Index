/**
 * scripts/apply-scope-decisions.ts
 *
 * Apply the CT.gov in-scope audit decisions to the queue (and, optionally, to
 * the public device_master rows for already-approved rejects).
 *
 * Reads scope-decisions.csv (produced from the reviewed workbook):
 *   queue_id, nct_id, status, action, scope_category, revised_recommendation
 * where action is 'keep' or 'reject'.
 *
 * SAFETY MODEL
 *   - Default is DRY RUN. Nothing is written without --apply.
 *   - Queue rejections are reversible (status='rejected', re-openable) and are
 *     the primary action. --apply requires --expect=N matching the planned
 *     queue-reject count (drift guard).
 *   - device_master exclusion (for already-approved rejects) is PUBLIC-FACING
 *     and gated behind a separate --exclude-approved-devices flag. Even in dry
 *     run the script prints each approved-reject device's mapping (aletia_id,
 *     whether it ALSO has an FDA K-number, merge status) so you can confirm you
 *     aren't hiding a device that's legitimately in-scope via an FDA clearance.
 *   - A JSON snapshot of every affected row's pre-change state is written before
 *     any --apply write.
 *
 * Usage:
 *   npx tsx scripts/apply-scope-decisions.ts --file=scope-decisions.csv            # dry run
 *   npx tsx scripts/apply-scope-decisions.ts --file=scope-decisions.csv --apply --expect=150
 *   npx tsx scripts/apply-scope-decisions.ts --file=scope-decisions.csv --apply --expect=150 --exclude-approved-devices
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const EXCLUDE_DEVICES = argv.includes('--exclude-approved-devices');
function arg(name: string, def?: string): string | undefined {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : def;
}
const FILE = arg('file', 'scope-decisions.csv')!;
const EXPECT = arg('expect');

const REVIEWER = 'ct-scope-audit-2026-06';
const DEVICE_EXCLUDE_REASON = 'ct.gov scope audit: not an AI/ML medical device';

interface Decision {
  queue_id: string;
  nct_id: string;
  status_audit: string;
  action: 'keep' | 'reject';
  scope_category: string;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function loadDecisions(path: string): Decision[] {
  const text = readFileSync(path, 'utf-8').replace(/\r/g, '');
  const lines = text.split('\n').filter((l) => l.length);
  const header = parseCsvLine(lines[0]);
  const idx = (name: string) => header.indexOf(name);
  const iQ = idx('queue_id'), iN = idx('nct_id'), iS = idx('status'), iA = idx('action'), iC = idx('scope_category');
  if (iQ < 0 || iA < 0) throw new Error('CSV missing queue_id/action columns');
  const rows: Decision[] = [];
  for (let i = 1; i < lines.length; i++) {
    const f = parseCsvLine(lines[i]);
    rows.push({
      queue_id: f[iQ],
      nct_id: iN >= 0 ? f[iN] : '',
      status_audit: iS >= 0 ? f[iS] : '',
      action: (f[iA] === 'reject' ? 'reject' : 'keep'),
      scope_category: iC >= 0 ? f[iC] : '',
    });
  }
  return rows;
}

async function fetchLiveQueue(supabase: SupabaseClient, ids: string[]) {
  const live = new Map<string, { status: string; source: string }>();
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('ingestion_review_queue')
      .select('queue_id, status, source')
      .in('queue_id', slice);
    if (error) throw new Error(`queue fetch: ${error.message}`);
    for (const r of data ?? []) live.set(r.queue_id, { status: r.status, source: r.source });
  }
  return live;
}

/** For an approved-reject NCT, resolve the device it maps to and its risk flags. */
async function resolveDevice(supabase: SupabaseClient, nct: string) {
  const { data: ext, error } = await supabase
    .from('device_external_ids')
    .select('aletia_id')
    .eq('id_type', 'nct')
    .eq('id_value', nct);
  if (error) throw new Error(`ext fetch: ${error.message}`);
  const aletiaIds = Array.from(new Set((ext ?? []).map((e) => e.aletia_id)));
  const results = [];
  for (const aid of aletiaIds) {
    const { data: dev } = await supabase
      .from('device_master')
      .select('aletia_id, excluded, merged_into')
      .eq('aletia_id', aid)
      .maybeSingle();
    const { data: others } = await supabase
      .from('device_external_ids')
      .select('id_type')
      .eq('aletia_id', aid);
    const idTypes = (others ?? []).map((o) => o.id_type);
    const hasFda = idTypes.some((t) => String(t).startsWith('fda_'));
    results.push({
      aletia_id: aid,
      excluded: dev?.excluded ?? null,
      merged_into: dev?.merged_into ?? null,
      also_has_fda: hasFda,
      id_types: idTypes,
    });
  }
  return results;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (.env.local)');
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const decisions = loadDecisions(FILE);
  const rejects = decisions.filter((d) => d.action === 'reject');
  const keeps = decisions.filter((d) => d.action === 'keep');

  const live = await fetchLiveQueue(supabase, decisions.map((d) => d.queue_id));

  const toRejectPending: Decision[] = [];
  const toRejectApproved: Decision[] = [];
  const alreadyRejected: Decision[] = [];
  const missing: Decision[] = [];
  const otherStatus: { d: Decision; cur: string }[] = [];

  for (const d of rejects) {
    const cur = live.get(d.queue_id);
    if (!cur) { missing.push(d); continue; }
    if (cur.status === 'rejected') { alreadyRejected.push(d); continue; }
    if (cur.status === 'approved') toRejectApproved.push(d);
    else if (cur.status === 'pending') toRejectPending.push(d);
    else otherStatus.push({ d, cur: cur.status });
  }

  const queueRejectCount = toRejectPending.length + toRejectApproved.length;

  console.log(`\nscope decisions: ${decisions.length} rows  (${keeps.length} keep, ${rejects.length} reject)`);
  console.log(`\nplan:`);
  console.log(`  reject pending  → queue status='rejected'   : ${toRejectPending.length}`);
  console.log(`  reject approved → queue status='rejected'   : ${toRejectApproved.length}  (also public devices — see below)`);
  console.log(`  already rejected (skip, idempotent)         : ${alreadyRejected.length}`);
  console.log(`  keep (no-op)                                : ${keeps.length}`);
  if (missing.length) console.log(`  ⚠ queue_id not found in DB (skip)          : ${missing.length}`);
  if (otherStatus.length) {
    console.log(`  ⚠ unexpected status (skip): ${otherStatus.length}`);
    for (const o of otherStatus) console.log(`      ${o.d.queue_id.slice(0, 8)}  status=${o.cur}`);
  }
  console.log(`\n  → queue rows that WILL be rejected: ${queueRejectCount}  (use --expect=${queueRejectCount})`);

  // Always surface the approved-reject device mappings (dry run included).
  if (toRejectApproved.length) {
    console.log(`\napproved-reject device mappings (review before excluding — anything with also_has_fda=YES`);
    console.log(`may be a legitimate FDA device the trial merely merged into):`);
    for (const d of toRejectApproved) {
      const devs = await resolveDevice(supabase, d.nct_id);
      if (!devs.length) { console.log(`  ${d.nct_id}  → (no device_master row found via nct)`); continue; }
      for (const dev of devs) {
        console.log(
          `  ${d.nct_id}  → ${dev.aletia_id}  excluded=${dev.excluded}  merged_into=${dev.merged_into ?? '—'}` +
          `  also_has_fda=${dev.also_has_fda ? 'YES ⚠' : 'no'}  [${dev.id_types.join(',')}]`
        );
      }
    }
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply --expect=${queueRejectCount}` +
      (toRejectApproved.length ? ` [--exclude-approved-devices]` : ''));
    return;
  }

  // ---- APPLY ----
  if (EXPECT === undefined || Number(EXPECT) !== queueRejectCount) {
    console.error(`\nABORT: --expect=${EXPECT ?? '(none)'} does not match planned queue rejects ${queueRejectCount}.`);
    process.exit(1);
  }

  // Snapshot before writing.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const snapshot = {
    when: new Date().toISOString(),
    queue_rejects: [...toRejectPending, ...toRejectApproved].map((d) => ({
      queue_id: d.queue_id, nct_id: d.nct_id, prev_status: live.get(d.queue_id)?.status, scope_category: d.scope_category,
    })),
  };
  const snapPath = `scope-apply-snapshot-${stamp}.json`;
  writeFileSync(snapPath, JSON.stringify(snapshot, null, 2), 'utf-8');
  console.log(`\nsnapshot → ${snapPath}`);

  let rejected = 0;
  for (const d of [...toRejectPending, ...toRejectApproved]) {
    const { error } = await supabase
      .from('ingestion_review_queue')
      .update({
        status: 'rejected',
        review_reason: `out-of-scope: ${d.scope_category || 'not AI/ML device'}`.slice(0, 300),
        reviewed_by: REVIEWER,
        reviewed_at: new Date().toISOString(),
      })
      .eq('queue_id', d.queue_id);
    if (error) console.error(`  reject failed ${d.queue_id}: ${error.message}`);
    else rejected++;
  }
  console.log(`queue rejected: ${rejected}/${queueRejectCount}`);

  if (EXCLUDE_DEVICES && toRejectApproved.length) {
    let excluded = 0;
    for (const d of toRejectApproved) {
      const devs = await resolveDevice(supabase, d.nct_id);
      for (const dev of devs) {
        if (dev.excluded) continue;
        const { error } = await supabase
          .from('device_master')
          .update({ excluded: true, excluded_reason: DEVICE_EXCLUDE_REASON })
          .eq('aletia_id', dev.aletia_id);
        if (error) console.error(`  exclude failed ${dev.aletia_id}: ${error.message}`);
        else { excluded++; console.log(`  excluded ${dev.aletia_id} (${d.nct_id})`); }
      }
    }
    console.log(`devices excluded: ${excluded}`);
  } else if (toRejectApproved.length) {
    console.log(`\n⚠ ${toRejectApproved.length} approved rejects remain PUBLIC in device_master.`);
    console.log(`  Review the mappings above, then re-run with --exclude-approved-devices to hide them.`);
  }
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
