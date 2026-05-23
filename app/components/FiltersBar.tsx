'use client'

import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { getCurrentFilterState } from '@/lib/filterState'

interface Props {
  specialties:   string[]
  totalCount:    number
  pipelineCount: number
  corpusTotal:   number
}

// Sub-stage pill labels for Pipeline mode — must match PIPELINE_STAGE_MAP in page.tsx
const PIPELINE_SUBSTAGES = ['Development', 'Pre-Submission', 'Clinical Trial', 'Under Review'] as const

// Minimum characters before search fires. Single-letter searches return too
// many results to be useful AND make the server-side query expensive.
// Empty input (length 0) is still allowed — backspace-to-empty resets the filter.
const MIN_SEARCH_LENGTH = 2

// Debounce delay for search input. 500ms is the standard for search-as-you-type
// where each keystroke triggers a network round-trip. Lower values fire
// mid-pause for fast typists; higher values feel laggy.
const SEARCH_DEBOUNCE_MS = 500

export default function FiltersBar({ specialties, totalCount, pipelineCount, corpusTotal }: Props) {
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()

  const { search, specialty, status, source, pccp, autonomous, isPipelineMode } =
    getCurrentFilterState(searchParams)

  const [inputValue, setInputValue] = useState(search)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Browse-all href — preserves the user's other filters (specialty, status,
  // source, search) but flips off the PCCP-only mode and any conflicting
  // pipeline / autonomous mode flags. Computed here so it's available to the
  // count line below.
  const browseAllHref = (() => {
    const next = new URLSearchParams(searchParams.toString())
    next.set('pccp', 'all')
    next.delete('autonomous')
    next.delete('pipeline')
    next.delete('page')
    const qs = next.toString()
    return qs ? `/?${qs}` : '/?pccp=all'
  })()

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

    // Always clear any pending debounce — we're either superseding it with a
    // new keystroke (covered below) or cancelling because the input is now
    // too short.
    clearTimeout(debounceRef.current)

    // Min-length guard. Empty input (val.length === 0) is allowed through so
    // backspace-to-empty clears the URL search param. Anything between 1 and
    // MIN_SEARCH_LENGTH-1 is held back — no query runs, current results stay.
    if (val.length > 0 && val.length < MIN_SEARCH_LENGTH) {
      return
    }

    debounceRef.current = setTimeout(() => pushParams({ search: val }), SEARCH_DEBOUNCE_MS)
  }

  // Clear-search ✕ — empties the input immediately and resets the URL search
  // param without waiting for the debounce. Cancels any pending debounced push.
  function clearSearch() {
    clearTimeout(debounceRef.current)
    setInputValue('')
    pushParams({ search: '' })
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
        <div className={`search${inputValue.length > 0 ? ' hasText' : ''}`}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
            <path className="mag" d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" strokeWidth="1.8" />
            <path className="mag" d="M16.2 16.2 21 21" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            placeholder="Search by technology name, use case, developer, regulatory class…"
            value={inputValue}
            onChange={handleSearchInput}
          />
          {inputValue.length > 0 && (
            <button type="button" className="clearBtn" aria-label="Clear search" onClick={clearSearch}>✕</button>
          )}
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
        {totalCount === corpusTotal ? (
          <>
            <b style={{ color: 'var(--text)' }}>{corpusTotal.toLocaleString()}</b> technologies indexed
          </>
        ) : (
          <>
            Showing <b style={{ color: 'var(--text)' }}>{totalCount.toLocaleString()}</b> of {corpusTotal.toLocaleString()} indexed
            {' · '}
            <a
              href={browseAllHref}
              style={{ color: 'var(--primary)', fontWeight: 600, textDecoration: 'none' }}
            >
              Browse all {corpusTotal.toLocaleString()} →
            </a>
          </>
        )}
        {pipelineCount > 0 && (
          <span style={{ marginLeft: 4 }}>
            · <span style={{ color: '#1e40af', fontWeight: 600 }}>{pipelineCount.toLocaleString()} in pipeline</span>
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
