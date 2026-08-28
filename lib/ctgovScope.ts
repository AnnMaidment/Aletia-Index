// ============================================================================
// lib/ctgovScope.ts
//
// In-scope classifier for ClinicalTrials.gov rows. Pure — no network, no DB,
// no side effects — so it can be fixture-tested and replayed against the 487
// labelled rows in scope-decisions.csv without touching production.
//
// ── The bar ─────────────────────────────────────────────────────────────────
// A trial belongs on the index iff the AI/ML is INTEGRAL TO THE DEVICE UNDER
// STUDY. Not "the trial mentions AI". Not "the sponsor makes AI devices". The
// article being evaluated has to be the algorithm doing a clinical job.
//
// This is the same discipline BUG-012 imposed on the FDA path (list membership,
// not keyword proxy) and the MHRA posture fix imposed on GMDN sweeps. CT.gov is
// the last path where a bare keyword match could put a device in the index.
//
// ── Why the old filter failed ───────────────────────────────────────────────
// `isAIMLTrial` in lib/clinicalTrialsIngest.ts matched a flat keyword list
// against title + summary + device name + conditions. Three distinct failure
// modes, all visible in the 487 human decisions:
//
//   1. 'neural network' is an ANATOMICAL term. In an fMRI/EEG/connectivity
//      trial it means the brain's network. The trial is about a stimulator, a
//      drug, or nothing device-like at all.
//   2. 'deep learning' appears in trials of PHYSICAL devices whose vendor uses
//      DL somewhere in the pipeline — a scanner with DL reconstruction is a
//      scanner. The studied article is hardware.
//   3. 'software' and 'algorithm' (in the earlier triage probe's AI_DEVICE
//      list) match essentially any modern trial description. They are not
//      evidence of anything and are deliberately absent below.
//
// ── Output ──────────────────────────────────────────────────────────────────
// Three tiers, and the caller's policy differs per tier:
//
//   out_of_scope   → drop. Do not queue: a queue row is a question to a human,
//                    and these are not questions worth asking 150 times.
//   in_scope_low   → queue for review. Never auto-create.
//   in_scope_high  → eligible for auto-create IF the caller's other conditions
//                    hold (commercial sponsor, no merge candidates). Eligible,
//                    not entitled — see AUTO_CREATE_ELIGIBLE below.
//
// Every verdict carries a reason code and the strings that fired, because a
// classifier whose decisions cannot be audited is a classifier that cannot be
// tuned.
// ============================================================================

export type ScopeTier = 'out_of_scope' | 'in_scope_low' | 'in_scope_high'

export type ScopeReason =
  | 'non_device_trial'          // drug/vaccine/surgical trial — no device article
  | 'stimulation_modality'      // the article is a stimulator; AI is incidental
  | 'anatomical_neural_network' // 'neural network' = the brain
  | 'ai_improved_conventional'  // AI improves acquisition/reconstruction/workflow, not the finding
  | 'ai_device_function'        // the article IS the algorithm doing a clinical job
  | 'ai_lexicon_only'           // AI vocabulary with no functional claim
  | 'no_ai_signal'              // nothing fired

export interface ScopeInput {
  title?: string | null
  briefSummary?: string | null
  deviceName?: string | null
  conditions?: string[] | string | null
}

export interface ScopeVerdict {
  tier: ScopeTier
  reason: ScopeReason
  /** Human-readable one-liner for the audit CSV and the queue row's note. */
  detail: string
  /** The lexicon entries that fired, for tuning. */
  matched: string[]
}

/** Tiers a caller may auto-create from. Deliberately a named constant: flipping
 *  auto-create on or off should be one obvious edit with one obvious meaning. */
export const AUTO_CREATE_ELIGIBLE: readonly ScopeTier[] = ['in_scope_high']

// ── Lexicons ────────────────────────────────────────────────────────────────
// Order matters below; these are just the vocabulary.

/**
 * Trials whose article is plainly not a device. Checked first: a drug trial
 * that mentions an AI-assisted endpoint is still a drug trial.
 */
const NON_DEVICE_TRIAL = [
  /\bplacebo[- ]controlled\b/i, /\bdrug\b/i, /\bvaccine\b/i, /\bdose escalation\b/i,
  /\bpharmacokinetic/i, /\bchemotherapy\b/i, /\bimmunotherapy\b/i,
  /\bantimicrobial susceptibility\b/i, /\bbreakpoint\b/i,
  /minimum inhibitory concentration/i, /\bculture media\b/i,
  /\bspinal (fixation|fusion)\b/i, /\bbone screw\b/i, /\bvascular graft\b/i,
  /\bsuture\b/i, /\bwound closure\b/i, /\b(hip|knee) replacement\b/i,
  /\bdental implant\b/i, /\bface mask\b/i, /\brespirator\b/i,
  /\brt-?pcr\b/i, /\bpcr assay\b/i, /\blateral flow\b/i, /\brapid antigen\b/i,
]

