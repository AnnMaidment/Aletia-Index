// ============================================================
// lib/pccpIngest.ts — A2b rewrite
//
// Ingestion pipeline: O'Leary PCCP CSV → Supabase (enrichment-only).
//
// Sources (both hosted on boleary.com — verify URLs are still live before
// each deployment by visiting boleary.com/blog/posts/202408-pccp/latest/
// and confirming the "Raw data (CSV)" download links):
//
//   MAIN_CSV_URL       — all FDA submission numbers O'Leary flags as having a PCCP
//   CORRECTIONS_CSV_URL — false positives O'Leary has confirmed do NOT have PCCPs
//
// A2b behaviour (enrichment-only):
//   1. Fetch both CSVs.
//   2. Build exclusion Set from corrections file.
//   3. Filter the main list against it.
//   4. For each confirmed row, look up the device via device_external_ids
//      (id_type IN ('fda_k_number','fda_de_novo','fda_pma'), id_value = that
//      submission number).
//   5. Match found → UPDATE device_master.pccp_status / pccp_authorized_date /
//      pccp_source on the corresponding aletia_id.
//   6. No match → log an ingestion_anomalies row of type missing_required_field.
//      Do NOT queue. A K-number that appears in O'Leary's list but not in our
//      device_external_ids catalogue means we missed it during FDA seed/sync,
//      and the right response is to run FDA sync — not to create a PCCP-only
//      placeholder queue row.
//
// Why not queue?
//   Under A2b, ingestion_review_queue is for identity/merge decisions. PCCP
//   is pure enrichment of an already-identified FDA device. If we don't know
//   about the device, a queue entry with only a submission number and a
//   sponsor guess doesn't give admin enough to decide — FDA sync discovery
//   would have to run anyway to pull the actual clearance data.
//
// Column names (verified against O'Leary's CSVs, March 2026):
//   submission_number, sponsor, device, date_decision, product_code, panel, type
//
// Called by: app/api/pccp-ingest/route.ts
// Vercel Cron: every 14 days.
// ============================================================

import { createAdminClient } from './supabase-admin'
import { logIngestionAnomaly } from './ingestion'

// ============================================================
// ⚠️  URL VERIFICATION REQUIRED
// Visit boleary.com/blog/posts/202408-pccp/latest/ and confirm these
// are the correct direct download links before deploying. Update if
// O'Leary reorganises his site.
// Last verified: March 2026 — URLs confirmed from browser address bar.
// ============================================================
const MAIN_CSV_URL        = 'https://boleary.com/blog/posts/202408-pccp/latest/data/latest_pccp_search_results.csv'
const CORRECTIONS_CSV_URL = 'https://boleary.com/blog/posts/202408-pccp/latest/data/pccp_false_positive_corrections.csv'

const SOURCE_ID = 'oleary_csv'

// ============================================================
// Types — column names match O'Leary's actual CSV headers
// ============================================================

interface OLearyMainRow {
  submission_number: string  // K-number / De Novo / PMA number
  sponsor:           string  // manufacturer name
  device:            string  // device name
  date_decision:     string  // ISO date — used as pccp_authorized_date
  product_code:      string
  panel:             string  // FDA review panel e.g. 'Cardiovascular'
  type:              string  // '510(k)' / 'De Novo' / 'PMA'
  [key: string]:     string
}

interface OLearyCorrectionsRow {
  submission_number: string  // false positives — exclude from PCCP list
  [key: string]:     string
}

export interface PCCPIngestResult {
  total_rows_main:           number
  total_rows_corrections:    number
  excluded_false_positives:  number
  confirmed_pccp_devices:    number

  // A2b counters (replace old updated / queued / skipped):
  enriched_existing:         number   // device_external_ids hit → device_master updated
  already_up_to_date:        number   // device found but pccp fields already match
  unmatched_logged:          number   // no hit in device_external_ids → anomaly logged

  errors:                    string[]
}

// ============================================================
// CSV parser — no external dependencies.
// Handles quoted fields containing commas and escaped quotes.
// ============================================================

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []

  const headers = splitCSVLine(lines[0]).map((h) => h.toLowerCase().trim())

  return lines
    .slice(1)
    .map((line) => {
      const values = splitCSVLine(line)
      return headers.reduce(
        (obj, header, i) => {
          obj[header] = (values[i] ?? '').trim()
          return obj
        },
        {} as Record<string, string>,
      )
    })
    .filter((row) => row[headers[0]] !== '')
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
// Normalise submission number to uppercase, no spaces.
// e.g. "k251293" → "K251293", "den190040" → "DEN190040"
// ============================================================

function normaliseId(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, '').trim()
}

// ============================================================
// Classify submission-number shape → id_type.
// Mirrors the classification in app/api/admin/queue/accept/route.ts.
// ============================================================

function classifySubmissionNumber(id: string): 'fda_k_number' | 'fda_de_novo' | 'fda_pma' | null {
  if (/^K[0-9]+$/.test(id))   return 'fda_k_number'
  if (/^DEN[0-9]+$/.test(id)) return 'fda_de_novo'
  if (/^P[0-9]+$/.test(id))   return 'fda_pma'
  return null
}

// ============================================================
// Parse date string → ISO date (YYYY-MM-DD).
// O'Leary's date_decision field is already ISO format.
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
// Main ingestion function (A2b)
// ============================================================

