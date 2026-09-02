/**
 * scripts/dump-database.ts
 *
 * Full data backup of the Supabase project. READ-ONLY — writes nothing to the
 * database.
 *
 *   npx tsx scripts/dump-database.ts
 *   npx tsx scripts/dump-database.ts --out=D:/backups
 *
 * WHY THIS EXISTS. The project is on the Supabase free plan, which has no
 * automated backups, and the repo's migrations no longer describe the live
 * schema (external_legacy_id and description are queried by app/page.tsx and
 * appear in no CREATE TABLE or ADD COLUMN anywhere in supabase/migrations).
 * Until that drift is reconciled, a loss of the database is unrecoverable:
 * 6,203 device rows, 946 queue rows, 1,088 human-reviewed specialty writes and
 * 487 labelled scope decisions exist in exactly one place.
 *
 * This captures the DATA. It does NOT capture schema, functions, RLS policies
 * or grants — PostgREST cannot see those. That is the separate baseline job.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ THE OUTPUT CONTAINS SECRETS AND PERSONAL DATA.
 *
 * claim_requests.token and manufacturers.claim_token are claim tokens: whoever
 * holds one can take control of a listing. The dump also carries requester
 * emails, contact names and claimed_by_email.
 *
 * THIS REPOSITORY IS PUBLIC. The script writes to backups/, and adds backups/
 * to .gitignore on first run, but do not rely on that alone — check `git status`
 * before your next commit. Move the dump somewhere durable and private
 * (encrypted cloud storage, an external drive) and do not leave it as the only
 * copy inside a working tree.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * THE 1,000-ROW TRAP. PostgREST caps a response at 1,000 rows by default. A
 * naive select on device_master returns 1,000 of 6,203 and reports no error at
 * all — the same class of silent-truncation failure as an RLS empty result.
 * Every table here is paged, and every table's row count is fetched separately
 * BEFORE paging and asserted against what was written. A dump that cannot prove
 * it is complete is marked INCOMPLETE in the manifest and the script exits
 * non-zero. A backup you cannot verify is not a backup.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync, existsSync, readFileSync, appendFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const PAGE = 1000;

/** Every table in the public schema, from 20260826120000_enable_rls.sql. */
const TABLES = [
  'device_master', 'device_external_ids', 'manufacturers',
  'regional_registrations', 'device_trials', 'tech_specs',
  'clinical_audits', 'pre_approval_profile',
  'ingestion_review_queue', 'ingestion_anomalies', 'specialty_taxonomy',
  'claim_requests', 'admin_users', 'audit_log', 'ingest_runs',
];

/**
 * Preferred sort keys. Paging needs a stable ORDER BY; this does not have to be
 * unique, only consistent between requests.
 *
 * `id` comes first deliberately. On the child tables (device_external_ids,
 * ingestion_anomalies) `id` is the primary key while `aletia_id` is a FOREIGN
 * key — one device legitimately holds several rows. device_master has no `id`
 * column, so it falls through to `aletia_id`, which is its primary key.
 */
const SORT_CANDIDATES = [
  'id', 'aletia_id', 'queue_id', 'device_id', 'specialty_name',
  'run_id', 'anomaly_id', 'created_at',
];

function arg(name: string, def?: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : def;
}

