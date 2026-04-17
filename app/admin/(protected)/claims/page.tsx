/**
 * app/admin/(protected)/claims/page.tsx
 *
 * Module 2 — Claim Requests. Lists self-initiated claim requests from
 * the claim_requests table. Admin can approve (triggers claim completion)
 * or reject a request, with an optional note.
 *
 * Query params:
 *   ?status=pending|approved|rejected|claimed|all
 *   ?q=<search in email / company_url>
 *   ?page=<n>  (default 1, page size 50)
 */

import Link from 'next/link';
import { getServiceClient } from '@/lib/adminAudit';
import ClaimsTable from './ClaimsTable';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

interface SearchParams {
  status?: string;
  q?: string;
  page?: string;
}

export default async function ClaimsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const status = sp.status ?? 'pending';
  const q = (sp.q ?? '').trim();
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const admin = getServiceClient();
  let query = admin
    .from('claim_requests')
    .select(
      'id, device_id, manufacturer_id, requester_email, requester_name, requester_role, company_url, status, created_at, token_expires_at',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(from, to);

  if (status !== 'all') query = query.eq('status', status);
  if (q) {
    query = query.or(`requester_email.ilike.%${q}%,company_url.ilike.%${q}%`);
  }

  const { data: claims, count, error } = await query;

  const totalPages = count ? Math.max(1, Math.ceil(count / PAGE_SIZE)) : 1;

  return (
    <div>
      <h1 className="admin-h1">Claim Requests</h1>
      <p className="admin-subtle">
        Self-initiated manufacturer claims awaiting admin approval. Approving
        marks the target device or manufacturer as claimed and records the
        requester's email; the token-based verification email is not re-sent
        from here — use the dashboard flow if needed.
      </p>

      <form className="filter-bar" method="get">
        <label>Status</label>
        <select name="status" defaultValue={status}>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="claimed">Claimed</option>
          <option value="all">All</option>
        </select>

        <label>Search</label>
        <input type="search" name="q" defaultValue={q} placeholder="email or company url" />

        <button className="btn primary small" type="submit">Apply</button>
        <Link className="btn small" href="/admin/claims">Clear</Link>
        <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 12 }}>
          {count ?? 0} total
        </span>
      </form>

      {error ? (
        <div className="empty-state" style={{ color: 'var(--danger)' }}>
          Error loading claim requests: {error.message}
        </div>
      ) : !claims || claims.length === 0 ? (
        <div className="empty-state">No claim requests match those filters.</div>
      ) : (
        <ClaimsTable claims={claims} />
      )}

      {totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} status={status} q={q} />
      )}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  status,
  q,
}: {
  page: number;
  totalPages: number;
  status: string;
  q: string;
}) {
  const mkHref = (p: number) => {
    const sp = new URLSearchParams();
    if (status) sp.set('status', status);
    if (q) sp.set('q', q);
    sp.set('page', String(p));
    return `/admin/claims?${sp.toString()}`;
  };
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 16 }}>
      {page > 1 && <Link className="btn small" href={mkHref(page - 1)}>← Prev</Link>}
      <span style={{ fontSize: 13, color: 'var(--muted)', alignSelf: 'center', padding: '0 8px' }}>
        Page {page} of {totalPages}
      </span>
      {page < totalPages && <Link className="btn small" href={mkHref(page + 1)}>Next →</Link>}
    </div>
  );
}
