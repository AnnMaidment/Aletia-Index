/**
 * scripts/probe-mhra-bulk-audit.ts
 *
 * READ-ONLY audit of the MHRA devices that entered the index through the
 * bulk auto-create path (autoCreate was true until 25 Aug 2026).
 *
 *   npx tsx scripts/probe-mhra-bulk-audit.ts
 *   npx tsx scripts/probe-mhra-bulk-audit.ts --all      # include MHRA devices
 *                                                        that also hold another
 *                                                        jurisdiction's identifier
 *
 * Writes nothing to the database. Produces `mhra-bulk-audit.csv`, one row per
 * device, with a `suggested` column and an empty `your_decision` column.
 *
 * WHY THESE ROWS ARE SUSPECT. MHRA discovery sweeps MHRA_AIML_GMDN_TERMS — a
 * list of GMDN *software* categories. Several of them describe software that
 * is not AI by any reading: 'ophthalmology pacs software' (image storage),
 * 'ct system application software' and 'mri system application software'
 * (scanner console software), 'radiology dicom image processing application
 * software' (may be nothing more than windowing and reformatting), plus the
 * non-interpretive variants that are explicitly labelled non-interpretive.
 * Each device swept under one of those terms was created with
 * ai_ml_integral = true and never seen by a human. This is BUG-012's
 * construct-validity failure arriving through the GMDN channel.
 *
 * THE BAR, restated: a device is in the index iff it is AI/ML by the relevant
 * regulator's own classification. MHRA PARD publishes no AI flag at all, so
 * GMDN membership can never satisfy that bar by itself. Every row here needs
 * either external evidence (an FDA AI/ML-list entry, an EU/HAIR entry, a
 * manufacturer claim) or exclusion.
 *
 * TRIAGE ONLY. `suggested` prioritises reading; it is not an auto-reject. The
 * exclusion step is a separate gated script that reads your_decision back.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

const INCLUDE_MULTI_JURISDICTION = process.argv.includes('--all');

/**
 * GMDN terms that describe infrastructure or console software rather than an
 * interpretive/analytic function. Membership is a strong prior for "not AI",
 * never a verdict.
 */
const NON_INTERPRETIVE_TERMS = [
  'ophthalmology pacs software',
  'ct system application software',
  'mri system application software',
  'ultrasound imaging system application software',
  'basic diagnostic x-ray system application software',
  'diagnostic x-ray digital imaging system workstation application software',
  'radiology dicom image processing application software',
  'cardiology information system application software',
  'pulmonary function analysis software, non-interpretive',
];

/** Terms whose name asserts an interpretive/analytic job — a weak prior for "AI-ish". */
const INTERPRETIVE_HINTS = [
  'interpretive', 'analysis', 'analyser', 'diagnosis-support', 'predictive',
  'risk assessment', 'image analysis', 'image-analysis',
];

interface ExtIdRow { aletia_id: string; id_type: string; id_value: string }
interface DeviceRow {
  aletia_id: string;
  name: string | null;
  manufacturer_name: string | null;
  ai_ml_integral: boolean | null;
  excluded: boolean | null;
  merged_into: string | null;
  pipeline_stage: string | null;
  created_at: string | null;
}