/**
 * Physical stimulation / neuromodulation. If this is the article, any AI is a
 * downstream analysis step. Carried over from probe-ctgov-scope-audit.ts,
 * which is where the pattern was first characterised.
 */
const STIMULATION = [
  /\btdcs\b/i, /\btacs\b/i, /\btsms\b/i, /\btscs\b/i, /\brtms\b/i, /\btms\b/i,
  /transcranial/i, /theta burst/i, /deep brain stimulation/i, /\bdbs\b/i,
  /vagus nerve/i, /electroacupuncture/i, /photobiomodulation/i,
  /near[- ]infrared/i, /neurostimulation/i, /neuromodulation/i,
  /brain stimulation/i, /magnetic stimulation/i, /sensory flicker/i,
  /\bnir-?pbm\b/i, /transcutaneous .*stimulation/i, /spinal cord stimulation/i,
  /electrical stimulation/i,
]

/** Terms that mark 'neural network' as anatomical rather than artificial. */
const BRAIN_CONTEXT = [
  /cortical/i, /\bcortex\b/i, /\bfmri\b/i, /\beeg\b/i, /oscillat/i,
  /connectivity/i, /neuroplastic/i, /neural mechanism/i, /\bbrain network/i,
  /functional connectivity/i, /resting[- ]state/i, /white matter/i,
  /\bneurons?\b/i, /synaptic/i,
]

/**
 * The AI improves how an image is ACQUIRED, RECONSTRUCTED or MOVED — not what
 * is concluded from it. A scanner with DL reconstruction is a scanner; a
 * worklist that reorders studies without making a finding is a workflow tool.
 *
 * These are the 16 rows the 22 Jun review labelled 'capture_improved': rejected
 * from the index, but a distinct category worth naming rather than lumping in
 * with the neuromodulation noise. Kept out of scope here — if that call is ever
 * revisited, this is the one lexicon to move.
 */
const AI_IMPROVED_CONVENTIONAL = [
  /deep[- ]learning (image )?reconstruction/i, /\bdlir\b/i,
  /ai[- ](based |powered |assisted )?reconstruction/i,
  /image reconstruction algorithm/i,
  /\bdenois/i, /super[- ]resolution/i, /\bscan time\b/i,
  /(dose|noise) reduction/i, /accelerat(ed|ion) (mri|acquisition|imaging)/i,
  /image quality (improvement|enhancement)/i,
  /motion correction/i, /auto(mated|matic) (positioning|patient positioning)/i,
  /workflow (efficiency|optimi[sz]ation|improvement)/i,
  /\bprotocol optimi[sz]ation\b/i,
]

/**
 * The article IS the algorithm, performing a clinical job. This is the
 * integrality bar in lexical form.
 *
 * NOT here, on purpose: bare 'software', bare 'algorithm', bare 'neural
 * network', bare 'deep learning', bare 'machine learning', bare 'artificial
 * intelligence'. Each is vocabulary, not function. They contribute to
 * AI_LEXICON below, which can only reach in_scope_low.
 */
const AI_DEVICE_FUNCTION = [
  /computer[- ]?(aided|assisted) (detection|diagnosis|triage)/i,
  // NOT bare /\bcade?\b/ — validated 28 Aug, it produced two false inclusions on
  // its own. "CAD" is a false friend twice over: coronary artery disease in a
  // cardiology trial (NCT06868940, a wearable ECG device) and computer-aided
  // DESIGN in an engineering one (NCT06507774, 3D reconstruction). Only the
  // unambiguous forms survive.
  /\bcade\b/i, /\bcadx\b/i, /\bcad (system|software|device)\b/i,
  /automated (detection|diagnosis|classification|grading|segmentation|interpretation|screening|scoring|quantification)/i,
  /automatic (detection|diagnosis|classification|grading|segmentation|interpretation)/i,
  /(lesion|polyp|nodule|haemorrhage|hemorrhage|fracture|aneurysm|embolism|tumou?r) detection/i,
  /(diabetic retinopathy|breast cancer|lung cancer|stroke) (detection|screening|triage)/i,
  /ai[- ](based |powered |enabled |assisted |driven |augmented )?(detection|diagnosis|diagnostic|triage|screening|classification|segmentation)/i,
  /(detection|diagnostic|triage|screening|prognostic) (algorithm|model|software|system|tool|device)/i,
  /clinical decision support (system|software|tool|device)/i,
  /\bcdss\b/i,
  /risk (prediction|stratification|score) (model|algorithm|software|tool)/i,
  /predictive (model|algorithm) for/i,
  /image (analysis|interpretation) (software|system|algorithm)/i,
  /(software|algorithm) as a medical device/i, /\bsamd\b/i,
  /machine learning (model|algorithm|classifier) (to|for) (detect|diagnos|predict|classif|identif)/i,
  /deep learning (model|algorithm|system) (to|for) (detect|diagnos|predict|classif|identif)/i,
  /large language model/i, /\bllm\b/i, /natural language processing/i,
  /computer vision/i,
]

