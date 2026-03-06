/**
 * app/api/fda-sync/route.ts
 * Multi-jurisdiction sync endpoint for Aletia Index
 *
 * ── POST /api/fda-sync ────────────────────────────────────────────────────────
 *   Body: { device_id, k_number?, pma_number? }
 *   Syncs a single FDA device.
 *
 * ── POST /api/fda-sync?source=mhra ───────────────────────────────────────────
 *   Body: { device_id, gmdn_term }
 *   Syncs a single MHRA device by DEVICE_ID and GMDN term.
 *
 * ── GET /api/fda-sync ─────────────────────────────────────────────────────────
 *   Health check. GET ?bulk=true to sync all FDA devices in device_master.
 *
 * ── GET /api/fda-sync?bulk=true&source=mhra ──────────────────────────────────
 *   Re-syncs all MHRA devices already in device_master.
 *
 * ── PUT /api/fda-sync ─────────────────────────────────────────────────────────
 *   Seeds FDA AI/ML devices from openFDA into device_master.
 *
 * ── PUT /api/fda-sync?source=mhra ────────────────────────────────────────────
 *   Seeds MHRA AI/ML devices by querying all curated GMDN terms.
 *   ~35 PARD API calls. May take 30–60 seconds.
 *
 * ── GET /api/fda-sync?source=eudamed&basic_udi_ulid=X ────────────────────────
 *   On-demand EUDAMED lookup for a single device (no bulk seeding).
 *
 * Protect this endpoint by adding SYNC_SECRET to .env.local
 * Then pass the header: x-sync-token: your_secret
 */

import { NextRequest, NextResponse } from 'next/server';
import { syncDeviceFromFDA, bulkSyncAllDevices } from '@/lib/fdaSync';

const SYNC_SECRET = process.env.SYNC_SECRET;

function isAuthorised(req: NextRequest): boolean {
  if (!SYNC_SECRET) return true; // No secret set — open (dev only)
  return req.headers.get('x-sync-token') === SYNC_SECRET;
}

// ── POST — sync a single device ───────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const source = req.nextUrl.searchParams.get('source');

  // ── MHRA: POST /api/fda-sync?source=mhra ──────────────────────────────────
  if (source === 'mhra') {
    let body: { device_id?: string; gmdn_term?: string };

    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { device_id, gmdn_term } = body;

    if (!device_id || !gmdn_term) {
      return NextResponse.json(
        { error: 'device_id and gmdn_term are required for MHRA sync' },
        { status: 400 }
      );
    }

    const { searchMhraDevicesByGmdn } = await import('@/lib/mhra');
    const { syncDeviceFromMHRA } = await import('@/lib/mhraSync');

    const devices = await searchMhraDevicesByGmdn(gmdn_term);
    if (!devices?.length) {
      return NextResponse.json(
        { error: `No MHRA devices found for GMDN term: "${gmdn_term}"` },
        { status: 404 }
      );
    }

    const deviceIdNum = parseInt(device_id.replace('MHRA-', ''));
    const device = devices.find((d) => d.DEVICE_ID === deviceIdNum);

    if (!device) {
      return NextResponse.json(
        { error: `Device ${device_id} not found in PARD results for term "${gmdn_term}"` },
        { status: 404 }
      );
    }

    const result = await syncDeviceFromMHRA(device, null);
    return NextResponse.json(result, { status: result.success ? 200 : 500 });
  }

  // ── FDA (default): POST /api/fda-sync ─────────────────────────────────────
  let body: { device_id?: string; k_number?: string; pma_number?: string };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { device_id, k_number, pma_number } = body;

  if (!device_id) {
    return NextResponse.json({ error: 'device_id is required' }, { status: 400 });
  }

  if (!k_number && !pma_number) {
    return NextResponse.json(
      { error: 'Either k_number or pma_number is required' },
      { status: 400 }
    );
  }

  const result = await syncDeviceFromFDA(device_id, { k_number, pma_number });
  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}

// ── GET — health check, bulk sync, or EUDAMED on-demand lookup ────────────────

