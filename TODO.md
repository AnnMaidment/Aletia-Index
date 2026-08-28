# TODO — Aletia Index

**Tier 1.** Open work only. **Completed items are deleted, not checkmarked** — the commit history is the permanent record, and a backlog full of `[done]` lines is a backlog you stop reading.

Bugs do not live here; they live in `KNOWN-BUGS.md`. Current state lives in `STATE.md`.

*First committed 26 August 2026. This file has been referenced as Tier 1 by `DOCS.md` since May and never actually existed in the repo — a gap that let the backlog live in STATE, in handovers, and in memory.*

---

## Now — blocking everything downstream

### 1. Finish the credential rotation
- [ ] Revoke the Resend API key; reissue scoped to **sending access** on the verified domain only, not full access
- [ ] Check Resend → Emails for anything sent that you did not send
- [ ] Generate a new `CRON_SECRET` (Vercel only; it is not in `.env.local`)

### 2. Run batch B's database half
Branch `batch-b-ingest-hardening`. Everything below runs from a terminal with database credentials.

- [ ] `npx tsc --noEmit` on the branch
- [ ] **`npx tsx scripts/validate-ctgov-scope.ts`** — the decision. Replays `lib/ctgovScope.ts` against the 487 labelled rows in `scope-decisions.csv`. **Bar: zero false inclusions at `in_scope_high`.** One is enough to leave `CTGOV_AUTO_CREATE` off permanently. Read the false-exclusion list too — an `out_of_scope` verdict never becomes a queue row, so those losses are silent
- [ ] `npx tsx scripts/probe-mhra-bulk-audit.ts` — read-only; produces the 58-row workbook
- [ ] `npx tsx scripts/probe-breakthrough-aiml.ts --csv` — read-only
- [ ] Apply `20260825120000_queue_dedup_index.sql`
- [ ] `scripts/repair-requeued-decisions.ts` — dry run, then `--apply --expect=N`. **After** the migration and the deployed fix, never before: otherwise the next sweep recreates what you just closed
- [ ] Merge `batch-b-ingest-hardening` to `main`

### 3. Work the MHRA audit workbook
- [ ] Fill `your_decision` across the 58 rows. GMDN membership evidences *software*, never AI — a keep needs positive evidence from somewhere other than the sweep
- [ ] Apply exclusions through a gated script (dry run → snapshot → `--apply --expect N`)

---

## Next

### 4. Queue grind — the EUDAMED window closes November 2026
- [ ] EUDAMED drawer: 186 single-candidate rows, then the 41 multi-candidate ones (22 two-way, 19 three-plus). **Park anything uncertain** — a bad cross-jurisdiction merge is the most damaging error this product makes
- [ ] FDA dedup Band B+C: 80 rows. Judgement calls already identified — Aidoc BriefCase (3 clusters / 29 rows: one platform or many?), SOZO ×4, Clarius AI vs OB AI. Must-rejects: Brainomix ICH/LVO, Second Opinion variants, US System 2300/1300, AmCAD UV/UO/UT, uOmnispace MI/MR/CT, Samsung V8/RS85, RADAC V2/V3/V4
- [ ] HAIR Step 1b — three-way reconcile of the 400-product snapshot against the 4d gate and the EUDAMED crosswalk. Writes to the queue; never mints
- [ ] HAIR Step 1c — allow-list recall measurement for the funder report. State the empty-`texts[]` source floor as part of the number

### 5. Cron wiring
Gated on items 2 and 3. Breadth before cadence.
- [ ] `vercel.json`; new `CRON_SECRET`; re-enable the commented-out auth blocks on `clinical-trials-ingest` and `breakthrough-ingest`
- [ ] FDA, EUDAMED, MHRA monthly; PCCP fortnightly; CT.gov monthly **only if** the classifier validated
- [ ] FDA cron recipe: re-pull the list → ingest → `fda-dedup-detect` dry run as hygiene
- [ ] Verify the O'Leary PCCP CSV URLs before scheduling that one — reported 404ing

