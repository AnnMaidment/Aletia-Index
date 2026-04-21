/**
 * app/api/admin/queue/accept/route.ts
 *
 * Accept a queued ingestion entry. Creates a device_master row (or merges into
 * an existing one if merge_into_device_id is provided) plus a pre_approval_profile
 * row with trial data lifted from raw_data.
 *
 * Changes 20 April 2026:
 *  - pipeline_stage values aligned with website PIPELINE_STAGE_MAP.
 *    CT.gov accept path writes 'clinical_trial' (any trial signal) or
 *    'development' (nothing trial-shaped).
 *  - Specialty resolution cascade: body.specialty → queueRow.specialty_inferred → null.
 *  - Specialty validated against specialty_taxonomy before write (400 on unknown).
 *  - Merge path no longer clobbers existing specialty_link — only fills when null.
 *  - pre_approval_profile merge path fills only currently-null fields; warns on
 *    non-null conflicts (canary for Workstream A2 becoming urgent).
 *  - normaliseTrialStatus: not_yet_recruiting / recruiting / active / completed /
 *    terminated / withdrawn / suspended all kept distinct.
 *  - Full specialty decision recorded in audit.
 *  - On merge, pipeline_stage is never touched. Approval graduation (flipping
 *    pipeline_stage to null) is the regulatory ingestion path's responsibility.
 *
 * Request body:
 *   {
 *     queue_id: string,
 *     device_name: string,
 *     manufacturer_name: string,
 *     specialty: string | null,
 *     approval_status: 'pre_approval' | 'approved',
 *     merge_into_device_id: string | null,
 *     review_note: string | null,
 *   }
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getServiceClient, getAdminActor, writeAudit, AdminAuthError } from '@/lib/adminAudit';

interface Body {
  queue_id: string;
  device_name?: string;
  manufacturer_name?: string;
  specialty?: string | null;
  approval_status?: 'pre_approval' | 'approved';
  merge_into_device_id?: string | null;
  review_note?: string | null;
}

export async function POST(req: NextRequest) {
  let actor;
  try {
    actor = await getAdminActor();
  } catch (e) {
    if (e instanceof AdminAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  if (actor.role === 'readonly') {
    return NextResponse.json({ error: 'Readonly admin cannot accept entries' }, { status: 403 });
  }

  const body = (await req.json()) as Body;
  if (!body.queue_id) return NextResponse.json({ error: 'queue_id required' }, { status: 400 });

  const admin = getServiceClient();

  // ---- Load the queue row ----
  const { data: queueRow, error: queueErr } = await admin
    .from('ingestion_review_queue')
    .select('*')
    .eq('queue_id', body.queue_id)
    .single();

  if (queueErr || !queueRow) {
    return NextResponse.json({ error: queueErr?.message || 'Queue entry not found' }, { status: 404 });
  }
  if (queueRow.status !== 'pending') {
    return NextResponse.json({ error: `Entry is already ${queueRow.status}` }, { status: 409 });
  }

  const raw = queueRow.raw_data ?? {};

  // ---- Resolve specialty: body → queueRow.specialty_inferred → null ----
  let resolvedSpecialty: string | null = null;
  let specialtySource: 'body' | 'inferred' | 'none' = 'none';

  if (typeof body.specialty === 'string' && body.specialty.trim()) {
    resolvedSpecialty = body.specialty.trim();
    specialtySource = 'body';
  } else if (queueRow.specialty_inferred) {
    resolvedSpecialty = queueRow.specialty_inferred;
    specialtySource = 'inferred';
  }

  // Validate against specialty_taxonomy. Unknown values reject.
  if (resolvedSpecialty) {
    const { data: taxRow, error: taxErr } = await admin
      .from('specialty_taxonomy')
      .select('specialty_name')
      .eq('specialty_name', resolvedSpecialty)
      .maybeSingle();
    if (taxErr) {
      return NextResponse.json({ error: `Specialty lookup failed: ${taxErr.message}` }, { status: 500 });
    }
    if (!taxRow) {
      return NextResponse.json(
        { error: `Specialty "${resolvedSpecialty}" not found in specialty_taxonomy. Use a known value or leave blank.` },
        { status: 400 }
      );
    }
  }

  const specialtyDecision = {
    inferred: queueRow.specialty_inferred ?? null,
    confidence: queueRow.specialty_confidence ?? null,
    signals: queueRow.specialty_signals ?? null,
    final_choice: resolvedSpecialty,
    source: specialtySource,
    overridden:
      specialtySource === 'body' &&
      !!queueRow.specialty_inferred &&
      queueRow.specialty_inferred !== resolvedSpecialty,
  };

  // ---- Resolve or create manufacturer ----
  let manufacturerId: string | null = null;
  const mfgName = (body.manufacturer_name || queueRow.manufacturer || '').trim();

  if (mfgName) {
    const { data: existingMfg } = await admin
      .from('manufacturers')
      .select('id')
      .ilike('name', mfgName)
      .limit(1)
      .maybeSingle();

    if (existingMfg) {
      manufacturerId = existingMfg.id;
    } else {
      const { data: newMfg, error: mfgErr } = await admin
        .from('manufacturers')
        .insert({
          name: mfgName,
          status: 'Unverified',
          tier: 'free',
        })
        .select('id')
        .single();

      if (mfgErr) {
        return NextResponse.json({ error: `Could not create manufacturer: ${mfgErr.message}` }, { status: 500 });
      }
      manufacturerId = newMfg.id;

      await writeAudit({
        actor, action: 'manufacturer.create',
        target_table: 'manufacturers', target_id: newMfg.id,
        payload: { name: mfgName, source: 'queue_accept', queue_id: body.queue_id },
        req,
      });
    }
  }

  // ---- Resolve device — merge or create ----
  let deviceId: string;
  const now = new Date().toISOString();

  if (body.merge_into_device_id) {
    // Merge mode — enrich existing device
    const { data: existing, error: lookupErr } = await admin
      .from('device_master')
      .select('device_id, specialty_link, pipeline_stage')
      .eq('device_id', body.merge_into_device_id)
      .single();

    if (lookupErr || !existing) {
      return NextResponse.json(
        { error: `merge_into_device_id "${body.merge_into_device_id}" not found in device_master` },
        { status: 404 }
      );
    }
    deviceId = existing.device_id;

    const updates: Record<string, any> = { last_automated_sync: now };
    if (manufacturerId) updates.manufacturer_link = manufacturerId;

    // Specialty: only update if current value is null. Do not clobber.
    if (resolvedSpecialty) {
      if (!existing.specialty_link) {
        updates.specialty_link = resolvedSpecialty;
      } else if (existing.specialty_link !== resolvedSpecialty) {
        console.warn(
          `[queue.accept] Not overwriting specialty_link for ${deviceId}: existing="${existing.specialty_link}", proposed="${resolvedSpecialty}" (source=${specialtySource})`
        );
      }
    }

    // pipeline_stage: never touched on merge. A cleared device (null) stays cleared
    // even when a new trial is attached. Graduation (cleared → pipeline or back)
    // is the regulatory ingestion path's job, not this route.

    const { error: updErr } = await admin.from('device_master').update(updates).eq('device_id', deviceId);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
  } else {
    // Create new device_master row.
    const nct = raw.nct_id || raw.nctId || raw?.protocolSection?.identificationModule?.nctId;
    const baseId = (nct && String(nct).startsWith('NCT'))
      ? `CT-${nct}`
      : queueRow.source_id
        ? `${queueRow.source.toUpperCase()}-${queueRow.source_id}`
        : `ALETIA-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    deviceId = baseId;

    const { data: collision } = await admin
      .from('device_master')
      .select('device_id')
      .eq('device_id', deviceId)
      .maybeSingle();
    if (collision) {
      return NextResponse.json(
        { error: `device_id "${deviceId}" already exists. Use merge_into_device_id to link.` },
        { status: 409 }
      );
    }

    const { error: insErr } = await admin.from('device_master').insert({
      device_id: deviceId,
      manufacturer_link: manufacturerId,
      manufacturer_name: mfgName || null,
      specialty_link: resolvedSpecialty,
      approval_status: body.approval_status ?? 'pre_approval',
      data_source: 'aletia_research',
      health_status: 'Amber',
      pipeline_stage: inferPipelineStage(raw),
      last_automated_sync: now,
      ai_ml_integral: true,
    });

    if (insErr) return NextResponse.json({ error: `Could not create device: ${insErr.message}` }, { status: 500 });

    await writeAudit({
      actor, action: 'device.create',
      target_table: 'device_master', target_id: deviceId,
      payload: { source: 'queue_accept', queue_id: body.queue_id, manufacturer_id: manufacturerId },
      req,
    });
  }

  // ---- pre_approval_profile with trial data ----
  const profile = buildPreApprovalProfile(raw, deviceId, actor.email);
  if (profile) {
    if (body.merge_into_device_id) {
      // Merge path: do not clobber existing profile. Fill only currently-null fields.
      // Warn on non-null conflicts — this is the canary that Workstream A2
      // (device_trials as one-to-many) has become urgent.
      const { data: existingProfile } = await admin
        .from('pre_approval_profile')
        .select('*')
        .eq('device_id', deviceId)
        .maybeSingle();

      if (!existingProfile) {
        const { error: ppErr } = await admin.from('pre_approval_profile').insert(profile);
        if (ppErr) console.error('[queue.accept] pre_approval_profile insert failed:', ppErr.message);
      } else {
        const merged: Record<string, any> = { device_id: deviceId };
        const conflicts: string[] = [];
        for (const [k, v] of Object.entries(profile)) {
          if (k === 'device_id') continue;
          if (existingProfile[k] == null) {
            merged[k] = v;
          } else if (v != null && JSON.stringify(existingProfile[k]) !== JSON.stringify(v)) {
            conflicts.push(`${k}: existing=${JSON.stringify(existingProfile[k])} new=${JSON.stringify(v)}`);
          }
        }
        if (conflicts.length) {
          console.warn(
            `[queue.accept] pre_approval_profile conflicts on merge for ${deviceId}. ` +
            `Existing values preserved; incoming values dropped: ${conflicts.join('; ')}. ` +
            `This indicates multiple trials for the same device — implement device_trials (Workstream A2).`
          );
        }
        // Always refresh update metadata even if no new trial data landed.
        merged.last_updated_by_email = actor.email;
        merged.last_self_update = new Date().toISOString();
        if (Object.keys(merged).length > 1) {
          const { error: ppErr } = await admin
            .from('pre_approval_profile')
            .update(merged)
            .eq('device_id', deviceId);
          if (ppErr) console.error('[queue.accept] pre_approval_profile update failed:', ppErr.message);
        }
      }
    } else {
      // Create path — fresh insert, no conflict possible.
      const { error: ppErr } = await admin.from('pre_approval_profile').insert(profile);
      if (ppErr) {
        console.error('[queue.accept] pre_approval_profile insert failed:', ppErr.message);
      }
    }
  }

  // ---- Mark queue row approved ----
  const { error: queueUpdErr } = await admin
    .from('ingestion_review_queue')
    .update({
      status: 'approved',
      reviewed_at: now,
      reviewed_by: actor.email,
      review_note: body.review_note ?? null,
    })
    .eq('queue_id', body.queue_id);

  if (queueUpdErr) return NextResponse.json({ error: queueUpdErr.message }, { status: 500 });

  await writeAudit({
    actor, action: body.merge_into_device_id ? 'queue.accept_merge' : 'queue.accept',
    target_table: 'ingestion_review_queue', target_id: body.queue_id,
    payload: {
      created_device_id: deviceId,
      manufacturer_id: manufacturerId,
      merged_into: body.merge_into_device_id || null,
      specialty: specialtyDecision,
    },
    req,
  });

  return NextResponse.json({ ok: true, device_id: deviceId, manufacturer_id: manufacturerId });
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

/**
 * Pipeline stage inference for the CT.gov acceptance path.
 *
 * Semantic (agreed 20 April 2026):
 *   NULL             → cleared (approved in at least one jurisdiction)
 *   'development'    → no trial, no regulatory submission
 *   'clinical_trial' → any trial attached, any trial state
 *   'pre_submission' → submitted to regulator, not yet approved
 *   'under_review'   → regulator actively reviewing
 *
 * CT.gov inputs are always trial-shaped in practice. If any trial signal is
 * present (NCT number, status, or phase) we write 'clinical_trial'. The
 * pre_submission / under_review values come from regulatory ingestion paths,
 * not this route. Graduation to null (approval) also belongs to those paths.
 */
