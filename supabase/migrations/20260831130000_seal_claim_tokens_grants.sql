-- ============================================================================
-- 20260831130000_seal_claim_tokens_grants.sql   (SEC-003, part 2)
--
-- Corrects 20260831120000_seal_claim_tokens.sql, whose column-level REVOKEs
-- were silently ineffective.
--
-- WHAT HAPPENED. After running the first migration, verify-sec003.ts reported:
--
--     ✓ SEALED         claim_requests.token   (whole table sealed)
--     ✗ STILL EXPOSED  device_master.claim_token
--     ✗ STILL EXPOSED  manufacturers.claim_token
--     ✗ STILL EXPOSED  device_master.claimed_by_email
--     ✗ STILL EXPOSED  manufacturers.contact_email
--
-- The policy drop worked; every column REVOKE did nothing. That asymmetry is
-- the whole diagnosis:
--
--   POLICIES DENY BY DEFAULT. RLS with no matching policy denies, so dropping
--   the claim_requests policies sealed the table immediately.
--
--   GRANTS ARE ADDITIVE, AND A TABLE-LEVEL GRANT SWALLOWS A COLUMN-LEVEL
--   REVOKE. anon and authenticated hold `GRANT SELECT ON <table>` — Supabase
--   grants it on the public schema by default. A table-level SELECT already
--   confers SELECT on every column, including columns added later. Postgres
--   does not subtract a column from a table-level grant; there is nothing
--   column-scoped there to revoke, so `revoke select (claim_token) …` matched
--   no privilege and removed nothing. It does not error. It emits at most a
--   notice and returns success, which is why the migration looked applied.
--
-- THE CORRECT SHAPE is to remove the table-level grant and re-grant SELECT at
-- the column level on everything EXCEPT the sensitive columns:
--
--     revoke select on <table> from anon, authenticated;
--     grant  select (<every other column>) on <table> to anon, authenticated;
--
-- WHICH RUNS INTO THE PROBLEM THE FIRST MIGRATION WAS AVOIDING: it needs the
-- full column list, and the live schema has drifted from this repo
-- (external_legacy_id and description are queried by app/page.tsx but appear in
-- no CREATE TABLE or ADD COLUMN here). A list written from the repo would drop
-- real columns off the public site.
--
-- So the list is derived from information_schema at run time. The database is
-- the only authority on its own columns; this asks it rather than guessing.
--
-- ⚠ MAINTENANCE. Column grants do not extend to columns added afterwards. A new
-- column on either table will be invisible to anon until this migration is
-- re-run. That fails CLOSED — a missing field on the site, never a leaked one —
-- but it is a real footgun. Re-run this file after any ALTER TABLE … ADD COLUMN
-- on device_master or manufacturers. It is idempotent and re-derives the list
-- each time.
--
-- SAFE TO RUN NOW: the code half is already deployed. Every reader of the
-- sensitive columns uses the service-role client, which bypasses grants
-- entirely, so nothing breaks between this running and the next deploy.
-- ============================================================================

-- ── device_master ───────────────────────────────────────────────────────────
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'device_master'
     and column_name not in ('claim_token', 'claimed_by_email', 'auth_user_id');

  if cols is null then
    raise exception 'device_master: no columns resolved — refusing to revoke and leave the table unreadable';
  end if;

  execute 'revoke select on public.device_master from anon, authenticated';
  execute format('grant select (%s) on public.device_master to anon, authenticated', cols);

  raise notice 'device_master: SELECT re-granted on % columns', array_length(string_to_array(cols, ', '), 1);
end $$;

-- ── manufacturers ───────────────────────────────────────────────────────────
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'manufacturers'
     and column_name not in ('claim_token', 'contact_email', 'contact_name',
                             'claimed_by_email', 'auth_user_id');

  if cols is null then
    raise exception 'manufacturers: no columns resolved — refusing to revoke and leave the table unreadable';
  end if;

  execute 'revoke select on public.manufacturers from anon, authenticated';
  execute format('grant select (%s) on public.manufacturers to anon, authenticated', cols);

  raise notice 'manufacturers: SELECT re-granted on % columns', array_length(string_to_array(cols, ', '), 1);
end $$;

-- ── Verification ────────────────────────────────────────────────────────────
-- 1. No TABLE-level SELECT left for anon on either table. Expect zero rows —
--    this is the check that would have caught the first migration's failure.
--
--      select table_name, grantee, privilege_type
--      from information_schema.table_privileges
--      where table_schema = 'public'
--        and table_name in ('device_master', 'manufacturers')
--        and grantee in ('anon', 'authenticated')
--        and privilege_type = 'SELECT';
--
-- 2. No COLUMN-level SELECT on any sensitive column. Expect zero rows.
--
--      select table_name, column_name, grantee
--      from information_schema.column_privileges
--      where table_schema = 'public'
--        and grantee in ('anon', 'authenticated')
--        and privilege_type = 'SELECT'
--        and column_name in ('claim_token', 'contact_email', 'contact_name',
--                            'claimed_by_email', 'auth_user_id');
--
-- 3. The columns the public site DOES need are still granted. Expect a healthy
--    count, not zero — this is the control that proves step 1 did not go too far.
--
--      select table_name, count(*) as readable_columns
--      from information_schema.column_privileges
--      where table_schema = 'public'
--        and grantee = 'anon'
--        and privilege_type = 'SELECT'
--        and table_name in ('device_master', 'manufacturers')
--      group by table_name;
--
-- Then re-run:  npx tsx scripts/verify-sec003.ts
-- Expect three controls green and five sealed.
-- ============================================================================
