/**
 * lib/fda.ts
 * openFDA API service layer for Aletia Index
 * Docs: https://open.fda.gov/apis/device/
 *
 * No API key required for basic use.
 * Rate limit: 240 requests/minute unauthenticated.
 * Add OPENFDA_API_KEY to .env.local to raise limit to 120,000/min.
 *
 * Scope: Class II and Class III AI/ML medical devices only.
 * Jurisdictions: FDA (US), CE Mark (EU), SAHPRA (ZA)
 *
 * DISCOVERY ROLE (rebuilt June 2026 — FDA discovery rebuild, Phase 1):
 *   The authoritative discovery seed is now the FDA's own published AI/ML list
 *   (see lib/fdaList.ts). The product-code + keyword searches in THIS file are
 *   DEMOTED to a *supplementary sweep* — they exist only to catch recent
 *   devices not yet on the published list. They no longer define "is this AI?";
 *   list membership does (see buildFdaDeviceSeed in lib/fdaSync.ts).
 *
 *   All discovery queries are now paginated (skip), so no query truncates at
 *   the openFDA 1000-row cap. The sweep spans 510(k), De Novo (which lives in
 *   the 510k dataset — openFDA has no `denovo` endpoint) and PMA.
 *
 * Product codes last reviewed: June 2026 (duplicate QKB removed).
 * Source: https://www.fda.gov/medical-devices/software-medical-device-samd/artificial-intelligence-enabled-medical-devices
 */

import { classifyIdentifier, type FdaIdType } from './fdaList';

const FDA_BASE = 'https://api.fda.gov/device';
const API_KEY = process.env.OPENFDA_API_KEY ?? '';

// Aletia Index only covers Class II and III — Class I is out of scope
const ALLOWED_DEVICE_CLASSES = ['2', '3'];

// openFDA hard limits: max `limit` per call is 1000; `skip` may not exceed 25000.
const OPENFDA_MAX_LIMIT = 1000;
const OPENFDA_MAX_SKIP = 25000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Supplementary product codes associated with AI/ML medical devices.
 *
 * NOTE (June 2026): this list is no longer the discovery authority — the FDA's
 * published AI/ML list is (lib/fdaList.ts). These codes now drive only the
 * supplementary sweep for very recent devices not yet on the published list.
 * Broad imaging-system codes here (JAK/KPR/LLZ/IYN) intentionally over-reach;
 * the seed builder no longer blanket-flags swept devices as AI (it defers to
 * list membership), and the prune removes off-list over-capture.
 *
 * Grouped by clinical area for maintainability.
 */
