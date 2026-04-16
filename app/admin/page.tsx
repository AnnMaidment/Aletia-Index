/**
 * app/admin/page.tsx
 *
 * Admin overview. Quick stats + recent audit activity + shortcuts.
 * Server component — reads from service client.
 */

import Link from 'next/link';
import { getServiceClient } from '@/lib/adminAudit';

export const dynamic = 'force-dynamic';

interface Stat {
  label: string;
  value: number | string;
  hint?: string;
  href?: string;
}

export default async function AdminOverview() {
  const admin = getServiceClient();

  const [
    queuePending,
    queueCommercial,
    queueAcademic,
    queueRejected,
    claimsPending,
    deviceTotal,
    preApprovalTotal,
    recentAudit,
  ] = await Promise.all([
    admin.from('ingestion_review_queue').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    admin.from('ingestion_review_queue').select('*', { count: 'exact', head: true }).eq('status', 'pending').eq('sponsor_type', 'commercial'),
    admin.from('ingestion_review_queue').select('*', { count: 'exact', head: true }).eq('status', 'pending').eq('sponsor_type', 'academic'),
    admin.from('ingestion_review_queue').select('*', { count: 'exact', head: true }).eq('status', 'rejected'),
    admin.from('claim_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    admin.from('device_master').select('*', { count: 'exact', head: true }),
    admin.from('device_master').select('*', { count: 'exact', head: true }).eq('approval_status', 'pre_approval'),
    admin.from('audit_log').select('id, actor_email, action, target_table, target_id, created_at').order('created_at', { ascending: false }).limit(12),
  ]);

  const stats: Stat[] = [
    { label: 'Queue pending', value: queuePending.count ?? 0, href: '/admin/queue' },
    { label: 'Commercial', value: queueCommercial.count ?? 0, hint: 'Pending commercial sponsors' },
    { label: 'Academic', value: queueAcademic.count ?? 0, hint: 'Pending academic sponsors' },
    { label: 'Queue rejected', value: queueRejected.count ?? 0 },
    { label: 'Claim requests', value: claimsPending.count ?? 0, href: '/admin/claims' },
    { label: 'Devices', value: deviceTotal.count ?? 0, href: '/admin/devices' },
    { label: 'Pre-approval', value: preApprovalTotal.count ?? 0, hint: 'Pipeline listings' },
  ];

  return (
    <div>
      <h1 className="admin-h1">Overview</h1>
      <p className="admin-subtle">Pending work across the ingestion pipeline, claim flow, and device registry.</p>

      <div className="stat-grid">
        {stats.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </div>

      <h2 className="section-h">Recent activity</h2>
      <div className="admin-table-wrap">
        {recentAudit.data && recentAudit.data.length > 0 ? (
          <table className="admin-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              {recentAudit.data.map((row: any) => (
                <tr key={row.id}>
                  <td>{relativeTime(row.created_at)}</td>
                  <td>{row.actor_email}</td>
                  <td><code>{row.action}</code></td>
                  <td>
                    {row.target_table ? `${row.target_table}` : '—'}
                    {row.target_id ? <><span style={{ color: '#64748b' }}> · </span><code>{row.target_id}</code></> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">No admin actions logged yet.</div>
        )}
      </div>

      <p style={{ marginTop: 16 }}>
        <Link href="/admin/audit" className="btn">View full audit log</Link>
      </p>
    </div>
  );
}

function StatCard({ label, value, hint, href }: Stat) {
  const inner = (
    <div className="stat-card">
      <div className="stat-card-label">{label}</div>
      <div className="stat-card-value">{value}</div>
      {hint && <div className="stat-card-hint">{hint}</div>}
    </div>
  );
  if (!href) return inner;
  return <Link href={href} style={{ textDecoration: 'none', color: 'inherit' }}>{inner}</Link>;
}

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
