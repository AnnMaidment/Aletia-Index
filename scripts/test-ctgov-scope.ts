/**
 * scripts/test-ctgov-scope.ts
 *
 * Fixtures for lib/ctgovScope.ts. Pure — no network, no database.
 *
 *   npx tsx scripts/test-ctgov-scope.ts
 *
 * These fixtures encode the DECISION RULES. They are not a substitute for
 * scripts/validate-ctgov-scope.ts, which replays the classifier against the
 * 487 human decisions in scope-decisions.csv and is the number that decides
 * whether auto-create is allowed to exist. Fixtures catch regressions in the
 * rules; validation measures whether the rules are right.
 *
 * Text below is paraphrased from the shapes seen in the 22 Jun triage — the
 * trial descriptions themselves live in the queue rows, not in the repo.
 */

import { classifyCtgovScope, type ScopeTier, type ScopeReason } from '../lib/ctgovScope'

interface Case {
  name: string
  input: { title?: string; briefSummary?: string; deviceName?: string | null; conditions?: string[] }
  tier: ScopeTier
  reason: ScopeReason
}

const CASES: Case[] = [
  // ── OUT: the contaminating keyword, the reason this classifier exists ─────
  {
    name: "'neural network' means the brain",
    input: {
      title: 'Effects of tDCS on Functional Neural Network Connectivity in Depression',
      briefSummary: 'Resting-state fMRI is used to measure changes in cortical connectivity and neural network organisation following transcranial direct current stimulation.',
      conditions: ['Major Depressive Disorder'],
    },
    tier: 'out_of_scope', reason: 'stimulation_modality',
  },
  {
    name: "'neural network' anatomical, no stimulator present",
    input: {
      title: 'Neural Network Reorganisation After Stroke',
      briefSummary: 'We examine white matter integrity and functional connectivity to characterise how the brain neural network reorganises during recovery.',
      conditions: ['Stroke'],
    },
    tier: 'out_of_scope', reason: 'anatomical_neural_network',
  },
  {
    name: 'deep brain stimulation with an ML analysis step',
    input: {
      title: 'Deep Brain Stimulation for Parkinson Disease',
      briefSummary: 'Machine learning is applied post hoc to local field potentials recorded during deep brain stimulation.',
      conditions: ['Parkinson Disease'],
    },
    tier: 'out_of_scope', reason: 'stimulation_modality',
  },

  // ── OUT: not a device trial ──────────────────────────────────────────────
  {
    name: 'drug trial with an AI-read endpoint',
    input: {
      title: 'A Randomised, Placebo-Controlled Trial of Drug X in Rheumatoid Arthritis',
      briefSummary: 'Radiographic progression is scored using an artificial intelligence assisted reading pipeline.',
      conditions: ['Rheumatoid Arthritis'],
    },
    tier: 'out_of_scope', reason: 'non_device_trial',
  },

  // ── QUEUED: AI improves the picture, not the finding ─────────────────────
  // These were out_of_scope until the 28 Aug validation put two real examples
  // in the silent-loss column — the human reviewer KEPT both. They now queue.
  {
    name: 'deep learning image reconstruction on an MRI scanner',
    input: {
      title: 'Deep Learning Image Reconstruction for Accelerated Knee MRI',
      briefSummary: 'We compare scan time and image quality improvement between conventional and deep learning reconstruction.',
      conditions: ['Knee Injuries'],
    },
    tier: 'in_scope_low', reason: 'ai_improved_conventional',
  },
  {
    name: 'AI denoising for dose reduction in CT',
    input: {
      title: 'AI-Based Denoising for Low-Dose Chest CT',
      briefSummary: 'An artificial intelligence denoising algorithm is evaluated for dose reduction while preserving diagnostic quality.',
      conditions: ['Lung Diseases'],
    },
    tier: 'in_scope_low', reason: 'ai_improved_conventional',
  },

  // ── OUT: nothing at all ──────────────────────────────────────────────────
  {
    name: 'ordinary device trial, no AI',
    input: {
      title: 'Safety and Performance of a Coronary Stent',
      briefSummary: 'A prospective single-arm study of stent patency at 12 months.',
      conditions: ['Coronary Artery Disease'],
    },
    tier: 'out_of_scope', reason: 'no_ai_signal',
  },

  // ── IN (high): the article is the algorithm ──────────────────────────────
  {
    name: 'CADe for colonoscopy',
    input: {
      title: 'Computer-Aided Detection for Colonoscopy: A Randomised Trial',
      briefSummary: 'A deep learning polyp detection system provides real-time computer-aided detection during colonoscopy. Adenoma detection rate is the primary endpoint.',
      deviceName: 'GI Genius',
      conditions: ['Colorectal Polyps'],
    },
    tier: 'in_scope_high', reason: 'ai_device_function',
  },
  {
    name: 'autonomous diabetic retinopathy screening',
    input: {
      title: 'Autonomous AI for Diabetic Retinopathy Screening in Primary Care',
      briefSummary: 'An artificial intelligence diagnostic algorithm performs automated grading of retinal images without specialist input.',
      deviceName: 'IDx-DR',
      conditions: ['Diabetic Retinopathy'],
    },
    tier: 'in_scope_high', reason: 'ai_device_function',
  },
  {
    name: 'stroke triage software',
    input: {
      title: 'AI-Based Triage of Large Vessel Occlusion on CT Angiography',
      briefSummary: 'A machine learning model for detection of large vessel occlusion notifies the stroke team. Time-to-notification is measured.',
      deviceName: 'Viz LVO',
      conditions: ['Ischemic Stroke'],
    },
    tier: 'in_scope_high', reason: 'ai_device_function',
  },

  // ── IN (low): needs a human ──────────────────────────────────────────────
  {
    name: 'single function claim, no AI vocabulary',
    input: {
      title: 'Evaluation of an Automated Segmentation Tool for Radiotherapy Planning',
      briefSummary: 'Contours produced by the tool are compared against expert delineation.',
      conditions: ['Head and Neck Neoplasms'],
    },
    tier: 'in_scope_low', reason: 'ai_device_function',
  },
  {
    name: 'AI vocabulary only, no functional claim',
    input: {
      title: 'Artificial Intelligence in Cardiology: An Observational Cohort',
      briefSummary: 'We describe the use of machine learning approaches across a cardiology service.',
      conditions: ['Heart Diseases'],
    },
    tier: 'in_scope_low', reason: 'ai_lexicon_only',
  },
  {
    name: 'closed-loop AI-guided stimulation — rescued from the stimulation bucket',
    input: {
      title: 'Closed-Loop Responsive Neurostimulation With an AI-Based Seizure Detection Algorithm',
      briefSummary: 'A machine learning classifier for detection of seizure onset drives responsive stimulation.',
      conditions: ['Epilepsy'],
    },
    tier: 'in_scope_low', reason: 'ai_device_function',
  },

  // ── Regressions from the 28 Aug validation run ───────────────────────────
  {
    name: "'CAD' meaning coronary artery disease must not fire",
    input: {
      title: 'Wearable Multi-Channel ECG Acquisition Device in Patients With CAD',
      briefSummary: 'An artificial intelligence approach is applied to recordings from patients with known CAD.',
      deviceName: 'wearable multi-channel ECG acquisition device',
      conditions: ['Coronary Artery Disease'],
    },
    tier: 'in_scope_low', reason: 'ai_lexicon_only',
  },
  {
    name: "'CAD' meaning computer-aided design must not fire",
    input: {
      title: '3D Reconstruction Technology for Surgical Planning',
      briefSummary: 'CAD models are produced and artificial intelligence assists the reconstruction.',
      deviceName: '3D Reconstruction Technology',
      conditions: ['Surgery'],
    },
    tier: 'in_scope_low', reason: 'ai_lexicon_only',
  },
  {
    name: 'device named as AI survives a drug-trial context',
    input: {
      title: 'A Randomised Trial of Drug X With an AI Assistant',
      briefSummary: 'Placebo-controlled study of drug X; an assistant system supports dosing.',
      deviceName: 'Artificial intelligence assistant system',
      conditions: ['Hypertension'],
    },
    tier: 'in_scope_low', reason: 'non_device_trial',
  },
  {
    name: 'device named as AI survives a stimulation context',
    input: {
      title: 'Neuromodulation Wristband for Tremor',
      briefSummary: 'A wristband delivering peripheral nerve stimulation.',
      deviceName: 'Felix NeuroAI Wristband',
      conditions: ['Essential Tremor'],
    },
    tier: 'in_scope_low', reason: 'stimulation_modality',
  },
  {
    name: "'Clinical Decision Support Device' is a device-function claim",
    input: {
      title: 'Evaluation of a Clinical Decision Support Device',
      briefSummary: 'Prospective evaluation in primary care.',
      deviceName: 'Clinical Decision Support Device',
      conditions: ['Primary Health Care'],
    },
    tier: 'in_scope_low', reason: 'ai_device_function',
  },

  // ── Regressions from the 28 Aug SECOND validation run ────────────────────
  // The non_device_trial rule was the only leaky drop rule in the classifier:
  // 7 rejects caught, 3 keeps silently lost. All three were AI articles that
  // merely happened to concern medication. The list is now split into design
  // markers (drop) and context words (queue, if any AI vocabulary is present).
  {
    name: "'drug' as a topic word must not delete a medication-information AI",
    input: {
      title: 'Evaluation of an Artificial Intelligence Medication Information Assistant',
      briefSummary: 'A machine learning system answers clinician questions about drug interactions and dosing.',
      deviceName: 'Posos',
      conditions: ['Medication Errors'],
    },
    tier: 'in_scope_low', reason: 'ai_lexicon_only',
  },
  {
    name: "'chemotherapy' as patient context must not delete an imaging AI",
    input: {
      title: 'Machine Learning Analysis of PET/CT and MR Spectroscopy Treatment Response',
      briefSummary: 'Patients receiving chemotherapy undergo serial imaging; a machine learning approach is evaluated against response criteria.',
      deviceName: 'PET/CT, H-MRS and MRI',
      conditions: ['Neoplasms'],
    },
    tier: 'in_scope_low', reason: 'ai_lexicon_only',
  },
  {
    name: 'a context word with NO AI vocabulary still drops',
    input: {
      title: 'A Trial of Suture Technique in Abdominal Wound Closure',
      briefSummary: 'Two wound closure methods are compared for dehiscence rate.',
      conditions: ['Surgical Wound'],
    },
    tier: 'out_of_scope', reason: 'non_device_trial',
  },
  {
    name: 'a DESIGN marker still drops even with AI vocabulary present',
    input: {
      title: 'A Placebo-Controlled Trial of Compound Y',
      briefSummary: 'Endpoints are adjudicated with machine learning assistance.',
      conditions: ['Hypertension'],
    },
    tier: 'out_of_scope', reason: 'non_device_trial',
  },

  // ── Guards ───────────────────────────────────────────────────────────────
  {
    name: "bare 'software' must not be a signal",
    input: {
      title: 'Electronic Data Capture Software for a Multicentre Registry',
      briefSummary: 'Study software and an algorithm for randomisation are described.',
      conditions: ['Registries'],
    },
    tier: 'out_of_scope', reason: 'no_ai_signal',
  },
  {
    name: 'empty input',
    input: {},
    tier: 'out_of_scope', reason: 'no_ai_signal',
  },
]

let pass = 0
const failures: string[] = []

for (const c of CASES) {
  const v = classifyCtgovScope(c.input)
  const errs: string[] = []
  if (v.tier !== c.tier) errs.push(`tier ${v.tier} ≠ expected ${c.tier}`)
  if (v.reason !== c.reason) errs.push(`reason ${v.reason} ≠ expected ${c.reason}`)

  if (errs.length) {
    failures.push(`  ✗ ${c.name}\n      ${errs.join('\n      ')}\n      detail: ${v.detail}`)
  } else {
    pass++
    console.log(`  ✓ ${c.name.padEnd(58)} ${v.tier}/${v.reason}`)
  }
}

console.log(`\n${pass}/${CASES.length} passed`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(f)
  process.exit(1)
}
console.log('All ctgovScope fixtures green.')
console.log('NOTE: fixtures are not validation. Run scripts/validate-ctgov-scope.ts')
console.log('      against the 487 labelled rows before enabling auto-create.\n')
