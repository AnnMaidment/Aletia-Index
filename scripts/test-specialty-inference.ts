/**
 * scripts/test-specialty-inference.ts
 *
 * Framework-free fixture tests for the specialty evidence + taxonomy layers.
 * Run from repo root:
 *
 *   npx tsx scripts/test-specialty-inference.ts
 *
 * Exits 0 if all assertions pass, 1 otherwise. No DB, no env, no network —
 * pure functions over fixed raw_data fixtures lifted from real queue rows.
 *
 * Covers the acceptance criteria for the 2026-06-22 extractor refactor:
 *   - CT.gov camelCase fields (deviceName, title, briefSummary) are read
 *   - colonoscopy + "Colonic Neoplasms" → Gastroenterology, NOT Oncology
 *     (the misclassification the old field-mapping caused)
 *   - OSA / sleep-disordered breathing → Pulmonology
 *   - oleary_csv classifies off device NAME, not off panel/product_code
 *   - eudamed_sync thin rows do not hallucinate a specialty from a bare name
 *   - fda_dedup cluster rows are not classified as devices
 *   - attempted-but-unclassified yields confidence 'none'
 */

import { buildSpecialtyEvidence } from '../lib/specialtyEvidence';
import { inferSpecialty } from '../lib/specialtyTaxonomy';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function classify(rawData: any, source: string) {
  return inferSpecialty(buildSpecialtyEvidence(rawData, source));
}

function expectSpecialty(label: string, rawData: any, source: string, specialty: string | null) {
  const r = classify(rawData, source);
  if (r.specialty === specialty) {
    passed++;
  } else {
    failed++;
    failures.push(
      `${label}\n    expected specialty=${JSON.stringify(specialty)}, got ${JSON.stringify(r.specialty)} ` +
      `(confidence=${r.confidence}, signals=${JSON.stringify(r.signals.matched_patterns.slice(0, 4))})`
    );
  }
}

function expectConfidence(label: string, rawData: any, source: string, confidence: string) {
  const r = classify(rawData, source);
  if (r.confidence === confidence) {
    passed++;
  } else {
    failed++;
    failures.push(`${label}\n    expected confidence=${confidence}, got ${r.confidence}`);
  }
}

