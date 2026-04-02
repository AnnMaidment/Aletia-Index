'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const ROLES = [
  { value: 'founder', label: 'Founder / Co-founder' },
  { value: 'regulatory', label: 'Regulatory Affairs' },
  { value: 'marketing', label: 'Marketing / Comms' },
  { value: 'other', label: 'Other' },
]

export default function ClaimRequestForm({ 
  deviceId,
  manufacturerId,
}: { 
  deviceId: string
  manufacturerId: string | null
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')
  const [companyUrl, setCompanyUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleSubmit() {
    if (!name || !email || !role) {
      setError('Name, email and role are required')
      return
    }

    setLoading(true)
    setError('')

    const res = await fetch('/api/claim/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        deviceId, 
        manufacturerId,
        email, 
        name, 
        role,
        companyUrl 
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      setError(data.error || 'Something went wrong. Please try again.')
      setLoading(false)
      return
    }

    router.push('/claim/sent')
  }

  const inputStyle = {
    width: '100%', padding: '10px 12px',
    border: '1px solid #e6ebf3', borderRadius: 6,
    fontSize: 15, boxSizing: 'border-box' as const
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 32 }}>
      <div>
        <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>
          Full name
        </label>
        <input type="text" value={name} onChange={e => setName(e.target.value)} 
               style={inputStyle} />
      </div>

      <div>
        <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>
          Work email
        </label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} 
               style={inputStyle} />
      </div>

      <div>
        <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>
          Your role
        </label>
        <select value={role} onChange={e => setRole(e.target.value)} style={inputStyle}>
          <option value="">Select a role</option>
          {ROLES.map(r => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>
          Company website <span style={{ color: '#64748b', fontWeight: 400 }}>(optional)</span>
        </label>
        <input type="url" value={companyUrl} onChange={e => setCompanyUrl(e.target.value)}
               placeholder="https://" style={inputStyle} />
      </div>

      {error && (
        <p style={{ color: '#dc2626', fontSize: 14, margin: 0 }}>{error}</p>
      )}

      <button
        onClick={handleSubmit}
        disabled={loading}
        style={{
          background: '#1f6feb', color: 'white', border: 'none',
          borderRadius: 6, padding: '12px 24px', fontSize: 15,
          fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.7 : 1
        }}
      >
        {loading ? 'Submitting...' : 'Request claim link'}
      </button>
    </div>
  )
}