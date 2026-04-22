-- =============================================================================
-- Migration: 20260421_aletia_ids.sql
-- Workstream A2a — Aletia-assigned device IDs as primary key
--
-- What this does:
--   1. Creates sequence aletia_id_seq starting at 1000
--   2. Adds device_master.aletia_id text, backfills in created_at order
--   3. Renames device_master.device_id -> external_legacy_id
--   4. Makes aletia_id the new primary key
--   5. Rewires all 5 FK constraints (claim_requests, clinical_audits,
--      pre_approval_profile, regional_registrations, tech_specs) to target
--      device_master.aletia_id
--   6. Updates child-table FK column VALUES from old device_id to new aletia_id
--   7. Drops+recreates the GENERATED search_vector column to reference both
--      aletia_id and external_legacy_id (so K-number search still works)
--   8. Adds index on external_legacy_id for redirect-layer lookups
--
-- What this does NOT do:
--   - Rename child-table FK column names (pre_approval_profile.device_id stays
--     as a column name; only its values change). Per session scope.
--   - Parse external_legacy_id into typed columns (fda_k_number, nct_id, etc.).
--   - Touch any application code.
--
-- Safety:
--   - Wrapped in a single transaction. ROLLBACK on any error; all-or-nothing.
--   - ALTER TABLE takes ACCESS EXCLUSIVE lock; no concurrent writes possible.
--   - Expected runtime: < 10 seconds on ~5,160 devices + 5,149 registrations.
--
-- Before running:
--   - Take a fresh Supabase backup (Dashboard -> Database -> Backups).
--   - Confirm staging first. Do not run on production until staging is verified.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1. Create the sequence (seed = 1000 so first IDs are 6-digit uniform)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS aletia_id_seq
  START WITH 1000
  MINVALUE 1000
  NO CYCLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2. Add aletia_id column (no default yet; default set after backfill so
--         we can assign in deterministic created_at order).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE device_master ADD COLUMN aletia_id text;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 3. Backfill aletia_id for all existing rows in created_at order.
--
--         Tiebreaker: device_id (stable). Done this way rather than with
--         nextval() inside an ORDERed SELECT because Postgres does not
--         guarantee nextval() evaluation order matches the ORDER BY.
--         Pure arithmetic on row_number() is deterministic.
-- ─────────────────────────────────────────────────────────────────────────────
WITH ordered AS (
  SELECT device_id,
         row_number() OVER (ORDER BY created_at NULLS LAST, device_id) AS rn
  FROM device_master
),
allocated AS (
  SELECT device_id,
         'ALT-' || lpad((999 + rn)::text, 6, '0') AS new_id
  FROM ordered
)
UPDATE device_master dm
SET aletia_id = allocated.new_id
FROM allocated
WHERE dm.device_id = allocated.device_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 4. Advance the sequence past the backfilled range so the first
--         DB-allocated ID (on next INSERT) is the next integer in line.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT setval(
  'aletia_id_seq',
  (SELECT count(*) FROM device_master) + 999  -- last_value; next nextval() is +1
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 5. Enforce NOT NULL on aletia_id, set the default for future inserts.
--         Uniqueness comes from the PK swap in step 10.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE device_master ALTER COLUMN aletia_id SET NOT NULL;

ALTER TABLE device_master
  ALTER COLUMN aletia_id
  SET DEFAULT 'ALT-' || lpad(nextval('aletia_id_seq')::text, 6, '0');

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 6. Drop the generated search_vector column. It references device_id
--         directly, so we must drop it before renaming device_id. We recreate
--         it in step 12 with an expression that includes both identifiers.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE device_master DROP COLUMN search_vector;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 7. Drop all FK constraints that target device_master(device_id) so we
--         can rewrite their column values in step 8 without tripping the FK.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE claim_requests         DROP CONSTRAINT claim_requests_device_id_fkey;
ALTER TABLE clinical_audits        DROP CONSTRAINT clinical_audits_device_link_fkey;
ALTER TABLE pre_approval_profile   DROP CONSTRAINT pre_approval_profile_device_id_fkey;
ALTER TABLE regional_registrations DROP CONSTRAINT regional_registrations_device_link_fkey;
ALTER TABLE tech_specs             DROP CONSTRAINT tech_specs_device_link_fkey;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 8. Repopulate child-table FK columns with the new aletia_id values.
--
--         Column NAMES on child tables stay the same (device_id / device_link)
--         — only the VALUES change from K-numbers / NCT-strings / ULIDs to
--         ALT-xxxxxx strings. Renaming these column names is deliberately
--         deferred to a future session.
--
--         Existing unique constraints on pp.device_id and rr.(device_link,
--         country, regulatory_body) stay valid because the value mapping is
--         strictly 1:1.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE claim_requests c
SET device_id = dm.aletia_id
FROM device_master dm
WHERE c.device_id = dm.device_id;

UPDATE clinical_audits ca
SET device_link = dm.aletia_id
FROM device_master dm
WHERE ca.device_link = dm.device_id;

UPDATE pre_approval_profile pp
SET device_id = dm.aletia_id
FROM device_master dm
WHERE pp.device_id = dm.device_id;

UPDATE regional_registrations rr
SET device_link = dm.aletia_id
FROM device_master dm
WHERE rr.device_link = dm.device_id;

UPDATE tech_specs ts
SET device_link = dm.aletia_id
FROM device_master dm
WHERE ts.device_link = dm.device_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 9. Swap the primary key on device_master.
--   - Drop old PK (device_master_pkey on device_id)
--   - Rename device_id to external_legacy_id (preserves all legacy values)
--   - Add new PK on aletia_id
--
-- The child-table btree indexes (idx_claim_requests_device, idx_pre_approval_device,
-- pre_approval_profile_device_id_unique, regional_registrations_device_country_
-- body_unique, tech_specs_pkey) survive this automatically — they're independent
-- of the FK constraints we dropped.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE device_master DROP CONSTRAINT device_master_pkey;

ALTER TABLE device_master RENAME COLUMN device_id TO external_legacy_id;

ALTER TABLE device_master ADD PRIMARY KEY (aletia_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 10. Re-add FK constraints on child tables, now pointing at
--          device_master(aletia_id). ON DELETE behaviours preserved exactly
--          as they were before the migration.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE claim_requests
  ADD CONSTRAINT claim_requests_device_id_fkey
  FOREIGN KEY (device_id) REFERENCES device_master(aletia_id)
  ON DELETE SET NULL;

ALTER TABLE clinical_audits
  ADD CONSTRAINT clinical_audits_device_link_fkey
  FOREIGN KEY (device_link) REFERENCES device_master(aletia_id);

ALTER TABLE pre_approval_profile
  ADD CONSTRAINT pre_approval_profile_device_id_fkey
  FOREIGN KEY (device_id) REFERENCES device_master(aletia_id)
  ON DELETE CASCADE;

ALTER TABLE regional_registrations
  ADD CONSTRAINT regional_registrations_device_link_fkey
  FOREIGN KEY (device_link) REFERENCES device_master(aletia_id);

ALTER TABLE tech_specs
  ADD CONSTRAINT tech_specs_device_link_fkey
  FOREIGN KEY (device_link) REFERENCES device_master(aletia_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 11. Recreate the generated search_vector column.
--          Now includes BOTH aletia_id (for /device/ALT-xxxxxx searches) and
--          external_legacy_id (so searching "K230001" still hits the right row
--          from the home-page search bar).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE device_master
  ADD COLUMN search_vector text
  GENERATED ALWAYS AS (
    lower(
      COALESCE(aletia_id, '')          || ' ' ||
      COALESCE(external_legacy_id, '') || ' ' ||
      COALESCE(intended_use, '')       || ' ' ||
      COALESCE(manufacturer_name, '')
    )
  ) STORED;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 12. Add a btree index on external_legacy_id for the redirect layer.
--          The /device/[id] route will look up by external_legacy_id whenever
--          the incoming [id] doesn't match the ALT-xxxxxx shape, to emit a
--          301/308 to the canonical URL.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX idx_device_master_external_legacy_id
  ON device_master (external_legacy_id)
  WHERE external_legacy_id IS NOT NULL;

COMMIT;

-- =============================================================================
-- Post-migration verification queries (run these SEPARATELY, after COMMIT)
-- =============================================================================
--
-- (1) Every device has an aletia_id matching the expected shape:
--   SELECT count(*) FROM device_master WHERE aletia_id !~ '^ALT-\d{6,}$';
--   Expected: 0
--
-- (2) No duplicate aletia_ids:
--   SELECT count(*) AS total, count(DISTINCT aletia_id) AS distinct_count FROM device_master;
--   Expected: total = distinct_count = 5160
--
-- (3) Every pre_approval_profile row still joins to a device:
--   SELECT count(*) FROM pre_approval_profile pp
--     LEFT JOIN device_master dm ON dm.aletia_id = pp.device_id
--     WHERE dm.aletia_id IS NULL;
--   Expected: 0
--
-- (4) Same check for each other child table:
--   SELECT 'claim_requests'        AS tbl, count(*) AS orphaned FROM claim_requests c
--     LEFT JOIN device_master dm ON dm.aletia_id = c.device_id
--     WHERE c.device_id IS NOT NULL AND dm.aletia_id IS NULL
--   UNION ALL
--   SELECT 'regional_registrations', count(*) FROM regional_registrations rr
--     LEFT JOIN device_master dm ON dm.aletia_id = rr.device_link
--     WHERE dm.aletia_id IS NULL
--   UNION ALL
--   SELECT 'tech_specs',             count(*) FROM tech_specs ts
--     LEFT JOIN device_master dm ON dm.aletia_id = ts.device_link
--     WHERE dm.aletia_id IS NULL
--   UNION ALL
--   SELECT 'clinical_audits',        count(*) FROM clinical_audits ca
--     LEFT JOIN device_master dm ON dm.aletia_id = ca.device_link
--     WHERE dm.aletia_id IS NULL;
--   Expected: orphaned = 0 for every row
--
-- (5) Sequence is positioned correctly:
--   SELECT last_value FROM aletia_id_seq;
--   Expected: 6159 (= 5160 rows + 999 seed offset)
--
-- (6) Spot-check legacy values preserved:
--   SELECT aletia_id, external_legacy_id FROM device_master ORDER BY created_at LIMIT 5;
--   Expected: aletia_id = ALT-001000..ALT-001004, external_legacy_id = original K-numbers/ULIDs
--
-- (7) Test an insert with the default:
--   -- (don't actually run this on staging without cleanup)
--   -- INSERT INTO device_master (external_legacy_id, manufacturer_name)
--   --   VALUES (NULL, 'TEST — DELETE ME') RETURNING aletia_id;
--   -- Expected: 'ALT-006160'
--   -- Then: DELETE FROM device_master WHERE manufacturer_name = 'TEST — DELETE ME';
-- =============================================================================
