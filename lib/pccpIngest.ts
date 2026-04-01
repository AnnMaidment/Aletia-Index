// ============================================================
// lib/pccpIngest.ts
// Ingestion pipeline: O'Leary PCCP CSV → Supabase
//
// Sources (both hosted on boleary.com — verify URLs are still live
// before each deployment by visiting boleary.com/blog/posts/202408-pccp/latest/
// and confirming the "Raw data (CSV)" download links):
//
//   MAIN_CSV_URL       — all devices O'Leary's search identified as having PCCPs
//   CORRECTIONS_CSV_URL — false positives O'Leary has confirmed do NOT have PCCPs
//
// Logic:
//   1. Fetch both CSVs
//   2. Build exclusion Set from corrections file
//   3. Filter main list — any submission_number in corrections is skipped
//   4. For devices in device_master → update pccp_status = 'approved'
//   5. For devices NOT in device_master → insert into ingestion_review_queue
//
// Column names verified against O'Leary's actual CSV files (March 2026):
//   submission_number, sponsor, device, date_decision, product_code, panel, type
//
// Called by: app/api/pccp-ingest/route.ts
// Vercel Cron: every 14 days
// Manual trigger: POST /api/pccp-ingest with x-sync-token header
// ============================================================

import { createClient } from '@supabase/supabase-js'


// ============================================================
// ⚠️  URL VERIFICATION REQUIRED
// Visit boleary.com/blog/posts/202408-pccp/latest/ and confirm
// these are the correct direct download links before deploying.
// Update if O'Leary reorganises his site.
// Last verified: March 2026 — URLs confirmed from browser address bar
// ============================================================
const MAIN_CSV_URL        = 'https://boleary.com/blog/posts/202408-pccp/latest/data/latest_pccp_search_results.csv'
const CORRECTIONS_CSV_URL = 'https://boleary.com/blog/posts/202408-pccp/latest/data/pccp_false_positive_corrections.csv'

const SOURCE_ID = 'oleary_csv'

// ============================================================
// Types — column names match O'Leary's actual CSV headers
// ============================================================

interface OLearyMainRow {
  submission_number: string  // K number / De Novo / PMA number
  sponsor: string            // manufacturer name
  device: string             // device name
  date_decision: string      // ISO date — use as pccp_authorized_date
  product_code: string
  panel: string              // FDA review panel e.g. 'Cardiovascular'
  type: string               // '510(k)' / 'De Novo' / 'PMA'
  [key: string]: string
}

interface OLearyCorrectionsRow {
  submission_number: string  // these are false positives — exclude from PCCP list
  [key: string]: string
}

export interface PCCPIngestResult {
  total_rows_main: number
  total_rows_corrections: number
  excluded_false_positives: number
  confirmed_pccp_devices: number
  updated: number            // device_master rows updated
  queued: number             // new devices sent to review queue
  skipped: number            // already up to date
  errors: string[]
}

// ============================================================
// CSV parser — no external dependencies
// Handles quoted fields containing commas and escaped quotes
// ============================================================

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []

  const headers = splitCSVLine(lines[0]).map(h => h.toLowerCase().trim())

  return lines.slice(1)
    .map(line => {
      const values = splitCSVLine(line)
      return headers.reduce((obj, header, i) => {
        obj[header] = (values[i] ?? '').trim()
        return obj
      }, {} as Record<string, string>)
    })
    .filter(row => row[headers[0]] !== '')
}

function splitCSVLine(line: string): string[] {
  const values: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (line[i] === ',' && !inQuotes) {
      values.push(current)
      current = ''
    } else {
      current += line[i]
    }
  }
  values.push(current)
  return values
}

// ============================================================
// Normalise submission number to uppercase, no spaces
// e.g. "k251293" → "K251293", "den190040" → "DEN190040"
// ============================================================

function normaliseId(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, '').trim()
}

// ============================================================
// Parse date string → ISO date (YYYY-MM-DD)
// O'Leary's date_decision field is already ISO format
// ============================================================

function parseDate(raw: string): string | null {
  if (!raw || raw === 'NA') return null
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0]
}

// ============================================================
// Fetch a CSV from URL → parsed rows
// ============================================================

