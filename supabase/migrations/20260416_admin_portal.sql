-- =====================================================================
-- Aletia — Admin Portal + Specialty Extraction
-- Migration: 20260416_admin_portal.sql
-- Run in Supabase SQL editor, or via CLI:
--   supabase db push
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Add specialty fields to ingestion_review_queue
--    These are populated by lib/extractQueueSpecialty.ts
-- ---------------------------------------------------------------------
alter table public.ingestion_review_queue
  add column if not exists specialty_inferred text,
  add column if not exists specialty_confidence text
    check (specialty_confidence in ('high','medium','low','none')),
  add column if not exists specialty_signals jsonb,   -- what triggered the match
  add column if not exists sponsor_type text
    check (sponsor_type in ('commercial','academic')),
  add column if not exists review_reason text;

-- Backfill sponsor_type and review_reason from raw_data where present
-- (these were written into raw_data during the CT.gov ingest)
update public.ingestion_review_queue
   set sponsor_type  = coalesce(sponsor_type,  raw_data->>'sponsor_type'),
       review_reason = coalesce(review_reason, raw_data->>'review_reason')
 where raw_data is not null
   and (sponsor_type is null or review_reason is null);

create index if not exists idx_queue_status          on public.ingestion_review_queue (status);
create index if not exists idx_queue_source          on public.ingestion_review_queue (source);
create index if not exists idx_queue_sponsor_type    on public.ingestion_review_queue (sponsor_type);
create index if not exists idx_queue_specialty       on public.ingestion_review_queue (specialty_inferred);
create index if not exists idx_queue_review_reason   on public.ingestion_review_queue (review_reason);

-- ---------------------------------------------------------------------
-- 2. audit_log — every admin action recorded here
-- ---------------------------------------------------------------------
create table if not exists public.audit_log (
  id              uuid primary key default gen_random_uuid(),
  actor_user_id   uuid,                  -- Supabase auth.users.id
  actor_email     text,                  -- denormalised for fast display
  action          text not null,         -- e.g. 'queue.accept', 'device.update', 'claim.approve'
  target_table    text,                  -- e.g. 'device_master'
  target_id       text,                  -- e.g. K number, queue_id, manufacturer id
  payload         jsonb,                 -- before/after snapshot or action params
  ip_address      inet,
  user_agent      text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_audit_log_actor      on public.audit_log (actor_user_id);
create index if not exists idx_audit_log_created_at on public.audit_log (created_at desc);
create index if not exists idx_audit_log_action     on public.audit_log (action);
create index if not exists idx_audit_log_target     on public.audit_log (target_table, target_id);

-- ---------------------------------------------------------------------
-- 3. admin_users — allowlist of authorised admins
--    Referenced by middleware — session user must be in here to access /admin
-- ---------------------------------------------------------------------
create table if not exists public.admin_users (
  user_id      uuid primary key,                      -- Supabase auth.users.id
  email        text not null unique,
  role         text not null default 'admin'
               check (role in ('admin','super_admin','readonly')),
  created_at   timestamptz not null default now(),
  created_by   uuid,
  last_seen_at timestamptz
);

create index if not exists idx_admin_users_email on public.admin_users (email);

-- ---------------------------------------------------------------------
-- 4. ingest_runs — last run timestamps + result summaries per pipeline
--    Powers Module 5 (Ingestion Controls)
-- ---------------------------------------------------------------------
create table if not exists public.ingest_runs (
  id             uuid primary key default gen_random_uuid(),
  pipeline       text not null,         -- 'breakthrough' | 'clinical_trials' | 'pccp' | 'fda_sync' | 'mhra_sync' | 'eudamed'
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  status         text not null default 'running'
                 check (status in ('running','success','partial','failed')),
  trigger_source text not null default 'manual'
                 check (trigger_source in ('manual','cron','api')),
  triggered_by   uuid,                  -- auth.users.id when manual
  summary        jsonb,                 -- counts: fetched / created / enriched / queued / rejected
  error_message  text
);

create index if not exists idx_ingest_runs_pipeline    on public.ingest_runs (pipeline, started_at desc);
create index if not exists idx_ingest_runs_started_at  on public.ingest_runs (started_at desc);

-- ---------------------------------------------------------------------
-- 5. RLS — lock these down so only service role can touch them
--    Admin UI uses the service role key; public anon key cannot read/write.
-- ---------------------------------------------------------------------
alter table public.audit_log    enable row level security;
alter table public.admin_users  enable row level security;
alter table public.ingest_runs  enable row level security;

-- No policies defined → only service_role (which bypasses RLS) can access.
-- Adding this is intentional and defensive.

-- ---------------------------------------------------------------------
-- 6. Helper view — queue summary counts for dashboard header
-- ---------------------------------------------------------------------
create or replace view public.queue_summary as
select
  status,
  source,
  sponsor_type,
  review_reason,
  count(*)::int as n
from public.ingestion_review_queue
group by status, source, sponsor_type, review_reason;

comment on view public.queue_summary is
  'Dashboard counts for /admin queue page. Read via service role only.';
