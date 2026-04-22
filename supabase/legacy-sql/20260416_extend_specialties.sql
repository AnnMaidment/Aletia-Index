-- =====================================================================
-- Aletia — Extend specialty_taxonomy
-- Migration: 20260416_extend_specialties.sql
-- Run in Supabase SQL editor BEFORE running the specialty extraction.
--
-- Idempotent — safe to re-run. Uses ON CONFLICT DO NOTHING so existing
-- rows are untouched. Review the parent_cat values before running;
-- they follow the clinical-discipline pattern your existing rows use
-- (e.g. Cardiology → Internal Medicine).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Existing rows (for reference — do not re-insert):
--   Emergency Medicine  → Critical Care
--   Pathology           → Diagnostics
--   Radiology           → Imaging
--   Cardiology          → Internal Medicine
--   Oncology            → Internal Medicine
--   Psychiatry          → Mental Health
--   Dermatology         → Skin
--   Ophthalmology       → Surgery   ← you may want to change this to Diagnostics
-- ---------------------------------------------------------------------

insert into public.specialty_taxonomy (specialty_name, parent_cat) values
  -- Internal Medicine family (grouping with existing Cardiology / Oncology)
  ('Endocrinology',              'Internal Medicine'),
  ('Gastroenterology',           'Internal Medicine'),
  ('Pulmonology',                'Internal Medicine'),
  ('Neurology',                  'Internal Medicine'),
  ('Infectious Disease',         'Internal Medicine'),
  ('Rheumatology',               'Internal Medicine'),
  ('Nephrology',                 'Internal Medicine'),
  ('Hematology',                 'Internal Medicine'),

  -- Surgical disciplines (grouping with existing Ophthalmology if you keep it there)
  ('Urology',                    'Surgery'),
  ('Orthopaedics',               'Surgery'),
  ('Otolaryngology',             'Surgery'),   -- ENT

  -- Women's health (new parent — no existing cluster fits)
  ('Obstetrics & Gynaecology',   'Women''s Health'),

  -- Primary / population health
  ('Primary Care',               'Primary Care'),
  ('Paediatrics',                'Primary Care'),   -- arguable; adjust if you prefer its own group

  -- Specialties where modality/area blur — keeping as-is from your schema
  ('Anaesthesiology',            'Critical Care'),
  ('Intensive Care',             'Critical Care'),

  ('Dentistry',                  'Surgery')           -- AI dental imaging is common

on conflict (specialty_name) do nothing;

-- ---------------------------------------------------------------------
-- Sanity check — run after insert to confirm your new shape:
--
--   select specialty_name, parent_cat
--     from specialty_taxonomy
--    order by parent_cat nulls last, specialty_name;
--
-- Expected row count after: 8 existing + 17 new = 25.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Optional: fix Ophthalmology's parent_cat.
-- Most AI ophthalmology devices are diagnostic (retinal imaging, fundus
-- photography, OCT analysis), not surgical. Uncomment to change:
--
-- update public.specialty_taxonomy
--    set parent_cat = 'Diagnostics'
--  where specialty_name = 'Ophthalmology';
-- ---------------------------------------------------------------------
