// ── ClinicalTrials.gov v2 API service layer ───────────────────────────────────
// Docs: https://clinicaltrials.gov/data-api/api

const CT_BASE_URL = 'https://clinicaltrials.gov/api/v2/studies'
const PAGE_SIZE = 1000

// ── Keyword queries ───────────────────────────────────────────────────────────
// Run as separate queries, deduplicated by NCT number.
// Note: CT.gov v2 uses Essie expression syntax — quotes work for phrases
// but must be passed as plain strings (URLSearchParams handles encoding).

export const AI_DEVICE_QUERIES = [
  'artificial intelligence medical device',
  'machine learning diagnostic',
  'deep learning imaging',
  'computer-aided detection',
  'computer-aided diagnosis',
  'automated detection algorithm',
  'neural network clinical',
  'AI diagnostic algorithm',
] as const

// ── Types ─────────────────────────────────────────────────────────────────────

export type TrialStatus =
  | 'recruiting'
  | 'active'
  | 'completed'
  | 'terminated'
  | 'unknown'

export type TrialPhase =
  | 'phase_1'
  | 'phase_2'
  | 'phase_3'
  | 'na'
  | 'unknown'

export interface ClinicalTrial {
  nctId: string
  title: string
  briefSummary: string
  sponsorName: string
  deviceName: string | null
  status: TrialStatus
  phase: TrialPhase
  startDate: string | null
  completionDate: string | null
  enrollment: number | null
  conditions: string[]
  locations: string[]
  irbApproved: boolean
  isDeviceTrial: boolean
}

// ── Raw API shape (partial) ───────────────────────────────────────────────────

interface CTStudy {
  protocolSection: {
    identificationModule?: {
      nctId?: string
      officialTitle?: string
      briefTitle?: string
    }
    statusModule?: {
      overallStatus?: string
      startDateStruct?: { date?: string }
      primaryCompletionDateStruct?: { date?: string }
    }
    descriptionModule?: {
      briefSummary?: string
    }
    sponsorCollaboratorsModule?: {
      leadSponsor?: { name?: string }
    }
    conditionsModule?: {
      conditions?: string[]
    }
    designModule?: {
      phases?: string[]
      enrollmentInfo?: { count?: number }
      studyType?: string
    }
    armsInterventionsModule?: {
      interventions?: Array<{
        type?: string
        name?: string
      }>
    }
    contactsLocationsModule?: {
      locations?: Array<{
        country?: string
      }>
    }
  }
}

interface CTResponse {
  studies?: CTStudy[]
  nextPageToken?: string
  totalCount?: number
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function fetchAllAIDeviceTrials(): Promise<ClinicalTrial[]> {
  const seen = new Set<string>()
  const results: ClinicalTrial[] = []

  for (const query of AI_DEVICE_QUERIES) {
    console.log(`[clinical-trials] Querying: ${query}`)
    try {
      const trials = await fetchTrialsForQuery(query)
      let newCount = 0
      for (const trial of trials) {
        if (!seen.has(trial.nctId)) {
          seen.add(trial.nctId)
          results.push(trial)
          newCount++
        }
      }
      console.log(`[clinical-trials] "${query}" → ${trials.length} results (${newCount} new, ${results.length} total unique)`)
    } catch (err) {
      console.error(`[clinical-trials] Query failed: "${query}"`, err)
    }
  }

  // Filter to device interventions only
  const deviceTrials = results.filter((t) => t.isDeviceTrial)
  console.log(`[clinical-trials] ${deviceTrials.length} device trials after intervention filter`)
  return deviceTrials
}

// ── Single query fetch with pagination ───────────────────────────────────────

async function fetchTrialsForQuery(query: string): Promise<ClinicalTrial[]> {
  const results: ClinicalTrial[] = []
  let pageToken: string | undefined = undefined

  do {
    // Build params manually to avoid any encoding issues
    const params: Record<string, string> = {
      'query.term': query,
      pageSize: String(PAGE_SIZE),
      format: 'json',
    }
    if (pageToken) params['pageToken'] = pageToken

    const queryString = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&')

    const url = `${CT_BASE_URL}?${queryString}`
    console.log(`[clinical-trials] Fetching: ${url.slice(0, 120)}...`)

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Aletia-Ingest/1.0',
        'Accept': 'application/json',
      },
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`ClinicalTrials API error: ${response.status} ${response.statusText} — ${body.slice(0, 200)}`)
    }

    const data: CTResponse = await response.json()

    for (const study of data.studies ?? []) {
      const trial = normalizeStudy(study)
      if (trial) results.push(trial)
    }

    pageToken = data.nextPageToken

    if (pageToken) await sleep(300)

  } while (pageToken)

  return results
}

