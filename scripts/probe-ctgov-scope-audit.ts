/**
 * scripts/probe-ctgov-scope-audit.ts
 *
 * READ-ONLY in-scope triage for clinical_trials queue rows.
 *
 *   npx tsx scripts/probe-ctgov-scope-audit.ts                 # status=all
 *   npx tsx scripts/probe-ctgov-scope-audit.ts --status=pending
 *
 * Writes nothing to the database. Produces:
 *   - a console summary (bucket counts, and approved-but-out rows that are
 *     ALREADY on the public site and need device_master exclusion, not just
 *     queue rejection)
 *   - ctgov-scope-audit.csv in the repo root, one row per trial, with a
 *     suggested_action and an empty your_decision column for you to fill.
 *
 * THE BAR (decision 2026-06-22): a row belongs on the index only if the AI/ML
 * is integral to the DEVICE under study. A trial of an AI detection/diagnosis/
 * triage product is IN. A trial of a physical stimulator (tDCS/rTMS/DBS/etc.)
 * where AI/ML is the brain's "neural network" or a downstream analysis step is
 * OUT. These rows were swept in because the ingest keyword filter matches
 * 'neural network' / 'deep learning', which mean something different in
 * neuroscience trials than in device descriptions.
 *
 * This is TRIAGE to prioritise review — not an auto-reject. You decide; the
 * rejection step is a separate, gated script that reads your_decision back.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

function arg(name: string, def?: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : def;
}
const status = arg('status', 'all');

// ── Lexicons ────────────────────────────────────────────────────────────────
// Physical stimulation / neuromodulation modalities. If the studied article is
// one of these, the device is a stimulator and any AI is incidental → OUT.
const STIMULATION = [
  /\btdcs\b/i, /\btacs\b/i, /\btsms\b/i, /\btes\b/i, /\btscs\b/i,
  /\brtms\b/i, /\btms\b/i, /transcranial/i, /theta burst/i,
  /deep brain stimulation/i, /\bdbs\b/i, /vagus nerve/i, /electroacupuncture/i,
  /photobiomodulation/i, /near[- ]infrared/i, /neurostimulation/i,
  /neuromodulation/i, /brain stimulation/i, /magnetic stimulation/i,
  /sensory flicker/i, /\bnir-?pbm\b/i, /transcutaneous .*stimulation/i,
  /spinal cord stimulation/i, /electrical stimulation/i,
];

// AI-as-device function terms. The device IS the algorithm/software doing a
// diagnostic/detection/triage job → IN. NOTE: 'neural network' / 'deep
// learning' are deliberately NOT here — they are the contaminating keywords.
const AI_DEVICE = [
  /computer[- ](aided|assisted) (detection|diagnosis)/i, /\bcade\b/i, /\bcadx\b/i,
  /\bcad system\b/i, /automated (detection|segmentation|classification|diagnosis|analysis|grading)/i,
  /lesion detection/i, /polyp detection/i, /nodule detection/i,
  /image (analysis|recognition|classification|segmentation)/i,
  /ai[- ](powered|enabled|assisted|based|driven|guided|augmented)/i,
  /\bai\/ml\b/i, /diagnostic (system|aid|software|algorithm)/i,
  /decision support/i, /triage/i, /risk (score|prediction|stratification) (model|algorithm|software)/i,
  /screening (algorithm|software|system|tool)/i, /\bsoftware\b/i, /\balgorithm\b/i,
];

// Brain-context terms — when 'neural network' appears WITH these, it's almost
// certainly anatomical (the brain), not an artificial neural network.
const BRAIN_CONTEXT = [
  /cortical/i, /\bcortex\b/i, /\bfmri\b/i, /\beeg\b/i, /oscillat/i,
  /connectivity/i, /neuroplastic/i, /neural mechanism/i, /\bbrain network/i,
  /functional connectivity/i, /resting[- ]state/i,
];

type Bucket = 'in_ai_device' | 'out_stimulation' | 'out_research_neural' | 'ambiguous';

function hit(text: string, lex: RegExp[]): string | null {
  for (const rx of lex) if (rx.test(text)) return rx.source;
  return null;
}

function classifyScope(text: string): { bucket: Bucket; reason: string } {
  const stim = hit(text, STIMULATION);
  const aidev = hit(text, AI_DEVICE);

  // AI-device function present and NOT a stimulator → IN.
  if (aidev && !stim) return { bucket: 'in_ai_device', reason: `ai-device:${aidev}` };

  // Stimulator present. IN only if there's a clear AI-device function too
  // (rare — e.g. closed-loop AI-guided stimulation); otherwise OUT.
  if (stim) {
    if (aidev) return { bucket: 'ambiguous', reason: `stim+ai:${stim}|${aidev}` };
    return { bucket: 'out_stimulation', reason: `stimulator:${stim}` };
  }

  // No stimulator, no AI-device function. If 'neural network'/'deep learning'
  // is the only AI signal and brain-context is present → research, OUT.
  const neural = /neural network|deep learning/i.test(text);
  const brain = hit(text, BRAIN_CONTEXT);
  if (neural && brain) return { bucket: 'out_research_neural', reason: `neural+brain:${brain}` };

  return { bucket: 'ambiguous', reason: 'no-clear-signal' };
}

function snippet(s: string, n = 70): string {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}
function csvCell(s: string): string {
  const t = (s ?? '').replace(/"/g, '""');
  return `"${t}"`;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (.env.local)');
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  let query = supabase
    .from('ingestion_review_queue')
    .select('queue_id, raw_data, status')
    .eq('source', 'clinical_trials')
    .order('created_at', { ascending: true });
  if (status && status !== 'all') query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  if (!data) return;

  const counts: Record<Bucket, number> = {
    in_ai_device: 0, out_stimulation: 0, out_research_neural: 0, ambiguous: 0,
  };
  const approvedOut: string[] = [];
  const rows: string[] = [
    ['queue_id', 'nct_id', 'ctgov_url', 'status', 'bucket', 'suggested_action', 'your_decision', 'device_name', 'conditions', 'reason'].join(','),
  ];

  for (const row of data) {
    const raw = row.raw_data ?? {};
    const deviceName = String(raw.deviceName ?? raw.device_name ?? raw.interventionName ?? raw.device ?? raw.title ?? '');
    const nctId = String(raw.nctId ?? raw.nct_id ?? raw.nctid ?? '').trim();
    const ctgovUrl = nctId ? `https://clinicaltrials.gov/study/${nctId}` : '';
    const conditions = Array.isArray(raw.conditions) ? raw.conditions.join(' | ') : String(raw.conditions ?? '');
    const text = [deviceName, String(raw.title ?? ''), String(raw.briefSummary ?? raw.brief_summary ?? ''), conditions]
      .join(' ').toLowerCase();

    const { bucket, reason } = classifyScope(text);
    counts[bucket]++;

    const suggested = bucket === 'in_ai_device' ? 'keep'
      : bucket === 'ambiguous' ? 'review'
      : 'reject';

    // Approved + out = already accepted → a device_master row likely exists and
    // is public. Queue rejection alone won't remove it.
    if (row.status === 'approved' && bucket.startsWith('out')) {
      approvedOut.push(`${String(row.queue_id).slice(0, 8)}  ${(nctId || '(no NCT)').padEnd(13)} ${snippet(deviceName, 50)}`);
    }

    rows.push([
      csvCell(row.queue_id), csvCell(nctId), csvCell(ctgovUrl), csvCell(row.status), csvCell(bucket), csvCell(suggested), '""',
      csvCell(snippet(deviceName, 80)), csvCell(snippet(conditions, 90)), csvCell(reason),
    ].join(','));
  }

  writeFileSync('ctgov-scope-audit.csv', rows.join('\n'), 'utf-8');

  const total = data.length;
  console.log(`\nclinical_trials scope triage — ${total} rows (status=${status})\n`);
  console.log(`  in_ai_device         ${counts.in_ai_device}   (suggested keep)`);
  console.log(`  ambiguous            ${counts.ambiguous}   (suggested review — your call)`);
  console.log(`  out_stimulation      ${counts.out_stimulation}   (suggested reject — physical stimulator)`);
  console.log(`  out_research_neural  ${counts.out_research_neural}   (suggested reject — 'neural network' = brain)`);
  console.log(`\n  → wrote ctgov-scope-audit.csv (fill the your_decision column: keep | reject | unsure)`);

  if (approvedOut.length) {
    console.log(`\n  ⚠ ${approvedOut.length} APPROVED rows fell in an OUT bucket — these were already`);
    console.log(`    accepted and likely have a public device_master row. Queue rejection won't`);
    console.log(`    remove them; they need a separate device_master exclude. Review carefully:`);
    for (const a of approvedOut) console.log(`      ${a}`);
  }
  console.log('');
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
