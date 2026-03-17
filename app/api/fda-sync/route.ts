/**
 * app/api/fda-sync/route.ts
 * HTTP endpoint that triggers an FDA sync
 *
 * POST /api/fda-sync
 *   Body: { device_id: string, k_number?: string, pma_number?: string }
 *   Syncs a single device.
 *
 * GET /api/fda-sync?bulk=true
 *   Syncs all FDA-registered devices in the database.
 *   Use with caution — iterates every device.
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

// ── POST /api/fda-sync — sync a single device ──────────────────────────────────

export async function POST(req: NextRequest) {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  let body: {
    device_id?: string;
    k_number?: string;
    pma_number?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { device_id, k_number, pma_number } = body;

  if (!device_id) {
    return NextResponse.json(
      { error: 'device_id is required' },
      { status: 400 }
    );
  }

  if (!k_number && !pma_number) {
    return NextResponse.json(
      { error: 'Either k_number or pma_number is required' },
      { status: 400 }
    );
  }

  const result = await syncDeviceFromFDA(device_id, { k_number, pma_number });

  return NextResponse.json(result, {
    status: result.success ? 200 : 500,
  });
}

// ── GET /api/fda-sync — health check or bulk sync ─────────────────────────────

export async function GET(req: NextRequest) {
  try {
    if (!isAuthorised(req)) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const isBulk = req.nextUrl.searchParams.get('bulk') === 'true';

    if (!isBulk) {
      return NextResponse.json({
        message: 'Aletia FDA Sync endpoint. POST with { device_id, k_number } to sync a device. GET with ?bulk=true to sync all.',
      });
    }

    const results = await bulkSyncAllDevices();
    const succeeded = results.filter((r) => r.success).length;
    const recallAlerts = results.filter((r) => r.recall_alert).length;

    return NextResponse.json({
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
// ── POST /api/fda-sync/seed — pull AI/ML devices from FDA and insert into Supabase ──

export async function PUT(req: NextRequest) {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

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
       manufacturer_name: d.applicant, 
      health_status: 'Amber',
      aletia_verified: false,
      last_automated_sync: new Date().toISOString(),
      country_of_origin: 'US',
    }));

    const { error } = await supabase
      .from('device_master')
      .upsert(rows, { onConflict: 'device_id' });

    if (error) throw new Error(error.message);

    // Also insert regional registrations for each device
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