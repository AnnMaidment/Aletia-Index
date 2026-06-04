/**
 * lib/fdaList.ts
 * Fetcher for the FDA's official AI-Enabled Medical Device List.
 *
 * This is the AUTHORITATIVE discovery seed for FDA devices. The list is
 * maintained by the FDA's Digital Health Center of Excellence and identifies
 * devices authorised for marketing in the US that incorporate AI/ML, based on
 * AI-related terms in the marketing-authorisation summary and/or device
 * classification. It spans 510(k), De Novo and PMA pathways and is updated
 * periodically (not exhaustive — pair with the supplementary openFDA sweep in
 * lib/fda.ts for recent devices not yet listed).
 *
 * Landing page:
 *   https://www.fda.gov/medical-devices/software-medical-device-samd/artificial-intelligence-enabled-medical-devices
 *   (note: the older `...-machine-learning-aiml-enabled-medical-devices` slug
 *    currently redirects here. The CSV media URL below is what we actually pull.)
 *
 * The page offers CSV / Excel / XML downloads. We use the CSV — it is plain
 * `text/csv` with standard RFC-4180 quoting and parses with a single fetch.
 *
 * VERIFY ON EACH RUN (cheap insurance): the FDA occasionally re-issues media
 * IDs. If FDA_LIST_CSV_URL 404s, re-read the landing page for the current
 * "Download a CSV File" link before assuming the parser is broken.
 */

const FDA_LIST_CSV_URL = 'https://www.fda.gov/media/178541/download?attachment';

export type FdaPathway = '510k' | 'De Novo' | 'PMA';
export type FdaIdType = 'fda_k_number' | 'fda_de_novo' | 'fda_pma';

export interface FdaListEntry {
  identifier: string;          // Submission Number, e.g. K253532 / DEN230088 / P210011
  id_type: FdaIdType;
  pathway: FdaPathway;
  device_name: string;
  applicant: string;
  product_code: string;
  panel: string;               // "Panel (Lead)", e.g. Radiology — useful for specialty later
  decision_date: string | null; // ISO yyyy-mm-dd, parsed from MM/DD/YYYY
}

/** Map a Submission Number prefix to its pathway / id_type. */
export function classifyIdentifier(
  submissionNumber: string
): { id_type: FdaIdType; pathway: FdaPathway } | null {
  const id = submissionNumber.trim().toUpperCase();
  if (/^DEN\d/.test(id)) return { id_type: 'fda_de_novo', pathway: 'De Novo' };
  if (/^P\d/.test(id))   return { id_type: 'fda_pma',     pathway: 'PMA' };
  if (/^K\d/.test(id))   return { id_type: 'fda_k_number', pathway: '510k' };
  return null; // unknown prefix (e.g. supplements) — caller should log + skip
}

/** MM/DD/YYYY -> yyyy-mm-dd, or null if unparseable. */
function toIsoDate(usDate: string): string | null {
  const m = usDate.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

/**
 * Minimal RFC-4180 CSV parser (handles quoted fields, embedded commas, escaped
 * quotes, CRLF). Dependency-free on purpose — the file is small and well-formed.
 * If the repo already bundles papaparse, swap this for Papa.parse(text, {header:true}).
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Parse the FDA list CSV text into normalised entries. Skips unknown-prefix rows. */
export function parseFdaListCsv(csvText: string): {
  entries: FdaListEntry[];
  skipped: { submissionNumber: string; reason: string }[];
} {
  const rows = parseCsv(csvText);
  if (rows.length === 0) return { entries: [], skipped: [] };

  // Resolve columns by header name (don't assume positional order).
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.findIndex((h) => h === name.toLowerCase());
  const iDate = col('Date of Final Decision');
  const iSub  = col('Submission Number');
  const iDev  = col('Device');
  const iCo   = col('Company');
  const iPanel = col('Panel (Lead)');
  const iCode = col('Primary Product Code');

  if ([iSub, iDev, iCo, iCode].some((x) => x === -1)) {
    throw new Error(
      `[fdaList] Unexpected CSV header — columns moved or renamed: ${header.join(' | ')}`
    );
  }

  const entries: FdaListEntry[] = [];
  const skipped: { submissionNumber: string; reason: string }[] = [];

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const submissionNumber = (cells[iSub] ?? '').trim();
    if (!submissionNumber) continue;

    const cls = classifyIdentifier(submissionNumber);
    if (!cls) {
      skipped.push({ submissionNumber, reason: 'unrecognised identifier prefix' });
      continue;
    }

    entries.push({
      identifier: submissionNumber,
      id_type: cls.id_type,
      pathway: cls.pathway,
      device_name: (cells[iDev] ?? '').trim(),
      applicant: (cells[iCo] ?? '').trim(),
      product_code: (cells[iCode] ?? '').trim(),
      panel: iPanel === -1 ? '' : (cells[iPanel] ?? '').trim(),
      decision_date: iDate === -1 ? null : toIsoDate(cells[iDate] ?? ''),
    });
  }

  return { entries, skipped };
}

/** Fetch + parse the live FDA AI/ML list. Throws on network / format failure. */
export async function fetchFdaAiMlList(): Promise<FdaListEntry[]> {
  const res = await fetch(FDA_LIST_CSV_URL, {
    headers: { Accept: 'text/csv' },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(
      `[fdaList] CSV download failed: ${res.status}. ` +
      `Re-check the "Download a CSV File" link on the FDA list landing page.`
    );
  }
  const text = await res.text();
  const { entries, skipped } = parseFdaListCsv(text);
  console.info(
    `[fdaList] parsed ${entries.length} devices ` +
    `(${entries.filter(e => e.pathway === '510k').length} 510k, ` +
    `${entries.filter(e => e.pathway === 'De Novo').length} De Novo, ` +
    `${entries.filter(e => e.pathway === 'PMA').length} PMA); ` +
    `${skipped.length} skipped.`
  );
  if (entries.length < 1000) {
    // The list held ~1,451 at the Dec 2025 update; a large drop means a
    // truncated download or a format change, not a real shrinkage.
    console.warn(`[fdaList] suspiciously low entry count (${entries.length}) — verify the download.`);
  }
  return entries;
}
