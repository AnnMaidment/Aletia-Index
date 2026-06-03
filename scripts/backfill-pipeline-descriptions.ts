/**
 * scripts/backfill-pipeline-descriptions.ts
 *
 * Backfills device_master.description (and any MISSING device_trials rows) for
 * CT.gov-sourced pipeline / pre-approval devices.
 *
 * Why this exists
 * ---------------
 * CT.gov-discovered pipeline devices were created with empty intended_use, and
 * the academic-sponsor "orphan" rows have NO device_trials row at all (the
 * long-standing BUG-004 / D4). Their descriptive text (the trial brief_summary
 * / title) was never written to any column the UI reads, so the home table
 * renders a blank Description.
 *
 * Per device, this script:
 *   1. resolves the NCT from device_external_ids (id_type='nct') — the CLEAN
 *      value. (device_master.external_legacy_id still carries the legacy
 *      'CT-' prefix from the pre-A2b synthesis; do not source from it.)
 *   2. re-fetches the trial from CT.gov by NCT (fetchTrialByNct).
 *   3. upserts the device_trials row (closes D4 for the orphans; refreshes the
 *      rest). Column shape mirrors lib/clinicalTrialsIngest.upsertDeviceTrial.
 *   4. sets device_master.description = brief_summary || title.
 *   5. sets device_master.name from the device-intervention name ONLY if name
 *      is currently null (never clobbers an existing name).
 *
 * Run from repo root, AFTER applying 20260603120000_add_device_description.sql:
 *   npx tsx scripts/backfill-pipeline-descriptions.ts --dry-run      # preview, no writes
 *   npx tsx scripts/backfill-pipeline-descriptions.ts                # write
 *   npx tsx scripts/backfill-pipeline-descriptions.ts --only-missing # only rows where description IS NULL
 *
 * Requires .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * NOTE: there is currently no separate staging DB (staging became prod on
 * 25 May). Run --dry-run first and read the summary before writing.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { createAdminClient } from '../lib/supabase-admin'
import { fetchTrialByNct } from '../lib/clinicalTrials'

const DRY_RUN = process.argv.includes('--dry-run')
const ONLY_MISSING = process.argv.includes('--only-missing')
const SLEEP_MS = 300 // CT.gov politeness between fetches

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Minimal academic/commercial heuristic, mirroring clinicalTrialsIngest's
// detection closely enough for the device_trials.sponsor_type field.
const ACADEMIC_PATTERNS = [
  /universit/i, /hospital/i, /institut/i, /college/i, /\bclinic\b/i,
  /\bNHS\b/i, /foundation trust/i, /medical cent(er|re)/i,
  /health (care|system|service)/i, /\bDr\.?\b/i,
]
function sponsorType(name: string | null): 'academic' | 'commercial' {
  if (!name) return 'commercial'
  return ACADEMIC_PATTERNS.some((p) => p.test(name)) ? 'academic' : 'commercial'
}

async function main() {
  const supabase = createAdminClient()

  console.log(`\n=== Pipeline description backfill ${DRY_RUN ? '(DRY RUN — no writes)' : '(WRITING)'} ===`)
  if (ONLY_MISSING) console.log('Scope: only devices with description IS NULL')

  // Pipeline devices + their clean NCT from device_external_ids.
  // !inner + the id_type filter means only devices that actually have an NCT
  // come back, and the embedded array holds just the nct row(s).
  let q = supabase
    .from('device_master')
    .select('aletia_id, name, intended_use, description, device_external_ids!inner(id_type, id_value)')
    .not('pipeline_stage', 'is', null)
    .eq('device_external_ids.id_type', 'nct')

  if (ONLY_MISSING) q = q.is('description', null)

  const { data: devices, error } = await q
  if (error) {
    console.error('Query failed:', error.message)
    console.error('(If this complains about column "description", apply the migration first.)')
    process.exit(1)
  }
  if (!devices?.length) {
    console.log('No matching pipeline devices.')
    return
  }

  console.log(`Found ${devices.length} pipeline device(s) with an NCT.\n`)

  let updated = 0
  let trialsWritten = 0
  let skipped = 0
  let failed = 0

  for (const d of devices as any[]) {
    const nct: string | undefined = d.device_external_ids?.[0]?.id_value
    if (!nct) {
      console.log(`- ${d.aletia_id}: no NCT in embed, skip`)
      skipped++
      continue
    }

    try {
      const trial = await fetchTrialByNct(nct)
      await sleep(SLEEP_MS)

      if (!trial) {
        console.log(`- ${d.aletia_id} (${nct}): not found on CT.gov, skip`)
        skipped++
        continue
      }

      const description = trial.briefSummary?.trim() || trial.title?.trim() || null
      const newName = d.name ?? trial.deviceName ?? null // never clobber an existing name
      const preview = (description ?? '').slice(0, 70)

      console.log(
        `- ${d.aletia_id} (${nct}): name=${newName ?? '∅'} | desc="${preview}${(description ?? '').length > 70 ? '…' : ''}"`,
      )

      if (DRY_RUN) {
        updated++
        continue
      }

      // 1. upsert the trial row (closes D4 for orphans; refreshes existing)
      const { error: tErr } = await supabase.from('device_trials').upsert(
        {
          aletia_id: d.aletia_id,
          nct_id: trial.nctId,
          trial_registry: 'ct_gov',
          title: trial.title,
          brief_summary: trial.briefSummary,
          sponsor_name: trial.sponsorName,
          sponsor_type: sponsorType(trial.sponsorName),
          status: trial.status,
          phase: trial.phase,
          enrollment: trial.enrollment,
          start_date: trial.startDate,
          completion_date: trial.completionDate,
          jurisdictions: trial.locations,
          conditions_raw: trial.conditions,
          is_device_trial: trial.isDeviceTrial,
          irb_approved: trial.irbApproved,
          source_payload: trial as unknown as Record<string, unknown>,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'aletia_id,nct_id' },
      )
      if (tErr) {
        console.error(`  trial upsert failed: ${tErr.message}`)
        failed++
        continue
      }
      trialsWritten++

      // 2. set description (+ name if it was null)
      const { error: dErr } = await supabase
        .from('device_master')
        .update({ description, name: newName })
        .eq('aletia_id', d.aletia_id)
      if (dErr) {
        console.error(`  device_master update failed: ${dErr.message}`)
        failed++
        continue
      }
      updated++
    } catch (err) {
      console.error(`- ${d.aletia_id} (${nct}): ${err instanceof Error ? err.message : String(err)}`)
      failed++
    }
  }

  console.log(`\n=== Summary ===`)
  console.log(`Devices processed/updated : ${updated}`)
  console.log(`device_trials upserted    : ${trialsWritten}`)
  console.log(`Skipped (no NCT / 404)    : ${skipped}`)
  console.log(`Failed                    : ${failed}`)
  if (DRY_RUN) console.log(`\n(DRY RUN — nothing was written. Re-run without --dry-run to apply.)`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
