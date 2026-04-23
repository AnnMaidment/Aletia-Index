export type Device = {
  aletia_id: string
  external_legacy_id: string | null
  name: string | null
  intended_use: string
  manufacturer_name: string | null
  ai_ml_type: string | null
  accountability_tier: number | null
  health_status: 'Green' | 'Amber' | 'Red'
  aletia_verified: boolean
  last_automated_sync: string | null
  last_clinical_review: string | null
  specialty_link: string | null
  mode: string | null
  autonomy: string | null
  autonomous_output_mode:        boolean | null;
  autonomous_output_description: string | null;
  eu_risk_class:                 string | null; 
  pipeline_stage: string | null
  data_source: string | null
  breakthrough_designation: boolean
  excluded: boolean
  manufacturers: { name: string; hq_location: string } | null
  regional_registrations: {
    country: string
    regulatory_body: string
    clearance_type: string
    external_id_value: string | null
  }[]
  tech_specs: {
    api_type: string
    ehr_compat: string
    data_hosting: string
    fhir_compatible: boolean
    popia_compliant: boolean
  } | null
  // Optional relations — populated only when a query selects them.
  external_ids?: DeviceExternalId[]
  trials?: DeviceTrial[]
}

export const PIPELINE_LABELS: Record<string, string> = {
  proof_of_concept: 'Proof of Concept',
  pre_submission:   'Pre-submission',
  submitted:        'Submitted',
  under_review:     'Under Review',
  cleared:          'Cleared',
}

// ─────────────────────────────────────────────────────────────────────────────
// A2b — External identifier catalogue
// ─────────────────────────────────────────────────────────────────────────────

// Keep in sync with the CHECK constraint on device_external_ids.id_type
// (see supabase/migrations/20260423120000_device_trials_and_external_ids.sql).
export type ExternalIdType =
  | 'fda_k_number'
  | 'fda_de_novo'
  | 'fda_pma'
  | 'mhra_device_id'
  | 'ce_certificate'
  | 'eudamed_basic_udi'
  | 'nct'
  | 'udi_di'
  | 'scarlet_pccp_id'
  | 'health_canada_licence'
  | 'tga_artg'
  | 'pmda_approval'
  | 'legacy_unclassified'

export type DeviceExternalId = {
  id: string                        // uuid
  aletia_id: string
  id_type: ExternalIdType
  id_value: string
  jurisdiction: string | null       // ISO code, e.g. 'US', 'GB'; null for non-jurisdictional IDs like NCT
  is_primary: boolean
  source: string | null             // 'fda_sync', 'mhra_sync', 'ct_gov_ingest', 'admin_accept', 'backfill_a2b', etc.
  first_seen_at: string
  last_seen_at: string
  created_at: string
}

// ─────────────────────────────────────────────────────────────────────────────
// A2b — Device trials
// ─────────────────────────────────────────────────────────────────────────────

export type TrialRegistry =
  | 'ct_gov'
  | 'isrctn'
  | 'eu_ctr'
  | 'jprn'
  | 'anzctr'
  | 'other'

export type DeviceTrialStatus =
  | 'recruiting'
  | 'active'
  | 'completed'
  | 'terminated'
  | 'withdrawn'
  | 'suspended'
  | 'unknown'

export type TrialRole =
  | 'pivotal'
  | 'supporting'
  | 'exploratory'
  | 'unknown'

export type DeviceTrial = {
  id: string                        // uuid
  aletia_id: string
  nct_id: string | null
  trial_registry: TrialRegistry
  title: string | null
  brief_summary: string | null
  sponsor_name: string | null
  sponsor_type: string | null       // commercial | academic | other
  status: DeviceTrialStatus | null
  phase: string | null
  enrollment: number | null
  enrollment_type: string | null    // actual | estimated | anticipated
  start_date: string | null         // ISO date
  completion_date: string | null    // ISO date
  jurisdictions: string[] | null    // ISO country codes
  conditions_raw: string[] | null
  conditions_canonical: string[] | null
  is_device_trial: boolean | null
  irb_approved: boolean | null
  trial_role: TrialRole | null
  source_payload: Record<string, unknown> | null
  first_seen_at: string
  last_seen_at: string
  created_at: string
  updated_at: string
}

// ─────────────────────────────────────────────────────────────────────────────
// A2b — Ingestion anomalies (observability)
// ─────────────────────────────────────────────────────────────────────────────

// Keep in sync with the CHECK constraint on ingestion_anomalies.anomaly_type
// (see supabase/migrations/20260423130000_ingestion_anomalies.sql).
export type AnomalyType =
  | 'unknown_identifier_shape'
  | 'unexpected_field_value'
  | 'missing_required_field'
  | 'classification_failed'
  | 'merge_candidate_ambiguous'
  | 'upstream_schema_change'
  | 'other'

export type IngestionAnomaly = {
  id: string                        // uuid
  source: string                    // e.g. 'fda_sync', 'ct_gov_ingest'
  anomaly_type: AnomalyType
  identifier_value: string | null
  identifier_type_expected: string | null
  context: Record<string, unknown> | null
  aletia_id: string | null
  resolved: boolean
  resolved_at: string | null
  resolved_by_email: string | null
  resolution_note: string | null
  first_seen_at: string
  last_seen_at: string
  created_at: string
}

// ─────────────────────────────────────────────────────────────────────────────
// A2b — Merge candidate shape (written to ingestion_review_queue.possible_merge_candidates)
// ─────────────────────────────────────────────────────────────────────────────

export type MergeCandidateConfidence = 'high' | 'medium' | 'low'

export type MergeCandidate = {
  aletia_id: string
  confidence: MergeCandidateConfidence
  matched_on: {
    manufacturer: 'exact' | 'medium' | 'none'
    device_name_dice: number        // 0..1
  }
  existing_ids: Array<{
    id_type: ExternalIdType
    id_value: string
  }>
  claimed_by_email: string | null
}
