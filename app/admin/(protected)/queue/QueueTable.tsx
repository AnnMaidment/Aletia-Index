/**
 * app/admin/queue/QueueTable.tsx
 *
 * Client component. Renders the queue rows with a detail drawer and
 * Accept / Match / Reject / View-on-CT.gov action buttons.
 *
 * All write actions POST to /api/admin/queue/* and then call router.refresh().
 */

'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';

interface Row {
  queue_id: string;
  source: string;
  source_id: string | null;
  device_name: string | null;
  manufacturer: string | null;
  sponsor_type: 'commercial' | 'academic' | null;
  review_reason: string | null;
  specialty_inferred: string | null;
  specialty_confidence: 'high' | 'medium' | 'low' | 'none' | null;
  status: string;
  created_at: string;
  raw_data: any;
}

export default function QueueTable({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<Row | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const actOn = async (
    row: Row,
    action: 'accept' | 'reject' | 'duplicate',
    body: Record<string, any> = {}
  ) => {
    setBusy(row.queue_id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/queue/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queue_id: row.queue_id, ...body }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      setOpen(null);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {error && (
        <div
          style={{
            background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b',
            padding: '8px 12px', borderRadius: 6, marginBottom: 12, fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Device</th>
              <th>Sponsor</th>
              <th>Source</th>
              <th>Specialty</th>
              <th>Reason</th>
              <th>Added</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.queue_id}>
                <td>
                  <button
                    type="button"
                    onClick={() => setOpen(row)}
                    style={{
                      background: 'transparent', border: 'none', padding: 0,
                      textAlign: 'left', cursor: 'pointer', color: 'var(--primary)',
                      fontWeight: 500,
                    }}
                  >
                    {row.device_name || '(no device name)'}
                  </button>
                  {row.source_id && (
                    <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>
                      {row.source_id}
                    </div>
                  )}
                </td>
                <td>
                  <div>{row.manufacturer || '—'}</div>
                  {row.sponsor_type && (
                    <span className={`pill ${row.sponsor_type}`} style={{ marginTop: 4 }}>
                      {row.sponsor_type}
                    </span>
                  )}
                </td>
                <td><span className="pill source">{row.source}</span></td>
                <td>
                  {row.specialty_inferred ? (
                    <>
                      <div>{row.specialty_inferred}</div>
                      {row.specialty_confidence && (
                        <span className={`pill ${row.specialty_confidence}`} style={{ marginTop: 4 }}>
                          {row.specialty_confidence}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="pill none">not matched</span>
                  )}
                </td>
                <td style={{ color: '#475569', fontSize: 12 }}>
                  {row.review_reason || '—'}
                </td>
                <td style={{ color: '#64748b', fontSize: 12 }}>
                  {formatDate(row.created_at)}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                    <button className="btn small" onClick={() => setOpen(row)}>View</button>
                    {row.status === 'pending' && (
                      <>
                        <button
                          className="btn primary small"
                          disabled={busy === row.queue_id}
                          onClick={() => actOn(row, 'accept')}
                        >
                          Accept
                        </button>
                        <button
                          className="btn danger small"
                          disabled={busy === row.queue_id}
                          onClick={() => {
                            if (confirm(`Reject "${row.device_name}"?`)) {
                              actOn(row, 'reject');
                            }
                          }}
                        >
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <Drawer
          row={open}
          busy={busy === open.queue_id}
          onClose={() => setOpen(null)}
          onAccept={(body) => actOn(open, 'accept', body)}
          onReject={(note) => actOn(open, 'reject', { review_note: note })}
          onDuplicate={(note) => actOn(open, 'duplicate', { review_note: note })}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------
// Drawer — full trial detail + accept form
// ---------------------------------------------------------------------

function Drawer({
  row, busy, onClose, onAccept, onReject, onDuplicate,
}: {
  row: Row;
  busy: boolean;
  onClose: () => void;
  onAccept: (body: Record<string, any>) => void;
  onReject: (note: string) => void;
  onDuplicate: (note: string) => void;
}) {
  const raw = row.raw_data || {};
  const [mode, setMode] = useState<'view' | 'accept' | 'reject' | 'duplicate'>('view');

  // Accept form fields (with defaults inferred from raw_data)
  const [deviceName, setDeviceName] = useState(row.device_name || '');
  const [manufacturerName, setManufacturerName] = useState(row.manufacturer || '');
  const [specialty, setSpecialty] = useState(row.specialty_inferred || '');
  const [approvalStatus, setApprovalStatus] = useState<'pre_approval' | 'approved'>('pre_approval');
  const [note, setNote] = useState('');
  const [rejectReason, setRejectReason] = useState('not_ai_ml');
  const [mergeIntoDeviceId, setMergeIntoDeviceId] = useState('');

  const nct = useMemo(() => {
    return (
      raw.nct_id ||
      raw.nctId ||
      raw?.protocolSection?.identificationModule?.nctId ||
      row.source_id ||
      null
    );
  }, [raw, row]);

  const ctGovUrl = nct && String(nct).startsWith('NCT') ? `https://clinicaltrials.gov/study/${nct}` : null;

  const conditions: string[] = useMemo(() => {
    const c = raw.conditions ?? raw?.protocolSection?.conditionsModule?.conditions ?? [];
    return Array.isArray(c) ? c : [c].filter(Boolean);
  }, [raw]);

  const keywords: string[] = useMemo(() => {
    const k = raw.keywords ?? raw?.protocolSection?.conditionsModule?.keywords ?? [];
    return Array.isArray(k) ? k : [k].filter(Boolean);
  }, [raw]);

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div style={{ fontWeight: 600 }}>{row.device_name || '(no name)'}</div>
            <div style={{ color: '#64748b', fontSize: 12 }}>
              {row.source} · {row.source_id || '—'}
              {row.sponsor_type && <> · <span className={`pill ${row.sponsor_type}`}>{row.sponsor_type}</span></>}
            </div>
          </div>
          <button className="btn small" onClick={onClose}>Close</button>
        </div>

        <div className="drawer-body">
          {mode === 'view' && (
            <>
              <dl className="kv">
                <dt>Sponsor</dt><dd>{row.manufacturer || '—'}</dd>
                <dt>Review reason</dt><dd>{row.review_reason || '—'}</dd>
                <dt>Specialty</dt>
                <dd>
                  {row.specialty_inferred ? (
                    <>
                      {row.specialty_inferred}{' '}
                      <span className={`pill ${row.specialty_confidence}`}>{row.specialty_confidence}</span>
                    </>
                  ) : '— not matched —'}
                </dd>
                {nct && (
                  <>
                    <dt>NCT</dt>
                    <dd>
                      {ctGovUrl ? (
                        <a href={ctGovUrl} target="_blank" rel="noopener noreferrer">
                          {nct} ↗
                        </a>
                      ) : String(nct)}
                    </dd>
                  </>
                )}
                <dt>Brief title</dt>
                <dd>{raw.brief_title || raw.briefTitle || raw?.protocolSection?.identificationModule?.briefTitle || '—'}</dd>
                <dt>Conditions</dt>
                <dd>{conditions.length ? conditions.join(', ') : '—'}</dd>
                <dt>Keywords</dt>
                <dd>{keywords.length ? keywords.join(', ') : '—'}</dd>
                <dt>Status</dt>
                <dd>{raw.overall_status || raw.overallStatus || '—'}</dd>
                <dt>Phase</dt>
                <dd>{raw.phase || (raw.phases?.join?.(', ')) || '—'}</dd>
                <dt>Enrollment</dt>
                <dd>{raw.enrollment ?? '—'}</dd>
              </dl>

              <h3 className="section-h">Raw data</h3>
              <pre className="json-block">{JSON.stringify(raw, null, 2)}</pre>
            </>
          )}

          {mode === 'accept' && (
            <>
              <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>
                Accepting creates a <code>device_master</code> row and a <code>pre_approval_profile</code> row
                linked to it. If the manufacturer isn't found, you'll be prompted to create one.
              </p>

              <label className="kv" style={{ display: 'block', marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Device name</div>
                <input
                  type="text"
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  style={inputStyle}
                />
              </label>
              <label className="kv" style={{ display: 'block', marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Manufacturer name</div>
                <input
                  type="text"
                  value={manufacturerName}
                  onChange={(e) => setManufacturerName(e.target.value)}
                  style={inputStyle}
                />
              </label>
              <label className="kv" style={{ display: 'block', marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Specialty</div>
                <input
                  type="text"
                  value={specialty}
                  onChange={(e) => setSpecialty(e.target.value)}
                  placeholder="e.g. Radiology"
                  style={inputStyle}
                />
              </label>
              <label className="kv" style={{ display: 'block', marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Approval status</div>
                <select
                  value={approvalStatus}
                  onChange={(e) => setApprovalStatus(e.target.value as any)}
                  style={inputStyle}
                >
                  <option value="pre_approval">pre_approval (pipeline)</option>
                  <option value="approved">approved (already cleared)</option>
                </select>
              </label>
              <label className="kv" style={{ display: 'block', marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>
                  Merge into existing device_id (optional)
                </div>
                <input
                  type="text"
                  value={mergeIntoDeviceId}
                  onChange={(e) => setMergeIntoDeviceId(e.target.value)}
                  placeholder="e.g. K203345 — leave blank to create new"
                  style={inputStyle}
                />
              </label>
              <label className="kv" style={{ display: 'block' }}>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Note (optional)</div>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  style={{ ...inputStyle, minHeight: 60 }}
                />
              </label>
            </>
          )}

          {(mode === 'reject' || mode === 'duplicate') && (
            <>
              <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>
                Marks the entry as <code>{mode === 'reject' ? 'rejected' : 'duplicate'}</code>. This is recoverable —
                change status back to <code>pending</code> in the database if needed.
              </p>

              {mode === 'reject' && (
                <label className="kv" style={{ display: 'block', marginBottom: 8 }}>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Reason</div>
                  <select value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} style={inputStyle}>
                    <option value="not_ai_ml">not_ai_ml</option>
                    <option value="out_of_scope">out_of_scope</option>
                    <option value="low_quality_name">low_quality_name</option>
                    <option value="inactive_trial">inactive_trial</option>
                    <option value="test_record">test_record</option>
                    <option value="other">other</option>
                  </select>
                </label>
              )}

              <label className="kv" style={{ display: 'block' }}>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Note</div>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={mode === 'reject' ? 'Why is this not an AI/ML pipeline device?' : 'Which existing record is this a duplicate of?'}
                  style={{ ...inputStyle, minHeight: 80 }}
                />
              </label>
            </>
          )}
        </div>

        <div className="drawer-foot">
          {mode === 'view' && row.status === 'pending' && (
            <>
              <button className="btn" onClick={() => setMode('duplicate')}>Mark duplicate</button>
              <button className="btn danger" onClick={() => setMode('reject')}>Reject</button>
              <button className="btn primary" onClick={() => setMode('accept')}>Accept…</button>
            </>
          )}
          {mode === 'accept' && (
            <>
              <button className="btn" onClick={() => setMode('view')}>Back</button>
              <button
                className="btn primary"
                disabled={busy || !deviceName.trim() || !manufacturerName.trim()}
                onClick={() => onAccept({
                  device_name: deviceName.trim(),
                  manufacturer_name: manufacturerName.trim(),
                  specialty: specialty.trim() || null,
                  approval_status: approvalStatus,
                  merge_into_device_id: mergeIntoDeviceId.trim() || null,
                  review_note: note.trim() || null,
                })}
              >
                {busy ? 'Working…' : 'Confirm accept'}
              </button>
            </>
          )}
          {mode === 'reject' && (
            <>
              <button className="btn" onClick={() => setMode('view')}>Back</button>
              <button
                className="btn danger"
                disabled={busy}
                onClick={() => onReject(`${rejectReason}${note ? ` — ${note}` : ''}`)}
              >
                {busy ? 'Working…' : 'Confirm reject'}
              </button>
            </>
          )}
          {mode === 'duplicate' && (
            <>
              <button className="btn" onClick={() => setMode('view')}>Back</button>
              <button
                className="btn"
                disabled={busy}
                onClick={() => onDuplicate(note)}
              >
                {busy ? 'Working…' : 'Confirm duplicate'}
              </button>
            </>
          )}
          {mode === 'view' && row.status !== 'pending' && (
            <span style={{ fontSize: 12, color: '#64748b' }}>Status: {row.status}</span>
          )}
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #e6ebf3',
  borderRadius: 6,
  fontSize: 13,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

function formatDate(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
