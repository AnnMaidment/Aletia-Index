'use client'

import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

interface Props {
  specialties:   string[]
  totalCount:    number
  pipelineCount: number
}

// Sub-stage pill labels for Pipeline mode — must match PIPELINE_STAGE_MAP in page.tsx
const PIPELINE_SUBSTAGES = ['Development', 'Pre-Submission', 'Clinical Trial', 'Under Review'] as const

export default function FiltersBar({ specialties, totalCount, pipelineCount }: Props) {
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()

  const search     = searchParams.get('search')     ?? ''
  const specialty  = searchParams.get('specialty')  ?? 'All'
  const status     = searchParams.get('status')     ?? 'All'
  const source     = searchParams.get('source')     ?? 'All'
  const pccp       = searchParams.get('pccp') || 'approved'
  const autonomous = searchParams.get('autonomous') ?? ''
  const pipeline   = searchParams.get('pipeline')   ?? ''   // 'true' when Pipeline mode active

  const isPipelineMode = pipeline === 'true'

  const [inputValue, setInputValue] = useState(search)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    setInputValue(searchParams.get('search') ?? '')
  }, [searchParams])

  function pushParams(overrides: Record<string, string>) {
    const next = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(overrides)) {
      if (v === '' || v === 'All') next.delete(k)
      else next.set(k, v)
    }
    next.delete('page')
    router.replace(`${pathname}?${next.toString()}`)
  }

  function handleSearchInput(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setInputValue(val)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => pushParams({ search: val }), 350)
  }

  // ── Pill click handlers ────────────────────────────────────────────────────

  function activatePccp() {
    pushParams({ pccp: 'approved', autonomous: '', pipeline: '', status: '' })
  }

  function activateAutonomous() {
    const next = autonomous === 'true' ? '' : 'true'
    pushParams({ pccp: 'all', autonomous: next, pipeline: '', status: '' })
  }

  function activatePipeline() {
    pushParams({ pipeline: 'true', pccp: 'all', autonomous: '', status: '' })
  }

  function activateAllDevices() {
    pushParams({ pccp: 'all', autonomous: '', pipeline: '', status: '' })
  }

  return (
    <>
      {/* ── Search + dropdowns ── */}
      <div className="searchRow">
        <div className="search">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
            <path d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" stroke="#94a3b8" strokeWidth="1.8" />
            <path d="M16.2 16.2 21 21" stroke="#94a3b8" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            placeholder="Search by technology name, use case, developer, regulatory class…"
            value={inputValue}
            onChange={handleSearchInput}
          />
        </div>
        <select
          className="secondaryBtn"
          value={specialty}
          onChange={e => pushParams({ specialty: e.target.value })}
        >
          <option value="All">All Specialties</option>
          {specialties.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          className="secondaryBtn"
          value={source}
          onChange={e => pushParams({ source: e.target.value })}
        >
          <option value="All">All Sources</option>
          <option value="registry_sync">Registry Sync</option>
          <option value="aletia_research">Aletia Research</option>
          <option value="manufacturer_submitted">Manufacturer Submitted</option>
        </select>
      </div>

      {/* ── Count line ── */}
      <div className="metaLine">
        <span style={{ width: '8px', height: '8px', borderRadius: '99px', background: 'var(--blue)', display: 'inline-block', flexShrink: 0 }} />
        <b style={{ color: 'var(--text)' }}>{totalCount}</b> Technologies listed
        {pipelineCount > 0 && (
          <span style={{ marginLeft: 4 }}>
            · <span style={{ color: '#1e40af', fontWeight: 600 }}>{pipelineCount} in pipeline</span>
          </span>
        )}
      </div>
{/* ── Mode row: All devices | PCCP | Autonomous | divider | Pipeline ── */}
      <div className="pills" style={{ marginBottom: 8 }}>
        {/* All devices — escape hatch from PCCP default */}
        <span
          className={`pill ${!isPipelineMode && pccp !== 'approved' && autonomous !== 'true' ? 'active' : 'light'}`}
          onClick={activateAllDevices}
        >
          All devices
        </span>

        {/* PCCP Authorized */}
        <span
          className={`pill ${!isPipelineMode && pccp === 'approved' ? 'active' : 'light'}`}
          onClick={activatePccp}
        >
          ✓ PCCP Authorized
        </span>

        {/* Autonomous Output */}
        <span
          className={`pill ${!isPipelineMode && autonomous === 'true' ? 'active' : 'light'}`}
          style={!isPipelineMode && autonomous === 'true' ? {
            background: '#fffbeb',
            color: '#92400e',
            borderColor: '#d97706',
          } : {}}
          onClick={activateAutonomous}
        >
          ⬡ Autonomous Output
        </span>

        {/* ── Subtle divider ── */}
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            width: '1px',
            height: '20px',
            background: 'var(--line)',
            borderRadius: '1px',
            margin: '0 2px',
            alignSelf: 'center',
            flexShrink: 0,
          }}
        />

        {/* Pipeline */}
        <span
          className={`pill ${isPipelineMode ? 'active' : 'light'}`}
          style={isPipelineMode ? {
            background: '#ede9fe',
            color: '#5b21b6',
            borderColor: '#8b5cf6',
          } : {}}
          onClick={activatePipeline}
        >
          🔬 Pipeline
          {pipelineCount > 0 && (
            <span style={{
              marginLeft: 5,
              padding: '1px 6px',
              borderRadius: '99px',
              fontSize: 10,
              fontWeight: 800,
              background: isPipelineMode ? 'rgba(91,33,182,.15)' : '#e2e8f0',
              color: isPipelineMode ? '#5b21b6' : '#64748b',
            }}>
              {pipelineCount}
            </span>
          )}
        </span>

      </div>

      {/* ── Second row: conditionally health-status pills or pipeline sub-stages ── */}
      {isPipelineMode ? (
        /* Pipeline sub-stage pills */
        <div className="pills">
          <span
            className={`pill light ${status === 'All' || !PIPELINE_SUBSTAGES.includes(status as typeof PIPELINE_SUBSTAGES[number]) ? 'active' : ''}`}
            onClick={() => pushParams({ status: '' })}
          >
            All stages
          </span>
          {PIPELINE_SUBSTAGES.map(stage => (
            <span
              key={stage}
              className={`pill light ${status === stage ? 'active' : ''}`}
              onClick={() => pushParams({ status: stage })}
            >
              {stage}
            </span>
          ))}
        </div>
      ) : (
        /* Health-status pills (Green / Amber / Red only — Pipeline moved to mode row) */
        <div className="pills">
          {(['All', 'Green', 'Amber', 'Red'] as const).map(s => (
            <span
              key={s}
              className={`pill light ${status === s || (s === 'All' && !['Green', 'Amber', 'Red'].includes(status)) ? 'active' : ''}`}
              onClick={() => pushParams({ status: s })}
            >
              {s === 'All' ? 'All Status' : `${s} Status`}
            </span>
          ))}
        </div>
      )}
    </>
  )
}
