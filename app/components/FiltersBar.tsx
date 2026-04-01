'use client'

import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

interface Props {
  specialties:   string[]
  totalCount:    number
  pipelineCount: number
}

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

  return (
    <>
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

      <div className="metaLine">
        <span style={{ width: '8px', height: '8px', borderRadius: '99px', background: 'var(--blue)', display: 'inline-block', flexShrink: 0 }} />
        <b style={{ color: 'var(--text)' }}>{totalCount}</b> Technologies listed
        {pipelineCount > 0 && (
          <span style={{ marginLeft: 4 }}>
            · <span style={{ color: '#1e40af', fontWeight: 600 }}>{pipelineCount} in pipeline</span>
          </span>
        )}
      </div>

      {/* ── PCCP + Autonomous filter row — same axis, above status pills ── */}
      <div className="pills" style={{ marginBottom: 8 }}>
        <span
          className={`pill ${pccp === 'approved' ? 'active' : 'light'}`}
          onClick={() => pushParams({ pccp: 'approved', autonomous: '' })}
        >
          ✓ PCCP Authorized
        </span>
        <span
          className={`pill ${autonomous === 'true' ? 'active' : 'light'}`}
          style={autonomous === 'true' ? {
            background: '#fffbeb',
            color: '#92400e',
            borderColor: '#d97706',
          } : {}}
          onClick={() => pushParams({ pccp: 'all', autonomous: autonomous === 'true' ? '' : 'true' })}
        >
          ⬡ Autonomous Output
        </span>
        <span
          className={`pill light ${pccp !== 'approved' && autonomous !== 'true' ? 'active' : ''}`}
          onClick={() => pushParams({ pccp: 'all', autonomous: '' })}
        >
          All devices
        </span>
      </div>

      {/* ── Status pills ── */}
      <div className="pills">
        {(['All', 'Green', 'Amber', 'Red', 'Pipeline'] as const).map(s => (
          <span
            key={s}
            className={`pill light ${status === s ? 'active' : ''}`}
            onClick={() => pushParams({ status: s })}
          >
            {s === 'All' ? 'All' : s === 'Pipeline' ? '⚗ Pipeline' : `${s} Status`}
          </span>
        ))}
      </div>
    </>
  )
}
