/**
 * lib/eudamed.ts
 * EUDAMED API service layer for Aletia Index
 * Unofficial API docs: https://openregulatory.github.io/eudamed-api/
 *
 * No API key required — this is the same public API that powers the EUDAMED UI.
 * It is not officially documented by the European Commission but is stable in practice.
 *
 * Rate limit: Not published. Be conservative — use 300ms delays in bulk operations.
 *
 * IMPORTANT: EUDAMED registration ≠ CE Mark approval.
 * CE Mark data comes from certificate records inside the basicUdiData endpoint.
 * A device can be in EUDAMED without a CE certificate (common for early registrants).
 *
 * Scope: Software medical devices (SaMD / MDSW) only — mirrors FDA Class II/III filter.
 * Jurisdictions supported: CE Mark (EU) via MDR, IVDR, or legacy MDD.
 */

const EUDAMED_BASE = 'https://ec.europa.eu/tools/eudamed/api';

// ── Result Types ───────────────────────────────────────────────────────────────

/**
 * A single device record from the EUDAMED list/search endpoint.
 * This is the "shallow" record — use getDeviceDetail + getBasicUdiData for full data.
 */
export interface EudamedDeviceListItem {
  uuid: string;                          // Internal EUDAMED UUID — used as device_id
  ulid?: string;
  basicUdiDiDataUlid?: string;           // Required for getBasicUdiData() call
  basicUdi?: string;                     // Human-readable Basic UDI-DI code
  primaryDi?: string;
  tradeName?: string;
  manufacturerName?: string;
  manufacturerSrn?: string;
  riskClass?: { code: string };          // e.g. "refdata.risk-class.class-iia"
  deviceStatusType?: { code: string };   // e.g. "refdata.device-model-status.on-the-market"
  latestVersion?: boolean;
  versionNumber?: number;
  reference?: string;
  authorisedRepresentativeName?: string;
}

/**
 * Detailed device-version data from the udiDiData/{uuid} endpoint.
 * One record per device version (e.g. software v1.0 vs v2.0 are separate records).
 */
export interface EudamedDeviceDetail {
  uuid: string;
  primaryDi?: { code?: string; issuingAgency?: { code: string } };
  tradeName?: { texts: Array<{ language: { isoCode: string }; text: string }> };
  additionalDescription?: string;
  specialDeviceType?: { code: string }; // "refdata.special-mdd-device-type.software" = SaMD
  deviceStatus?: { type: { code: string }; statusDate?: string };
  additionalInformationUrl?: string;
  sterile?: boolean;
  singleUse?: boolean;
  implantable?: boolean;
  latestVersion?: boolean;
  versionNumber?: number;
  versionDate?: string;
}

/**
 * Basic UDI-DI data from the basicUdiData/{ulid} endpoint.
 * Spans all versions of a device family. Contains: risk class, legislation,
 * certificates (CE Mark data), and full manufacturer info.
 * This is the primary source for health_status and regional_registrations.
 */
export interface EudamedBasicUdiData {
  uuid: string;
  riskClass?: { code: string };
  legislation?: {
    code: string;          // "refdata.applicable-legislation.mdr" | "...ivdr" | "...mdd"
    legacyDirective?: boolean;
  };
  specialDeviceType?: { code: string };
  deviceName?: string;
  deviceModel?: string;
  implantable?: boolean;
  manufacturer?: {
    actorDataPublicView?: {
      uuid: string;
      name?: { texts: Array<{ language: { isoCode?: string }; text: string }> };
      actorStatus?: { code: string };
      country?: { name: string; iso2Code: string };
      electronicMail?: string;
      website?: string;
    };
  };
  authorisedRepresentative?: {
    name?: string;
    srn?: string;
    countryName?: string;
  };
  /** CE certificate records — primary source for regulatory_expiry and health_status */
  deviceCertificateInfoList?: Array<{
    uuid: string;
    certificateNumber?: string;
    certificateExpiry?: string;   // ISO date — RED FLAG when near expiry
    issueDate?: string;
    status?: { code: string };    // includes "revoked" / "withdrawn" variants
    notifiedBody?: {
      name?: string;
      srn?: string;
      countryName?: string;
    };
    certificateType?: { code: string };
  }>;
}