function inferPipelineStage(raw: any): 'clinical_trial' | 'development' {
  const nct = raw.nct_id || raw.nctId || raw?.protocolSection?.identificationModule?.nctId;
  const status = raw.overall_status || raw.overallStatus || raw?.protocolSection?.statusModule?.overallStatus;
  const phase = raw.phase || raw.phases?.[0] || raw?.protocolSection?.designModule?.phases?.[0];
  const hasTrial = Boolean(nct || status || phase);
  return hasTrial ? 'clinical_trial' : 'development';
}

function buildPreApprovalProfile(raw: any, deviceId: string, actorEmail: string) {
  const nct = raw.nct_id || raw.nctId || raw?.protocolSection?.identificationModule?.nctId;
  const phase = raw.phase || raw.phases?.[0] || raw?.protocolSection?.designModule?.phases?.[0];
  const status = raw.overall_status || raw.overallStatus || raw?.protocolSection?.statusModule?.overallStatus;
  const startDate = raw.start_date || raw?.protocolSection?.statusModule?.startDateStruct?.date;
  const completionDate = raw.completion_date || raw?.protocolSection?.statusModule?.completionDateStruct?.date;
  const enrollment = raw.enrollment ?? raw?.protocolSection?.designModule?.enrollmentInfo?.count;

  const locations = raw.locations ?? raw?.protocolSection?.contactsLocationsModule?.locations ?? [];
  const countries = Array.from(
    new Set(
      (Array.isArray(locations) ? locations : [])
        .map((l: any) => l?.country)
        .filter(Boolean)
    )
  );

  if (!nct && !phase && !status) return null;

  return {
    device_id: deviceId,
    dev_stage: 'clinical_trial',
    trial_identifier: nct || null,
    trial_status: normaliseTrialStatus(status),
    trial_phase: normalisePhase(phase),
    trial_start_date: toDateOrNull(startDate),
    trial_completion_date: toDateOrNull(completionDate),
    trial_enrollment: typeof enrollment === 'number' ? enrollment : null,
    trial_locations: countries.length ? countries : null,
    last_updated_by_email: actorEmail,
    last_self_update: new Date().toISOString(),
  };
}