/** Vocabulary only. Enough to look at; never enough to auto-create. */
const AI_LEXICON = [
  /artificial intelligence/i, /machine learning/i, /deep learning/i,
  /neural network/i, /convolutional/i, /transformer model/i,
  /foundation model/i, /generative ai/i, /\bai\/ml\b/i, /\bml model\b/i,
  /\bai\b(?![-\w])/i,
]

// ── Helpers ─────────────────────────────────────────────────────────────────

function hits(text: string, lex: RegExp[]): string[] {
  const out: string[] = []
  for (const rx of lex) if (rx.test(text)) out.push(rx.source)
  return out
}

/** Flatten the input into one lowercase haystack. */
export function scopeText(input: ScopeInput): string {
  const conditions = Array.isArray(input.conditions)
    ? input.conditions.join(' ')
    : (input.conditions ?? '')
  return [input.title, input.briefSummary, input.deviceName, conditions]
    .map((s) => (s ?? '').toString())
    .join(' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

// ── The classifier ──────────────────────────────────────────────────────────

export function classifyCtgovScope(input: ScopeInput): ScopeVerdict {
  const text = scopeText(input)

  if (!text.trim()) {
    return { tier: 'out_of_scope', reason: 'no_ai_signal', detail: 'empty text', matched: [] }
  }

  // The device name is the ARTICLE UNDER STUDY — the strongest single statement
  // of what the trial is actually evaluating. When the name itself carries AI
  // vocabulary or a device-function claim, no amount of surrounding context
  // should drop the row silently: an "Artificial intelligence assistant system"
  // is not a drug trial because the summary happens to say 'drug'.
  //
  // Added 28 Aug after validation. Three of nine silent losses were exactly
  // this shape: NCT05497258 "Artificial intelligence assistant system" and
  // NCT05303051 dropped on \bdrug\b; NCT06235190 "Felix NeuroAI Wristband"
  // dropped as a stimulator. This floors them at in_scope_low — a human sees
  // them — without promoting anything to auto-create tier.
  const nameRaw  = (input.deviceName ?? '')
  const nameOnly = nameRaw.toLowerCase()
  const nameSignal = nameOnly.trim()
    ? [...hits(nameOnly, AI_DEVICE_FUNCTION), ...hits(nameOnly, AI_LEXICON)]
    : []

  // Camel-case AI inside a product name is a deliberate branding claim, and the
  // lowercased lexicon cannot see it: /\bai\b/ finds nothing in "NeuroAI"
  // because there is no word boundary. Matched against ORIGINAL casing, with
  // AI neither preceded nor followed by another letter, so "NeuroAI" and
  // "CardioAI" match while "CHAIR" and "AIRWAY" do not.
  // (NCT06235190, "Felix NeuroAI Wristband", was a silent loss without this.)
  if (/(?<![A-Za-z])AI(?![A-Za-z])|(?<=[a-z])AI(?![A-Za-z])/.test(nameRaw)) {
    nameSignal.push('AI in product name')
  }

  const fn      = hits(text, AI_DEVICE_FUNCTION)
  const lexicon = hits(text, AI_LEXICON)
  const stim    = hits(text, STIMULATION)
  const brain   = hits(text, BRAIN_CONTEXT)
  const improved = hits(text, AI_IMPROVED_CONVENTIONAL)
  const nonDevice = hits(text, NON_DEVICE_TRIAL)

  // 1. Not a device trial at all. Checked first and unconditionally: a drug
  //    trial with an AI-read endpoint is a drug trial.
  if (nonDevice.length && fn.length === 0) {
    return applyDeviceNameFloor({
      tier: 'out_of_scope',
      reason: 'non_device_trial',
      detail: `non-device trial article (${nonDevice[0]})`,
      matched: nonDevice,
    }, nameSignal)
  }

  // 2. Physical stimulation article. A genuine closed-loop AI-guided
  //    stimulator does exist, so a strong device-function signal rescues it —
  //    to in_scope_low, never straight to auto-create.
  if (stim.length) {
    if (fn.length) {
      return {
        tier: 'in_scope_low',
        reason: 'ai_device_function',
        detail: `stimulation article (${stim[0]}) WITH a device-function claim (${fn[0]}) — closed-loop candidate, needs a human`,
        matched: [...stim, ...fn],
      }
    }
    return applyDeviceNameFloor({
      tier: 'out_of_scope',
      reason: 'stimulation_modality',
      detail: `article is a stimulator (${stim[0]}); any AI is a downstream analysis step`,
      matched: stim,
    }, nameSignal)
  }

  // 3. 'neural network' as anatomy. Only fires when the sole AI evidence is
  //    lexical — a device-function claim outranks brain context.
  if (!fn.length && lexicon.length && brain.length && /neural network/i.test(text)) {
    return applyDeviceNameFloor({
      tier: 'out_of_scope',
      reason: 'anatomical_neural_network',
      detail: `'neural network' in brain context (${brain[0]}) with no device-function claim — anatomical, not artificial`,
      matched: [...brain, 'neural network'],
    }, nameSignal)
  }

  // 4. AI improves acquisition/reconstruction/workflow rather than the finding.
  //    Requires an AI signal to be present at all — 'motion correction' on its
  //    own is just an imaging trial, not an AI-improved one.
  if (improved.length && (lexicon.length || fn.length) && !fn.length) {
    // QUEUED, not dropped. The 28 Aug validation put two of these in the silent
    // -loss column: GE TrueFidelity (NCT03980470) and a denoising algorithm
    // (NCT04775810), both of which the human reviewer KEPT. DL image
    // reconstruction is a shipped, cleared product category, so the judgement
    // "the AI improves the picture, not the finding" is a reviewer's call to
    // make and not the classifier's to make silently.
    return {
      tier: 'in_scope_low',
      reason: 'ai_improved_conventional',
      detail: `AI improves acquisition/reconstruction/workflow (${improved[0]}) rather than the clinical finding — reviewer's call`,
      matched: improved,
    }
  }

  // 5. The article is the algorithm doing a clinical job.
  if (fn.length) {
    // Two independent function signals, or one plus explicit AI vocabulary,
    // is the bar for high confidence. A single unsupported phrase is not.
    const strong = fn.length >= 2 || (fn.length >= 1 && lexicon.length >= 1)
    return {
      tier: strong ? 'in_scope_high' : 'in_scope_low',
      reason: 'ai_device_function',
      detail: strong
        ? `device-function claim corroborated (${fn.slice(0, 2).join(', ')}${lexicon.length ? ` + AI vocabulary ${lexicon[0]}` : ''})`
        : `single device-function claim (${fn[0]}) with no corroborating AI vocabulary`,
      matched: [...fn, ...lexicon],
    }
  }

  // 6. AI vocabulary, no functional claim. Look, don't mint.
  if (lexicon.length) {
    return {
      tier: 'in_scope_low',
      reason: 'ai_lexicon_only',
      detail: `AI vocabulary (${lexicon[0]}) with no device-function claim`,
      matched: lexicon,
    }
  }

  return applyDeviceNameFloor(
    { tier: 'out_of_scope', reason: 'no_ai_signal', detail: 'no AI signal', matched: [] },
    nameSignal,
  )
}

/**
 * The device-name floor. Applied to every verdict: a row whose ARTICLE is named
 * as AI never disappears silently, whatever the surrounding text says.
 * Floors at in_scope_low only — it can rescue a row into the queue, never
 * promote one toward auto-create.
 */
function applyDeviceNameFloor(v: ScopeVerdict, nameSignal: string[]): ScopeVerdict {
  if (v.tier !== 'out_of_scope' || nameSignal.length === 0) return v
  return {
    ...v,
    tier: 'in_scope_low',
    detail: `${v.detail} — but the device name itself claims AI (${nameSignal[0]}), so queued rather than dropped`,
    matched: [...v.matched, ...nameSignal],
  }
}

/** Convenience for ingest paths: may this verdict auto-create a device? */
export function mayAutoCreate(verdict: ScopeVerdict): boolean {
  return AUTO_CREATE_ELIGIBLE.includes(verdict.tier)
}
