import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

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
        .select('claimed_at, claimed_by_email, auth_user_id')
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
        .select('claimed_at, claimed_by_email, tier, auth_user_id')
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