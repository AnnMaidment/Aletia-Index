-- Migration: 20260610120000_add_merged_into.sql
-- Workstream: FDA dedup (Session 2b)
--
-- Adds device_master.merged_into — the absorbed-row marker (Decision 2). A
-- non-null merged_into means "this device_master row was absorbed into that
-- survivor as a same-product duplicate." Distinct from `excluded` (which means
-- "out of scope / not AI-ML"): a merged row WAS in scope, it is simply no longer
-- a separate identity.
--
-- Self-referential FK to device_master(aletia_id). ON DELETE SET NULL so a
-- (hypothetical) survivor deletion doesn't cascade-orphan; we never DELETE in
-- practice. Reversible: clearing merged_into restores the row to a standalone
-- device (the apply script's rollback does exactly this, plus moves the
-- external ids back).
--
-- CONSUMERS MUST FILTER: every public/index query that currently filters
-- `excluded = false` must also filter `merged_into IS NULL`, else absorbed
-- tombstones reappear in counts and listings. Grep for `.eq('excluded'` and
-- `excluded = false` before deploying the apply.

ALTER TABLE public.device_master
  ADD COLUMN IF NOT EXISTS merged_into text NULL
    REFERENCES public.device_master(aletia_id) ON DELETE SET NULL;

-- Partial index: the common lookups are "is this a tombstone?" and "what was
-- absorbed into survivor X?". Only index the non-null rows (the minority).
CREATE INDEX IF NOT EXISTS device_master_merged_into_idx
  ON public.device_master (merged_into)
  WHERE merged_into IS NOT NULL;

COMMENT ON COLUMN public.device_master.merged_into IS
  'If set, this row was absorbed into the referenced survivor aletia_id as a '
  'same-product FDA duplicate (Session 2 dedup). Such rows are hidden from the '
  'public index (filter merged_into IS NULL alongside excluded = false). '
  'Reversible: clear to restore as a standalone device.';
