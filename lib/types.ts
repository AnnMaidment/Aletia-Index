export type Device = {
  device_id: string
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
  regional_registrations: { country: string; regulatory_body: string; clearance_type: string }[]
  tech_specs: {
    api_type: string
    ehr_compat: string
    data_hosting: string
    fhir_compatible: boolean
    popia_compliant: boolean
  } | null
}

export const PIPELINE_LABELS: Record<string, string> = {
  proof_of_concept: 'Proof of Concept',
  pre_submission:   'Pre-submission',
  submitted:        'Submitted',
  under_review:     'Under Review',
  cleared:          'Cleared',
}
