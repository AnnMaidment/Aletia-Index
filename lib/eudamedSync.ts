Invoke-RestMethod -Uri "http://localhost:3000/api/fda-sync?source=mhra" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"device_id": "MHRA-169275", "gmdn_term": "retinal image analysis software"}'/**
 * lib/eudamedSync.ts
 * "The translator" — maps EUDAMED data onto the Aletia Supabase schema
 * and writes updates to DEVICE_MASTER + REGIONAL_REGISTRATIONS
 *
 * Mirrors the structure and patterns of lib/fdaSync.ts exactly.
 *
 * Key differences from FDA sync:
 * - EUDAMED device_id is a UUID (not a K-number)
 * - A full device record requires TWO API calls: udiDiData + basicUdiData
 * - Health status is derived from certificate expiry, not recalls/MDRs
 * - No equivalent to FDA adverse event count — certificates cover post-market signal
 * - Software filter (isSoftwareDevice) replaces FDA Class I rejection
 */

import { supabase } from './supabase';
import {
  getDeviceDetail,
  getBasicUdiData,
  searchEudamedDevices,
  isSoftwareDevice,
  mapLegislationToClearanceType,
  extractEudamedText,
} from './eudamed';

export interface EudamedSyncResult {
  device_id: string;
  success: boolean;
  updated_fields: string[];
  cert_expiry_alert: boolean; // Mirrors recall_alert in SyncResult
  error?: string;
}

// ── Health Status Logic ────────────────────────────────────────────────────────

/**
 * Derive health_status from EUDAMED certificate signals.
 * Mirrors deriveHealthStatus() in fdaSync.ts.
 *
 * Red   = any certificate expired or revoked/withdrawn
 * Amber = any certificate expires within 90 days
 * Green = no signals
 */
function deriveHealthStatus(
  certs: NonNullable<
    NonNullable<
      import('./eudamed').EudamedBasicUdiData['deviceCertificateInfoList']
    >
  >
): 'Green' | 'Amber' | 'Red' {
  if (!certs.length) return 'Green';

  const now = new Date();
  const ninetyDaysOut = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  for (const cert of certs) {
    const statusCode = cert.status?.code ?? '';
    if (statusCode.includes('revoked') || statusCode.includes('withdrawn')) {
      return 'Red';
    }
    if (cert.certificateExpiry) {
      const expiry = new Date(cert.certificateExpiry);
      if (expiry < now) return 'Red';
      if (expiry < ninetyDaysOut) return 'Amber';
    }
  }

  return 'Green';
}

// ── Single Device Sync ─────────────────────────────────────────────────────────

/**
 * Sync a single device from EUDAMED.
 * Requires the uuid (from search results) and basicUdiDiDataUlid (also from search results).
 * Updates DEVICE_MASTER and REGIONAL_REGISTRATIONS, stamps last_automated_sync.
 *
 * Mirrors syncDeviceFromFDA() in fdaSync.ts.
 */
