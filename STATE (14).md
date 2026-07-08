# Aletia Index — State of the World

**Last rewritten: 8 July 2026.** This rewrite folds in the **specialty pipeline + CT.gov in-scope audit** session onto the prior STATE (19 Jun). Commit lineage: `706054b` (11 Jun, FDA dedup + `merged_into`) → `9bc175e` (17 Jun, HAIR Step 1a) → `e7a4cea` (19 Jun, eudamed.ts bugs) → **`<PENDING>` (8 Jul, specialty pipeline + scope audit — NOT YET COMMITTED, see below)**. Rewritten fresh each session, not appended.

> **⚠ Continuity flag (read first):** this session's *code* (specialty extractor refactor + scope-audit tooling) is **applied locally and verified, but NOT committed to `main`.** GitHub `main` still has the pre-refactor extractor (`inferSpecialty(rawData)`, no `lib/specialtyEvidence.ts`, stale extract-specialty route). The *data* changes (150 queue rejects, 9 device excludes, 284 queue classifications) **are** live in Supabase. First action next session: commit the code (see "Next priority" §0). This is now the **second** local-only-code item alongside `recompute-eudamed-candidates.ts`.

## How to use this file

1. Read this first when starting a session — it gives you the map.
2. **Code is ground truth.** When STATE, TODO, README, or handovers disagree with committed code, code wins. If you see a claim in a doc, grep for it before relying on it.
3. **"Done" means committed to `main` and verified in production.** Discussion, intent, merged-to-a-branch, or "applied locally" do not count as done. *(This session is a live example: the specialty pipeline works and the DB is mutated, but the code is not on `main`, so it is not done.)*
4. Handovers are archival — they live in `archive/`. Do not load them unless this file points you to a specific one.

## Session-start ritual

1. Read this file.
2. Read `TODO.md` for current backlog.
3. Read `KNOWN-BUGS.md` to see what's broken.
4. Grep code for anything the docs are unclear about (`api.github.com` is rate-limited on shared egress — use the tarball / `commits/main.atom`).
5. The README is architecture/onboarding reference — dip into it for specific lookups, don't load wholesale.

---

## The big changes since the last rewrite

### This session (8 July 2026) — specialty pipeline fixed + CT.gov in-scope audit (`<PENDING commit>`)

Started as "the specialty field is nearly empty," became two findings and a scope decision.

**Diagnosis.** The specialty field is bare for two independent reasons on two surfaces. (a) The **public site** renders `device_master.specialty_link`; a live query returned **1,271 of 1,276 shown devices null** (99.6%) — the FDA backbone was bulk-seeded, never through the accept drawer, so the seed path never set specialty. (b) The **ingestion queue** had `specialty_inferred = null` everywhere (not `'none'`) — proof the extractor had **never run**, not that it ran and missed.

**Abandoned: `device_master` FDA-panel backfill.** The tempting fix (product_code → FDA advisory-panel → specialty) was rejected on data-science grounds: the FDA panel is a regulatory *review lane*, not a clinical specialty (imaging AI is "Radiology" regardless of clinical domain — construct-invalid), no validation at n≈1,276, and `high` confidence would mislabel mapping-fidelity as correctness. **Decision: leave `device_master.specialty_link` null (honest "not yet classified") rather than write confident-but-wrong labels.** No migration, no write.

**Shipped (local-only): queue extractor refactor.** New `lib/specialtyEvidence.ts` normalises every source's `raw_data` shape into one `SpecialtyEvidence` bundle; `lib/specialtyTaxonomy.ts` now consumes the bundle (was reading raw source keys and *missing* `deviceName`/`title` — which had been actively **misclassifying** colonoscopy trials into Oncology, not merely losing recall). Added OSA/sleep → Pulmonology; stroke/ICH/aneurysm → Neurology; valve/murmur → Cardiology; cytopathology/whole-slide-scan → Pathology. `fda_dedup` cluster rows are skipped (not device records). The `extract-specialty` route was a copy of the *superseded pre-atomic* accept route — replaced with a real one that calls `extractQueueSpecialty`. Evidence bundle **carries** `panel`/`productCode` for provenance but the deterministic matcher **ignores** them (same construct-validity reason as the abandoned backfill). Verified offline: `tsc` clean, fixture tests **19/19** (`scripts/test-specialty-inference.ts`, framework-free, tsx-run). Env fix: `scripts/extract-queue-specialty.ts` now loads `.env.local` explicitly (was bare `dotenv/config` → `.env`).

