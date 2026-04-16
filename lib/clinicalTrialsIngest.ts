import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { fetchAllAIDeviceTrials, ClinicalTrial } from './clinicalTrials'
import { matchManufacturer } from './matchManufacturer'
import { ulid } from 'ulid'

// ── Types ─────────────────────────────────────────────────────────────────────

export type SponsorType = 'commercial' | 'academic'

export interface ClinicalTrialsIngestResult {
  total: number
  filteredAsAIML: number
  updatedExisting: number        // trial data added to existing device_master record
  createdPreApproval: number     // new pre-approval listing created
  queuedCommercial: number       // commercial sponsor, no confident match
  queuedAcademic: number         // academic sponsor, no device match
  errors: string[]
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runClinicalTrialsIngest(): Promise<ClinicalTrialsIngestResult> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const result: ClinicalTrialsIngestResult = {
    total: 0,
    filteredAsAIML: 0,
    updatedExisting: 0,
    createdPreApproval: 0,
    queuedCommercial: 0,
    queuedAcademic: 0,
    errors: [],
  }

  // ── Step 1: Fetch all trials from ClinicalTrials.gov ─────────────────────
  let trials: ClinicalTrial[]
  try {
    trials = await fetchAllAIDeviceTrials()
  } catch (err) {
    result.errors.push(`Failed to fetch trials: ${String(err)}`)
    return result
  }

  result.total = trials.length
  console.log(`[clinical-trials-ingest] Fetched ${trials.length} device trials`)

  // ── Step 2: Filter for AI/ML trials ──────────────────────────────────────
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

