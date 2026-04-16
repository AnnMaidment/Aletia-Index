import { NextRequest, NextResponse } from 'next/server'
import { runClinicalTrialsIngest } from '@/lib/clinicalTrialsIngest'

export const maxDuration = 300 // 5 minutes — multiple keyword queries + DB writes

export async function POST(req: NextRequest): Promise<NextResponse> {
//   // ── Auth ──────────────────────────────────────────────────────────────────
//   const authHeader = req.headers.get('authorization')
//   const token = authHeader?.replace('Bearer ', '').trim()

//   if (!token || token !== process.env.CRON_SECRET) {
//     return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
//   }

  // ── Run ───────────────────────────────────────────────────────────────────
  console.log('[clinical-trials-ingest] Starting run')

  try {
    const result = await runClinicalTrialsIngest()

    const status = result.errors.length > 0 ? 207 : 200

    return NextResponse.json(
      {
        ok: true,
        summary: {
          total_fetched: result.total,
          passed_aiml_filter: result.filteredAsAIML,
          updated_existing: result.updatedExisting,
          created_pre_approval: result.createdPreApproval,
          queued_commercial: result.queuedCommercial,
          queued_academic: result.queuedAcademic,
          queued_for_review: result.queuedCommercial + result.queuedAcademic,
          error_count: result.errors.length,
        },
        errors: result.errors.length > 0 ? result.errors : undefined,
      },
      { status }
    )
  } catch (err) {
    console.error('[clinical-trials-ingest] Fatal error:', err)
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 }
    )
  }
}