export const AIML_PRODUCT_CODES = [
  // ── RADIOLOGY — imaging AI, reconstruction, segmentation ──────────────────
  'QIH', // Radiological CAD software — most common AI/ML code (~40% of all AI devices)
  'LNH', // MRI system with deep learning reconstruction (AI image enhancement)
  'LLZ', // Diagnostic imaging software / viewer with AI features
  'JAK', // CT system with AI-assisted acquisition or analysis
  'KPR', // X-ray / digital radiography with AI
  'IYN', // Ultrasound system with AI-assisted features
  'MYN', // Dental / chest X-ray AI (computer-aided detection)
  'QDQ', // Mammography AI / breast cancer detection
  'QAS', // Stroke / neuro AI triage (LVO, ASPECTS, perfusion)
  'QFM', // Chest X-ray AI triage and prioritisation
  'QBS', // Radiological image analysis (trauma, brain, general)
  'QKB', // Auto-segmentation and auto-contouring (radiation therapy)
  'OEB', // Lung CT AI (nodule detection, lung cancer screening)
  'MUJ', // Radiation therapy planning AI
  'KPS', // PET / nuclear medicine AI
  'OWB', // Angiography / fluoroscopy AI
  'QWO', // Lung disease AI (ILD, interstitial lung disease)
  'SAO', // Orthopedic / musculoskeletal imaging AI
  'QJU', // Cardiac ultrasound guidance AI
  'QHA', // Coronary FFR / fractional flow reserve AI
  'QTZ', // Thermal / ablation imaging AI
  'QER', // Ophthalmic imaging AI (retina, glaucoma)
  'IYO', // Ophthalmic ultrasound AI
  'KGI', // Bone density / DXA AI
  'POK', // Fetal / thyroid ultrasound AI
  'QBC', // Neurological imaging AI
  'JAA', // Radiology image management with AI
  // (duplicate 'QKB' removed June 2026 — it was listed twice in this block)

  // ── CARDIOVASCULAR ────────────────────────────────────────────────────────
  'QYE', // ECG AI — low ejection fraction, cardiac function detection
  'QDA', // ECG wearable AI (Withings, consumer devices)
  'DQK', // Cardiac rhythm AI / arrhythmia detection and classification
  'DPS', // Holter monitor AI analysis
  'DQD', // Electronic stethoscope AI (Eko Health)
  'PJA', // Coronary CTA with FFR-CT (HeartFlow)
  'SDJ', // Cardiac amyloid / echocardiography AI
  'MXD', // Cardiac implantable device with AI (Abbott)
  'QME', // Vital signs / contactless patient monitoring AI
  'MWI', // Wearable health monitoring AI (Empatica)
  'SDY', // Loss of pulse / cardiac arrest detection (Fitbit)
  'SFR', // Hypertension notification (Apple Watch)
  'QUO', // Heart failure status indicator AI (Icardio.Ai — why K251293 was missed)
  'DSH', // Cardiac patch / long-term ambulatory monitoring
  'QJO', // Cardiac AI (legacy code — retain from original list)

  // ── NEUROLOGY ─────────────────────────────────────────────────────────────
  'OLO', // Robotic surgical system (spine / neuro)
  'QPF', // Autism / neurodevelopmental AI diagnosis (Canvas Dx, EarliPoint)
  'OMB', // EEG analysis AI (seizure detection, brain mapping)
  'OLZ', // Sleep study / polysomnography AI
  'OLV', // Sleep staging AI (Compumedics)
  'HAW', // Surgical navigation (neuro, EVD placement)
  'POS', // Epilepsy wearable monitoring AI
  'SBF', // AR surgical navigation (spine — Augmedics, SyncAR)

  // ── PATHOLOGY ─────────────────────────────────────────────────────────────
  'QPN', // Digital pathology AI (prostate — Ibex)
  'SFH', // Pathology AI — De Novo (ArteraAI prostate treatment response)
  'PZM', // NGS tumour profiling (Geneseeq)

  // ── OBSTETRICS / GYNAECOLOGY ──────────────────────────────────────────────
  'PBH', // Embryo AI selection (IVF — Fairtility CHLOE)
  'HGM', // Fetal heart rate / CTG AI (PeriGen)

  // ── HEMATOLOGY ────────────────────────────────────────────────────────────
  'JOY', // Peripheral blood smear AI (Scopio Labs)
  'POV', // Semen quality analysis AI (LensHooke)

  // ── GASTROENTEROLOGY / UROLOGY ────────────────────────────────────────────
  'QNP', // Colonoscopy polyp detection AI (SKOUT, MAGENTIQ-COLO)
  'QZB', // Robotic surgical system GI (Moon Surgical Maestro)
  'SFE', // Surgical hyperspectral imaging AI (HyperSnap)

  // ── ANESTHESIOLOGY ────────────────────────────────────────────────────────
  'QRG', // Nerve block AI guidance (Nerveblox)
  'PHZ', // Respiratory / rhonchi detection AI (Tyto Care)
  'BZQ', // Airway management AI (Airmod)
  'MNR', // Sleep apnea / home sleep apnea test (SANSA HSAT, TipTraQ)

  // ── ORTHOPEDIC ────────────────────────────────────────────────────────────
  'MAX', // Lumbar fusion surgical AI (GetSet GoLIF!)
  'KWS', // Shoulder planning AI (Medacta MyShoulder)
  'QHE', // Surgical planning AI (Precision AI)

  // ── MICROBIOLOGY ──────────────────────────────────────────────────────────
  'PRE', // Sepsis / infection AI diagnostic (TriVerity)

  // ── LEGACY — kept from original list ─────────────────────────────────────
  'PWE', // Computer-aided detection (older cleared devices)
];

// ── Jurisdiction Types ─────────────────────────────────────────────────────────

/** The three regulatory bodies Aletia currently supports */
export type RegulatoryBody = 'FDA' | 'CE Mark' | 'SAHPRA';

/**
 * Valid clearance types per jurisdiction:
 * FDA:      510k | PMA | De Novo
 * CE Mark:  MDR | MDD
 * SAHPRA:   Acknowledgement Letter | Full Registration
 */
