/**
 * app/api/admin/queue/accept/route.ts
 *
 * Accept a queued ingestion entry. Two modes:
 *
 *   1. Create mode (merge_into_aletia_id omitted):
 *      - Calls create_device_atomic RPC which, in a single transaction:
 *        * inserts device_master (aletia_id auto-allocated by DB default)
 *        * inserts the queue's identifier into device_external_ids as primary
 *        * for CT.gov source, inserts a device_trials row
 *      - If any of those three fail, the whole thing rolls back — no orphan.
 *      - For FDA/MHRA sources, additionally inserts a regional_registrations
 *        row with external_id_value (non-atomic, best-effort — regional enrichment
 *        failing doesn't invalidate the device identity).
 *
 *   2. Merge mode (merge_into_aletia_id provided):
 *      - Target device must exist; target's claim state gates the merge
 *      - Appends the queue's identifier to device_external_ids as non-primary
 *      - Device_master fields are NEVER overwritten. Only null-or-missing
 *        fields get filled from queue data (append-never-overwrite discipline)
 *      - Source-specific enrichment (device_trials / regional_registrations)
 *        still happens — trials and regulatory facts about the device compose
 *        across sources rather than overwriting
 *
 * Rewrite history:
 *   - 23 Apr 2026 — Initial A2b rewrite. Resolved BUG-001, BUG-002, BUG-005.
 *   - 24 Apr 2026 — Atomicity fix: create mode wraps its three writes in the
 *     create_device_atomic RPC to prevent the partial-commit orphans we hit
 *     on 23 Apr (ALT-006163 / ALT-006165).
 *
 * Request body:
 *   {
 *     queue_id: string,                        // required
 *     device_name?: string,                    // written to device_master.name on create; filled-if-null on merge
 *     manufacturer_name?: string,              // resolves to manufacturer_link
 *     specialty?: string | null,
 *     approval_status?: 'pre_approval' | 'approved',
 *     merge_into_aletia_id?: string | null,    // triggers merge mode if present
 *     confirm_claimed_merge?: boolean,         // required if merge target is claimed
 *     review_note?: string | null,
 *   }
 */

import { NextResponse, type NextRequest } from 'next/server'
import {
  getServiceClient,
  getAdminActor,
  writeAudit,
  AdminAuthError,
} from '@/lib/adminAudit'
import type { ClinicalTrial } from '@/lib/clinicalTrials'
import type {
  DeviceTrialStatus,
  ExternalIdType,
} from '@/lib/types'

interface Body {
  queue_id: string
  device_name?: string
  manufacturer_name?: string
  specialty?: string | null
  approval_status?: 'pre_approval' | 'approved'
  merge_into_aletia_id?: string | null
  confirm_claimed_merge?: boolean
  review_note?: string | null
}

