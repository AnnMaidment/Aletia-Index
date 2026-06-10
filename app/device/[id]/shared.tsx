import type { CSSProperties } from 'react'
import type { DeviceExternalId, DeviceTrial, ExternalIdType } from '@/lib/types'

// ── Shared constants ──────────────────────────────────────────────────────────

// Pipeline stage config — order matters. Used by PipelineStepper.
//
// Note (20 April 2026 semantic): the write-side value list collapsed to
// { development, clinical_trial, pre_submission, under_review, null }.
// The stepper below still renders the pre-20-April labels because the two
// existing `proof_of_concept` rows were remapped by
// migration_20260420_pipeline_stage.sql and because the visual stepper is
// useful across the old and new vocabularies alike. Revisit when A1
// (discovery_stage rename) lands.
export const PIPELINE_STAGES = [
  { key: 'proof_of_concept', label: 'Proof of Concept' },
  { key: 'development',      label: 'Development' },
  { key: 'clinical_trial',   label: 'Clinical Trial' },
  { key: 'pre_submission',   label: 'Pre-submission' },
  { key: 'submitted',        label: 'Submitted' },
  { key: 'under_review',     label: 'Under Review' },
  { key: 'cleared',          label: 'Cleared' },
]

// ── LabelValue — small labelled fact card ─────────────────────────────────────

export function LabelValue({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: '12px 14px', background: '#f8fafc', borderRadius: 12, border: '1px solid var(--line)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{value}</div>
    </div>
  )
}

// ── PipelineStepper ───────────────────────────────────────────────────────────

export function PipelineStepper({ currentStage }: { currentStage: string }) {
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

export function PreClearanceBanner({ dataSource }: { dataSource: string }) {
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

export function DataSourceTag({ source }: { source: string }) {
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

// ── External-ID display helpers ──────────────────────────────────────────────

export const EXT_ID_LABEL: Record<ExternalIdType, string> = {
  fda_k_number:          'FDA 510(k)',
  fda_de_novo:           'FDA De Novo',
  fda_pma:               'FDA PMA',
  mhra_device_id:        'MHRA Device',
  ce_certificate:        'CE Certificate',
  eudamed_basic_udi:     'EUDAMED Basic UDI',
  eudamed_udi_di:        'EUDAMED UDI-DI',
  nct:                   'ClinicalTrials.gov',
  udi_di:                'UDI-DI',
  scarlet_pccp_id:       'Scarlet PCCP',
  health_canada_licence: 'Health Canada Licence',
  tga_artg:              'TGA ARTG',
  pmda_approval:         'PMDA',
  legacy_unclassified:   'Legacy',
}

export function formatExternalIdLabel(e: Pick<DeviceExternalId, 'id_type' | 'jurisdiction'>): string {
  const label = EXT_ID_LABEL[e.id_type] ?? e.id_type
  return e.jurisdiction ? `${label} · ${e.jurisdiction}` : label
}

export function primaryExternalId(ids: DeviceExternalId[] | null | undefined): DeviceExternalId | null {
  if (!ids || ids.length === 0) return null
  return ids.find(e => e.is_primary) ?? ids[0]
}

// ── All-identifiers panel ────────────────────────────────────────────────────
// A <details> element — no JS, progressive enhancement, SSR-clean.

export function AllIdentifiersPanel({
  aletiaId,
  externalIds,
}: {
  aletiaId: string
  externalIds: DeviceExternalId[]
}) {
  const sorted = [...externalIds].sort((a, b) => {
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1
    const aTrial = a.id_type === 'nct' ? 1 : 0
    const bTrial = b.id_type === 'nct' ? 1 : 0
    if (aTrial !== bTrial) return aTrial - bTrial
    return a.id_type.localeCompare(b.id_type)
  })

  if (sorted.length === 0) {
    return null
  }

  return (
    <details
      style={{
        marginBottom: 16, padding: '12px 16px',
        background: '#f8fafc', border: '1px solid var(--line)',
        borderRadius: 12,
      }}
    >
      <summary
        style={{
          cursor: 'pointer',
          fontSize: 12, fontWeight: 700, color: 'var(--muted)',
          textTransform: 'uppercase', letterSpacing: '.06em',
        }}
      >
        All identifiers ({sorted.length + 1})
      </summary>
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, flexWrap: 'wrap' }}>
          <span style={{
            minWidth: 140, fontSize: 11, fontWeight: 700, color: 'var(--muted)',
            textTransform: 'uppercase', letterSpacing: '.04em',
          }}>
            Aletia (canonical)
          </span>
          <code style={{
            fontFamily: 'ui-monospace,monospace', fontSize: 13, fontWeight: 600,
            color: 'var(--text)',
          }}>
            {aletiaId}
          </code>
        </div>
        {sorted.map(e => (
          <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, flexWrap: 'wrap' }}>
            <span style={{
              minWidth: 140, fontSize: 11, fontWeight: 700, color: 'var(--muted)',
              textTransform: 'uppercase', letterSpacing: '.04em',
            }}>
              {formatExternalIdLabel(e)}{e.is_primary ? ' (primary)' : ''}
            </span>
            <code style={{
              fontFamily: 'ui-monospace,monospace', fontSize: 13,
              color: 'var(--text)',
            }}>
              {e.id_value}
            </code>
          </div>
        ))}
      </div>
    </details>
  )
}