async function fetchCSV(url: string): Promise<Record<string, string>[]> {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`)
  }
  const text = await response.text()
  return parseCSV(text)
}

// ============================================================
// Main ingestion function
// ============================================================

export async function runPCCPIngest(): Promise<PCCPIngestResult> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const result: PCCPIngestResult = {
    total_rows_main: 0,
    total_rows_corrections: 0,
    excluded_false_positives: 0,
    confirmed_pccp_devices: 0,
    updated: 0,
    queued: 0,
    skipped: 0,
    errors: [],
  }

  // ----------------------------------------------------------
  // 1. Fetch both CSVs in parallel
  // ----------------------------------------------------------
  let mainRows: OLearyMainRow[]
  let correctionsRows: OLearyCorrectionsRow[]

  try {
    const [main, corrections] = await Promise.all([
      fetchCSV(MAIN_CSV_URL),
      fetchCSV(CORRECTIONS_CSV_URL),
    ])
    mainRows = main as OLearyMainRow[]
    correctionsRows = corrections as OLearyCorrectionsRow[]
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    result.errors.push(`CSV fetch failed: ${msg}`)
    return result
  }

  result.total_rows_main = mainRows.length
  result.total_rows_corrections = correctionsRows.length

  if (mainRows.length === 0) {
    result.errors.push('Main CSV parsed to 0 rows — check URL or column headers')
    return result
  }

  // ----------------------------------------------------------
  // 2. Build exclusion Set from corrections file
  //    These are O'Leary's confirmed false positives
  // ----------------------------------------------------------
  const falsePositives = new Set(
    correctionsRows.map(r => normaliseId(r.submission_number)).filter(Boolean)
  )

  // ----------------------------------------------------------
  // 3. Filter main list — remove false positives
  // ----------------------------------------------------------
  const confirmedRows = mainRows.filter(row => {
    const id = normaliseId(row.submission_number)
    if (falsePositives.has(id)) {
      result.excluded_false_positives++
      return false
    }
    return !!id
  })

  result.confirmed_pccp_devices = confirmedRows.length

  // ----------------------------------------------------------
  // 4. Load matching device_master rows in one query
  // ----------------------------------------------------------
  const confirmedIds = confirmedRows.map(r => normaliseId(r.submission_number))

  const { data: existingDevices, error: fetchError } = await supabase
    .from('device_master')
    .select('device_id, pccp_status, pccp_authorized_date')
    .in('device_id', confirmedIds)

  if (fetchError) {
    result.errors.push(`device_master fetch failed: ${fetchError.message}`)
    return result
  }

  const existingMap = new Map(
    (existingDevices ?? []).map(d => [d.device_id, d])
  )

  // ----------------------------------------------------------
  // 5. Process each confirmed PCCP device
  // ----------------------------------------------------------
  for (const row of confirmedRows) {
    const deviceId = normaliseId(row.submission_number)
    const authorizedDate = parseDate(row.date_decision)
    const existing = existingMap.get(deviceId)

    if (existing) {
      // Already in device_master — skip if nothing has changed
      if (
        existing.pccp_status === 'approved' &&
        existing.pccp_authorized_date === authorizedDate
      ) {
        result.skipped++
        continue
      }

      const { error } = await supabase
        .from('device_master')
        .update({
          pccp_status: 'approved',
          pccp_authorized_date: authorizedDate,
          pccp_source: SOURCE_ID,
        })
        .eq('device_id', deviceId)

      if (error) {
        result.errors.push(`Update failed for ${deviceId}: ${error.message}`)
      } else {
        result.updated++
      }

    } else {
     // Not in device_master — send to review queue
const { error } = await supabase
  .from('ingestion_review_queue')
  .insert({
    source: SOURCE_ID,
    source_id: deviceId,
    device_name: row.device || null,
    manufacturer: row.sponsor || null,
    pccp_authorized_date: authorizedDate,
    raw_data: row as unknown as Record<string, unknown>,
    status: 'pending',
  })

if (error) {
  // 23505 = unique constraint violation = already queued, skip silently
  if (error.code !== '23505') {
    result.errors.push(`Queue insert failed for ${deviceId}: ${error.message}`)
  } else {
    result.skipped++
  }
} else {
  result.queued++
}
}
  }

  return result
}