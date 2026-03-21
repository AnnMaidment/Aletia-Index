/**
 * lib/fdaSync.ts
 * "The translator" — maps FDA data onto your Supabase schema
 * and writes updates to DEVICE_MASTER + REGIONAL_REGISTRATIONS
 */

import { supabase } from './supabase';
import {
  get510kByKNumber,
  getPMAByNumber,
  getRecallsByKNumber,
  getAdverseEventCount,
  getClassificationByProductCode,
} from './fda';

export interface SyncResult {
  device_id: string;
  success: boolean;
  updated_fields: string[];
  recall_alert: boolean;
  error?: string;
}

/**
 * Derive health_status from FDA signals.
 * Red   = active recall present
 * Amber = elevated adverse event count (>50 MDRs)
 * Green = no signals
 */
function deriveHealthStatus(
  hasActiveRecall: boolean,
  adverseEventCount: number
): 'Green' | 'Amber' | 'Red' {
  if (hasActiveRecall) return 'Red';
  if (adverseEventCount > 50) return 'Amber';
  return 'Green';
}

/**
 * Sync a single device from the FDA.
 * Pass the Aletia device_id plus either a k_number or pma_number.
 *
 * FIX: Changed .update() to .upsert() so that devices not yet in the
 * database are inserted rather than silently ignored.
 * Also ensures intended_use and all required fields are set on first insert.
 */
export async function syncDeviceFromFDA(
  deviceId: string,
  options: { k_number?: string; pma_number?: string }
): Promise<SyncResult> {
  const updatedFields: string[] = [];

  try {
    // ── 1. Fetch regulatory clearance ───────────────────────────────────
    let clearanceData = null;
    let productCode = '';

    if (options.k_number) {
      clearanceData = await get510kByKNumber(options.k_number);
      if (clearanceData) productCode = clearanceData.product_code;
    } else if (options.pma_number) {
      clearanceData = await getPMAByNumber(options.pma_number);
      if (clearanceData) productCode = clearanceData.product_code;
    }

    // ── 2. Check classification — reject Class I ────────────────────────
    const classification = productCode
      ? await getClassificationByProductCode(productCode)
      : null;

    // getClassificationByProductCode returns null for Class I devices.
    // If we have a product code but no classification, it's Class I — skip.
    if (productCode && !classification) {
      return {
        device_id: deviceId,
        success: false,
        updated_fields: [],
        recall_alert: false,
        error: 'Device is Class I — out of scope for Aletia Index',
      };
    }

    // ── 3. Fetch recalls ────────────────────────────────────────────────
    const recalls = options.k_number
      ? await getRecallsByKNumber(options.k_number)
      : [];

    const hasActiveRecall = recalls.some(
      (r) => r.status?.toLowerCase() === 'ongoing'
    );

    // ── 4. Fetch adverse events ─────────────────────────────────────────
    const deviceName = clearanceData?.device_name ?? deviceId;
    const { total_events } = await getAdverseEventCount(deviceName);

    // ── 5. Derive health_status ─────────────────────────────────────────
    const health_status = deriveHealthStatus(hasActiveRecall, total_events);

    // ── 6. Upsert DEVICE_MASTER ─────────────────────────────────────────
    // Previously .update() — silently did nothing when device didn't exist.
    // Now .upsert() — inserts on first sync, updates on subsequent syncs.
    const deviceUpsert: Record<string, unknown> = {
      device_id: deviceId,             // required for upsert conflict resolution
      health_status,
      last_automated_sync: new Date().toISOString(),
      data_source: 'registry_sync',
      excluded: false,
    };

    // Populate fields from FDA data — used both on insert and update
    if (clearanceData?.applicant) {
      deviceUpsert.manufacturer_name = clearanceData.applicant;
      updatedFields.push('manufacturer_name');
    }

    if (clearanceData?.device_name) {
      deviceUpsert.intended_use = clearanceData.device_name;
      updatedFields.push('intended_use');
    }

    if (clearanceData?.decision_date) {
      deviceUpsert.country_of_origin = 'US';
    }

    if (classification?.device_class) {
      const tierMap: Record<string, number> = { '2': 2, '3': 4 };
      deviceUpsert.accountability_tier = tierMap[classification.device_class] ?? 2;
      updatedFields.push('accountability_tier');
    }

    updatedFields.push('health_status', 'last_automated_sync');

    const { error: deviceError } = await supabase
      .from('device_master')
      .upsert(deviceUpsert, { onConflict: 'device_id' });

    if (deviceError) {
      throw new Error(`device_master upsert failed: ${deviceError.message}`);
    }

    // ── 7. Upsert REGIONAL_REGISTRATIONS ────────────────────────────────
    if (clearanceData) {
      const regRecord = {
        device_link: deviceId,
        country: 'US',
        regulatory_body: 'FDA',
        clearance_type: clearanceData.clearance_type,
      };

      const { error: regError } = await supabase
        .from('regional_registrations')
        .upsert(regRecord, {
          onConflict: 'device_link,country,regulatory_body',
        });

      if (regError) {
        console.warn(
          `[fdaSync] regional_registrations upsert warning: ${regError.message}`
        );
      } else {
        updatedFields.push('regional_registrations');
      }
    }

    return {
      device_id: deviceId,
      success: true,
      updated_fields: updatedFields,
      recall_alert: hasActiveRecall,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[fdaSync] syncDeviceFromFDA failed for ${deviceId}:`,
      message
    );
    return {
      device_id: deviceId,
      success: false,
      updated_fields: [],
      recall_alert: false,
      error: message,
    };
  }
}

/**
 * Bulk sync — iterates over all FDA-registered devices in REGIONAL_REGISTRATIONS.
 * Intended to be called on a schedule (e.g. nightly via Vercel Cron).
 */
export async function bulkSyncAllDevices(): Promise<SyncResult[]> {
  const { data: registrations, error } = await supabase
    .from('regional_registrations')
    .select('device_link, clearance_type')
    .eq('regulatory_body', 'FDA');

  if (error || !registrations) {
    console.error(
      '[fdaSync] Could not fetch registrations for bulk sync:',
      error?.message
    );
    return [];
  }

  const results: SyncResult[] = [];

  for (const reg of registrations) {
    // 300ms delay between calls to respect FDA rate limits
    await new Promise((resolve) => setTimeout(resolve, 300));

    const result = await syncDeviceFromFDA(reg.device_link, {
      k_number:   reg.clearance_type === '510k' ? reg.device_link : undefined,
      pma_number: reg.clearance_type === 'PMA'  ? reg.device_link : undefined,
    });
    results.push(result);
  }

  return results;
}
