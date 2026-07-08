/**
 * scripts/probe-specialty-decisions.ts
 *
 * Read-only inspection of what the specialty extractor WOULD decide, per row,
 * so the 'none' and 'medium' buckets can be eyeballed before a real write.
 * Writes nothing. probe- prefix → excluded from tsconfig/build.
 *
 *   npx tsx scripts/probe-specialty-decisions.ts --source=clinical_trials --status=all
 *   npx tsx scripts/probe-specialty-decisions.ts --source=clinical_trials --status=all --show-high
 *
 * By default prints every NONE row and every MEDIUM row (the risk buckets).
 * HIGH rows are summarised only, unless --show-high is passed.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { buildSpecialtyEvidence } from '../lib/specialtyEvidence';
import { inferSpecialty } from '../lib/specialtyTaxonomy';

function arg(name: string, def?: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : def;
}
const showHigh = process.argv.includes('--show-high');
const source = arg('source');
const status = arg('status', 'all');

function snippet(s: string, n = 90): string {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (.env.local)');
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  let query = supabase
    .from('ingestion_review_queue')
    .select('queue_id, raw_data, source, status')
    .order('created_at', { ascending: true });
  if (status && status !== 'all') query = query.eq('status', status);
  if (source) query = query.eq('source', source);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  if (!data) return;

  const buckets: Record<string, { id: string; specialty: string | null; name: string; cond: string }[]> = {
    high: [], medium: [], low: [], none: [],
  };

  for (const row of data) {
    if (row.source === 'fda_dedup') continue; // mirror the extractor skip
    const ev = buildSpecialtyEvidence(row.raw_data, row.source);
    const m = inferSpecialty(ev);
    buckets[m.confidence].push({
      id: String(row.queue_id).slice(0, 8),
      specialty: m.specialty,
      name: snippet(ev.deviceName || ev.title, 50),
      cond: snippet(ev.conditionsText, 70),
    });
  }

  const line = (b: { id: string; specialty: string | null; name: string; cond: string }) =>
    `    ${b.id}  ${String(b.specialty ?? '—').padEnd(26)} ${b.name}  ::  ${b.cond}`;

  console.log(`\nNONE (${buckets.none.length}) — recall gaps or genuinely out-of-scope:`);
  buckets.none.forEach((b) => console.log(line(b)));

  console.log(`\nMEDIUM (${buckets.medium.length}) — scan for misroutes:`);
  buckets.medium.forEach((b) => console.log(line(b)));

  if (showHigh) {
    console.log(`\nHIGH (${buckets.high.length}):`);
    buckets.high.forEach((b) => console.log(line(b)));
  } else {
    console.log(`\nHIGH: ${buckets.high.length} rows (pass --show-high to list)`);
  }
  console.log('');
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
