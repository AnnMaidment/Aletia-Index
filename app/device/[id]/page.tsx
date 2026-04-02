import { cache } from 'react'
import { supabase } from '@/lib/supabase'
import { Nav, Footer } from '@/components/NavFooter'
import type { Metadata } from 'next'
import type { CSSProperties } from 'react'
import { AutonomousBadge } from '@/app/components/AutonomousBadge'

const BASE_URL = 'https://www.aletia-index.com'

const FLAG: Record<string, string> = {
  'United States': '🇺🇸',
  'United Kingdom': '🇬🇧',
  'European Union': '🇪🇺',
  'South Africa': '🇿🇦',
  'Australia': '🇦🇺',
  'Canada': '🇨🇦',
  'Germany': '🇩🇪',
  'France': '🇫🇷',
  'India': '🇮🇳',
  'Brazil': '🇧🇷',
  'Japan': '🇯🇵',
  'Singapore': '🇸🇬',
}

// Pipeline stage config — order matters
const PIPELINE_STAGES = [
  { key: 'proof_of_concept', label: 'Proof of Concept' },
  { key: 'pre_submission',   label: 'Pre-submission' },
  { key: 'submitted',        label: 'Submitted' },
  { key: 'under_review',     label: 'Under Review' },
  { key: 'cleared',          label: 'Cleared' },
]

