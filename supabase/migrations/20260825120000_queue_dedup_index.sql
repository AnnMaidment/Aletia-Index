-- ============================================================================
-- 20260825120000_queue_dedup_index.sql
--
-- Supports the status-aware queue dedup in lib/ingestion.ts (step 2).
--
-- Background. The 4d gate deduped queue rows with
--     .eq('source', …).eq('source_id', …).eq('status', 'pending')
-- so it could not see a row a human had already rejected or marked duplicate.
-- Every subsequent sweep of the same source re-queued the same candidate.
-- The existing unique index does not prevent this either — it is PARTIAL:
--
--     CREATE UNIQUE INDEX idx_review_queue_source_id
--       ON ingestion_review_queue (source, source_id)
--       WHERE (status = 'pending');
--
-- i.e. one pending row per (source, source_id), but any number of terminal
-- rows alongside it. That partial index stays as-is — it is what stops two
-- open rows for the same identifier, and widening it to all statuses would
-- both reject the historical duplicates this bug already created and block
-- legitimate re-review after an inclusion-rule change.
--
-- What changes: the dedup query now orders by created_at DESC across ALL
-- statuses. This index serves that lookup directly.
--
-- Safe to run on a live database: CREATE INDEX IF NOT EXISTS, no data change,
-- no lock of consequence at this table's size (a few thousand rows).
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_review_queue_source_sourceid_created
  ON public.ingestion_review_queue (source, source_id, created_at DESC);

COMMENT ON INDEX public.idx_review_queue_source_sourceid_created IS
  'Status-aware queue dedup (lib/ingestion.ts step 2): latest row per (source, source_id) regardless of status, so a human reject/duplicate decision suppresses re-queueing.';
