/**
 * lib/mhra.ts
 * MHRA PARD (Public Access Registration Database) API service layer
 * Docs: https://pard.mhra.gov.uk/
 *
 * No API key required — public API, no auth.
 * Endpoints are POST with JSON body { searchTerm: string }.
 * searchTerm must be EXACT LOWERCASE GMDN term name (case-sensitive).
 *
 * Two endpoints:
 *   POST /searchDevices      → devices by GMDN term
 *   POST /searchManufacturers → manufacturers by name
 *
 * Scope: AI/ML SaMD devices registered in Great Britain (UK MDR 2002).
 * Class I devices are included (unlike FDA scope) as MHRA Class I SaMD
 * can still be clinically significant.
 */

const PARD_BASE = 'https://pard.mhra.gov.uk';

// ── GMDN Terms for AI/ML SaMD ─────────────────────────────────────────────────
//
// Curated from PARD device-type search for "software" (414 results, March 2026).
// These are the exact lowercase GMDN term strings the API accepts.
// The API is case-sensitive and does exact string matching only.
//
// Categories covered:
//   - Diagnostic imaging software (radiology, ophthalmology, pathology)
//   - Clinical decision support software
//   - Image analysis software
//   - Physiological signal analysis software
//   - Risk assessment / predictive software

export const MHRA_AIML_GMDN_TERMS = [
  // ── Imaging analysis ──────────────────────────────────────────────────────
  'retinal image analysis software',
  'ophthalmic image analysis software',
  'histology/cytology/microbiology image-analysis interpretive software ivd',
  'wound management image-analysis software',
  'radiology dicom image processing application software',
  'mri image interpretive software',
  'basic diagnostic x-ray system application software',
  'diagnostic x-ray digital imaging system workstation application software',
  'ct system application software',
  'mri system application software',
  'ultrasound imaging system application software',
  'ophthalmology pacs software',
  'vision corrective spectacles centration image analysis software',

  // ── Clinical decision support ─────────────────────────────────────────────
  'electrocardiographic long-term ambulatory recording analyser application software',
  'bioelectrical signal analysis software',
  'pulmonary function analysis software, interpretive',
  'pulmonary function analysis software, non-interpretive',
  'electroencephalographic diagnosis-support software',
  'electrophysiological marker psychiatric analysis interpretive software',
  'osteoporosis/fracture risk assessment interpretive software',
  'transplanted kidney survival predictive software',
  'congenital defect/syndrome risk assessment interpretive software ivd',
  'human infectome analysis interpretive software ivd',
  'semen specimen degradation prediction software ivd',

  // ── Specialty clinical software ───────────────────────────────────────────
  'cardiology information system application software',
  'pathology information system application software',
  'radiology information system application software',
  'radiology workstation display quality assurance software',
  'biomechanical function analysis/rehabilitation software',
  'assisted reproduction embryo-assessment software',
  'assisted reproduction sperm-assessment software',
  'assisted reproduction specimen management system software',
  'mental health/function therapeutic software, screen-viewed',
  'mental health/function therapeutic software, virtual reality',
  'cochlear implant intraoperative electrophysiological analysis software',
  'insulin-injection patient guidance software',
] as const;

export type MhraGmdnTerm = (typeof MHRA_AIML_GMDN_TERMS)[number];

// ── Types ──────────────────────────────────────────────────────────────────────

export interface MhraDevice {
  DEVICE_ID: number;
  MAN_ORGANISATION_ID: number;
  GMDN_CODE: number;
  GMDN_TERM_NAME: string;
  DEVICE_SUB_TYPE_DESC: string;   // "Class I" | "Class IIa" | "Class IIb" | "Class III" | "Custom-made" etc.
  IS_CUSTOM_MADE: string;         // "Yes" | "No"
  IS_PERFORMANCE_STUDIES: string | null;
  DEVICE_REG_STATUS_CODE: string; // "DREGIY" = active registration
  DEVICE_TYPE_NAME: string;       // "General Medical Device" | "IVD" etc.
  LAST_UPDATED_DATE: string;      // ISO date string
}

export interface MhraManufacturer {
  MAN_ORGANISATION_ID: number;
  MAN_ORGANISATION_NAME: string;
  MAN_ADDR_LINE_1: string;
  MAN_CITY: string;
  MAN_COUNTRY: string;
  MAN_POSTCODE: string;
  REP_NAME: string;               // UK Responsible Person name
  REP_COUNTRY: string;
  RELATIONSHIP: string;           // "UK Responsible Person" | ""
  IS_CURRENT: string;             // "1" = active
  FROM_DATE: string;
  TO_DATE: string;                // "9999-12-31" = still active
  LAST_UPDATED_DATE: string;
}

// ── Internal POST Helper ───────────────────────────────────────────────────────

