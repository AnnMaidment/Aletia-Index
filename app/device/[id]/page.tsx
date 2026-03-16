import { cache } from 'react'
import { supabase } from '@/lib/supabase'
import { Nav, Footer } from '@/components/NavFooter'
import type { Metadata } from 'next'
import type { CSSProperties } from 'react'

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

const fetchDevice = cache(async (id: string) => {
  const { data } = await supabase
    .from('device_master')
    .select(`
      *,
      manufacturers(name, hq_location),
      regional_registrations(country, regulatory_body, clearance_type, device_class, gmdn_term),
      tech_specs(api_type, ehr_compat, data_hosting, fhir_compatible, popia_compliant),
      clinical_audits(*)
    `)
    .eq('device_id', id)
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
    openGraph: {
      title: fullTitle,
      description,
      url: `${BASE_URL}/device/${id}`,
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
    },
  }
}

function statusStyle(s: string): CSSProperties {
  if (s === 'Green') return { background: '#e9f9ef', color: '#137a3b', border: '1px solid rgba(19,122,59,.15)' }
  if (s === 'Red')   return { background: '#ffecec', color: '#9f1d1d', border: '1px solid rgba(159,29,29,.15)' }
  return { background: '#fff4e5', color: '#a15c00', border: '1px solid rgba(161,92,0,.15)' }
}

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' }) : 'Not reviewed'

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
              We couldn&apos;t find a device with ID <code style={{ fontFamily: 'ui-monospace,monospace', fontSize: 13, background: '#f1f5f9', padding: '2px 6px', borderRadius: 6 }}>{id}</code>.
              It may have been removed or the link may be incorrect.
            </p>
            <a href="/" className="secondaryBtn" style={{ marginTop: 24, display: 'inline-block' }}>← Back to Index</a>
          </div>
        </main>
        <Footer />
      </>
    )
  }

  const mfrJoin = device.manufacturers as { name: string; hq_location: string } | null
  const mfr = { name: mfrJoin?.name ?? device.manufacturer_name ?? 'Unknown Manufacturer', hq_location: mfrJoin?.hq_location ?? null }
  const regs: Array<{ country: string; regulatory_body: string; clearance_type: string; device_class?: string; gmdn_term?: string }> = device.regional_registrations ?? []
  const tech = device.tech_specs as { api_type: string; ehr_compat: string; data_hosting: string; fhir_compatible: boolean; popia_compliant: boolean } | null
  const audits: Array<Record<string, unknown>> = device.clinical_audits ?? []
  const jurisdictions = regs.map(r => r.regulatory_body).join(', ')

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'MedicalDevice',
    name: device.intended_use,
    manufacturer: { '@type': 'Organization', name: mfr.name },
    description: `${device.intended_use} — regulatory status: ${jurisdictions || 'Not disclosed'}`,
    url: `${BASE_URL}/device/${device.device_id}`,
  }

  const facts = [
    { label: 'Specialty',           value: device.specialty_link },
    { label: 'AI / ML Type',        value: device.ai_ml_type },
    { label: 'Accountability Tier', value: device.accountability_tier != null ? `Tier ${device.accountability_tier}` : null },
    { label: 'Mode',                value: device.mode },
    { label: 'Autonomy',            value: device.autonomy },
  ].filter((f): f is { label: string; value: string } => Boolean(f.value))

  const techFacts = tech ? [
    { label: 'API Type',           value: tech.api_type },
    { label: 'EHR Compatibility',  value: tech.ehr_compat },
    { label: 'Data Hosting',       value: tech.data_hosting },
    { label: 'FHIR Compatible',    value: tech.fhir_compatible  ? '✓ Yes'       : '✗ No' },
    { label: 'POPIA Compliant',    value: tech.popia_compliant  ? '✓ Compliant' : '✗ Not confirmed' },
  ].filter((f): f is { label: string; value: string } => f.value != null) : []

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Nav active="index" />
      <main className="page">
        <div className="container" style={{ maxWidth: 900 }}>

          {/* Breadcrumb */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, fontSize: 14, color: 'var(--muted)' }}>
            <a href="/" style={{ color: 'var(--muted)' }}>Index</a>
            <span>/</span>
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>{mfr.name}</span>
          </div>

          {/* Header */}
          <div className="card cardPad" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', background: '#f1f5f9', border: '1px solid var(--line)', borderRadius: 8, padding: '4px 10px', fontFamily: 'ui-monospace,monospace' }}>
                {device.device_id}
              </span>
              {device.aletia_verified && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: '#e9f9ef', color: '#137a3b', border: '1px solid rgba(19,122,59,.15)' }}>
                  ✓ Aletia Verified
                </span>
              )}
              <span style={{ display: 'inline-flex', alignItems: 'center', padding: '5px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, ...statusStyle(device.health_status) }}>
                {device.health_status} Status
              </span>
            </div>
            <h1 className="h1" style={{ marginBottom: 6 }}>{mfr.name}</h1>
            <p className="subhead">{device.intended_use}</p>
            {mfr.hq_location && (
              <p style={{ marginTop: 10, fontSize: 13, color: 'var(--muted)' }}>📍 {mfr.hq_location}</p>
            )}
          </div>

          {/* Overview */}
          {facts.length > 0 && (
            <div className="card cardPad" style={{ marginBottom: 16 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Overview</h2>
              <div className="three" style={{ marginTop: 0 }}>
                {facts.map(f => <LabelValue key={f.label} label={f.label} value={f.value} />)}
              </div>
            </div>
          )}

          {/* Regulatory registrations */}
          {regs.length > 0 && (
            <div className="card cardPad" style={{ marginBottom: 16 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Regulatory Registrations</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {regs.map((r, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: '#f8fafc', borderRadius: 12, border: '1px solid var(--line)', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 22, flexShrink: 0 }}>{FLAG[r.country] ?? '🌐'}</span>
                    <div style={{ flex: 1, minWidth: 120 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{r.country}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{r.regulatory_body}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
                    </div>
                    {r.gmdn_term && (
                      <div style={{ width: '100%', fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                        GMDN: {r.gmdn_term}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Technical profile */}
          {techFacts.length > 0 && (
            <div className="card cardPad" style={{ marginBottom: 16 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Technical Profile</h2>
              <div className="three" style={{ marginTop: 0 }}>
                {techFacts.map(f => <LabelValue key={f.label} label={f.label} value={f.value} />)}
              </div>
            </div>
          )}

          {/* Lifecycle */}
          <div className="card cardPad" style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Lifecycle Signals</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <LabelValue label="Last Automated Sync"  value={fmt(device.last_automated_sync)} />
              <LabelValue label="Last Clinical Review"  value={fmt(device.last_clinical_review)} />
            </div>
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

          <a href="/" className="secondaryBtn">← Back to Index</a>
        </div>
      </main>
      <Footer />
    </>
  )
}
