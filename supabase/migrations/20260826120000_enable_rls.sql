-- ============================================================================
-- 20260826120000_enable_rls.sql
--
-- Enables Row Level Security across the public schema and records the policies
-- that were applied by hand in the SQL editor on 26 Aug 2026.
--
-- WHY. An audit that day found 12 of 15 tables with RLS OFF and the `anon`
-- role holding SELECT, INSERT, UPDATE and DELETE on all of them. The
-- publishable (anon) key is embedded in the site's JavaScript by design, so
-- for the life of the project anyone who opened aletia-index.com could have
-- written to or deleted from device_master, device_external_ids and the
-- ingestion review queue. This was a materially larger exposure than the
-- service-role key leaked in aletia-index.zip, and unlike that one it required
-- no leak at all — only that someone looked.
--
-- Only admin_users, audit_log and ingest_runs were protected beforehand.
--
-- SHAPE OF THE FIX.
--   * Eight tables are read by the public site and get a permissive SELECT
--     policy. Five of them (manufacturers, regional_registrations, tech_specs,
--     clinical_audits, pre_approval_profile, device_trials) are reached as
--     PostgREST embedded selects from /device/[id] — an embed needs read
--     access on the embedded table, so omitting one makes that section of the
--     page silently disappear rather than error.
--   * ingestion_review_queue, ingestion_anomalies and specialty_taxonomy get
--     RLS with NO policy: sealed to everything except service_role, which
--     bypasses RLS. Every admin path reaches them through getServiceClient()
--     (lib/adminAudit.ts) or createAdminClient(), so nothing user-facing
--     depends on public access to them.
--   * claim_requests keeps public SELECT + INSERT, preserving the existing
--     claim flow. See the caveat below.
--
-- USING (true) is deliberate: it reproduces pre-migration behaviour exactly.
-- The application's own filters (excluded = false, merged_into is null) still
-- decide what is shown. Tightening the policy to encode those filters is a
-- separate, later decision.
--
-- The grant columns in pg_class still report anon as holding INSERT/UPDATE/
-- DELETE. That is inert once RLS is on — an operation with no matching policy
-- is denied whatever the grant says. A blanket REVOKE was considered and
-- rejected: it would break the claim_requests insert for no additional
-- protection.
--
-- ⚠ OPEN ISSUE — claim_requests. Public SELECT means anyone can list every
-- claim request, including its token, and the token is what proves entitlement
-- to claim a device. This predates the migration: the baseline policy
-- "Public can read claim requests by token" is despite its name a blanket
-- USING (true) read. Both reader (app/claim/[token]/page.tsx) and writer
-- (app/api/claim/request/route.ts) are server-side, so both could move to
-- createAdminClient(), after which BOTH select policies should be dropped and
-- the table sealed like the queue. Not done here — it is a code change, not a
-- schema one.
--
-- Idempotent: safe to re-run, and safe against a database where these were
-- already applied by hand.
-- ============================================================================

-- ── Publicly readable ───────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'device_master', 'device_external_ids', 'manufacturers',
    'regional_registrations', 'device_trials', 'tech_specs',
    'clinical_audits', 'pre_approval_profile'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = 'public read'
    ) then
      execute format(
        'create policy "public read" on public.%I for select to anon, authenticated using (true)', t
      );
    end if;
  end loop;
end $$;

-- ── Sealed: service_role only (no policies) ─────────────────────────────────
alter table public.ingestion_review_queue enable row level security;
alter table public.ingestion_anomalies    enable row level security;
alter table public.specialty_taxonomy     enable row level security;

-- ── claim_requests: preserves the existing public claim flow ────────────────
do $$
begin
  alter table public.claim_requests enable row level security;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'claim_requests' and policyname = 'public read'
  ) then
    create policy "public read" on public.claim_requests
      for select to anon, authenticated using (true);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'claim_requests' and policyname = 'public insert'
  ) then
    create policy "public insert" on public.claim_requests
      for insert to anon, authenticated with check (true);
  end if;
end $$;

-- ── Already protected before this migration; asserted for completeness ──────
alter table public.admin_users enable row level security;
alter table public.audit_log   enable row level security;
alter table public.ingest_runs enable row level security;
