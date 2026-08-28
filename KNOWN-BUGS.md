# Aletia Index — Known Bugs

**Last updated: 26 August 2026.** BUG-010 and BUG-013 resolved on `batch-b-ingest-hardening`; SEC-001 and SEC-002 added and resolved; SEC-003 opened.

**Convention:** a bug is `[resolved]` only when the fix is committed to `main` and verified in production. Anything living on an unmerged branch is recorded as *fix written, not merged* and stays in the open section.

> File:line references drift. Re-grep before relying on any of them.

---

## Open

### SEC-003 — public SELECT on `claim_requests` exposes every claim token
`claim_requests` carries two permissive select policies for `anon`: the one added on 26 August, and the baseline `"Public can read claim requests by token"` which, despite its name, is a blanket `USING (true)`. A claim token is what proves entitlement to take control of a manufacturer listing, so publishing the tokens undermines the claim flow.

Predates the RLS migration — enabling RLS preserved the existing behaviour rather than creating the problem.

**Fix:** both consumers are server-side — `app/claim/[token]/page.tsx` (a server component) and `app/api/claim/request/route.ts` (a route handler). Move both to `createAdminClient()`, drop **both** select policies, and let the table be sealed like `ingestion_review_queue`. Code change, not a schema one.

### BUG-003 — `pipeline_stage` vocabulary split across code paths
Interpreted and written inconsistently between the ingest paths and the display layer. **Resolves cleanly under A4** (the `pipeline_stage` → `discovery_stage` rename, which collapses to two values). Until then, treat the values with care across the FDA / MHRA / EUDAMED sync paths versus the admin accept route.

### BUG-006 — CT.gov status codes collapsed rather than normalised
`WITHDRAWN`, `SUSPENDED`, `not_yet_recruiting` and others are not all mapped distinctly. Revisit now that real trial data flows into `device_trials`. Tracked as TODO B3.

### BUG-007 — cosmetic, low priority
*(Detail never recovered — the original entry was lost when this file was reconstructed on 25 May 2026, and the surviving reference said only "cosmetic and low priority".)* If it is still reproducible, re-describe it; if nobody can find it, delete this entry rather than carrying it forever.

### BUG-017 — `/request-review` collects nothing and says otherwise
The submit button's handler is `onClick={() => alert('Thanks! Our clinical team will be in touch within 5 business days.')}`. There is no form submission, no API route, and no persistence. Every enquiry made through that page has been discarded, while the user was told to expect a reply within five business days.

Worse than a dead form: it is a promise the site cannot keep. Either wire it to a route and a table, or replace the button with an email address.

### BUG-018 — `InterestButton` posts to a route that does not exist
`app/device/[id]/InterestButton.tsx:62` posts to `/api/pre-approval/interested`. There is no such route. Noted in the June 2026 README as "frontend-only; backend pending" and never built.

---

## Fix written, not yet merged

These are fixed on `batch-b-ingest-hardening`. They move to Resolved when that branch reaches `main` and the effect is verified in production.

### BUG-010 — graduation rule not applied on the MHRA sync path
First regulatory approval in any jurisdiction should set `pipeline_stage = null`. FDA resolved 5 June, EUDAMED 9 June; the MHRA half stayed open.

**Fix (25 Aug):** `lib/mhraSync.ts` sets `pipeline_stage = null` on the `updated_existing` path, mirroring FDA and EUDAMED. An active PARD registration is a regulatory approval. `ai_ml_integral` is untouched, so a device confirmed AI/ML elsewhere is not downgraded by an MHRA hit. This was the last open half.

### BUG-013 — PMA supplement submissions dropped, and worse
`classifySubmissionNumber` matched PMA as `^P[0-9]+$`, which does not match a supplement such as `P190016/S007`.

