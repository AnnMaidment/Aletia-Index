/**
 * Aletia Index — /api/eudamed-scarlet-sync
 *
 * API route that queries EUDAMED for all Scarlet NB (3022) certified devices,
 * then routes them through the same ingestion_review_queue pattern used by
 * the O'Leary PCCP pipeline — so unknown devices get human review before
 * going live.
 *
 * Trigger manually:
 *   curl -X POST https://aletia-index.vercel.app/api/eudamed-scarlet-sync \
 *     -H "x-sync-token: $SYNC_SECRET"
 *
 * Add to vercel.json crons (monthly is appropriate — EUDAMED changes slowly):
 *   { "path": "/api/eudamed-scarlet-sync", "schedule": "0 4 1 * *" }
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { queryScarletDevices, type ScarletDevice } from '@/lib/scarletEudamedQuery';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  // Auth check — same pattern as pccp-ingest
  const token = req.headers.get('x-sync-token') ??
    req.headers.get('authorization')?.replace('Bearer ', '');

  if (token !== process.env.SYNC_SECRET && token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const devices = await queryScarletDevices();

    let updated    = 0;
    let queued     = 0;
    let errors     = 0;
    const unknown: string[] = [];

    for (const device of devices) {
      try {
        // Check if this device already exists in device_master
        // Match on EUDAMED Basic UDI (most reliable EU identifier)
        const { data: existing } = await supabase
          .from('device_master')
          .select('device_id, pccp_status')
          .eq('eudamed_basic_udi', device.eudamed_basic_udi)
          .maybeSingle();

        if (existing) {
          // Device is already in Aletia — enrich with EU certification data
          await supabase
            .from('device_master')
            .update({
              ce_mark_status:       'certified',
              ce_certificate_number: device.certificate_number,
              ce_certificate_expiry: device.certificate_expiry,
              ce_notified_body:     'Scarlet NB B.V. (3022)',
              eu_risk_class:        device.risk_class,
              emdn_code:            device.emdn_code,
              last_automated_sync:  new Date().toISOString(),
            })
            .eq('device_id', existing.device_id);

          updated++;
        } else {
          // Unknown device — queue for review, same as O'Leary pipeline
          await supabase
            .from('ingestion_review_queue')
            .upsert({
              source:               'eudamed_scarlet_nb',
              source_id:            device.eudamed_basic_udi,
              device_name:          device.device_name,
              manufacturer:         device.manufacturer_name,
              raw_data:             device,
              status:               'pending',
              review_note:          `Scarlet NB (3022) certified device. EU ${device.risk_class}. EMDN: ${device.emdn_code ?? 'unknown'}. ai_ml_integral=true (Scarlet only certifies SaMD/AIaMD).`,
            }, {
              onConflict: 'source,source_id',
              ignoreDuplicates: true,
            });

          unknown.push(device.device_name);
          queued++;
        }
      } catch (err) {
        console.error(`Error processing ${device.device_name}:`, err);
        errors++;
      }
    }

    return NextResponse.json({
      success: true,
      total_scarlet_devices: devices.length,
      updated_in_device_master: updated,
      queued_for_review: queued,
      errors,
      queued_devices: unknown,
    });

  } catch (err) {
    console.error('EUDAMED Scarlet sync error:', err);
    return NextResponse.json(
      { error: 'Sync failed', detail: (err as Error).message },
      { status: 500 }
    );
  }
}