  // ── Step 3: Process each trial ────────────────────────────────────────────
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

// ── Four-path trial processor ─────────────────────────────────────────────────
//
// Path 1: Device found in device_master (any sponsor type)
//         → enrich with trial data regardless of who's running the trial
//         → academic validation of a known device is valuable clinical signal
//
// Path 2: Commercial sponsor, high-confidence manufacturer, no existing device
//         → create new pre-approval listing
//
// Path 3: Commercial sponsor, no confident manufacturer match
//         → queue as potential pipeline candidate for manual review
//
// Path 4: Academic sponsor, no device match
//         → queue as academic validation signal, lower priority
//         → reviewer can manually link to a device or dismiss

async function processTrial(
  trial: ClinicalTrial,
  supabase: SupabaseClient,
  result: ClinicalTrialsIngestResult
): Promise<void> {
  const sponsorType = isAcademicSponsor(trial.sponsorName) ? 'academic' : 'commercial'

  // ── Attempt manufacturer match ────────────────────────────────────────────
  const manufacturerMatch = await matchManufacturer(trial.sponsorName, supabase)

  // ── Try to find an existing device regardless of sponsor type ────────────
  // A trial run by a hospital on a known commercial device (e.g. DERM at
  // Guy's Trust) should still enrich that device's record.
  const existingDevice = manufacturerMatch
    ? await findExistingDevice(trial, manufacturerMatch.id, supabase)
    : await findExistingDeviceByTrialId(trial.nctId, supabase)

  // ── Path 1: Known device — enrich it ─────────────────────────────────────
  if (existingDevice) {
    await updateExistingDevice(trial, existingDevice.device_id, supabase)
    result.updatedExisting++
    return
  }

  // ── Path 2: Commercial, high confidence, no existing device → create ──────
  if (
    sponsorType === 'commercial' &&
    manufacturerMatch &&
    manufacturerMatch.confidence === 'high'
  ) {
    await createPreApprovalListing(trial, manufacturerMatch.id, supabase)
    result.createdPreApproval++
    return
  }

  // ── Path 3: Commercial, no confident match → queue as pipeline candidate ──
  if (sponsorType === 'commercial') {
    await queueForReview(trial, supabase, 'no_confident_match', 'commercial')
    result.queuedCommercial++
    return
  }

  // ── Path 4: Academic, no device match → queue as validation signal ────────
  await queueForReview(trial, supabase, 'academic_no_device_match', 'academic')
  result.queuedAcademic++
}

// ── Find existing device by manufacturer + name ───────────────────────────────

async function findExistingDevice(
  trial: ClinicalTrial,
  manufacturerId: string,
  supabase: SupabaseClient
): Promise<{ device_id: string } | null> {
  // First: NCT number already linked in pre_approval_profile
  const byNct = await findExistingDeviceByTrialId(trial.nctId, supabase)
  if (byNct) return byNct

  // Second: manufacturer + device name
  if (trial.deviceName) {
    const { data: exact } = await supabase
      .from('device_master')
      .select('device_id')
      .eq('manufacturer_link', manufacturerId)
      .ilike('intended_use', trial.deviceName)
      .limit(1)
      .single()

    if (exact) return exact

    const firstWord = trial.deviceName.split(/\s+/)[0]
    if (firstWord.length >= 4) {
      const { data: contains } = await supabase
        .from('device_master')
        .select('device_id')
        .eq('manufacturer_link', manufacturerId)
        .ilike('intended_use', `%${firstWord}%`)
        .limit(2)

      if (contains && contains.length === 1) return contains[0]
    }
  }

  return null
}

// ── Find existing device by NCT number alone ──────────────────────────────────
// Used when sponsor is academic and we have no manufacturer match —
// the device may still be in the DB under its commercial manufacturer.

async function findExistingDeviceByTrialId(
  nctId: string,
  supabase: SupabaseClient
): Promise<{ device_id: string } | null> {
  if (!nctId) return null

  const { data } = await supabase
    .from('pre_approval_profile')
    .select('device_id')
    .eq('trial_identifier', nctId)
    .limit(1)
    .single()

  return data ?? null
}

// ── Update existing device ────────────────────────────────────────────────────

async function updateExistingDevice(
  trial: ClinicalTrial,
  deviceId: string,
  supabase: SupabaseClient
): Promise<void> {
  // Advance pipeline_stage if trial is completed
  if (trial.status === 'completed') {
    const { error: deviceError } = await supabase
      .from('device_master')
      .update({ pipeline_stage: 'under_review' })
      .eq('device_id', deviceId)

    if (deviceError) throw deviceError
  }

  const { error: profileError } = await supabase
    .from('pre_approval_profile')
    .upsert(
      {
        device_id: deviceId,
        dev_stage: 'clinical_trial',
        irb_approved: trial.irbApproved,
        trial_identifier: trial.nctId,
        trial_status: trial.status,
        trial_phase: trial.phase,
        trial_start_date: trial.startDate,
        trial_completion_date: trial.completionDate,
        trial_enrollment: trial.enrollment,
        trial_locations: trial.locations,
      },
      { onConflict: 'device_id' }
    )

  if (profileError) throw profileError
}

// ── Create pre-approval listing ───────────────────────────────────────────────

async function createPreApprovalListing(
  trial: ClinicalTrial,
  manufacturerId: string,
  supabase: SupabaseClient
): Promise<void> {
  const deviceId = ulid()

  const { error: deviceError } = await supabase
    .from('device_master')
    .insert({
      device_id: deviceId,
      manufacturer_link: manufacturerId,
      manufacturer_name: trial.sponsorName,
      intended_use: trial.deviceName ?? trial.title,
      approval_status: 'pre_approval',
      data_source: 'aletia_research',
      pipeline_stage: trial.status === 'completed' ? 'under_review' : 'pre_submission',
      excluded: false,
      aletia_verified: false,
      health_status: 'unreviewed',
      ai_ml_integral: true,
    })

  if (deviceError) throw deviceError

  const { error: profileError } = await supabase
    .from('pre_approval_profile')
    .insert({
      device_id: deviceId,
      dev_stage: 'clinical_trial',
      irb_approved: trial.irbApproved,
      trial_identifier: trial.nctId,
      trial_status: trial.status,
      trial_phase: trial.phase,
      trial_start_date: trial.startDate,
      trial_completion_date: trial.completionDate,
      trial_enrollment: trial.enrollment,
      trial_locations: trial.locations,
    })

  if (profileError) throw profileError
}

// ── Review queue — with dedup and sponsor type ────────────────────────────────

async function queueForReview(
  trial: ClinicalTrial,
  supabase: SupabaseClient,
  reason: string,
  sponsorType: SponsorType
): Promise<void> {
  // Don't insert duplicates — check by NCT number
  const { data: existing } = await supabase
    .from('ingestion_review_queue')
    .select('queue_id')
    .eq('source', 'clinical_trials')
    .eq('source_id', trial.nctId)
    .limit(1)
    .single()

  if (existing) return

  const { error } = await supabase
    .from('ingestion_review_queue')
    .insert({
      source: 'clinical_trials',
      source_id: trial.nctId,
      device_name: trial.deviceName ?? trial.title,
      manufacturer: trial.sponsorName,
      raw_data: {
        ...trial,
        review_reason: reason,
        sponsor_type: sponsorType,
      },
      status: 'pending',
    })

  if (error) throw error
}

// ── Academic sponsor detection ────────────────────────────────────────────────
// Identifies hospitals, universities, and other non-commercial sponsors.
// These are tagged rather than excluded — academic validation of a known
// device is valuable clinical signal and surfaced on the device listing.

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

// ── AI/ML filter — text pass ──────────────────────────────────────────────────

function isAIMLTrial(trial: ClinicalTrial): boolean {
  const text = [
    trial.title,
    trial.briefSummary,
    trial.deviceName ?? '',
    trial.conditions.join(' '),
  ]
    .join(' ')
    .toLowerCase()

  // Pass 1: negative filter — known non-AI/ML device categories
  const hardExclusions = [
    'antimicrobial susceptibility', 'breakpoint', 'minimum inhibitory concentration',
    'microbiology panel', 'culture media', 'susceptibility testing',
    'spinal fixation', 'spinal fusion', 'bone screw', 'vascular graft',
    'surgical access', 'infusion catheter', 'suture', 'wound closure',
    'hip replacement', 'knee replacement', 'dental implant',
    'face mask', 'respirator', 'rt-pcr', 'pcr assay', 'lateral flow', 'rapid antigen',
  ]

  if (hardExclusions.some((term) => text.includes(term))) return false

  // Pass 2: positive keyword filter
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

// ── AI/ML filter — manufacturer fast path ────────────────────────────────────

async function sponsorHasAIMLDevices(
  sponsorName: string,
  supabase: SupabaseClient
): Promise<boolean> {
  const manufacturerMatch = await matchManufacturer(sponsorName, supabase)
  if (!manufacturerMatch || manufacturerMatch.confidence === 'low') return false

  const { data } = await supabase
    .from('device_master')
    .select('device_id')
    .eq('manufacturer_link', manufacturerMatch.id)
    .eq('ai_ml_integral', true)
    .eq('excluded', false)
    .limit(1)
    .single()

  return !!data
}