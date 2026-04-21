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

// statusStyle and FLAG remain in page.tsx because they are used exclusively
// by the cleared-device template.
