/**
 * Aletia Index — EUDAMED Scarlet NB Query
 *
 * Queries the public EUDAMED API for all devices certified by Scarlet NB (NB number: 3022),
 * which is Europe's only Notified Body specialised exclusively in Software and AI medical devices.
 * Every result is therefore AI/ML-integral by definition — no false-positive filtering required.
 *
 * EUDAMED API base: https://ec.europa.eu/tools/eudamed/api
 * Scarlet NANDO NB Number: 3022
 * Scarlet MDR designation codes: MDA 0315 (Software), MDS 1010, MDT 2011, MDT 2012
 *
 * Run manually:   npx ts-node scarletEudamedQuery.ts
 * Or hit the API endpoint: POST /api/eudamed-scarlet-sync
 *
 * Coverage note: EUDAMED NB/Certificates module became mandatory 28 May 2026.
 * Before that date, population is voluntary — results will grow materially post-May 2026.
 */

const EUDAMED_BASE = 'https://ec.europa.eu/tools/eudamed/api';
const SCARLET_NB_NUMBER = '3022';
const PAGE_SIZE = 100; // EUDAMED max is 300 but 100 is stable

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EudamedDevice {
  basicUdi: string;
  primaryDi: string;
  uuid: string;
  ulid: string;
  tradeName: string;
  manufacturerName: string;
  manufacturerSrn: string;
  riskClass: { code: string };
  deviceStatusType: { code: string };
}

interface EudamedDeviceDetail {
  deviceName: string;
  deviceCertificateInfoList: Array<{
    certificateNumber: string;
    certificateExpiry: string;
    issueDate: string;
    notifiedBody: {
      name: string;
      srn: string;
    };
    certificateType: { code: string };
    status: { code: string };
  }>;
  riskClass: { code: string };
  medicalPurpose: { texts: Array<{ text: string }> };
  cndNomenclatures: Array<{
    code: string;
    description: { texts: Array<{ text: string }> };
  }>;
  legislation: { code: string };
}

