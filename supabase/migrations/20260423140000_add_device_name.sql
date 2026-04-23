-- =============================================================================
-- Migration: 20260423140000_add_device_name.sql
-- Workstream A2b — supplement: device_master.name
--
-- Prerequisite: 20260421120000_aletia_ids.sql (A2a) and
--               20260423120000_device_trials_and_external_ids.sql (A2b main)
--
-- Why this exists:
--   device_master has intended_use (paragraph description) and manufacturer_name
--   but no dedicated device name field. Every upstream source (openFDA, MHRA
--   PARD, CT.gov, admin queue) provides a device name, and all of them have
--   been silently discarding it for months. See BUG-002.
--
--   A2b's merge-candidate service needs a short device name to run Dice
--   coefficient similarity against. intended_use doesn't work — it's too long
--   and paragraph-shaped for name-level comparison. Hence this column.
--
-- What this does:
--   1. Adds device_master.name text (nullable)
--   2. Regenerates search_vector to include name, so searches by device name
--      will work as soon as the column is populated.
--
-- What this does NOT do:
--   - Backfill existing 5,160 rows. They stay NULL for now. As each ingest
--     path gets rewritten in A2b, it will start writing name for new ingests
--     and touching name during re-sync of existing rows. A dedicated backfill
--     (re-querying openFDA for names of existing K-numbers) is a follow-up,
--     not part of this session.
--   - Add NOT NULL. Can't — 5,160 existing rows are NULL. Future migration
--     can tighten once backfill completes.
--
-- Safety:
--   - Transaction-wrapped.
--   - Dropping and recreating search_vector requires ACCESS EXCLUSIVE on
--     device_master; blocks reads for the duration. Expected < 5 seconds.
-- =============================================================================

BEGIN;

-- Step 1. Add the column.
ALTER TABLE device_master ADD COLUMN name text;

-- Step 2. Regenerate search_vector to include name.
-- Existing search_vector (from A2a) indexed aletia_id + external_legacy_id +
-- intended_use + manufacturer_name. Adding name means searches like
-- "Caption Vista" will hit once the column is populated.
ALTER TABLE device_master DROP COLUMN search_vector;

ALTER TABLE device_master
  ADD COLUMN search_vector text
  GENERATED ALWAYS AS (
    lower(
      COALESCE(aletia_id, '')          || ' ' ||
      COALESCE(external_legacy_id, '') || ' ' ||
      COALESCE(name, '')               || ' ' ||
      COALESCE(intended_use, '')       || ' ' ||
      COALESCE(manufacturer_name, '')
    )
  ) STORED;

COMMIT;

-- =============================================================================
-- Post-migration verification
-- =============================================================================
--
-- (1) name column exists and is all NULL:
--   SELECT
--     count(*) FILTER (WHERE name IS NULL)      AS null_names,
--     count(*) FILTER (WHERE name IS NOT NULL)  AS populated_names,
--     count(*) AS total
--   FROM device_master;
--   Expected: null_names = total = 5160. populated_names = 0.
--
-- (2) search_vector still works for existing queries:
--   SELECT aletia_id, manufacturer_name FROM device_master
--   WHERE search_vector ILIKE '%caption%'
--   LIMIT 5;
--   Expected: rows returned if any manufacturer_name contains "caption".
--
-- (3) Sanity-check search_vector shape:
--   SELECT search_vector FROM device_master LIMIT 1;
--   Expected: lowercased string containing aletia_id, external_legacy_id,
--   empty-string-where-name-was, intended_use, manufacturer_name, in order.
-- =============================================================================