**CT.gov in-scope audit (the detour that unblocked specialty).** The queue was polluted: the CT.gov ingest filter (`isAIMLTrial`, and the fetch query `'neural network clinical'`) matches the keyword **"neural network"**, which in neuroscience trials means the *brain's* networks — so the entire tDCS/rTMS/DBS research literature was swept in. Specialty could not be honestly completed over that. Bar set (yours): **a row is in-scope iff the AI/ML is integral to the device under study** — not a physical stimulator with AI as a downstream analysis step. A read-only triage (`scripts/probe-ctgov-scope-audit.ts`) bucketed all 487 rows; you reviewed in a workbook and returned a three-way split (`keep_core` / `capture_improved` / `reject`), then folded "improved" into reject. **Applied via `scripts/apply-scope-decisions.ts` (dry-run → snapshot → `--apply --expect 150`): 150 queue rows rejected (reversible), 9 already-approved rows also `excluded=true` on `device_master` (all 9 confirmed `also_has_fda=no` — standalone trial devices, safe to hide).** Then re-ran the extractor over the clean pending set: **310 scanned, 284 classified (229 high / 55 medium), 26 none** — stimulation pollution gone, stroke devices resolved.

**Net:** the specialty *pipeline* is correct end-to-end over a clean, in-scope set (the real goal under "make the field complete"). It does **not** repaint the existing public backbone — that stays the separate, measure-first job.

### Prior session (19 June 2026) — EUDAMED localised-text bugs fixed (`e7a4cea`)
The EUDAMED `udiDiData` detail endpoint returns several "name"-like fields as a `{ textByDefaultLanguage, texts[] }` **localised-text envelope**, not plain strings. Fixed BUG-014/015/016 with one shared `extractLocalisedText()` helper. **Cleared gate condition 3** of EU-only Discovery v2. New not-a-bug: some EUDAMED devices have empty `tradeName.texts[]` → Dice-zero → a source-side floor on EU crosswalk recall (matters for Step 1c). See `EUDAMED-DETAIL-ENDPOINT-FINDINGS.md`.

### 17 June 2026 — EU-only Discovery v2, Step 1a (HAIR) (`9bc175e`)
Continue EUDAMED rather than open Brazil. Built + committed a validated **Health AI Register** extractor + `HAIR-SNAPSHOT-2026-06-17.json` (**400 products**, 300 radiology + 100 pathology). Sitemap unreliable → listing-page pagination. HAIR is the primary EU-only discovery seed.

### 11 June (carried forward, still live)
QueueTable merge surface (`lib/mergeDiff.ts`); **FDA same-product dedup** Band A applied (150 clusters / 214 rows absorbed), `merged_into IS NULL` read filter across all 14 public read sites, Band B+C (80) seeded; EUDAMED EU-leg ingest (227 crosswalk rows).

---

## What is shipped and live (prod)

- **Public index** at www.aletia-index.com — curated FDA AI/ML (reconciled to the FDA published list, one aletia_id per product) + MHRA PARD (58) + a small EU/Scarlet set. Public reads filter **both** `excluded = false` **and** `merged_into IS NULL`. **Gated device count: 1,276 → 1,267** after this session's **9 CT.gov exclusions** (approved-but-out-of-scope trial devices). *(`device_master.specialty_link` is null for ~99.6% of shown devices — the FDA backbone was seeded without specialty; deliberately left null, see this session's abandoned backfill.)*
- **Specialty on the queue — DATA live, CODE local-only.** 284 `clinical_trials` pending rows now carry `specialty_inferred` (so future accepts cascade specialty into `device_master`). But the extractor refactor + scope tooling are **not committed** — `main` still has the old extractor. Not "done" until committed.
- **EUDAMED EU-only Discovery v2 — Step 1a (HAIR) DONE (`9bc175e`)**; **`lib/eudamed.ts` localised-text fix DONE (`e7a4cea`)** — gate condition 3 cleared.
- **QueueTable merge surface (10 Jun)**; **FDA same-product dedup (10 Jun)** Band A applied, B+C seeded; **EUDAMED EU-leg ingest (9 Jun)** 227 review rows; **FDA discovery rebuild (5 Jun)**; **technology-first display (3 Jun)**; **canonical Aletia ID model** + 4d gate + claim flow + admin portal 1–2.

## Schema state