export type ClearanceType =
  | '510k'                    // FDA — most common for AI/ML Class II
  | 'PMA'                     // FDA — Class III, highest scrutiny
  | 'De Novo'                 // FDA — novel low-to-moderate risk devices
  | 'MDR'                     // CE Mark — Medical Device Regulation (current)
  | 'MDD'                     // CE Mark — Medical Device Directive (legacy)
  | 'Acknowledgement Letter'  // SAHPRA — provisional registration
  | 'Full Registration';      // SAHPRA — full market authorisation

export interface RegionalRegistration {
  device_link: string;
  country: string;
  regulatory_body: RegulatoryBody;
  clearance_type: ClearanceType;
  regulatory_expiry?: string;
}

export const JURISDICTIONS: Record<
  RegulatoryBody,
  { country: string; clearance_types: ClearanceType[] }
> = {
  FDA: {
    country: 'US',
    clearance_types: ['510k', 'PMA', 'De Novo'],
  },
  ['CE Mark']: {
    country: 'EU',
    clearance_types: ['MDR', 'MDD'],
  },
  SAHPRA: {
    country: 'ZA',
    clearance_types: ['Acknowledgement Letter', 'Full Registration'],
  },
};

// ── FDA API Result Types ───────────────────────────────────────────────────────

export interface FDA510kResult {
  k_number: string;
  device_name: string;
  applicant: string;
  decision_date: string;
  decision_description: string;
  product_code: string;
  clearance_type: '510k';
}

export interface FDAPMAResult {
  pma_number: string;
  device_name: string;
  applicant: string;
  decision_date: string;
  decision_description: string;
  product_code: string;
  clearance_type: 'PMA';
}

export interface FDARecallResult {
  recall_number: string;
  device_name: string;
  recalling_firm: string;
  recall_initiation_date: string;
  status: string;
  reason_for_recall: string;
  classification: string;
}

export interface FDAAdverseEventSummary {
  device_name: string;
  total_events: number;
}

export interface FDAClassificationResult {
  product_code: string;
  device_name: string;
  device_class: '2' | '3';
  regulation_number: string;
  definition: string;
}

/**
 * Normalised record emitted by the supplementary sweep. Carries the real
 * identifier and its resolved id_type so the discovery path (PUT /api/fda-sync)
 * can ingest De Novo (DEN…) and PMA (P…) results with the correct id_type
 * rather than assuming everything is a K-number.
 */
export interface FdaSweepRecord {
  identifier: string;
  id_type: FdaIdType;
  device_name: string;
  applicant: string;
  product_code: string;
  decision_date: string;
}

// ── Internal Fetch Helpers ──────────────────────────────────────────────────────

