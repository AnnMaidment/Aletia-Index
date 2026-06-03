'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Device } from '@/lib/types'
import { PIPELINE_LABELS } from '@/lib/types'
import { AutonomousBadge } from './AutonomousBadge'

// Extend Device locally to include pre_approval_profile without touching shared types
type PreApprovalProfile = {
  dev_stage:    string | null
  trial_phase:  string | null
  nct_number:   string | null
}

type DeviceWithPipeline = Device & {
  pre_approval_profile?: PreApprovalProfile | null
  description?: string | null
  device_trials?: {
    title: string | null
    brief_summary: string | null
    status: string | null
    trial_role: string | null
  }[]
}

interface Props {
  devices:     DeviceWithPipeline[]
  totalCount:  number
  page:        number
  pageSize:    number
  filterQuery: string
}

const riskBadge = (status: string) => {
  if (status === 'Green') return { cls: 'badge ok',     label: 'Lower'    }
  if (status === 'Red')   return { cls: 'badge danger', label: 'Higher'   }
  return                         { cls: 'badge warn',   label: 'Moderate' }
}

// Country code → regulatory body label for the row-level jurisdiction chips.
// The country codes come from regional_registrations.country (ISO-2 in the
// schema). Users recognise the body name (FDA, MHRA) not the country code,
// so we render the body. Unknown codes fall through to the raw value so no
// jurisdiction is ever silently dropped.
const BODY_LABEL: Record<string, string> = {
  US: 'FDA',
  GB: 'MHRA',
  EU: 'EU MDR',
  ZA: 'SAHPRA',
}

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' }) : 'Not reviewed'

function pageHref(p: number, filterQuery: string): string {
  const params = new URLSearchParams(filterQuery)
  if (p > 1) params.set('page', String(p))
  const q = params.toString()
  return q ? `/?${q}` : '/'
}

