/**
 * lib/eudamed.ts — EUDAMED public-surface client + AI/ML discovery fetch.
 *
 * Mirrors lib/fda.ts: it is the "fetch + normalise" layer. It does NOT touch
 * the database or the 4d gate — lib/eudamedSync.ts does that. This module
 * produces normalised EudamedDeviceRecord[] from the live public API, driven
 * by the EMDN allow-list in lib/eudamedList.ts.
 *
 * Query surface (verified live, Step 0A §2 — EUDAMED-STEP-0A-FINDINGS.md):
 *   Search:    GET /tools/eudamed/api/devices/udiDiData
 *              params that WORK: cndCode (EMDN, PREFIX), tradeName (contains),
 *              size (max 300), page (0-indexed), deviceStatusCode, riskClassCode,
 *              languageIso2Code + iso2Code.
 *              NOT filterable (confirm client-side): manufacturerName, deviceName,
 *              q/query/searchText/freeText/text.
 *   Detail:    GET /tools/eudamed/api/devices/udiDiData/{uuid}?languageIso2Code=en
 *              → cndNomenclatures[].code (EMDN), additionalDescription.
 *              udiPiType.softwareIdentification is a PRODUCTION-ID type, NOT an
 *              AI flag — never gate on it.
 *   Basic-UDI: GET /tools/eudamed/api/devices/basicUdiData/{basicUdiUuid}?languageIso2Code=en
 *              → real deviceName, specialDeviceType.code (…software), 
 *              deviceCertificateInfoList[] (cert# + expiry + notified body),
 *              medicalPurpose.
 *
 * Discriminating fields (EMDN, software-type, real name, certificate/NB) live
 * on detail/basic-UDI, not on search — so we filter cheaply on the search
 * endpoint (cndCode) then detail-fetch only the candidates. NEVER crawl 2.4M.
 *
 * ── VERIFY AGAINST LIVE BEFORE THE FIRST REAL RUN (the st.id discipline) ──
 *   The Step 0A probe confirmed the search surface and field LOCATIONS. Two
 *   things this client assumes that you should confirm with a 1-device live
 *   call before trusting at scale (they were not nailed down in the findings):
 *     (a) BASIC_UDI_DETAIL_BY: the basic-UDI endpoint is keyed by the
 *         basic-UDI key. CONFIRMED against the Step 0A probe (9 June 2026):
 *         the basic-UDI UUID is NOT on the search row — it lives inside the
 *         detail response as `detail.basicUdi.uuid` (a real UUID, not the ULID).
 *         So the chain is sequential: search → row.uuid → GET udiDiData/{uuid}
 *         (detail) → detail.basicUdi.uuid → GET basicUdiData/{that uuid}. The
 *         earlier ULID-from-search-row shortcut 404'd every call; fixed below.
 *     (b) cndCode leaf: CONFIRMED — a bare leaf (e.g. Z11069092) returns a sane
 *         page (~204 rows for that code), not 2.4M.
 *
 * Rate limiting: EUDAMED 429s aggressively. fetchJson backs off and retries on
 * 429/503; per-candidate work is sequential with a polite inter-request delay.
 */

import {
  AI_EMDN_ALLOWLIST,
  hasAiKeyword,
  classifyEudamedCandidate,
  type EudamedConfidence,
} from './eudamedList';

const EUDAMED_BASE = 'https://ec.europa.eu/tools/eudamed/api';
const SEARCH_PAGE_SIZE = 100;        // findings: max 300; 100 is the stable choice
const REQUEST_DELAY_MS = 400;        // EUDAMED rate-limits aggressively (probe used 400ms)
const PAGE_DELAY_MS = 500;
const MAX_RETRIES = 4;               // on 429/503, with exponential backoff

// ── Raw API shapes (subset we read) ─────────────────────────────────────────

interface EudamedSearchRow {
  uuid: string;
  basicUdi: string;
  primaryDi: string | null;
  basicUdiDiDataUlid: string | null;
  manufacturerName: string | null;
  manufacturerSrn: string | null;
  tradeName: string | null;          // often null on search
  riskClass?: { code?: string } | null;
  deviceStatusType?: { code?: string } | null;
}

interface EudamedSearchPage {
  content: EudamedSearchRow[];
  totalPages: number;
  totalElements: number;
  number: number;                    // 0-indexed current page
  last: boolean;
}

interface EudamedUdiDetail {
  // Field paths CONFIRMED against a live udiDiData detail dump (9 June 2026):
  tradeName?: { textByDefaultLanguage?: string | null } | null;
  additionalDescription?: string | null;
  cndNomenclatures?: Array<{ code?: string; description?: { textByDefaultLanguage?: string | null } }>;
  udiPiType?: { softwareIdentification?: boolean | null } | null;
  deviceStatus?: { type?: { code?: string } } | null;
  riskClass?: { code?: string } | null;
  // NB/certificate/legislation are NOT on this endpoint, and the Basic UDI
  // record they'd live on is not retrievable via the public device API as of
  // 9 June 2026 (basicUdiDataUuid null across all sampled devices; every known
  // basicUdiData/{handle} 404s; notifiedBodyNumber filter ignored). Deferred as
  // a backfill pending the post-28-May-2026 NB/Certificates mandate populating.
  // See EUDAMED-STEP-0A-FINDINGS.md §2 correction (9 June 2026).
}