export async function syncDeviceFromEUDAMED(
  deviceUuid: string,
  basicUdiUlid: string
): Promise<EudamedSyncResult> {
  const updatedFields: string[] = [];

  try {
    // ── 1. Fetch both endpoints in parallel ──────────────────────────────
    const [detail, basicUdi] = await Promise.all([
      getDeviceDetail(deviceUuid),
      getBasicUdiData(basicUdiUlid),
    ]);

    if (!detail || !basicUdi) {
      return {
        device_id: deviceUuid,
        success: false,
        updated_fields: [],
        cert_expiry_alert: false,
        error: 'Failed to fetch device data from EUDAMED',
      };
    }

    // ── 2. Software filter — mirrors Class I rejection in fdaSync.ts ─────
    if (!isSoftwareDevice(detail) && !isSoftwareDevice(basicUdi)) {
      return {
        device_id: deviceUuid,
        success: false,
        updated_fields: [],
        cert_expiry_alert: false,
        error: 'Device is not a software medical device — out of scope for Aletia Index',
      };
    }

    // ── 3. Derive health_status from certificates ────────────────────────
    const certs = basicUdi.deviceCertificateInfoList ?? [];
    const health_status = deriveHealthStatus(certs);
    const certExpiryAlert = health_status !== 'Green';

    // Soonest expiry date — stored as regulatory_expiry in REGIONAL_REGISTRATIONS
    const soonestExpiry = certs
      .map((c) => c.certificateExpiry)
      .filter(Boolean)
      .sort()[0] ?? null;

    // ── 4. Update DEVICE_MASTER ──────────────────────────────────────────
    const deviceUpdate: Record<string, unknown> = {
      last_automated_sync: new Date().toISOString(),
      health_status,
    };

    updatedFields.push('health_status', 'last_automated_sync');

    const { error: deviceError } = await supabase
      .from('device_master')
      .update(deviceUpdate)
      .eq('device_id', deviceUuid);

    if (deviceError) {
      throw new Error(`device_master update failed: ${deviceError.message}`);
    }

    // ── 5. Upsert REGIONAL_REGISTRATIONS ────────────────────────────────
    const clearanceType = mapLegislationToClearanceType(basicUdi.legislation);

    const regRecord = {
      device_link: deviceUuid,
      country: 'EU',
      regulatory_body: 'CE Mark',
      clearance_type: clearanceType,
      regulatory_expiry: soonestExpiry,
    };

    const { error: regError } = await supabase
      .from('regional_registrations')
      .upsert(regRecord, {
        onConflict: 'device_link,country,regulatory_body',
      });

    if (regError) {
      console.warn(
        `[eudamedSync] regional_registrations upsert warning: ${regError.message}`
      );
    } else {
      updatedFields.push('regional_registrations');
    }

    return {
      device_id: deviceUuid,
      success: true,
      updated_fields: updatedFields,
      cert_expiry_alert: certExpiryAlert,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[eudamedSync] syncDeviceFromEUDAMED failed for ${deviceUuid}:`,
      message
    );
    return {
      device_id: deviceUuid,
      success: false,
      updated_fields: [],
      cert_expiry_alert: false,
      error: message,
    };
  }
}

// ── Bulk Sync ──────────────────────────────────────────────────────────────────

/**
 * Bulk sync — iterates over all CE Mark-registered devices in REGIONAL_REGISTRATIONS.
 * Intended to be called on a schedule (e.g. nightly via Vercel Cron).
 * Mirrors bulkSyncAllDevices() in fdaSync.ts.
 */
export async function bulkSyncAllEudamedDevices(): Promise<EudamedSyncResult[]> {
  const { data: registrations, error } = await supabase
    .from('regional_registrations')
    .select('device_link')
    .eq('regulatory_body', 'CE Mark');

  if (error || !registrations) {
    console.error(
      '[eudamedSync] Could not fetch registrations for bulk sync:',
      error?.message
    );
    return [];
  }

  const results: EudamedSyncResult[] = [];

  for (const reg of registrations) {
    // 300ms delay between calls — mirrors fda.ts rate limit pattern
    await new Promise((resolve) => setTimeout(resolve, 300));

    // For existing records we have device_link (= uuid) but need basicUdiDiDataUlid.
    // We re-fetch from EUDAMED search using the uuid to get the ulid.
    // This is an extra call per device but unavoidable without storing the ulid at seed time.
    // TODO: Store basicUdiDiDataUlid in device_master at seed time to avoid this lookup.
    const searchResult = await searchEudamedDevices('', 1, 1);
    const listItem = searchResult?.content.find(
      (d) => d.uuid === reg.device_link
    );

    if (!listItem?.basicUdiDiDataUlid) {
      results.push({
        device_id: reg.device_link,
        success: false,
        updated_fields: [],
        cert_expiry_alert: false,
        error: 'Could not resolve basicUdiDiDataUlid for bulk sync — re-seed recommended',
      });
      continue;
    }

    const result = await syncDeviceFromEUDAMED(
      reg.device_link,
      listItem.basicUdiDiDataUlid
    );
    results.push(result);
  }

  return results;
}
