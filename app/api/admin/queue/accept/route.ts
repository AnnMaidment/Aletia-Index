/**
 * app/api/admin/queue/accept/route.ts
 *
 * Accept a queued ingestion entry. Two modes:
 *
 *   1. Create mode (merge_into_aletia_id omitted):
 *      - Inserts a new device_master row (aletia_id auto-allocated by DB default)
 *      - Inserts the queue's identifier into device_external_ids as primary
 *      - For CT.gov source, inserts a device_trials row
 *      - For FDA/MHRA sources, inserts a regional_registrations row with
 *        external_id_value linked to the new device_external_ids entry
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
 *   - Was: app/api/admin/queue/accept/route.ts (pre-A2b)
 *   - Resolves BUG-001 (trial data silently lost — wrong field names in raw_data read)
 *   - Resolves BUG-002 (device_name accepted but not written — now writes device_master.name)
 *   - Resolves BUG-005 (CT-${nct} synthesis — aletia_id comes from DB sequence)
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
  } else {
    // ── Create mode ─────────────────────────────────────────────────────────
    // aletia_id is NOT included — the DB default allocates via aletia_id_seq.
    // external_legacy_id mirrors the primary external ID (denormalised convenience)
    // and is NOT NULL on the schema, inherited from pre-A2a when it was the PK.
    const { data: created, error: insErr } = await admin
      .from('device_master')
      .insert({
        external_legacy_id: queueRow.source_id,
        manufacturer_link: manufacturerId,
        manufacturer_name: mfgName || null,
        name: body.device_name || null,
        intended_use: body.device_name || null,
        specialty_link: body.specialty || null,
        approval_status: body.approval_status ?? 'pre_approval',
        data_source: 'aletia_research',
        health_status: 'Amber',
        pipeline_stage: inferPipelineStage(raw),
        last_automated_sync: now,
        ai_ml_integral: true,
      })
      .select('aletia_id')
      .single()

    if (insErr || !created) {
      return NextResponse.json(
        { error: `Could not create device: ${insErr?.message ?? 'unknown'}` },
        { status: 500 },
      )
    }

    aletiaId = created.aletia_id
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

  // ── Append the external identifier to device_external_ids ─────────────────
  // Primary if this was a create (first ID on the device); non-primary if merge.
  // Conflict on (id_type, id_value) means the identifier is already known —
  // treat as non-fatal for merge (someone may have raced us) but fatal for
  // create (uniqueness violation means the identifier already belongs to
  // another device, which is a contradiction).
  const { error: extIdErr } = await admin
    .from('device_external_ids')
    .insert({
      aletia_id:    aletiaId,
      id_type:      classified.id_type,
      id_value:     classified.id_value,
      jurisdiction: classified.jurisdiction,
      is_primary:   !isMerge,
      source:       `queue_accept:${queueRow.source}`,
    })

  if (extIdErr) {
    if (isMerge) {
      // Race condition or already-linked. Log, continue to mark queue.
      console.warn(
        `[queue.accept] external_id append skipped (already exists?) for ${aletiaId} ${classified.id_type}/${classified.id_value}: ${extIdErr.message}`,
      )
    } else {
      return NextResponse.json(
        {
          error: `Identifier ${classified.id_type}/${classified.id_value} already belongs to another device.`,
          detail: extIdErr.message,
        },
        { status: 409 },
      )
    }
  }

  // ── Source-specific enrichment ────────────────────────────────────────────
  if (queueRow.source === 'clinical_trials') {
    await enrichFromClinicalTrial(admin, aletiaId, raw, queueRow.sponsor_type)
  } else if (queueRow.source === 'fda_sync') {
    await enrichFromFdaQueue(admin, aletiaId, classified, raw)
  } else if (queueRow.source === 'mhra_sync') {
    await enrichFromMhraQueue(admin, aletiaId, classified, raw)
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

    case 'scarlet_eudamed_sync':
      return { id_type: 'scarlet_pccp_id', id_value: sourceId, jurisdiction: null }

    case 'pccp_ingest':
      // PCCP is enrichment-only — shouldn't normally land here. Defensive.
      return { id_type: 'fda_k_number', id_value: sourceId, jurisdiction: 'US' }

    default:
      return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Enrichment: clinical_trials queue row → device_trials upsert
//
// This is the BUG-001 fix. The queue's raw_data is a spread of the
// normalised ClinicalTrial object — see lib/clinicalTrialsIngest.ts. That
// means the fields are status, startDate, completionDate, locations (as
// string[] of ISO codes), NOT overall_status/start_date/etc. Reading the
// old paths silently returns undefined for everything.
// ─────────────────────────────────────────────────────────────────────────────

async function enrichFromClinicalTrial(
  admin: ReturnType<typeof getServiceClient>,
  aletiaId: string,
  raw: Record<string, unknown>,
  sponsorType: string | null,
): Promise<void> {
  // raw is a ClinicalTrial shape plus { sponsor_type, review_reason, ... }
  const trial = raw as Partial<ClinicalTrial> & { sponsor_type?: string }

  // If no NCT, nothing to record in device_trials.
  if (!trial.nctId) return

  const status = normaliseStatus(trial.status)

  // Accept is a one-shot path: we just created (or merged into) the device,
  // and a device_trials row for this (aletia_id, nct_id) doesn't exist yet.
  // So this is a plain INSERT, not an upsert. (We can't UPSERT with onConflict
  // here anyway — the uniqueness is enforced by a partial unique index, not
  // a full unique constraint, and Supabase's onConflict targets full
  // constraints only. Follow-up migration will convert the partial index to
  // a full unique constraint for the CT.gov ingest path's benefit.)
  const { error } = await admin
    .from('device_trials')
    .insert({
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
      jurisdictions:        Array.isArray(trial.locations) ? trial.locations : null,
      conditions_raw:       Array.isArray(trial.conditions) ? trial.conditions : null,
      is_device_trial:      typeof trial.isDeviceTrial === 'boolean' ? trial.isDeviceTrial : null,
      irb_approved:         typeof trial.irbApproved === 'boolean' ? trial.irbApproved : null,
      source_payload:       raw,
      last_seen_at:         new Date().toISOString(),
    })

  if (error) {
    // If a device_trials row somehow already exists (e.g., an earlier failed
    // accept attempt that partially succeeded), the insert will conflict with
    // the partial unique index. In that case we silently skip — the existing
    // row is already there. Log for triage either way.
    console.error(
      `[queue.accept] device_trials insert failed for ${aletiaId}/${trial.nctId}: ${error.message}`,
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
