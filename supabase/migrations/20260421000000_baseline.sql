CREATE TABLE public.ingestion_review_queue (
    queue_id uuid NOT NULL DEFAULT gen_random_uuid(),
    source text NOT NULL,
    source_id text NOT NULL,
    device_name text,
    manufacturer text,
    pccp_authorized_date date,
    raw_data jsonb,
    status text NOT NULL DEFAULT 'pending'::text,
    review_note text,
    created_at timestamp with time zone DEFAULT now(),
    reviewed_at timestamp with time zone,
    reviewed_by text,
    specialty_inferred text,
    specialty_confidence text,
    specialty_signals jsonb,
    sponsor_type text,
    review_reason text
);

CREATE TABLE public.claim_requests (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    device_id text,
    manufacturer_id uuid,
    requester_email text NOT NULL,
    requester_name text,
    requester_role text,
    company_url text,
    token uuid DEFAULT gen_random_uuid(),
    token_expires_at timestamp with time zone DEFAULT (now() + '72:00:00'::interval),
    status text DEFAULT 'pending'::text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.pre_approval_profile (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    device_id text,
    dev_stage text,
    irb_approved boolean,
    irb_institution text,
    trial_identifier text,
    target_jurisdictions text[],
    target_specialty text,
    company_stage text,
    total_raised_usd numeric,
    last_funding_date date,
    lead_investor text,
    investor_deck_available boolean,
    interested_investor_count integer DEFAULT 0,
    founded_year integer,
    team_size_range text,
    clinical_contact_name text,
    clinical_contact_email text,
    investor_contact_name text,
    investor_contact_email text,
    last_updated_by_email text,
    last_self_update timestamp with time zone,
    listing_claimed boolean DEFAULT false,
    claimed_at timestamp with time zone,
    claim_token uuid DEFAULT gen_random_uuid(),
    created_at timestamp with time zone DEFAULT now(),
    trial_status text,
    trial_phase text,
    trial_start_date date,
    trial_completion_date date,
    trial_enrollment integer,
    trial_locations text[],
    breakthrough_source text
);

CREATE TABLE public.audit_log (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    actor_user_id uuid,
    actor_email text,
    action text NOT NULL,
    target_table text,
    target_id text,
    payload jsonb,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.admin_users (
    user_id uuid NOT NULL,
    email text NOT NULL,
    role text NOT NULL DEFAULT 'admin'::text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    created_by uuid,
    last_seen_at timestamp with time zone
);

CREATE TABLE public.ingest_runs (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    pipeline text NOT NULL,
    started_at timestamp with time zone NOT NULL DEFAULT now(),
    finished_at timestamp with time zone,
    status text NOT NULL DEFAULT 'running'::text,
    trigger_source text NOT NULL DEFAULT 'manual'::text,
    triggered_by uuid,
    summary jsonb,
    error_message text
);

CREATE TABLE public.manufacturers (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name text NOT NULL,
    hq_location text,
    status text DEFAULT 'Unverified'::text,
    created_at timestamp with time zone DEFAULT now(),
    tier text NOT NULL DEFAULT 'free'::text,
    claimed_at timestamp with time zone,
    claimed_by_email text,
    claim_token uuid DEFAULT gen_random_uuid(),
    payment text,
    website text,
    funding_stage text,
    total_raised_usd numeric,
    contact_name text,
    contact_email text,
    contact_visible boolean DEFAULT false,
    alert_email text,
    alert_active boolean DEFAULT false,
    subscription_status text DEFAULT 'free'::text,
    auth_user_id uuid
);

CREATE TABLE public.device_master (
    device_id text NOT NULL,
    manufacturer_link uuid,
    specialty_link text,
    mode text,
    dependency text,
    autonomy text,
    intended_use text,
    ai_ml_type text,
    accountability_tier integer,
    health_status text DEFAULT 'Amber'::text,
    aletia_verified boolean DEFAULT false,
    last_automated_sync timestamp with time zone,
    last_clinical_review timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    country_of_origin text,
    basic_udi_ulid text,
    manufacturer_name text,
    udi text,
    excluded boolean NOT NULL DEFAULT false,
    excluded_reason text,
    pipeline_stage text,
    data_source text NOT NULL DEFAULT 'registry_sync'::text,
    breakthrough_designation boolean DEFAULT false,
    breakthrough_designation_date date,
    search_vector text GENERATED ALWAYS AS (lower(((((COALESCE(device_id, ''::text) || ' '::text) || COALESCE(intended_use, ''::text)) || ' '::text) || COALESCE(manufacturer_name, ''::text)))) STORED,
    pccp_status text DEFAULT 'unknown'::text,
    ai_ml_integral boolean,
    pccp_authorized_date date,
    pccp_source text,
    eudamed_basic_udi text,
    ce_mark_status text,
    ce_certificate_number text,
    ce_certificate_expiry date,
    ce_notified_body text,
    eu_risk_class text,
    emdn_code text,
    autonomous_output_mode boolean DEFAULT false,
    autonomous_output_description text,
    claimed_at timestamp with time zone,
    claimed_by_email text,
    claim_token uuid,
    approval_status text DEFAULT 'approved'::text,
    auth_user_id uuid
);

CREATE TABLE public.regional_registrations (
    reg_id uuid NOT NULL DEFAULT gen_random_uuid(),
    device_link text,
    country text,
    regulatory_body text,
    clearance_type text,
    regulatory_expiry date,
    local_distributor text,
    device_class text,
    gmdn_code text,
    gmdn_term text,
    last_updated timestamp with time zone,
    adverse_event_count integer,
    adverse_event_source text,
    recall_active boolean DEFAULT false,
    recall_detail text
);

CREATE TABLE public.tech_specs (
    device_link text NOT NULL,
    api_type text,
    ehr_compat text,
    data_hosting text,
    fhir_compatible boolean,
    popia_compliant boolean
);

CREATE TABLE public.clinical_audits (
    audit_id uuid NOT NULL DEFAULT gen_random_uuid(),
    device_link text,
    evidence_review_date timestamp with time zone,
    confidence_score double precision,
    evidence_log text,
    peer_reviewed_validation integer,
    demographic_accuracy integer,
    sahpra_compliance integer,
    cybersecurity_popia integer,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.specialty_taxonomy (
    specialty_name text NOT NULL,
    parent_cat text
);

ALTER TABLE public.ingestion_review_queue ADD CONSTRAINT ingestion_review_queue_pkey PRIMARY KEY (queue_id);

ALTER TABLE public.manufacturers ADD CONSTRAINT manufacturers_pkey PRIMARY KEY (id);

ALTER TABLE public.tech_specs ADD CONSTRAINT tech_specs_pkey PRIMARY KEY (device_link);

ALTER TABLE public.ingest_runs ADD CONSTRAINT ingest_runs_pkey PRIMARY KEY (id);

ALTER TABLE public.clinical_audits ADD CONSTRAINT clinical_audits_pkey PRIMARY KEY (audit_id);

ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);

ALTER TABLE public.admin_users ADD CONSTRAINT admin_users_pkey PRIMARY KEY (user_id);

ALTER TABLE public.specialty_taxonomy ADD CONSTRAINT specialty_taxonomy_pkey PRIMARY KEY (specialty_name);

ALTER TABLE public.device_master ADD CONSTRAINT device_master_pkey PRIMARY KEY (device_id);

ALTER TABLE public.regional_registrations ADD CONSTRAINT regional_registrations_pkey PRIMARY KEY (reg_id);

ALTER TABLE public.claim_requests ADD CONSTRAINT claim_requests_pkey PRIMARY KEY (id);

ALTER TABLE public.pre_approval_profile ADD CONSTRAINT pre_approval_profile_pkey PRIMARY KEY (id);

ALTER TABLE public.manufacturers ADD CONSTRAINT manufacturers_name_key UNIQUE (name);

ALTER TABLE public.regional_registrations ADD CONSTRAINT regional_registrations_device_country_body_unique UNIQUE (device_link, country, regulatory_body);

ALTER TABLE public.admin_users ADD CONSTRAINT admin_users_email_key UNIQUE (email);

ALTER TABLE public.pre_approval_profile ADD CONSTRAINT pre_approval_profile_device_id_unique UNIQUE (device_id);

ALTER TABLE public.ingestion_review_queue ADD CONSTRAINT ingestion_review_queue_sponsor_type_check CHECK ((sponsor_type = ANY (ARRAY['commercial'::text, 'academic'::text])));

ALTER TABLE public.clinical_audits ADD CONSTRAINT clinical_audits_confidence_score_check CHECK (((confidence_score >= (1)::double precision) AND (confidence_score <= (10)::double precision)));

ALTER TABLE public.admin_users ADD CONSTRAINT admin_users_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'super_admin'::text, 'readonly'::text])));

