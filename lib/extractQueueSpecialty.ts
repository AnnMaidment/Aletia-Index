/**
 * lib/extractQueueSpecialty.ts
 *
 * Backfill specialty_inferred + specialty_confidence + specialty_signals
 * on ingestion_review_queue entries whose raw_data contains CT.gov trial data.
 *
 * This is idempotent — safe to re-run. Entries already populated are skipped
 * unless { force: true } is passed.
 *
 * Used by:
 *   - scripts/extract-queue-specialty.ts (one-off backfill)
 *   - app/api/admin/extract-specialty/route.ts (re-run from admin UI)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { inferSpecialty, SpecialtyConfidence } from './specialtyTaxonomy';

export interface ExtractResult {
  scanned: number;
  updated: number;
  skipped_already_populated: number;
  skipped_no_raw_data: number;
  no_specialty_found: number;
  by_specialty: Record<string, number>;
  by_confidence: Record<SpecialtyConfidence, number>;
  errors: { queue_id: string; message: string }[];
}

export interface ExtractOptions {
  /** If true, overwrite entries that already have specialty_inferred set. */
  force?: boolean;
  /** Limit number of rows processed (useful for dry runs). */
  limit?: number;
  /** If true, compute changes but do not write them back. */
  dryRun?: boolean;
  /** Only process entries with this status. Default: 'pending'. */
  status?: 'pending' | 'approved' | 'rejected' | 'duplicate' | 'all';
  /** Only process entries from this source. */
  source?: string;
}

/**
 * Run the extraction.
 *
 * Supply a Supabase client constructed with the SERVICE ROLE key.
 * The ingestion_review_queue has no public RLS policies beyond the default,
 * but we need service role regardless to bypass any future policies.
 */
export async function extractQueueSpecialty(
  supabase: SupabaseClient,
  opts: ExtractOptions = {}
): Promise<ExtractResult> {
  const {
    force = false,
    limit,
    dryRun = false,
    status = 'pending',
    source,
  } = opts;

  const result: ExtractResult = {
    scanned: 0,
    updated: 0,
    skipped_already_populated: 0,
    skipped_no_raw_data: 0,
    no_specialty_found: 0,
    by_specialty: {},
    by_confidence: { high: 0, medium: 0, low: 0, none: 0 },
    errors: [],
  };

  // Fetch in pages of 500 — the queue is ~487 right now but this is future-proof.
  const PAGE = 500;
  let offset = 0;

  while (true) {
    let query = supabase
      .from('ingestion_review_queue')
      .select('queue_id, raw_data, specialty_inferred')
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE - 1);

    if (status !== 'all') query = query.eq('status', status);
    if (source) query = query.eq('source', source);

    const { data, error } = await query;
    if (error) throw new Error(`Supabase fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const row of data) {
      if (limit && result.scanned >= limit) break;
      result.scanned++;

      // Skip if already populated (unless forcing)
      if (!force && row.specialty_inferred) {
        result.skipped_already_populated++;
        continue;
      }

      if (!row.raw_data) {
        result.skipped_no_raw_data++;
        continue;
      }

      const match = inferSpecialty(row.raw_data);
      result.by_confidence[match.confidence]++;

      if (!match.specialty) {
        result.no_specialty_found++;
        // Still write 'none' confidence so we know we tried
        if (!dryRun) {
          const { error: updateErr } = await supabase
            .from('ingestion_review_queue')
            .update({
              specialty_inferred: null,
              specialty_confidence: 'none',
              specialty_signals: { matched_patterns: [], source_fields: [] },
            })
            .eq('queue_id', row.queue_id);
          if (updateErr) {
            result.errors.push({ queue_id: row.queue_id, message: updateErr.message });
          }
        }
        continue;
      }

      result.by_specialty[match.specialty] = (result.by_specialty[match.specialty] ?? 0) + 1;

      if (!dryRun) {
        const { error: updateErr } = await supabase
          .from('ingestion_review_queue')
          .update({
            specialty_inferred: match.specialty,
            specialty_confidence: match.confidence,
            specialty_signals: match.signals,
          })
          .eq('queue_id', row.queue_id);

        if (updateErr) {
          result.errors.push({ queue_id: row.queue_id, message: updateErr.message });
        } else {
          result.updated++;
        }
      } else {
        result.updated++;  // count as "would-update"
      }
    }

    if (data.length < PAGE) break;
    if (limit && result.scanned >= limit) break;
    offset += PAGE;
  }

  return result;
}

/**
 * Convenience factory. Pulls env vars following the same convention
 * used by lib/supabase-admin.ts in the main repo.
 */
export function getAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment'
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