const fetchDevice = cache(async (id: string) => {
  const { data } = await supabase
    .from('device_master')
    .select(`
      *,
      manufacturers(name, hq_location, tier, claimed_at, website),
      regional_registrations(
        country, regulatory_body, clearance_type, device_class,
        gmdn_term, regulatory_expiry, recall_active, adverse_event_count
      ),
      tech_specs(api_type, ehr_compat, data_hosting, fhir_compatible, popia_compliant),
      clinical_audits(*)
    `)
    .eq('device_id', id)
    .eq('excluded', false)
    .single()
  return data
})

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
  const { id } = await params
  const device = await fetchDevice(id)
  if (!device) return { title: 'Device Not Found' }

  const mfrName = device.manufacturers?.name ?? device.manufacturer_name ?? ''
  const regs = device.regional_registrations ?? []
  const jurisdictions = regs.length
    ? regs.map((r: { regulatory_body: string }) => r.regulatory_body).join(', ')
    : 'FDA, MHRA, CE Mark and SAHPRA'

  const deviceName = device.device_name ?? device.intended_use
  const fullTitle = mfrName
    ? `${deviceName} | ${mfrName} | Aletia Index`
    : `${deviceName} | Aletia Index`
  const description = `${deviceName}. Regulatory clearance status across ${jurisdictions}. Clinical assurance data from Aletia Index.`

  return {
    title: { absolute: fullTitle },
    description,
    alternates: { canonical: `${BASE_URL}/device/${id}` },
    openGraph: { title: fullTitle, description, url: `${BASE_URL}/device/${id}` },
    twitter: { card: 'summary_large_image', title: fullTitle, description },
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function statusStyle(s: string): CSSProperties {
  if (s === 'Green') return { background: '#e9f9ef', color: '#137a3b', border: '1px solid rgba(19,122,59,.15)' }
  if (s === 'Red')   return { background: '#ffecec', color: '#9f1d1d', border: '1px solid rgba(159,29,29,.15)' }
  return { background: '#fff4e5', color: '#a15c00', border: '1px solid rgba(161,92,0,.15)' }
}

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' }) : null

/** Human-readable gap between two timestamps */
function freshnessGap(syncDate: string | null, reviewDate: string | null): string | null {
  if (!syncDate || !reviewDate) return null
  const sync   = new Date(syncDate).getTime()
  const review = new Date(reviewDate).getTime()
  const diffMs = Math.abs(sync - review)
  const days   = Math.floor(diffMs / 86400000)
  if (days < 30)  return `${days}d gap`
  if (days < 365) return `${Math.floor(days / 30)}mo gap`
  return `${(days / 365).toFixed(1)}yr gap`
}

function LabelValue({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: '12px 14px', background: '#f8fafc', borderRadius: 12, border: '1px solid var(--line)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{value}</div>
    </div>
  )
}

// ── Pipeline stepper ──────────────────────────────────────────────────────────

function PipelineStepper({ currentStage }: { currentStage: string }) {
  const currentIdx = PIPELINE_STAGES.findIndex(s => s.key === currentStage)

  return (
    <div style={{ padding: '18px 0 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, overflowX: 'auto', paddingBottom: 4 }}>
        {PIPELINE_STAGES.map((stage, i) => {
          const isPast    = i < currentIdx
          const isCurrent = i === currentIdx
          const isFuture  = i > currentIdx

          return (
            <div key={stage.key} style={{ display: 'flex', alignItems: 'center', flex: i < PIPELINE_STAGES.length - 1 ? '1' : 'none' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', display: 'grid', placeItems: 'center',
                  fontSize: 12, fontWeight: 800,
                  background: isCurrent ? '#1f6feb' : isPast ? '#e9f9ef' : '#f1f5f9',
                  color:      isCurrent ? '#fff'    : isPast ? '#137a3b' : '#94a3b8',
                  border:     isCurrent ? '2px solid #1f6feb' : isPast ? '2px solid rgba(19,122,59,.3)' : '2px solid #e2e8f0',
                  boxShadow:  isCurrent ? '0 0 0 4px rgba(31,111,235,.12)' : 'none',
                  transition: 'all .2s',
                }}>
                  {isPast ? '✓' : i + 1}
                </div>
                <span style={{
                  fontSize: 11, fontWeight: isCurrent ? 700 : 500, whiteSpace: 'nowrap',
                  color: isCurrent ? '#1f6feb' : isFuture ? '#94a3b8' : '#475569',
                }}>
                  {stage.label}
                </span>
              </div>
              {i < PIPELINE_STAGES.length - 1 && (
                <div style={{
                  flex: 1, height: 2, margin: '0 4px', marginBottom: 22,
                  background: isPast ? 'rgba(19,122,59,.3)' : '#e2e8f0',
                  minWidth: 16,
                }} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Pre-clearance disclaimer banner ──────────────────────────────────────────

function PreClearanceBanner({ dataSource }: { dataSource: string }) {
  const isManufacturerSubmitted = dataSource === 'manufacturer_submitted'
  return (
    <div style={{
      width: '100%', padding: '14px 20px', marginBottom: 20,
      background: '#fff9ec', border: '1px solid rgba(161,92,0,.25)',
      borderRadius: 14, display: 'flex', gap: 12, alignItems: 'flex-start',
    }}>
      <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>⚠️</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#92400e', marginBottom: 4 }}>
          This device has not received regulatory clearance
        </div>
        <div style={{ fontSize: 13, color: '#a15c00', lineHeight: 1.55 }}>
          {isManufacturerSubmitted
            ? 'This listing has been submitted by the manufacturer and reflects their stated regulatory status. It has not been independently verified by Aletia.'
            : 'This listing is based on publicly available information and has not been verified by the manufacturer or any regulatory authority.'}
        </div>
      </div>
    </div>
  )
}

// ── Data source provenance tag ────────────────────────────────────────────────

function DataSourceTag({ source }: { source: string }) {
  if (source === 'registry_sync') return null

  const config: Record<string, { label: string; bg: string; color: string; border: string }> = {
    aletia_research:        { label: 'Aletia Research — Unverified', bg: '#f0f4ff', color: '#1e40af', border: 'rgba(31,64,174,.15)' },
    manufacturer_submitted: { label: 'Manufacturer Submitted',        bg: '#f0fdf4', color: '#15803d', border: 'rgba(21,128,61,.15)'  },
  }
  const c = config[source]
  if (!c) return null

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
      background: c.bg, color: c.color, border: `1px solid ${c.border}`,
    }}>
      ⓘ {c.label}
    </span>
  )
}

// ── Claim this listing notice ─────────────────────────────────────────────────

function ClaimNotice({ deviceId, manufacturerName }: { deviceId: string; manufacturerName: string }) {
  return (
    <div style={{
      marginTop: 8, padding: '16px 20px',
      background: '#f8fafc', border: '1px solid var(--line)',
      borderRadius: 14, display: 'flex', gap: 16,
      alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap',
    }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 3 }}>
          This listing was auto-populated from public registry data
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
          Some fields are incomplete or unverified. If you represent <strong>{manufacturerName}</strong>, you can verify and update this listing.
        </div>
      </div>
      <a
      href={`/claim/request/${deviceId}`}
        style={{
          flexShrink: 0, padding: '9px 16px', borderRadius: 12,
          background: 'var(--surface)', border: '1px solid var(--line)',
          fontSize: 13, fontWeight: 700, color: '#334155',
          textDecoration: 'none', whiteSpace: 'nowrap',
        }}
      >
        Verify this listing →
      </a>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function DevicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const device = await fetchDevice(id)

  if (!device) {
    return (
      <>
        <Nav active="" />
        <main className="page">
          <div className="container" style={{ maxWidth: 640 }}>
            <p style={{ marginBottom: 16, fontSize: 14, color: 'var(--muted)' }}>
              <a href="/">← Index</a>
            </p>
            <h1 className="h1">Device not found</h1>
            <p className="subhead" style={{ marginTop: 10 }}>
              We couldn&apos;t find a device with ID{' '}
              <code style={{ fontFamily: 'ui-monospace,monospace', fontSize: 13, background: '#f1f5f9', padding: '2px 6px', borderRadius: 6 }}>
                {id}
              </code>.
              It may have been removed or the link may be incorrect.
            </p>
            <a href="/" className="secondaryBtn" style={{ marginTop: 24, display: 'inline-block' }}>← Back to Index</a>
          </div>
        </main>
        <Footer />
      </>
    )
  }

  // ── Derived values ──────────────────────────────────────────────────────────

  const mfrJoin   = device.manufacturers as { name: string; hq_location: string; tier?: string; claimed_at?: string; website?: string } | null
  const mfr       = { name: mfrJoin?.name ?? device.manufacturer_name ?? 'Unknown Manufacturer', hq_location: mfrJoin?.hq_location ?? null }
  const isClaimed = !!mfrJoin?.claimed_at

  const regs: Array<{
    country: string; regulatory_body: string; clearance_type: string
    device_class?: string; gmdn_term?: string; regulatory_expiry?: string
    recall_active?: boolean; adverse_event_count?: number
  }> = device.regional_registrations ?? []

  const tech = device.tech_specs as {
    api_type: string; ehr_compat: string; data_hosting: string
    fhir_compatible: boolean; popia_compliant: boolean
  } | null

  const audits: Array<Record<string, unknown>> = device.clinical_audits ?? []

  const isPreClearance  = !!device.pipeline_stage
  const dataSource      = (device.data_source ?? 'registry_sync') as string
  const showClaimNotice = !isClaimed && (dataSource === 'aletia_research' || !device.manufacturer_link)

  const hasRecall     = regs.some(r => r.recall_active)
  const jurisdictions = regs.map(r => r.regulatory_body).join(', ')

  const syncStr   = fmt(device.last_automated_sync)
  const reviewStr = fmt(device.last_clinical_review)
  const gap       = freshnessGap(device.last_automated_sync, device.last_clinical_review)

  const facts = [
    { label: 'Specialty',           value: device.specialty_link },
    { label: 'AI / ML Type',        value: device.ai_ml_type },
    { label: 'Accountability Tier', value: device.accountability_tier != null ? `Tier ${device.accountability_tier}` : null },
    { label: 'Mode',                value: device.mode },
    { label: 'Autonomy',            value: device.autonomy },
  ].filter((f): f is { label: string; value: string } => Boolean(f.value))

  const techFacts = tech ? [
    { label: 'API Type',          value: tech.api_type },
    { label: 'EHR Compatibility', value: tech.ehr_compat },
    { label: 'Data Hosting',      value: tech.data_hosting },
    { label: 'FHIR Compatible',   value: tech.fhir_compatible  ? '✓ Yes'       : '✗ No' },
    { label: 'POPIA Compliant',   value: tech.popia_compliant  ? '✓ Compliant' : '✗ Not confirmed' },
  ].filter((f): f is { label: string; value: string } => f.value != null) : []

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'MedicalDevice',
    name: device.intended_use,
    manufacturer: { '@type': 'Organization', name: mfr.name },
    description: `${device.intended_use} — regulatory status: ${jurisdictions || 'Not disclosed'}`,
    url: `${BASE_URL}/device/${device.device_id}`,
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Nav active="index" />
      <main className="page">
        <div className="container" style={{ maxWidth: 900 }}>

          {/* Pre-clearance disclaimer — shown before anything else */}
          {isPreClearance && <PreClearanceBanner dataSource={dataSource} />}

          {/* Breadcrumb */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, fontSize: 14, color: 'var(--muted)' }}>
            <a href="/" style={{ color: 'var(--muted)' }}>Index</a>
            <span>/</span>
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>{mfr.name}</span>
          </div>

          {/* ── Header card ─────────────────────────────────────────────── */}
          <div className="card cardPad" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>

              {/* Device ID */}
              <span style={{
                fontSize: 12, fontWeight: 700, color: 'var(--muted)',
                background: '#f1f5f9', border: '1px solid var(--line)',
                borderRadius: 8, padding: '4px 10px', fontFamily: 'ui-monospace,monospace',
              }}>
                {device.device_id}
              </span>

              {/* Aletia Verified */}
              {device.aletia_verified && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '5px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                  background: '#e9f9ef', color: '#137a3b', border: '1px solid rgba(19,122,59,.15)',
                }}>
                  ✓ Aletia Verified
                </span>
              )}

              {/* Breakthrough Designation */}
              {device.breakthrough_designation && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '5px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                  background: '#eff6ff', color: '#1d4ed8', border: '1px solid rgba(29,78,216,.15)',
                }}>
                  ⚡ FDA Breakthrough Device
                </span>
              )}

              {/* Active recall warning */}
              {hasRecall && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '5px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                  background: '#ffecec', color: '#9f1d1d', border: '1px solid rgba(159,29,29,.15)',
                }}>
                  ⚠ Active Recall
                </span>
              )}

              {/* Health status — only for cleared devices */}
              {!isPreClearance && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center',
                  padding: '5px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                  ...statusStyle(device.health_status),
                }}>
                  {device.health_status} Status
                </span>
              )}

              {/* Data source provenance */}
              <DataSourceTag source={dataSource} />

              {/* Autonomous output mode badge */}
              {device.autonomous_output_mode && (
                <AutonomousBadge
                  description={device.autonomous_output_description}
                  riskClass={device.eu_risk_class}
                  dataSource={device.data_source}
                  deviceId={device.device_id}
                />
              )}

            </div>

            <h1 className="h1" style={{ marginBottom: 6 }}>{mfr.name}</h1>
            <p className="subhead">{device.intended_use}</p>
            {mfr.hq_location && (
              <p style={{ marginTop: 10, fontSize: 13, color: 'var(--muted)' }}>📍 {mfr.hq_location}</p>
            )}

            {/* Pipeline stepper — replaces health status for pre-clearance */}
            {isPreClearance && (
              <>
                <hr className="sep" style={{ marginTop: 16 }} />
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>
                  Regulatory Pipeline
                </div>
                <PipelineStepper currentStage={device.pipeline_stage} />
              </>
            )}
          </div>

          {/* ── Overview ────────────────────────────────────────────────── */}
          {facts.length > 0 && (
            <div className="card cardPad" style={{ marginBottom: 16 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Overview</h2>
              <div className="three" style={{ marginTop: 0 }}>
                {facts.map(f => <LabelValue key={f.label} label={f.label} value={f.value} />)}
              </div>
            </div>
          )}

          {/* ── Regulatory registrations ─────────────────────────────────── */}
          {regs.length > 0 && (
            <div className="card cardPad" style={{ marginBottom: 16 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Regulatory Registrations</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {regs.map((r, i) => {
                  const isExpiringSoon = r.regulatory_expiry
                    ? (new Date(r.regulatory_expiry).getTime() - Date.now()) < 90 * 86400000
                    : false

                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 14px', background: '#f8fafc',
                      borderRadius: 12, border: `1px solid ${r.recall_active ? 'rgba(159,29,29,.25)' : 'var(--line)'}`,
                      flexWrap: 'wrap',
                    }}>
                      <span style={{ fontSize: 22, flexShrink: 0 }}>{FLAG[r.country] ?? '🌐'}</span>
                      <div style={{ flex: 1, minWidth: 120 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{r.country}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{r.regulatory_body}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        {r.clearance_type && (
                          <span style={{ padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: 'var(--chip)', color: 'var(--chipText)', border: '1px solid rgba(31,111,235,.12)' }}>
                            {r.clearance_type}
                          </span>
                        )}
                        {r.device_class && (
                          <span style={{ padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: '#f1f5f9', color: '#334155', border: '1px solid var(--line)' }}>
                            Class {r.device_class}
                          </span>
                        )}
                        {r.recall_active && (
                          <span style={{ padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: '#ffecec', color: '#9f1d1d', border: '1px solid rgba(159,29,29,.2)' }}>
                            ⚠ Recall
                          </span>
                        )}
                        {isExpiringSoon && !r.recall_active && (
                          <span style={{ padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: '#fff4e5', color: '#a15c00', border: '1px solid rgba(161,92,0,.2)' }}>
                            Expiring {fmt(r.regulatory_expiry ?? null)}
                          </span>
                        )}
                        {r.adverse_event_count != null && r.adverse_event_count > 0 && (
                          <span style={{ padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: '#fff4e5', color: '#a15c00', border: '1px solid rgba(161,92,0,.15)' }}>
                            {r.adverse_event_count} adverse events
                          </span>
                        )}
                      </div>
                      {r.gmdn_term && (
                        <div style={{ width: '100%', fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                          GMDN: {r.gmdn_term}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Technical profile ───────────────────────────────────────── */}
          {techFacts.length > 0 && (
            <div className="card cardPad" style={{ marginBottom: 16 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Technical Profile</h2>
              <div className="three" style={{ marginTop: 0 }}>
                {techFacts.map(f => <LabelValue key={f.label} label={f.label} value={f.value} />)}
              </div>
            </div>
          )}

          {/* ── Lifecycle signals ───────────────────────────────────────── */}
          <div className="card cardPad" style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Lifecycle Signals</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <LabelValue label="Last Automated Sync"  value={syncStr   ?? 'Not synced'} />
              <LabelValue label="Last Clinical Review" value={reviewStr ?? 'Not reviewed'} />
            </div>

            {gap && (
              <div style={{
                marginTop: 12, padding: '10px 14px',
                background: '#f8fafc', borderRadius: 10, border: '1px solid var(--line)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ fontSize: 14 }}>🕐</span>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                  <strong style={{ color: 'var(--text)', fontWeight: 700 }}>{gap}</strong> between last registry sync and last clinical review
                </span>
              </div>
            )}

            {audits.length > 0 && (
              <>
                <hr className="sep" />
                <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Clinical Audits</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {audits.map((a, i) => (
                    <div key={i} style={{ padding: '12px 14px', background: '#f8fafc', borderRadius: 12, border: '1px solid var(--line)' }}>
                      {Object.entries(a)
                        .filter(([k]) => !['id', 'device_id'].includes(k))
                        .map(([k, v]) => (
                          <div key={k} style={{ display: 'flex', gap: 10, marginBottom: 4, fontSize: 13 }}>
                            <span style={{ color: 'var(--muted)', minWidth: 160, fontWeight: 600, textTransform: 'capitalize' }}>
                              {k.replace(/_/g, ' ')}
                            </span>
                            <span style={{ color: 'var(--text)' }}>{String(v ?? '—')}</span>
                          </div>
                        ))}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* ── Claim notice ─────────────────────────────────────────────── */}
          {showClaimNotice && (
            <ClaimNotice deviceId={device.device_id} manufacturerName={mfr.name} />
          )}

          <a href="/" className="secondaryBtn" style={{ marginTop: 24, display: 'inline-block' }}>← Back to Index</a>

        </div>
      </main>
      <Footer />
    </>
  )
}
