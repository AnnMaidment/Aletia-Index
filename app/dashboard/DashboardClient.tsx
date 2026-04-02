'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

export default function DashboardClient() {
  const [email, setEmail] = useState<string | null>(null)
  const [manufacturer, setManufacturer] = useState<any>(null)
  const [devices, setDevices] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    async function load() {
   const { data: { user }, error } = await supabase.auth.getUser()

console.log('Dashboard user:', user)
console.log('Dashboard error:', error)
      if (!user) {
        router.push('/claim/invalid')
        return
      }

      setEmail(user.email ?? null)

      const { data: mfr } = await supabase
        .from('manufacturers')
        .select('id, name, tier, claimed_at, status, subscription_status')
        .eq('claimed_by_email', user.email)
        .single()

      if (mfr) setManufacturer(mfr)

      const { data: devs } = await supabase
        .from('device_master')
        .select('device_id, manufacturer_name, health_status, claimed_at')
        .eq('claimed_by_email', user.email)

      if (devs) setDevices(devs)

      setLoading(false)
    }

    load()
  }, [])

  if (loading) {
    return (
      <main style={{ maxWidth: 800, margin: '60px auto', padding: '0 24px' }}>
        <p style={{ color: '#64748b' }}>Loading your dashboard...</p>
      </main>
    )
  }

  return (
    <main style={{ maxWidth: 800, margin: '60px auto', padding: '0 24px' }}>

      <div style={{ marginBottom: 40 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#0f172a', margin: 0 }}>
          Your Dashboard
        </h1>
        <p style={{ color: '#64748b', marginTop: 8 }}>Signed in as {email}</p>
      </div>

      {manufacturer && (
        <div style={{
          background: 'white', border: '1px solid #e6ebf3',
          borderRadius: 12, padding: 24, marginBottom: 24
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 20, color: '#0f172a' }}>{manufacturer.name}</h2>
              <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 14 }}>
                Claimed {new Date(manufacturer.claimed_at).toLocaleDateString('en-GB', {
                  day: 'numeric', month: 'long', year: 'numeric'
                })}
              </p>
            </div>
            <span style={{
              background: '#dcfce7', color: '#166534',
              padding: '4px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600
            }}>
              {manufacturer.tier}
            </span>
          </div>
        </div>
      )}

      {devices.length > 0 && (
        <div style={{
          background: 'white', border: '1px solid #e6ebf3',
          borderRadius: 12, padding: 24, marginBottom: 24
        }}>
          <h2 style={{ margin: '0 0 16px', fontSize: 18, color: '#0f172a' }}>
            Your Devices ({devices.length})
          </h2>
          {devices.map(device => (
            <div key={device.device_id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 0', borderBottom: '1px solid #e6ebf3'
            }}>
              <div>
                <p style={{ margin: 0, fontWeight: 500 }}>{device.manufacturer_name}</p>
                <p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b' }}>{device.device_id}</p>
              </div>
              <a href={`/device/${device.device_id}`} style={{
                fontSize: 13, color: '#1f6feb', textDecoration: 'none', fontWeight: 500
              }}>
                View listing →
              </a>
            </div>
          ))}
        </div>
      )}

      {!manufacturer && devices.length === 0 && (
        <div style={{
          background: 'white', border: '1px solid #e6ebf3',
          borderRadius: 12, padding: 40, textAlign: 'center'
        }}>
          <p style={{ color: '#64748b' }}>No claimed listings found for {email}.</p>
        </div>
      )}

      <div style={{
        background: '#f8fafc', border: '1px solid #e6ebf3',
        borderRadius: 12, padding: 24
      }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 16, color: '#0f172a' }}>Coming soon</h3>
        <p style={{ margin: 0, color: '#64748b', fontSize: 14 }}>
          Edit your listing, update clinical trial status, track investor interest,
          and manage your Aletia Verified audit from here.
        </p>
      </div>

    </main>
  )
}