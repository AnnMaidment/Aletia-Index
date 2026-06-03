import {
  LabelValue, PipelineStepper, PreClearanceBanner,
  AllIdentifiersPanel, TrialCard, sortTrials,
} from './shared'
import { technologyName, isRealTechnologyName } from '@/lib/displayName'
import InterestButton from './InterestButton'
import type { DeviceExternalId, DeviceTrial } from '@/lib/types'

// ── Types ─────────────────────────────────────────────────────────────────────
//
// PreApprovalProfile still carries the opt-in manufacturer-supplied data
// (funding, team, contacts, IRB). The trial_* fields are A2a-era; A2b moves
// trial data into device_trials. We still read PreApprovalProfile for
// non-trial fields, and pull trials from device.trials instead.

type PreApprovalProfile = {
  dev_stage: string | null
  irb_approved: boolean | null
  irb_institution: string | null
  target_jurisdictions: string[] | null
  company_stage: string | null
  total_raised_usd: number | null
  last_funding_date: string | null
  lead_investor: string | null
  founded_year: number | null
  team_size_range: string | null
  clinical_contact_name: string | null
  clinical_contact_email: string | null
  investor_contact_name: string | null
  investor_contact_email: string | null
  interested_investor_count: number | null
  breakthrough_source: string | null
}

type Manufacturer = {
  name: string
  hq_location: string | null
  website: string | null
  contact_visible: boolean | null
  claimed_at: string | null
}