/**
 * All seven CT.gov trial states kept distinct. The pipeline pill rolls these
 * up to 'clinical_trial' at display time, but the granular state stays on
 * pre_approval_profile.trial_status for the device detail page and analysis.
 */
function normaliseTrialStatus(s?: string): string | null {
  if (!s) return null;
  const upper = String(s).toUpperCase();
  if (upper.includes('NOT_YET') || upper.includes('NOT YET')) return 'not_yet_recruiting';
  if (upper.includes('RECRUIT')) return 'recruiting';
  if (upper.includes('ACTIVE')) return 'active';
  if (upper.includes('COMPLETE')) return 'completed';
  if (upper.includes('TERMINAT')) return 'terminated';
  if (upper.includes('WITHDRAWN')) return 'withdrawn';
  if (upper.includes('SUSPEND')) return 'suspended';
  return s.toLowerCase();
}

function normalisePhase(p?: string): string | null {
  if (!p) return null;
  const upper = p.toUpperCase().replace(/\s+/g, '');
  if (upper.includes('PHASE3') || upper === 'PHASE_3') return 'phase_3';
  if (upper.includes('PHASE2') || upper === 'PHASE_2') return 'phase_2';
  if (upper.includes('PHASE1') || upper === 'PHASE_1') return 'phase_1';
  if (upper === 'NA' || upper === 'N/A') return 'na';
  return p.toLowerCase().replace(/\s+/g, '_');
}

function toDateOrNull(s?: string): string | null {
  if (!s) return null;
  const match = String(s).match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!match) return null;
  const [, y, m = '01', d = '01'] = match;
  return `${y}-${m}-${d}`;
}