export default function DeviceGrid({ devices, totalCount, page, pageSize, filterQuery }: Props) {
  const [selected, setSelected] = useState<DeviceWithPipeline | null>(null)
  const totalPages = Math.ceil(totalCount / pageSize)

  return (
    <>
      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ minWidth: '260px' }}>Tool</th>
              <th style={{ minWidth: '340px' }}>Description</th>
              <th style={{ minWidth: '180px' }}>Regulatory Status</th>
              <th style={{ minWidth: '100px' }}>Risk</th>
              <th style={{ minWidth: '180px' }}>Last sync</th>
              <th style={{ minWidth: '110px', textAlign: 'right' }}> </th>
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)' }}>
                  No devices found.
                </td>
              </tr>
            ) : devices.map(device => {
              const isPreClearance = !!device.pipeline_stage
              const dataSource     = device.data_source ?? 'registry_sync'
              const pap            = device.pre_approval_profile   // may be null for cleared devices

              return (
                <tr
                  key={device.aletia_id}
                  className={isPreClearance ? 'pipelineRow' : ''}
                >
                  {/* ── Tool ── */}
                  <td>
                    <div className="rowTitle">
                      {/* Icon — slightly muted for pipeline rows */}
                      <div className="appIcon" style={isPreClearance ? { background: '#f1f5f9', border: '1px solid #e2e8f0' } : undefined}>
                        <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
                          <path d="M12 3 4 21h4l1.3-3h5.4L16 21h4L12 3Zm1.6 10H10.4L12 8.6 13.6 13Z"
                            fill={isPreClearance ? '#94a3b8' : '#1f6feb'} />
                        </svg>
                      </div>
                      <div>
                        <a
                          href={`/device/${device.aletia_id}`}
                          className="appName"
                          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                        >
                          {isPreClearance
                            ? (device.name || device.manufacturers?.name || device.manufacturer_name || device.aletia_id)
                            : (device.manufacturers?.name || device.manufacturer_name || device.aletia_id)}
                        </a>
                        {isPreClearance && device.name && (device.manufacturers?.name || device.manufacturer_name) && (
                          <div className="appOrg" style={{ fontWeight: 500, color: 'var(--text)' }}>
                            {device.manufacturers?.name || device.manufacturer_name}
                          </div>
                        )}
                        <div className="appOrg">{device.aletia_id}</div>

                        {/* Jurisdiction chip strip — only when the device has regional_registrations.
                            Pipeline-only devices have none and get no strip. Devices cleared in
                            multiple regions get one chip per region. Country code → body label
                            via BODY_LABEL; unknown codes fall through to the raw value. */}
                        {!isPreClearance && (device.regional_registrations?.length ?? 0) > 0 && (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                            {[...new Set(device.regional_registrations.map(r => r.country))].map(code => (
                              <span
                                key={code}
                                className="badge neutral"
                                style={{ fontSize: 10.5, padding: '2px 7px', fontWeight: 700, letterSpacing: '.3px' }}
                              >
                                {BODY_LABEL[code] ?? code}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Data-source badges — only shown for cleared devices */}
                        {!isPreClearance && dataSource === 'aletia_research' && (
                          <span className="badge research" style={{ marginTop: 4 }}>ⓘ Aletia Research</span>
                        )}
                        {!isPreClearance && dataSource === 'manufacturer_submitted' && (
                          <span className="badge research" style={{ marginTop: 4, background: '#f0fdf4', color: '#15803d', borderColor: 'rgba(21,128,61,.15)' }}>
                            ✓ Manufacturer Submitted
                          </span>
                        )}
                        {device.breakthrough_designation && (
                          <span className="badge breakthrough" style={{ marginTop: 4, fontSize: 11, padding: '3px 8px' }}>⚡ Breakthrough</span>
                        )}
                        {device.autonomous_output_mode && (
                          <div style={{ marginTop: 4 }}>
                            <AutonomousBadge
                              description={device.autonomous_output_description}
                              riskClass={device.eu_risk_class}
                              dataSource={device.data_source}
                              deviceId={device.aletia_id}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* ── Description ── */}
                  <td>
                    <div
                      style={{
                        fontSize: '13px',
                        color: 'var(--text)',
                        lineHeight: 1.5,
                        display: '-webkit-box',
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {device.description?.trim()
  || device.intended_use?.trim()
  || device.device_trials?.find((t) => t.brief_summary)?.brief_summary
  || device.device_trials?.[0]?.title
  || '—'}
                    </div>
                  </td>

                  {/* ── Regulatory Status ── */}
                  <td>
                    {isPreClearance ? (
                      /* Pipeline: show pipeline stage + trial info */
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        <span className="badge pipeline">
                          ⚗ {PIPELINE_LABELS[device.pipeline_stage!] ?? device.pipeline_stage}
                        </span>
                        {pap?.trial_phase && (
                          <span className="badge trial" style={{ fontSize: 11 }}>
                            Phase {pap.trial_phase}
                          </span>
                        )}
                        {pap?.nct_number && (
                          <a
                            href={`https://clinicaltrials.gov/study/${pap.nct_number}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: 11, color: '#6366f1', fontWeight: 600, textDecoration: 'none', marginTop: 1 }}
                            title="View on ClinicalTrials.gov"
                          >
                            {pap.nct_number} ↗
                          </a>
                        )}
                      </div>
                    ) : device.regional_registrations?.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {device.regional_registrations.map(r => (
                          <span key={r.regulatory_body} className="badge neutral" style={{ fontSize: 11 }}>
                            {r.clearance_type || r.regulatory_body}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="badge neutral">Unregistered</span>
                    )}
                  </td>

                  {/* ── Risk ── */}
                  {/* Per honesty cleanup (May 2026): the badge was derived from
                      health_status, which defaults to Amber on every device. Showing
                      "Moderate" on every cleared row was theatre. Until per-device risk
                      data is real, render — uniformly. The modal still uses riskBadge
                      where the user has actively opted in to detail. */}
                  <td>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>—</span>
                  </td>

                  {/* ── Last sync ── */}
                  <td>
                    {isPreClearance ? (
                      <div style={{ fontSize: '13px', color: 'var(--muted)' }}>Pipeline entry</div>
                    ) : (
                      <div style={{ fontSize: '13px', color: 'var(--text)' }}>
                        {fmtDate(device.last_automated_sync)}
                      </div>
                    )}
                  </td>

                  {/* ── Actions ── */}
                  <td style={{ textAlign: 'right' }}>
                    <div className="actionCell">
                      <button className="quickViewBtn" title="Quick view" onClick={() => setSelected(device)}>
                        <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                          <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z" stroke="#64748b" strokeWidth="1.8" />
                          <circle cx="12" cy="12" r="3" stroke="#64748b" strokeWidth="1.8" />
                        </svg>
                      </button>
                      <a href={`/device/${device.aletia_id}`} className="reportBtn">View</a>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 16px', borderTop: '1px solid var(--line)',
            fontSize: 13, color: 'var(--muted)',
          }}>
            <span>
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalCount)} of {totalCount}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <Link
                href={pageHref(page - 1, filterQuery)}
                className="secondaryBtn"
                aria-disabled={page === 1}
                style={{ padding: '7px 12px', fontSize: 13, opacity: page === 1 ? 0.4 : 1, pointerEvents: page === 1 ? 'none' : 'auto' }}
              >← Prev</Link>
              <span style={{ padding: '7px 12px', borderRadius: 12, background: '#f1f5f9', fontWeight: 700, color: 'var(--text)', fontSize: 13 }}>
                {page} / {totalPages}
              </span>
              <Link
                href={pageHref(page + 1, filterQuery)}
                className="secondaryBtn"
                aria-disabled={page === totalPages}
                style={{ padding: '7px 12px', fontSize: 13, opacity: page === totalPages ? 0.4 : 1, pointerEvents: page === totalPages ? 'none' : 'auto' }}
              >Next →</Link>
            </div>
          </div>
        )}
      </div>

      {/* ── Quick-view Modal ── */}
      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: '7px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
                  <span className="badge neutral">{selected.aletia_id}</span>
                  {selected.aletia_verified && <span className="badge verified">✓ Aletia Verified</span>}
                  {selected.breakthrough_designation && <span className="badge breakthrough">⚡ Breakthrough</span>}
                  {selected.autonomous_output_mode && (
                    <AutonomousBadge
                      description={selected.autonomous_output_description}
                      riskClass={selected.eu_risk_class}
                      dataSource={selected.data_source}
                      deviceId={selected.aletia_id}
                    />
                  )}
                  {selected.pipeline_stage
                    ? <span className="badge pipeline">⚗ {PIPELINE_LABELS[selected.pipeline_stage] ?? selected.pipeline_stage}</span>
                    : <span className={riskBadge(selected.health_status).cls}>{riskBadge(selected.health_status).label} Risk</span>
                  }
                </div>
                <h2 style={{ fontSize: '19px', fontWeight: 900, lineHeight: 1.2 }}>
                  {selected.manufacturers?.name || selected.manufacturer_name}
                </h2>
                <p style={{ color: 'var(--muted)', fontSize: '13px', marginTop: '4px' }}>{selected.manufacturers?.hq_location}</p>
              </div>
              <button className="closeBtn" onClick={() => setSelected(null)}>✕</button>
            </div>

            <div className="modal-body">
              {/* Pre-approval warning */}
              {selected.pipeline_stage && (
                <div style={{ marginBottom: 16, padding: '12px 14px', background: '#fff9ec', border: '1px solid rgba(161,92,0,.25)', borderRadius: 12, fontSize: 13, color: '#a15c00' }}>
                  ⚠️ This device has not received regulatory clearance.
                </div>
              )}

              {/* Trial details — shown only when in pipeline and data is available */}
              {selected.pipeline_stage && (selected.pre_approval_profile?.trial_phase || selected.pre_approval_profile?.nct_number) && (
                <div style={{ marginBottom: 16, padding: '12px 14px', background: '#f5f3ff', border: '1px solid rgba(109,40,217,.15)', borderRadius: 12 }}>
                  <div className="modal-label" style={{ marginBottom: 6 }}>Clinical Trial Details</div>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    {selected.pre_approval_profile?.trial_phase && (
                      <div>
                        <div style={{ fontSize: 11, color: '#6d28d9', fontWeight: 700, marginBottom: 2 }}>Trial Phase</div>
                        <span className="badge trial">Phase {selected.pre_approval_profile.trial_phase}</span>
                      </div>
                    )}
                    {selected.pre_approval_profile?.nct_number && (
                      <div>
                        <div style={{ fontSize: 11, color: '#6d28d9', fontWeight: 700, marginBottom: 2 }}>NCT Number</div>
                        <a
                          href={`https://clinicaltrials.gov/study/${selected.pre_approval_profile.nct_number}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: 13, color: '#6366f1', fontWeight: 700 }}
                        >
                          {selected.pre_approval_profile.nct_number} ↗
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="modal-section">
                <div className="modal-label">Intended Use</div>
                <p style={{ fontSize: '14px', color: 'var(--text)', lineHeight: 1.6 }}>{selected.intended_use}</p>
              </div>

              <div className="modal-grid">
                <div><div className="modal-label">Specialty</div><p style={{ fontSize: '14px' }}>{selected.specialty_link}</p></div>
                <div><div className="modal-label">AI Type</div><p style={{ fontSize: '14px' }}>{selected.ai_ml_type}</p></div>
                <div><div className="modal-label">Mode</div><p style={{ fontSize: '14px' }}>{selected.mode} / {selected.autonomy}</p></div>
                <div><div className="modal-label">Accountability Tier</div><p style={{ fontSize: '14px' }}>Tier {selected.accountability_tier}</p></div>
              </div>

              <hr className="sep" />

              <div className="modal-section">
                <div className="modal-label">Regulatory Registrations</div>
                {selected.pipeline_stage ? (
                  <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>No clearances — device is in the regulatory pipeline.</p>
                ) : selected.regional_registrations?.map(r => (
                  <div key={r.regulatory_body} className="modal-row" style={{ marginTop: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600 }}>{r.country}</span>
                    <span style={{ fontSize: '12px', color: 'var(--primary)', fontWeight: 700 }}>{r.regulatory_body}</span>
                    <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{r.clearance_type}</span>
                  </div>
                ))}
              </div>

              {selected.tech_specs && (
                <>
                  <hr className="sep" />
                  <div className="modal-section">
                    <div className="modal-label">Technical Profile</div>
                    <div className="modal-grid" style={{ marginTop: '8px' }}>
                      <div className="modal-row"><span style={{ fontSize: '13px', color: 'var(--muted)' }}>API Type</span><span style={{ fontSize: '13px', fontWeight: 600 }}>{selected.tech_specs.api_type}</span></div>
                      <div className="modal-row"><span style={{ fontSize: '13px', color: 'var(--muted)' }}>Hosting</span><span style={{ fontSize: '13px', fontWeight: 600 }}>{selected.tech_specs.data_hosting}</span></div>
                      <div className="modal-row"><span style={{ fontSize: '13px', color: 'var(--muted)' }}>FHIR</span><span style={{ fontSize: '13px', fontWeight: 600 }}>{selected.tech_specs.fhir_compatible ? '✓ Yes' : '✗ No'}</span></div>
                      <div className="modal-row"><span style={{ fontSize: '13px', color: 'var(--muted)' }}>POPIA</span><span style={{ fontSize: '13px', fontWeight: 600 }}>{selected.tech_specs.popia_compliant ? '✓ Compliant' : '✗ No'}</span></div>
                    </div>
                  </div>
                </>
              )}

              <hr className="sep" />
              <div className="modal-grid">
                <div><div className="modal-label">Last Automated Sync</div><p style={{ fontSize: '14px', fontWeight: 600 }}>{fmtDate(selected.last_automated_sync)}</p></div>
                <div><div className="modal-label">Last Clinical Review</div><p style={{ fontSize: '14px', fontWeight: 600 }}>{fmtDate(selected.last_clinical_review)}</p></div>
              </div>

              <div style={{ marginTop: 16, textAlign: 'center' }}>
                <a href={`/device/${selected.aletia_id}`} className="reportBtn" style={{ width: '100%', justifyContent: 'center' }}>
                  View full listing →
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
