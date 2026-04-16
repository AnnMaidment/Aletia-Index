/**
 * scripts/extract-queue-specialty.ts
 *
 * One-off script to backfill specialty on the ingestion_review_queue.
 *
 * Run locally (from repo root):
 *   npx tsx scripts/extract-queue-specialty.ts --dry-run
 *   npx tsx scripts/extract-queue-specialty.ts            # actually write
 *   npx tsx scripts/extract-queue-specialty.ts --force    # overwrite existing
 *   npx tsx scripts/extract-queue-specialty.ts --status=all --source=clinical_trials
 *
 * Requires .env.local to contain:
 *   NEXT_PUBLIC_SUPABASE_URL=...
 *   SUPABASE_SERVICE_ROLE_KEY=...
 *
 * Load env with `dotenv/config` import (works with tsx).
 */

import 'dotenv/config';
import { extractQueueSpecialty, getAdminClient, ExtractOptions } from '../lib/extractQueueSpecialty';

function parseArgs(argv: string[]): ExtractOptions & { help?: boolean } {
  const opts: ExtractOptions & { help?: boolean } = {};
  for (const a of argv.slice(2)) {
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a.startsWith('--limit=')) opts.limit = parseInt(a.split('=')[1], 10);
    else if (a.startsWith('--status=')) opts.status = a.split('=')[1] as ExtractOptions['status'];
    else if (a.startsWith('--source=')) opts.source = a.split('=')[1];
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    console.log(`
Aletia — specialty backfill for ingestion_review_queue

Usage:
  npx tsx scripts/extract-queue-specialty.ts [flags]

Flags:
  --dry-run              Compute changes, do not write
  --force                Overwrite rows that already have specialty_inferred
  --limit=N              Stop after N rows
  --status=pending|all   Which queue status to process (default: pending)
  --source=<name>        Only process entries with this source
  -h, --help             Show this help
`);
    process.exit(0);
  }

  console.log('Aletia — extracting specialty from ingestion_review_queue');
  console.log(`  dry-run:  ${!!opts.dryRun}`);
  console.log(`  force:    ${!!opts.force}`);
  console.log(`  status:   ${opts.status ?? 'pending'}`);
  console.log(`  source:   ${opts.source ?? '(all)'}`);
  console.log(`  limit:    ${opts.limit ?? '(none)'}`);
  console.log('');

  const supabase = getAdminClient();
  const started = Date.now();
  const result = await extractQueueSpecialty(supabase, opts);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  console.log('Done in', elapsed, 's');
  console.log('  scanned:                     ', result.scanned);
  console.log('  updated:                     ', result.updated);
  console.log('  skipped (already populated): ', result.skipped_already_populated);
  console.log('  skipped (no raw_data):       ', result.skipped_no_raw_data);
  console.log('  no specialty matched:        ', result.no_specialty_found);
  console.log('');
  console.log('  by confidence:');
  for (const [k, v] of Object.entries(result.by_confidence)) {
    console.log(`    ${k.padEnd(7)} ${v}`);
  }
  console.log('');
  console.log('  top specialties:');
  const top = Object.entries(result.by_specialty).sort((a, b) => b[1] - a[1]);
  for (const [name, n] of top) {
    console.log(`    ${String(n).padStart(4)}  ${name}`);
  }

  if (result.errors.length) {
    console.log('');
    console.log(`  ${result.errors.length} errors (first 10 shown):`);
    for (const e of result.errors.slice(0, 10)) {
      console.log(`    ${e.queue_id}  ${e.message}`);
    }
  }

  process.exit(result.errors.length ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
