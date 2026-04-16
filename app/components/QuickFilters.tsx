'use client'

import { useSearchParams, useRouter, usePathname } from 'next/navigation'

const QUICK_FILTERS = ['Radiology', 'Cardiology', 'Pathology', 'Mental Health', 'SAHPRA']

export default function QuickFilters() {
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()

  function applySearch(term: string) {
    const next = new URLSearchParams(searchParams.toString())
    next.set('search', term)
    next.delete('page')
    router.replace(`${pathname}?${next.toString()}`)
  }

  return (
    <div className="pills" style={{ marginTop: '8px' }}>
      {QUICK_FILTERS.map(f => (
        <span key={f} className="pill light" onClick={() => applySearch(f)}>{f}</span>
      ))}
    </div>
  )
}
