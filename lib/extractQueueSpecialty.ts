/**
 * lib/extractQueueSpecialty.ts
 *
 * Backfill specialty_inferred + specialty_confidence + specialty_signals
 * on ingestion_review_queue entries, by normalising each row's raw_data into a
 * SpecialtyEvidence bundle (lib/specialtyEvidence.ts) and running the
 * deterministic taxonomy matcher (lib/specialtyTaxonomy.ts).
 *
 * This is idempotent — safe to re-run. Entries already populated are skipped
 * unless { force: true } is passed. Rows that are attempted but unclassified are
 * written with specialty_confidence = 'none' so a null specialty_confidence is a
 * reliable signal that the row was never processed.
 *
 * fda_dedup rows are SKIPPED: they are cluster-review objects (band, members,
 * proposed_survivor), not device records. Classifying them as devices would be
 * meaningless. Cluster specialty-agreement is a separate, future concern.
 *
 * Used by:
 *   - scripts/extract-queue-specialty.ts             (one-off backfill)
 *   - app/api/admin/queue/extract-specialty/route.ts (re-run from admin UI)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { inferSpecialty, SpecialtyConfidence } from './specialtyTaxonomy';
import { buildSpecialtyEvidence } from './specialtyEvidence';

/** Sources that are cluster objects, not device records — never classified. */
const SKIP_SOURCES = new Set<string>(['fda_dedup']);

export interface ExtractResult {
  scanned: number;
  updated: number;
  skipped_already_populated: number;
  skipped_no_raw_data: number;
  skipped_cluster_source: number;
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
    skipped_cluster_source: 0,
    no_specialty_found: 0,
    by_specialty: {},
    by_confidence: { high: 0, medium: 0, low: 0, none: 0 },
    errors: [],
  };

  // Fetch in pages of 500 — the queue is ~800 rows right now but this is future-proof.
  const PAGE = 500;
  let offset = 0;

  while (true) {
    let query = supabase
      .from('ingestion_review_queue')
      .select('queue_id, raw_data, specialty_inferred, source')
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

      // Skip cluster-review sources (fda_dedup) — not device records.
      if (SKIP_SOURCES.has(row.source)) {
        result.skipped_cluster_source++;
        continue;
      }

      // Skip if already populated (unless forcing).
      if (!force && row.specialty_inferred) {
        result.skipped_already_populated++;
        continue;
      }

      if (!row.raw_data) {
        result.skipped_no_raw_data++;
        continue;
      }

      const evidence = buildSpecialtyEvidence(row.raw_data, row.source);
      const match = inferSpecialty(evidence);
      result.by_confidence[match.confidence]++;

      if (!match.specialty) {
        result.no_specialty_found++;
        // Still write 'none' confidence so we know we tried.
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