The bug was logged against `lib/pccpIngest.ts`, where roughly 40 authorized-PCCP supplements were skipped on the 10 June run. **The same defective check turned out to exist in four places**, and the other failure mode is worse: in the `legacy_queue` and `oleary_csv` arms of `app/api/admin/queue/accept/route.ts`, the PMA branch missed and the code fell through to a `fda_k_number` **default**. Accepting such a row would have written a supplement string into `device_external_ids` under the wrong `id_type` — a mistyped canonical identifier that the 4d gate could never match again. Silent, and permanent.

**Fix (25 Aug):** consolidated into `lib/fdaSubmissionId.ts`, one home for four callers. Classification happens on the **base** identifier, since `device_external_ids` holds `P190016` and never the supplement; the full string is kept for audit. The slashless branch (whitespace is stripped before it runs) is pinned to six base digits so it cannot mis-split `K250007S001`. 18 fixtures, including every over-strip guard.

Also made the PCCP ingest deterministic where several supplements resolve to one device: earliest authorization wins, decided before the loop. Previously whichever supplement the CSV listed last won, so the stored date could flip between runs with no data change.

### BUG-019 — queue dedup ignored human decisions
`lib/ingestion.ts` step 2 filtered `.eq('status','pending')`, so a rejected or duplicate row was invisible to the next sweep. The gate fell through to step 3 and inserted a fresh pending row: the same rejected candidate returned on every run, forever.

The database did not backstop it either — the unique index is **partial**, `WHERE status = 'pending'`, so a terminal row and a new pending row coexist happily.

**Fix (25 Aug):** dedup reads the latest queue row for `(source, source_id)` whatever its status. New `skipped_prior_decision` action, deliberately distinct from `already_queued` so cron reports show suppressed rows rather than hiding them. An `approved` sibling additionally logs an anomaly, since an approved row should have produced an identifier that step 1 would have matched. `reconsiderPriorDecisions` escape hatch, defaulted off.

---

## Resolved

### SEC-002 — every table in the public schema was writable by anyone
**The most serious defect this project has had.** An audit on 26 August found 12 of 15 tables with RLS off and `anon` holding SELECT, INSERT, UPDATE and DELETE. Only `admin_users`, `audit_log` and `ingest_runs` were protected.

The publishable key ships inside the site's JavaScript by design; it is safe only because RLS protects the tables. It did not. For the life of the project, anyone who opened aletia-index.com could have written to or deleted from `device_master`, `device_external_ids` or the review queue. **No leak was required** — only that someone looked. Larger in scope than SEC-001, and open for longer.

**Status (26 Aug): Resolved.** `20260826120000_enable_rls.sql`. Eight publicly read tables get a permissive select policy; `ingestion_review_queue`, `ingestion_anomalies` and `specialty_taxonomy` get RLS with no policies. Verified live: index renders 1,267 records, sitemap generates, a device page renders manufacturer, registrations and identifiers. Row counts checked; nothing anomalous.

**Not a bug, but the trap that hides here:** `/device/[id]` reads five tables only as PostgREST embedded selects. An embed needs read access on the embedded table, so a missing policy blanks that section of the page instead of erroring. Enabling RLS and checking only that the site loads will look fine and be wrong.