// ── Normalised output — mirrors the spirit of FdaListEntry / FdaSweepRecord ──

export interface EudamedDeviceRecord {
  basic_udi: string;                 // → device_external_ids.id_value (eudamed_basic_udi)
  primary_di: string | null;
  uuid: string;
  device_name: string | null;
  manufacturer_name: string | null;
  manufacturer_srn: string | null;
  risk_class: string | null;         // parsed, e.g. 'Class IIb'
  emdn_code: string | null;
  emdn_description: string | null;
  certificate_number: string | null;
  certificate_expiry: string | null;
  notified_body: string | null;
  notified_body_srn: string | null;
  legislation: string | null;        // 'EU MDR 2017/745'
  device_status: string | null;
  medical_purpose: string | null;
  is_software: boolean;
  keyword_hit: boolean;
  matched_emdn: string;              // the allow-list code that surfaced it
  confidence: EudamedConfidence;     // include | queue (reject is dropped pre-emit)
}

// ── Parsers (refdata code → human label) ─────────────────────────────────────

function parseRiskClass(code: string | null | undefined): string | null {
  if (!code) return null;
  const map: Record<string, string> = {
    'refdata.risk-class.class-i': 'Class I',
    'refdata.risk-class.class-iia': 'Class IIa',
    'refdata.risk-class.class-iib': 'Class IIb',
    'refdata.risk-class.class-iii': 'Class III',
  };
  return map[code] ?? code;
}

/**
 * Map legislation to a clearance_type label for regional_registrations.
 * Legislation isn't retrievable yet (deferred backfill), so callers pass null
 * today and this returns the generic 'CE Mark' fallback — correct given the
 * source. Kept ready for when the NB/Certificates data populates.
 */
