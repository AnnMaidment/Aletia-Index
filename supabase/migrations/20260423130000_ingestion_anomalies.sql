-- =============================================================================
-- Migration: 20260423130000_ingestion_anomalies.sql
-- Workstream A2b — observability supplement
--
-- Prerequisite: 20260423120000_device_trials_and_external_ids.sql
--
-- Why this exists:
--   The Scarlet classification miss (23 April) revealed a failure mode: when
--   an ingest path hits data it doesn't know how to classify, it buckets to
--   legacy_unclassified silently. By the time anyone looks at the breakdown,
--   the mystery rows have been there for weeks.
--
--   This table is the "alert bus" for unexpected inputs. Ingest paths write
--   here whenever they:
--     - receive an identifier whose shape doesn't match the expected regex
--     - hit a required field that's missing from a payload
--     - fail to classify a record they were supposed to classify
--     - find ambiguous merge candidates that don't meet confidence thresholds
--
--   Admin can then triage. Until then, the data still gets ingested (no loss),
--   but the fact that it was unusual is not silent.
--
-- Design choices:
--   - Flat log, no dedup in the DB. Ingest code inserts a new row per anomaly.
--     If volume becomes an issue, add (source, anomaly_type, identifier_value)
--     dedup with a seen_count in a future migration.
--   - aletia_id FK is nullable — an anomaly might reference a device we
--     created (identifier classification failure during creation), or might
--     be pre-creation (payload validation failure).
--   - resolved flag + resolution_note mean the table doubles as a lightweight
--     issue log. Admin can mark resolved with a note for the audit trail.
--
-- What this does NOT do:
--   - Validate anything at ingest time. That's a code change — this table
--     is just the store. The ingest-path rewrites (coming next in A2b)
--     will write here when they hit anomalies.
--   - Replace ingestion_review_queue. Different concern: review_queue is
--     for merge-gate decisions on new-but-valid data; anomalies is for
--     data that was unexpected.
-- =============================================================================

BEGIN;

CREATE TABLE ingestion_anomalies (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source                    text        NOT NULL,                     -- 'fda_sync', 'mhra_sync', 'ct_gov_ingest', 'breakthrough_ingest', 'pccp_ingest', 'admin_accept', 'scarlet_eudamed_sync'
  anomaly_type              text        NOT NULL,
  identifier_value          text,                                     -- the offending identifier, if applicable
  identifier_type_expected  text,                                     -- what we expected (e.g. 'fda_k_number')
  context                   jsonb,                                    -- free-form: raw payload excerpt, field names, upstream status, etc.
  aletia_id                 text        REFERENCES device_master(aletia_id) ON DELETE SET NULL,
  resolved                  boolean     NOT NULL DEFAULT false,
  resolved_at               timestamptz,
  resolved_by_email         text,
  resolution_note           text,
  first_seen_at             timestamptz NOT NULL DEFAULT now(),
  last_seen_at              timestamptz NOT NULL DEFAULT now(),
  created_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ingestion_anomalies_type_check CHECK (anomaly_type IN (
    'unknown_identifier_shape',     -- identifier regex didn't match any expected shape
    'unexpected_field_value',       -- a field had a value outside the known vocabulary
    'missing_required_field',       -- payload lacked a field we need
    'classification_failed',        -- couldn't assign id_type / couldn't route
    'merge_candidate_ambiguous',    -- 4d gate returned candidates but confidence was borderline
    'upstream_schema_change',       -- external API returned a shape we don't recognise
    'other'
  ))
);

-- Lookup indexes.
CREATE INDEX ingestion_anomalies_source_idx       ON ingestion_anomalies (source, created_at DESC);
CREATE INDEX ingestion_anomalies_unresolved_idx   ON ingestion_anomalies (created_at DESC) WHERE resolved = false;
CREATE INDEX ingestion_anomalies_aletia_id_idx    ON ingestion_anomalies (aletia_id) WHERE aletia_id IS NOT NULL;
CREATE INDEX ingestion_anomalies_type_idx         ON ingestion_anomalies (anomaly_type, created_at DESC);

COMMIT;

-- =============================================================================
-- Post-migration verification
-- =============================================================================
--
-- (1) Table exists and is empty:
--   SELECT count(*) FROM ingestion_anomalies;
--   Expected: 0
--
-- (2) CHECK constraint works — the following should error:
--   -- BEGIN;
--   -- INSERT INTO ingestion_anomalies (source, anomaly_type)
--   --   VALUES ('test', 'not_a_real_type');
--   -- Expected: ERROR  new row for relation "ingestion_anomalies" violates check constraint
--   -- ROLLBACK;
--
-- (3) FK to device_master works — the following should error:
--   -- BEGIN;
--   -- INSERT INTO ingestion_anomalies (source, anomaly_type, aletia_id)
--   --   VALUES ('test', 'other', 'ALT-999999');  -- non-existent aletia_id
--   -- Expected: ERROR  insert or update on table ... violates foreign key constraint
--   -- ROLLBACK;
-- =============================================================================
