-- =============================================================================
-- Migration: 20260424120000_create_device_atomic_rpc.sql
-- Workstream A2b — atomicity fix for device-create paths
--
-- Prerequisites:
--   - 20260421120000_aletia_ids.sql (A2a)
--   - 20260423120000_device_trials_and_external_ids.sql (A2b schema)
--
-- What this does:
--   Creates a single plpgsql function, create_device_atomic(...), that does
--   in ONE transaction the three writes every device-create path needs:
--     1. INSERT into device_master  (aletia_id allocated by sequence DEFAULT)
--     2. INSERT into device_external_ids (the primary identifier)
--     3. optionally INSERT into device_trials (if the caller passes a trial
--        payload, e.g. when accepting a CT.gov queue row)
--
-- Why:
--   Pre-A2b the accept route and processExternalIdentifier do these writes
--   as three separate non-transactional Supabase calls. If step 2 fails
--   after step 1 succeeds, we get an orphan device_master row with no
--   primary identifier. This surfaced twice on 23 April during staging
--   testing (ALT-006163 and ALT-006165 required manual SQL repair).
--
--   Wrapping the path in a single plpgsql function gives us true atomicity:
--   any exception (unique-violation on identifier, check-constraint failure,
--   FK violation) raises out of the function and rolls back all rows in the
--   transaction. The caller sees one error with one clear cause.
--
-- What this does NOT do:
--   - Touch regional_registrations. Regional enrichment is a separate
--     logical step (a "this device was registered here" fact) and we already
--     handle its failure modes gracefully (warn, continue).
--   - Change the existing non-atomic code paths. Those are rewritten in the
--     same chat to call this RPC; the RPC alone would be dead code.
--
-- Signature (jsonb-based, so future column additions don't require a new RPC):
--
--   create_device_atomic(
--     p_device       jsonb,              -- device_master column map
--     p_external_id  jsonb,              -- id_type / id_value / jurisdiction / source
--     p_trial        jsonb DEFAULT NULL  -- device_trials column map (optional)
--   ) RETURNS text                       -- new aletia_id
--
-- Contract on p_device:
--   Caller passes the device_master columns as a jsonb object. The function:
--     - NEVER reads p_device->>'aletia_id' (sequence default allocates it).
--     - Defaults external_legacy_id to p_external_id->>'id_value' if caller
--       omits it. This hides a latent NOT NULL footgun that bit us yesterday
--       (external_legacy_id is NOT NULL — inherited from pre-A2a when it was
--       the PK — and not every ingest path's deviceSeed currently sets it).
--     - Defaults last_automated_sync to now() if caller omits it.
--     - Passes all other device_master columns through verbatim.
--
-- Contract on p_external_id:
--   {
--     "id_type":      "fda_k_number" | "nct" | "mhra_device_id" | ...,   REQUIRED
--     "id_value":     "K230001",                                          REQUIRED
--     "jurisdiction": "US" | "GB" | null,                                 optional
--     "source":       "fda_sync" | "admin_accept" | ...,                  optional
--     "is_primary":   true | false                                        default true
--   }
--
-- Contract on p_trial (when provided):
--   Keys match device_trials columns exactly (nct_id, trial_registry, title,
--   sponsor_name, status, phase, enrollment, start_date, completion_date,
--   jurisdictions, conditions_raw, is_device_trial, irb_approved,
--   source_payload, sponsor_type). Any missing key is treated as null.
--
-- Error handling:
--   The function RAISES EXCEPTION on any failure; the entire transaction
--   rolls back. The caller receives a Postgres error object; the Supabase
--   client surfaces it via error.code + error.message on the RPC result.
--   Unique-violation on (id_type, id_value) in device_external_ids gives
--   SQLSTATE 23505, which callers can detect to render "identifier already
--   belongs to another device" cleanly.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION create_device_atomic(
  p_device      jsonb,
  p_external_id jsonb,
  p_trial       jsonb DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_aletia_id           text;
  v_id_type             text;
  v_id_value            text;
  v_is_primary          boolean;
  v_external_legacy_id  text;
  v_last_automated_sync timestamptz;
BEGIN
  -- ── Validate required external_id fields ────────────────────────────────
  v_id_type  := p_external_id->>'id_type';
  v_id_value := p_external_id->>'id_value';

  IF v_id_type IS NULL OR v_id_value IS NULL THEN
    RAISE EXCEPTION 'create_device_atomic: p_external_id must include id_type and id_value'
      USING ERRCODE = '22023';  -- invalid_parameter_value
  END IF;

  v_is_primary := COALESCE((p_external_id->>'is_primary')::boolean, true);

  -- ── Derive defaults for device_master ───────────────────────────────────
  -- If caller didn't supply external_legacy_id, mirror the primary identifier.
  -- This plugs the NOT NULL gap that currently requires each ingest path to
  -- remember the same boilerplate line.
  v_external_legacy_id := COALESCE(p_device->>'external_legacy_id', v_id_value);

  v_last_automated_sync := COALESCE(
    (p_device->>'last_automated_sync')::timestamptz,
    now()
  );

  -- ── Step 1: Insert device_master ─────────────────────────────────────────
  -- Column set matches the fields the accept route and 4d-gate callers
  -- currently populate. Adding a new device_master column later means
  -- extending this INSERT (and its VALUES clause) in a follow-up migration.
  INSERT INTO device_master (
    external_legacy_id,
    manufacturer_link,
    manufacturer_name,
    name,
    intended_use,
    specialty_link,
    approval_status,
    data_source,
    health_status,
    pipeline_stage,
    last_automated_sync,
    ai_ml_integral,
    country_of_origin,
    aletia_verified,
    excluded,
    accountability_tier,
    breakthrough_designation,
    breakthrough_designation_date
  ) VALUES (
    v_external_legacy_id,
    NULLIF(p_device->>'manufacturer_link', '')::uuid,
    p_device->>'manufacturer_name',
    p_device->>'name',
    p_device->>'intended_use',
    p_device->>'specialty_link',
    COALESCE(p_device->>'approval_status', 'pre_approval'),
    COALESCE(p_device->>'data_source',     'aletia_research'),
    COALESCE(p_device->>'health_status',   'Amber'),
    p_device->>'pipeline_stage',
    v_last_automated_sync,
    COALESCE((p_device->>'ai_ml_integral')::boolean, true),
    p_device->>'country_of_origin',
    COALESCE((p_device->>'aletia_verified')::boolean, false),
    COALESCE((p_device->>'excluded')::boolean,        false),
    NULLIF(p_device->>'accountability_tier', '')::integer,
    COALESCE((p_device->>'breakthrough_designation')::boolean, false),
    NULLIF(p_device->>'breakthrough_designation_date', '')::date
  )
  RETURNING aletia_id INTO v_aletia_id;

  -- ── Step 2: Insert primary external_id ───────────────────────────────────
  -- If the (id_type, id_value) pair already belongs to another device, the
  -- unique index raises 23505 here and the whole transaction rolls back.
  INSERT INTO device_external_ids (
    aletia_id,
    id_type,
    id_value,
    jurisdiction,
    is_primary,
    source
  ) VALUES (
    v_aletia_id,
    v_id_type,
    v_id_value,
    p_external_id->>'jurisdiction',
    v_is_primary,
    p_external_id->>'source'
  );

  -- ── Step 3: Optionally insert device_trials row ──────────────────────────
  -- Called only when the ingest source is a trial registry (CT.gov today;
  -- ISRCTN / EU-CTR tomorrow). Absence of a trial payload is the signal to
  -- skip this step — caller passes NULL.
  IF p_trial IS NOT NULL THEN
    INSERT INTO device_trials (
      aletia_id,
      nct_id,
      trial_registry,
      title,
      brief_summary,
      sponsor_name,
      sponsor_type,
      status,
      phase,
      enrollment,
      start_date,
      completion_date,
      jurisdictions,
      conditions_raw,
      is_device_trial,
      irb_approved,
      source_payload,
      last_seen_at
    ) VALUES (
      v_aletia_id,
      p_trial->>'nct_id',
      COALESCE(p_trial->>'trial_registry', 'ct_gov'),
      p_trial->>'title',
      p_trial->>'brief_summary',
      p_trial->>'sponsor_name',
      p_trial->>'sponsor_type',
      p_trial->>'status',
      p_trial->>'phase',
      NULLIF(p_trial->>'enrollment', '')::integer,
      NULLIF(p_trial->>'start_date', '')::date,
      NULLIF(p_trial->>'completion_date', '')::date,
      CASE WHEN jsonb_typeof(p_trial->'jurisdictions') = 'array'
           THEN ARRAY(SELECT jsonb_array_elements_text(p_trial->'jurisdictions'))
           ELSE NULL END,
      CASE WHEN jsonb_typeof(p_trial->'conditions_raw') = 'array'
           THEN ARRAY(SELECT jsonb_array_elements_text(p_trial->'conditions_raw'))
           ELSE NULL END,
      NULLIF(p_trial->>'is_device_trial', '')::boolean,
      NULLIF(p_trial->>'irb_approved',    '')::boolean,
      p_trial->'source_payload',
      now()
    );
  END IF;

  RETURN v_aletia_id;
END;
$$;

COMMENT ON FUNCTION create_device_atomic(jsonb, jsonb, jsonb) IS
  'A2b atomicity fix. Wraps device_master + device_external_ids + optional '
  'device_trials inserts in a single transaction. Callers pass column-shaped '
  'jsonb payloads; function defaults external_legacy_id to p_external_id->id_value '
  'if caller omits it. Returns the new aletia_id. Raises on any error.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Grant EXECUTE to the service role used by the Next.js admin client.
-- RLS doesn't apply to SECURITY INVOKER functions the way it does to tables;
-- the function will use the caller's row-level permissions. Since we call it
-- from the service-role admin client, it has unrestricted access — which is
-- what we want for the accept route and the ingest paths.
-- ─────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION create_device_atomic(jsonb, jsonb, jsonb) TO service_role;

COMMIT;

-- =============================================================================
-- Verification (run manually after applying):
--
--   -- 1. Happy path: no trial, just master + external_id.
--   SELECT create_device_atomic(
--     jsonb_build_object(
--       'name',              'Atomicity Test Device',
--       'intended_use',      'Testing create_device_atomic',
--       'manufacturer_name', 'Test Manufacturer Ltd',
--       'approval_status',   'pre_approval',
--       'health_status',     'Amber'
--     ),
--     jsonb_build_object(
--       'id_type',   'legacy_unclassified',
--       'id_value',  'ATOMIC-TEST-001',
--       'source',    'migration_verification'
--     )
--   );
--   -- Expected: returns a new aletia_id. One new row in each of
--   -- device_master and device_external_ids.
--
--   -- 2. Unique-violation rolls back both writes.
--   SELECT create_device_atomic(
--     jsonb_build_object('name', 'Dup Test', 'intended_use', 'Should fail'),
--     jsonb_build_object('id_type', 'legacy_unclassified', 'id_value', 'ATOMIC-TEST-001')
--   );
--   -- Expected: ERROR 23505 duplicate key value violates unique constraint
--   --           "device_external_ids_id_type_value_unique". NO new
--   --           device_master row (verify via count).
--
--   -- 3. Cleanup.
--   DELETE FROM device_external_ids WHERE id_value = 'ATOMIC-TEST-001';
--   DELETE FROM device_master WHERE external_legacy_id = 'ATOMIC-TEST-001';
-- =============================================================================
