/**
 * scripts/probe-breakthrough-aiml.ts
 *
 * READ-ONLY scan of the FDA Breakthrough Device rows that were minted with
 * ai_ml_integral = true. Writes nothing.
 *
 *   npx tsx scripts/probe-breakthrough-aiml.ts
 *   npx tsx scripts/probe-breakthrough-aiml.ts --csv    # also write a workbook
 *
 * WHY. lib/breakthroughIngest.ts:243 sets `ai_ml_integral: true` on every
 * device it creates, and the route has NO AI filter of any kind — worse than
 * the MHRA path, which at least filtered on a (wrong) GMDN list. The FDA
 * Breakthrough Devices programme is a designation for devices addressing
 * irreversibly debilitating conditions; it says nothing whatsoever about AI.
 * Every row this path created therefore carries an unevidenced AI claim.
 *
 * These rows are also structurally awkward: identity is a SYNTHETIC identifier
 *   BREAKTHROUGH:{applicant}__{trade-name}
 * held under id_type 'legacy_unclassified', because there is no submission
 * number at designation time. They are meant to be superseded when the device
 * later lands a real K/DEN/P number and FDA sync discovers it — so an
 * unresolved synthetic id that is OLD is a second thing worth seeing: either
 * the device never cleared, or the supersession never happened.
 *
 * The route stays parked. This probe exists so the decision about these rows
 * is made on counts rather than memory.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

const WRITE_CSV = process.argv.includes('--csv');

interface ExtRow { aletia_id: string; id_type: string; id_value: string }
interface DeviceRow {
  aletia_id: string;
  name: string | null;
  manufacturer_name: string | null;
  ai_ml_integral: boolean | null;
  excluded: boolean | null;
  merged_into: string | null;
  approval_status: string | null;
  pipeline_stage: string | null;
  breakthrough_designation: boolean | null;
  breakthrough_designation_date: string | null;
  created_at: string | null;
}

function csvCell(s: unknown): string {
  return `"${String(s ?? '').replace(/"/g, '""')}"`;
}
function snippet(s: string | null, n = 46): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t || '(no name)';
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

  // 1. Synthetic breakthrough identifiers.
  const { data: synth, error: synthErr } = await supabase
    .from('device_external_ids')
    .select('aletia_id, id_type, id_value')
    .like('id_value', 'BREAKTHROUGH:%');
  if (synthErr) throw new Error(synthErr.message);

  // 2. Anything else flagged breakthrough_designation, even without a synthetic id.
  const { data: flagged, error: flagErr } = await supabase
    .from('device_master')
    .select('aletia_id, name, manufacturer_name, ai_ml_integral, excluded, merged_into, approval_status, pipeline_stage, breakthrough_designation, breakthrough_designation_date, created_at')
    .eq('breakthrough_designation', true);
  if (flagErr) throw new Error(flagErr.message);

  const synthIds = Array.from(new Set((synth ?? []).map((r) => r.aletia_id)));
  const allIds = Array.from(new Set([...synthIds, ...(flagged ?? []).map((d) => d.aletia_id)]));

  if (allIds.length === 0) {
    console.log('\nNo breakthrough-sourced rows found. Nothing to decide.\n');
    return;
  }

  const devices = new Map<string, DeviceRow>();
  for (const d of (flagged ?? []) as DeviceRow[]) devices.set(d.aletia_id, d);
  const stillNeeded = allIds.filter((id) => !devices.has(id));
  for (let i = 0; i < stillNeeded.length; i += 200) {
    const { data, error } = await supabase
      .from('device_master')
      .select('aletia_id, name, manufacturer_name, ai_ml_integral, excluded, merged_into, approval_status, pipeline_stage, breakthrough_designation, breakthrough_designation_date, created_at')
      .in('aletia_id', stillNeeded.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const d of (data ?? []) as DeviceRow[]) devices.set(d.aletia_id, d);
  }

  // 3. Which of these devices also hold a REAL FDA identifier? That is the
  //    supersession signal — a breakthrough row that later cleared.
  const realFdaByDevice = new Map<string, string[]>();
  for (let i = 0; i < allIds.length; i += 200) {
    const { data, error } = await supabase
      .from('device_external_ids')
      .select('aletia_id, id_type, id_value')
      .in('aletia_id', allIds.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as ExtRow[]) {
      if (r.id_type.startsWith('fda_')) {
        (realFdaByDevice.get(r.aletia_id) ?? realFdaByDevice.set(r.aletia_id, []).get(r.aletia_id)!)
          .push(`${r.id_type}:${r.id_value}`);
      }
    }
  }

  const counts = {
    total: 0, live: 0, excluded: 0, merged: 0,
    aiTrue: 0, aiTrueLiveUncorroborated: 0, superseded: 0, stale: 0,
  };
  const rows: string[] = [[
    'aletia_id', 'device_name', 'manufacturer', 'ai_ml_integral', 'excluded',
    'merged_into', 'approval_status', 'pipeline_stage', 'designation_date',
    'real_fda_ids', 'note',
  ].join(',')];

  const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const worst: string[] = [];

  for (const id of allIds) {
    const d = devices.get(id);
    if (!d) continue;
    counts.total++;
    if (d.merged_into) counts.merged++;
    else if (d.excluded) counts.excluded++;
    else counts.live++;

    if (d.ai_ml_integral) counts.aiTrue++;

    const realIds = realFdaByDevice.get(id) ?? [];
    if (realIds.length) counts.superseded++;

    const liveUncorroborated = !d.merged_into && !d.excluded && d.ai_ml_integral && realIds.length === 0;
    if (liveUncorroborated) {
      counts.aiTrueLiveUncorroborated++;
      if (worst.length < 25) {
        worst.push(`  ${id}  ${snippet(d.name, 44).padEnd(46)} ${snippet(d.manufacturer_name, 28)}`);
      }
    }

    const designation = d.breakthrough_designation_date ?? '';
    if (designation && designation < twoYearsAgo && realIds.length === 0) counts.stale++;

    const note = liveUncorroborated
      ? 'LIVE, ai_ml_integral=true, no FDA identifier — unevidenced AI claim on a public row'
      : realIds.length
        ? 'has a real FDA identifier — designation row was superseded'
        : d.merged_into ? 'absorbed' : d.excluded ? 'excluded' : 'live';

    rows.push([
      csvCell(id), csvCell(snippet(d.name, 80)), csvCell(snippet(d.manufacturer_name, 60)),
      csvCell(d.ai_ml_integral), csvCell(d.excluded), csvCell(d.merged_into),
      csvCell(d.approval_status), csvCell(d.pipeline_stage), csvCell(designation),
      csvCell(realIds.join(' | ')), csvCell(note),
    ].join(','));
  }

  console.log(`\nbreakthrough probe — ${counts.total} devices from the breakthrough path\n`);
  console.log(`  live (not excluded, not merged)                    : ${counts.live}`);
  console.log(`  excluded                                           : ${counts.excluded}`);
  console.log(`  absorbed into a survivor (merged_into)             : ${counts.merged}`);
  console.log(`  ai_ml_integral = true                              : ${counts.aiTrue}`);
  console.log(`  superseded — now hold a real FDA identifier        : ${counts.superseded}`);
  console.log(`  designated >2y ago and still no FDA identifier     : ${counts.stale}`);
  console.log(`\n  ► LIVE + ai_ml_integral + no FDA identifier        : ${counts.aiTrueLiveUncorroborated}`);
  console.log(`    These are public index rows asserting AI on no evidence at all.`);
  console.log(`    Breakthrough designation is about disease severity, not AI.\n`);

  if (worst.length) {
    console.log('  first rows to read:');
    for (const w of worst) console.log(w);
    if (counts.aiTrueLiveUncorroborated > worst.length) {
      console.log(`  … and ${counts.aiTrueLiveUncorroborated - worst.length} more`);
    }
  }

  if (WRITE_CSV) {
    writeFileSync('breakthrough-aiml-probe.csv', rows.join('\n'), 'utf-8');
    console.log(`\n  → wrote breakthrough-aiml-probe.csv (${rows.length - 1} rows)`);
  } else {
    console.log(`\n  (re-run with --csv for a full workbook)`);
  }
  console.log(`\n  The route stays parked either way — do not add it to a cron.\n`);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
