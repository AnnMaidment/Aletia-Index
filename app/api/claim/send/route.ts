import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'
import { sendClaimInviteEmail } from '@/lib/email'

export async function POST(req: NextRequest) {
  try {
    // Protect with your cron secret — same pattern as your existing routes
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { manufacturerId, deviceId } = await req.json()

    if (!manufacturerId && !deviceId) {
      return NextResponse.json({ error: 'manufacturerId or deviceId required' }, { status: 400 })
    }

    const supabase = createAdminClient()

    if (manufacturerId) {
      const { data: manufacturer, error } = await supabase
        .from('manufacturers')
        .select('id, name, contact_email, contact_name, claim_token, claimed_at')
        .eq('id', manufacturerId)
        .single()

      if (error || !manufacturer) {
        return NextResponse.json({ error: 'Manufacturer not found' }, { status: 404 })
      }

      if (manufacturer.claimed_at) {
        return NextResponse.json({ error: 'Already claimed' }, { status: 409 })
      }

      if (!manufacturer.contact_email) {
        return NextResponse.json({ error: 'No contact email on record' }, { status: 400 })
      }

      await sendClaimInviteEmail({
        to: manufacturer.contact_email,
        name: manufacturer.contact_name || manufacturer.name,
        token: manufacturer.claim_token,
        entityName: manufacturer.name,
      })

      return NextResponse.json({ success: true, sentTo: manufacturer.contact_email })
    }

    // Device-level invite
    if (deviceId) {
      const { data: device, error } = await supabase
        .from('device_master')
        .select('aletia_id, manufacturer_name, claim_token, claimed_at, manufacturer_link')
        .eq('aletia_id', deviceId)
        .single()

      if (error || !device) {
        return NextResponse.json({ error: 'Device not found' }, { status: 404 })
      }

      if (device.claimed_at) {
        return NextResponse.json({ error: 'Already claimed' }, { status: 409 })
      }

      // Try to get contact from linked manufacturer
      let contactEmail = null
      let contactName = null

      if (device.manufacturer_link) {
        const { data: mfr } = await supabase
          .from('manufacturers')
          .select('contact_email, contact_name')
          .eq('id', device.manufacturer_link)
          .single()

        contactEmail = mfr?.contact_email
        contactName = mfr?.contact_name
      }

      if (!contactEmail) {
        return NextResponse.json({ error: 'No contact email found for this device' }, { status: 400 })
      }

      await sendClaimInviteEmail({
        to: contactEmail,
        name: contactName || device.manufacturer_name || 'there',
        token: device.claim_token,
        entityName: device.manufacturer_name || deviceId,
      })

      return NextResponse.json({ success: true, sentTo: contactEmail })
    }

  } catch (err) {
    console.error('claim/send error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}