/**
 * app/api/admin/queue/accept/route.ts
 *
 * Accept a queued ingestion entry. Creates a device_master row (or merges into
 * an existing one if merge_into_device_id is provided) plus a pre_approval_profile
 * row with trial data lifted from raw_data.
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

  // Load the queue row
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
      .select('device_id')
      .eq('device_id', body.merge_into_device_id)
      .single();

    if (lookupErr || !existing) {
      return NextResponse.json(
        { error: `merge_into_device_id "${body.merge_into_device_id}" not found in device_master` },
        { status: 404 }
      );
    }
    deviceId = existing.device_id;

    // Only update fields we're confident about
    const updates: Record<string, any> = { last_automated_sync: now };
    if (manufacturerId) updates.manufacturer_link = manufacturerId;
    if (body.specialty) updates.specialty_link = body.specialty;

    const { error: updErr } = await admin.from('device_master').update(updates).eq('device_id', deviceId);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
  } else {
    // Create new device_master row.
    // device_id: if source has a usable id (NCT number), prefix it. Otherwise synthesise.
    const nct = raw.nct_id || raw.nctId || raw?.protocolSection?.identificationModule?.nctId;
    const baseId = (nct && String(nct).startsWith('NCT'))
      ? `CT-${nct}`
      : queueRow.source_id
        ? `${queueRow.source.toUpperCase()}-${queueRow.source_id}`
        : `ALETIA-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    deviceId = baseId;

    // Check for collision
    const { data: collision } = await admin.from('device_master').select('device_id').eq('device_id', deviceId).maybeSingle();
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
      specialty_link: body.specialty || null,
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
    const { error: ppErr } = await admin
      .from('pre_approval_profile')
      .upsert(profile, { onConflict: 'device_id' });

    if (ppErr) {
      // Not fatal — device is created. Surface as warning.
      console.error('[queue.accept] pre_approval_profile upsert failed:', ppErr.message);
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
      specialty: body.specialty || null,
    },
    req,
  });

  return NextResponse.json({ ok: true, device_id: deviceId, manufacturer_id: manufacturerId });
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function inferPipelineStage(raw: any): string {
  const status = String(raw.overall_status || raw.overallStatus || '').toUpperCase();
  if (status.includes('RECRUIT') || status.includes('ACTIVE')) return 'proof_of_concept';
  if (status.includes('COMPLETE')) return 'pre_submission';
  if (status.includes('NOT_YET')) return 'proof_of_concept';
  return 'proof_of_concept';
}

function buildPreApprovalProfile(raw: any, deviceId: string, actorEmail: string) {
  const nct = raw.nct_id || raw.nctId || raw?.protocolSection?.identificationModule?.nctId;
  const phase = raw.phase || raw.phases?.[0] || raw?.protocolSection?.designModule?.phases?.[0];
  const status = raw.overall_status || raw.overallStatus || raw?.protocolSection?.statusModule?.overallStatus;
  const startDate = raw.start_date || raw?.protocolSection?.statusModule?.startDateStruct?.date;
  const completionDate = raw.completion_date || raw?.protocolSection?.statusModule?.completionDateStruct?.date;
  const enrollment = raw.enrollment ?? raw?.protocolSection?.designModule?.enrollmentInfo?.count;

  // Locations → ISO country codes
  const locations = raw.locations ?? raw?.protocolSection?.contactsLocationsModule?.locations ?? [];
  const countries = Array.from(
    new Set(
      (Array.isArray(locations) ? locations : [])
        .map((l: any) => l?.country)
        .filter(Boolean)
    )
  );

  if (!nct && !phase && !status) return null;  // nothing trial-shaped to record

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

function normaliseTrialStatus(s?: string): string | null {
  if (!s) return null;
  const upper = s.toUpperCase();
  if (upper.includes('RECRUIT')) return 'recruiting';
  if (upper.includes('ACTIVE')) return 'active';
  if (upper.includes('COMPLETE')) return 'completed';
  if (upper.includes('TERMINAT') || upper.includes('WITHDRAWN')) return 'terminated';
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
  // Accept YYYY-MM-DD, YYYY-MM, or YYYY
  const match = String(s).match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!match) return null;
  const [, y, m = '01', d = '01'] = match;
  return `${y}-${m}-${d}`;
}
