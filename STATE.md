# STATE — Aletia Index

**Rewritten:** 26 August 2026 (session: credential rotation, row-level security, ingest-hardening batch B)
**Rule:** rewritten fresh at each session end. Code is ground truth; this file is orientation.

---

## Where things stand

Two security holes were found and closed this session. Both were older than any feature work in the backlog, and one of them did not require a leak to exploit.

The **ingest-hardening batch (B a–e)** is code-complete and pushed, but sits on `batch-b-ingest-hardening` — **not merged to `main`**, and none of its database work has run. That work is what gates all cron wiring, so nothing downstream of it has moved.

Live Supabase project remains **Aletia-Index-Staging** (`wwianscisjuuzbljprrb`). The stale **Aletia-Index** project has now been deleted.

Public index: roughly **1,270 devices** (~1,175 FDA-attached, 58 MHRA, small EU set). Queue: **307 rows** — 227 `eudamed_sync` (186 single-candidate, 41 multi) and 80 `fda_dedup`.

---

## The security work (done, verified)

### Credential leak

`aletia-index.zip` was committed to the public repo on 23 April (`7dd5fc4`) with a `.env.local` inside it: service-role key, anon key, Resend key, openFDA key, `SYNC_SECRET`, and the staging and production database passwords in comment lines. Four months exposed on a public default branch.

Two things about the removal are worth recording because both nearly went wrong:

- The removal commit initially landed on `feat/fda-docket-puller` only. `origin/main` continued serving the zip until `239ded8`. **A fix pushed to a feature branch does not remove a file from the default branch** — check `origin/main` explicitly.
- `.claude/settings.local.json` was tracked and unignored, and the working copy had grown a Claude Code permission rule containing a live `REGULATIONS_GOV_API_KEY`. It was one `git add .` from being the second credential published from this repo. Now untracked and ignored, along with `*.zip` and `*.tar.gz`.

Rotation status: Supabase keys replaced with the new publishable/secret pair and the **legacy keys deactivated** — Supabase no longer permits rotating legacy anon/service_role in place, so migration is the only route. Database passwords reset. Stale project deleted. New `SYNC_SECRET`. New openFDA key. GitHub secret scanning and push protection enabled.

**Still outstanding:** the Resend key (revoke and reissue scoped to sending only, and check the Emails tab for anything unsent by you), and `CRON_SECRET`.

### Row-level security — the larger hole

An audit found **12 of 15 tables with RLS off and `anon` holding SELECT, INSERT, UPDATE and DELETE.** Only `admin_users`, `audit_log` and `ingest_runs` were protected.

The publishable key ships inside the site's JavaScript by design. It is safe *only* if RLS protects the tables. It did not. For the life of the project, anyone who opened aletia-index.com could have written to or deleted from `device_master`, `device_external_ids` or the review queue. No leak was required — only that someone looked.

Fixed in `20260826120000_enable_rls.sql`, applied and verified against the live site: index renders 1,267 records, sitemap generates, `/device/ALT-006194` renders manufacturer, registrations and identifiers.

**The trap worth remembering:** `/device/[id]` reads five tables *only* as PostgREST embedded selects. An embed needs read access on the embedded table, and a missing policy blanks that section of the page rather than raising an error. Enabling RLS without checking a populated device page will look fine and be broken.

Row counts checked against expectation afterwards; nothing anomalous.

---

## Batch B — ingest hardening (code done, database not run)

Branch `batch-b-ingest-hardening`, five commits off the security fix. Typecheck and lint clean; 62 fixtures green (18 new PCCP, 15 new CT.gov scope, 29 pre-existing specialty unchanged).

**B(a) — status-aware queue dedup.** The 4d gate filtered `.eq('status','pending')`, so a rejected or duplicated row was invisible to the next sweep; the gate fell through and re-queued the same candidate on every run, forever. The database did not backstop it either: the unique index is partial, `WHERE status = 'pending'`, so a terminal row and a fresh pending row coexist. Dedup now reads the latest row whatever its status; new `skipped_prior_decision` action; `reconsiderPriorDecisions` escape hatch defaulted off. Ships with an index migration and `scripts/repair-requeued-decisions.ts` for the ghost rows already created.

**B(b) — CT.gov scope classifier.** `lib/ctgovScope.ts` replaces the flat keyword filter that put 150 out-of-scope trials in the queue. Three tiers with reason codes. Bare `neural network`, `deep learning`, `software` and `algorithm` are all out of the positive lexicon — vocabulary, not function. The known-AI-sponsor bypass is demoted: it now rescues only rows where the classifier found nothing, and only as far as the queue. **Auto-create ships OFF** behind `CTGOV_AUTO_CREATE`.

