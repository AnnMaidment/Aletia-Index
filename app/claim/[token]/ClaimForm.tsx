'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

export default function ClaimForm({ 
  token, 
  prefillEmail 
}: { 
  token: string
  prefillEmail: string 
}) {
  const [email, setEmail] = useState(prefillEmail)
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  async function handleClaim() {
    if (!email || !password) {
      setError('Email and password are required')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setLoading(true)
    setError('')

    // Try sign up
    const { error: signUpError } = await supabase.auth.signUp({ email, password })

    if (signUpError && !signUpError.message.includes('already registered')) {
      setError(signUpError.message)
      setLoading(false)
      return
    }

    // If already registered sign them in instead
    if (signUpError?.message.includes('already registered')) {
      const { error: signInError } = await supabase.auth.signInWithPassword({ 
        email, 
        password 
      })
      if (signInError) {
        setError('Incorrect password for existing account. Please try again.')
        setLoading(false)
        return
      }
    }

    // Mark as claimed
    const res = await fetch('/api/claim/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, email }),
    })

    const data = await res.json()

    if (!res.ok) {
      setError(data.error || 'Claim failed. Please try again.')
      setLoading(false)
      return
    }

    router.push('/dashboard')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 32 }}>
      <div>
        <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>
          Email
        </label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          disabled={!!prefillEmail}
          style={{ 
            width: '100%', padding: '10px 12px', 
            border: '1px solid #e6ebf3', borderRadius: 6,
            fontSize: 15, boxSizing: 'border-box',
            background: prefillEmail ? '#f5f7fb' : 'white'
          }}
        />
      </div>

      <div>
        <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>
          Set a password
        </label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Minimum 8 characters"
          style={{ 
            width: '100%', padding: '10px 12px',
            border: '1px solid #e6ebf3', borderRadius: 6,
            fontSize: 15, boxSizing: 'border-box'
          }}
        />
      </div>

      {error && (
        <p style={{ color: '#dc2626', fontSize: 14, margin: 0 }}>{error}</p>
      )}

      <button
        onClick={handleClaim}
        disabled={loading}
        style={{
          background: '#1f6feb', color: 'white', border: 'none',
          borderRadius: 6, padding: '12px 24px', fontSize: 15,
          fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.7 : 1
        }}
      >
        {loading ? 'Claiming...' : 'Claim listing'}
      </button>
    </div>
  )
}