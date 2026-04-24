import { NextRequest, NextResponse } from 'next/server'
import { runBreakthroughIngest } from '@/lib/breakthroughIngest'

export const maxDuration = 300 // 5 minutes — Excel fetch + DB writes need headroom

export async function POST(req: NextRequest): Promise<NextResponse> {
  // // ── Auth ──────────────────────────────────────────────────────────────────
  // const authHeader = req.headers.get('authorization')
  // const token = authHeader?.replace('Bearer ', '').trim()

  // if (!token || token !== process.env.CRON_SECRET) {
  //   return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // }

  // ── Run ───────────────────────────────────────────────────────────────────
  console.log('[breakthrough-ingest] Starting run')

  try {
    const result = await runBreakthroughIngest()

    const status = result.errors.length > 0 ? 207 : 200
    // 207 Multi-Status — partial success, some rows errored

    return NextResponse.json(
      {
        ok: true,
        summary: {
          total:                result.total,
          enriched_existing:    result.enrichedExisting,      // A2b rename from updatedExisting
          created_pre_approval: result.createdPreApproval,
          queued_for_review:    result.queuedForReview,
          skipped_no_mfg_name:  result.skippedNoMfgName,       // new in A2b
          error_count:          result.errors.length,
        },
        errors: result.errors.length > 0 ? result.errors : undefined,
      },
      { status }
    )
  } catch (err) {
    console.error('[breakthrough-ingest] Fatal error:', err)
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 }
    )
  }
}