export function clearanceTypeFromLegislation(legislation: string | null): string {
  if (legislation?.includes('MDR')) return 'CE Mark (MDR)';
  if (legislation?.includes('IVDR')) return 'CE Mark (IVDR)';
  if (legislation?.includes('MDD')) return 'CE Mark (MDD, legacy)';
  return 'CE Mark';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJson<T>(url: string): Promise<T> {
  let attempt = 0;
  for (;;) {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (res.ok) return res.json() as Promise<T>;

    // Retry only on throttle / transient (429, 503); 404 etc. are real misses.
    if ((res.status === 429 || res.status === 503) && attempt < MAX_RETRIES) {
      const retryAfter = parseInt(res.headers.get('retry-after') ?? '', 10);
      const backoff = Number.isFinite(retryAfter)
        ? retryAfter * 1000
        : Math.min(1000 * 2 ** attempt, 8000); // 1s, 2s, 4s, 8s
      console.warn(`[eudamed] ${res.status} — backing off ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await sleep(backoff);
      attempt += 1;
      continue;
    }
    throw new Error(`EUDAMED API ${res.status} ${res.statusText} — ${url}`);
  }
}

// ── Stage 1: search by cndCode (paginate one allow-list code fully) ──────────

async function searchByCndCode(cndCode: string): Promise<EudamedSearchRow[]> {
  const rows: EudamedSearchRow[] = [];
  let page = 0;
  for (;;) {
    const url = new URL(`${EUDAMED_BASE}/devices/udiDiData`);
    url.searchParams.set('cndCode', cndCode);
    url.searchParams.set('deviceStatusCode', 'refdata.device-model-status.on-the-market');
    url.searchParams.set('page', String(page));
    url.searchParams.set('size', String(SEARCH_PAGE_SIZE));
    url.searchParams.set('languageIso2Code', 'en');
    url.searchParams.set('iso2Code', 'en');

    const data = await fetchJson<EudamedSearchPage>(url.toString());
    rows.push(...(data.content ?? []));
    if (data.last || (data.content?.length ?? 0) === 0 || page >= (data.totalPages - 1)) break;
    page += 1;
    await sleep(PAGE_DELAY_MS);
  }
  return rows;
}

// ── Stage 2: detail for one candidate (single call) ──────────────────────────
//
// NB/certificate/legislation are deferred: the Basic UDI record that carries
// them is not retrievable via the public device API as of 9 June 2026, and the
// NB/Certificates module only became mandatory 28 May 2026 — so the data is
// largely not populated yet. This is a backfill to revisit MONTHLY (fold a
// "has basicUdiDataUuid started populating?" check into the re-pull cron), not
// a code bug. Until then we read everything available off the detail endpoint.

async function fetchUdiDetail(uuid: string): Promise<EudamedUdiDetail | null> {
  try {
    return await fetchJson<EudamedUdiDetail>(
      `${EUDAMED_BASE}/devices/udiDiData/${uuid}?languageIso2Code=en`,
    );
  } catch (err) {
    console.warn(`[eudamed] detail fetch failed for ${uuid}: ${(err as Error).message}`);
    return null;
  }
}

// ── Orchestration: allow-list → search → detail → guard → normalise ──────────

export interface FetchEudamedOptions {
  /** Slice of the allow-list to process (route batching). Defaults to all. */
  codes?: readonly string[];
  /** Drop 'queue'-confidence (allow-list-only, uncorroborated) candidates. Default false. */
  includeOnly?: boolean;
  /** Per-request pause override. */
  delayMs?: number;
  /**
   * Cap how many search rows per code get the (expensive) detail+basic-UDI
   * fetch. Use a small number to verify quickly without hammering the API; the
   * route can use it to stay under the serverless timeout on big codes.
   */
  limitPerCode?: number;
}

/**
 * Fetch AI/ML-relevant EUDAMED devices via the EMDN allow-list. Two-stage:
 * cheap search by cndCode, then detail+basic-UDI per candidate, then the
 * precision-guard classification. Returns normalised records (confidence
 * 'include' or 'queue'; 'reject' is dropped). Dedups on basic_udi.
 */
export async function fetchEudamedAiMlDevices(
  opts: FetchEudamedOptions = {},
): Promise<EudamedDeviceRecord[]> {
  const codes = opts.codes ?? AI_EMDN_ALLOWLIST;
  const reqDelay = opts.delayMs ?? REQUEST_DELAY_MS;
  const seen = new Set<string>();
  const out: EudamedDeviceRecord[] = [];

  for (const cndCode of codes) {
    let searchRows: EudamedSearchRow[];
    try {
      searchRows = await searchByCndCode(cndCode);
    } catch (err) {
      console.warn(`[eudamed] search failed for cndCode=${cndCode}: ${(err as Error).message}`);
      continue;
    }
    console.info(`[eudamed] cndCode=${cndCode} → ${searchRows.length} search rows`);

    const rowsToProcess = opts.limitPerCode ? searchRows.slice(0, opts.limitPerCode) : searchRows;
    for (const row of rowsToProcess) {
      if (!row.uuid || seen.has(row.uuid)) continue;
      seen.add(row.uuid);

      // Single call: everything we can get is on the detail (udiDiData) record.
      await sleep(reqDelay);
      const detail = await fetchUdiDetail(row.uuid);

      // EMDN from detail — confirm the device actually carries an allow-list code
      // (cndCode prefix-match can surface neighbours).
      const emdn = detail?.cndNomenclatures?.find((c) => c.code) ?? null;
      const emdnCode = emdn?.code ?? null;
      const emdnOnAllowlist =
        !!emdnCode && AI_EMDN_ALLOWLIST.some((a) => emdnCode.startsWith(a));

      // Field paths confirmed live: name = tradeName.textByDefaultLanguage;
      // software = udiPiType.softwareIdentification.
      const deviceName = detail?.tradeName?.textByDefaultLanguage ?? row.tradeName ?? null;
      const isSoftware = detail?.udiPiType?.softwareIdentification === true;
      const keywordHit = hasAiKeyword(deviceName, detail?.additionalDescription);

      const confidence = classifyEudamedCandidate({ emdnOnAllowlist, isSoftware, keywordHit });
      if (confidence === 'reject') continue;
      if (opts.includeOnly && confidence !== 'include') continue;

      out.push({
        basic_udi: row.basicUdi,
        primary_di: row.primaryDi ?? null,
        uuid: row.uuid,
        device_name: deviceName,
        manufacturer_name: row.manufacturerName ?? null,
        manufacturer_srn: row.manufacturerSrn ?? null,
        risk_class: parseRiskClass(detail?.riskClass?.code ?? row.riskClass?.code),
        emdn_code: emdnCode,
        emdn_description: emdn?.description?.textByDefaultLanguage ?? null,
        // NB/cert/legislation deferred — not retrievable yet (monthly re-probe).
        certificate_number: null,
        certificate_expiry: null,
        notified_body: null,
        notified_body_srn: null,
        legislation: null,
        device_status:
          detail?.deviceStatus?.type?.code ?? row.deviceStatusType?.code ?? null,
        medical_purpose: null,
        is_software: isSoftware,
        keyword_hit: keywordHit,
        matched_emdn: cndCode,
        confidence,
      });
    }
  }

  console.info(
    `[eudamed] fetched ${out.length} AI-candidate devices ` +
    `(${out.filter((d) => d.confidence === 'include').length} include, ` +
    `${out.filter((d) => d.confidence === 'queue').length} queue) across ${codes.length} codes`,
  );
  return out;
}
