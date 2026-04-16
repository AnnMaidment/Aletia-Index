import * as XLSX from 'xlsx'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { matchManufacturer } from './matchManufacturer'
import { ulid } from 'ulid'

// ── Constants ────────────────────────────────────────────────────────────────

const FDA_EXCEL_URL =
  'https://www.fda.gov/media/108305/download'

// ── Types ────────────────────────────────────────────────────────────────────

interface FDABreakthroughRow {
  applicantName: string
  deviceTradeName: string
  deviceDescription: string
  indication: string
  dateGranted: string | null
  submissionType: string
}

export interface BreakthroughIngestResult {
  total: number
  updatedExisting: number
  createdPreApproval: number
  queuedForReview: number
  errors: string[]
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runBreakthroughIngest(): Promise<BreakthroughIngestResult> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const result: BreakthroughIngestResult = {
    total: 0,
    updatedExisting: 0,
    createdPreApproval: 0,
    queuedForReview: 0,
    errors: [],
  }

  // ── Step 1: Download and parse the FDA Excel file ─────────────────────────
  let rows: FDABreakthroughRow[]
  try {
    rows = await fetchFDAExcel()
  } catch (err) {
    result.errors.push(`Failed to fetch FDA Excel: ${String(err)}`)
    return result
  }

  result.total = rows.length
  console.log(`[breakthrough-ingest] Fetched ${rows.length} rows from FDA`)

  // ── Step 2: Process each row ──────────────────────────────────────────────
  for (const row of rows) {
    try {
      await processRow(row, supabase, result)
    } catch (err) {
      result.errors.push(
        `Error processing "${row.deviceTradeName}" (${row.applicantName}): ${String(err)}`
      )
    }
  }

  console.log('[breakthrough-ingest] Complete:', result)
  return result
}

// ── Row processor ─────────────────────────────────────────────────────────────

async function processRow(
  row: FDABreakthroughRow,
  supabase: SupabaseClient,
  result: BreakthroughIngestResult
): Promise<void> {
  const designationDate = parseDate(row.dateGranted)

  // ── Attempt manufacturer match ────────────────────────────────────────────
  const manufacturerMatch = await matchManufacturer(row.applicantName, supabase)

  if (!manufacturerMatch) {
    // No manufacturer match at all → queue for manual review
    await queueForReview(row, supabase, 'no_manufacturer_match')
    result.queuedForReview++
    return
  }

  if (manufacturerMatch.confidence === 'low') {
    await queueForReview(row, supabase, 'low_confidence_manufacturer')
    result.queuedForReview++
    return
  }

  // ── Try to find an existing device_master row ─────────────────────────────
  const existingDevice = await findExistingDevice(
    row.deviceTradeName,
    manufacturerMatch.id,
    supabase
  )

  if (existingDevice) {
    // ── Path A: Enrich existing device ────────────────────────────────────
    const { error } = await supabase
      .from('device_master')
      .update({
        breakthrough_designation: true,
        breakthrough_designation_date: designationDate,
      })
      .eq('device_id', existingDevice.device_id)

    if (error) throw error

    result.updatedExisting++
    return
  }

  // ── Path B: No matching device — create pre-approval listing ─────────────
  if (manufacturerMatch.confidence === 'medium') {
    // Medium confidence + no device match → review queue to be safe
    await queueForReview(row, supabase, 'medium_confidence_no_device_match')
    result.queuedForReview++
    return
  }

  // High confidence manufacturer match, no existing device → create new listing
  await createPreApprovalListing(row, manufacturerMatch.id, designationDate, supabase)
  result.createdPreApproval++
}

// ── Find existing device ──────────────────────────────────────────────────────