export interface EudamedSearchResult {
  content: EudamedDeviceListItem[];
  totalElements: number;
  totalPages: number;
  first: boolean;
  last: boolean;
  number: number;
  size: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Extracts English plain text from a EUDAMED multi-language text array.
 * Falls back to the first available language if English is not present.
 */
export function extractEudamedText(
  texts?: Array<{ language?: { isoCode?: string }; text?: string }>
): string | undefined {
  if (!texts?.length) return undefined;
  const en = texts.find((t) => t.language?.isoCode === 'en');
  return (en ?? texts[0]).text ?? undefined;
}

/**
 * Returns true if this is a software medical device (SaMD / MDSW).
 * Aletia only indexes software devices — mirrors the FDA Class II/III filter.
 */
export function isSoftwareDevice(
  data: EudamedDeviceDetail | EudamedBasicUdiData
): boolean {
  return (
    data.specialDeviceType?.code === 'refdata.special-mdd-device-type.software'
  );
}

/**
 * Maps a EUDAMED legislation code to our clearance_type enum value.
 * MDR is the default for unknown or missing codes.
 */
export function mapLegislationToClearanceType(
  legislation?: EudamedBasicUdiData['legislation']
): 'MDR' | 'IVDR' | 'MDD' {
  if (!legislation?.code) return 'MDR';
  if (legislation.code.includes('ivdr')) return 'IVDR';
  if (legislation.code.includes('mdd') || legislation.legacyDirective) return 'MDD';
  return 'MDR';
}

// ── Internal Fetch Helper ──────────────────────────────────────────────────────

async function eudamedFetch<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 86400 }, // Cache for 24 hours — mirrors fda.ts
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      console.error(`[eudamed.ts] HTTP ${res.status} → ${url}`);
      return null;
    }
    return res.json() as Promise<T>;
  } catch (err) {
    console.error(`[eudamed.ts] Network error → ${url}:`, err);
    return null;
  }
}

// ── Device Search ──────────────────────────────────────────────────────────────

/**
 * Search EUDAMED devices by trade name (or leave empty to page all devices).
 * Results are in the `content` key. Pagination is 1-based.
 *
 * Note: There is no native "software only" filter in EUDAMED.
 * Use isSoftwareDevice() after fetching basicUdiData to filter client-side.
 */
export async function searchEudamedDevices(
  tradeName: string = '',
  page: number = 1,
  pageSize: number = 100
): Promise<EudamedSearchResult | null> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    size: String(pageSize),
    iso2Code: 'en',
    languageIso2Code: 'en',
    ...(tradeName ? { tradeName } : {}),
  });

  return eudamedFetch<EudamedSearchResult>(
    `${EUDAMED_BASE}/devices/udiDiData?${params.toString()}`
  );
}

// ── Device Detail (two required calls per device) ─────────────────────────────

/**
 * Fetch device-version detail by EUDAMED UUID.
 * First of two calls needed for a complete device record.
 * Contains: trade name, device status, software type flag, version info.
 *
 * @param deviceUuid   The `uuid` field from a search result
 */
export async function getDeviceDetail(
  deviceUuid: string
): Promise<EudamedDeviceDetail | null> {
  return eudamedFetch<EudamedDeviceDetail>(
    `${EUDAMED_BASE}/devices/udiDiData/${deviceUuid}?languageIso2Code=en`
  );
}

/**
 * Fetch Basic UDI-DI data for a device family.
 * Second of two calls needed for a complete device record.
 * Contains: risk class, legislation (MDR/IVDR/MDD), CE certificates, manufacturer.
 *
 * @param basicUdiDiUlid   The `basicUdiDiDataUlid` field from a search result
 */
export async function getBasicUdiData(
  basicUdiDiUlid: string
): Promise<EudamedBasicUdiData | null> {
  return eudamedFetch<EudamedBasicUdiData>(
    `${EUDAMED_BASE}/devices/basicUdiData/${basicUdiDiUlid}?languageIso2Code=en`
  );
}

/**
 * Fetch a device by its Basic UDI-DI code (the identifier on EU device labels).
 * Returns the first matching list item, or null if not found.
 *
 * @param basicUdiCode   Basic UDI-DI code, e.g. "7613336026793"
 */
export async function getDeviceByBasicUdi(
  basicUdiCode: string
): Promise<EudamedDeviceListItem | null> {
  const params = new URLSearchParams({
    page: '1',
    pageSize: '10',
    size: '10',
    iso2Code: 'en',
    languageIso2Code: 'en',
    basicUdi: basicUdiCode,
  });

  const result = await eudamedFetch<EudamedSearchResult>(
    `${EUDAMED_BASE}/devices/udiDiData?${params.toString()}`
  );

  return result?.content[0] ?? null;
}

/**
 * Convenience: get the total count of devices registered in EUDAMED.
 * Useful for monitoring data completeness over time.
 */
export async function getEudamedDeviceCount(): Promise<number | null> {
  const result = await searchEudamedDevices('', 1, 1);
  return result?.totalElements ?? null;
}
