// ============================================================
// app/api/pccp-ingest/route.ts
// API endpoint for the PCCP ingestion pipeline
//
// Secured with x-sync-token header (same SYNC_SECRET as fda-sync)
//
// Vercel Cron calls this on schedule.
// You can also trigger manually:
//   POST /api/pccp-ingest
//   Headers: { "x-sync-token": "your_sync_secret" }
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { runPCCPIngest } from '@/lib/pccpIngest'

export async function POST(req: NextRequest) {
  // Auth check — same pattern as fda-sync
  const token = req.headers.get('x-sync-token')
  if (token !== process.env.SYNC_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await runPCCPIngest()

  const status = result.errors.length > 0 ? 207 : 200  // 207 = partial success

  return NextResponse.json({
    success: result.errors.length === 0,
    ...result,
    ran_at: new Date().toISOString(),
  }, { status })
}

// Health check — lets you confirm the endpoint exists
export async function GET(req: NextRequest) {
  const token = req.headers.get('x-sync-token')
  if (token !== process.env.SYNC_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({
    endpoint: 'pccp-ingest',
    description: "O'Leary PCCP CSV ingestion pipeline",
    schedule: 'Every 14 days via Vercel Cron',
    trigger: 'POST /api/pccp-ingest with x-sync-token header',
  })
}

