import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { fetchAllAIDeviceTrials, ClinicalTrial } from './clinicalTrials'
import { matchManufacturer } from './matchManufacturer'
import {
  processExternalIdentifier,
  logIngestionAnomaly,
  type IngestDecision,
} from './ingestion'

// =============================================================================
// ClinicalTrials.gov ingest — rewritten for A2b (April 2026)
//
// What changed from the pre-A2b version:
//   - Dropped the `ulid()` device_id synthesis. New devices get their
//     aletia_id from the sequence DEFAULT in device_master.
//   - Trial data lands in device_trials (not pre_approval_profile).
//   - Identifier resolution goes through device_external_ids rather than
//     pre_approval_profile.trial_identifier or intended_use matching.
//   - The hybrid "commercial + high confidence → auto-create" branch is
//     killed. Every path now goes through the 4d gate in lib/ingestion.
//   - Academic sponsors never auto-create — they hit the same gate but
//     with autoCreate=false, so a hospital running a trial on a commercial
//     device no longer quietly invents a new device row.
//
// What didn't change:
//   - Same entry point (runClinicalTrialsIngest) and same overall return shape.
//   - Same AI/ML filter (text keywords + manufacturer fast-path).
//   - Same academic sponsor detection.
//   - Queue dedup (first run of this month doesn't re-queue rows from last
//     month's run) is now handled inside processExternalIdentifier.
// =============================================================================

export type SponsorType = 'commercial' | 'academic'

export interface ClinicalTrialsIngestResult {
  total: number
  filteredAsAIML: number
  updatedExisting: number        // trial data enriched on an existing device
  createdNewDevice: number       // new commercial device created via 4d gate
  queuedCommercial: number       // commercial trial, merge candidates found → admin review
  queuedAcademic: number         // academic trial, no device match → admin review (never auto-create)
  alreadyQueued: number          // trial was already in the queue from a previous run
  errors: string[]
}

export async function runClinicalTrialsIngest(): Promise<ClinicalTrialsIngestResult> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const result: ClinicalTrialsIngestResult = {
    total: 0,
    filteredAsAIML: 0,
    updatedExisting: 0,
    createdNewDevice: 0,
    queuedCommercial: 0,
    queuedAcademic: 0,
    alreadyQueued: 0,
    errors: [],
  }

  // ── Fetch all trials ─────────────────────────────────────────────────────
  let trials: ClinicalTrial[]
  try {
    trials = await fetchAllAIDeviceTrials()
  } catch (err) {
    result.errors.push(`Failed to fetch trials: ${String(err)}`)
    return result
  }

  result.total = trials.length
  console.log(`[clinical-trials-ingest] Fetched ${trials.length} device trials`)

  // ── Filter for AI/ML trials ──────────────────────────────────────────────
  const aimlTrials: ClinicalTrial[] = []
  for (const trial of trials) {
    try {
      const knownAIML = await sponsorHasAIMLDevices(trial.sponsorName, supabase)
      if (knownAIML || isAIMLTrial(trial)) {
        aimlTrials.push(trial)
      }
    } catch (err) {
      console.warn(
        `[clinical-trials-ingest] Filter error for ${trial.nctId}: ${String(err)}`
      )
    }
  }

  result.filteredAsAIML = aimlTrials.length
  console.log(`[clinical-trials-ingest] ${aimlTrials.length} trials passed AI/ML filter`)

  // ── Process each trial ───────────────────────────────────────────────────
  for (const trial of aimlTrials) {
    try {
      await processTrial(trial, supabase, result)
    } catch (err) {
      result.errors.push(
        `Error processing ${trial.nctId} (${trial.sponsorName}): ${String(err)}`
      )
    }
  }

  console.log('[clinical-trials-ingest] Complete:', result)
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-trial processor — 4d gate dispatch + device_trials enrichment
// ─────────────────────────────────────────────────────────────────────────────

