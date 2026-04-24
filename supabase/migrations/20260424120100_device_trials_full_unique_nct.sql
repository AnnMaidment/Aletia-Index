-- =============================================================================
-- Migration: 20260424120100_device_trials_full_unique_nct.sql
-- Workstream A2b — enable UPSERT onConflict on (aletia_id, nct_id)
--
-- Prerequisite: 20260423120000_device_trials_and_external_ids.sql
--
-- Problem:
--   The A2b schema created a PARTIAL unique index:
--     CREATE UNIQUE INDEX device_trials_aletia_nct_unique
--       ON device_trials (aletia_id, nct_id) WHERE nct_id IS NOT NULL;
--
--   Supabase's PostgREST UPSERT requires a FULL unique constraint as the
--   onConflict target. Partial indexes cannot be referenced. This blocks
--   the CT.gov ingest path from using UPSERT; it has to fall back to
--   explicit lookup-then-insert, which is ugly and race-y.
--
-- Fix:
--   Replace the partial unique index with a full unique constraint. The
--   trade-off: nct_id NULL rows (trials not yet registered in a public
--   registry) are now limited to one per device. That's the correct
--   business rule — a device shouldn't have two distinct "unregistered
--   trial" placeholder rows; one suffices until the NCT is assigned.
--
-- What this does:
--   1. Drop the existing partial unique index
--   2. Add a full UNIQUE constraint on (aletia_id, nct_id)
--   3. Postgres treats (ANYTHING, NULL) as distinct under UNIQUE (per SQL
--      standard: NULL != NULL), so multiple rows with nct_id=NULL for the
--      same aletia_id would still technically be allowed. To enforce the
--      "one unregistered trial per device" rule we'd need a separate partial
--      unique index WHERE nct_id IS NULL — which we add here as well.
--
-- Why both:
--   - Full constraint on (aletia_id, nct_id): enables UPSERT onConflict.
--   - Partial unique WHERE nct_id IS NULL: enforces business rule that a
--     device has at most one "unregistered trial" slot. Scan cost is tiny;
--     the table will have < 10000 rows for the foreseeable future.
--
-- Runtime: < 1 second. The existing partial index is already deduplicating;
-- converting it doesn't scan or rewrite data.
-- =============================================================================

BEGIN;

-- Drop the partial unique index.
DROP INDEX IF EXISTS device_trials_aletia_nct_unique;

-- Add a full unique constraint so PostgREST can reference it in onConflict.
-- NULL handling: (X, NULL) != (X, NULL) under SQL standard UNIQUE semantics,
-- which means this constraint does NOT enforce "one NULL-NCT row per device".
-- That business rule is enforced by the partial index below.
ALTER TABLE device_trials
  ADD CONSTRAINT device_trials_aletia_nct_unique
  UNIQUE (aletia_id, nct_id);

-- Belt-and-braces: cap NULL-NCT rows at one per device.
-- Callers who want multiple in-flight "unregistered" trials should assign
-- synthetic identifiers (e.g. internal_draft_id) rather than piling up NULLs.
CREATE UNIQUE INDEX device_trials_null_nct_one_per_device
  ON device_trials (aletia_id)
  WHERE nct_id IS NULL;

COMMIT;

-- =============================================================================
-- Verification after applying:
--
--   -- UPSERT should now work as onConflict target.
--   -- From the app, this is:
--   --   supabase.from('device_trials')
--   --     .upsert({...}, { onConflict: 'aletia_id,nct_id' })
--   --
--   -- Direct SQL check:
--   INSERT INTO device_trials (aletia_id, nct_id, trial_registry, title)
--   VALUES ('ALT-999999', 'NCT00000001', 'ct_gov', 'upsert-test-1')
--   ON CONFLICT (aletia_id, nct_id)
--   DO UPDATE SET title = 'upsert-test-1-updated';
--   -- Expected: statement succeeds (no constraint target error). If ALT-999999
--   --           doesn't exist, fails on FK, which is a separate and expected
--   --           thing. Use a real aletia_id to actually exercise the upsert.
--
--   -- Partial-NULL enforcement check:
--   INSERT INTO device_trials (aletia_id, nct_id, trial_registry, title)
--   VALUES ('ALT-001000', NULL, 'ct_gov', 'null-test-1');
--   INSERT INTO device_trials (aletia_id, nct_id, trial_registry, title)
--   VALUES ('ALT-001000', NULL, 'ct_gov', 'null-test-2');
--   -- Expected: second insert raises 23505 on
--   --           device_trials_null_nct_one_per_device. First one can be
--   --           rolled back afterwards.
-- =============================================================================