interface TableResult {
  table: string;
  expected: number | null;
  written: number;
  duplicateRows: number | null;
  sortKey: string | null;
  file: string | null;
  bytes: number | null;
  sha256: string | null;
  status: 'ok' | 'INCOMPLETE' | 'ERROR';
  note?: string;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local');
  }
  if (key.startsWith('sb_publishable_')) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY holds a PUBLISHABLE key. RLS would silently hide ' +
      'the sealed tables and the dump would look complete while missing them. Aborting.',
    );
  }

  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const base = arg('out', 'backups')!;
  const dir = join(base, `aletia-${stamp}`);
  mkdirSync(dir, { recursive: true });

  // Keep the dump out of a PUBLIC repo. Belt as well as braces — the header
  // says not to rely on this alone.
  try {
    const gi = existsSync('.gitignore') ? readFileSync('.gitignore', 'utf-8') : '';
    if (!/^backups\/?$/m.test(gi)) {
      appendFileSync('.gitignore', `${gi.endsWith('\n') || gi === '' ? '' : '\n'}\n# database dumps — contain claim tokens and personal data\nbackups/\n`, 'utf-8');
      console.log('  added backups/ to .gitignore');
    }
  } catch { /* non-fatal */ }

  console.log(`\ndumping ${TABLES.length} tables → ${dir}\n`);
  console.log(`  ${'table'.padEnd(24)} ${'expected'.padStart(8)} ${'written'.padStart(8)} ${'dup rows'.padStart(9)}  status`);
  console.log(`  ${'─'.repeat(24)} ${'─'.repeat(8)} ${'─'.repeat(8)} ${'─'.repeat(9)}  ──────`);

  const results: TableResult[] = [];

  for (const table of TABLES) {
    const r: TableResult = {
      table, expected: null, written: 0, duplicateRows: null,
      sortKey: null, file: null, bytes: null, sha256: null, status: 'ok',
    };

    try {
      // 1. Count FIRST, separately. This is the number the dump is checked against.
      const { count, error: cErr } = await sb.from(table).select('*', { count: 'exact', head: true });
      if (cErr) throw new Error(cErr.message);
      r.expected = count ?? 0;

      // 2. Pick a sort key from a real row. Range paging without ORDER BY is
      //    not stable — Postgres may return rows in any order between requests.
      const { data: probe, error: pErr } = await sb.from(table).select('*').limit(1);
      if (pErr) throw new Error(pErr.message);
      const cols = probe && probe.length ? Object.keys(probe[0] as object) : [];
      r.sortKey = SORT_CANDIDATES.find((c) => cols.includes(c)) ?? cols[0] ?? null;

      // 3. Page through everything.
      const rows: Record<string, unknown>[] = [];
      if (r.expected > 0) {
        for (let from = 0; ; from += PAGE) {
          let q = sb.from(table).select('*').range(from, from + PAGE - 1);
          if (r.sortKey) q = q.order(r.sortKey, { ascending: true });
          const { data, error } = await q;
          if (error) throw new Error(error.message);
          if (!data || data.length === 0) break;
          rows.push(...(data as Record<string, unknown>[]));
          if (data.length < PAGE) break;
          if (rows.length > (r.expected ?? 0) * 2 + PAGE) {
            throw new Error('paging overran twice the expected row count — unstable sort key');
          }
        }
      }
      r.written = rows.length;

      // 4. Exact duplicate ROWS. This is the real test for a paging fault: an
      //    unstable ORDER BY hands you the same record twice, and two identical
      //    records is what that looks like.
      //
      //    The first version of this check counted distinct values of the sort
      //    key instead, and cried wolf on 2 Sept: device_external_ids came back
      //    "6203 rows but only 5953 distinct aletia_id". aletia_id is a FOREIGN
      //    key there — ALT-001021 holds four FDA K numbers, which is the entire
      //    purpose of the table. A repeated foreign key is data; a repeated row
      //    is a bug. Only the second is worth failing on.
      const seen = new Set<string>();
      let dupes = 0;
      for (const row of rows) {
        const h = JSON.stringify(row, Object.keys(row).sort());
        if (seen.has(h)) dupes++; else seen.add(h);
      }
      r.duplicateRows = dupes;

      const file = join(dir, `${table}.json`);
      const body = JSON.stringify(rows, null, 0);
      writeFileSync(file, body, 'utf-8');
      r.file = `${table}.json`;
      r.bytes = statSync(file).size;
      r.sha256 = createHash('sha256').update(body).digest('hex');

      if (r.written !== r.expected) {
        r.status = 'INCOMPLETE';
        r.note = `wrote ${r.written} of ${r.expected} rows`;
      } else if (r.duplicateRows) {
        r.status = 'INCOMPLETE';
        r.note = `${r.duplicateRows} exact duplicate row(s) — range paging returned the same record twice`;
      }
    } catch (e) {
      r.status = 'ERROR';
      r.note = (e as Error).message;
    }

    const mark = r.status === 'ok' ? '✓' : r.status === 'INCOMPLETE' ? '✗ INCOMPLETE' : '✗ ERROR';
    console.log(
      `  ${r.table.padEnd(24)} ${String(r.expected ?? '—').padStart(8)} ${String(r.written).padStart(8)} ` +
      `${String(r.duplicateRows ?? '—').padStart(9)}  ${mark}`,
    );
    if (r.note) console.log(`      ${r.note}`);
    results.push(r);
  }

  const bad = results.filter((x) => x.status !== 'ok');
  const totalRows = results.reduce((n, x) => n + x.written, 0);
  const totalBytes = results.reduce((n, x) => n + (x.bytes ?? 0), 0);

  const manifest = {
    created_at: new Date().toISOString(),
    supabase_url: url,
    generator: 'scripts/dump-database.ts',
    captures: 'table data only — NOT schema, functions, RLS policies or column grants',
    warning: 'contains claim tokens and personal data; the source repository is public',
    total_tables: results.length,
    total_rows: totalRows,
    total_bytes: totalBytes,
    complete: bad.length === 0,
    tables: results,
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  console.log(`\n  ${totalRows.toLocaleString()} rows, ${(totalBytes / 1024 / 1024).toFixed(1)} MB → ${dir}`);
  console.log(`  manifest.json carries per-table counts and sha256 for verification.\n`);

  if (bad.length) {
    console.log(`  ❌ ${bad.length} table(s) did not verify. This dump is NOT a backup yet:`);
    for (const b of bad) console.log(`     ${b.table}: ${b.note}`);
    console.log('');
    process.exit(1);
  }

  console.log('  ✅ every table matched its expected row count.\n');
  console.log('  ⚠ NEXT: move this directory somewhere durable and private — encrypted');
  console.log('    cloud storage or an external drive. It holds claim tokens and personal');
  console.log('    data, the repo is public, and a backup that lives only beside the thing');
  console.log('    it backs up is not a backup.\n');
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
