'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Device } from '@/lib/types'
import { PIPELINE_LABELS } from '@/lib/types'
import { AutonomousBadge } from './AutonomousBadge'

interface Props {
  devices:     Device[]
  totalCount:  number
  page:        number
  pageSize:    number
  filterQuery: string   // current filter params serialised without 'page'
}

const riskBadge = (status: string) => {
  if (status === 'Green') return { cls: 'badge ok',     label: 'Lower'    }
  if (status === 'Red')   return { cls: 'badge danger', label: 'Higher'   }
  return                         { cls: 'badge warn',   label: 'Moderate' }
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
  const [selected, setSelected] = useState<Device | null>(null)
  const totalPages = Math.ceil(totalCount / pageSize)

  return (
    <>
      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ minWidth: '260px' }}>Tool</th>
              <th style={{ minWidth: '140px' }}>Use Case</th>
              <th style={{ minWidth: '180px' }}>Regulatory Status</th>
              <th style={{ minWidth: '100px' }}>Risk</th>
              <th style={{ minWidth: '180px' }}>Lifecycle Signals</th>
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
              const risk           = riskBadge(device.health_status)

              return (
                <tr key={device.device_id}>
                  {/* ── Tool ── */}
                  <td>
                    <div className="rowTitle">
                      <div className="appIcon">
                        <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
                          <path d="M12 3 4 21h4l1.3-3h5.4L16 21h4L12 3Zm1.6 10H10.4L12 8.6 13.6 13Z" fill="#1f6feb" />
                        </svg>
                      </div>
                      <div>
                        <a
                          href={`/device/${device.device_id}`}
                          className="appName"
                          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                        >
                          {device.manufacturers?.name || device.manufacturer_name || device.device_id}
                        </a>
                        <div className="appOrg">{device.device_id}</div>
                        {dataSource === 'aletia_research' && (
                          <span className="badge research" style={{ marginTop: 4 }}>ⓘ Aletia Research</span>
                        )}
                        {dataSource === 'manufacturer_submitted' && (
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
      deviceId={device.device_id}
    />
  </div>
)}
                        <div className="small" style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {device.intended_use}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* ── Use Case ── */}
                  <td style={{ color: 'var(--muted)', fontSize: '13px' }}>{device.specialty_link}</td>

                  {/* ── Regulatory Status ── */}
                  <td>
                    {isPreClearance ? (
                      <span className="badge pipeline">
                        ⚗ {PIPELINE_LABELS[device.pipeline_stage!] ?? device.pipeline_stage}
                      </span>
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
                  <td>
                    {isPreClearance
                      ? <span style={{ fontSize: 12, color: 'var(--muted)' }}>—</span>
                      : <span className={risk.cls}>{risk.label}</span>
                    }
                  </td>

                  {/* ── Lifecycle Signals ── */}
                  <td>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>
                      {isPreClearance ? 'Pipeline entry' : `Reviewed ${fmtDate(device.last_clinical_review)}`}
                    </div>
                    <div className="small">
                      {device.aletia_verified ? '✓ Aletia Verified' : 'Pending verification'}
                    </div>
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
                      <a href={`/device/${device.device_id}`} className="reportBtn">View</a>
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

      {/* ── Modal ── */}
      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: '7px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
                  <span className="badge neutral">{selected.device_id}</span>
                  {selected.aletia_verified && <span className="badge verified">✓ Aletia Verified</span>}
                  {selected.breakthrough_designation && <span className="badge breakthrough">⚡ Breakthrough</span>}
                  {selected.autonomous_output_mode && (
  <AutonomousBadge
    description={selected.autonomous_output_description}
    riskClass={selected.eu_risk_class}
    dataSource={selected.data_source}
    deviceId={selected.device_id}
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
              {selected.pipeline_stage && (
                <div style={{ marginBottom: 16, padding: '12px 14px', background: '#fff9ec', border: '1px solid rgba(161,92,0,.25)', borderRadius: 12, fontSize: 13, color: '#a15c00' }}>
                  ⚠️ This device has not received regulatory clearance.
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
                <a href={`/device/${selected.device_id}`} className="reportBtn" style={{ width: '100%', justifyContent: 'center' }}>
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