export interface ScarletDevice {
  eudamed_basic_udi: string;
  eudamed_uuid: string;
  device_name: string;
  manufacturer_name: string;
  manufacturer_srn: string;
  risk_class: string;           // e.g. "Class IIa", "Class IIb", "Class III"
  certificate_number: string;
  certificate_expiry: string | null;
  certificate_issued: string | null;
  device_status: string;
  medical_purpose: string | null;
  emdn_code: string | null;
  emdn_description: string | null;
  legislation: string;          // e.g. "EU MDR 2017/745"
  data_source: string;          // always 'eudamed_scarlet_nb'
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseRiskClass(code: string): string {
  const map: Record<string, string> = {
    'refdata.risk-class.class-i':    'Class I',
    'refdata.risk-class.class-iia':  'Class IIa',
    'refdata.risk-class.class-iib':  'Class IIb',
    'refdata.risk-class.class-iii':  'Class III',
  };
  return map[code] ?? code;
}

function parseLegislation(code: string): string {
  const map: Record<string, string> = {
    'refdata.applicable-legislation.mdr':  'EU MDR 2017/745',
    'refdata.applicable-legislation.ivdr': 'EU IVDR 2017/746',
    'refdata.applicable-legislation.mdd':  'EU MDD 93/42/EEC (legacy)',
  };
  return map[code] ?? code;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`EUDAMED API error: ${res.status} ${res.statusText} — ${url}`);
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Step 1: Search devices by NB number
// EUDAMED device search endpoint — filter by notifiedBodyNumber
// ---------------------------------------------------------------------------

async function fetchDevicePageByNB(page: number): Promise<{
  content: EudamedDevice[];
  totalPages: number;
  totalElements: number;
}> {
  // The EUDAMED search API accepts notifiedBodyNumber as a filter parameter.
  // This surfaces devices that have a certificate from the specified NB.
  const url = new URL(`${EUDAMED_BASE}/devices/udiDiData`);
  url.searchParams.set('page',                String(page));
  url.searchParams.set('pageSize',            String(PAGE_SIZE));
  url.searchParams.set('size',                String(PAGE_SIZE));
  url.searchParams.set('iso2Code',            'en');
  url.searchParams.set('languageIso2Code',    'en');
  url.searchParams.set('notifiedBodyNumber',  SCARLET_NB_NUMBER);

  const data = await fetchJson<{
    content: EudamedDevice[];
    totalPages: number;
    totalElements: number;
    first: boolean;
    last: boolean;
  }>(url.toString());

  return {
    content:       data.content,
    totalPages:    data.totalPages,
    totalElements: data.totalElements,
  };
}

// ---------------------------------------------------------------------------
// Step 2: Fetch detailed record for each device (certificate + purpose data)
// ---------------------------------------------------------------------------

async function fetchDeviceDetail(deviceUuid: string): Promise<EudamedDeviceDetail | null> {
  try {
    const url = `${EUDAMED_BASE}/devices/basicUdiData/${deviceUuid}?languageIso2Code=en`;
    return await fetchJson<EudamedDeviceDetail>(url);
  } catch (err) {
    console.warn(`  ⚠ Could not fetch detail for ${deviceUuid}: ${(err as Error).message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main ingestion function
// ---------------------------------------------------------------------------

export async function queryScarletDevices(): Promise<ScarletDevice[]> {
  console.log(`\n🔍 Querying EUDAMED for Scarlet NB (${SCARLET_NB_NUMBER}) certified devices...`);

  // Page 1 — get total count
  const firstPage = await fetchDevicePageByNB(1);
  console.log(`   Total devices found: ${firstPage.totalElements} across ${firstPage.totalPages} pages`);

  const allDevices: EudamedDevice[] = [...firstPage.content];

  // Fetch remaining pages
  for (let p = 2; p <= firstPage.totalPages; p++) {
    console.log(`   Fetching page ${p}/${firstPage.totalPages}...`);
    const page = await fetchDevicePageByNB(p);
    allDevices.push(...page.content);
    // Polite delay — EUDAMED rate limits aggressively
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n📋 Fetching device details (${allDevices.length} devices)...`);

  const results: ScarletDevice[] = [];

  for (const [i, device] of allDevices.entries()) {
    process.stdout.write(`   [${i + 1}/${allDevices.length}] ${device.tradeName ?? device.basicUdi}... `);

    const detail = await fetchDeviceDetail(device.uuid);
    await new Promise(r => setTimeout(r, 300)); // rate limit

    // Find the Scarlet certificate specifically (in case device has multiple NBs)
    const scarletCert = detail?.deviceCertificateInfoList?.find(cert =>
      cert.notifiedBody?.srn?.includes('3022') ||
      cert.notifiedBody?.name?.toLowerCase().includes('scarlet')
    ) ?? detail?.deviceCertificateInfoList?.[0] ?? null;

    const medPurpose = detail?.medicalPurpose?.texts?.[0]?.text ?? null;
    const emdn       = detail?.cndNomenclatures?.[0] ?? null;

    results.push({
      eudamed_basic_udi:   device.basicUdi,
      eudamed_uuid:        device.uuid,
      device_name:         detail?.deviceName ?? device.tradeName ?? 'Unknown',
      manufacturer_name:   device.manufacturerName,
      manufacturer_srn:    device.manufacturerSrn,
      risk_class:          parseRiskClass(device.riskClass?.code ?? ''),
      certificate_number:  scarletCert?.certificateNumber ?? '',
      certificate_expiry:  scarletCert?.certificateExpiry ?? null,
      certificate_issued:  scarletCert?.issueDate ?? null,
      device_status:       device.deviceStatusType?.code ?? '',
      medical_purpose:     medPurpose,
      emdn_code:           emdn?.code ?? null,
      emdn_description:    emdn?.description?.texts?.[0]?.text ?? null,
      legislation:         parseLegislation(detail?.legislation?.code ?? ''),
      data_source:         'eudamed_scarlet_nb',
    });

    console.log(`✓`);
  }

  console.log(`\n✅ Done. ${results.length} Scarlet-certified devices retrieved.\n`);
  return results;
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

export function printSummary(devices: ScarletDevice[]): void {
  const byClass: Record<string, number> = {};
  devices.forEach(d => {
    byClass[d.risk_class] = (byClass[d.risk_class] ?? 0) + 1;
  });

  console.log('=== SCARLET NB EUDAMED QUERY SUMMARY ===');
  console.log(`Total devices: ${devices.length}`);
  console.log('By risk class:');
  Object.entries(byClass).sort().forEach(([cls, count]) => {
    console.log(`  ${cls}: ${count}`);
  });
  console.log('\nDevice list:');
  devices.forEach(d => {
    console.log(`  • ${d.device_name} | ${d.manufacturer_name} | ${d.risk_class} | Cert: ${d.certificate_number}`);
  });
}

// ---------------------------------------------------------------------------
// Standalone execution
// ---------------------------------------------------------------------------

if (require.main === module) {
  queryScarletDevices()
    .then(printSummary)
    .catch(err => {
      console.error('Query failed:', err.message);
      process.exit(1);
    });
}
