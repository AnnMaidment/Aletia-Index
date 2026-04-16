/**
 * middleware.ts  (goes at project root)
 *
 * Guards every /admin route. Two checks:
 *   1. Valid Supabase Auth session cookie exists
 *   2. Session user is in admin_users table
 *
 * If either fails → redirect to /admin/login (or /admin/forbidden if logged in
 * but not in the allowlist).
 *
 * This runs at the edge on every /admin/** request before the route renders,
 * so unauthenticated users never see any admin UI or data.
 *
 * Merge this with any existing middleware.ts — do not overwrite.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(req: NextRequest) {
  // Only guard /admin/*  — login + forbidden pages must be reachable unauthenticated.
  const path = req.nextUrl.pathname;
  if (!path.startsWith('/admin')) return NextResponse.next();

  // Public admin routes (no auth needed)
  if (
    path === '/admin/login' ||
    path === '/admin/forbidden' ||
    path.startsWith('/admin/_')
  ) {
    return NextResponse.next();
  }

  const res = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name) => req.cookies.get(name)?.value,
        set: (name, value, options) => {
          res.cookies.set({ name, value, ...options });
        },
        remove: (name, options) => {
          res.cookies.set({ name, value: '', ...options });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = '/admin/login';
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  // Check admin_users allowlist. Uses anon-key client, which has no RLS
  // access to admin_users — so we call the /api/admin/me route instead,
  // which uses the service role key server-side.
  //
  // For edge middleware we just do a raw REST call with the anon key
  // using a postgres RPC that returns a boolean. Simpler: check via a
  // public view or a SECURITY DEFINER function.
  //
  // Implementation note: create this SQL function in Supabase (run once):
  //
  //   create or replace function public.is_admin(uid uuid)
  //   returns boolean
  //   language sql security definer stable as $$
  //     select exists (select 1 from public.admin_users where user_id = uid);
  //   $$;
  //   revoke all on function public.is_admin(uuid) from public;
  //   grant execute on function public.is_admin(uuid) to authenticated, anon;
  //
  const { data: isAdmin, error } = await supabase.rpc('is_admin', { uid: user.id });

  if (error || !isAdmin) {
    const url = req.nextUrl.clone();
    url.pathname = '/admin/forbidden';
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: ['/admin/:path*'],
};
