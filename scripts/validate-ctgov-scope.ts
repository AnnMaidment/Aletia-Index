/**
 * scripts/validate-ctgov-scope.ts
 *
 * Replays lib/ctgovScope.ts against the 487 human decisions in
 * scope-decisions.csv and prints a confusion matrix. READ-ONLY.
 *
 *   npx tsx scripts/validate-ctgov-scope.ts
 *   npx tsx scripts/validate-ctgov-scope.ts --errors=40   # list more misses
 *
 * WHY THIS SCRIPT DECIDES SOMETHING. The tiered gate in the ingest path lets
 * an in_scope_high row create a device with no human involved. That is a
 * privilege, and the classifier has to earn it against real labels before it
 * gets it. The gate to check, in order of severity:
 *
 *   1. FALSE INCLUSIONS AT HIGH TIER — a row the human REJECTED that the
 *      classifier calls in_scope_high. Each one is a junk device minted into
 *      the public index with no review. The bar is ZERO. Not "low"; zero.
 *      One is enough to leave auto-create off.
 *   2. False exclusions — a row the human KEPT that the classifier drops.
 *      These are silent losses: an out_of_scope verdict never becomes a queue
 *      row, so nobody ever sees what was missed. Should be low single digits,
 *      and every one of them should be read.
 *   3. Everything else routes through the queue, where a human decides. Noise
 *      there costs review time, not correctness.
 *
 * The labels come from the 22 Jun / 8 Jul audit: 337 keep_core, 134 reject,
 * 16 capture_improved (rejected from the index, but a named category — scored
 * separately below because a classifier that lands them in the queue rather
 * than dropping them is behaving sensibly).
 *
 * The trial TEXT is not in the repo — it lives in each queue row's raw_data.
 * This script joins scope-decisions.csv (labels) to ingestion_review_queue
 * (text) on queue_id, so it needs database credentials.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { classifyCtgovScope, type ScopeTier, type ScopeVerdict } from '../lib/ctgovScope';

function arg(name: string, def?: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : def;
}
const MAX_ERRORS = Number(arg('errors', '20'));
const LABELS_CSV = arg('labels', 'scope-decisions.csv')!;

type Label = 'keep_core' | 'reject' | 'capture_improved';

interface LabelRow { queue_id: string; nct_id: string; revised_recommendation: Label }

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  const split = (line: string): string[] => {
    const out: string[] = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === ',' && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur); return out;
  };
  const headers = split(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const vals = split(l);
    return Object.fromEntries(headers.map((h, i) => [h, (vals[i] ?? '').trim()]));
  });
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (.env.local)');
  }
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const labels = parseCsv(readFileSync(LABELS_CSV, 'utf-8'))
    .filter((r) => r.queue_id && r.revised_recommendation) as unknown as LabelRow[];
  console.log(`\nLoaded ${labels.length} labelled rows from ${LABELS_CSV}`);

  // Pull the queue rows carrying the trial text.
  const byQueueId = new Map<string, Record<string, unknown>>();
  const ids = labels.map((l) => l.queue_id);
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase
      .from('ingestion_review_queue')
      .select('queue_id, raw_data, device_name')
      .in('queue_id', ids.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const r of data ?? []) byQueueId.set(r.queue_id as string, r as Record<string, unknown>);
  }
  console.log(`Matched ${byQueueId.size} of them to queue rows carrying trial text\n`);

  const missing = labels.length - byQueueId.size;
  if (missing > 0) {
    console.log(`  ⚠ ${missing} labelled rows have no queue row (deleted or re-keyed) — excluded from the matrix\n`);
  }

  interface Scored { label: Label; verdict: ScopeVerdict; nct: string; name: string }
  const scored: Scored[] = [];

  for (const l of labels) {
    const row = byQueueId.get(l.queue_id);
    if (!row) continue;
    const raw = (row.raw_data ?? {}) as Record<string, unknown>;
    const verdict = classifyCtgovScope({
      title:        String(raw.title ?? ''),
      briefSummary: String(raw.briefSummary ?? raw.brief_summary ?? ''),
      deviceName:   String(raw.deviceName ?? raw.device_name ?? row.device_name ?? ''),
      conditions:   (raw.conditions as string[] | string | null) ?? null,
    });
    scored.push({
      label: l.revised_recommendation,
      verdict,
      nct: l.nct_id,
      name: String(raw.deviceName ?? row.device_name ?? '').slice(0, 44),
    });
  }

  // ── Confusion matrix ──────────────────────────────────────────────────────
  const TIERS: ScopeTier[] = ['out_of_scope', 'in_scope_low', 'in_scope_high'];
  const LABELS: Label[] = ['keep_core', 'reject', 'capture_improved'];
  const matrix = new Map<string, number>();
  for (const s of scored) {
    const k = `${s.label}|${s.verdict.tier}`;
    matrix.set(k, (matrix.get(k) ?? 0) + 1);
  }

  console.log('confusion matrix — rows are the human decision, columns the classifier\n');
  console.log(`  ${''.padEnd(18)}${TIERS.map((t) => t.padStart(15)).join('')}${'total'.padStart(9)}`);
  for (const lab of LABELS) {
    const cells = TIERS.map((t) => matrix.get(`${lab}|${t}`) ?? 0);
    const total = cells.reduce((a, b) => a + b, 0);
    if (!total) continue;
    console.log(`  ${lab.padEnd(18)}${cells.map((c) => String(c).padStart(15)).join('')}${String(total).padStart(9)}`);
  }

  // ── The numbers that gate auto-create ────────────────────────────────────
  const falseHigh = scored.filter((s) => s.label === 'reject' && s.verdict.tier === 'in_scope_high');
  const falseHighImproved = scored.filter((s) => s.label === 'capture_improved' && s.verdict.tier === 'in_scope_high');
  const falseDrop = scored.filter((s) => s.label === 'keep_core' && s.verdict.tier === 'out_of_scope');
  const keptHigh = scored.filter((s) => s.label === 'keep_core' && s.verdict.tier === 'in_scope_high');
  const rejectedOut = scored.filter((s) => s.label === 'reject' && s.verdict.tier === 'out_of_scope');
  const totalKeep = scored.filter((s) => s.label === 'keep_core').length;
  const totalReject = scored.filter((s) => s.label === 'reject').length;

  const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a');

  console.log('\n── gate ─────────────────────────────────────────────────────────');
  console.log(`  FALSE INCLUSIONS at in_scope_high (human said reject) : ${falseHigh.length}   [bar: 0]`);
  console.log(`    …plus capture_improved landing at high tier         : ${falseHighImproved.length}   [bar: 0]`);
  console.log(`  false exclusions (human said keep, classifier drops)  : ${falseDrop.length}   ${pct(falseDrop.length, totalKeep)} of keeps — SILENT losses`);
  console.log(`  keeps reaching high tier (auto-create candidates)     : ${keptHigh.length}   ${pct(keptHigh.length, totalKeep)} of keeps`);
  console.log(`  rejects correctly dropped (never queued)              : ${rejectedOut.length}   ${pct(rejectedOut.length, totalReject)} of rejects`);

  const verdictLine =
    falseHigh.length === 0 && falseHighImproved.length === 0
      ? '  ✅ zero false inclusions at high tier — auto-create is DEFENSIBLE on this evidence.'
      : `  ❌ ${falseHigh.length + falseHighImproved.length} false inclusion(s) at high tier — auto-create stays OFF. Fix the lexicon, re-run.`;
  console.log(`\n${verdictLine}`);
  console.log('     (Defensible ≠ mandatory. Auto-create also needs a commercial sponsor');
  console.log('      and no merge candidates; and staying with queue-everything costs');
  console.log('      only review time, which is the cheaper mistake.)');

  // ── Error listings — the point is to read these, not just count them ─────
  const show = (title: string, rows: Scored[]) => {
    if (!rows.length) return;
    console.log(`\n── ${title} (${rows.length}) ──`);
    for (const s of rows.slice(0, MAX_ERRORS)) {
      console.log(`  ${s.nct.padEnd(13)} ${s.name.padEnd(46)} ${s.verdict.tier}/${s.verdict.reason}`);
      console.log(`      ${s.verdict.detail}`);
    }
    if (rows.length > MAX_ERRORS) console.log(`  … and ${rows.length - MAX_ERRORS} more (--errors=N)`);
  };

  show('FALSE INCLUSIONS at high tier — each one is an unreviewed device', [...falseHigh, ...falseHighImproved]);
  show('false exclusions — human kept, classifier dropped silently', falseDrop);

  // Full per-row dump for offline analysis.
  const out = ['nct_id,human_label,tier,reason,detail,device_name'];
  for (const s of scored) {
    const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
    out.push([cell(s.nct), cell(s.label), cell(s.verdict.tier), cell(s.verdict.reason), cell(s.verdict.detail), cell(s.name)].join(','));
  }
  writeFileSync('ctgov-scope-validation.csv', out.join('\n'), 'utf-8');
  console.log(`\n  → wrote ctgov-scope-validation.csv (${scored.length} rows)\n`);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