### SEC-001 — `.env.local` published in a committed archive
`aletia-index.zip` was committed on 23 April (`7dd5fc4`) with a `.env.local` inside it: `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `RESEND_API_KEY`, `OPENFDA_API_KEY`, `SYNC_SECRET`, and the staging and production database passwords in comment lines. Four months on a public default branch.

**Status (26 Aug): Resolved.** File removed at `239ded8`; Supabase keys migrated to the publishable/secret pair and the legacy keys deactivated; database passwords reset; stale project deleted; new `SYNC_SECRET` and openFDA key; secret scanning and push protection enabled. Resend key and `CRON_SECRET` remain outstanding and are tracked in `TODO.md` rather than here.

Two near-misses worth keeping on the record:

- The removal commit initially landed on a feature branch only. `origin/main` continued serving the zip until it was pushed there directly. **A fix on a feature branch does not remove a file from the default branch.**
- `.claude/settings.local.json` was tracked and unignored, and the working copy had grown a permission rule containing a live `REGULATIONS_GOV_API_KEY` — one `git add .` from being the second credential published from this repo. Now untracked and ignored, with `*.zip` and `*.tar.gz`.

The blob remains reachable in git history. Rotation, not deletion, is what closed this.

### BUG-014 / BUG-015 / BUG-016 — EUDAMED localised-text envelope
One root cause, one fix. The live `udiDiData` detail returns several name-like fields as `{ textByDefaultLanguage, texts[] }` rather than strings, so `additionalDescription` stringified to `"[object Object]"` (killing a keyword guard), `tradeName` resolved null (Dice-zero in the 4d gate), and `emdn_description` resolved null.

**Status (19 Jun): Resolved** by a shared `extractLocalisedText()` in `lib/eudamed.ts`. Verified live; residual null names dropped 4/10 → 3/10 on the sample. The remaining nulls have genuinely empty `texts[]` in EUDAMED — a source limitation, not a defect.

### BUG-012 — FDA discovery proxy under- and over-captured
A hand-maintained product-code and keyword proxy failed both ways: 510(k) endpoint only, no pagination, De Novo and PMA never queried, and `ai_ml_integral` set unconditionally true so broad imaging codes' non-AI devices read as AI. Roughly 5,017 "FDA" rows against ~1,430 on the FDA's own list.

**Status (5 Jun): Resolved.** The FDA published list is the authoritative seed (`lib/fdaList.ts`); the sweep is paginated across all three pathways; `ai_ml_integral` equals list membership; off-list over-capture pruned via `excluded`.

**This is the canonical instance of the project's recurring failure**: vocabulary mistaken for function. It has since reappeared through the MHRA GMDN list and the CT.gov `neural network` problem. Check every new evidence channel for it.

### BUG-011 — admin Mark-duplicate 400s
Snake/camel contract mismatch and no target device. **Status (10 Jun): Resolved** — contract aligned to snake_case on both sides; the drawer now collects a required target.

### BUG-009 — home search missed MHRA-prefixed queries
MHRA IDs are stored raw, so a search for the prefixed form missed. **Status: Resolved** — `normaliseIdentifierInput` strips the prefix before the secondary-ID lookup.

### BUG-008 — accept-route atomicity gap
A device row could commit while the identifier insert failed, leaving an orphan. **Status: Resolved** by the `create_device_atomic` RPC.

### BUG-001 / BUG-002 / BUG-005 — closed together by the A2b ingest rewrite
Wrong field names in the pre-approval profile read/write; `device_name` discarded on create; inconsistent identifier generation. All three fell out of the A2b rewrite: trial data moved to `device_trials`, the accept route writes `name`, and identity became the DB-allocated `aletia_id`.

### BUG-004 — five missing `pre_approval_profile` rows
**Status (3 Jun): Resolved** by `scripts/backfill-pipeline-descriptions.ts`.

---

## Not bugs — do not re-log

- **EUDAMED registrations with `regulatory_body` / `clearance_type` = `'pending'`** — a correct reflection of source state; the NB module is unpopulated. Tracked as a backfill with a monthly re-probe.
- **EUDAMED devices with empty `tradeName.texts[]`** — no retrievable name on the public surface. They Dice-zero and queue without a candidate. A source-side floor on EU crosswalk recall.
- **The HAIR sitemap serving different URL counts within an hour** — source behaviour. `extract-hair.ts` falls back to listing-page pagination.
- **`anon` still showing INSERT / UPDATE / DELETE grants in `pg_class`** — inert once RLS is on. An operation with no matching policy is denied whatever the grant says. A blanket `REVOKE` was considered and rejected: it would break the `claim_requests` insert for no additional protection.
- **72 files permanently showing as modified** — `core.autocrlf` is unset. `git diff -w` is the honest view. Annoying, not a defect; fix is in TODO housekeeping.
