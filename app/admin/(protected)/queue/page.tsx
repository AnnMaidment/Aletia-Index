/**
 * app/admin/queue/page.tsx
 *
 * Module 1 — Ingestion Review Queue.
 *
 * Server component. Filters driven by URL search params so the page is
 * bookmarkable and the browser back button works naturally.
 *
 * Actions (Accept / Match / Reject) are in the client island QueueTable.tsx,
 * which POSTs to /api/admin/queue/*.
 */

import { getServiceClient } from '@/lib/adminAudit';
import QueueTable from './QueueTable';

export const dynamic = 'force-dynamic';

interface SearchParams {
  status?: string;
  sponsor_type?: string;
  source?: string;
  review_reason?: string;
  specialty?: string;
  q?: string;
  page?: string;
}

const PAGE_SIZE = 25;

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const admin = getServiceClient();

  const status = sp.status || 'pending';
  const sponsorType = sp.sponsor_type || '';
  const source = sp.source || '';
  const reviewReason = sp.review_reason || '';
  const specialty = sp.specialty || '';
  const q = (sp.q || '').trim();
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = admin
    .from('ingestion_review_queue')
    .select(
      'queue_id, source, source_id, device_name, manufacturer, sponsor_type, review_reason, review_note, specialty_inferred, specialty_confidence, status, created_at, raw_data, possible_merge_candidates',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(from, to);

  if (status !== 'all') query = query.eq('status', status);
  if (sponsorType) query = query.eq('sponsor_type', sponsorType);
  if (source) query = query.eq('source', source);
  if (reviewReason) query = query.eq('review_reason', reviewReason);
  if (specialty === '__none__') query = query.is('specialty_inferred', null);
  else if (specialty) query = query.eq('specialty_inferred', specialty);
  if (q) {
    // Search across device_name and manufacturer (simple ILIKE OR)
    query = query.or(`device_name.ilike.%${q}%,manufacturer.ilike.%${q}%,source_id.ilike.%${q}%`);
  }

  const { data, error, count } = await query;

  // Facets for filter dropdowns — independent queries so they don't filter themselves out
  const [sources, reasons, specialties] = await Promise.all([
    admin.from('ingestion_review_queue').select('source').eq('status', status === 'all' ? 'pending' : status),
    admin.from('ingestion_review_queue').select('review_reason').eq('status', status === 'all' ? 'pending' : status),
    admin.from('ingestion_review_queue').select('specialty_inferred').eq('status', status === 'all' ? 'pending' : status),
  ]);

  const uniqueSources = unique(sources.data?.map((r: any) => r.source));
  const uniqueReasons = unique(reasons.data?.map((r: any) => r.review_reason));
  const uniqueSpecialties = unique(specialties.data?.map((r: any) => r.specialty_inferred));

  const totalPages = count ? Math.ceil(count / PAGE_SIZE) : 1;

  return (
    <div>
      <h1 className="admin-h1">Review Queue</h1>
      <p className="admin-subtle">
        {count ?? 0} {status === 'all' ? 'total' : status} entr{(count ?? 0) === 1 ? 'y' : 'ies'}
        {sponsorType ? ` · ${sponsorType}` : ''}
        {specialty ? ` · ${specialty === '__none__' ? 'no specialty matched' : specialty}` : ''}
      </p>

      <QueueFilters
        current={{ status, sponsorType, source, reviewReason, specialty, q }}
        sources={uniqueSources}
        reasons={uniqueReasons}
        specialties={uniqueSpecialties}
      />

      {error ? (
        <div className="empty-state">Error loading queue: {error.message}</div>
      ) : !data || data.length === 0 ? (
        <div className="empty-state">
          No entries match the current filters. Try broadening the status or clearing sponsor type.
        </div>
      ) : (
        <QueueTable rows={data as any[]} />
      )}

      {totalPages > 1 && (
        <Pagination currentPage={page} totalPages={totalPages} params={sp} />
      )}
    </div>
  );
}

function unique<T>(arr?: (T | null | undefined)[]): T[] {
  if (!arr) return [];
  return Array.from(new Set(arr.filter(Boolean) as T[]));
}

// ---------------------------------------------------------------------
// Inline filter bar (server component, form GET to same page)
// ---------------------------------------------------------------------

function QueueFilters({
  current,
  sources,
  reasons,
  specialties,
}: {
  current: { status: string; sponsorType: string; source: string; reviewReason: string; specialty: string; q: string };
  sources: string[];
  reasons: string[];
  specialties: string[];
}) {
  return (
    <form method="GET" className="filter-bar">
      <label>Status</label>
      <select name="status" defaultValue={current.status}>
        <option value="pending">Pending</option>
        <option value="approved">Approved</option>
        <option value="rejected">Rejected</option>
        <option value="duplicate">Duplicate</option>
        <option value="all">All</option>
      </select>

      <label>Sponsor</label>
      <select name="sponsor_type" defaultValue={current.sponsorType}>
        <option value="">Any</option>
        <option value="commercial">Commercial</option>
        <option value="academic">Academic</option>
      </select>

      <label>Source</label>
      <select name="source" defaultValue={current.source}>
        <option value="">Any</option>
        {sources.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>

      <label>Reason</label>
      <select name="review_reason" defaultValue={current.reviewReason}>
        <option value="">Any</option>
        {reasons.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>

      <label>Specialty</label>
      <select name="specialty" defaultValue={current.specialty}>
        <option value="">Any</option>
        <option value="__none__">— Not matched —</option>
        {specialties.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>

      <input
        name="q"
        type="search"
        placeholder="Search name / sponsor / NCT"
        defaultValue={current.q}
      />

      <button type="submit" className="btn primary small">Apply</button>
      <a href="/admin/queue" className="btn small">Reset</a>
    </form>
  );
}

// ---------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------

function Pagination({
  currentPage,
  totalPages,
  params,
}: {
  currentPage: number;
  totalPages: number;
  params: SearchParams;
}) {
  const buildHref = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== 'page') sp.set(k, v);
    sp.set('page', String(p));
    return `?${sp.toString()}`;
  };

  return (
    <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
      {currentPage > 1 && <a href={buildHref(currentPage - 1)} className="btn small">← Prev</a>}
      <span style={{ fontSize: 12, color: '#64748b' }}>
        Page {currentPage} of {totalPages}
      </span>
      {currentPage < totalPages && <a href={buildHref(currentPage + 1)} className="btn small">Next →</a>}
    </div>
  );
}
