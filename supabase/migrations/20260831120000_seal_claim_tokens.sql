-- ============================================================================
-- 20260831120000_seal_claim_tokens.sql   (SEC-003)
--
-- Closes the claim-token exposure left open by 20260826120000_enable_rls.sql.
--
-- WHAT WAS WRONG. A claim token is the entire proof of entitlement to take
-- control of a listing on the public index. There were THREE of them, and all
-- three were readable with the publishable (anon) key that ships inside the
-- site's own JavaScript:
--
--   1. claim_requests.token        — the table carried a blanket
--                                    `for select using (true)` policy. Named
--                                    "Public can read claim requests by token"
--                                    in the baseline, but it filters nothing.
--   2. manufacturers.claim_token   — manufacturers is one of the eight
--                                    publicly-readable tables (it has to be:
--                                    /device/[id] reaches it as an embedded
--                                    select), so the token came with it.
--   3. device_master.claim_token   — same, and worse: /device/[id] issued
--                                    `select *`, so every device page fetch was
--                                    actually retrieving the token.
--
-- The RLS migration's own warning named only (1). (2) and (3) were found on
-- 31 Aug while implementing the fix for (1). Sealing claim_requests alone would
-- have left the manufacturer and device claim paths wide open.
--
-- Anyone could enumerate every token and claim any listing in the index. No
-- credential leak was required — only that someone read the site's JavaScript
-- for the anon key, which is published by design.
--
-- SHAPE OF THE FIX. Two halves; the code half must deploy FIRST or the claim
-- flow breaks between the two.
--
--   CODE (deployed in the same commit as this file):
--     app/claim/[token]/page.tsx        anon -> createAdminClient()
--     app/api/claim/request/route.ts    anon -> createAdminClient()
--     app/api/claim/status/route.ts     anon -> createAdminClient(), and stops
--                                       selecting claimed_by_email, which it
--                                       never used
--     app/device/[id]/page.tsx          anon -> createAdminClient(), because its
--                                       `select *` cannot survive a column
--                                       REVOKE (Postgres rejects the whole
--                                       select if the role lacks any named
--                                       column, and `*` names all of them)
--   All four are server-side. app/api/claim/send and /complete already used the
--   admin client.
--
--   SCHEMA (this file):
--     claim_requests  — both policies dropped; sealed to service_role like
--                       ingestion_review_queue. RLS stays enabled, so with no
--                       policy nothing but service_role can read or write it.
--     manufacturers   — column-level REVOKE on the token and contact columns.
--                       The table stays publicly readable; only those columns
--                       become invisible to anon.
--     device_master   — column-level REVOKE on the token and claimant columns,
--                       same reasoning.
--
-- WHY COLUMN GRANTS RATHER THAN POLICIES for (2) and (3): RLS policies gate
-- ROWS, not columns. These two tables must stay row-readable — they are the
-- index itself and its embeds. Column privileges are the only mechanism that
-- keeps a table public while keeping a column private, and PostgREST honours
-- them.
--
-- VERIFIED SAFE against every remaining anon reader. All of them name explicit
-- columns and none names a revoked one:
--   app/page.tsx                        (listing + four count queries)
--   app/claim/request/[deviceId]/page.tsx
--   app/dashboard/DashboardClient.tsx   (a browser client — checked first)
--   /device/[id] manufacturers embed    (name, hq_location, tier, claimed_at,
--                                        website, contact_visible)
--
-- Idempotent: drops are IF EXISTS, revokes are harmless if already applied.
-- ============================================================================

-- ── 1. claim_requests: seal it ──────────────────────────────────────────────
-- Every reader and writer is now server-side and uses service_role, which
-- bypasses RLS. With RLS on and no policies, anon and authenticated get
-- nothing — the same posture as ingestion_review_queue.

alter table public.claim_requests enable row level security;

drop policy if exists "public read"   on public.claim_requests;
drop policy if exists "public insert" on public.claim_requests;

-- The baseline policy, whose name promises a token filter it does not apply.
drop policy if exists "Public can read claim requests by token" on public.claim_requests;

-- ── 2. manufacturers: keep the rows public, hide the sensitive columns ──────
-- claim_token is the entitlement proof. contact_email/contact_name are personal
-- data whose publication is already gated by the contact_visible flag in the
-- application — the grant should agree with that intent rather than contradict
-- it. auth_user_id links a listing to an auth identity.

revoke select (claim_token)      on public.manufacturers from anon, authenticated;
revoke select (contact_email)    on public.manufacturers from anon, authenticated;
revoke select (contact_name)     on public.manufacturers from anon, authenticated;
revoke select (claimed_by_email) on public.manufacturers from anon, authenticated;
revoke select (auth_user_id)     on public.manufacturers from anon, authenticated;

-- ── 3. device_master: same ──────────────────────────────────────────────────

revoke select (claim_token)      on public.device_master from anon, authenticated;
revoke select (claimed_by_email) on public.device_master from anon, authenticated;
revoke select (auth_user_id)     on public.device_master from anon, authenticated;

-- ── Verification ────────────────────────────────────────────────────────────
-- Expect ZERO rows from both queries after this runs.
--
--   -- no policies left on claim_requests
--   select policyname from pg_policies
--   where schemaname = 'public' and tablename = 'claim_requests';
--
--   -- no anon SELECT grant on any token or claimant column
--   select table_name, column_name, grantee
--   from information_schema.column_privileges
--   where table_schema = 'public'
--     and grantee in ('anon', 'authenticated')
--     and privilege_type = 'SELECT'
--     and column_name in ('claim_token', 'token', 'contact_email',
--                         'contact_name', 'claimed_by_email', 'auth_user_id');
--
-- Then, as a live check against the deployed site, this should now FAIL rather
-- than return tokens (substitute the publishable key):
--
--   curl "$SUPABASE_URL/rest/v1/device_master?select=aletia_id,claim_token&limit=1" \
--        -H "apikey: $PUBLISHABLE_KEY"
-- ============================================================================
