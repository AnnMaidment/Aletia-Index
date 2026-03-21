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
 * Product codes last updated: March 2026
 * Source: https://www.fda.gov/medical-devices/software-medical-device-samd/artificial-intelligence-and-machine-learning-aiml-enabled-medical-devices
 */

const FDA_BASE = 'https://api.fda.gov/device';
const API_KEY = process.env.OPENFDA_API_KEY ?? '';

// Aletia Index only covers Class II and III — Class I is out of scope
const ALLOWED_DEVICE_CLASSES = ['2', '3'];

/**
 * Complete list of FDA product codes associated with AI/ML medical devices.
 * Derived from the FDA's official AI-Enabled Medical Devices list (March 2026).
 * This replaces the original 6-code list which missed devices like K251293 (QUO).
 *
 * Grouped by clinical area for maintainability.
 * Update this list quarterly when FDA publishes new authorisations.
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
  'QKB', // Segmentation / auto-contour (RT planning)

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

// ── Internal Fetch Helper ──────────────────────────────────────────────────────

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
    if (res.status === 404) return [];
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

// ── Bulk AI/ML Device Search ───────────────────────────────────────────────────

/**
 * PRIMARY SEED STRATEGY: Search by product codes.
 *
 * This is the most reliable method. It catches devices regardless of how
 * the manufacturer names them — "CardioVision" is caught by QUO just as
 * "AI Chest Analysis" is caught by QFM.
 *
 * The FDA API accepts a max of ~100 characters in a search query, so we
 * batch the codes into groups of 15 and merge the results.
 */
export async function searchAIMLByProductCodes(): Promise<FDA510kResult[]> {
  const BATCH_SIZE = 15;
  const uniqueCodes = [...new Set(AIML_PRODUCT_CODES)]; // deduplicate
  const batches: string[][] = [];

  for (let i = 0; i < uniqueCodes.length; i += BATCH_SIZE) {
    batches.push(uniqueCodes.slice(i, i + BATCH_SIZE));
  }

  const allResults: FDA510kResult[] = [];
  const seen = new Set<string>();

  for (const batch of batches) {
    // Respect FDA rate limit between batches
    await new Promise(r => setTimeout(r, 300));

    const results = await fdaFetch<Record<string, string>>('510k', {
      search: `product_code:(${batch.join(' OR ')})`,
      limit: '1000',
    });

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

  console.info(`[fda.ts] searchAIMLByProductCodes: ${allResults.length} devices found across ${batches.length} batches`);
  return allResults;
}

/**
 * SUPPLEMENTARY SEED STRATEGY: Search by AI keywords in device name.
 *
 * Catches devices that have "AI" or "artificial intelligence" explicitly
 * in their name but use a product code not in our list.
 * Run this after searchAIMLByProductCodes and merge results.
 */
export async function searchAIMLDevices(): Promise<FDA510kResult[]> {
  const results = await fdaFetch<Record<string, string>>('510k', {
    search: 'device_name:(AI OR "artificial intelligence" OR "machine learning" OR "deep learning" OR "neural network")',
    limit: '1000',
  });
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

/**
 * COMBINED SEED: Run both strategies and deduplicate by K number.
 * Use this for full reseeds. The product code search is primary;
 * the name search catches any stragglers.
 */
export async function searchAllAIMLDevices(): Promise<FDA510kResult[]> {
  const [byCode, byName] = await Promise.all([
    searchAIMLByProductCodes(),
    searchAIMLDevices(),
  ]);

  const seen = new Set(byCode.map(d => d.k_number));
  const combined = [...byCode];

  for (const d of byName) {
    if (!seen.has(d.k_number)) {
      combined.push(d);
      seen.add(d.k_number);
    }
  }

  console.info(`[fda.ts] searchAllAIMLDevices: ${combined.length} total unique devices`);
  return combined;
}