ALTER TABLE public.ingest_runs ADD CONSTRAINT ingest_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'success'::text, 'partial'::text, 'failed'::text])));

ALTER TABLE public.ingest_runs ADD CONSTRAINT ingest_runs_trigger_source_check CHECK ((trigger_source = ANY (ARRAY['manual'::text, 'cron'::text, 'api'::text])));

ALTER TABLE public.ingestion_review_queue ADD CONSTRAINT ingestion_review_queue_specialty_confidence_check CHECK ((specialty_confidence = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text, 'none'::text])));

ALTER TABLE public.ingestion_review_queue ADD CONSTRAINT ingestion_review_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'duplicate'::text])));

ALTER TABLE public.device_master ADD CONSTRAINT device_master_accountability_tier_check CHECK (((accountability_tier >= 1) AND (accountability_tier <= 5)));

ALTER TABLE public.device_master ADD CONSTRAINT device_master_health_status_check CHECK ((health_status = ANY (ARRAY['Green'::text, 'Amber'::text, 'Red'::text])));

ALTER TABLE public.device_master ADD CONSTRAINT device_master_pccp_status_check CHECK ((pccp_status = ANY (ARRAY['approved'::text, 'not_submitted'::text, 'not_applicable_jurisdiction'::text, 'unknown'::text])));

