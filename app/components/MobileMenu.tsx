'use client'

import { useState } from 'react'

export default function MobileMenu() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="hamburger" onClick={() => setOpen(!open)} aria-label="Menu">
        <span /><span /><span />
      </button>
      <div className={`mobileMenu ${open ? 'open' : ''}`}>
        <a href="/"              className="active"    onClick={() => setOpen(false)}>Index</a>
        <a href="/methodology"                         onClick={() => setOpen(false)}>Methodology</a>
        <a href="/insights"                            onClick={() => setOpen(false)}>Insights</a>
        <a href="/clinicians"                          onClick={() => setOpen(false)}>For Clinicians</a>
        <a href="/request-review" className="primaryBtn" onClick={() => setOpen(false)}>Request Review</a>
      </div>
    </>
  )
}