// ── Trials section helpers ───────────────────────────────────────────────────

export function sortTrials(trials: DeviceTrial[]): DeviceTrial[] {
  const ROLE_ORDER: Record<string, number> = {
    pivotal: 0, supporting: 1, exploratory: 2, unknown: 3,
  }
  const STATUS_ORDER: Record<string, number> = {
    active: 0, recruiting: 0, completed: 1, terminated: 2,
    withdrawn: 2, suspended: 2, unknown: 3,
  }
  return [...trials].sort((a, b) => {
    const aRole = ROLE_ORDER[a.trial_role ?? 'unknown'] ?? 9
    const bRole = ROLE_ORDER[b.trial_role ?? 'unknown'] ?? 9
    if (aRole !== bRole) return aRole - bRole
    const aStatus = STATUS_ORDER[a.status ?? 'unknown'] ?? 9
    const bStatus = STATUS_ORDER[b.status ?? 'unknown'] ?? 9
    return aStatus - bStatus
  })
}

const TRIAL_STATUS_STYLE: Record<string, CSSProperties> = {
  recruiting: { background: '#e9f9ef', color: '#137a3b', border: '1px solid rgba(19,122,59,.2)' },
  active:     { background: '#e9f9ef', color: '#137a3b', border: '1px solid rgba(19,122,59,.2)' },
  completed:  { background: '#f0f4ff', color: '#1e40af', border: '1px solid rgba(31,64,174,.2)' },
  terminated: { background: '#ffecec', color: '#9f1d1d', border: '1px solid rgba(159,29,29,.2)' },
  suspended:  { background: '#fff4e5', color: '#a15c00', border: '1px solid rgba(161,92,0,.2)' },
  withdrawn:  { background: '#f1f5f9', color: '#475569', border: '1px solid var(--line)' },
  unknown:    { background: '#f1f5f9', color: '#475569', border: '1px solid var(--line)' },
}

function trialStatusStyle(s: string | null): CSSProperties {
  if (!s) return TRIAL_STATUS_STYLE.unknown
  return TRIAL_STATUS_STYLE[s.toLowerCase()] ?? TRIAL_STATUS_STYLE.unknown
}

export function TrialCard({ t }: { t: DeviceTrial }) {
  return (
    <div style={{
      padding: '12px 14px', background: '#f8fafc',
      borderRadius: 12, border: '1px solid var(--line)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
        {t.nct_id ? (
          <a
            href={`https://clinicaltrials.gov/study/${t.nct_id}`}
            target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)', textDecoration: 'none', fontFamily: 'ui-monospace,monospace' }}
          >
            {t.nct_id} ↗
          </a>
        ) : (
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
            {t.title ?? 'Trial'}
          </span>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {t.trial_role && t.trial_role !== 'unknown' && (
            <span style={{
              padding: '3px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700,
              background: t.trial_role === 'pivotal' ? '#eff6ff' : '#f1f5f9',
              color: t.trial_role === 'pivotal' ? '#1d4ed8' : '#475569',
              border: `1px solid ${t.trial_role === 'pivotal' ? 'rgba(29,78,216,.2)' : 'var(--line)'}`,
              textTransform: 'capitalize',
            }}>
              {t.trial_role}
            </span>
          )}
          {t.status && (
            <span style={{
              padding: '3px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700,
              ...trialStatusStyle(t.status),
              textTransform: 'capitalize',
            }}>
              {t.status}
            </span>
          )}
        </div>
      </div>
      {t.title && t.nct_id && (
        <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 6 }}>
          {t.title}
        </div>
      )}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)' }}>
        {t.phase && <span>Phase: {t.phase}</span>}
        {t.enrollment != null && <span>{t.enrollment} enrolled</span>}
        {t.jurisdictions && t.jurisdictions.length > 0 && (
          <span>{t.jurisdictions.slice(0, 4).join(', ')}{t.jurisdictions.length > 4 ? '…' : ''}</span>
        )}
      </div>
    </div>
  )
}

// statusStyle and FLAG remain in page.tsx because they are used exclusively
// by the cleared-device template.
