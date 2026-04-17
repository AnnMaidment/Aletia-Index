/**
 * app/api/admin/logout/route.ts
 *
 * Signs the current admin out of Supabase Auth and redirects to /admin/login.
 * Invoked from the sidebar <form> in app/admin/layout.tsx (POST).
 *
 * Also supports GET for convenience (typing /api/admin/logout in the URL bar).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getAdminActor, writeAudit } from '@/lib/adminAudit';

export const dynamic = 'force-dynamic';

async function handleLogout(req: NextRequest) {
  // Best-effort audit log BEFORE signing out, so we can still resolve the actor.
  try {
    const actor = await getAdminActor();
    await writeAudit({
      actor,
      action: 'admin.logout',
      req,
    });
  } catch {
    // Not an admin or already signed out — nothing to log. Proceed to clear cookies.
  }

  const cookieStore = await cookies();
  const res = NextResponse.redirect(new URL('/admin/login', req.url), { status: 303 });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (n) => cookieStore.get(n)?.value,
        set: (name, value, options) => {
          res.cookies.set({ name, value, ...options });
        },
        remove: (name, options) => {
          res.cookies.set({ name, value: '', ...options });
        },
      },
    }
  );

  await supabase.auth.signOut();

  return res;
}

export async function POST(req: NextRequest) {
  return handleLogout(req);
}

export async function GET(req: NextRequest) {
  return handleLogout(req);
}
