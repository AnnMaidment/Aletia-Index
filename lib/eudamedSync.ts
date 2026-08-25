/**
 * lib/eudamedSync.ts — EUDAMED discovery ingest through the 4d gate.
 *
 * Mirrors lib/fdaSync.ts (the ingestFdaDevice path). One entry point:
 *
 *   ingestEudamedDevice(record: EudamedDeviceRecord)
 *     Process one discovered EU device (a normalised record from
 *     lib/eudamed.ts) through the shared 4d gate (lib/ingestion.ts), then,
 *     on create/update, write the EU regional_registrations row + apply the
 *     graduation rule. Used by PUT /api/eudamed-sync.
 *
 * CROSS-JURISDICTION REALITY (Step 0A §3/§5):
 *   There is NO shared identifier namespace between an FDA K-number and a
 *   EUDAMED basic-UDI, so the gate's exact-(id_type,id_value) auto-attach
 *   almost never fires for a freshly discovered EU device. Discovery therefore
 *   resolves as either: a merge candidate found → queued_for_review (the
 *   dominant outcome — the 218 confirmed crosswalk matches land here and are
 *   merged by the admin accept route, which writes the EU regional row), OR no
 *   candidate → queued (autoCreate=false, precision over recall) / created
 *   (autoCreate=true, only for high-trust callers).
 *
 *   A bad cross-jurisdiction merge is the single most damaging error this
 *   product can make ("the same device in two places"). False positives are
 *   worse than duplicates. Default posture: lean to queueing.
 *
 * GRADUATION RULE (BUG-010 / B4, EUDAMED half): recording an EU clearance is a
 * regulatory approval → pipeline_stage = null. Applied here, mirroring the FDA
 * half. The MHRA half remains in its own path.
 */

import { createAdminClient } from './supabase-admin';
import { processExternalIdentifier, logIngestionAnomaly } from './ingestion';
import { clearanceTypeFromLegislation, type EudamedDeviceRecord } from './eudamed';

export interface EudamedIngestResult {
  eu_uuid: string;
  action:
    | 'updated_existing'
    | 'created_new'
    | 'queued_for_review'
    | 'already_queued'
    | 'skipped_prior_decision'
    | 'failed';
  aletia_id: string | null;
  confidence: EudamedDeviceRecord['confidence'];
  error?: string;
}

/**
 * Build the device_master seed for the EU auto-create path. Mirrors
 * buildFdaDeviceSeed: intended_use stays null (no device-name mirroring),
 * ai_ml_integral reflects heuristic confidence (only 'include' is confident),
 * pipeline_stage null (graduation on create).
 */
function buildEudamedDeviceSeed(r: EudamedDeviceRecord): Record<string, unknown> {
  return {
    // aletia_id omitted — sequence DEFAULT allocates.
    manufacturer_name: r.manufacturer_name ?? null,
    name: r.device_name ?? null,
    intended_use: null,                 // leave for a real source; never the name
    country_of_origin: 'EU',
    health_status: 'Green',
    aletia_verified: false,
    approval_status: 'approved',        // CE-marked / certified
    data_source: 'registry_sync',
    eu_risk_class: r.risk_class ?? null,
    last_automated_sync: new Date().toISOString(),
    excluded: false,
    pipeline_stage: null,               // graduation rule on create
    // Only an 'include'-confidence device is confidently AI by the heuristic.
    // 'queue' devices reach the create path only via admin promotion, where
    // the operator has eyeballed it; default it false so an uncorroborated
    // device never silently asserts ai_ml_integral.
    ai_ml_integral: r.confidence === 'include',
  };
}

export async function ingestEudamedDevice(
  record: EudamedDeviceRecord,
  opts: { autoCreate?: boolean } = {},
): Promise<EudamedIngestResult> {
  const admin = createAdminClient();
  const { uuid: euUuid, manufacturer_name, device_name, confidence } = record;

  // Precision over recall: do NOT auto-mint EU devices by default. A confirmed
  // crosswalk match will find a candidate and queue regardless; a no-match
  // uncertain AI-slice device should queue, not spring into the curated index.
  const autoCreate = opts.autoCreate ?? false;

  if (!euUuid || !euUuid.trim()) {
    await logIngestionAnomaly(admin, {
      source: 'eudamed_sync',
      anomaly_type: 'missing_required_field',
      identifier_value: euUuid,
      identifier_type_expected: 'eudamed_udi_di',
      context: { reason: 'empty euUuid', device_name },
    });
    return { eu_uuid: euUuid, action: 'failed', aletia_id: null, confidence, error: 'empty euUuid' };
  }

  const payload = {
    ...record,
    source: 'eudamed_sync',
    fetched_at: new Date().toISOString(),
  };

  // ── 4d gate ────────────────────────────────────────────────────────────────
  const decision = await processExternalIdentifier({
    supabase: admin,
    id_type: 'eudamed_udi_di',
    id_value: euUuid,
    jurisdiction: 'EU',
    source: 'eudamed_sync',
    queueSource: 'eudamed_sync',
    reviewReason: 'possible_merge',
    manufacturerName: manufacturer_name,
    deviceName: device_name,
    payload,
    autoCreate,
    deviceSeed: buildEudamedDeviceSeed(record),
  });

  // ── Post-gate enrichment for create/update paths ──────────────────────────
  // (Merge of a confirmed crosswalk match happens via the admin accept route,
  //  which calls enrichFromEudamedQueue — NOT here. Here we only handle the
  //  exact-id re-run [updated_existing] and the rare autoCreate=true create.)
  if (decision.action === 'updated_existing' || decision.action === 'created_new') {
    // The device_external_ids row for (eudamed_udi_di, euUuid) already exists at
    // this point (created_new: via create_device_atomic in the same txn;
    // updated_existing: from the prior run), so writing
    // regional_registrations.external_id_value = euUuid satisfies the
    // consistency trigger.
    const { error: regErr } = await admin
      .from('regional_registrations')
      .upsert(
        {
          device_link: decision.aletia_id,
          country: 'EU',
          // NB/legislation aren't retrievable yet (deferred backfill, monthly
          // re-probe), so these are explicit 'pending' rather than a fabricated
          // notified body. reg_count still increments; the EU jurisdiction is real.
          regulatory_body: record.notified_body ?? 'pending',
          clearance_type: record.legislation
            ? clearanceTypeFromLegislation(record.legislation)
            : 'pending',
          external_id_value: euUuid,
          device_class: record.risk_class,
          last_updated: new Date().toISOString(),
        },
        { onConflict: 'device_link,country,regulatory_body' },
      );

    if (regErr) {
      console.warn(`[eudamedSync] regional_registrations upsert warning: ${regErr.message}`);
    }

    if (decision.action === 'updated_existing') {
      await admin
        .from('device_master')
        .update({ pipeline_stage: null })   // graduation rule on the update path
        .eq('aletia_id', decision.aletia_id);
    }

    return { eu_uuid: euUuid, action: decision.action, aletia_id: decision.aletia_id, confidence };
  }

  if (
    decision.action === 'queued_for_review' ||
    decision.action === 'already_queued' ||
    decision.action === 'skipped_prior_decision'
  ) {
    return { eu_uuid: euUuid, action: decision.action, aletia_id: null, confidence };
  }

  return { eu_uuid: euUuid, action: 'failed', aletia_id: null, confidence, error: decision.error };
}
