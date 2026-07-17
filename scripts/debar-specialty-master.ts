/**
 * scripts/debar-specialty-master.ts — v2 (post-spot-check, 8 Jul 2026)
 *
 * De-bare specialty on the PUBLIC device_master backbone — measure-first,
 * FULL human review before any write.
 *
 * v2 changes after the 100-row spot-check exposed the modality-lane problem
 * (classification text like "radiological image processing" firing the
 * Radiology patterns at high confidence for clinically non-Radiology devices):
 *
 *   - Inference now uses inferSpecialtyForMaster() (lib/specialtyTaxonomy.ts):
 *     organ-specific signals beat modality-lane Radiology vocabulary at any
 *     level; modality-only evidence lands Radiology at MEDIUM with a
 *     modality_only flag (the reviewer-confirmed modality-led default for
 *     CT/MR/x-ray/ultrasound platforms — and the ready-made candidate list
 *     for a future cross-specialty "imaging role" axis).
 *   - specialty-overrides.csv carries reviewer brand-knowledge decisions
 *     (Vivid → Cardiology etc.). Precedence: OVERRIDE > queue > master.
 *     'confirm' rows mark the computed value as already human-reviewed.
 *   - The dry run emits a FULL review workbook (every writable row, not a
 *     sample), sorted for fast scanning. The apply is gated on that workbook:
 *     --apply requires --decisions=<reviewed workbook> so every written value
 *     has a human behind it (Aletia-verified provenance, not sampled-heuristic).
 *
 * WORKBOOK EDITING CONTRACT (debar-specialty-review-<ts>.csv):
 *   - final_specialty is prefilled with the computed/override value.
 *   - To CORRECT a row: type the right canonical specialty into final_specialty.
 *   - To leave a device unclassified: BLANK final_specialty (null stays null).
 *   - Do not edit other columns; do not delete rows (blank instead).
 *   - review_status 'confirmed' rows were already decided in the spot-check.
 *
 * SAFETY MODEL (dry-run → full review → snapshot → --apply --expect N)
 *   - Default is DRY RUN: measurement + workbook, no writes.
 *   - --apply requires BOTH --decisions=<file> and --expect=N matching the
 *     count of non-blank final_specialty rows in that file.
 *   - Planned values validated against specialty_taxonomy before any write.
 *   - Every write guarded with .is('specialty_link', null) — fill-nulls only.
 *   - JSON snapshot written before applying (undo record).
 *
 * Usage (from repo root):
 *   npx tsx scripts/debar-specialty-master.ts                                # dry run + workbook
 *   npx tsx scripts/debar-specialty-master.ts --limit=100                    # sample pass
 *   npx tsx scripts/debar-specialty-master.ts --no-classification            # skip openFDA calls
 *   npx tsx scripts/debar-specialty-master.ts --apply --decisions=debar-specialty-review-<ts>.csv --expect=N
 *
 * Requires .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  (OPENFDA_API_KEY optional)
 *
 * Outputs (repo root; run artifacts are gitignored — specialty-overrides.csv
 * and the reviewed decisions file are curation records and SHOULD be committed):
 *   debar-specialty-report-<ts>.json    — every decision + evidence provenance
 *   debar-specialty-review-<ts>.csv     — the FULL review workbook
 *   debar-specialty-snapshot-<ts>.json  — pre-write snapshot (only on --apply)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fetchFdaAiMlList, type FdaListEntry } from '../lib/fdaList';
import { getClassificationByProductCode } from '../lib/fda';
import {
  buildDeviceMasterEvidence,
  type SpecialtyEvidence,
} from '../lib/specialtyEvidence';
import {
  inferSpecialtyForMaster,
  type MasterSpecialtyMatch,
  type SpecialtyConfidence,
} from '../lib/specialtyTaxonomy';

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const NO_CLASSIFICATION = argv.includes('--no-classification');
function arg(name: string, def?: string): string | undefined {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : def;
}
const LIMIT = arg('limit') ? parseInt(arg('limit')!, 10) : undefined;
const EXPECT = arg('expect');
const DECISIONS_FILE = arg('decisions');
const OVERRIDES_FILE = arg('overrides', 'specialty-overrides.csv')!;
const CLASSIFICATION_DELAY_MS = parseInt(arg('classification-delay-ms', '300')!, 10);

const FDA_ID_TYPES = ['fda_k_number', 'fda_de_novo', 'fda_pma'] as const;
const CONFIDENCE_RANK: Record<SpecialtyConfidence, number> = {
  high: 3, medium: 2, low: 1, none: 0,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface MasterRow {
  aletia_id: string;
  name: string | null;
  intended_use: string | null;
  description: string | null;
}

interface QueueInference {
  queue_id: string;
  source: string;
  source_id: string;
  specialty_inferred: string;
  specialty_confidence: SpecialtyConfidence;
}

interface OverrideRow {
  aletia_id: string;
  action: 'override' | 'confirm';
  specialty: string;
  note: string;
}

interface DeviceDecision {
  aletia_id: string;
  name: string | null;
  fda_submissions: string[];
  product_codes: string[];
  master_specialty: string | null;
  master_confidence: SpecialtyConfidence;
  master_patterns: string[];
  modality_only: boolean;
  queue_specialty: string | null;
  queue_confidence: SpecialtyConfidence | null;
  queue_id: string | null;
  override_specialty: string | null;
  override_note: string | null;
  chosen_specialty: string | null;
  chosen_confidence: SpecialtyConfidence;
  chosen_route: 'override' | 'queue_cascade' | 'master_text' | 'none';
  review_status: 'confirmed' | '';
  disagreement: boolean;
  evidence_fields: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV helpers (RFC-4180-ish, matches the house parser in apply-scope-decisions)
// ─────────────────────────────────────────────────────────────────────────────

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

function parseCsvFile(path: string): Record<string, string>[] {
  const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row: Record<string, string> = {};
    header.forEach((h, i) => { row[h] = (cells[i] ?? '').trim(); });
    return row;
  });
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Data loading (paginated)
// ─────────────────────────────────────────────────────────────────────────────

const PAGE = 1000;

async function loadTargetDevices(supabase: SupabaseClient): Promise<MasterRow[]> {
  const out: MasterRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('device_master')
      .select('aletia_id, name, intended_use, description')
      .eq('excluded', false)
      .is('merged_into', null)
      .is('specialty_link', null)
      .order('aletia_id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`device_master load failed: ${error.message}`);
    out.push(...((data ?? []) as MasterRow[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function loadFdaExternalIds(supabase: SupabaseClient): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('device_external_ids')
      .select('aletia_id, id_type, id_value')
      .in('id_type', FDA_ID_TYPES as unknown as string[])
      .order('id_value')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`device_external_ids load failed: ${error.message}`);
    for (const row of data ?? []) {
      const list = map.get(row.aletia_id) ?? [];
      list.push(row.id_value);
      map.set(row.aletia_id, list);
    }
    if (!data || data.length < PAGE) break;
  }
  return map;
}

async function loadQueueCascade(supabase: SupabaseClient): Promise<Map<string, QueueInference>> {
  const { data: qRows, error: qErr } = await supabase
    .from('ingestion_review_queue')
    .select('queue_id, source, source_id, specialty_inferred, specialty_confidence')
    .eq('status', 'approved')
    .not('specialty_inferred', 'is', null);
  if (qErr) throw new Error(`queue cascade load failed: ${qErr.message}`);

  const bySourceId = new Map<string, QueueInference>();
  for (const r of (qRows ?? []) as QueueInference[]) {
    if (!r.source_id || !r.specialty_inferred) continue;
    if (!bySourceId.has(r.source_id)) bySourceId.set(r.source_id, r);
  }
  if (bySourceId.size === 0) return new Map();

  const byAletia = new Map<string, QueueInference>();
  const ids = Array.from(bySourceId.keys());
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data, error } = await supabase
      .from('device_external_ids')
      .select('aletia_id, id_value')
      .in('id_value', chunk);
    if (error) throw new Error(`queue cascade id join failed: ${error.message}`);
    for (const row of data ?? []) {
      const inf = bySourceId.get(row.id_value);
      if (!inf) continue;
      const existing = byAletia.get(row.aletia_id);
      if (
        !existing ||
        CONFIDENCE_RANK[inf.specialty_confidence] > CONFIDENCE_RANK[existing.specialty_confidence]
      ) {
        byAletia.set(row.aletia_id, inf);
      }
    }
  }
  return byAletia;
}

function loadOverrides(path: string): Map<string, OverrideRow> {
  const map = new Map<string, OverrideRow>();
  if (!existsSync(path)) {
    console.log(`  (no overrides file at ${path} — proceeding without)`);
    return map;
  }
  for (const row of parseCsvFile(path)) {
    const action = row.action as OverrideRow['action'];
    if (!row.aletia_id || (action !== 'override' && action !== 'confirm')) continue;
    map.set(row.aletia_id, {
      aletia_id: row.aletia_id,
      action,
      specialty: row.specialty,
      note: row.note ?? '',
    });
  }
  return map;
}

async function loadTaxonomy(supabase: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('specialty_taxonomy')
    .select('specialty_name');
  if (error) throw new Error(`specialty_taxonomy load failed: ${error.message}`);
  return new Set((data ?? []).map((r: { specialty_name: string }) => r.specialty_name));
}

// ─────────────────────────────────────────────────────────────────────────────
// openFDA classification cache
// ─────────────────────────────────────────────────────────────────────────────

interface ClassificationText { device_name: string; definition: string }

async function fetchClassifications(productCodes: string[]): Promise<Map<string, ClassificationText>> {
  const cache = new Map<string, ClassificationText>();
  let done = 0;
  for (const code of productCodes) {
    const c = await getClassificationByProductCode(code).catch(() => null);
    if (c) cache.set(code, { device_name: c.device_name ?? '', definition: c.definition ?? '' });
    done++;
    if (done % 25 === 0 || done === productCodes.length) {
      console.log(`  classification lookups: ${done}/${productCodes.length} (${cache.size} resolved)`);
    }
    await sleep(CLASSIFICATION_DELAY_MS);
  }
  return cache;
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply path — reads the reviewed workbook
// ─────────────────────────────────────────────────────────────────────────────

async function applyDecisions(supabase: SupabaseClient, ts: number): Promise<void> {
  if (!DECISIONS_FILE) {
    console.error(
      '\nABORT: --apply requires --decisions=<reviewed workbook csv>. The write is gated on the ' +
      'full human review — run the dry run, review debar-specialty-review-<ts>.csv, then apply.'
    );
    process.exit(1);
  }
  if (!existsSync(DECISIONS_FILE)) {
    console.error(`\nABORT: decisions file not found: ${DECISIONS_FILE}`);
    process.exit(1);
  }

  const rows = parseCsvFile(DECISIONS_FILE);
  const writes = rows
    .filter((r) => r.aletia_id && (r.final_specialty ?? '').trim() !== '')
    .map((r) => ({ aletia_id: r.aletia_id, specialty: r.final_specialty.trim() }));

  console.log(`\nDecisions file: ${DECISIONS_FILE}`);
  console.log(`  rows: ${rows.length}, non-blank final_specialty (planned writes): ${writes.length}`);

  // Duplicate guard.
  const seen = new Set<string>();
  for (const w of writes) {
    if (seen.has(w.aletia_id)) {
      console.error(`\nABORT: duplicate aletia_id in decisions file: ${w.aletia_id}`);
      process.exit(1);
    }
    seen.add(w.aletia_id);
  }

  // Drift guard.
  if (!EXPECT || parseInt(EXPECT, 10) !== writes.length) {
    console.error(
      `\nABORT: --expect=${EXPECT ?? '(missing)'} does not match planned write count ${writes.length}. ` +
      `Confirm the workbook, then apply with --expect=${writes.length}.`
    );
    process.exit(1);
  }

  // Taxonomy validation — abort before any write.
  const taxonomy = await loadTaxonomy(supabase);
  const unknown = Array.from(new Set(writes.map((w) => w.specialty))).filter((s) => !taxonomy.has(s));
  if (unknown.length) {
    console.error(
      `\nABORT: final_specialty values not in specialty_taxonomy (check spelling/casing): ${unknown.join(', ')}`
    );
    process.exit(1);
  }

  // Snapshot (undo record).
  const snapshotPath = `debar-specialty-snapshot-${ts}.json`;
  writeFileSync(
    snapshotPath,
    JSON.stringify(
      {
        applied_at: new Date().toISOString(),
        decisions_file: DECISIONS_FILE,
        writes: writes.map((w) => ({
          aletia_id: w.aletia_id,
          specialty_link_before: null,
          specialty_link_after: w.specialty,
        })),
      },
      null, 2
    )
  );
  console.log(`  Snapshot → ${snapshotPath}`);

  let ok = 0;
  let skippedNotNull = 0;
  const failures: { aletia_id: string; error: string }[] = [];
  for (const w of writes) {
    const { data, error } = await supabase
      .from('device_master')
      .update({ specialty_link: w.specialty })
      .eq('aletia_id', w.aletia_id)
      .is('specialty_link', null)   // fill-nulls-only guard
      .select('aletia_id');
    if (error) failures.push({ aletia_id: w.aletia_id, error: error.message });
    else if (!data || data.length === 0) skippedNotNull++;  // already non-null or id missing
    else ok++;
  }

  console.log(`\n===== APPLY complete =====`);
  console.log(`  Written            : ${ok}/${writes.length}`);
  console.log(`  Skipped (not null / not found): ${skippedNotNull}`);
  if (failures.length) {
    console.log(`  Failures           : ${failures.length}`);
    for (const f of failures.slice(0, 10)) console.log(`    ${f.aletia_id}: ${f.error}`);
  }
  console.log(`  Undo record: ${snapshotPath}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local');
    process.exit(1);
  }
  const supabase = createClient(url, key);
  const ts = Date.now();

  console.log(`\n=== De-bare specialty on device_master — ${APPLY ? 'APPLY' : 'DRY RUN'} (v2) ===`);

  if (APPLY) {
    await applyDecisions(supabase, ts);
    return;
  }

  // ── 1. Targets ─────────────────────────────────────────────────────────────
  let targets = await loadTargetDevices(supabase);
  console.log(`\n[1/6] Target devices (shown, specialty null): ${targets.length}`);
  if (LIMIT && targets.length > LIMIT) {
    targets = targets.slice(0, LIMIT);
    console.log(`      --limit=${LIMIT} → processing first ${LIMIT}`);
  }
  const targetIds = new Set(targets.map((t) => t.aletia_id));

  // ── 2. FDA submissions + list ──────────────────────────────────────────────
  const extIds = await loadFdaExternalIds(supabase);
  let withSubmissions = 0;
  for (const t of targets) if (extIds.has(t.aletia_id)) withSubmissions++;
  console.log(`[2/6] Devices with FDA submissions attached: ${withSubmissions}/${targets.length}`);

  console.log('      Fetching FDA AI/ML list CSV…');
  const fdaList = await fetchFdaAiMlList();
  const listByIdentifier = new Map<string, FdaListEntry>();
  for (const e of fdaList) listByIdentifier.set(e.identifier.toUpperCase(), e);
  console.log(`      FDA list entries: ${fdaList.length}`);

  // ── 3. Classification text ─────────────────────────────────────────────────
  const codesNeeded = new Set<string>();
  if (!NO_CLASSIFICATION) {
    for (const t of targets) {
      for (const sub of extIds.get(t.aletia_id) ?? []) {
        const entry = listByIdentifier.get(sub.toUpperCase());
        if (entry?.product_code) codesNeeded.add(entry.product_code.trim().toUpperCase());
      }
    }
  }
  console.log(`[3/6] Unique product codes needing classification text: ${codesNeeded.size}`);
  const classifications = codesNeeded.size
    ? await fetchClassifications(Array.from(codesNeeded).sort())
    : new Map<string, ClassificationText>();

  // ── 4. Queue cascade + overrides ───────────────────────────────────────────
  const queueCascade = await loadQueueCascade(supabase);
  let cascadeInTargets = 0;
  for (const id of queueCascade.keys()) if (targetIds.has(id)) cascadeInTargets++;
  console.log(`[4/6] Approved queue rows with specialty, resolving to target devices: ${cascadeInTargets}`);

  const overrides = loadOverrides(OVERRIDES_FILE);
  console.log(`      Overrides file (${OVERRIDES_FILE}): ${overrides.size} rows loaded`);

  // ── 5. Infer per device (master arbitration; precedence override > queue > master)
  console.log(`[5/6] Running inference over ${targets.length} devices…`);
  const decisions: DeviceDecision[] = [];

  for (const t of targets) {
    const submissions = extIds.get(t.aletia_id) ?? [];
    const listEntries = submissions
      .map((s) => listByIdentifier.get(s.toUpperCase()))
      .filter((e): e is FdaListEntry => !!e);

    const productCodes = Array.from(
      new Set(listEntries.map((e) => e.product_code?.trim().toUpperCase()).filter(Boolean))
    ) as string[];

    const evidence: SpecialtyEvidence = buildDeviceMasterEvidence({
      name: t.name,
      intendedUse: t.intended_use,
      description: t.description,
      fdaListDeviceNames: listEntries.map((e) => e.device_name),
      classificationNames: productCodes
        .map((c) => classifications.get(c)?.device_name ?? '')
        .filter(Boolean),
      classificationDefinitions: productCodes
        .map((c) => classifications.get(c)?.definition ?? '')
        .filter(Boolean),
      panels: listEntries.map((e) => e.panel),
      productCodes,
    });

    const master: MasterSpecialtyMatch = inferSpecialtyForMaster(evidence);
    const queue = queueCascade.get(t.aletia_id) ?? null;
    const override = overrides.get(t.aletia_id) ?? null;

    let chosenSpecialty: string | null;
    let chosenConfidence: SpecialtyConfidence;
    let route: DeviceDecision['chosen_route'];
    if (override && override.action === 'override') {
      chosenSpecialty = override.specialty;
      chosenConfidence = 'high'; // human decision
      route = 'override';
    } else if (queue) {
      chosenSpecialty = queue.specialty_inferred;
      chosenConfidence = queue.specialty_confidence;
      route = 'queue_cascade';
    } else if (master.specialty) {
      chosenSpecialty = master.specialty;
      chosenConfidence = master.confidence;
      route = 'master_text';
    } else {
      chosenSpecialty = null;
      chosenConfidence = 'none';
      route = 'none';
    }

    const reviewStatus: DeviceDecision['review_status'] =
      override ? 'confirmed' : '';

    decisions.push({
      aletia_id: t.aletia_id,
      name: t.name,
      fda_submissions: submissions,
      product_codes: productCodes,
      master_specialty: master.specialty,
      master_confidence: master.confidence,
      master_patterns: master.signals.matched_patterns,
      modality_only: master.modalityOnly,
      queue_specialty: queue?.specialty_inferred ?? null,
      queue_confidence: queue?.specialty_confidence ?? null,
      queue_id: queue?.queue_id ?? null,
      override_specialty: override?.action === 'override' ? override.specialty : null,
      override_note: override?.note ?? null,
      chosen_specialty: chosenSpecialty,
      chosen_confidence: chosenConfidence,
      chosen_route: route,
      review_status: reviewStatus,
      disagreement: !!(queue && master.specialty && queue.specialty_inferred !== master.specialty),
      evidence_fields: evidence.sourceFieldsUsed,
    });
  }

  // Sanity check: 'confirm' overrides whose computed value drifted from what
  // was confirmed in the spot-check — surface loudly, they need a re-look.
  const confirmDrift = decisions.filter((d) => {
    const o = overrides.get(d.aletia_id);
    return o?.action === 'confirm' && d.chosen_specialty !== o.specialty;
  });

  // ── 6. Report + workbook ───────────────────────────────────────────────────
  const byConfidence: Record<string, number> = {};
  const bySpecialty: Record<string, number> = {};
  let modalityOnlyCount = 0;
  for (const d of decisions) {
    byConfidence[d.chosen_confidence] = (byConfidence[d.chosen_confidence] ?? 0) + 1;
    if (d.chosen_specialty) bySpecialty[d.chosen_specialty] = (bySpecialty[d.chosen_specialty] ?? 0) + 1;
    if (d.modality_only && d.chosen_route === 'master_text') modalityOnlyCount++;
  }

  const writable = decisions.filter(
    (d) => d.chosen_specialty !== null && CONFIDENCE_RANK[d.chosen_confidence] >= CONFIDENCE_RANK['medium']
  );

  console.log(`\n[6/6] ===== Measurement (v2 arbitration) =====`);
  console.log(`  Targets processed          : ${decisions.length}`);
  console.log(`  By confidence              : ${JSON.stringify(byConfidence)}`);
  console.log(`  Modality-only (Radiology-medium default): ${modalityOnlyCount}`);
  console.log(`  Queue-cascade route        : ${decisions.filter((d) => d.chosen_route === 'queue_cascade').length}`);
  console.log(`  Override route             : ${decisions.filter((d) => d.chosen_route === 'override').length}`);
  console.log(`  Queue/master disagreements : ${decisions.filter((d) => d.disagreement).length}`);
  if (confirmDrift.length) {
    console.log(`  ⚠ CONFIRM-DRIFT (computed value differs from spot-check confirmation — re-review these): ${confirmDrift.length}`);
    for (const d of confirmDrift.slice(0, 10)) {
      console.log(`      ${d.aletia_id} ${d.name}: computed=${d.chosen_specialty}, confirmed=${overrides.get(d.aletia_id)?.specialty}`);
    }
  }
  console.log(`  By specialty               :`);
  for (const [s, n] of Object.entries(bySpecialty).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${s.padEnd(26)} ${n}`);
  }
  console.log(`  Review workbook rows (high+medium): ${writable.length}`);

  // Full report JSON.
  const reportPath = `debar-specialty-report-${ts}.json`;
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        mode: 'dry-run',
        version: 'v2-arbitration',
        totals: {
          targets: decisions.length,
          by_confidence: byConfidence,
          by_specialty: bySpecialty,
          modality_only: modalityOnlyCount,
          workbook_rows: writable.length,
          confirm_drift: confirmDrift.length,
        },
        decisions,
      },
      null, 2
    )
  );
  console.log(`\n  Report → ${reportPath}`);

  // FULL review workbook: sorted for fast scanning — specialty, then route
  // (override/confirmed rows first as pre-decided), then pattern class
  // (modality-only Radiology grouped at the end of the Radiology block),
  // then name.
  const routeRank: Record<DeviceDecision['chosen_route'], number> = {
    override: 0, queue_cascade: 1, master_text: 2, none: 3,
  };
  const workbook = [...writable].sort((a, b) =>
    (a.chosen_specialty ?? '').localeCompare(b.chosen_specialty ?? '') ||
    routeRank[a.chosen_route] - routeRank[b.chosen_route] ||
    Number(a.modality_only) - Number(b.modality_only) ||
    (a.name ?? '').localeCompare(b.name ?? '')
  );

  const header = [
    'aletia_id', 'name', 'final_specialty', 'chosen_confidence', 'chosen_route',
    'review_status', 'modality_only', 'master_specialty', 'queue_specialty',
    'override_note', 'matched_patterns', 'evidence_fields', 'product_codes', 'url',
  ].join(',');
  const rows = workbook.map((d) =>
    [
      d.aletia_id, d.name, d.chosen_specialty, d.chosen_confidence, d.chosen_route,
      d.review_status, d.modality_only ? 'YES' : '', d.master_specialty,
      d.queue_specialty, d.override_note, d.master_patterns.join(' ; '),
      d.evidence_fields.join(' ; '), d.product_codes.join(' ; '),
      `https://www.aletia-index.com/device/${d.aletia_id}`,
    ].map(csvCell).join(',')
  );
  const workbookPath = `debar-specialty-review-${ts}.csv`;
  writeFileSync(workbookPath, [header, ...rows].join('\n'));
  console.log(`  Review workbook (${workbook.length} rows) → ${workbookPath}`);

  console.log(
    `\nDRY RUN complete. Review the workbook (edit final_specialty to correct; BLANK it to leave null), then:\n` +
    `  npx tsx scripts/debar-specialty-master.ts --apply --decisions=${workbookPath} --expect=<non-blank count>\n` +
    `(The apply prints the exact count and aborts on mismatch — run it once without the right --expect to read the number if unsure.)\n`
  );
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
