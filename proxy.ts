/**
 * proxy.ts  (project root)
 *
 * Next.js 16 renamed middleware.ts → proxy.ts. This file replaces the old
 * middleware.ts — delete that file from the repo root when you commit this.
 * Function export also renamed middleware → proxy.
 *
 * Runtime change: proxy.ts runs on Node.js, NOT Edge runtime. For our use
 * case (Supabase RPC per request, no Edge-specific APIs) that's fine and
 * actually simpler. If you ever front the site with Cloudflare Proxy,
 * note the open issue https://github.com/vercel/next.js/issues/86122 —
 * proxy.ts may not execute in that topology. Aletia is on Vercel direct
 * via Hostinger DNS, so unaffected.
 *
 * What this guards:
 *   1. Any path under /admin/*  — except /admin/login, /admin/forbidden,
 *      and internal /admin/_* assets — requires:
 *        a. a valid Supabase Auth session cookie, AND
 *        b. membership in the public.admin_users table.
 *   2. Unauthenticated users → redirected to /admin/login?next=<path>
 *   3. Authenticated but not in allowlist → /admin/forbidden
 *
 * The is_admin(uuid) SQL function (see migration 20260417_admin_functions.sql)
 * is SECURITY DEFINER so this file can invoke it via anon RPC without
 * granting SELECT on admin_users.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Only guard /admin/*
  if (!path.startsWith('/admin')) return NextResponse.next();

  // Public admin routes — reachable unauthenticated
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

  // Allowlist check via SECURITY DEFINER RPC (see is_admin migration)
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