function expectAssert(label: string, cond: boolean, detail: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(`${label}\n    ${detail}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// clinical_trials (CT.gov camelCase: deviceName, title, briefSummary, conditions)
// ─────────────────────────────────────────────────────────────────────────

expectSpecialty(
  'CT camelCase — SmartECG-AFrisk / Atrial Fibrillation → Cardiology',
  {
    deviceName: 'AI-ECG Guided Care (SmartECG-AFrisk)',
    conditions: ['Atrial Fibrillation'],
    title: 'A Prospective, Multi-center, Randomized Clinical Trial to Evaluate the Detection of Atrial Fibrillation',
    briefSummary: 'evaluating the effectiveness of an artificial intelligence-enhanced electrocardiography algorithm',
  },
  'clinical_trials',
  'Cardiology'
);

expectSpecialty(
  'CT camelCase — DERM / Non-melanoma Skin Cancer → Dermatology',
  {
    deviceName: 'Deep Ensemble for the Recognition of Malignancy (DERM)',
    conditions: ['Non-melanoma Skin Cancer'],
    title: 'Effectiveness of an Image Analysing Algorithm (DERM) to Diagnose Non-melanoma Skin Cancer',
  },
  'clinical_trials',
  'Dermatology'
);

expectSpecialty(
  'CT camelCase — Macusense / retinal disease → Ophthalmology',
  {
    deviceName: 'Macusense Assessment Software',
    conditions: ['Wet Macular Degeneration', 'Diabetic Macular Edema', 'Retinal Vein Occlusion'],
    title: 'Artificial Intelligence Diagnostic Aid',
  },
  'clinical_trials',
  'Ophthalmology'
);

// THE regression: deviceName carries "colonoscopy", conditions carry only
// "Colonic Neoplasms". Old code ignored deviceName → matched Oncology /neoplasm/.
// New code reads deviceName → Gastroenterology /colonoscop/ wins at HIGH.
expectSpecialty(
  'CT camelCase — colonoscopy + Colonic Neoplasms → Gastroenterology (not Oncology)',
  {
    deviceName: 'Standard, high-definition colonoscopy with the use of CADe assistance',
    conditions: ['Colonic Neoplasms'],
    title: 'Saving by Artificial Intelligence for Virtual Endoscopy Biopsy',
  },
  'clinical_trials',
  'Gastroenterology'
);
expectAssert(
  'colonoscopy regression reads deviceName',
  classify(
    { deviceName: 'colonoscopy withdrawal with the ADS monitoring', conditions: ['Colonic Neoplasms'] },
    'clinical_trials'
  ).signals.source_fields.includes('deviceName'),
  'expected source_fields to include deviceName'
);

// OSA / sleep — routes to Pulmonology (decision 2026-06-22)
expectSpecialty(
  'CT camelCase — pure OSA (jaw tracker) → Pulmonology',
  {
    deviceName: 'Ultrasonic Jaw Tracking Device',
    conditions: ['Obstructive Sleep Apnea'],
    title: 'Prospective Study on a Novel Ultrasonic Jaw Tracking Device in Patients with Sleep Apnea',
  },
  'clinical_trials',
  'Pulmonology'
);

// Belun Ring — sleep AND arrhythmia. Documents the dual-signal behaviour:
// Cardiology wins under first-match-wins, but BOTH specialties appear in signals.
{
  const r = classify(
    {
      deviceName: 'Belun Ring',
      conditions: ['Sleep-Disordered Breathing', 'Sleep Architecture', 'Arrhythmia'],
    },
    'clinical_trials'
  );
  const pats = r.signals.matched_patterns.join(' ');
  expectAssert(
    'Belun Ring surfaces BOTH Cardiology and Pulmonology signals (dual, honest)',
    pats.includes('Cardiology') && pats.includes('Pulmonology'),
    `expected both specialties in matched_patterns, got: ${JSON.stringify(r.signals.matched_patterns)}`
  );
}

// ─────────────────────────────────────────────────────────────────────────
// oleary_csv — classifies off device NAME, never off panel/product_code
// ─────────────────────────────────────────────────────────────────────────

expectSpecialty(
  'oleary — device name carries signal (mammography) → Radiology',
  { device: 'PowerLook Tomo Detection (mammography)', panel: 'Radiology', product_code: 'MYN' },
  'oleary_csv',
  'Radiology'
);

// Generic name + only panel/product_code as specialty hint → must NOT classify.
expectSpecialty(
  'oleary — panel "Clinical Chemistry" alone does NOT manufacture a specialty',
  { device: 'LensHooke Analyzer', panel: 'Clinical Chemistry', product_code: 'POV' },
  'oleary_csv',
  null
);
expectConfidence(
  'oleary — panel-only row → none',
  { device: 'LensHooke Analyzer', panel: 'Clinical Chemistry', product_code: 'POV' },
  'oleary_csv',
  'none'
);

// ─────────────────────────────────────────────────────────────────────────
// eudamed_sync — thin rows must not hallucinate from a bare product name
// ─────────────────────────────────────────────────────────────────────────

expectSpecialty(
  'eudamed thin — HealthOST (non-specific name) → none',
  { source: 'eudamed_sync', device_name: 'HealthOST', manufacturer_name: 'Nano-X AI Ltd.', fda_submissions: ['K213944'] },
  'eudamed_sync',
  null
);

// A genuinely specific eudamed name is allowed to classify (not a hallucination).
expectSpecialty(
  'eudamed — specific name "Auto Lung Nodule Detection" → Radiology',
  { source: 'eudamed_sync', device_name: 'Auto Lung Nodule Detection', manufacturer_name: 'Samsung Electronics Co.,Ltd' },
  'eudamed_sync',
  'Radiology'
);

// ─────────────────────────────────────────────────────────────────────────
// fda_dedup — cluster object, never classified as a device
// ─────────────────────────────────────────────────────────────────────────

expectSpecialty(
  'fda_dedup — cluster row produces no device specialty',
  {
    band: 'C',
    kind: 'fda_dedup',
    name_key: 'ai rad companion (pulmonary)',
    product_codes: ['JAK'],
    proposed_survivor: 'ALT-001018',
    members: [{ name: 'AI-Rad Companion (Pulmonary)', fda_ids: ['K183271'], aletia_id: 'ALT-001018' }],
  },
  'fda_dedup',
  null
);

// ─────────────────────────────────────────────────────────────────────────
// attempted-but-unclassified → 'none'
// ─────────────────────────────────────────────────────────────────────────

expectConfidence(
  'no clinical signal → confidence none',
  { deviceName: 'Generic Monitoring Platform', conditions: ['Healthy Volunteers'] },
  'clinical_trials',
  'none'
);

// ─────────────────────────────────────────────────────────────────────────
// Pattern-gap fixes (clean-set patch, 2026-06) — from the audited core set
// ─────────────────────────────────────────────────────────────────────────

expectSpecialty(
  'stroke — Viz LVO → Neurology',
  { deviceName: 'Viz LVO', conditions: ['Stroke, Ischemic'] },
  'clinical_trials',
  'Neurology'
);
expectSpecialty(
  'stroke — Viz ICH VOLUME / intracerebral haemorrhage → Neurology',
  { deviceName: 'Viz ICH VOLUME', conditions: ['Intracerebral Hemorrhage'] },
  'clinical_trials',
  'Neurology'
);
expectSpecialty(
  'aneurysm — AI-Assisted CTA → Neurology',
  { deviceName: 'AI-Assisted CTA Interpretation', conditions: ['Intracranial Aneurysm', 'CT Angiography'] },
  'clinical_trials',
  'Neurology'
);
expectSpecialty(
  'valve — heart murmur / aortic stenosis → Cardiology',
  { deviceName: 'Automated Heart Murmur Detection AI', conditions: ['Aortic Stenosis', 'Mitral Regurgitation'] },
  'clinical_trials',
  'Cardiology'
);
expectSpecialty(
  'cytopathology — ROSE-AI → Pathology (not Radiology)',
  {
    deviceName: 'ROSE-AI diagnostic system',
    conditions: ['Pancreatic Disease'],
    briefSummary: 'whole slide scanning and cytopathology of Diff-Quik stained smears using optical imaging',
  },
  'clinical_trials',
  'Pathology'
);

// ─────────────────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────────────────

console.log('');
console.log(`specialty inference tests: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('');
  for (const f of failures) console.log('  ✗ ' + f);
  console.log('');
  process.exit(1);
}
console.log('  all green');
process.exit(0);
