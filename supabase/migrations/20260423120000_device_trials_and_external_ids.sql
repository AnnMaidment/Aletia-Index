-- =============================================================================
-- Migration: 20260423120000_device_trials_and_external_ids.sql
-- Workstream A2b — device_trials + device_external_ids
--
-- Prerequisite: 20260421120000_aletia_ids.sql (A2a) must have been applied.
-- Relies on: device_master(aletia_id) as PK, external_legacy_id column,
--            aletia_id_seq sequence.
--
-- What this does:
--   1.  Create device_external_ids — catalogue of all external identifiers a
--       device has accumulated (FDA K-numbers, MHRA IDs, NCT numbers, etc.)
--   2.  Create device_trials — one row per trial per device; separate from
--       pre_approval_profile because trials and regulatory clearance are
--       genuinely different objects with different lifecycles
--   3.  Add external_id_value to regional_registrations — links each regional
--       registration to the specific identifier it was issued under
--   4.  Add possible_merge_candidates to ingestion_review_queue — jsonb payload
--       written by ingest paths, read by admin queue UI
--   5.  Backfill device_external_ids: one row per existing device_master row,
--       classified from the shape of external_legacy_id
--   6.  Backfill regional_registrations.external_id_value where the device's
--       external_legacy_id matches the jurisdiction
--   7.  Backfill device_trials from pre_approval_profile rows that have an NCT
--   8.  Install trigger: regional_registrations.external_id_value must exist in
--       device_external_ids for the same aletia_id
--   9.  Install trigger: device_trials.updated_at maintained on UPDATE
--
-- What this does NOT do:
--   - Touch any application code. That comes next.
--   - Drop trial columns from pre_approval_profile (nct_id, trial_status, etc.)
--     — those get dropped in a follow-up (Tier 1 cleanup, TODO item D3)
--     AFTER the code is migrated to read from device_trials.
--   - Kill the hybrid auto-create branch of clinicalTrialsIngest — that's code,
--     not schema.
--   - Touch search_vector on device_master. Per design decision (option 4),
--     search-by-secondary-ID is handled at query time in the app by UNIONing
--     device_external_ids into the search.
--
-- Safety:
--   - Wrapped in a single transaction. ROLLBACK on any error.
--   - Backfills use strictly-1:1 mapping logic; no data loss.
--   - Expected runtime: < 15 seconds on ~5,160 devices + ~5,149 registrations.
--
-- Before running:
--   - Confirm A2a verification queries still pass (no regressions).
--   - Take a fresh Supabase backup.
--   - Run on staging first. Verify all post-migration queries at the bottom.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1. Create device_external_ids
--
-- Purpose: one row per external identifier per device. A device cleared by
-- the FDA with K230001, registered in the UK under MHRA-47392, and enrolled
-- in NCT05386654 would have three rows — all pointing to the same aletia_id.
--
-- Primary ID semantics: exactly one row per device has is_primary=true. The
-- primary is what appears in device_master.external_legacy_id (denormalised
-- convenience). Enforced by the partial unique index below; at-least-one is
-- an application-level invariant (every create_new_device must write one).
--
-- id_type constrained to a known set today; added as a CHECK rather than an
-- ENUM so we can extend without an ALTER TYPE when new jurisdictions come in.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE device_external_ids (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  aletia_id       text        NOT NULL REFERENCES device_master(aletia_id) ON DELETE CASCADE,
  id_type         text        NOT NULL,
  id_value        text        NOT NULL,
  jurisdiction    text,                       -- NULL for non-jurisdictional IDs (e.g. NCT)
  is_primary      boolean     NOT NULL DEFAULT false,
  source          text,                       -- 'fda_sync', 'mhra_sync', 'ct_gov_ingest', 'admin_accept', 'backfill_a2b', etc.
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT device_external_ids_id_type_check CHECK (id_type IN (
    'fda_k_number',
    'fda_de_novo',
    'fda_pma',
    'mhra_device_id',
    'ce_certificate',
    'eudamed_basic_udi',
    'nct',
    'udi_di',
    'scarlet_pccp_id',         -- Scarlet-managed PCCP identifier; coexists with CE/MHRA/EU
    'health_canada_licence',   -- reserved for future
    'tga_artg',                -- reserved for future
    'pmda_approval',           -- reserved for future
    'legacy_unclassified'      -- backfill only — values we couldn't shape-classify
  ))
);