async function processTrial(
  trial: ClinicalTrial,
  supabase: SupabaseClient,
  result: ClinicalTrialsIngestResult,
): Promise<void> {
  // Shape sanity: an NCT from CT.gov should match NCT + 8 digits. If it
  // doesn't, log an anomaly and skip — we don't want malformed IDs leaking
  // into device_external_ids.
  if (!/^NCT\d{8}$/.test(trial.nctId)) {
    await logIngestionAnomaly(supabase, {
      source: 'ct_gov_ingest',
      anomaly_type: 'unknown_identifier_shape',
      identifier_value: trial.nctId,
      identifier_type_expected: 'nct',
      context: {
        trial_title: trial.title,
        sponsor: trial.sponsorName,
      },
    })
    result.errors.push(`malformed NCT: ${trial.nctId}`)
    return
  }

  const sponsorType: SponsorType = isAcademicSponsor(trial.sponsorName)
    ? 'academic'
    : 'commercial'

  // Look up manufacturer for the device seed; findMergeCandidates will also
  // use this via processExternalIdentifier, so no double work.
  const manufacturerMatch = sponsorType === 'commercial'
    ? await matchManufacturer(trial.sponsorName, supabase)
    : null

  // ── 4d gate ──────────────────────────────────────────────────────────────
  const decision: IngestDecision = await processExternalIdentifier({
    supabase,
    id_type:      'nct',
    id_value:     trial.nctId,
    jurisdiction: null,              // NCT is non-jurisdictional
    source:       'ct_gov_ingest',
    queueSource:  'clinical_trials',
    reviewReason: sponsorType === 'commercial'
                    ? 'possible_merge'
                    : 'academic_no_device_match',
    manufacturerName: trial.sponsorName,
    deviceName:       trial.deviceName ?? trial.title,
    payload:          { ...trial, sponsor_type: sponsorType },
    // Academic sponsors never auto-create — if no identifier hit, they queue.
    autoCreate: sponsorType === 'commercial',
    // deviceSeed only used when autoCreate=true + no candidates.
    deviceSeed: sponsorType === 'commercial'
      ? buildDeviceSeed(trial, manufacturerMatch?.id ?? null)
      : undefined,
  })

  // ── Act on the decision ──────────────────────────────────────────────────
  switch (decision.action) {
    case 'updated_existing':
      await upsertDeviceTrial(decision.aletia_id, trial, sponsorType, supabase)
      result.updatedExisting++
      return

    case 'created_new':
      await upsertDeviceTrial(decision.aletia_id, trial, sponsorType, supabase)
      result.createdNewDevice++
      return

    case 'queued_for_review':
      if (sponsorType === 'commercial') result.queuedCommercial++
      else result.queuedAcademic++
      return

    case 'already_queued':
      result.alreadyQueued++
      return

    case 'failed':
      result.errors.push(`NCT ${trial.nctId}: ${decision.error}`)
      return
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// device_master seed for commercial auto-create path
// ─────────────────────────────────────────────────────────────────────────────

function buildDeviceSeed(
  trial: ClinicalTrial,
  manufacturerId: string | null,
): Record<string, unknown> {
  return {
    // aletia_id omitted — sequence DEFAULT allocates.
    manufacturer_link: manufacturerId,
    manufacturer_name: trial.sponsorName,
    name:              trial.deviceName,
    intended_use:      trial.deviceName ?? trial.title,
    approval_status:   'pre_approval',
    data_source:       'aletia_research',
    pipeline_stage:    trial.status === 'completed' ? 'under_review' : 'pre_submission',
    excluded:          false,
    aletia_verified:   false,
    health_status:     'Amber',
    ai_ml_integral:    true,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// device_trials upsert — called for both updated_existing and created_new paths
// ─────────────────────────────────────────────────────────────────────────────

async function upsertDeviceTrial(
  aletiaId: string,
  trial: ClinicalTrial,
  sponsorType: SponsorType,
  supabase: SupabaseClient,
): Promise<void> {
  const { error } = await supabase
    .from('device_trials')
    .upsert({
      aletia_id:            aletiaId,
      nct_id:               trial.nctId,
      trial_registry:       'ct_gov',
      title:                trial.title,
      brief_summary:        trial.briefSummary,
      sponsor_name:         trial.sponsorName,
      sponsor_type:         sponsorType,
      status:               trial.status,
      phase:                trial.phase,
      enrollment:           trial.enrollment,
      start_date:           trial.startDate,
      completion_date:      trial.completionDate,
      jurisdictions:        trial.locations,
      conditions_raw:       trial.conditions,
      is_device_trial:      trial.isDeviceTrial,
      irb_approved:         trial.irbApproved,
      source_payload:       trial as unknown as Record<string, unknown>,
      last_seen_at:         new Date().toISOString(),
    }, {
      onConflict: 'aletia_id,nct_id',
    })

  if (error) {
    // Soft failure — the device row is fine, the trial enrichment failed.
    // Surface for triage but don't halt the run.
    console.error(
      `[clinical-trials-ingest] device_trials upsert failed for ${aletiaId}/${trial.nctId}: ${error.message}`
    )
    await logIngestionAnomaly(supabase, {
      source: 'ct_gov_ingest',
      anomaly_type: 'classification_failed',
      identifier_value: trial.nctId,
      identifier_type_expected: 'nct',
      aletia_id: aletiaId,
      context: { stage: 'device_trials_upsert', error: error.message },
    })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Academic sponsor detection — unchanged from pre-A2b
// ─────────────────────────────────────────────────────────────────────────────

const ACADEMIC_PATTERNS = [
  /university/i,
  /université/i,
  /universität/i,
  /universit[àáãâ]/i,
  /\bhospital\b/i,
  /\bhospitaal\b/i,
  /\bclinic\b/i,
  /\bclinique\b/i,
  /\bhealth\s+system\b/i,
  /\bhealth\s+care\s+system\b/i,
  /\bhealth\s+network\b/i,
  /\bnhs\b/i,
  /\bfoundation\s+trust\b/i,
  /\bmedical\s+center\b/i,
  /\bmedical\s+centre\b/i,
  /\bmedical\s+school\b/i,
  /\bcollege\b/i,
  /\binstitute\b/i,
  /\binstituto\b/i,
  /\bistituto\b/i,
  /\bcentre\s+hospitalier\b/i,
  /\bziekenhuis\b/i,
  /\bkrankenhaus\b/i,
  /\bklinikum\b/i,
  /\bklinik\b/i,
  /\bregion\b/i,
  /\bmunicip/i,
  /\bgovernment\b/i,
  /\bnational\s+cancer\b/i,
  /\bnational\s+heart\b/i,
  /\bnational\s+institute\b/i,
  /\bva\s+medical\b/i,
  /\bveterans\b/i,
  /\bchildren'?s\b/i,
  /\bpediatric\b/i,
  /\bpaediatric\b/i,
]

function isAcademicSponsor(sponsorName: string): boolean {
  return ACADEMIC_PATTERNS.some((p) => p.test(sponsorName))
}

// ─────────────────────────────────────────────────────────────────────────────
// AI/ML filter — unchanged text pass
// ─────────────────────────────────────────────────────────────────────────────

function isAIMLTrial(trial: ClinicalTrial): boolean {
  const text = [
    trial.title,
    trial.briefSummary,
    trial.deviceName ?? '',
    trial.conditions.join(' '),
  ]
    .join(' ')
    .toLowerCase()

  const hardExclusions = [
    'antimicrobial susceptibility', 'breakpoint', 'minimum inhibitory concentration',
    'microbiology panel', 'culture media', 'susceptibility testing',
    'spinal fixation', 'spinal fusion', 'bone screw', 'vascular graft',
    'surgical access', 'infusion catheter', 'suture', 'wound closure',
    'hip replacement', 'knee replacement', 'dental implant',
    'face mask', 'respirator', 'rt-pcr', 'pcr assay', 'lateral flow', 'rapid antigen',
  ]
  if (hardExclusions.some((term) => text.includes(term))) return false

  const positiveKeywords = [
    'artificial intelligence', 'machine learning', 'deep learning',
    'neural network', 'large language model', 'foundation model',
    'generative ai', 'computer-aided detection', 'computer-aided diagnosis',
    'computer aided detection', 'computer aided diagnosis', 'cad system',
    'convolutional', 'transformer model', 'image recognition',
    'image classification', 'automated segmentation', 'automated detection',
    'automated analysis', 'predictive algorithm', 'clinical decision support',
    'ai-powered', 'ai/ml', 'ml model', 'natural language processing',
    'computer vision',
  ]
  return positiveKeywords.some((kw) => text.includes(kw))
}

// ─────────────────────────────────────────────────────────────────────────────
// Manufacturer fast path — "do we already know this sponsor has AI/ML devices?"
// Updated: selects aletia_id instead of device_id (A2a rename).
// ─────────────────────────────────────────────────────────────────────────────

async function sponsorHasAIMLDevices(
  sponsorName: string,
  supabase: SupabaseClient
): Promise<boolean> {
  const manufacturerMatch = await matchManufacturer(sponsorName, supabase)
  if (!manufacturerMatch || manufacturerMatch.confidence === 'low') return false

  const { data } = await supabase
    .from('device_master')
    .select('aletia_id')
    .eq('manufacturer_link', manufacturerMatch.id)
    .eq('ai_ml_integral', true)
    .eq('excluded', false)
    .limit(1)
    .maybeSingle()

  return !!data
}