**No schema change this session.** The `device_master` specialty backfill was abandoned, so the proposed `fda_panel` / `specialty_confidence` / `device_tier` columns were **not** added — a deliberate decision, not an oversight. `device_master` has only `specialty_link` (FK → `specialty_taxonomy.specialty_name`, single value or null); `specialty_inferred`/`specialty_confidence`/`specialty_signals` remain **queue-only**. Prior state unchanged: all A2a+A2b + 3-Jun description + `20260610120000_add_merged_into.sql` applied. **Both `excluded = false` AND `merged_into IS NULL` load-bearing.** id_type `eudamed_udi_di` + `nct` in use. Supabase CLI non-functional — schema via SQL editor.

---

## Architectural spine

**1. Aletia ID = canonical device identity** — `ALT-NNNNNN`; external IDs via `device_external_ids`; enforced by the 4d gate. Device-level identity, submission-level history. Same-product only; fuzzy → queued, never scripted.

**2. `pipeline_stage` semantic** — in pipeline iff no regulatory approval anywhere; first approval sets `pipeline_stage = null`. FDA + EUDAMED paths applied; MHRA pending (BUG-010).

**3. 4d gate discipline** — exact `(id_type, id_value)` auto-resolves; fuzzy queues with candidates; no-match creates atomically. **False positives are worse than duplicates.**

**4. Display standard** — technology name primary, organisation secondary, Description = what it does. **Provenance registers must render distinctly and never blend.** Provenance never public.

**5. Inclusion standard** — a device is in the index iff it is AI/ML by the relevant regulator's own classification. FDA: membership of the FDA AI/ML list. EUDAMED: the EMDN `cndCode` allow-list heuristic. **CT.gov (new this session): a trial is in-scope iff the AI/ML is *integral to the device under study* — not a physical stimulator (tDCS/rTMS/DBS/etc.) with AI as a downstream analysis method, and not "neural network" in its neuroanatomical sense.** The ingest keyword filter over-captures on "neural network"; scope is decided by human review, applied via `apply-scope-decisions.ts`, and kept **orthogonal to specialty** (a populated `specialty_inferred` is never a vote for inclusion). Heuristic-only candidates are *queued*, never auto-included.

**6. Specialty inference (new this session)** — classify by *clinical domain* from the device's own text (name/title/conditions/summary), never from a regulatory lane (FDA panel / product_code). Two layers: `lib/specialtyEvidence.ts` (source-shape normalisation) and `lib/specialtyTaxonomy.ts` (clinical patterns, HIGH→MEDIUM→LOW, organ-specific beats generic). `specialty_link` FK admits only the 25 canonical names or null; **null = honest "not yet classified," preferred over a confident wrong label.**

---

## Next priority

**0. COMMIT THIS SESSION'S CODE** (before anything else — it is local-only and one re-clone from gone). Two logical commits (see the commit block handed over with this rewrite): (a) the specialty pipeline (6 files: `lib/specialtyEvidence.ts`, `lib/specialtyTaxonomy.ts`, `lib/extractQueueSpecialty.ts`, `app/api/admin/queue/extract-specialty/route.ts`, `scripts/extract-queue-specialty.ts`, `scripts/test-specialty-inference.ts`); (b) the scope-audit tooling + decision record (`scripts/apply-scope-decisions.ts`, `scripts/probe-ctgov-scope-audit.ts`, `scripts/probe-specialty-decisions.ts`, `scope-decisions.csv`, `.gitignore` snapshot pattern). Run `npx tsc --noEmit` + `scripts/test-specialty-inference.ts` (19 green) before committing.

**Specialty follow-ups (optional, measure-first):**
- **Public-site de-baring** — the honest lever left is running the *same clinical-text extractor* over `device_master`'s own `device_id`/`intended_use` (construct-valid, unlike the abandoned FDA-panel route). **Measure first:** dry-run, read the hit rate + spot-check accuracy; if the text is mostly brand names it stays null (confirmed honest), if it's descriptive it de-bares a real chunk. Also: the ~27 pre-extractor accepted core devices have null `specialty_link` on the site (accept cascaded null); re-cascade or fold into the same pass.
- **Wire the extractor into accept/ingest** so new CT.gov devices carry specialty automatically (B1/B2 in the old backlog — largely done at the queue layer now; confirm the accept cascade reads `specialty_inferred`).