async function pardPost<T>(
  endpoint: string,
  searchTerm: string
): Promise<T[] | null> {
  const url = `${PARD_BASE}/${endpoint}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ searchTerm }),
      next: { revalidate: 86400 }, // Cache 24 hours
    });

    if (!res.ok) {
      console.error(`[mhra.ts] HTTP ${res.status} → ${url} (term: "${searchTerm}")`);
      return null;
    }

    const json = await res.json();

    // PARD returns either an array directly or an empty array
    if (!Array.isArray(json)) return [];
    return json as T[];
  } catch (err) {
    console.error(`[mhra.ts] Network error → ${url}:`, err);
    return null;
  }
}

// ── Device Search ──────────────────────────────────────────────────────────────

/**
 * Search PARD for devices by exact lowercase GMDN term.
 * Returns all registered devices of that type across all manufacturers.
 */
export async function searchMhraDevicesByGmdn(
  gmdnTerm: string
): Promise<MhraDevice[] | null> {
  const results = await pardPost<MhraDevice>('searchDevices', gmdnTerm.toLowerCase());
  if (!results) return null;

  // Filter to active registrations only (status DREGIY = registered)
  // and exclude custom-made devices (not commercial products)
  return results.filter(
    (d) =>
      d.DEVICE_REG_STATUS_CODE === 'DREGIY' &&
      d.IS_CUSTOM_MADE === 'No'
  );
}

/**
 * Fetch all AI/ML SaMD devices across all curated GMDN terms.
 * Used for bulk seeding. Returns flat array of all devices found.
 */
export async function searchAllMhraAIMLDevices(): Promise<MhraDevice[]> {
  const all: MhraDevice[] = [];

  for (const term of MHRA_AIML_GMDN_TERMS) {
    const devices = await searchMhraDevicesByGmdn(term);
    if (devices?.length) {
      all.push(...devices);
    }
    // Be polite to the PARD server — 300ms between calls
    await new Promise((r) => setTimeout(r, 300));
  }

  // Deduplicate by DEVICE_ID (same device can appear under multiple GMDN terms)
  const seen = new Set<number>();
  return all.filter((d) => {
    if (seen.has(d.DEVICE_ID)) return false;
    seen.add(d.DEVICE_ID);
    return true;
  });
}

// ── Manufacturer Search ────────────────────────────────────────────────────────

/**
 * Look up a manufacturer by name fragment.
 * Returns all matching active manufacturers.
 */
export async function searchMhraManufacturer(
  name: string
): Promise<MhraManufacturer[] | null> {
  const results = await pardPost<MhraManufacturer>('searchManufacturers', name);
  if (!results) return null;

  // Filter to currently active manufacturers only
  return results.filter((m) => m.IS_CURRENT === '1');
}

/**
 * Get a single manufacturer by organisation ID.
 * Fetches by searching the organisation name then filtering by ID.
 * PARD has no direct lookup-by-ID endpoint.
 */
export async function getMhraManufacturerById(
  organisationId: number,
  nameHint: string
): Promise<MhraManufacturer | null> {
  const results = await searchMhraManufacturer(nameHint);
  if (!results) return null;
  return results.find((m) => m.MAN_ORGANISATION_ID === organisationId) ?? null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Map MHRA device classification to a standardised risk class string.
 * MHRA uses MDR class names (I, IIa, IIb, III) and IVDR (A, B, C, D).
 */
export function mapMhraClassification(deviceSubType: string): string {
  const s = deviceSubType.toLowerCase();
  if (s.includes('class iii') || s.includes('class d')) return 'Class III';
  if (s.includes('class iib') || s.includes('class c')) return 'Class IIb';
  if (s.includes('class iia') || s.includes('class b')) return 'Class IIa';
  if (s.includes('class i') || s.includes('class a')) return 'Class I';
  return deviceSubType; // Return as-is if unrecognised
}

/**
 * Derive health_status from MHRA registration data.
 * PARD shows DREGIY for active registrations.
 * LAST_UPDATED_DATE is used as a proxy for registration freshness.
 *
 * Logic:
 *   Green  — active registration, updated within last 2 years
 *   Amber  — active registration, not updated in 2+ years (may be stale)
 *   Red    — status is not DREGIY (lapsed, suspended, expired)
 */
export function deriveMhraHealthStatus(
  device: MhraDevice
): 'Green' | 'Amber' | 'Red' {
  if (device.DEVICE_REG_STATUS_CODE !== 'DREGIY') return 'Red';

  const lastUpdated = new Date(device.LAST_UPDATED_DATE);
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

  if (lastUpdated < twoYearsAgo) return 'Amber';
  return 'Green';
}

/**
 * Check if a manufacturer registration is currently active.
 * TO_DATE of "9999-12-31" means no expiry set — still active.
 */
export function isMhraManufacturerActive(manufacturer: MhraManufacturer): boolean {
  if (manufacturer.IS_CURRENT !== '1') return false;
  const toDate = new Date(manufacturer.TO_DATE);
  const farFuture = new Date('9000-01-01');
  return toDate > farFuture;
}
