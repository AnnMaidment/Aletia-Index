import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { sendClaimRequestConfirmationEmail } from '@/lib/email'

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