export async function GET(req: NextRequest) {
  try {
    if (!isAuthorised(req)) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const source = req.nextUrl.searchParams.get('source');
    const isBulk = req.nextUrl.searchParams.get('bulk') === 'true';

    // ── EUDAMED: GET /api/fda-sync?source=eudamed&basic_udi_ulid=X ───────────
    if (source === 'eudamed') {
      const udiUlid = req.nextUrl.searchParams.get('basic_udi_ulid');
      if (!udiUlid) {
        return NextResponse.json(
          { error: 'basic_udi_ulid query param is required for EUDAMED lookup' },
          { status: 400 }
        );
      }

      const { getEudamedDevice } = await import('@/lib/eudamed');
      const device = await getEudamedDevice(udiUlid);

      if (!device) {
        return NextResponse.json(
          { error: `Device not found in EUDAMED: ${udiUlid}` },
          { status: 404 }
        );
      }

      return NextResponse.json(device);
    }

    // ── MHRA bulk re-sync: GET /api/fda-sync?bulk=true&source=mhra ────────────
    if (source === 'mhra' && isBulk) {
      const { bulkSyncAllMhraDevices } = await import('@/lib/mhraSync');
      const results = await bulkSyncAllMhraDevices();
      const succeeded = results.filter((r) => r.success).length;
      const staleAlerts = results.filter((r) => r.stale_registration_alert).length;

      return NextResponse.json({
        source: 'MHRA',
        total: results.length,
        succeeded,
        failed: results.length - succeeded,
        stale_registration_alerts: staleAlerts,
        results,
      });
    }

    // ── FDA health check or bulk sync ─────────────────────────────────────────
    if (!isBulk) {
      return NextResponse.json({
        message: [
          'Aletia Multi-Jurisdiction Sync endpoint.',
          'POST                                      — sync single FDA device',
          'POST ?source=mhra                         — sync single MHRA device',
          'GET  ?bulk=true                           — bulk re-sync all FDA devices',
          'GET  ?bulk=true&source=mhra               — bulk re-sync all MHRA devices',
          'GET  ?source=eudamed&basic_udi_ulid=X     — on-demand EUDAMED lookup',
          'PUT                                       — seed FDA AI/ML devices',
          'PUT  ?source=mhra                         — seed MHRA AI/ML devices (~35 GMDN terms)',
        ].join('\n'),
      });
    }

    const results = await bulkSyncAllDevices();
    const succeeded = results.filter((r) => r.success).length;
    const recallAlerts = results.filter((r) => r.recall_alert).length;

    return NextResponse.json({
      source: 'FDA',
      total: results.length,
      succeeded,
      failed: results.length - succeeded,
      recall_alerts: recallAlerts,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── PUT — seed device_master from source ──────────────────────────────────────

export async function PUT(req: NextRequest) {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const source = req.nextUrl.searchParams.get('source');

  // ── MHRA seed: PUT /api/fda-sync?source=mhra ──────────────────────────────
  if (source === 'mhra') {
    const { searchAllMhraAIMLDevices, searchMhraManufacturer } = await import('@/lib/mhra');
    const { syncDeviceFromMHRA } = await import('@/lib/mhraSync');

    const devices = await searchAllMhraAIMLDevices();

    if (!devices.length) {
      return NextResponse.json({ message: 'No MHRA devices returned from PARD' });
    }

    const results = [];

    for (const device of devices) {
      // Attempt manufacturer lookup — best effort, fall back to null
      let manufacturer = null;
      try {
        const manufacturers = await searchMhraManufacturer(
          `org${device.MAN_ORGANISATION_ID}`
        );
        manufacturer = manufacturers?.[0] ?? null;
      } catch {
        // Non-fatal — device record will use fallback manufacturer name
      }

      const result = await syncDeviceFromMHRA(device, manufacturer);
      results.push(result);

      // Polite delay between Supabase writes
      await new Promise((r) => setTimeout(r, 100));
    }

    const succeeded = results.filter((r) => r.success).length;

    return NextResponse.json({
      source: 'MHRA',
      message: `${succeeded} of ${devices.length} MHRA devices seeded`,
      total: devices.length,
      succeeded,
      failed: devices.length - succeeded,
      results,
    });
  }

  // ── FDA seed (default): PUT /api/fda-sync ─────────────────────────────────
  try {
    const { searchAIMLDevices } = await import('@/lib/fda');
    const { supabase } = await import('@/lib/supabase');

    const devices = await searchAIMLDevices();

    if (!devices.length) {
      return NextResponse.json({ message: 'No devices returned from FDA' });
    }

    const rows = devices.map((d) => ({
      device_id: d.k_number,
      intended_use: d.device_name,
      health_status: 'Amber',
      aletia_verified: false,
      last_automated_sync: new Date().toISOString(),
      country_of_origin: 'US',
    }));

    const { error } = await supabase
      .from('device_master')
      .upsert(rows, { onConflict: 'device_id' });

    if (error) throw new Error(error.message);

    const regRows = devices.map((d) => ({
      device_link: d.k_number,
      country: 'US',
      regulatory_body: 'FDA',
      clearance_type: '510k',
    }));

    await supabase
      .from('regional_registrations')
      .upsert(regRows, { onConflict: 'device_link,country,regulatory_body' });

    return NextResponse.json({
      source: 'FDA',
      message: `${devices.length} devices seeded successfully`,
      devices: devices.map((d) => ({
        k_number: d.k_number,
        device_name: d.device_name,
        applicant: d.applicant,
        decision_date: d.decision_date,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