ALTER TABLE public.device_master ADD CONSTRAINT device_master_specialty_link_fkey FOREIGN KEY (specialty_link) REFERENCES specialty_taxonomy(specialty_name);

ALTER TABLE public.clinical_audits ADD CONSTRAINT clinical_audits_device_link_fkey FOREIGN KEY (device_link) REFERENCES device_master(device_id);

ALTER TABLE public.tech_specs ADD CONSTRAINT tech_specs_device_link_fkey FOREIGN KEY (device_link) REFERENCES device_master(device_id);

ALTER TABLE public.pre_approval_profile ADD CONSTRAINT pre_approval_profile_device_id_fkey FOREIGN KEY (device_id) REFERENCES device_master(device_id) ON DELETE CASCADE;

ALTER TABLE public.device_master ADD CONSTRAINT device_master_manufacturer_link_fkey FOREIGN KEY (manufacturer_link) REFERENCES manufacturers(id);

ALTER TABLE public.claim_requests ADD CONSTRAINT claim_requests_device_id_fkey FOREIGN KEY (device_id) REFERENCES device_master(device_id) ON DELETE SET NULL;

ALTER TABLE public.claim_requests ADD CONSTRAINT claim_requests_manufacturer_id_fkey FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id) ON DELETE SET NULL;

ALTER TABLE public.regional_registrations ADD CONSTRAINT regional_registrations_device_link_fkey FOREIGN KEY (device_link) REFERENCES device_master(device_id);

CREATE INDEX idx_claim_requests_token ON public.claim_requests USING btree (token);

CREATE INDEX idx_admin_users_email ON public.admin_users USING btree (email);

CREATE INDEX idx_ingest_runs_started_at ON public.ingest_runs USING btree (started_at DESC);

CREATE INDEX idx_device_search ON public.device_master USING btree (search_vector);

CREATE INDEX idx_claim_requests_device ON public.claim_requests USING btree (device_id);

CREATE INDEX idx_audit_log_actor ON public.audit_log USING btree (actor_user_id);

CREATE INDEX idx_queue_status ON public.ingestion_review_queue USING btree (status);

CREATE INDEX idx_ingest_runs_pipeline ON public.ingest_runs USING btree (pipeline, started_at DESC);

CREATE INDEX idx_queue_sponsor_type ON public.ingestion_review_queue USING btree (sponsor_type);

CREATE INDEX idx_queue_source ON public.ingestion_review_queue USING btree (source);

CREATE INDEX idx_device_master_approval_status ON public.device_master USING btree (approval_status);

CREATE INDEX idx_review_queue_status ON public.ingestion_review_queue USING btree (status, created_at DESC);

CREATE INDEX idx_audit_log_action ON public.audit_log USING btree (action);

CREATE INDEX idx_queue_review_reason ON public.ingestion_review_queue USING btree (review_reason);

CREATE INDEX idx_device_master_claim_token ON public.device_master USING btree (claim_token);

CREATE INDEX idx_audit_log_target ON public.audit_log USING btree (target_table, target_id);

CREATE UNIQUE INDEX idx_review_queue_source_id ON public.ingestion_review_queue USING btree (source, source_id) WHERE (status = 'pending'::text);

CREATE INDEX idx_queue_specialty ON public.ingestion_review_queue USING btree (specialty_inferred);

CREATE INDEX idx_audit_log_created_at ON public.audit_log USING btree (created_at DESC);

CREATE INDEX idx_pre_approval_device ON public.pre_approval_profile USING btree (device_id);

CREATE OR REPLACE FUNCTION public.is_admin(uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.admin_users where user_id = uid);
$function$
;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ingest_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read manufacturers" ON public.manufacturers AS PERMISSIVE FOR SELECT TO public USING (true);

CREATE POLICY "Public can read claim requests by token" ON public.claim_requests AS PERMISSIVE FOR SELECT TO public USING (true);