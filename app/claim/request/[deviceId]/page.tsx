import { supabase } from '@/lib/supabase'
import { notFound } from 'next/navigation'
import ClaimRequestForm from './ClaimRequestForm'

export default async function ClaimRequestPage({ 
  params 
}: { 
  params: Promise<{ deviceId: string }> 
}) {
  const { deviceId } = await params

  const { data: device, error } = await supabase
    .from('device_master')
    .select('aletia_id, manufacturer_name, claimed_at, manufacturer_link')
    .eq('aletia_id', deviceId)
    .single()

  console.log('deviceId param:', deviceId)
  console.log('device:', device)
  console.log('error:', error)

  if (error || !device) notFound()

  if (device.claimed_at) {
    return (
      <main style={{ maxWidth: 480, margin: '80px auto', padding: '0 24px' }}>
        <h1>Already claimed</h1>
        <p>This listing has already been claimed by the manufacturer.</p>
      </main>
    )
  }

  return (
    <main style={{ maxWidth: 480, margin: '80px auto', padding: '0 24px' }}>
      <h1>Claim this listing</h1>
      <p>
        You are requesting to claim <strong>{device.manufacturer_name}</strong> on 
        the Aletia Index. We will send a verification link to your email.
      </p>
      <ClaimRequestForm 
        deviceId={device.aletia_id}
        manufacturerId={device.manufacturer_link || null}
      />
    </main>
  )
}