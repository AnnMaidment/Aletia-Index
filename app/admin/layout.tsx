/**
 * app/admin/layout.tsx
 *
 * Shared shell for every /admin page except /admin/login and /admin/forbidden.
 * The middleware has already ensured the user is authenticated and in admin_users
 * by the time this layout renders, so we can trust the session here.
 */

import Link from 'next/link';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { redirect } from 'next/navigation';
import { getServiceClient } from '@/lib/adminAudit';
import './admin.css';

export const dynamic = 'force-dynamic';   // never cache admin pages

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
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

  // Defensive double-check — middleware should have caught this but belt+braces.
  const admin = getServiceClient();
  const { data: adminRow } = await admin
    .from('admin_users')
    .select('email, role')
    .eq('user_id', user.id)
    .single();

  if (!adminRow) redirect('/admin/forbidden');

  // Count badges for nav (queue / claim requests)
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