**EUDAMED / dedup backlog (resumes — was the pre-detour priority):**
1. **EUDAMED queue: candidate recompute + manual review** — `scripts/recompute-eudamed-candidates.ts` **built 17 Jun, still NOT committed (local-only)**; re-ground against `lib/fdaDedup.ts`, commit, dry-run → snapshot → `--apply`, then work the drawer (159 single- then 68 multi-candidate). See `SESSION-PROMPT-eudamed-queue-recompute-review.md`.
2. **FDA dedup queue** — 80 Band-B+C rows (clean re-codes first; judgement calls: Aidoc BriefCase, SOZO ×4, Clarius AI vs OB AI; must-rejects list in prior STATE).
3. **Step 1b — HAIR three-way reconcile** (400 products vs 4d gate + EUDAMED crosswalk; writes to queue).
4. **Step 1c — recall measurement** off the HAIR snapshot (report the empty-`texts[]` source floor).
5. **EUDAMED re-ingest** (`EUDAMED-REINGEST-SPEC`); **Manufacturer-level dedup (Module 4)**; **BUG-013** PMA-supplement PCCP gap; **Cron jobs**.

## Also open (carried)

- **TWO local-only code items** — `recompute-eudamed-candidates.ts` (since 17 Jun) **and** this session's specialty pipeline + scope tooling (since 8 Jul). Commit both.
- **Public specialty is ~99.6% null by design** (FDA backbone) — not a bug; the honest de-baring option is the measure-first `device_master` text pass above.
- **Snapshot artifacts** — `apply-scope-decisions.ts` writes `scope-apply-snapshot-*.json` on `--apply`; gitignore them (run artifacts, not source). Keep the one from the 150-reject/9-exclude run as the undo record.
- Promote the HAIR sitemap finding into `HAIR-EXTRACTION-FINDINGS.md`. Delete stale `app/api/admin/queue/QueueTable.tsx`. Benign dedup under-merges (GE DLIR, EPIQ/Affiniti, etc.). Tombstone `/device/<absorbed>` 404 → consider redirect to survivor.
- **EUDAMED NB/cert/legislation backfill** deferred (monthly re-probe; `basicUdiDataUuid` still null). Widen EMDN allow-list to full 66; run live discovery beyond the seed.
- **FDA supplementary sweep** shipped-not-run; FDA Description sourcing. **B3** CT.gov status codes (BUG-006); **A4** `pipeline_stage`→`discovery_stage` (BUG-003); **A3** regulatory status per jurisdiction.
- **Startup portal**; **RP/NB directory**; **Evidence Gate / Divergence Triple**; **EUDAMED Vigilance** (~2027). **Infra** — rotate prod DB password, rename Supabase project off "Aletia-Index-Staging", Free-plan backup risk.
- **Tier-1 docs not committed to the repo** — continuity risk; commit STATE/TODO/KNOWN-BUGS + findings alongside the code.

---

## Key docs

- `STATE.md` — this file. Rewritten fresh each session.
- `TODO.md` — backlog. `KNOWN-BUGS.md` — open + resolved bugs. `DOCS.md` — Tier 0. `README.md` — architecture (rewrite outstanding).
- **Specialty + scope audit (this session):** `scope-decisions.csv` (the 487-row keep/reject record), `scripts/apply-scope-decisions.ts`, `scripts/probe-ctgov-scope-audit.ts`, `scripts/test-specialty-inference.ts`. *(Consider a `SPECIALTY-PIPELINE-FINDINGS.md` capturing the FDA-panel construct-validity rejection + the "neural network" over-capture — reasoning that will otherwise evaporate.)*
- **EUDAMED leg:** `EUDAMED-STEP-0A-FINDINGS.md`, `EUDAMED-DETAIL-ENDPOINT-FINDINGS.md`, `EUDAMED-REINGEST-SPEC.md`, `EUDAMED-RELOOK-SCOPE-v2.md`, `EUDAMED-EU-ONLY-DISCOVERY-SCOPE.md` (v2).
- **HAIR:** `HANDOVER_2026-06-17_hair-extraction.md`, `HAIR-EXTRACTION-FINDINGS.md`.
- **Next session:** `SESSION-PROMPT-eudamed-queue-recompute-review.md`.
- **FDA dedup:** `HANDOVER_2026-06-10_fda-dedup.md`, `FDA-DEDUP-DESIGN-DOC.md`.
- Specs: `STARTUP-PORTAL-SPEC.md`, `RP-INTEGRATION-SPEC.md`, `EVIDENCE-GATE-BRIEF-STRUCTURE.md`, `DIVERGENCE-TRIPLE-SPEC.md`, `VIGILANCE-RECONCILIATION-SPEC.md`.
- `archive/` — handovers; not load-bearing.
