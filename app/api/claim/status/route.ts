import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'

// SEC-003. Both queries below selected claimed_by_email — a requester's email
// address — with the publishable key, and neither response ever used it. The
// column is dropped from both selects here, and the route moves to the admin
// client because the migration revokes claimed_by_email and auth_user_id from
// anon. Responses are unchanged: booleans and a tier, no personal data.
const supabase = createAdminClient()

export async function GET(req: NextRequest) {
  try {
    const deviceId = req.nextUrl.searchParams.get('deviceId')
    const manufacturerId = req.nextUrl.searchParams.get('manufacturerId')

    if (!deviceId && !manufacturerId) {
      return NextResponse.json({ error: 'deviceId or manufacturerId required' }, { status: 400 })
    }



    if (deviceId) {
      const { data, error } = await supabase
        .from('device_master')
        .select('claimed_at, auth_user_id')
        .eq('aletia_id', deviceId)
        .single()

      if (error) return NextResponse.json({ error: 'Device not found' }, { status: 404 })

      return NextResponse.json({
        claimed: !!data.claimed_at,
        claimedAt: data.claimed_at,
        hasAuthUser: !!data.auth_user_id,
      })
    }

    if (manufacturerId) {
      const { data, error } = await supabase
        .from('manufacturers')
        .select('claimed_at, tier, auth_user_id')
        .eq('id', manufacturerId)
        .single()

      if (error) return NextResponse.json({ error: 'Manufacturer not found' }, { status: 404 })

      return NextResponse.json({
        claimed: !!data.claimed_at,
        claimedAt: data.claimed_at,
        tier: data.tier,
        hasAuthUser: !!data.auth_user_id,
      })
    }

  } catch (err) {
    console.error('claim/status error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}