### 6. Close the claim-token exposure
- [ ] Move `app/claim/[token]/page.tsx` and `app/api/claim/request/route.ts` to `createAdminClient()` — both are server-side
- [ ] Drop **both** select policies on `claim_requests` (including the baseline `"Public can read claim requests by token"`, which despite its name is a blanket read) and seal the table like the queue

### 7. Fix the two surfaces that promise something they cannot deliver
- [ ] `/request-review` — the submit button raises an `alert()` saying a clinical team will respond within five business days, and discards the input. Either wire it up or stop making the promise
- [ ] `InterestButton` posts to `/api/pre-approval/interested`, which does not exist
- [ ] Fill the placeholder blocks at the top of `app/privacy/page.tsx` and `app/terms/page.tsx` — registered name, registration number, address, Information Officer, contact mailbox — **before** those pages go to `main`

---

## Housekeeping

- [ ] `core.autocrlf` — 72 unchanged files always show as modified; `git status` is near useless until this is set
- [ ] Add `fda_ai_dockets/` to `.gitignore` — 153 MB untracked, two 11.6 MB PDFs inside
- [ ] Delete the stale `app/api/admin/queue/QueueTable.tsx` (pre-rewrite copy, dead)
- [ ] Move the loose rollback JSONs out of the repo root into `archive/rollbacks/` — they are the only undo for the dedup and seed applies, so keep them, but not scattered
- [ ] Rename the Supabase project off "Aletia-Index-Staging" now that it is the only project
- [ ] Take a durable `pg_dump` — the Free plan has no backups
- [ ] Re-establish a staging environment post-cutover
- [ ] Decide `feat/fda-docket-puller` — merge or leave. If merging, fix the attribution regex first (all 277 titles match `Comment from X`; every `organization` field is null)

---

## Deferred — own spec, not now

- **Manufacturer-level dedup** (Module 4) — the GE-DLIR-style under-merges Band A left. Family candidates already spotted: AI-Rad Companion pairs, EchoPAC ×3, syngo.CT Lung CAD ×3, icobrain, Quantib Brain, UNiD ×2, BoneMRI ×2, InferRead ×2, LiverMultiScan ×3
- **Imaging-role / modality axis** alongside clinical specialty. Candidate list is the `modality_only` rows in the debar report. Decided 13 July: clinical specialty and imaging modality are separate axes, and "general-purpose imaging" is not a specialty
- **`create_device_atomic` default** — `COALESCE(ai_ml_integral, true)` makes "unknown" unrepresentable. Changing it touches a load-bearing function; decide deliberately
- **A4** — `pipeline_stage` → `discovery_stage` rename, collapsing to two values. Resolves BUG-003
- **A3** — regulatory status per jurisdiction
- **B3** — CT.gov status-code normalisation (BUG-006)
- **EUDAMED re-ingest** — carry search-row `riskClass.code` and detail fields into `raw_data`; re-confirm the Basic-UDI deferral
- **EUDAMED NB / certificate / legislation backfill** — not retrievable; monthly re-probe
- **Widen the EUDAMED EMDN allow-list** to the full 66 and run live discovery beyond the seed
- **FDA supplementary sweep** — code shipped, never run. **FDA description sourcing** — Indications for Use into `device_master.description`; decide the source first
- **Tombstone redirects** — `/device/<absorbed>` currently 404s; consider redirecting to the `merged_into` survivor
- **Startup portal** (`STARTUP-PORTAL-SPEC.md`); **RP/NB directory** (`RP-INTEGRATION-SPEC.md`); **Evidence Gate / Divergence Triple**; **EUDAMED vigilance module** (~2027)
- **Benign dedup under-merges** — GE DLIR ×2, EPIQ/Affiniti ×3, Contour Protégé/Protege, SKOUT ×2, Voluson Expert ordering

---

## Session discipline

A session that ships work is not finished until `STATE.md`, `TODO.md` and `KNOWN-BUGS.md` reflect it — **in the same session.** Deferring the reconciliation is what produced the May 2026 drift, and again the three-month gap that left the README claiming 5,100 devices and RLS as future work.
