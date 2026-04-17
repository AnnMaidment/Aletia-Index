/**
 * app/admin/(protected)/layout.tsx
 *
 * Wraps every admin page that requires authentication + admin_users
 * membership. The proxy (proxy.ts at the repo root) has already verified
 * both by the time this renders, but we belt-and-braces check here so
 * that if the proxy is misconfigured or bypassed (CVE-2025-29927 class
 * of bugs), the page still refuses to render without a valid admin row.
 *
 * This is the file that was previously app/admin/layout.tsx in the
 * old flat structure. Moving it into (protected)/ means /admin/login
 * and /admin/forbidden (now under (public)/) don't inherit the shell,
 * which removes the redirect-loop risk.
 */

import Link from 'next/link';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { redirect } from 'next/navigation';
import { getServiceClient } from '@/lib/adminAudit';

export const dynamic = 'force-dynamic';

export default async function AdminProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (n) => cookieStore.get(n)?.value,
        set: () => {},
        remove: () => {},
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/admin/login');

  // Defensive double-check against admin_users
  const admin = getServiceClient();
  const { data: adminRow } = await admin
    .from('admin_users')
    .select('email, role')
    .eq('user_id', user.id)
    .single();

  if (!adminRow) redirect('/admin/forbidden');

  // Count badges for nav
  const [{ count: queuePending }, { count: claimsPending }] = await Promise.all([
    admin.from('ingestion_review_queue').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    admin.from('claim_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
  ]);

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <Link href="/admin">Aletia Admin</Link>
        </div>

        <nav className="admin-nav">
          <Link href="/admin">Overview</Link>
          <Link href="/admin/queue">
            Review Queue
            {queuePending ? <span className="badge">{queuePending}</span> : null}
          </Link>
          <Link href="/admin/claims">
            Claim Requests
            {claimsPending ? <span className="badge">{claimsPending}</span> : null}
          </Link>
          <Link href="/admin/devices">Devices</Link>
          <Link href="/admin/manufacturers">Manufacturers</Link>
          <Link href="/admin/ingestion">Ingestion Controls</Link>
          <Link href="/admin/audit">Audit Log</Link>
        </nav>

        <div className="admin-user">
          <div className="admin-user-email" title={adminRow.email}>{adminRow.email}</div>
          <div className="admin-user-role">{adminRow.role}</div>
          <form action="/api/admin/logout" method="post">
            <button type="submit" className="admin-logout">Sign out</button>
          </form>
        </div>
      </aside>

      <main className="admin-main">{children}</main>
    </div>
  );
}
