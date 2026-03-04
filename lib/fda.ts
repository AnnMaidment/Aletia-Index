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
 */

const FDA_BASE = 'https://api.fda.gov/device';
const API_KEY = process.env.OPENFDA_API_KEY ?? '';

// Aletia Index only covers Class II and III — Class I is out of scope
const ALLOWED_DEVICE_CLASSES = ['2', '3'];

// FDA product codes associated with AI/ML Software as a Medical Device (SaMD)
const AIML_PRODUCT_CODES = [
  'QIH', // Clinical decision support software
  'QBS', // Radiological image analysis
  'MYN', // AI diagnostic software
  'PWE', // Computer-aided detection
  'IYO', // Ophthalmic AI
  'QJO', // Cardiac AI
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

/**
 * A single registration row in REGIONAL_REGISTRATIONS.
 * One device can have multiple rows — one per jurisdiction.
 *
 * Example for a device registered in all three jurisdictions:
 *   { device_link: 'UDI-VIZ-001', country: 'US',  regulatory_body: 'FDA',      clearance_type: '510k' }
 *   { device_link: 'UDI-VIZ-001', country: 'EU',  regulatory_body: 'CE Mark',  clearance_type: 'MDR' }
 *   { device_link: 'UDI-VIZ-001', country: 'ZA',  regulatory_body: 'SAHPRA',   clearance_type: 'Acknowledgement Letter' }
 */
export interface RegionalRegistration {
  device_link: string;
  country: string;
  regulatory_body: RegulatoryBody;
  clearance_type: ClearanceType;
  regulatory_expiry?: string; // ISO date string — triggers RED FLAG alert when near expiry
}

/** Jurisdiction metadata — maps each regulatory body to its country and valid clearance types */
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
  device_class: '2' | '3'; // Class I excluded — out of scope for Aletia
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
      next: { revalidate: 86400 }, // Next.js: cache response for 24 hours
    });
    if (res.status === 404) return []; // No results — not a real error
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

/** Look up a 510(k) clearance by K number, e.g. "K213201" */
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

/** Search 510(k) clearances by device name — returns first match */
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

/** Look up a PMA by PMA number, e.g. "P200001" */
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

/** Get recalls for a device by 510(k) number — more precise than name search */
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

/**
 * Get total count of Medical Device Reports for a device.
 * High MDR counts are a post-market safety signal that influences health_status.
 */
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

/**
 * Get device classification by product code.
 * Returns null for Class I devices — out of scope for Aletia Index.
 */
export async function getClassificationByProductCode(
  productCode: string
): Promise<FDAClassificationResult | null> {
  const results = await fdaFetch<Record<string, string>>('classification', {
    search: `product_code:"${productCode}"`,
    limit: '1',
  });
  if (!results?.length) return null;
  const r = results[0];

  // Reject Class I — Aletia Index only covers Class II and III
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
 * Search FDA 510(k) database for AI/ML Class II and III devices by name keywords.
 * Used to seed the Aletia Index with real devices automatically.
 */
export async function searchAIMLDevices(
  limit = 20
): Promise<FDA510kResult[]> {
  const results = await fdaFetch<Record<string, string>>('510k', {
    search: [
      'device_name:(AI OR "artificial intelligence" OR "machine learning" OR "deep learning")',
      `device_class:(${ALLOWED_DEVICE_CLASSES.join(' OR ')})`,
    ].join(' AND '),
    limit: String(Math.min(limit, 100)),
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
 * Search by known AI/ML FDA product codes — more precise than name search.
 * Catches devices that don't have "AI" in their name but are ML-based.
 */
export async function searchAIMLByProductCodes(
  limit = 20
): Promise<FDA510kResult[]> {
  const results = await fdaFetch<Record<string, string>>('510k', {
    search: [
      `product_code:(${AIML_PRODUCT_CODES.join(' OR ')})`,
      `device_class:(${ALLOWED_DEVICE_CLASSES.join(' OR ')})`,
    ].join(' AND '),
    limit: String(Math.min(limit, 100)),
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