// ── Normaliser ────────────────────────────────────────────────────────────────

function normalizeStudy(s: CTStudy): ClinicalTrial | null {
  const id          = s.protocolSection?.identificationModule
  const statusMod   = s.protocolSection?.statusModule
  const design      = s.protocolSection?.designModule
  const sponsor     = s.protocolSection?.sponsorCollaboratorsModule
  const interventions = s.protocolSection?.armsInterventionsModule?.interventions ?? []
  const locations   = s.protocolSection?.contactsLocationsModule?.locations ?? []
  const conditions  = s.protocolSection?.conditionsModule?.conditions ?? []

  const nctId = id?.nctId
  if (!nctId) return null

  const deviceInterventions = interventions.filter((i) =>
    ['DEVICE', 'COMBINATION_PRODUCT'].includes((i.type ?? '').toUpperCase())
  )
  const isDeviceTrial = deviceInterventions.length > 0
  const deviceName = deviceInterventions[0]?.name ?? null

  const countrySet = new Set<string>()
  for (const loc of locations) {
    if (loc.country) countrySet.add(isoCountry(loc.country))
  }

  return {
    nctId,
    title: id?.officialTitle ?? id?.briefTitle ?? '',
    briefSummary: s.protocolSection?.descriptionModule?.briefSummary ?? '',
    sponsorName: sponsor?.leadSponsor?.name ?? '',
    deviceName,
    status: normalizeStatus(statusMod?.overallStatus ?? ''),
    phase: normalizePhase(design?.phases ?? []),
    startDate: normalizeDate(statusMod?.startDateStruct?.date),
    completionDate: normalizeDate(statusMod?.primaryCompletionDateStruct?.date),
    enrollment: design?.enrollmentInfo?.count ?? null,
    conditions,
    locations: Array.from(countrySet),
    irbApproved: true,
    isDeviceTrial,
  }
}

// ── Normalisation helpers ─────────────────────────────────────────────────────

function normalizeStatus(raw: string): TrialStatus {
  const s = raw.toUpperCase()
  if (s === 'RECRUITING') return 'recruiting'
  if (s === 'ACTIVE_NOT_RECRUITING') return 'active'
  if (s === 'COMPLETED') return 'completed'
  if (['TERMINATED', 'WITHDRAWN', 'SUSPENDED'].includes(s)) return 'terminated'
  return 'unknown'
}

function normalizePhase(phases: string[]): TrialPhase {
  if (!phases.length) return 'na'
  const p = (phases[0] ?? '').toUpperCase()
  if (p.includes('1')) return 'phase_1'
  if (p.includes('2')) return 'phase_2'
  if (p.includes('3')) return 'phase_3'
  if (['NA', 'N/A', 'NOT_APPLICABLE'].includes(p)) return 'na'
  return 'unknown'
}

function normalizeDate(raw: string | undefined): string | null {
  if (!raw) return null
  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const d = new Date(raw)
  if (isNaN(d.getTime())) return null
  return d.toISOString().split('T')[0]
}

function isoCountry(name: string): string {
  const map: Record<string, string> = {
    'United States': 'US', 'United Kingdom': 'GB', 'South Africa': 'ZA',
    Germany: 'DE', France: 'FR', Canada: 'CA', Australia: 'AU',
    Israel: 'IL', Netherlands: 'NL', China: 'CN', Japan: 'JP',
    India: 'IN', Spain: 'ES', Italy: 'IT', Belgium: 'BE',
    Switzerland: 'CH', Sweden: 'SE', Denmark: 'DK',
    'South Korea': 'KR', Singapore: 'SG', 'New Zealand': 'NZ',
  }
  return map[name] ?? name
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}