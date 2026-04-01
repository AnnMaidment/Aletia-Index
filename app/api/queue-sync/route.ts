/**
 * app/api/queue-sync/route.ts
 *
 * Batch-processes pending items in ingestion_review_queue.
 * Calls the appropriate sync function per device type, then:
 *   - On success: sets pccp_status = 'approved' on device_master
 *                 marks queue row as 'approved'
 *   - On failure: marks queue row as 'rejected' with error note
 *
 * Handles two types:
 *   K numbers  → syncDeviceFromFDA (existing fdaSync logic)
 *   De Novo    → syncDeNovoDevice  (new denovoSync logic)
 *   PMA        → skipped (out of scope for now)
 *
 * Usage:
 *   POST /api/queue-sync
 *   Headers: { "x-sync-token": "your_sync_secret" }
 *
 *   Optional body to limit which types are processed:
 *   { "types": ["k_numbers"] }           — K numbers only
 *   { "types": ["denovos"] }             — De Novo only
 *   { "types": ["k_numbers", "denovos"] } — both (default)
 *
 * PowerShell:
 *   try { $r = Invoke-WebRequest -Uri "http://localhost:3000/api/queue-sync" -Method POST -Headers @{"x-sync-token"="aletia-sync-2026-secret"}; $r.Content } catch { $_.Exception.Response.StatusCode; $_.Exception.Message }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { syncDeviceFromFDA } from '@/lib/fdaSync'
import { syncDeNovoDevice } from '@/lib/denovoSync'

// Delay between FDA API calls to respect rate limits
const RATE_LIMIT_DELAY_MS = 400

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isKNumber(id: string) {
  return id.startsWith('K')
}

function isDeNovo(id: string) {
  return id.startsWith('DEN')
}

export async function POST(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Auth
  const token = req.headers.get('x-sync-token')
  if (token !== process.env.SYNC_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Parse optional body
  let types: string[] = ['k_numbers', 'denovos']
  try {
    const body = await req.json()
    if (Array.isArray(body?.types)) types = body.types
  } catch {
    // No body or invalid JSON — use defaults
  }

  const processKNumbers = types.includes('k_numbers')
  const processDenovos  = types.includes('denovos')

  // ── Fetch pending queue items ──────────────────────────────────────────────
  const { data: pendingItems, error: fetchError } = await supabase
    .from('ingestion_review_queue')
    .select('queue_id, source_id, pccp_authorized_date')
    .eq('status', 'pending')
    .order('pccp_authorized_date', { ascending: true })

  if (fetchError) {
    return NextResponse.json(
      { error: `Failed to fetch queue: ${fetchError.message}` },
      { status: 500 }
    )
  }

  if (!pendingItems || pendingItems.length === 0) {
    return NextResponse.json({
      success: true,
      message: 'No pending items in queue',
      processed: 0,
    })
  }

  // ── Filter by type ─────────────────────────────────────────────────────────
  const toProcess = pendingItems.filter(item => {
    if (isKNumber(item.source_id) && processKNumbers) return true
    if (isDeNovo(item.source_id)  && processDenovos)  return true
    return false
  })

  const results = {
    total_pending: pendingItems.length,
    attempted: toProcess.length,
    succeeded: 0,
    failed: 0,
    skipped_pma: pendingItems.filter(i => i.source_id.startsWith('P')).length,
    errors: [] as string[],
  }

  // ── Process each device ────────────────────────────────────────────────────
  for (const item of toProcess) {
    const deviceId = item.source_id
    await sleep(RATE_LIMIT_DELAY_MS)

    // 1. Sync device data from FDA
    let syncResult
    if (isKNumber(deviceId)) {
      syncResult = await syncDeviceFromFDA(deviceId, { k_number: deviceId })
    } else {
      syncResult = await syncDeNovoDevice(deviceId)
    }

    if (syncResult.success) {
      // 2. Set pccp_status = 'approved' on the newly synced device
      //    (syncDeviceFromFDA doesn't know about PCCP — we apply it here)
      const { error: pccpError } = await supabase
        .from('device_master')
        .update({
          pccp_status: 'approved',
          pccp_authorized_date: item.pccp_authorized_date,
          pccp_source: 'oleary_csv',
        })
        .eq('device_id', deviceId)

      if (pccpError) {
        console.warn(`[queueSync] pccp_status update failed for ${deviceId}: ${pccpError.message}`)
      }

      // 3. Mark queue row as approved
      await supabase
        .from('ingestion_review_queue')
        .update({
          status: 'approved',
          reviewed_at: new Date().toISOString(),
          reviewed_by: 'queue-sync-auto',
        })
        .eq('queue_id', item.queue_id)

      results.succeeded++

    } else {
      // 4. Mark queue row as rejected with error note
      await supabase
        .from('ingestion_review_queue')
        .update({
          status: 'rejected',
          review_note: syncResult.error ?? 'Sync failed',
          reviewed_at: new Date().toISOString(),
          reviewed_by: 'queue-sync-auto',
        })
        .eq('queue_id', item.queue_id)

      results.failed++
      results.errors.push(`${deviceId}: ${syncResult.error}`)
    }
  }

  return NextResponse.json({
    success: results.failed === 0,
    ...results,
    ran_at: new Date().toISOString(),
  }, { status: results.failed > 0 ? 207 : 200 })
}

export async function GET(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const token = req.headers.get('x-sync-token')
  if (token !== process.env.SYNC_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Show queue summary without processing anything
  const { data, error } = await supabase
    .from('ingestion_review_queue')
    .select('status, source_id')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const summary = {
    total: data.length,
    pending:  data.filter(r => r.status === 'pending').length,
    approved: data.filter(r => r.status === 'approved').length,
    rejected: data.filter(r => r.status === 'rejected').length,
    pending_k_numbers: data.filter(r => r.status === 'pending' && r.source_id.startsWith('K')).length,
    pending_denovos:   data.filter(r => r.status === 'pending' && r.source_id.startsWith('DEN')).length,
    pending_pma:       data.filter(r => r.status === 'pending' && r.source_id.startsWith('P')).length,
  }

  return NextResponse.json(summary)
}