**B(c) — MHRA posture, and BUG-010 closed.** `autoCreate` was true, which is how 58 MHRA devices entered unreviewed. The GMDN term list is a *software* filter — `ophthalmology pacs software` is on it — so membership evidences software, never AI. Now queues; `ai_ml_integral` passed as explicit `false`, because `create_device_atomic` does `COALESCE(..., true)` and would otherwise assert the very claim being retracted. BUG-010's MHRA half closed: an active PARD registration graduates the device out of pipeline.

**B(d) — BUG-013.** PMA supplements. The defective shape check existed in **four** places, not one, with two different failure modes: `pccpIngest` skipped the row (~40 lost), while two arms of the admin accept route fell through to a `fda_k_number` **default** and would have written a supplement string under the wrong `id_type` — a mistyped canonical identifier the gate could never match again. Consolidated into `lib/fdaSubmissionId.ts`, classifying on the base number.

**B(e)** — read-only breakthrough probe. Route stays parked.

---

## What was learned (do not relearn)

1. **A fix on a feature branch is not a fix on `main`.** Verify against `origin/main`, not your working tree.
2. **Legacy Supabase keys cannot be rotated.** Creating new keys does not revoke old ones; deactivating the legacy pair is the step that closes the hole, and it is separate.
3. **RLS is not a feature, it is the thing that makes the publishable key safe.** Any new table needs its policy in the same migration.
4. **Vocabulary is not function.** BUG-012 (FDA keywords), the MHRA GMDN list and the CT.gov `neural network` problem are one failure repeating through three channels. Check every new evidence channel for it.
5. **`create_device_atomic` defaults `ai_ml_integral` to true** when the field is omitted or null. "Unknown" is currently unrepresentable for that column.
6. **The repo's line endings are unset.** 72 files always show as modified; `git diff -w` is the honest view. Until `core.autocrlf` is set, `git status` is close to useless here.

---

## Next priorities

1. **Finish the rotation** — Resend key, `CRON_SECRET`.
2. **Run batch B's database half**, in order: `validate-ctgov-scope.ts` (the measurement that decides whether auto-create may ever turn on — the bar is zero false inclusions at `in_scope_high` against the 487 labelled rows in `scope-decisions.csv`); `probe-mhra-bulk-audit.ts` (58-row workbook); `probe-breakthrough-aiml.ts`; then the queue-dedup migration and `repair-requeued-decisions.ts`.
3. **Merge batch B to `main`** once the above passes.
4. **Work the MHRA audit workbook** and apply exclusions via a gated script.
5. **Queue grind** — EUDAMED drawer (186 single, then 41 multi), FDA Band B+C (80 rows), then HAIR Step 1b and the Step 1c recall measurement. **The EUDAMED legacy-backfill window closes November 2026.**
6. **Cron wiring** — `vercel.json`, new `CRON_SECRET`, re-enable the commented-out auth on the CT.gov and breakthrough routes. FDA/EUDAMED/MHRA monthly, PCCP fortnightly, CT.gov monthly once the classifier is validated.
7. **Seal `claim_requests`** — public select exposes every claim token, and a token is what proves entitlement to claim a device. Both the reader and the writer are server-side, so both can move to the admin client and the table can be sealed like the queue.

---

## Also open

- **`intended_use = deviceName` on the admin accept path** — the same pattern BUG-012 removed from `buildFdaDeviceSeed`, still alive in `app/api/admin/queue/accept/route.ts`.
- **Two non-functional public surfaces.** The `/request-review` form has no submit handler — its button raises an `alert()` promising a response within five business days and discards the input. `InterestButton` posts to `/api/pre-approval/interested`, which does not exist. Both promise the user something that cannot happen.
- **O'Leary PCCP URLs** reported 404ing; unverified.
- **`app/api/admin/queue/QueueTable.tsx`** — stale pre-rewrite copy, dead, still present.
- **`fda_ai_dockets/`** — 153 MB untracked and unignored, with two 11.6 MB PDFs.
- **`feat/fda-docket-puller`** — the regulations.gov puller, unmerged. Thesis work rather than index work. Its 277-comment corpus has null attribution on every row, recoverable from the title (`Comment from X`).
- **EUDAMED NB/certificate backfill** — still not retrievable; monthly re-probe.
- Manufacturer-level dedup; the imaging-role axis; the RP/NB directory; the startup portal; the vigilance module (~2027).

---

## Invariants (standing)

- `aletia_id` stability is load-bearing. **No wipe-and-reingest** — fix filters at source and re-run idempotently through the 4d gate.
- Public reads filter **both** `excluded = false` **and** `merged_into IS NULL`.
- Provenance registers never blend. Null is the honest default.
- Dry run → snapshot → `--apply --expect N` for every bulk write.
- False positives are worse than duplicates; ambiguity goes to the queue, never to an auto-write.
- A device is in the index only if it is AI/ML **by the relevant regulator's own classification.**
