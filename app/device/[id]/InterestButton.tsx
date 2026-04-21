'use client'

import { useEffect, useState } from 'react'

const COOKIE_DAYS = 30

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

function writeCookie(name: string, value: string, days: number) {
  if (typeof document === 'undefined') return
  const expires = new Date(Date.now() + days * 86400_000).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`
}

/**
 * "Interested to invest" button with live counter.
 *
 * Piece 1 (this file): visually complete, optimistically updates the count
 * on click, writes a session cookie, and attempts to POST to
 * /api/pre-approval/interested. If the endpoint doesn't exist yet (piece 2),
 * the fetch fails silently — the count still ticks up client-side for demo
 * purposes but doesn't persist. Refresh the page and the count reverts to
 * the server value.
 *
 * Piece 2 will add the endpoint with IP-hash rate-limiting and a
 * pre_approval_interest_votes table for audit.
 */
export default function InterestButton({
  deviceId,
  initialCount,
}: {
  deviceId: string
  initialCount: number
}) {
  const [count, setCount] = useState(initialCount)
  const [voted, setVoted] = useState(false)
  const [pending, setPending] = useState(false)
  const cookieName = `aletia_interest_${deviceId}`

  // Restore voted state from cookie on mount (avoids SSR hydration mismatch by
  // doing this in useEffect rather than initial state).
  useEffect(() => {
    if (readCookie(cookieName)) setVoted(true)
  }, [cookieName])

  async function handleClick() {
    if (voted || pending) return
    setPending(true)

    // Optimistic update
    setCount(c => c + 1)
    setVoted(true)
    writeCookie(cookieName, '1', COOKIE_DAYS)

    // Best-effort persist. In piece 1 this endpoint doesn't exist yet —
    // the catch keeps the demo looking right.
    try {
      const res = await fetch('/api/pre-approval/interested', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: deviceId }),
      })
      if (res.ok) {
        const data = await res.json().catch(() => null)
        // If the server returns an authoritative count, sync to it.
        if (data && typeof data.interested_investor_count === 'number') {
          setCount(data.interested_investor_count)
        }
      }
    } catch {
      // Endpoint not live yet — optimistic state stays. Intentional.
    } finally {
      setPending(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
      <button
        onClick={handleClick}
        disabled={voted || pending}
        style={{
          padding: '10px 18px',
          borderRadius: 12,
          border: 'none',
          background: voted ? '#e9f9ef' : 'var(--primary)',
          color: voted ? '#137a3b' : '#fff',
          fontSize: 13,
          fontWeight: 700,
          cursor: voted ? 'default' : 'pointer',
          whiteSpace: 'nowrap',
          transition: 'background .15s',
          opacity: pending ? 0.7 : 1,
        }}
      >
        {voted ? '✓ Interested' : 'Interested to invest'}
      </button>
      <div style={{ textAlign: 'left', minWidth: 0 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>
          {count}
        </div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 3 }}>
          {count === 1 ? 'investor' : 'investors'}
        </div>
      </div>
    </div>
  )
}
