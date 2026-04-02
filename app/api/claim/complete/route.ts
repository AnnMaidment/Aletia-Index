import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'

export async function POST(req: NextRequest) {
  try {
    const { token, email } = await req.json()

    if (!token || !email) {
      return NextResponse.json({ error: 'Token and email are required' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Get the auth user
    const { data: { users }, error: userError } = await supabase.auth.admin.listUsers()
    if (userError) {
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
    }

    const user = users.find(u => u.email === email)
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const now = new Date().toISOString()

    // Try manufacturer claim token first (Aletia-initiated flow)
    const { data: manufacturer } = await supabase
      .from('manufacturers')
      .select('id, claimed_at')
      .eq('claim_token', token)
      .single()

    if (manufacturer) {
      if (manufacturer.claimed_at) {
        return NextResponse.json({ error: 'Already claimed' }, { status: 409 })
      }

      const { error } = await supabase
        .from('manufacturers')
        .update({
          claimed_at: now,
          claimed_by_email: email,
          status: 'Verified',
          tier: 'claimed',
          auth_user_id: user.id,
        })
        .eq('id', manufacturer.id)

      if (error) {
        console.error('manufacturer update error:', error)
        return NextResponse.json({ error: 'Failed to complete claim' }, { status: 500 })
      }

      return NextResponse.json({ success: true, type: 'manufacturer', id: manufacturer.id })
    }

    // Try claim request token (self-initiated flow)
    const { data: request } = await supabase
      .from('claim_requests')
      .select('*')
      .eq('token', token)
      .eq('status', 'pending')
      .single()

    if (!request) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 400 })
    }

    // Check token expiry
    if (new Date(request.token_expires_at) < new Date()) {
      return NextResponse.json({ error: 'This link has expired. Please request a new one.' }, { status: 410 })
    }

    // Mark request as claimed
    await supabase
      .from('claim_requests')
      .update({ status: 'claimed' })
      .eq('id', request.id)

    // Update manufacturer if linked
    if (request.manufacturer_id) {
      await supabase
        .from('manufacturers')
        .update({
          claimed_at: now,
          claimed_by_email: email,
          status: 'Verified',
          tier: 'claimed',
          auth_user_id: user.id,
        })
        .eq('id', request.manufacturer_id)
    }

    // Update device if linked
    if (request.device_id) {
      await supabase
        .from('device_master')
        .update({
          claimed_at: now,
          claimed_by_email: email,
          auth_user_id: user.id,
        })
        .eq('device_id', request.device_id)
    }

    return NextResponse.json({ 
      success: true, 
      type: 'request',
      manufacturerId: request.manufacturer_id,
      deviceId: request.device_id,
    })

  } catch (err) {
    console.error('claim/complete error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}