export async function POST(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  let actor
  try {
    actor = await getAdminActor()
  } catch (e) {
    if (e instanceof AdminAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    throw e
  }
  if (actor.role === 'readonly') {
    return NextResponse.json(
      { error: 'Readonly admin cannot accept entries' },
      { status: 403 },
    )
  }

  const body = (await req.json()) as Body
  if (!body.queue_id) {
    return NextResponse.json({ error: 'queue_id required' }, { status: 400 })
  }

  const admin = getServiceClient()

  // ── Load queue row ────────────────────────────────────────────────────────
  const { data: queueRow, error: queueErr } = await admin
    .from('ingestion_review_queue')
    .select('*')
    .eq('queue_id', body.queue_id)
    .single()

  if (queueErr || !queueRow) {
    return NextResponse.json(
      { error: queueErr?.message || 'Queue entry not found' },
      { status: 404 },
    )
  }
  if (queueRow.status !== 'pending') {
    return NextResponse.json(
      { error: `Entry is already ${queueRow.status}` },
      { status: 409 },
    )
  }

  const raw = queueRow.raw_data ?? {}
  const now = new Date().toISOString()

  // ── Classify the queue's external identifier ──────────────────────────────
  // Every queue row that reaches accept has a (source, source_id) pair that
  // maps to an (id_type, id_value, jurisdiction) tuple for device_external_ids.
  const classified = classifyQueueIdentifier(queueRow)
  if (!classified) {
    return NextResponse.json(
      {
        error:
          `Cannot accept queue row with source='${queueRow.source}' — no identifier classification`,
      },
      { status: 400 },
    )
  }

  // ── Resolve or create manufacturer ────────────────────────────────────────
  let manufacturerId: string | null = null
  const mfgName = (body.manufacturer_name || queueRow.manufacturer || '').trim()
  if (mfgName) {
    const { data: existingMfg } = await admin
      .from('manufacturers')
      .select('id')
      .ilike('name', mfgName)
      .limit(1)
      .maybeSingle()

    if (existingMfg) {
      manufacturerId = existingMfg.id
    } else {
      const { data: newMfg, error: mfgErr } = await admin
        .from('manufacturers')
        .insert({ name: mfgName, status: 'Unverified', tier: 'free' })
        .select('id')
        .single()

      if (mfgErr) {
        return NextResponse.json(
          { error: `Could not create manufacturer: ${mfgErr.message}` },
          { status: 500 },
        )
      }
      manufacturerId = newMfg.id

      await writeAudit({
        actor,
        action: 'manufacturer.create',
        target_table: 'manufacturers',
        target_id: newMfg.id,
        payload: { name: mfgName, source: 'queue_accept', queue_id: body.queue_id },
        req,
      })
    }
  }

  // ── Branch: merge vs create ───────────────────────────────────────────────
  let aletiaId: string
  let isMerge: boolean

  if (body.merge_into_aletia_id) {
    // ── Merge mode ──────────────────────────────────────────────────────────
    const { data: target, error: lookupErr } = await admin
      .from('device_master')
      .select('aletia_id, name, intended_use, specialty_link, manufacturer_link, claimed_at, claimed_by_email, approval_status')
      .eq('aletia_id', body.merge_into_aletia_id)
      .maybeSingle()

    if (lookupErr || !target) {
      return NextResponse.json(
        { error: `merge_into_aletia_id "${body.merge_into_aletia_id}" not found` },
        { status: 404 },
      )
    }

    // Claimed-listing gate.
    if (target.claimed_at && !body.confirm_claimed_merge) {
      return NextResponse.json(
        {
          error: 'Target listing is claimed. Re-submit with confirm_claimed_merge=true to proceed.',
          claimed_by_email: target.claimed_by_email,
        },
        { status: 409 },
      )
    }

    aletiaId = target.aletia_id
    isMerge = true

    // Append-never-overwrite: only fill fields that are currently null on the
    // target. Admin can still edit the device afterwards via Module 3 (future).
    const fillIfNull: Record<string, unknown> = {
      last_automated_sync: now,
    }
    if (target.name == null && body.device_name) fillIfNull.name = body.device_name
    if (target.intended_use == null && body.device_name) fillIfNull.intended_use = body.device_name
    if (target.specialty_link == null && body.specialty) fillIfNull.specialty_link = body.specialty
    if (target.manufacturer_link == null && manufacturerId) fillIfNull.manufacturer_link = manufacturerId

    const { error: updErr } = await admin
      .from('device_master')
      .update(fillIfNull)
      .eq('aletia_id', aletiaId)

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 })
    }

    // On merge, append the identifier to device_external_ids (non-primary).
    // The create path does this atomically via RPC; merge can't, because we
    // already have the aletia_id and we're appending rather than creating.
    // If the append fails (e.g. the identifier already belongs to another
    // device via a race), we treat it as a warning — the device-level merge
    // itself has already landed and is not invalidated.
    const { error: extIdErr } = await admin
      .from('device_external_ids')
      .insert({
        aletia_id:    aletiaId,
        id_type:      classified.id_type,
        id_value:     classified.id_value,
        jurisdiction: classified.jurisdiction,
        is_primary:   false,
        source:       `queue_accept:${queueRow.source}`,
      })

    if (extIdErr) {
      // Race or already-linked. Non-fatal; log and continue.
      console.warn(
        `[queue.accept] external_id append skipped (already exists?) for ${aletiaId} ${classified.id_type}/${classified.id_value}: ${extIdErr.message}`,
      )
    }
  } else {
    // ── Create mode (atomic via RPC) ────────────────────────────────────────
    // The RPC wraps device_master + device_external_ids + optional
    // device_trials in a single transaction. Fall back to the queue row's
    // own fields when the request body doesn't include them. The list-row
    // "Accept" shortcut in the admin UI sends only { queue_id }, so without
    // this fallback the name / manufacturer would drop to null on every
    // one-click accept (this was BUG-002's remaining failure mode even after
    // A2b's first pass).
    const deviceName     = body.device_name     ?? queueRow.device_name  ?? null
    const specialtyName  = body.specialty       ?? null
    const approvalStatus = body.approval_status ?? 'pre_approval'

    const deviceSeed: Record<string, unknown> = {
      external_legacy_id:  classified.id_value,       // explicit, though RPC would default it
      manufacturer_link:   manufacturerId,
      manufacturer_name:   mfgName || null,
      name:                deviceName,
      intended_use:        deviceName,
      specialty_link:      specialtyName,
      approval_status:     approvalStatus,
      data_source:         'aletia_research',
      health_status:       'Amber',
      pipeline_stage:      inferPipelineStage(raw),
      last_automated_sync: now,
      ai_ml_integral:      true,
    }

    // CT.gov source: pass a trial payload so the RPC inserts device_trials
    // in the same transaction. Other sources pass null — no trial to record.
    const trialSeed =
      queueRow.source === 'clinical_trials'
        ? buildTrialSeedFromQueue(raw, queueRow.sponsor_type)
        : null

    const { data: newAletiaId, error: rpcErr } = await admin.rpc(
      'create_device_atomic',
      {
        p_device:      deviceSeed,
        p_external_id: {
          id_type:      classified.id_type,
          id_value:     classified.id_value,
          jurisdiction: classified.jurisdiction,
          source:       `queue_accept:${queueRow.source}`,
          is_primary:   true,
        },
        p_trial:       trialSeed,
      },
    )

    if (rpcErr || !newAletiaId) {
      const code = (rpcErr as { code?: string } | null)?.code
      // SQLSTATE 23505 = unique_violation. Most likely the identifier already
      // belongs to another device (identifier collision) — surface cleanly.
      if (code === '23505') {
        return NextResponse.json(
          {
            error:  `Identifier ${classified.id_type}/${classified.id_value} already belongs to another device.`,
            detail: rpcErr?.message ?? 'unique violation',
          },
          { status: 409 },
        )
      }
      return NextResponse.json(
        { error: `Could not create device: ${rpcErr?.message ?? 'unknown'}` },
        { status: 500 },
      )
    }

    aletiaId = typeof newAletiaId === 'string' ? newAletiaId : String(newAletiaId)
    isMerge = false

    await writeAudit({
      actor,
      action: 'device.create',
      target_table: 'device_master',
      target_id: aletiaId,
      payload: { source: 'queue_accept', queue_id: body.queue_id, manufacturer_id: manufacturerId },
      req,
    })
  }

  // ── Source-specific enrichment ────────────────────────────────────────────
  // Trial enrichment for merge mode only — create mode already inserted it
  // atomically via the RPC. FDA/MHRA regional registration enrichment runs
  // for both modes (create + merge); failures here are warnings, not errors.
  if (queueRow.source === 'clinical_trials' && isMerge) {
    await enrichFromClinicalTrial(admin, aletiaId, raw, queueRow.sponsor_type)
  } else if (queueRow.source === 'fda_sync') {
    await enrichFromFdaQueue(admin, aletiaId, classified, raw)
  } else if (queueRow.source === 'mhra_sync') {
    await enrichFromMhraQueue(admin, aletiaId, classified, raw)
  } else if (queueRow.source === 'eudamed_sync') {
    await enrichFromEudamedQueue(admin, aletiaId, classified, raw)
  }
  // Other sources — no per-source enrichment today. Adding one is a matter of
  // writing a new enrichFrom* helper below and plumbing it in.

  // ── Mark queue row approved ───────────────────────────────────────────────
  const { error: queueUpdErr } = await admin
    .from('ingestion_review_queue')
    .update({
      status:      'approved',
      reviewed_at: now,
      reviewed_by: actor.email,
      review_note: body.review_note ?? null,
    })
    .eq('queue_id', body.queue_id)

  if (queueUpdErr) {
    return NextResponse.json({ error: queueUpdErr.message }, { status: 500 })
  }

  await writeAudit({
    actor,
    action: isMerge ? 'queue.accept_merge' : 'queue.accept',
    target_table: 'ingestion_review_queue',
    target_id: body.queue_id,
    payload: {
      aletia_id: aletiaId,
      manufacturer_id: manufacturerId,
      merged_into: isMerge ? body.merge_into_aletia_id : null,
      specialty: body.specialty || null,
      external_id: `${classified.id_type}:${classified.id_value}`,
    },
    req,
  })

  return NextResponse.json({
    ok: true,
    aletia_id: aletiaId,
    manufacturer_id: manufacturerId,
    external_id: { id_type: classified.id_type, id_value: classified.id_value },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Classify queue row identifier → (id_type, id_value, jurisdiction)
// ─────────────────────────────────────────────────────────────────────────────

interface ClassifiedIdentifier {
  id_type: ExternalIdType
  id_value: string
  jurisdiction: string | null
}

function classifyQueueIdentifier(queueRow: {
  source: string
  source_id: string | null
  raw_data: Record<string, unknown> | null
}): ClassifiedIdentifier | null {
  const sourceId = queueRow.source_id ?? ''
  if (!sourceId) return null

  switch (queueRow.source) {
    case 'clinical_trials':
      // source_id is the NCT number itself (e.g. "NCT05386654")
      return { id_type: 'nct', id_value: sourceId, jurisdiction: null }

    case 'fda_sync':
      // source_id is typically a K-number; classify by shape.
      if (/^K[0-9]+$/.test(sourceId))   return { id_type: 'fda_k_number', id_value: sourceId, jurisdiction: 'US' }
      if (/^DEN[0-9]+$/.test(sourceId)) return { id_type: 'fda_de_novo',  id_value: sourceId, jurisdiction: 'US' }
      if (/^P[0-9]+$/.test(sourceId))   return { id_type: 'fda_pma',      id_value: sourceId, jurisdiction: 'US' }
      return null

    case 'mhra_sync':
      // source_id should be the raw numeric MHRA device ID (no MHRA- prefix).
      return { id_type: 'mhra_device_id', id_value: sourceId, jurisdiction: 'GB' }

    case 'eudamed_sync':
      // source_id is the EUDAMED udiDiData record UUID (euUuid) — the
      // retrievable EU handle. The Basic UDI layer isn't reachable yet, so we
      // attach on the UDI-DI record under its own type, not 'eudamed_basic_udi'.
      return { id_type: 'eudamed_udi_di', id_value: sourceId, jurisdiction: 'EU' }

    case 'scarlet_eudamed_sync':
      return { id_type: 'scarlet_pccp_id', id_value: sourceId, jurisdiction: null }

    case 'pccp_ingest':
      // Post-A2b PCCP ingest is enrichment-only; it should no longer create
      // queue rows. This arm is kept for legacy pre-A2b queue rows where
      // source_id is an FDA K-number (or DEN/PMA).
      if (/^K[0-9]+$/.test(sourceId))   return { id_type: 'fda_k_number', id_value: sourceId, jurisdiction: 'US' }
      if (/^DEN[0-9]+$/.test(sourceId)) return { id_type: 'fda_de_novo',  id_value: sourceId, jurisdiction: 'US' }
      if (/^P[0-9]+$/.test(sourceId))   return { id_type: 'fda_pma',      id_value: sourceId, jurisdiction: 'US' }
      return { id_type: 'fda_k_number', id_value: sourceId, jurisdiction: 'US' }

    // 'oleary_csv' is an alternate legacy source name for PCCP queue rows.
    case 'oleary_csv':
      if (/^K[0-9]+$/.test(sourceId))   return { id_type: 'fda_k_number', id_value: sourceId, jurisdiction: 'US' }
      if (/^DEN[0-9]+$/.test(sourceId)) return { id_type: 'fda_de_novo',  id_value: sourceId, jurisdiction: 'US' }
      if (/^P[0-9]+$/.test(sourceId))   return { id_type: 'fda_pma',      id_value: sourceId, jurisdiction: 'US' }
      return { id_type: 'fda_k_number', id_value: sourceId, jurisdiction: 'US' }

    case 'fda_breakthrough':
      // Breakthrough queue rows have no canonical external ID (no K-number
      // at designation time). source_id is a synthetic "company__device"
      // string. Classify as legacy_unclassified until the device lands a
      // real submission number that we'd then append separately.
      return { id_type: 'legacy_unclassified', id_value: sourceId, jurisdiction: 'US' }

    default:
      return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Enrichment: build trial seed from clinical_trials queue row for RPC insert
//
// This is the create-mode equivalent of enrichFromClinicalTrial. The queue's
// raw_data is a spread of the normalised ClinicalTrial object (see
// lib/clinicalTrialsIngest.ts) — fields are nctId / startDate / completionDate
// / status / locations (string[] of ISO codes), NOT overall_status etc.
// BUG-001 is the historical regression from reading the wrong field names.
// ─────────────────────────────────────────────────────────────────────────────

function buildTrialSeedFromQueue(
  raw: Record<string, unknown>,
  sponsorType: string | null,
): Record<string, unknown> | null {
  const trial = raw as Partial<ClinicalTrial> & { sponsor_type?: string }

  // If no NCT, nothing to record in device_trials.
  if (!trial.nctId) return null

  return {
    nct_id:               trial.nctId,
    trial_registry:       'ct_gov',
    title:                trial.title ?? null,
    brief_summary:        trial.briefSummary ?? null,
    sponsor_name:         trial.sponsorName ?? null,
    sponsor_type:         sponsorType ?? trial.sponsor_type ?? null,
    status:               normaliseStatus(trial.status),
    phase:                trial.phase ?? null,
    enrollment:           typeof trial.enrollment === 'number' ? trial.enrollment : null,
    start_date:           toDateOrNull(trial.startDate),
    completion_date:      toDateOrNull(trial.completionDate),
    jurisdictions:        Array.isArray(trial.locations)  ? trial.locations  : null,
    conditions_raw:       Array.isArray(trial.conditions) ? trial.conditions : null,
    is_device_trial:      typeof trial.isDeviceTrial === 'boolean' ? trial.isDeviceTrial : null,
    irb_approved:         typeof trial.irbApproved === 'boolean'   ? trial.irbApproved   : null,
    source_payload:       raw,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Enrichment: clinical_trials queue row → device_trials upsert (merge path)
//
// Only called on merge. On create, the RPC has already inserted device_trials.
// Here, the trial data needs to be appended to an existing device that might
// already have trials. UPSERT on (aletia_id, nct_id) now works — the follow-up
// migration 20260424120100 converted the partial index to a full unique
// constraint.
// ─────────────────────────────────────────────────────────────────────────────

async function enrichFromClinicalTrial(
  admin: ReturnType<typeof getServiceClient>,
  aletiaId: string,
  raw: Record<string, unknown>,
  sponsorType: string | null,
): Promise<void> {
  const trial = raw as Partial<ClinicalTrial> & { sponsor_type?: string }
  if (!trial.nctId) return

  const status = normaliseStatus(trial.status)

  const { error } = await admin
    .from('device_trials')
    .upsert(
      {
        aletia_id:            aletiaId,
        nct_id:               trial.nctId,
        trial_registry:       'ct_gov',
        title:                trial.title ?? null,
        brief_summary:        trial.briefSummary ?? null,
        sponsor_name:         trial.sponsorName ?? null,
        sponsor_type:         sponsorType ?? trial.sponsor_type ?? null,
        status,
        phase:                trial.phase ?? null,
        enrollment:           typeof trial.enrollment === 'number' ? trial.enrollment : null,
        start_date:           toDateOrNull(trial.startDate),
        completion_date:      toDateOrNull(trial.completionDate),
        jurisdictions:        Array.isArray(trial.locations)  ? trial.locations  : null,
        conditions_raw:       Array.isArray(trial.conditions) ? trial.conditions : null,
        is_device_trial:      typeof trial.isDeviceTrial === 'boolean' ? trial.isDeviceTrial : null,
        irb_approved:         typeof trial.irbApproved === 'boolean'   ? trial.irbApproved   : null,
        source_payload:       raw,
        last_seen_at:         new Date().toISOString(),
      },
      { onConflict: 'aletia_id,nct_id' },
    )

  if (error) {
    console.error(
      `[queue.accept] device_trials upsert failed for ${aletiaId}/${trial.nctId}: ${error.message}`,
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Enrichment: fda_sync queue row → regional_registrations row
// ─────────────────────────────────────────────────────────────────────────────

async function enrichFromFdaQueue(
  admin: ReturnType<typeof getServiceClient>,
  aletiaId: string,
  classified: ClassifiedIdentifier,
  raw: Record<string, unknown>,
): Promise<void> {
  // Don't duplicate a regional row for the same (device, country, body).
  const { data: existing } = await admin
    .from('regional_registrations')
    .select('reg_id')
    .eq('device_link', aletiaId)
    .eq('country', 'US')
    .eq('regulatory_body', 'FDA')
    .maybeSingle()

  const clearanceType =
    classified.id_type === 'fda_k_number' ? '510k' :
    classified.id_type === 'fda_de_novo'  ? 'De Novo' :
    classified.id_type === 'fda_pma'      ? 'PMA' :
    null

  if (existing) {
    await admin
      .from('regional_registrations')
      .update({
        external_id_value: classified.id_value,
        last_updated: new Date().toISOString(),
      })
      .eq('reg_id', existing.reg_id)
    return
  }

  await admin.from('regional_registrations').insert({
    device_link:       aletiaId,
    country:           'US',
    regulatory_body:   'FDA',
    clearance_type:    clearanceType,
    external_id_value: classified.id_value,
    last_updated:      new Date().toISOString(),
    device_class:      typeof raw.device_class === 'string' ? raw.device_class : null,
    gmdn_code:         typeof raw.gmdn_code === 'string' ? raw.gmdn_code : null,
    gmdn_term:         typeof raw.gmdn_term === 'string' ? raw.gmdn_term : null,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Enrichment: mhra_sync queue row → regional_registrations row
// ─────────────────────────────────────────────────────────────────────────────

async function enrichFromMhraQueue(
  admin: ReturnType<typeof getServiceClient>,
  aletiaId: string,
  classified: ClassifiedIdentifier,
  raw: Record<string, unknown>,
): Promise<void> {
  const { data: existing } = await admin
    .from('regional_registrations')
    .select('reg_id')
    .eq('device_link', aletiaId)
    .eq('country', 'GB')
    .eq('regulatory_body', 'MHRA')
    .maybeSingle()

  if (existing) {
    await admin
      .from('regional_registrations')
      .update({
        external_id_value: classified.id_value,
        last_updated: new Date().toISOString(),
      })
      .eq('reg_id', existing.reg_id)
    return
  }

  await admin.from('regional_registrations').insert({
    device_link:       aletiaId,
    country:           'GB',
    regulatory_body:   'MHRA',
    clearance_type:    'UKCA',
    external_id_value: classified.id_value,
    last_updated:      new Date().toISOString(),
    device_class:      typeof raw.device_class === 'string' ? raw.device_class : null,
    gmdn_code:         typeof raw.gmdn_code === 'string' ? raw.gmdn_code : null,
    gmdn_term:         typeof raw.gmdn_term === 'string' ? raw.gmdn_term : null,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Enrichment: eudamed_sync queue row → regional_registrations row (EU)
//
// raw_data is the spread EudamedDeviceRecord (lib/eudamed.ts) — notified_body,
// legislation, risk_class, certificate_number, etc. regulatory_body holds the
// notified body name; clearance_type the CE/MDR route. external_id_value is the
// basic UDI-DI, which equals classified.id_value — and the merge block has
// already appended that device_external_ids row, so the regional_registrations
// consistency trigger is satisfied.
// ─────────────────────────────────────────────────────────────────────────────

async function enrichFromEudamedQueue(
  admin: ReturnType<typeof getServiceClient>,
  aletiaId: string,
  classified: ClassifiedIdentifier,
  raw: Record<string, unknown>,
): Promise<void> {
  const notifiedBody =
    typeof raw.notified_body === 'string' && raw.notified_body ? raw.notified_body : 'pending'
  const legislation = typeof raw.legislation === 'string' ? raw.legislation : null
  // NB/legislation are a deferred backfill (not retrievable from EUDAMED yet —
  // revisit monthly). 'pending' is explicit, not a fabricated body/route.
  const clearanceType =
    legislation?.includes('MDR')  ? 'CE Mark (MDR)' :
    legislation?.includes('IVDR') ? 'CE Mark (IVDR)' :
    legislation?.includes('MDD')  ? 'CE Mark (MDD, legacy)' :
    'pending'
  const riskClass = typeof raw.risk_class === 'string' ? raw.risk_class : null

  const { data: existing } = await admin
    .from('regional_registrations')
    .select('reg_id')
    .eq('device_link', aletiaId)
    .eq('country', 'EU')
    .eq('regulatory_body', notifiedBody)
    .maybeSingle()

  if (existing) {
    await admin
      .from('regional_registrations')
      .update({
        external_id_value: classified.id_value,
        clearance_type:    clearanceType,
        device_class:      riskClass,
        last_updated:      new Date().toISOString(),
      })
      .eq('reg_id', existing.reg_id)
    return
  }

  await admin.from('regional_registrations').insert({
    device_link:       aletiaId,
    country:           'EU',
    regulatory_body:   notifiedBody,
    clearance_type:    clearanceType,
    external_id_value: classified.id_value,
    device_class:      riskClass,
    last_updated:      new Date().toISOString(),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────────────────────────────────────

function inferPipelineStage(raw: Record<string, unknown>): string {
  // Only two cases we can confidently infer at accept time.
  const hasNct    = !!(raw.nctId || raw.nct_id)
  const hasStatus = !!raw.status
  const hasPhase  = !!raw.phase
  if (hasNct || hasStatus || hasPhase) return 'clinical_trial'
  return 'development'
}

function normaliseStatus(s?: string | null): DeviceTrialStatus | null {
  if (!s) return null
  const lower = s.toLowerCase()
  if (lower.includes('recruit'))   return 'recruiting'
  if (lower === 'active' || lower.includes('active,')) return 'active'
  if (lower.includes('complete'))  return 'completed'
  if (lower.includes('terminat'))  return 'terminated'
  if (lower.includes('withdraw'))  return 'withdrawn'
  if (lower.includes('suspend'))   return 'suspended'
  return 'unknown'
}

function toDateOrNull(s?: string | null): string | null {
  if (!s) return null
  // Accept YYYY-MM-DD, YYYY-MM, or YYYY
  const match = String(s).match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/)
  if (!match) return null
  const [, y, m = '01', d = '01'] = match
  return `${y}-${m}-${d}`
}