async function findExistingDevice(
  deviceTradeName: string,
  manufacturerId: string,
  supabase: SupabaseClient
): Promise<{ device_id: string } | null> {
  // Try exact match on intended_use (trade name is stored there for pre-approval)
  const { data: exact } = await supabase
    .from('device_master')
    .select('device_id')
    .eq('manufacturer_link', manufacturerId)
    .ilike('intended_use', deviceTradeName)
    .limit(1)
    .single()

  if (exact) return exact

  // Try contains match — trade names can have version suffixes etc.
  const firstWord = deviceTradeName.split(/\s+/)[0]
  if (firstWord.length >= 4) {
    const { data: contains } = await supabase
      .from('device_master')
      .select('device_id')
      .eq('manufacturer_link', manufacturerId)
      .ilike('intended_use', `%${firstWord}%`)
      .limit(2)

    // Only take if unambiguous
    if (contains && contains.length === 1) return contains[0]
  }

  return null
}

// ── Create pre-approval listing ───────────────────────────────────────────────

async function createPreApprovalListing(
  row: FDABreakthroughRow,
  manufacturerId: string,
  designationDate: string | null,
  supabase: SupabaseClient
): Promise<void> {
  const deviceId = ulid()

  // Insert device_master row
  const { error: deviceError } = await supabase
    .from('device_master')
    .insert({
      device_id: deviceId,
      manufacturer_link: manufacturerId,
      manufacturer_name: row.applicantName,
      intended_use: row.deviceTradeName,
      approval_status: 'pre_approval',
      data_source: 'aletia_research',
      pipeline_stage: 'pre_submission',
      breakthrough_designation: true,
      breakthrough_designation_date: designationDate,
      excluded: false,
      aletia_verified: false,
      health_status: 'unreviewed',
    })

  if (deviceError) throw deviceError

  // Insert pre_approval_profile row
  const { error: profileError } = await supabase
    .from('pre_approval_profile')
    .insert({
      device_id: deviceId,
      dev_stage: 'pre_submission',
      irb_approved: false,
      breakthrough_source: 'fda_excel',
    })

  if (profileError) throw profileError
}

// ── Review queue ──────────────────────────────────────────────────────────────

async function queueForReview(
  row: FDABreakthroughRow,
  supabase: SupabaseClient,
  reason: string
): Promise<void> {
  const { error } = await supabase
    .from('ingestion_review_queue')
    .insert({
      source: 'fda_breakthrough',
      source_id: `${row.applicantName}__${row.deviceTradeName}`,
      device_name: row.deviceTradeName,
      manufacturer: row.applicantName,
      raw_data: { ...row, review_reason: reason },
      status: 'pending',
    })

  if (error) throw error
}

// ── FDA Excel fetch & parse ────────────────────────────────────────────────────

async function fetchFDAExcel(): Promise<FDABreakthroughRow[]> {
  const response = await fetch(FDA_EXCEL_URL, {
    headers: { 'User-Agent': 'Aletia-Ingest/1.0' },
  })

  if (!response.ok) {
    throw new Error(`FDA fetch failed: ${response.status} ${response.statusText}`)
  }

  const buffer = await response.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })

  // FDA spreadsheet has one sheet — take the first one
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

  return raw.map((r) => normalizeRow(r))
}

// ── Row normaliser ────────────────────────────────────────────────────────────
// The FDA column headers change occasionally — map by likely names.

function normalizeRow(r: Record<string, unknown>): FDABreakthroughRow {
  const get = (...keys: string[]): string => {
    for (const k of keys) {
      const val = r[k] ?? r[k.toLowerCase()] ?? r[k.toUpperCase()]
      if (val && typeof val === 'string' && val.trim()) return val.trim()
    }
    return ''
  }

  return {
    applicantName: get('Applicant Name', 'Applicant', 'Company Name', 'Company'),
    deviceTradeName: get('Device Trade Name', 'Trade Name', 'Device Name', 'Product Name'),
    deviceDescription: get('Device Description', 'Description'),
    indication: get('Indication', 'Indication for Use', 'Intended Use'),
    dateGranted: get('Date Granted', 'Date', 'Granted Date') || null,
    submissionType: get('Submission Type', 'Type'),
  }
}

// ── Date parser ───────────────────────────────────────────────────────────────

function parseDate(raw: string | null): string | null {
  if (!raw) return null
  const d = new Date(raw)
  if (isNaN(d.getTime())) return null
  return d.toISOString().split('T')[0] // YYYY-MM-DD
}