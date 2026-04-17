/**
 * app/admin/(protected)/claims/ClaimsTable.tsx
 *
 * Client component. Renders the claims table with inline approve/reject
 * buttons that POST to /api/admin/claims/approve and /reject.
 */

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Claim {
  id: string;
  device_id: string | null;
  manufacturer_id: string | null;
  requester_email: string;
  requester_name: string | null;
  requester_role: string | null;
  company_url: string | null;
  status: string;
  created_at: string;
  token_expires_at: string | null;
}

export default function ClaimsTable({ claims }: { claims: Claim[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function act(id: string, action: 'approve' | 'reject') {
    setErr(null);
    setPendingId(id);
    let note: string | null = null;
    if (action === 'reject') {
      note = window.prompt('Reason for rejection (optional, recorded in audit log):');
      if (note === null) {
        setPendingId(null);
        return;   // user cancelled
      }
    }
    try {
      const r = await fetch(`/api/admin/claims/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: id, note: note || undefined }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      startTransition(() => router.refresh());
    } catch (e: any) {
      setErr(e?.message ?? 'Action failed');
    } finally {
      setPendingId(null);
    }
  }

  return (
    <>
      {err && (
        <div
          style={{
            padding: '8px 12px',
            background: '#fef2f2',
            color: '#dc2626',
            border: '1px solid #fecaca',
            borderRadius: 6,
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          {err}
        </div>
      )}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Requester</th>
              <th>Target</th>
              <th>Role</th>
              <th>Company URL</th>
              <th>Status</th>
              <th>Requested</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {claims.map((c) => {
              const busy = pendingId === c.id || isPending;
              const target = c.device_id
                ? `device: ${c.device_id}`
                : c.manufacturer_id
                ? `mfr: ${c.manufacturer_id}`
                : '—';
              return (
                <tr key={c.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{c.requester_email}</div>
                    {c.requester_name && (
                      <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                        {c.requester_name}
                      </div>
                    )}
                  </td>
                  <td>
                    <code style={{ fontSize: 12 }}>{target}</code>
                  </td>
                  <td>{c.requester_role ?? '—'}</td>
                  <td>
                    {c.company_url ? (
                      <a
                        href={c.company_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 12 }}
                      >
                        {c.company_url.replace(/^https?:\/\//, '').slice(0, 40)}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <span className={`pill ${pillClass(c.status)}`}>{c.status}</span>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {relativeTime(c.created_at)}
                  </td>
                  <td>
                    {c.status === 'pending' ? (
                      <div className="row-actions">
                        <button
                          className="btn primary small"
                          onClick={() => act(c.id, 'approve')}
                          disabled={busy}
                        >
                          {busy ? '…' : 'Approve'}
                        </button>
                        <button
                          className="btn danger small"
                          onClick={() => act(c.id, 'reject')}
                          disabled={busy}
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function pillClass(status: string): string {
  switch (status) {
    case 'pending': return 'medium';
    case 'approved': return 'high';
    case 'claimed': return 'high';
    case 'rejected': return 'low';
    default: return 'none';
  }
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