type Device = {
  aletia_id: string
  external_legacy_id: string | null
  name: string | null
  intended_use: string | null
  manufacturer_name: string | null
  specialty_link: string | null
  pipeline_stage: string | null
  approval_status: string | null
  breakthrough_designation: boolean | null
  data_source: string | null
  claimed_at: string | null
  manufacturers: Manufacturer | null
  pre_approval_profile: PreApprovalProfile | PreApprovalProfile[] | null
  external_ids?: DeviceExternalId[]
  trials?: DeviceTrial[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtMonthYear = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' }) : null

const fmtUsd = (n: number | null) => {
  if (n == null) return null
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`
  return `$${n}`
}

const titleise = (s: string | null) =>
  s ? s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : null

function EmptyHint({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>
      {text}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PreApprovalDevicePage({ device }: { device: Device }) {
  const mfr = device.manufacturers
  const companyName = mfr?.name ?? device.manufacturer_name ?? 'Unknown Company'
  // pre_approval_profile may come back as object (single FK) or array — normalise
  const rawProfile = device.pre_approval_profile
  const profile: PreApprovalProfile | null = Array.isArray(rawProfile)
    ? rawProfile[0] ?? null
    : rawProfile

  const isClaimed   = !!device.claimed_at || !!mfr?.claimed_at
  const dataSource  = (device.data_source ?? 'registry_sync')

  // Trials — sourced from device_trials now, not pre_approval_profile.trial_*.
  const trials: DeviceTrial[] = device.trials ?? []
  const sortedTrials = sortTrials(trials)
  const hasTrials = sortedTrials.length > 0
  const externalIds: DeviceExternalId[] = device.external_ids ?? []

  // Company facts — which are present?
  const companyFacts = profile ? [
    { label: 'Funding Stage',  value: titleise(profile.company_stage) },
    { label: 'Total Raised',   value: fmtUsd(profile.total_raised_usd) },
    { label: 'Lead Investor',  value: profile.lead_investor },
    { label: 'Last Funding',   value: fmtMonthYear(profile.last_funding_date) },
    { label: 'Founded',        value: profile.founded_year ? String(profile.founded_year) : null },
    { label: 'Team Size',      value: profile.team_size_range },
  ].filter((f): f is { label: string; value: string } => Boolean(f.value)) : []

  // Contacts — only rendered if manufacturer has opted into visibility
  const contactsVisible = mfr?.contact_visible === true
  const hasClinicalContact = !!(profile?.clinical_contact_name || profile?.clinical_contact_email)
  const hasInvestorContact = !!(profile?.investor_contact_name || profile?.investor_contact_email)
  const showContacts = contactsVisible && (hasClinicalContact || hasInvestorContact)

  // Target jurisdictions
  const jurisdictions = profile?.target_jurisdictions?.filter(Boolean) ?? []

  // Interest count — null-safe
  const interestCount = profile?.interested_investor_count ?? 0

  // Top-of-page hint: unclaimed + sparse profile
  const isSparseUnclaimed = !isClaimed && companyFacts.length === 0 && !showContacts

  return (
    <>
      {/* Pre-clearance disclaimer — reused from the cleared-device template */}
      <PreClearanceBanner dataSource={dataSource} />

      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, fontSize: 14, color: 'var(--muted)' }}>
        <a href="/" style={{ color: 'var(--muted)' }}>Index</a>
        <span>/</span>
        <span style={{ color: 'var(--muted)' }}>Pipeline</span>
        <span>/</span>
        <span style={{ color: 'var(--text)', fontWeight: 600 }}>{companyName}</span>
      </div>

      {/* ── Header card ──────────────────────────────────────────────────── */}
      <div className="card cardPad" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
          {/* Canonical Aletia ID — prominent */}
          <span style={{
            fontSize: 12, fontWeight: 700, color: 'var(--text)',
            background: '#eff6ff', border: '1px solid rgba(31,111,235,.2)',
            borderRadius: 8, padding: '4px 10px', fontFamily: 'ui-monospace,monospace',
          }}>
            {device.aletia_id}
          </span>

          {/* Pre-approval pill — identifies the template unambiguously */}
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '5px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700,
            background: '#fff4e5', color: '#a15c00', border: '1px solid rgba(161,92,0,.2)',
          }}>
            Pre-approval
          </span>

          {/* Breakthrough designation */}
          {device.breakthrough_designation && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '5px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700,
              background: '#eff6ff', color: '#1d4ed8', border: '1px solid rgba(29,78,216,.15)',
            }}>
              ⚡ FDA Breakthrough Device
            </span>
          )}

        </div>

        <h1 className="h1" style={{ marginBottom: 6 }}>{technologyName(device.name)}</h1>
        <p className="subhead">{companyName} · Sponsor</p>
        {!isRealTechnologyName(device.name) && (
          <p style={{ marginTop: 4, fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>
            Named product not publicly identified
          </p>
        )}

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10, fontSize: 13, color: 'var(--muted)' }}>
          {mfr?.hq_location && <span>📍 {mfr.hq_location}</span>}
          {device.specialty_link && <span>🩺 {device.specialty_link}</span>}
          {mfr?.website && (
            <a href={mfr.website} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', textDecoration: 'none' }}>
              🌐 Website ↗
            </a>
          )}
        </div>

        {/* Pipeline stepper */}
        {device.pipeline_stage && (
          <>
            <hr className="sep" style={{ marginTop: 16 }} />
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>
              Regulatory Pipeline
            </div>
            <PipelineStepper currentStage={device.pipeline_stage} />
          </>
        )}
      </div>

      {/* ── All identifiers panel ────────────────────────────────────────── */}
      <AllIdentifiersPanel aletiaId={device.aletia_id} externalIds={externalIds} />

      {/* ── Unclaimed-and-sparse empty state ─────────────────────────────── */}
      {isSparseUnclaimed && (
        <div className="card cardPad" style={{ marginBottom: 16, background: '#f8fafc' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
            Trial signal only — manufacturer hasn&apos;t claimed this listing yet.
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.55 }}>
            The trial data below was imported from ClinicalTrials.gov. If you represent <strong>{companyName}</strong>,
            you can claim this listing to add funding, team, and contact details.
          </div>
          <a
            href={`/claim/request/${device.aletia_id}`}
            style={{
              display: 'inline-block', padding: '9px 16px', borderRadius: 12,
              background: 'var(--primary)', color: '#fff',
              fontSize: 13, fontWeight: 700, textDecoration: 'none',
            }}
          >
            Claim this listing →
          </a>
        </div>
      )}

      {/* ── Clinical trials — the credibility anchor ─────────────────────── */}
      <div className="card cardPad" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>
          {hasTrials && sortedTrials.length > 1
            ? `Clinical Trials (${sortedTrials.length})`
            : 'Clinical Trial Signal'}
        </h2>

        {hasTrials ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sortedTrials.map(t => <TrialCard key={t.id} t={t} />)}
            </div>

            {/* IRB approval badge, if set — still lives on pre_approval_profile. */}
            {profile?.irb_approved && (
              <div style={{ marginTop: 12 }}>
                <LabelValue
                  label="IRB Approved"
                  value={profile.irb_institution ? `✓ ${profile.irb_institution}` : '✓ Yes'}
                />
              </div>
            )}

            {jurisdictions.length > 0 && (
              <>
                <hr className="sep" />
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
                  Target Markets
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {jurisdictions.map((j, i) => (
                    <span key={i} style={{
                      padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                      background: 'var(--chip)', color: 'var(--chipText)', border: '1px solid rgba(31,111,235,.12)',
                    }}>
                      {j}
                    </span>
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <EmptyHint text="Trial data not yet available for this device." />
        )}
      </div>

      {/* ── The Company ──────────────────────────────────────────────────── */}
      {companyFacts.length > 0 && (
        <div className="card cardPad" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>The Company</h2>
          <div className="three" style={{ marginTop: 0 }}>
            {companyFacts.map(f => <LabelValue key={f.label} label={f.label} value={f.value} />)}
          </div>
        </div>
      )}

      {/* ── Contacts (opt-in only) ───────────────────────────────────────── */}
      {showContacts && (
        <div className="card cardPad" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Contacts</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            {hasClinicalContact && (
              <div style={{ padding: '14px 16px', background: '#f8fafc', borderRadius: 12, border: '1px solid var(--line)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
                  Clinical
                </div>
                {profile?.clinical_contact_name && (
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
                    {profile.clinical_contact_name}
                  </div>
                )}
                {profile?.clinical_contact_email && (
                  <a href={`mailto:${profile.clinical_contact_email}`} style={{ fontSize: 13, color: 'var(--primary)', textDecoration: 'none' }}>
                    {profile.clinical_contact_email}
                  </a>
                )}
              </div>
            )}
            {hasInvestorContact && (
              <div style={{ padding: '14px 16px', background: '#f8fafc', borderRadius: 12, border: '1px solid var(--line)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
                  Investor Relations
                </div>
                {profile?.investor_contact_name && (
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
                    {profile.investor_contact_name}
                  </div>
                )}
                {profile?.investor_contact_email && (
                  <a href={`mailto:${profile.investor_contact_email}`} style={{ fontSize: 13, color: 'var(--primary)', textDecoration: 'none' }}>
                    {profile.investor_contact_email}
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Investor Interest ────────────────────────────────────────────── */}
      <div className="card cardPad" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px' }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px' }}>Investor Interest</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
              Signal to the team that this device is on your radar. Anonymous — the manufacturer sees the count, not your identity.
            </p>
          </div>
          <InterestButton deviceId={device.aletia_id} initialCount={interestCount} />
        </div>
      </div>

      {/* ── Claim / Edit CTA ─────────────────────────────────────────────── */}
      {!isClaimed && !isSparseUnclaimed && (
        <div className="card cardPad" style={{ marginBottom: 24, background: '#f8fafc' }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 3 }}>
                Is this your device?
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
                Claim the listing to add funding details, update trial status, and enable investor contact.
              </div>
            </div>
            <a
              href={`/claim/request/${device.aletia_id}`}
              style={{
                flexShrink: 0, padding: '9px 16px', borderRadius: 12,
                background: 'var(--primary)', color: '#fff',
                fontSize: 13, fontWeight: 700, textDecoration: 'none',
              }}
            >
              Claim this listing →
            </a>
          </div>
        </div>
      )}

      {isClaimed && (
        <div className="card cardPad" style={{ marginBottom: 24, background: '#f8fafc', border: '1px solid rgba(19,122,59,.2)' }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#137a3b', marginBottom: 3 }}>
                ✓ Listing claimed by manufacturer
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
                Data on this page is maintained by {companyName}.
              </div>
            </div>
            {/* TODO: gate Edit to authenticated owner server-side. For now,
                dashboard auth gates the actual editing. */}
            <a
              href="/dashboard"
              style={{
                flexShrink: 0, padding: '9px 16px', borderRadius: 12,
                background: 'var(--surface)', border: '1px solid var(--line)',
                fontSize: 13, fontWeight: 700, color: '#334155',
                textDecoration: 'none',
              }}
            >
              Edit listing →
            </a>
          </div>
        </div>
      )}

      <a href="/" className="secondaryBtn" style={{ marginTop: 8, display: 'inline-block' }}>← Back to Index</a>
    </>
  )
}
