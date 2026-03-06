/**
 * lib/mhraSync.ts
 * MHRA PARD data sync layer for Aletia Index
 *
 * Mirrors the pattern of fdaSync.ts exactly:
 *   - syncDeviceFromMHRA()     — sync a single device by DEVICE_ID + MAN_ORGANISATION_ID
 *   - bulkSyncAllMhraDevices() — sync all UK-registered devices in device_master
 *   - SyncResult interface     — consistent with FDA sync result shape
 *
 * Health status logic (derived from PARD registration data):
 *   Green — active registration (DREGIY), updated within 2 years
 *   Amber — active registration, not updated in 2+ years (stale)
 *   Red   — registration lapsed, suspended, or expired
 */

import { createClient } from '@supabase/supabase-js';
import {
  searchMhraDevicesByGmdn,
  searchMhraManufacturer,
  deriveMhraHealthStatus,
  mapMhraClassification,
  type MhraDevice,
  type MhraManufacturer,
} from '@/lib/mhra';

// ── Supabase client ────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ── Result Types ───────────────────────────────────────────────────────────────

export interface MhraSyncResult {
  device_id: string;           // PARD DEVICE_ID as string
  manufacturer_name: string;
  gmdn_term: string;
  success: boolean;
  health_status?: 'Green' | 'Amber' | 'Red';
  risk_class?: string;
  stale_registration_alert: boolean; // true if not updated in 2+ years
  error?: string;
}

// ── Single Device Sync ─────────────────────────────────────────────────────────

/**
 * Sync a single MHRA device into Aletia's device_master and regional_registrations.
 * Called from POST /api/fda-sync?source=mhra
 *
 * Requires both the PARD device record and manufacturer organisation name
 * to resolve the full record.
 */
export async function syncDeviceFromMHRA(
  device: MhraDevice,
  manufacturer: MhraManufacturer | null
): Promise<MhraSyncResult> {
  const deviceId = `MHRA-${device.DEVICE_ID}`;
  const manufacturerName = manufacturer?.MAN_ORGANISATION_NAME ?? `MHRA Manufacturer ${device.MAN_ORGANISATION_ID}`;

  try {
    const healthStatus = deriveMhraHealthStatus(device);
    const riskClass = mapMhraClassification(device.DEVICE_SUB_TYPE_DESC);
    const staleAlert = healthStatus === 'Amber';

    // ── Upsert device_master ─────────────────────────────────────────────────
    const { error: deviceError } = await supabase
      .from('device_master')
      .upsert(
        {
          device_id: deviceId,
          intended_use: device.GMDN_TERM_NAME,
          manufacturer_name: manufacturerName,
          health_status: healthStatus,
          aletia_verified: false,
          last_automated_sync: new Date().toISOString(),
          country_of_origin: manufacturer?.MAN_COUNTRY ?? 'UK',
        },
        { onConflict: 'device_id' }
      );

    if (deviceError) throw new Error(deviceError.message);

    // ── Upsert regional_registrations ────────────────────────────────────────
    const { error: regError } = await supabase
      .from('regional_registrations')
      .upsert(
        {
          device_link: deviceId,
          country: 'GB',
          regulatory_body: 'MHRA',
          clearance_type: 'UKCA',
          device_class: riskClass,
          gmdn_code: String(device.GMDN_CODE),
          gmdn_term: device.GMDN_TERM_NAME,
          last_updated: device.LAST_UPDATED_DATE,
        },
        { onConflict: 'device_link,country,regulatory_body' }
      );

    if (regError) throw new Error(regError.message);

    return {
      device_id: deviceId,
      manufacturer_name: manufacturerName,
      gmdn_term: device.GMDN_TERM_NAME,
      success: true,
      health_status: healthStatus,
      risk_class: riskClass,
      stale_registration_alert: staleAlert,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[mhraSync.ts] Failed to sync MHRA device ${deviceId}:`, error);
    return {
      device_id: deviceId,
      manufacturer_name: manufacturerName,
      gmdn_term: device.GMDN_TERM_NAME,
      success: false,
      stale_registration_alert: false,
      error,
    };
  }
}

// ── Bulk Sync ──────────────────────────────────────────────────────────────────

/**
 * Sync all MHRA-registered devices already in device_master.
 * Queries regional_registrations for MHRA records, then re-fetches
 * from PARD to update health_status and registration details.
 * Called from GET /api/fda-sync?bulk=true&source=mhra
 */
export async function bulkSyncAllMhraDevices(): Promise<MhraSyncResult[]> {
  // Get all devices with an MHRA registration
  const { data: registrations, error } = await supabase
    .from('regional_registrations')
    .select('device_link, gmdn_term')
    .eq('regulatory_body', 'MHRA');

  if (error) {
    console.error('[mhraSync.ts] Failed to fetch MHRA registrations:', error.message);
    return [];
  }

  if (!registrations?.length) {
    console.info('[mhraSync.ts] No MHRA devices found for bulk sync');
    return [];
  }

  const results: MhraSyncResult[] = [];

  for (const reg of registrations) {
    // Re-fetch device from PARD using stored GMDN term
    if (!reg.gmdn_term) continue;

    const devices = await searchMhraDevicesByGmdn(reg.gmdn_term);
    if (!devices?.length) {
      // Device no longer in PARD — mark as Red
      await supabase
        .from('device_master')
        .update({ health_status: 'Red', last_automated_sync: new Date().toISOString() })
        .eq('device_id', reg.device_link);

      results.push({
        device_id: reg.device_link,
        manufacturer_name: 'Unknown',
        gmdn_term: reg.gmdn_term,
        success: false,
        health_status: 'Red',
        stale_registration_alert: false,
        error: 'Device no longer found in PARD',
      });
      continue;
    }

    // Match by device_id (MHRA-{DEVICE_ID} format)
    const deviceIdNum = parseInt(reg.device_link.replace('MHRA-', ''));
    const device = devices.find((d) => d.DEVICE_ID === deviceIdNum);

    if (!device) continue;

    await new Promise((r) => setTimeout(r, 300));
    const result = await syncDeviceFromMHRA(device, null);
    results.push(result);
  }

  return results;
}

// ── Seed Helpers ───────────────────────────────────────────────────────────────

/**
 * Resolve manufacturer details for a device from PARD.
 * Used during seeding to enrich device records with manufacturer info.
 * Returns null if manufacturer cannot be resolved.
 */
export async function resolveMhraManufacturer(
  device: MhraDevice
): Promise<MhraManufacturer | null> {
  // We don't have a direct lookup by ID, so we use a broad search
  // and filter by organisation ID client-side
  // This is only called during seeding — not on every sync
  try {
    const results = await searchMhraManufacturer('');
    if (!results) return null;
    return results.find((m) => m.MAN_ORGANISATION_ID === device.MAN_ORGANISATION_ID) ?? null;
  } catch {
    return null;
  }
}