async function fdaFetch<T>(
  endpoint: string,
  params: Record<string, string>
): Promise<T[] | null> {
  if (API_KEY) params.api_key = API_KEY;
  const query = new URLSearchParams(params).toString();
  const url = `${FDA_BASE}/${endpoint}.json?${query}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (res.status === 404) return []; // openFDA returns 404 for "no matches"
    if (!res.ok) {
      console.error(`[fda.ts] HTTP ${res.status} → ${url}`);
      return null;
    }
    const json = await res.json();
    return (json.results as T[]) ?? [];
  } catch (err) {
    console.error(`[fda.ts] Network error → ${url}:`, err);
    return null;
  }
}

/**
 * Paginated fetch: walks `skip` until a short page is returned or the openFDA
 * skip ceiling (25000) is reached. Fixes the previous structural undercount
 * where queries silently capped at the first 1000 rows.
 *
 * On a mid-pagination network error it returns what it has gathered so far
 * (with a warning) rather than nothing — a partial sweep is better than a
 * dropped one, and the next run reconciles. Returns null only if the very
 * first page failed.
 */
async function fdaFetchAll<T>(
  endpoint: string,
  params: Record<string, string>,
  opts: { pageSize?: number; delayMs?: number; label?: string } = {}
): Promise<T[] | null> {
  const pageSize = Math.min(opts.pageSize ?? OPENFDA_MAX_LIMIT, OPENFDA_MAX_LIMIT);
  const delayMs = opts.delayMs ?? 300;
  const label = opts.label ?? endpoint;

  const out: T[] = [];
  let skip = 0;
  let pageIndex = 0;

  while (true) {
    const page = await fdaFetch<T>(endpoint, {
      ...params,
      limit: String(pageSize),
      skip: String(skip),
    });

    if (page === null) {
      if (pageIndex === 0) return null; // first page failed → genuine failure
      console.warn(`[fda.ts] ${label}: network error after ${out.length} rows; returning partial.`);
      break;
    }

    out.push(...page);
    pageIndex++;

    if (page.length < pageSize) break; // last page

    skip += pageSize;
    if (skip >= OPENFDA_MAX_SKIP) {
      // A single slice exceeding 25k means this code/query is too broad to
      // paginate with skip alone — would need search_after. Product-code
      // batches never approach this; warn loudly if it ever happens.
      console.warn(
        `[fda.ts] ${label}: hit openFDA skip ceiling (${OPENFDA_MAX_SKIP}) — ` +
        `slice truncated at ${out.length} rows. Narrow the query or use search_after.`
      );
      break;
    }

    await sleep(delayMs);
  }

  return out;
}

// ── 510(k) Clearances ──────────────────────────────────────────────────────────

export async function get510kByKNumber(
  kNumber: string
): Promise<FDA510kResult | null> {
  const results = await fdaFetch<Record<string, string>>('510k', {
    search: `k_number:"${kNumber}"`,
    limit: '1',
  });
  if (!results?.length) return null;
  const r = results[0];
  return {
    k_number: r.k_number,
    device_name: r.device_name,
    applicant: r.applicant,
    decision_date: r.decision_date,
    decision_description: r.decision_description,
    product_code: r.product_code,
    clearance_type: '510k',
  };
}

export async function search510kByName(
  deviceName: string
): Promise<FDA510kResult | null> {
  const results = await fdaFetch<Record<string, string>>('510k', {
    search: `device_name:"${deviceName}"`,
    limit: '1',
  });
  if (!results?.length) return null;
  const r = results[0];
  return {
    k_number: r.k_number,
    device_name: r.device_name,
    applicant: r.applicant,
    decision_date: r.decision_date,
    decision_description: r.decision_description,
    product_code: r.product_code,
    clearance_type: '510k',
  };
}

// ── PMA (Pre-Market Approval) ──────────────────────────────────────────────────

export async function getPMAByNumber(
  pmaNumber: string
): Promise<FDAPMAResult | null> {
  const results = await fdaFetch<Record<string, string>>('pma', {
    search: `pma_number:"${pmaNumber}"`,
    limit: '1',
  });
  if (!results?.length) return null;
  const r = results[0];
  return {
    pma_number: r.pma_number,
    device_name: r.device_name,
    applicant: r.applicant,
    decision_date: r.decision_date,
    decision_description: r.decision_description,
    product_code: r.product_code,
    clearance_type: 'PMA',
  };
}

// ── Recalls ────────────────────────────────────────────────────────────────────

export async function getRecallsByKNumber(
  kNumber: string
): Promise<FDARecallResult[]> {
  const results = await fdaFetch<Record<string, string>>('recall', {
    search: `k_numbers:"${kNumber}"`,
    limit: '10',
  });
  if (!results?.length) return [];
  return results.map((r) => ({
    recall_number: r.recall_number ?? '',
    device_name: (r.device as any)?.brand_name ?? '',
    recalling_firm: r.recalling_firm ?? '',
    recall_initiation_date: r.recall_initiation_date ?? '',
    status: r.status ?? '',
    reason_for_recall: r.reason_for_recall ?? '',
    classification: r.classification ?? '',
  }));
}

// ── Adverse Events (MDRs) ──────────────────────────────────────────────────────

export async function getAdverseEventCount(
  deviceName: string
): Promise<FDAAdverseEventSummary> {
  try {
    const key = API_KEY ? `&api_key=${API_KEY}` : '';
    const url = `${FDA_BASE}/event.json?search=device.brand_name:"${encodeURIComponent(deviceName)}"&limit=1${key}`;
    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) return { device_name: deviceName, total_events: 0 };
    const json = await res.json();
    return {
      device_name: deviceName,
      total_events: json.meta?.results?.total ?? 0,
    };
  } catch {
    return { device_name: deviceName, total_events: 0 };
  }
}

// ── Classification ─────────────────────────────────────────────────────────────

export async function getClassificationByProductCode(
  productCode: string
): Promise<FDAClassificationResult | null> {
  const results = await fdaFetch<Record<string, string>>('classification', {
    search: `product_code:"${productCode}"`,
    limit: '1',
  });
  if (!results?.length) return null;
  const r = results[0];

  if (!ALLOWED_DEVICE_CLASSES.includes(r.device_class)) {
    console.info(
      `[fda.ts] Skipping Class I device with product code: ${productCode}`
    );
    return null;
  }

  return {
    product_code: r.product_code,
    device_name: r.device_name,
    device_class: r.device_class as '2' | '3',
    regulation_number: r.regulation_number ?? '',
    definition: r.definition ?? '',
  };
}

// ── Supplementary sweep: 510(k) by product codes (PAGINATED) ───────────────────

/**
 * SUPPLEMENTARY SWEEP (product codes, 510k dataset).
 *
 * Was the primary seed; now a sweep for recent devices not yet on the FDA
 * published list. The 510k dataset includes both 510(k) and De Novo decision
 * types (openFDA has no separate `denovo` endpoint), so this naturally sweeps
 * De Novo records too — the caller classifies each result by identifier prefix.
 *
 * Codes are batched (15 per query) AND each batch is fully paginated, so the
 * old `limit:1000`-per-batch truncation (which clipped QIH, ~40% of devices)
 * is gone.
 */
export async function searchAIMLByProductCodes(): Promise<FDA510kResult[]> {
  const BATCH_SIZE = 15;
  const uniqueCodes = [...new Set(AIML_PRODUCT_CODES)]; // belt-and-braces dedupe
  const batches: string[][] = [];

  for (let i = 0; i < uniqueCodes.length; i += BATCH_SIZE) {
    batches.push(uniqueCodes.slice(i, i + BATCH_SIZE));
  }

  const allResults: FDA510kResult[] = [];
  const seen = new Set<string>();

  for (const batch of batches) {
    await sleep(300); // respect FDA rate limit between batches

    const results = await fdaFetchAll<Record<string, string>>(
      '510k',
      { search: `product_code:(${batch.join(' OR ')})` },
      { label: `510k product_code batch [${batch[0]}…]` }
    );

    if (!results) continue;

    for (const r of results) {
      if (!r.k_number || seen.has(r.k_number)) continue;
      seen.add(r.k_number);
      allResults.push({
        k_number: r.k_number,
        device_name: r.device_name,
        applicant: r.applicant,
        decision_date: r.decision_date,
        decision_description: r.decision_description,
        product_code: r.product_code,
        clearance_type: '510k' as const,
      });
    }
  }

  console.info(`[fda.ts] searchAIMLByProductCodes: ${allResults.length} devices across ${batches.length} batches (paginated)`);
  return allResults;
}

// ── Supplementary sweep: 510(k) by AI keyword (PAGINATED) ──────────────────────

/**
 * SUPPLEMENTARY SWEEP (keyword, 510k dataset). Catches devices whose name
 * carries an AI term but whose product code isn't in AIML_PRODUCT_CODES.
 * Now paginated.
 */
export async function searchAIMLDevices(): Promise<FDA510kResult[]> {
  const results = await fdaFetchAll<Record<string, string>>(
    '510k',
    { search: 'device_name:(AI OR "artificial intelligence" OR "machine learning" OR "deep learning" OR "neural network")' },
    { label: '510k keyword sweep' }
  );
  if (!results) return [];

  return results.map((r) => ({
    k_number: r.k_number,
    device_name: r.device_name,
    applicant: r.applicant,
    decision_date: r.decision_date,
    decision_description: r.decision_description,
    product_code: r.product_code,
    clearance_type: '510k' as const,
  }));
}

// ── Supplementary sweep: PMA by product codes (PAGINATED) ──────────────────────

/**
 * SUPPLEMENTARY SWEEP (product codes, PMA dataset). Class III completeness:
 * the published list carries PMAs, but recent PMA authorisations not yet listed
 * are caught here. Uses the `pma` endpoint (distinct from 510k) and emits the
 * pma_number as identifier.
 */
export async function searchAIMLPMAByProductCodes(): Promise<FDAPMAResult[]> {
  const BATCH_SIZE = 15;
  const uniqueCodes = [...new Set(AIML_PRODUCT_CODES)];
  const batches: string[][] = [];

  for (let i = 0; i < uniqueCodes.length; i += BATCH_SIZE) {
    batches.push(uniqueCodes.slice(i, i + BATCH_SIZE));
  }

  const allResults: FDAPMAResult[] = [];
  const seen = new Set<string>();

  for (const batch of batches) {
    await sleep(300);

    const results = await fdaFetchAll<Record<string, string>>(
      'pma',
      { search: `product_code:(${batch.join(' OR ')})` },
      { label: `pma product_code batch [${batch[0]}…]` }
    );

    if (!results) continue;

    for (const r of results) {
      if (!r.pma_number || seen.has(r.pma_number)) continue;
      seen.add(r.pma_number);
      allResults.push({
        pma_number: r.pma_number,
        device_name: r.device_name,
        applicant: r.applicant,
        decision_date: r.decision_date,
        decision_description: r.decision_description,
        product_code: r.product_code,
        clearance_type: 'PMA' as const,
      });
    }
  }

  console.info(`[fda.ts] searchAIMLPMAByProductCodes: ${allResults.length} PMA devices across ${batches.length} batches (paginated)`);
  return allResults;
}

// ── Combined supplementary sweep (normalised, for the discovery path) ──────────

/**
 * The full supplementary sweep used by the rebuilt discovery flow AFTER the
 * FDA-list seed has run. Merges paginated 510(k) (product-code + keyword) and
 * PMA (product-code) results, classifies each by identifier prefix (so DEN…
 * → fda_de_novo, P… → fda_pma, K… → fda_k_number), and dedupes.
 *
 * Returns normalised records; the caller adds only identifiers not already
 * present from the list seed (handled at the ingest layer via the 4d gate).
 *
 * NOTE on De Novo: there is no openFDA `denovo` endpoint — De Novo decisions
 * live in the 510k dataset. Whether a swept De Novo record exposes its DEN…
 * number or a granted K… number in `k_number` should be eyeballed on the first
 * run (this function logs the id_type distribution). The authoritative De Novo
 * source is the published list (lib/fdaList.ts), which carries DEN… directly.
 */
export async function searchAllAIMLForSweep(): Promise<FdaSweepRecord[]> {
  const [byCode, byName, byPMA] = await Promise.all([
    searchAIMLByProductCodes(),
    searchAIMLDevices(),
    searchAIMLPMAByProductCodes(),
  ]);

  const out: FdaSweepRecord[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  const pushOne = (
    identifier: string,
    device_name: string,
    applicant: string,
    product_code: string,
    decision_date: string,
    pmaHint = false
  ) => {
    const id = (identifier ?? '').trim();
    if (!id) { skipped++; return; }

    // PMA numbers are emitted from the pma endpoint; classify directly to avoid
    // any ambiguity with the prefix matcher.
    const cls = pmaHint
      ? { id_type: 'fda_pma' as FdaIdType }
      : classifyIdentifier(id);

    if (!cls) { skipped++; return; }

    const key = `${cls.id_type}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);

    out.push({
      identifier: id,
      id_type: cls.id_type,
      device_name: device_name ?? '',
      applicant: applicant ?? '',
      product_code: product_code ?? '',
      decision_date: decision_date ?? '',
    });
  };

  for (const r of byCode) pushOne(r.k_number, r.device_name, r.applicant, r.product_code, r.decision_date);
  for (const r of byName) pushOne(r.k_number, r.device_name, r.applicant, r.product_code, r.decision_date);
  for (const r of byPMA)  pushOne(r.pma_number, r.device_name, r.applicant, r.product_code, r.decision_date, true);

  const counts = out.reduce<Record<string, number>>((acc, e) => {
    acc[e.id_type] = (acc[e.id_type] ?? 0) + 1;
    return acc;
  }, {});

  console.info(
    `[fda.ts] searchAllAIMLForSweep: ${out.length} unique sweep records ` +
    `(fda_k_number=${counts.fda_k_number ?? 0}, fda_de_novo=${counts.fda_de_novo ?? 0}, ` +
    `fda_pma=${counts.fda_pma ?? 0}); ${skipped} skipped (blank/unrecognised identifier).`
  );

  return out;
}

/**
 * @deprecated Pre-rebuild combined 510(k) seed. Superseded by the FDA-list seed
 * (lib/fdaList.ts) plus searchAllAIMLForSweep(). Retained so nothing breaks if
 * still referenced; the discovery path no longer calls it. Now paginated.
 */
export async function searchAllAIMLDevices(): Promise<FDA510kResult[]> {
  const [byCode, byName] = await Promise.all([
    searchAIMLByProductCodes(),
    searchAIMLDevices(),
  ]);

  const seen = new Set(byCode.map((d) => d.k_number));
  const combined = [...byCode];

  for (const d of byName) {
    if (!seen.has(d.k_number)) {
      combined.push(d);
      seen.add(d.k_number);
    }
  }

  console.info(`[fda.ts] searchAllAIMLDevices (deprecated): ${combined.length} total unique devices`);
  return combined;
}
