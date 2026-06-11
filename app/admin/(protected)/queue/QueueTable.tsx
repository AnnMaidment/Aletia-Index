/**
 * app/admin/queue/QueueTable.tsx
 *
 * Client component — the consumer surface for the 4d gate's output.
 * Rewritten 10 June 2026 (queue-rewrite session):
 *
 *   - Context-sensitive primary action per row: no candidates → "Accept as
 *     new device"; exactly one HIGH-confidence candidate → one-click
 *     "Merge into ALT-…"; multiple candidates or any medium/low → "Review
 *     candidates" (drawer). Never auto-merge — even the one-click shortcut
 *     lands through the accept route's server-side diff.
 *   - Candidate drawer: confidence badge, matched-on detail, the candidate's
 *     existing external IDs, claim lock.
 *   - Field-level merge diff: picking a target fetches /merge-preview
 *     (server-computed with the same lib/mergeDiff.ts functions the accept
 *     route applies). `same` rows collapse to a count; `enrich` rows are
 *     pre-checked; `conflict` rows default keep-existing and can be flipped.
 *     Accept sends only field_decisions — never values.
 *   - NOTHING IS MANDATORY: the drawer closes at any point, and "Save note &
 *     leave in queue" parks a row (e.g. the 68 multi-candidate eudamed_sync
 *     rows held for the FDA dedup pass) without dispositioning it.
 *   - Legacy rows (possible_merge_candidates null) compute candidates on
 *     drawer open via /candidates, which persists them server-side.
 *   - BUG-011 fixed: Mark-duplicate now collects a target device ID and sends
 *     the snake_case contract the route expects.
 *
 * All write actions POST to /api/admin/queue/* and then router.refresh().
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MergeCandidate } from '@/lib/types';
import type { FieldDiff } from '@/lib/mergeDiff';

// raw_data is a per-source grab-bag (spread ClinicalTrial / FDA payload /
// EudamedDeviceRecord / crosswalk seed) read with deep optional chains — typing
// it costs more than it buys in a display-only drawer.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

interface ApiError extends Error {
  status?: number;
  claimed_by_email?: string | null;
}

const toError = (e: unknown): ApiError =>
  e instanceof Error ? (e as ApiError) : new Error(String(e));

interface Row {
  queue_id: string;
  source: string;
  source_id: string | null;
  device_name: string | null;
  manufacturer: string | null;
  sponsor_type: 'commercial' | 'academic' | null;
  review_reason: string | null;
  review_note: string | null;
  specialty_inferred: string | null;
  specialty_confidence: 'high' | 'medium' | 'low' | 'none' | null;
  status: string;
  created_at: string;
  raw_data: Json;
  possible_merge_candidates: MergeCandidate[] | null;
}

interface MergePreview {
  diffs: FieldDiff[];
  target: {
    aletia_id: string;
    name: string | null;
    claimed_at: string | null;
    claimed_by_email: string | null;
  };
}

type FieldDecision = 'keep' | 'use_incoming';

interface DedupMemberRaw {
  aletia_id: string;
  name: string | null;
  fda_ids: string[];
  product_codes: string[];
  earliest_decision: string | null;
}

// ---------------------------------------------------------------------
// Candidate summary → which primary action a row gets (locked decision 1)
// ---------------------------------------------------------------------

type RowAction =
  | { kind: 'unknown' }                                  // legacy null — compute in drawer
  | { kind: 'new_device' }                               // computed, zero candidates
  | { kind: 'single_high'; candidate: MergeCandidate }   // one-click merge shortcut
  | { kind: 'review' };                                  // multiple, or any medium/low

function rowAction(candidates: MergeCandidate[] | null): RowAction {
  if (candidates == null) return { kind: 'unknown' };
  if (candidates.length === 0) return { kind: 'new_device' };
  if (candidates.length === 1 && candidates[0].confidence === 'high') {
    return { kind: 'single_high', candidate: candidates[0] };
  }
  return { kind: 'review' };
}

export default function QueueTable({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<Row | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Candidates computed on the fly for legacy rows — overlays the prop until
  // the next server refresh picks up the persisted value.
  const [computed, setComputed] = useState<Record<string, MergeCandidate[]>>({});

  const candidatesFor = (row: Row): MergeCandidate[] | null =>
    computed[row.queue_id] ?? row.possible_merge_candidates;

  const isDedup = (row: Row): boolean => row.source === 'fda_dedup';

  const post = async (path: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/admin/queue/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      const err: ApiError = new Error(json.error || `Request failed (${res.status})`);
      err.status = res.status;
      err.claimed_by_email = json.claimed_by_email;
      throw err;
    }
    return json;
  };

  const actOn = async (row: Row, action: string, body: Record<string, unknown> = {}) => {
    setBusy(row.queue_id);
    setError(null);
    try {
      await post(action, { queue_id: row.queue_id, ...body });
      setOpen(null);
      router.refresh();
    } catch (e: unknown) {
      setError(toError(e).message);
    } finally {
      setBusy(null);
    }
  };

  /**
   * Merge accept with the claimed-listing 409 handled: confirm + resend with
   * confirm_claimed_merge=true rather than surfacing a generic error.
   */
  const acceptMerge = async (
    row: Row,
    targetAletiaId: string,
    extra: Record<string, unknown> = {},
  ) => {
    setBusy(row.queue_id);
    setError(null);
    try {
      const body = { queue_id: row.queue_id, merge_into_aletia_id: targetAletiaId, ...extra };
      try {
        await post('accept', body);
      } catch (e: unknown) {
        const err = toError(e);
        if (err.status === 409 && err.claimed_by_email !== undefined) {
          const who = err.claimed_by_email || 'a manufacturer account';
          if (!confirm(`${targetAletiaId} is a CLAIMED listing (${who}).\n\nMerge into it anyway?`)) {
            return;
          }
          await post('accept', { ...body, confirm_claimed_merge: true });
        } else {
          throw e;
        }
      }
      setOpen(null);
      router.refresh();
    } catch (e: unknown) {
      setError(toError(e).message);
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
              <th>Candidates</th>
              <th>Reason</th>
              <th>Added</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const cands = candidatesFor(row);
              const action = rowAction(cands);
              const isBusy = busy === row.queue_id;
              return (
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
                    {row.review_note && (
                      <div style={{ color: '#92400e', fontSize: 11, marginTop: 2 }} title={row.review_note}>
                        ✎ {truncate(row.review_note, 60)}
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
                  <td>
                    <CandidateCell candidates={cands} />
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
                      {row.status === 'pending' && isDedup(row) && (
                        <button
                          className="btn primary small"
                          disabled={isBusy}
                          onClick={() => setOpen(row)}
                        >
                          Review cluster
                        </button>
                      )}
                      {row.status === 'pending' && !isDedup(row) && (
                        <>
                          {action.kind === 'new_device' && (
                            <button
                              className="btn primary small"
                              disabled={isBusy}
                              onClick={() => actOn(row, 'accept')}
                            >
                              Accept as new device
                            </button>
                          )}
                          {action.kind === 'single_high' && (
                            <>
                              <button
                                className="btn primary small"
                                disabled={isBusy}
                                title={`Merge into ${action.candidate.aletia_id}; enrichments fill, conflicts keep existing. Open the drawer to decide per field.`}
                                onClick={() => acceptMerge(row, action.candidate.aletia_id)}
                              >
                                Merge into {action.candidate.aletia_id}
                                {action.candidate.claimed_by_email ? ' 🔒' : ''}
                              </button>
                              <button
                                className="btn small"
                                disabled={isBusy}
                                onClick={() => actOn(row, 'accept')}
                              >
                                New device
                              </button>
                            </>
                          )}
                          {(action.kind === 'review' || action.kind === 'unknown') && (
                            <button
                              className="btn primary small"
                              disabled={isBusy}
                              onClick={() => setOpen(row)}
                            >
                              {action.kind === 'review' ? 'Review candidates' : 'Review'}
                            </button>
                          )}
                          <button
                            className="btn danger small"
                            disabled={isBusy}
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
              );
            })}
          </tbody>
        </table>
      </div>

      {open && (
        <Drawer
          row={open}
          candidates={candidatesFor(open)}
          onCandidatesComputed={(queueId, cands) =>
            setComputed((m) => ({ ...m, [queueId]: cands }))
          }
          busy={busy === open.queue_id}
          onClose={() => setOpen(null)}
          onAcceptNew={(body) => actOn(open, 'accept', body)}
          onAcceptMerge={(targetId, extra) => acceptMerge(open, targetId, extra)}
          onReject={(note) => actOn(open, 'reject', { review_note: note })}
          onDuplicate={(targetId, note) =>
            actOn(open, 'duplicate', { target_device_id: targetId, review_note: note })
          }
          onSaveNote={(note) => actOn(open, 'note', { review_note: note })}
          onDedupMerge={(survivor, absorbedIds, note) =>
            actOn(open, 'dedup-merge', {
              survivor_aletia_id: survivor,
              absorbed_aletia_ids: absorbedIds,
              review_note: note,
            })
          }
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------
// Candidate summary cell (list view)
// ---------------------------------------------------------------------

function CandidateCell({ candidates }: { candidates: MergeCandidate[] | null }) {
  if (candidates == null) {
    return <span className="pill none" title="Pre-A2b row — open to compute">not computed</span>;
  }
  if (candidates.length === 0) {
    return <span style={{ color: '#64748b', fontSize: 12 }}>none</span>;
  }
  const best = candidates[0];
  return (
    <div style={{ fontSize: 12 }}>
      <span className={`pill ${best.confidence}`}>{best.confidence}</span>{' '}
      <span style={{ color: '#475569' }}>
        {candidates.length === 1 ? best.aletia_id : `${candidates.length} candidates`}
      </span>
      {candidates.some((c) => c.claimed_by_email) && <span title="A candidate is a claimed listing"> 🔒</span>}
    </div>
  );
}

// ---------------------------------------------------------------------
// Drawer — detail, candidates, field-level merge diff, dispositions
// ---------------------------------------------------------------------

type DrawerMode = 'view' | 'accept' | 'merge' | 'reject' | 'duplicate' | 'dedup';

function Drawer({
  row, candidates, onCandidatesComputed, busy, onClose,
  onAcceptNew, onAcceptMerge, onReject, onDuplicate, onSaveNote, onDedupMerge,
}: {
  row: Row;
  candidates: MergeCandidate[] | null;
  onCandidatesComputed: (queueId: string, cands: MergeCandidate[]) => void;
  busy: boolean;
  onClose: () => void;
  onAcceptNew: (body: Record<string, unknown>) => void;
  onAcceptMerge: (targetAletiaId: string, extra: Record<string, unknown>) => void;
  onReject: (note: string) => void;
  onDuplicate: (targetDeviceId: string, note: string) => void;
  onSaveNote: (note: string) => void;
  onDedupMerge: (survivor: string, absorbedIds: string[], note: string | null) => void;
}) {
  const raw: Json = useMemo(() => row.raw_data || {}, [row.raw_data]);
  const isDedupRow = row.source === 'fda_dedup';
  const [mode, setMode] = useState<DrawerMode>(isDedupRow ? 'dedup' : 'view');

  // Accept-as-new form fields (defaults inferred from the queue row)
  const [deviceName, setDeviceName] = useState(row.device_name || '');
  const [manufacturerName, setManufacturerName] = useState(row.manufacturer || '');
  const [specialty, setSpecialty] = useState(row.specialty_inferred || '');
  const [approvalStatus, setApprovalStatus] = useState<'pre_approval' | 'approved'>('pre_approval');
  const [note, setNote] = useState(row.review_note || '');
  const [rejectReason, setRejectReason] = useState('not_ai_ml');
  const [duplicateTarget, setDuplicateTarget] = useState('');

  // Legacy rows: compute candidates on open (persisted server-side; once).
  const [computing, setComputing] = useState(false);
  const [computeError, setComputeError] = useState<string | null>(null);
  useEffect(() => {
    if (candidates != null || computing) return;
    let cancelled = false;
    setComputing(true);
    fetch('/api/admin/queue/candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queue_id: row.queue_id }),
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `Candidate compute failed (${res.status})`);
        if (!cancelled) onCandidatesComputed(row.queue_id, json.candidates ?? []);
      })
      .catch((e: unknown) => { if (!cancelled) setComputeError(toError(e).message); })
      .finally(() => { if (!cancelled) setComputing(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.queue_id, candidates]);

  // Merge state: selected candidate + server-computed diff + decisions.
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, FieldDecision>>({});

  // Dedup cluster state (fda_dedup rows). Survivor defaults to the proposed one;
  // all other members default to "absorb". Deselecting a member keeps it as a
  // separate device (the brand-family split).
  const dedupMembers: DedupMemberRaw[] = useMemo(
    () => (isDedupRow && Array.isArray(raw.members) ? (raw.members as DedupMemberRaw[]) : []),
    [isDedupRow, raw],
  );
  const [survivor, setSurvivor] = useState<string>(
    isDedupRow ? (raw.proposed_survivor as string) ?? '' : '',
  );
  const [absorbSel, setAbsorbSel] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    if (isDedupRow && Array.isArray(raw.members)) {
      for (const m of raw.members as DedupMemberRaw[]) init[m.aletia_id] = true;
    }
    return init;
  });

  const openMerge = async (targetAletiaId: string) => {
    setMode('merge');
    setMergeTarget(targetAletiaId);
    setPreview(null);
    setPreviewError(null);
    setDecisions({});
    try {
      const res = await fetch('/api/admin/queue/merge-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queue_id: row.queue_id, target_aletia_id: targetAletiaId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Preview failed (${res.status})`);
      const p = json as MergePreview;
      setPreview(p);
      // Initialise decisions from each row's suggested default — what the
      // route would do unprompted (enrich fills, conflict keeps).
      const init: Record<string, FieldDecision> = {};
      for (const d of p.diffs) {
        if (d.status !== 'same') init[d.field] = d.suggested;
      }
      setDecisions(init);
    } catch (e: unknown) {
      setPreviewError(toError(e).message);
    }
  };

  const nct = useMemo(() => {
    return (
      raw.nct_id ||
      raw.nctId ||
      raw?.protocolSection?.identificationModule?.nctId ||
      (row.source === 'clinical_trials' ? row.source_id : null) ||
      null
    );
  }, [raw, row]);

  const ctGovUrl = nct && String(nct).startsWith('NCT') ? `https://clinicaltrials.gov/study/${nct}` : null;

  const conditions: string[] = useMemo(() => {
    const c = raw.conditions ?? raw?.protocolSection?.conditionsModule?.conditions ?? [];
    return Array.isArray(c) ? c : [c].filter(Boolean);
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
          {mode === 'dedup' && (
            <>
              <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>
                These FDA rows look like the <strong>same product</strong> cleared under
                multiple submissions ({(raw.band as string) === 'C' ? 'fuzzy name match — check carefully' : 'exact name, differing product codes'}).
                Pick the <strong>survivor</strong> (keeps its Aletia ID and gains every
                submission number); tick the rows to <strong>absorb</strong> into it. Untick
                any that are a <em>different</em> product — they stay separate. Absorbed rows
                are tombstoned (reversible), never deleted.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {dedupMembers.map((m) => {
                  const isSurvivor = m.aletia_id === survivor;
                  return (
                    <div
                      key={m.aletia_id}
                      style={{
                        border: '1px solid #e6ebf3', borderRadius: 8, padding: '8px 10px',
                        fontSize: 13, display: 'flex', gap: 10, alignItems: 'flex-start',
                        background: isSurvivor ? '#f0fdf4' : 'transparent',
                      }}
                    >
                      <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', minWidth: 70 }}>
                        <input
                          type="radio"
                          name="dedup-survivor"
                          checked={isSurvivor}
                          onChange={() => {
                            setSurvivor(m.aletia_id);
                            // The survivor is never also absorbed.
                            setAbsorbSel((s) => ({ ...s, [m.aletia_id]: false }));
                          }}
                        />
                        survivor
                      </label>
                      <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start', cursor: 'pointer', flex: 1 }}>
                        <input
                          type="checkbox"
                          disabled={isSurvivor}
                          checked={!isSurvivor && (absorbSel[m.aletia_id] ?? false)}
                          onChange={(e) => setAbsorbSel((s) => ({ ...s, [m.aletia_id]: e.target.checked }))}
                          style={{ marginTop: 3 }}
                        />
                        <span>
                          <span style={{ fontWeight: 600 }}>{m.aletia_id}</span>{' '}
                          {isSurvivor && <span className="pill high">survivor</span>}
                          <br />
                          {m.name ?? '(no name)'}
                          <br />
                          <span style={{ color: '#64748b', fontSize: 12 }}>
                            subs: {m.fda_ids.join(', ') || '—'} · codes: {m.product_codes.join(', ') || '—'}
                            {m.earliest_decision ? ` · ${m.earliest_decision}` : ''}
                          </span>
                        </span>
                      </label>
                    </div>
                  );
                })}
              </div>

              <label className="kv" style={{ display: 'block', marginTop: 12 }}>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Note (optional)</div>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  style={{ ...inputStyle, minHeight: 50 }}
                />
              </label>
            </>
          )}

          {mode === 'view' && (
            <>
              <dl className="kv">
                <dt>Manufacturer / sponsor</dt><dd>{row.manufacturer || '—'}</dd>
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
                {conditions.length > 0 && (
                  <>
                    <dt>Conditions</dt>
                    <dd>{conditions.join(', ')}</dd>
                  </>
                )}
              </dl>

              <h3 className="section-h">Merge candidates</h3>
              {computing && <p style={{ fontSize: 13, color: '#64748b' }}>Computing candidates…</p>}
              {computeError && (
                <p style={{ fontSize: 13, color: '#991b1b' }}>Candidate compute failed: {computeError}</p>
              )}
              {candidates != null && candidates.length === 0 && (
                <p style={{ fontSize: 13, color: '#64748b' }}>
                  No merge candidates — safe to accept as a new device.
                </p>
              )}
              {candidates != null && candidates.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                  {candidates.map((c) => (
                    <CandidateCard
                      key={c.aletia_id}
                      candidate={c}
                      disabled={busy || row.status !== 'pending'}
                      onMerge={() => openMerge(c.aletia_id)}
                    />
                  ))}
                </div>
              )}

              {row.status === 'pending' && (
                <>
                  <h3 className="section-h">Park (leave in queue)</h3>
                  <p style={{ fontSize: 12, color: '#64748b', marginTop: 0 }}>
                    No disposition is required. Save a note and leave the row pending —
                    e.g. multi-candidate rows held for the FDA dedup pass.
                  </p>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. candidates are suspected FDA fragments — hold for dedup"
                    style={{ ...inputStyle, minHeight: 50 }}
                  />
                  <div style={{ marginTop: 6 }}>
                    <button
                      className="btn small"
                      disabled={busy || note === (row.review_note || '')}
                      onClick={() => onSaveNote(note)}
                    >
                      {busy ? 'Working…' : 'Save note & leave in queue'}
                    </button>
                  </div>
                </>
              )}

              <h3 className="section-h">Raw data</h3>
              <pre className="json-block">{JSON.stringify(raw, null, 2)}</pre>
            </>
          )}

          {mode === 'accept' && (
            <>
              <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>
                Accepting as a <strong>new device</strong> creates a <code>device_master</code> row plus
                rows in <code>device_external_ids</code> and (for trial-sourced entries){' '}
                <code>device_trials</code>. To merge into an existing device instead, go
                back and pick a candidate.
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
                  onChange={(e) => setApprovalStatus(e.target.value as 'pre_approval' | 'approved')}
                  style={inputStyle}
                >
                  <option value="pre_approval">pre_approval (pipeline)</option>
                  <option value="approved">approved (already cleared)</option>
                </select>
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

          {mode === 'merge' && (
            <>
              <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>
                Merging into <strong>{mergeTarget}</strong>
                {preview?.target?.name ? <> — <em>{preview.target.name}</em></> : null}.
                The identity stays {mergeTarget}; this row&apos;s identifier and (for
                EUDAMED) the EU registration are always added. The fields below are the
                only content writes — recomputed server-side on accept.
              </p>

              {preview?.target?.claimed_at && (
                <div
                  style={{
                    background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e',
                    padding: '8px 12px', borderRadius: 6, marginBottom: 12, fontSize: 13,
                  }}
                >
                  🔒 This is a <strong>claimed listing</strong>
                  {preview.target.claimed_by_email ? ` (${preview.target.claimed_by_email})` : ''}.
                  You&apos;ll be asked to confirm the merge.
                </div>
              )}

              {previewError && (
                <p style={{ fontSize: 13, color: '#991b1b' }}>Diff failed: {previewError}</p>
              )}
              {!preview && !previewError && (
                <p style={{ fontSize: 13, color: '#64748b' }}>Computing field diff…</p>
              )}

              {preview && (
                <DiffPanel
                  diffs={preview.diffs}
                  decisions={decisions}
                  onDecide={(field, d) => setDecisions((m) => ({ ...m, [field]: d }))}
                />
              )}

              <label className="kv" style={{ display: 'block', marginTop: 12 }}>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Note (optional)</div>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  style={{ ...inputStyle, minHeight: 50 }}
                />
              </label>
            </>
          )}

          {mode === 'reject' && (
            <>
              <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>
                Marks the entry as <code>rejected</code>. This is recoverable —
                change status back to <code>pending</code> in the database if needed.
              </p>
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
              <label className="kv" style={{ display: 'block' }}>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Note</div>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Why is this not an AI/ML pipeline device?"
                  style={{ ...inputStyle, minHeight: 80 }}
                />
              </label>
            </>
          )}

          {mode === 'duplicate' && (
            <>
              <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>
                Marks the entry as a <code>duplicate</code> of an existing device.
                This is a queue disposition only — <code>device_master</code> is not
                modified. To <em>enrich</em> the existing device with this row&apos;s
                identifier and data, use a merge instead.
              </p>
              <label className="kv" style={{ display: 'block', marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>
                  Duplicate of (Aletia ID, required)
                </div>
                <input
                  type="text"
                  value={duplicateTarget}
                  onChange={(e) => setDuplicateTarget(e.target.value)}
                  placeholder="e.g. ALT-001234"
                  style={inputStyle}
                />
              </label>
              <label className="kv" style={{ display: 'block' }}>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Note</div>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Why is this the same record?"
                  style={{ ...inputStyle, minHeight: 80 }}
                />
              </label>
            </>
          )}
        </div>

        <div className="drawer-foot">
          {mode === 'dedup' && row.status === 'pending' && (() => {
            const toAbsorb = dedupMembers
              .map((m) => m.aletia_id)
              .filter((id) => id !== survivor && (absorbSel[id] ?? false));
            return (
              <>
                <button
                  className="btn danger"
                  disabled={busy}
                  onClick={() => onReject(note.trim() ? `not_a_cluster — ${note.trim()}` : 'not_a_cluster')}
                >
                  Not a cluster (reject)
                </button>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => onSaveNote(note)}
                >
                  Save note & leave
                </button>
                <button
                  className="btn primary"
                  disabled={busy || !survivor || toAbsorb.length === 0}
                  title={toAbsorb.length === 0 ? 'Tick at least one row to absorb' : ''}
                  onClick={() => onDedupMerge(survivor, toAbsorb, note.trim() || null)}
                >
                  {busy ? 'Working…' : `Collapse ${toAbsorb.length} into ${survivor}`}
                </button>
              </>
            );
          })()}
          {mode === 'view' && row.status === 'pending' && (
            <>
              <button className="btn" onClick={() => setMode('duplicate')}>Mark duplicate</button>
              <button className="btn danger" onClick={() => setMode('reject')}>Reject</button>
              <button className="btn primary" onClick={() => setMode('accept')}>Accept as new…</button>
            </>
          )}
          {mode === 'accept' && (
            <>
              <button className="btn" onClick={() => setMode('view')}>Back</button>
              <button
                className="btn primary"
                disabled={busy || !deviceName.trim() || !manufacturerName.trim()}
                onClick={() => onAcceptNew({
                  device_name: deviceName.trim(),
                  manufacturer_name: manufacturerName.trim(),
                  specialty: specialty.trim() || null,
                  approval_status: approvalStatus,
                  review_note: note.trim() || null,
                })}
              >
                {busy ? 'Working…' : 'Create new device'}
              </button>
            </>
          )}
          {mode === 'merge' && (
            <>
              <button className="btn" onClick={() => { setMode('view'); setMergeTarget(null); }}>Back</button>
              <button
                className="btn primary"
                disabled={busy || !preview || !mergeTarget}
                onClick={() => mergeTarget && onAcceptMerge(mergeTarget, {
                  field_decisions: decisions,
                  review_note: note.trim() || null,
                  ...(preview?.target?.claimed_at ? { confirm_claimed_merge: true } : {}),
                })}
              >
                {busy ? 'Working…' : `Merge into ${mergeTarget}`}
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
                disabled={busy || !duplicateTarget.trim()}
                onClick={() => onDuplicate(duplicateTarget.trim(), note)}
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

// ---------------------------------------------------------------------
// Candidate card (drawer)
// ---------------------------------------------------------------------

function CandidateCard({
  candidate, disabled, onMerge,
}: {
  candidate: MergeCandidate;
  disabled: boolean;
  onMerge: () => void;
}) {
  const m = candidate.matched_on;
  return (
    <div
      style={{
        border: '1px solid #e6ebf3', borderRadius: 8, padding: '10px 12px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12,
      }}
    >
      <div style={{ fontSize: 13 }}>
        <div style={{ fontWeight: 600 }}>
          {candidate.aletia_id}{' '}
          <span className={`pill ${candidate.confidence}`}>{candidate.confidence}</span>
          {candidate.claimed_by_email && (
            <span title={`Claimed by ${candidate.claimed_by_email}`}> 🔒</span>
          )}
        </div>
        <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>
          manufacturer: {m.manufacturer} · name similarity: {Math.round(m.device_name_dice * 100)}%
        </div>
        {candidate.existing_ids.length > 0 && (
          <div style={{ color: '#475569', fontSize: 12, marginTop: 4 }}>
            {candidate.existing_ids.map((id) => (
              <span
                key={`${id.id_type}:${id.id_value}`}
                style={{
                  display: 'inline-block', background: '#f1f5f9', borderRadius: 4,
                  padding: '1px 6px', marginRight: 4, marginBottom: 2,
                }}
              >
                {id.id_type}: {id.id_value}
              </span>
            ))}
          </div>
        )}
        {candidate.claimed_by_email && (
          <div style={{ color: '#92400e', fontSize: 12, marginTop: 4 }}>
            Claimed listing — merging requires confirmation.
          </div>
        )}
      </div>
      <button className="btn primary small" disabled={disabled} onClick={onMerge} style={{ flexShrink: 0 }}>
        Merge into this →
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------
// Field-level diff panel (drawer, merge mode)
// ---------------------------------------------------------------------

function DiffPanel({
  diffs, decisions, onDecide,
}: {
  diffs: FieldDiff[];
  decisions: Record<string, FieldDecision>;
  onDecide: (field: string, d: FieldDecision) => void;
}) {
  const same = diffs.filter((d) => d.status === 'same');
  const enrich = diffs.filter((d) => d.status === 'enrich');
  const conflict = diffs.filter((d) => d.status === 'conflict');

  if (diffs.length === 0) {
    return (
      <p style={{ fontSize: 13, color: '#64748b' }}>
        The incoming record offers no content fields — the merge will only add the
        identifier{'/'}registration.
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {same.length > 0 && (
        <div style={{ fontSize: 12, color: '#15803d' }}>
          ✓ {same.length} field{same.length === 1 ? '' : 's'} already agree{same.length === 1 ? 's' : ''} ({same.map((d) => d.label).join(', ')})
        </div>
      )}

      {conflict.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#b45309', marginBottom: 6 }}>
            Conflicts — existing value is kept unless you flip to incoming
          </div>
          {conflict.map((d) => (
            <DiffRow key={d.field} diff={d} decision={decisions[d.field] ?? d.suggested} onDecide={onDecide} accent="#fde68a" />
          ))}
        </div>
      )}

      {enrich.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#0369a1', marginBottom: 6 }}>
            Enrichments — currently empty on the target, pre-checked to fill
          </div>
          {enrich.map((d) => (
            <DiffRow key={d.field} diff={d} decision={decisions[d.field] ?? d.suggested} onDecide={onDecide} accent="#bae6fd" />
          ))}
        </div>
      )}
    </div>
  );
}

function DiffRow({
  diff, decision, onDecide, accent,
}: {
  diff: FieldDiff;
  decision: FieldDecision;
  onDecide: (field: string, d: FieldDecision) => void;
  accent: string;
}) {
  return (
    <div
      style={{
        border: `1px solid ${accent}`, borderRadius: 6, padding: '8px 10px',
        marginBottom: 6, fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{diff.label}</div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer', marginBottom: 2 }}>
        <input
          type="radio"
          name={`diff-${diff.field}`}
          checked={decision === 'keep'}
          onChange={() => onDecide(diff.field, 'keep')}
          style={{ marginTop: 3 }}
        />
        <span>
          <span style={{ color: '#64748b', fontSize: 11 }}>keep existing</span>
          <br />{diff.existing ?? <em style={{ color: '#94a3b8' }}>(empty)</em>}
        </span>
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
        <input
          type="radio"
          name={`diff-${diff.field}`}
          checked={decision === 'use_incoming'}
          onChange={() => onDecide(diff.field, 'use_incoming')}
          style={{ marginTop: 3 }}
        />
        <span>
          <span style={{ color: '#64748b', fontSize: 11 }}>use incoming</span>
          <br />{diff.incoming ?? <em style={{ color: '#94a3b8' }}>(empty)</em>}
        </span>
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------

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

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
