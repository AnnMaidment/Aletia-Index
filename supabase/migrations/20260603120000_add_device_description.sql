-- 20260603120000_add_device_description.sql
--
-- Adds device_master.description: curated, display-facing description text,
-- kept SEPARATE from intended_use (which remains the raw source/regulatory
-- field). The home table and device page render:
--     description ?? intended_use ?? <trial brief_summary/title> ?? '—'
--
-- Rationale (the schema decision flagged in TODO "Description backfill"):
-- a new column keeps the raw intended_use intact and lossless, and lets
-- `description` be the curated text per source:
--   - CT.gov / pipeline → trial brief_summary
--       (scripts/backfill-pipeline-descriptions.ts)
--   - FDA               → openFDA "Indications for Use"
--       (do AFTER the FDA-list cleanup, so it only runs on survivors)
--   - MHRA / EUDAMED    → their respective ingest paths
--
-- search_vector is intentionally NOT regenerated here. Folding `description`
-- into the GENERATED tsvector means dropping + recreating that column, a
-- heavier and riskier change. Track separately if description should become
-- searchable.

BEGIN;

ALTER TABLE device_master
  ADD COLUMN IF NOT EXISTS description text;

COMMENT ON COLUMN device_master.description IS
  'Curated, display-facing description. UI falls back to intended_use when null. Distinct from intended_use (raw source text).';

COMMIT;