-- Uniqueness of the (type, value) pair: a specific K-number can belong to
-- exactly one device. Enforced globally, not per-device.
CREATE UNIQUE INDEX device_external_ids_id_type_value_unique
  ON device_external_ids (id_type, id_value);

-- At most one primary per device. At-least-one is an application invariant.
CREATE UNIQUE INDEX device_external_ids_one_primary_per_device
  ON device_external_ids (aletia_id) WHERE is_primary = true;

-- Lookup indexes.
CREATE INDEX device_external_ids_aletia_id_idx ON device_external_ids (aletia_id);
CREATE INDEX device_external_ids_id_value_idx  ON device_external_ids (id_value);
CREATE INDEX device_external_ids_id_type_idx   ON device_external_ids (id_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2. Create device_trials
--
-- Purpose: one row per (device, trial) pair. A device currently trialling in
-- three jurisdictions has three rows — or one row with jurisdictions text[]
-- listing all three, depending on how CT.gov records it. We denormalise both
-- ways: jurisdictions text[] for array-style queries, and (aletia_id, nct_id)
-- unique so the same trial can't be recorded twice for the same device.
--
-- source_payload jsonb retains the raw shape we ingested for future re-parsing
-- without a second API fetch.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE device_trials (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  aletia_id             text        NOT NULL REFERENCES device_master(aletia_id) ON DELETE CASCADE,
  nct_id                text,
  trial_registry        text        NOT NULL DEFAULT 'ct_gov',  -- ct_gov|isrctn|eu_ctr|jprn|anzctr|other
  title                 text,
  brief_summary         text,
  sponsor_name          text,
  sponsor_type          text,                                   -- commercial|academic|other
  status                text,                                   -- recruiting|active|completed|terminated|withdrawn|suspended|unknown
  phase                 text,
  enrollment            integer,
  enrollment_type       text,                                   -- actual|estimated|anticipated
  start_date            date,
  completion_date       date,
  jurisdictions         text[],                                 -- ISO country codes
  conditions_raw        text[],
  conditions_canonical  text[],
  is_device_trial       boolean,
  irb_approved          boolean,
  trial_role            text,                                   -- pivotal|supporting|exploratory|unknown
  source_payload        jsonb,
  first_seen_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at          timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Same trial can't be recorded twice for the same device. NULL nct_id is
-- allowed (for trials not yet on a public registry), and multiple NULL rows
-- are allowed (no deduplication signal without an NCT).
CREATE UNIQUE INDEX device_trials_aletia_nct_unique
  ON device_trials (aletia_id, nct_id) WHERE nct_id IS NOT NULL;

-- Lookup indexes.
CREATE INDEX device_trials_aletia_id_idx ON device_trials (aletia_id);
CREATE INDEX device_trials_nct_id_idx    ON device_trials (nct_id) WHERE nct_id IS NOT NULL;

-- Condition search — GIN for array containment queries.
CREATE INDEX device_trials_conditions_raw_gin
  ON device_trials USING gin (conditions_raw);
CREATE INDEX device_trials_conditions_canonical_gin
  ON device_trials USING gin (conditions_canonical);

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 3. Add external_id_value to regional_registrations
--
-- Purpose: tell each regional registration which external identifier it was
-- issued under. For a device with both FDA K-number and MHRA ID, the US row
-- will carry the K-number, the GB row will carry the MHRA numeric ID.
--
-- Nullable: some older rows may not resolve during backfill if their device
-- lacks a matching-jurisdiction identifier in external_legacy_id. Those stay
-- NULL until the relevant sync next runs and populates them.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE regional_registrations ADD COLUMN external_id_value text;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 4. Add possible_merge_candidates to ingestion_review_queue
--
-- Purpose: when an ingest path queues an entry for review (because the
-- identifier isn't already known and one or more fuzzy-matched candidates
-- exist), it writes the candidate list here. The admin queue UI reads this
-- to render context-sensitive merge buttons.
--
-- Shape (application-level, not enforced in schema):
--   [
--     {
--       "aletia_id": "ALT-006001",
--       "confidence": "high"|"medium"|"low",
--       "matched_on": { "manufacturer": "exact", "device_name_dice": 0.87 },
--       "existing_ids": [{"id_type": "fda_k_number", "id_value": "K230001"}],
--       "claimed_by_email": null
--     }
--   ]
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ingestion_review_queue ADD COLUMN possible_merge_candidates jsonb;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 5. Backfill device_external_ids from device_master.external_legacy_id
--
-- Classification is shape-based. Based on the 23 April staging breakdown,
-- we expect to see six shapes in production:
--   - fda_k_number       (~5066 rows, ~98%)   K followed by digits
--   - mhra_device_id     (~58 rows)           MHRA- prefix, numeric
--   - fda_de_novo        (~17 rows)           DEN prefix, numeric
--   - nct                (~12 rows)           CT-NCT prefix (from admin accept)
--   - scarlet_pccp_id    (~2 rows)            SCAR- prefix, version-like
--   - legacy_unclassified (~5 rows)           UDI-prefixed mock rows
--
-- Prefix-stripping: happens only where the prefix was an app-level synthesis.
--   'MHRA-47392'    -> id_type=mhra_device_id,    id_value='47392'
--                      (MHRA- was added by mhraSync.ts, not native)
--   'CT-NCT05386654'-> id_type=nct,               id_value='NCT05386654'
--                      (CT- was added by admin accept, NCT is canonical)
--   'K230001'       -> id_type=fda_k_number,      id_value='K230001'   (K is canonical)
--   'DEN210001'     -> id_type=fda_de_novo,       id_value='DEN210001' (DEN is canonical)
--   'SCAR-2.2.1.1'  -> id_type=scarlet_pccp_id,   id_value='SCAR-2.2.1.1'
--                      (SCAR- is part of Scarlet's native format; preserve)
--
-- Every resulting row has is_primary=true because every source device had
-- exactly one legacy identifier. Scarlet devices are expected to grow
-- additional external IDs over time (CE, MHRA, EUDAMED) as EU ingest lands;
-- those will be inserted as additional rows with is_primary=false.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO device_external_ids
  (aletia_id, id_type, id_value, jurisdiction, is_primary, source,
   first_seen_at, last_seen_at, created_at)
SELECT
  dm.aletia_id,
  CASE
    WHEN dm.external_legacy_id ~ '^K[0-9]+$'           THEN 'fda_k_number'
    WHEN dm.external_legacy_id ~ '^DEN[0-9]+$'         THEN 'fda_de_novo'
    WHEN dm.external_legacy_id ~ '^MHRA-[0-9]+$'       THEN 'mhra_device_id'
    WHEN dm.external_legacy_id ~ '^CT-NCT[0-9]+$'      THEN 'nct'
    WHEN dm.external_legacy_id ~ '^NCT[0-9]+$'         THEN 'nct'
    WHEN dm.external_legacy_id ~ '^SCAR-'              THEN 'scarlet_pccp_id'
    ELSE 'legacy_unclassified'
  END AS id_type,
  CASE
    WHEN dm.external_legacy_id ~ '^MHRA-[0-9]+$'  THEN substring(dm.external_legacy_id from 6)  -- strip 'MHRA-'
    WHEN dm.external_legacy_id ~ '^CT-NCT[0-9]+$' THEN substring(dm.external_legacy_id from 4)  -- strip 'CT-'
    ELSE dm.external_legacy_id
  END AS id_value,
  CASE
    WHEN dm.external_legacy_id ~ '^K[0-9]+$'     THEN 'US'
    WHEN dm.external_legacy_id ~ '^DEN[0-9]+$'   THEN 'US'
    WHEN dm.external_legacy_id ~ '^MHRA-[0-9]+$' THEN 'GB'
    ELSE NULL
  END AS jurisdiction,
  true AS is_primary,
  'backfill_a2b' AS source,
  dm.created_at AS first_seen_at,
  now()         AS last_seen_at,
  now()         AS created_at
FROM device_master dm
WHERE dm.external_legacy_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 6. Backfill regional_registrations.external_id_value
--
-- Match the jurisdiction of the regional registration to the shape of the
-- device's legacy ID. For MHRA, we store the raw numeric value (to match
-- device_external_ids.id_value exactly — required by the trigger in step 8).
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE regional_registrations rr
SET external_id_value = CASE
  WHEN rr.country = 'US' AND rr.regulatory_body = 'FDA'
    AND dm.external_legacy_id ~ '^K[0-9]+$'
    THEN dm.external_legacy_id
  WHEN rr.country = 'US' AND rr.regulatory_body = 'FDA'
    AND dm.external_legacy_id ~ '^DEN[0-9]+$'
    THEN dm.external_legacy_id
  WHEN rr.country = 'GB' AND rr.regulatory_body = 'MHRA'
    AND dm.external_legacy_id ~ '^MHRA-[0-9]+$'
    THEN substring(dm.external_legacy_id from 6)
  ELSE NULL
END
FROM device_master dm
WHERE rr.device_link = dm.aletia_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 7. Backfill device_trials from pre_approval_profile
--
-- Copy trial columns across for rows that have an NCT. pre_approval_profile
-- retains the columns for now — they'll be dropped in a Tier 1 cleanup after
-- the application code is reading from device_trials instead.
--
-- Only pulls rows with non-null trial_identifier. Expect ~2 rows per STATE.md
-- (post-admin-accept CT trials). Any pre_approval_profile trial signal
-- without an NCT stays in pre_approval_profile until manually processed.
--
-- Column name note: pre_approval_profile.trial_identifier holds the NCT
-- number. A2b prompt and STATE.md refer to it as nct_id, but the schema
-- column is trial_identifier — we read from the real column and write into
-- device_trials.nct_id (the canonical name going forward).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO device_trials
  (aletia_id, nct_id, trial_registry, status, phase, enrollment,
   start_date, completion_date, jurisdictions,
   is_device_trial, irb_approved,
   source_payload, first_seen_at, last_seen_at)
SELECT
  pp.device_id             AS aletia_id,      -- child column name kept as device_id per A2a scope; holds aletia_id values
  pp.trial_identifier      AS nct_id,
  'ct_gov'                 AS trial_registry,
  pp.trial_status          AS status,
  pp.trial_phase           AS phase,
  pp.trial_enrollment      AS enrollment,
  pp.trial_start_date      AS start_date,
  pp.trial_completion_date AS completion_date,
  pp.trial_locations       AS jurisdictions,  -- text[] of ISO codes
  true                     AS is_device_trial,  -- admin-accept path implies device-trial
  pp.irb_approved          AS irb_approved,
  jsonb_build_object(
    'backfilled_from', 'pre_approval_profile',
    'trial_phase',     pp.trial_phase,
    'trial_status',    pp.trial_status
  )                        AS source_payload,
  COALESCE(pp.created_at, now()) AS first_seen_at,
  now()                    AS last_seen_at
FROM pre_approval_profile pp
WHERE pp.trial_identifier IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 8. Install trigger: regional_registrations.external_id_value must
--         exist in device_external_ids for the same aletia_id.
--
-- This is a soft FK — we can't use a real FK because device_external_ids.id_value
-- is not unique on its own (only (id_type, id_value) is). The trigger matches
-- on the pair (aletia_id, id_value) which uniquely identifies a row within a
-- device's identifier set.
--
-- Order discipline required in application code: always INSERT the
-- device_external_ids row BEFORE setting regional_registrations.external_id_value.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_regional_external_id_consistency()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.external_id_value IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM device_external_ids
    WHERE aletia_id = NEW.device_link
      AND id_value  = NEW.external_id_value
  ) THEN
    RAISE EXCEPTION
      'regional_registrations.external_id_value % has no matching row in device_external_ids for aletia_id %',
      NEW.external_id_value, NEW.device_link;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_regional_external_id_consistency
  BEFORE INSERT OR UPDATE OF external_id_value, device_link
  ON regional_registrations
  FOR EACH ROW
  EXECUTE FUNCTION enforce_regional_external_id_consistency();

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 9. Install trigger: device_trials.updated_at maintained on UPDATE.
--
-- Only on device_trials. device_external_ids uses last_seen_at written
-- explicitly by the ingest code (distinction: "we saw this identifier today"
-- vs "we modified this row"), so no updated_at / no trigger there.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_device_trials_updated_at
  BEFORE UPDATE ON device_trials
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMIT;

-- =============================================================================
-- Post-migration verification queries (run these SEPARATELY after COMMIT)
-- =============================================================================
--
-- (1) Every device has exactly one is_primary=true row:
--   SELECT
--     (SELECT count(*) FROM device_master) AS device_count,
--     (SELECT count(*) FROM device_external_ids WHERE is_primary = true) AS primary_count;
--   Expected: device_count = primary_count = 5160
--
-- (2) Classification breakdown — sanity-check the shape heuristics.
--     These numbers come from the staging breakdown run on 23 April; if the
--     row count on prod drifts (more FDA devices synced, more Scarlet rows,
--     etc.) the numbers shift but the ratios hold.
--   SELECT id_type, count(*) FROM device_external_ids GROUP BY id_type ORDER BY count(*) DESC;
--   Expected (staging):
--     fda_k_number         5066
--     mhra_device_id         58
--     fda_de_novo            17
--     nct                    12
--     scarlet_pccp_id         2
--     legacy_unclassified     5   (the UDI-prefixed mocks)
--     ---------------------------
--     total                5160
--
-- (3) No duplicate (id_type, id_value):
--   SELECT id_type, id_value, count(*) FROM device_external_ids
--   GROUP BY id_type, id_value HAVING count(*) > 1;
--   Expected: zero rows.
--
-- (4) device_trials populated for admin-accepted CT entries:
--   SELECT count(*) FROM device_trials;
--   Expected: ~2 (matches count of pre_approval_profile rows with
--   trial_identifier NOT NULL pre-migration, i.e.
--   SELECT count(*) FROM pre_approval_profile WHERE trial_identifier IS NOT NULL)
--
-- (5) regional_registrations backfill coverage — how many got populated:
--   SELECT count(*) FILTER (WHERE external_id_value IS NOT NULL) AS filled,
--          count(*) FILTER (WHERE external_id_value IS NULL)     AS empty,
--          count(*) AS total
--   FROM regional_registrations;
--   Expected: filled should be close to total. empty > 0 is possible if some
--   devices have a regional_registrations row for a jurisdiction that doesn't
--   match the device's external_legacy_id (e.g., MHRA row but K-number primary).
--
-- (6) No orphaned external_id_value (consistency trigger sanity):
--   SELECT count(*) FROM regional_registrations rr
--   WHERE rr.external_id_value IS NOT NULL
--     AND NOT EXISTS (
--       SELECT 1 FROM device_external_ids dei
--       WHERE dei.aletia_id = rr.device_link
--         AND dei.id_value  = rr.external_id_value
--     );
--   Expected: 0
--
-- (7) possible_merge_candidates column exists and is null for all existing rows:
--   SELECT count(*) FILTER (WHERE possible_merge_candidates IS NULL)     AS null_count,
--          count(*) FILTER (WHERE possible_merge_candidates IS NOT NULL) AS populated,
--          count(*) AS total
--   FROM ingestion_review_queue;
--   Expected: null_count = total = 487 (all existing queue rows). Populated = 0.
--
-- (8) Trigger rejects bad writes (optional, rollback after):
--   -- BEGIN;
--   -- UPDATE regional_registrations SET external_id_value = 'FAKE-DOES-NOT-EXIST'
--   --   WHERE reg_id = (SELECT reg_id FROM regional_registrations LIMIT 1);
--   -- Expected: ERROR 'regional_registrations.external_id_value FAKE-DOES-NOT-EXIST
--   --           has no matching row in device_external_ids for aletia_id ALT-xxxxxx'
--   -- ROLLBACK;
-- =============================================================================
