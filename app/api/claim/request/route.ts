import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'
import { sendClaimRequestConfirmationEmail } from '@/lib/email'

// SEC-003. This route reads and writes claim_requests, whose `token` column is
// the proof of entitlement to claim a listing. The table previously carried
// blanket public SELECT + INSERT policies, so the token of every request ever
// made was readable with the key that ships in the site's JavaScript.
//
// The accompanying migration drops both policies and seals the table to
// service_role, so this route needs the admin client. It is an API route — the
// key stays on the server. The insert is still open to the public in the sense
// that anyone may request a claim; it is now mediated by this route rather than
// written directly by the browser, which is what makes the read side sealable.
const supabase = createAdminClient()

export async function POST(req: NextRequest) {
  try {
    const { deviceId, manufacturerId, email, name, role, companyUrl } = await req.json()

    if (!email || !name) {
      return NextResponse.json({ error: 'Email and name are required' }, { status: 400 })
    }

   
    // Check if already claimed
    if (deviceId) {
      const { data: device } = await supabase
        .from('device_master')
        .select('claimed_at, claimed_by_email')
        .eq('aletia_id', deviceId)
        .single()

      if (device?.claimed_at) {
        return NextResponse.json({ error: 'This listing is already claimed' }, { status: 409 })
      }
    }

    // Check for existing pending request from this email
    const { data: existing } = await supabase
      .from('claim_requests')
      .select('id, token, created_at')
      .eq('requester_email', email)
      .eq('status', 'pending')
      .eq('device_id', deviceId || null)
      .single()

    // Resend the same token if request already exists and is recent
    if (existing) {
      await sendClaimRequestConfirmationEmail({
        to: email,
        name,
        token: existing.token,
      })
      return NextResponse.json({ success: true, resent: true })
    }

    // Create new claim request
    const { data, error } = await supabase
      .from('claim_requests')
      .insert({
        device_id: deviceId || null,
        manufacturer_id: manufacturerId || null,
        requester_email: email,
        requester_name: name,
        requester_role: role || null,
        company_url: companyUrl || null,
      })
      .select()
      .single()

    if (error || !data) {
      console.error('claim_requests insert error:', error)
      return NextResponse.json({ error: 'Failed to create claim request' }, { status: 500 })
    }

    await sendClaimRequestConfirmationEmail({
      to: email,
      name,
      token: data.token,
    })

    return NextResponse.json({ success: true })

  } catch (err) {
    console.error('claim/request error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}