export async function runPCCPIngest(): Promise<PCCPIngestResult> {
  const supabase = createAdminClient()

  const result: PCCPIngestResult = {
    total_rows_main:          0,
    total_rows_corrections:   0,
    excluded_false_positives: 0,
    confirmed_pccp_devices:   0,
    enriched_existing:        0,
    already_up_to_date:       0,
    unmatched_logged:         0,
    errors:                   [],
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
    mainRows        = main        as OLearyMainRow[]
    correctionsRows = corrections as OLearyCorrectionsRow[]
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    result.errors.push(`CSV fetch failed: ${msg}`)
    return result
  }

  result.total_rows_main        = mainRows.length
  result.total_rows_corrections = correctionsRows.length

  if (mainRows.length === 0) {
    result.errors.push('Main CSV parsed to 0 rows — check URL or column headers')
    return result
  }

  // ----------------------------------------------------------
  // 2. Build exclusion Set from corrections file
  //    These are O'Leary's confirmed false positives.
  // ----------------------------------------------------------
  const falsePositives = new Set(
    correctionsRows.map((r) => normaliseId(r.submission_number)).filter(Boolean),
  )

  // ----------------------------------------------------------
  // 3. Filter main list — remove false positives.
  // ----------------------------------------------------------
  const confirmedRows = mainRows.filter((row) => {
    const id = normaliseId(row.submission_number)
    if (falsePositives.has(id)) {
      result.excluded_false_positives++
      return false
    }
    return !!id
  })

  result.confirmed_pccp_devices = confirmedRows.length

  if (confirmedRows.length === 0) {
    return result
  }

  // ----------------------------------------------------------
  // 4. Bulk-look-up matching devices via device_external_ids.
  //
  // Post-A2b: device_master has no submission-number column. The
  // identifiers live in device_external_ids. We look up all confirmed
  // submission numbers in one IN() query across the three FDA id_types,
  // then work off an in-memory map.
  // ----------------------------------------------------------
  const confirmedIds = confirmedRows
    .map((r) => normaliseId(r.submission_number))
    .filter(Boolean)

  const { data: extIdHits, error: extIdErr } = await supabase
    .from('device_external_ids')
    .select('aletia_id, id_type, id_value')
    .in('id_type', ['fda_k_number', 'fda_de_novo', 'fda_pma'])
    .in('id_value', confirmedIds)

  if (extIdErr) {
    result.errors.push(`device_external_ids fetch failed: ${extIdErr.message}`)
    return result
  }

  // Map id_value → aletia_id. There's only one device per (id_type, id_value)
  // enforced by unique index, but a given id_value could theoretically appear
  // under multiple id_types — in practice K/DEN/P prefixes disambiguate, so
  // id_value alone is a safe key here.
  const aletiaIdByIdValue = new Map<string, string>()
  for (const row of extIdHits ?? []) {
    aletiaIdByIdValue.set(row.id_value, row.aletia_id)
  }

  // Also fetch current pccp_status for hits so we can skip no-op updates.
  const matchedAletiaIds = Array.from(new Set(aletiaIdByIdValue.values()))
  const pccpByAletiaId = new Map<string, { pccp_status: string | null; pccp_authorized_date: string | null }>()

  if (matchedAletiaIds.length > 0) {
    const { data: existing, error: fetchErr } = await supabase
      .from('device_master')
      .select('aletia_id, pccp_status, pccp_authorized_date')
      .in('aletia_id', matchedAletiaIds)

    if (fetchErr) {
      result.errors.push(`device_master fetch failed: ${fetchErr.message}`)
      return result
    }

    for (const row of existing ?? []) {
      pccpByAletiaId.set(row.aletia_id, {
        pccp_status:          row.pccp_status,
        pccp_authorized_date: row.pccp_authorized_date,
      })
    }
  }

  // ----------------------------------------------------------
  // 5. Process each confirmed PCCP row
  // ----------------------------------------------------------
  for (const row of confirmedRows) {
    const submissionId  = normaliseId(row.submission_number)
    const classified    = classifySubmissionNumber(submissionId)
    const authorizedDate = parseDate(row.date_decision)

    // ── Shape check on the submission number ──────────────────────────────
    if (!classified) {
      await logIngestionAnomaly(supabase, {
        source:                   SOURCE_ID,
        anomaly_type:             'unknown_identifier_shape',
        identifier_value:         submissionId,
        identifier_type_expected: 'fda_k_number | fda_de_novo | fda_pma',
        context:                  { row },
      })
      result.errors.push(`Unrecognised submission_number shape: ${submissionId}`)
      continue
    }

    const aletiaId = aletiaIdByIdValue.get(submissionId)

    // ── No match in device_external_ids → log anomaly, do NOT queue ───────
    if (!aletiaId) {
      await logIngestionAnomaly(supabase, {
        source:                   SOURCE_ID,
        anomaly_type:             'missing_required_field',
        identifier_value:         submissionId,
        identifier_type_expected: classified,
        context: {
          sponsor:              row.sponsor,
          device:               row.device,
          date_decision:        row.date_decision,
          product_code:         row.product_code,
          panel:                row.panel,
          pccp_authorized_date: authorizedDate,
          reason:               'submission_number not found in device_external_ids — run FDA sync to discover it first',
        },
      })
      result.unmatched_logged++
      continue
    }

    // ── Match hit. Skip if already up-to-date. ────────────────────────────
    const existing = pccpByAletiaId.get(aletiaId)
    if (
      existing &&
      existing.pccp_status === 'approved' &&
      existing.pccp_authorized_date === authorizedDate
    ) {
      result.already_up_to_date++
      continue
    }

    // ── Enrich device_master with PCCP fields ─────────────────────────────
    const { error: updateErr } = await supabase
      .from('device_master')
      .update({
        pccp_status:          'approved',
        pccp_authorized_date: authorizedDate,
        pccp_source:          SOURCE_ID,
      })
      .eq('aletia_id', aletiaId)

    if (updateErr) {
      result.errors.push(`Update failed for ${aletiaId} (${submissionId}): ${updateErr.message}`)
      continue
    }

    result.enriched_existing++
  }

  return result
}
