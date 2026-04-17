-- =====================================================================
-- Aletia — Admin Portal Functions + Seed
-- Migration: 20260417_admin_functions.sql
--
-- Run AFTER 20260416_admin_portal.sql has been applied.
--
-- What this adds:
--   1. is_admin(uuid)  SECURITY DEFINER function — called from proxy.ts
--      (formerly middleware.ts) to check allowlist membership at the
--      edge without exposing the admin_users table.
--   2. admin_users seed row — fill in your auth.users id and email
--      before running, OR run the INSERT separately after confirming
--      your user_id from auth.users.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. is_admin(uid uuid) — returns boolean
--    Callable from anon + authenticated contexts via RPC.
--    RLS on admin_users is enabled with no policies, so direct SELECTs
--    from anon are blocked. This SECURITY DEFINER function is the one
--    supported read path.
-- ---------------------------------------------------------------------
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.admin_users where user_id = uid);
$$;

-- Lock down the function — only authenticated callers need it.
-- Anon needs it too because the proxy runs the check before we know
-- whether the user is authed (getUser() returns null for anon).
revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to authenticated, anon;

comment on function public.is_admin(uuid) is
  'Returns true if the given auth.users.id is in admin_users. '
  'Called from proxy.ts (Next.js) to guard /admin/* routes. '
  'SECURITY DEFINER so callers do not need direct table access.';


-- ---------------------------------------------------------------------
-- 2. admin_users seed
--
-- BEFORE RUNNING this migration, get your Supabase auth user_id:
--
--     select id, email from auth.users where email = 'you@example.com';
--
-- Then replace the placeholders below. If you run this migration as-is
-- without substituting real values, the INSERT will fail the uuid cast
-- and the rest of the migration will still succeed.
-- ---------------------------------------------------------------------

-- Uncomment and fill in, then run:
--
-- insert into public.admin_users (user_id, email, role)
-- values (
--   '00000000-0000-0000-0000-000000000000'::uuid,   -- <— replace
--   'you@example.com',                              -- <— replace
--   'super_admin'
-- )
-- on conflict (user_id) do update
--   set email = excluded.email,
--       role  = excluded.role;


-- ---------------------------------------------------------------------
-- 3. Sanity checks (run manually after migration)
--
--   select public.is_admin('<your-user-id>'::uuid);   -- expect true
--   select public.is_admin(gen_random_uuid());        -- expect false
--   select * from public.admin_users;                 -- expect 1 row
-- ---------------------------------------------------------------------