function csvCell(s: unknown): string {
  return `"${String(s ?? '').replace(/"/g, '""')}"`;
}
function snippet(s: string | null, n = 48): string {
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

  // 1. Every MHRA identifier.
  const { data: mhraIds, error: idErr } = await supabase
    .from('device_external_ids')
    .select('aletia_id, id_type, id_value')
    .eq('id_type', 'mhra_device_id');
  if (idErr) throw new Error(idErr.message);
  if (!mhraIds?.length) { console.log('\nNo MHRA identifiers found.\n'); return; }

  const aletiaIds = Array.from(new Set(mhraIds.map((r) => r.aletia_id)));

  // 2. All identifiers those devices hold — a device carrying an FDA or EU id
  //    has corroboration the MHRA sweep alone cannot give.
  const otherIdsByDevice = new Map<string, ExtIdRow[]>();
  for (let i = 0; i < aletiaIds.length; i += 200) {
    const { data, error } = await supabase
      .from('device_external_ids')
      .select('aletia_id, id_type, id_value')
      .in('aletia_id', aletiaIds.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as ExtIdRow[]) {
      (otherIdsByDevice.get(r.aletia_id) ?? otherIdsByDevice.set(r.aletia_id, []).get(r.aletia_id)!).push(r);
    }
  }

  // 3. device_master.
  const devices = new Map<string, DeviceRow>();
  for (let i = 0; i < aletiaIds.length; i += 200) {
    const { data, error } = await supabase
      .from('device_master')
      .select('aletia_id, name, manufacturer_name, ai_ml_integral, excluded, merged_into, pipeline_stage, created_at')
      .in('aletia_id', aletiaIds.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const d of (data ?? []) as DeviceRow[]) devices.set(d.aletia_id, d);
  }

  // 4. GMDN term per device — from regional_registrations (written by the
  //    MHRA path), which is where the sweep's evidence actually landed.
  const gmdnByDevice = new Map<string, { term: string | null; code: string | null }>();
  for (let i = 0; i < aletiaIds.length; i += 200) {
    const { data, error } = await supabase
      .from('regional_registrations')
      .select('device_link, gmdn_term, gmdn_code')
      .eq('regulatory_body', 'MHRA')
      .in('device_link', aletiaIds.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      gmdnByDevice.set(r.device_link as string, {
        term: (r.gmdn_term as string) ?? null,
        code: r.gmdn_code ? String(r.gmdn_code) : null,
      });
    }
  }

  const rows: string[] = [[
    'aletia_id', 'mhra_id', 'device_name', 'manufacturer', 'gmdn_term',
    'other_jurisdictions', 'ai_ml_integral', 'excluded', 'merged_into',
    'evidence', 'suggested', 'your_decision',
  ].join(',')];

  const counts = { corroborated: 0, non_interpretive: 0, interpretive_only: 0, unknown_term: 0, skipped: 0 };

  for (const idRow of mhraIds) {
    const d = devices.get(idRow.aletia_id);
    if (!d) continue;
    if (d.merged_into) { counts.skipped++; continue; }   // absorbed — not a live index row

    const others = (otherIdsByDevice.get(idRow.aletia_id) ?? [])
      .filter((r) => r.id_type !== 'mhra_device_id');
    const otherTypes = Array.from(new Set(others.map((r) => r.id_type)));
    const corroborated = otherTypes.some((t) => t.startsWith('fda_') || t.startsWith('eudamed_'));

    if (corroborated && !INCLUDE_MULTI_JURISDICTION) {
      counts.corroborated++;
      continue;                                          // identity established elsewhere
    }

    const term = (gmdnByDevice.get(idRow.aletia_id)?.term ?? '').toLowerCase();
    let evidence: string;
    let suggested: string;

    if (corroborated) {
      evidence = `corroborated by ${otherTypes.join('+')}`;
      suggested = 'keep';
      counts.corroborated++;
    } else if (!term) {
      evidence = 'no GMDN term recorded';
      suggested = 'review';
      counts.unknown_term++;
    } else if (NON_INTERPRETIVE_TERMS.includes(term)) {
      evidence = `GMDN term is infrastructure/console software: "${term}"`;
      suggested = 'exclude?';
      counts.non_interpretive++;
    } else if (INTERPRETIVE_HINTS.some((h) => term.includes(h))) {
      evidence = `GMDN term asserts an interpretive function: "${term}" — still not an AI claim`;
      suggested = 'review';
      counts.interpretive_only++;
    } else {
      evidence = `GMDN term "${term}" — no interpretive signal`;
      suggested = 'review';
      counts.unknown_term++;
    }

    rows.push([
      csvCell(idRow.aletia_id), csvCell(idRow.id_value), csvCell(snippet(d.name, 80)),
      csvCell(snippet(d.manufacturer_name, 60)), csvCell(term),
      csvCell(otherTypes.join(' | ')), csvCell(d.ai_ml_integral), csvCell(d.excluded),
      csvCell(d.merged_into), csvCell(evidence), csvCell(suggested), '""',
    ].join(','));
  }

  writeFileSync('mhra-bulk-audit.csv', rows.join('\n'), 'utf-8');

  console.log(`\nMHRA bulk-create audit — ${mhraIds.length} MHRA identifiers, ${rows.length - 1} rows written\n`);
  console.log(`  corroborated by an FDA/EU identifier      : ${counts.corroborated}${INCLUDE_MULTI_JURISDICTION ? '' : '   (excluded from the CSV — re-run with --all to list them)'}`);
  console.log(`  GMDN term is infrastructure/console sw    : ${counts.non_interpretive}   ← read these first`);
  console.log(`  GMDN term asserts an interpretive function: ${counts.interpretive_only}`);
  console.log(`  no / unrecognised GMDN term               : ${counts.unknown_term}`);
  console.log(`  skipped (merged_into — already absorbed)  : ${counts.skipped}`);
  console.log(`\n  → wrote mhra-bulk-audit.csv (fill your_decision: keep | exclude | unsure)`);
  console.log(`\n  Reminder: GMDN membership is evidence of "software", never of "AI/ML".`);
  console.log(`  A keep needs positive evidence from somewhere other than the sweep.\n`);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
