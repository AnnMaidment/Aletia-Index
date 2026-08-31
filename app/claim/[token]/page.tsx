import { createAdminClient } from '@/lib/supabase-admin'
import { notFound } from 'next/navigation'
import ClaimForm from './ClaimForm'

// SEC-003. This page looks a token up against manufacturers.claim_token and
// claim_requests.token. Both were readable with the publishable key, so the
// lookup it performs was one anyone could perform in bulk — and a claim token
// is the whole proof of entitlement to take over a listing.
//
// The accompanying migration seals claim_requests and revokes the token columns
// from anon, so this lookup now requires the service-role client. It is a server
// component; nothing here reaches the browser.
const supabase = createAdminClient()

export default async function ClaimPage({
  params 
}: { 
  params: Promise<{ token: string }> 
}) {
  const resolvedParams = await params
  const token = resolvedParams?.token

  if (!token) notFound()

  // Try manufacturer claim token first
  const { data: manufacturer } = await supabase
    .from('manufacturers')
    .select('id, name, claimed_at, contact_email')
    .eq('claim_token', token)
    .single()

  if (manufacturer?.claimed_at) {
    return (
      <main style={{ maxWidth: 480, margin: '80px auto', padding: '0 24px' }}>
        <h1>Already claimed</h1>
        <p>This listing has already been claimed. If you believe this is an error,
        email <a href="mailto:info@aletia-index.com">info@aletia-index.com</a>.</p>
      </main>
    )
  }

  // Try claim request token
  const { data: request } = !manufacturer ? await supabase
    .from('claim_requests')
    .select('id, requester_email, requester_name, token_expires_at, status, device_id, manufacturer_id')
    .eq('token', token)
    .single() : { data: null }

  if (!manufacturer && !request) notFound()

  if (request?.status === 'claimed') {
    return (
      <main style={{ maxWidth: 480, margin: '80px auto', padding: '0 24px' }}>
        <h1>Already claimed</h1>
        <p>This listing has already been claimed.</p>
      </main>
    )
  }

  // Check expiry on request tokens
  if (request && new Date(request.token_expires_at) < new Date()) {
    return (
      <main style={{ maxWidth: 480, margin: '80px auto', padding: '0 24px' }}>
        <h1>Link expired</h1>
        <p>This claim link expired after 72 hours. Go back to your listing and 
        request a new one.</p>
      </main>
    )
  }

  const entityName = manufacturer?.name || 'your device'
  const prefillEmail = manufacturer?.contact_email || request?.requester_email || ''

  return (
    <main style={{ maxWidth: 480, margin: '80px auto', padding: '0 24px' }}>
      <h1>Claim your listing</h1>
      <p>
        You are claiming <strong>{entityName}</strong> on the Aletia Index. 
        Set a password to create your account and take control of your listing.
      </p>
      <ClaimForm 
        token={token} 
        prefillEmail={prefillEmail}
      />
    </main>
  )
}