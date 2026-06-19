# Aletia Index — State of the World

**Last rewritten: 19 June 2026.** This rewrite folds in two sessions the prior STATE (11 Jun) predated: the **17 Jun HAIR extraction** (`9bc175e`, EU-only Discovery v2 Step 1a) and **this session's EUDAMED bug fix** (`e7a4cea`, localised-text Bugs A/B/C). Commit lineage: `706054b` (11 Jun, FDA dedup + `merged_into`) → `9bc175e` (17 Jun, HAIR Step 1a) → `e7a4cea` (19 Jun, eudamed.ts bugs). Rewritten fresh each session, not appended.

## How to use this file

1. Read this first when starting a session — it gives you the map.
2. **Code is ground truth.** When STATE, TODO, README, or handovers disagree with committed code, code wins. If you see a claim in a doc, grep for it before relying on it. *(This rewrite was triggered by exactly that: a next-step scoped from memory was wrong because the 227 rows' provenance lives in `seed-eudamed.ts`, not where memory implied.)*
3. **"Done" means committed to `main` and verified in production.** Discussion, intent, merged-to-a-branch, or "applied locally" do not count as done.
4. Handovers are archival — they live in `archive/`. Do not load them unless this file points you to a specific one.

## Session-start ritual

1. Read this file.
2. Read `TODO.md` for current backlog.
3. Read `KNOWN-BUGS.md` to see what's broken.
4. Grep code for anything the docs are unclear about (`api.github.com` is rate-limited on shared egress — use the tarball / `commits/main.atom`).
5. The README is architecture/onboarding reference — dip into it for specific lookups, don't load wholesale.

---

## The big changes since the last rewrite

### This session (19 June 2026) — EUDAMED localised-text bugs fixed (`e7a4cea`)
The EUDAMED `udiDiData` detail endpoint returns several "name"-like fields as a `{ textByDefaultLanguage, texts[] }` **localised-text envelope**, not plain strings. `lib/eudamed.ts` typed them as strings, so three sites silently misbehaved:
- **BUG-014** (`additionalDescription`) — an object passed straight to `hasAiKeyword`, stringifying to `"[object Object]"`; the keyword precision guard was dead on that field.
- **BUG-015** (`tradeName`) — `textByDefaultLanguage` is null and the real name sits in `texts[]`; the client fell through to the (usually null) search-row name → null `device_name` → Dice-zero in the 4d gate.
- **BUG-016** (`cndNomenclatures[].description`) — same envelope, `emdn_description` resolved null.

Fixed with one shared `extractLocalisedText()` helper (default-language → `allLanguagesApplicable` → `en` → first non-empty) applied at all three sites; `EudamedUdiDetail` retyped. Verified: offline fixture 13/13 (incl. the two real captured shapes), `tsc`+eslint clean, live Part-B re-run (null names 4/10→3/10, "Syngo Carbon Space" recovered, guard split 7/3 unchanged — correct). **This clears gate condition 3** of EU-only Discovery v2. New not-a-bug logged: some EUDAMED devices have **empty `tradeName.texts[]`** (un-nameable from the public surface) → Dice-zero → a source-side floor on EU crosswalk recall (matters for Step 1c). See `EUDAMED-DETAIL-ENDPOINT-FINDINGS.md` (Resolution).

### Prior session (17 June 2026) — EU-only Discovery v2, Step 1a (HAIR) (`9bc175e`)
Decided to **continue the EUDAMED leg rather than open Brazil** (ANVISA has no published AI/ML list, registrations sit with local distributors, zero identifier overlap — a parallel list, not reconciled identity; EU legacy-backfill window runs to ~Nov 2026). Built and committed a validated **Health AI Register** extractor (`scripts/hairExtract.ts` pure parser + `scripts/extract-hair.ts` runner) and `HAIR-SNAPSHOT-2026-06-17.json` — **400 products** (300 radiology + 100 pathology), reconciled to within ~2% of an independent oracle on every regulatory facet (IVDR/IVDD exact after a `ce_ivd`-type fix). HAIR is an App-Router RSC SPA on a headless Wagtail backend; data streams in flight chunks (no `__NEXT_DATA__`, no public Wagtail API); the **sitemap is unreliable** (served 1,186 then 14 locs within an hour) so URL collection falls back to listing-page pagination. **HAIR is the primary EU-only discovery seed** — the EC cited it in lieu of EUDAMED.

### 11 June (carried forward, still live)
QueueTable rewritten into a working merge surface (`lib/mergeDiff.ts` live; field-level diff; park-with-note; BUG-011 closed). **FDA same-product dedup**: one `aletia_id` per product — Band A applied (`20260610120000_add_merged_into.sql`; `--apply --expect 150` → 150 clusters / 214 rows absorbed / 0 failed; invariant: all 1,425 FDA submissions resolve to one in-scope device), `merged_into IS NULL` read filter added across all 14 public read sites, Band B+C (80 rows) seeded into the queue. EUDAMED EU-leg ingest committed (227 crosswalk review rows). Rollback file for the 214 absorptions is the only undo — keep it durable.

---

## What is shipped and live (prod)

- **Public index** at www.aletia-index.com — **~1,211 FDA-attached** (curated FDA AI/ML 510(k)+De Novo+PMA, reconciled to the FDA published list, **one aletia_id per product**) + MHRA PARD (58) + a small EU/Scarlet set (≈4); roughly **~1,310 in-scope** total. Server-side filters, pagination, `/device/[aletia_id]` SSR + SEO + JSON-LD. Public reads filter **both** `excluded = false` **and** `merged_into IS NULL`. *(The 227 EUDAMED crosswalk rows are review-queue rows, not index rows.)*
- **EUDAMED EU-only Discovery v2 — Step 1a (HAIR) DONE (`9bc175e`)** — extractor + validated 400-product snapshot committed. Step 1b/1c downstream (see Next).
- **`lib/eudamed.ts` localised-text fix DONE (`e7a4cea`)** — gate condition 3 cleared; future EUDAMED detail reads name correctly and the keyword guard can fire.
- **QueueTable merge surface (10 Jun)** — candidate-driven drawer, field-level diff, context actions, park-with-note, `fda_dedup` cluster panel.
- **FDA same-product dedup (10 Jun)** — Band A applied (150 clusters / 214 absorbed); B+C (80) seeded, being worked. `device_master.merged_into` load-bearing.
- **EUDAMED EU-leg ingest (9 Jun)** — `lib/eudamedList.ts` (EMDN `cndCode` allow-list, `v1-2026-06-09`), `lib/eudamed.ts` client, `lib/eudamedSync.ts` (4d gate, id_type `eudamed_udi_di`), `app/api/eudamed-sync/route.ts`, `scripts/seed-eudamed.ts`. **227 review-queue rows** (159 single-candidate; 68 multi-candidate held pending the FDA collapse — now collapsible). NB/cert/legislation = `'pending'` (not retrievable). Dead Scarlet route parked (410 → `/api/eudamed-sync`).
- **FDA discovery rebuild (5 Jun)**; **technology-first display (3 Jun)** (`lib/displayName.ts`); **canonical Aletia ID model** + device page (A2b); **4d gate** across all discovery paths (transactional create via `create_device_atomic`); **claim flow**; **admin portal** modules 1–2; **home stat strip**.

## Schema state

All A2a + A2b migrations applied, plus the 3-Jun description migrations and **`20260610120000_add_merged_into.sql`** — `device_master.merged_into text NULL REFERENCES device_master(aletia_id)` + partial index. Semantics: non-null `merged_into` = absorbed into that survivor as a same-product FDA duplicate (distinct from `excluded` = out-of-scope). **Both `excluded = false` AND `merged_into IS NULL` are load-bearing** for the public index. id_type **`eudamed_udi_di`** added via SQL editor (CLI non-functional — the standard path here). Key tables: `device_master` (PK `aletia_id`; `excluded` + `merged_into` load-bearing), `device_external_ids`, `device_trials`, `regional_registrations`, `ingestion_review_queue` (227 `eudamed_sync` + 80 `fda_dedup` rows), `ingestion_anomalies`.

---

## Architectural spine

**1. Aletia ID = canonical device identity** — `ALT-NNNNNN`; external IDs via `device_external_ids`; enforced by the 4d gate. **Device-level identity, submission-level history:** the FDA list is one row per *submission*, so a product cleared N times produced N aletia_ids — the dedup collapses these to one survivor (earliest clearance = primary id) carrying all submissions as secondary `fda_*` ids. Same-product only; fuzzy → queued, never scripted. *(Band A resolves the bulk; B+C + a manufacturer pass close the tail.)*

**2. `pipeline_stage` semantic** — in pipeline iff no regulatory approval anywhere; first approval sets `pipeline_stage = null`. Applied on the admin accept route and the FDA **and EUDAMED (discovery)** paths; **MHRA path still pending** (BUG-010). On *merge* no source re-graduates (moot). BUG-003 resolves under the A4 `discovery_stage` rename.

**3. 4d gate discipline** — exact `(id_type, id_value)` auto-resolves; fuzzy queues with candidates; no-match creates atomically. **False positives are worse than duplicates.** Cross-jurisdiction has no shared namespace, so EU devices never exact-match — they queue, EU registration written at admin-merge time.

**4. Display standard** — technology name primary, organisation secondary, Description = what it does. **Provenance registers must render distinctly and never blend** (regulator-sourced vs Aletia-verified vs manufacturer-attested). Provenance never public.

**5. Inclusion standard** — a device is in the index iff it is AI/ML by the relevant regulator's own classification. FDA: membership of the FDA AI/ML list. EUDAMED (no AI flag): the EMDN `cndCode` allow-list heuristic (`lib/eudamedList.ts` v1 — query confirmed leaves, queue the uncertain; precision over recall). Heuristic-only candidates are *queued*, never auto-included.

---

## Next priority

Gate 3 (eudamed.ts bugs) and Step 1a (HAIR) are done. The remaining gate before Step 1b is the **manual queue work**. In order:

1. **EUDAMED queue: candidate recompute + manual review** *(gate condition 1 for discovery)*. Run `scripts/recompute-eudamed-candidates.ts` — **built 17 Jun but NOT committed (local-only)**; locate, re-ground against `lib/fdaDedup.ts`, and commit it. It re-points the 227 rows' stale candidates onto **post-Band-A-dedup survivors** (`merged_into`) so the drawer shows correct targets — **no EUDAMED calls; the name fix is irrelevant to it.** Dry-run → review (tombstone-hops 0, no-crosswalk-entry 0) → snapshot → `--apply`. Then work the drawer: 159 single-candidate rows, then the 68 now-collapsible multi-candidate rows. See `SESSION-PROMPT-eudamed-queue-recompute-review.md`.
2. **Work the FDA dedup queue** — the **80 `fda_dedup` Band-B+C rows** (clean re-codes Collapse on earliest survivor; judgement calls: **Aidoc BriefCase** (3 clusters/29 rows — one platform or many?), **SOZO ×4**, **Clarius AI vs OB AI**; must-rejects: Brainomix ICH/LVO, Second Opinion variants, US System 2300/1300, AmCAD UV/UO/UT, uOmnispace MI/MR/CT, Samsung V8/RS85, RADAC V2/V3/V4).
3. **Step 1b — HAIR three-way reconcile** *(now unblocked by gates 1+3)* — each of the 400 HAIR products vs the Aletia 4d gate + the EUDAMED `tradeName` crosswalk. **Writes to the queue.** Fuzzy → queue; HAIR-without-EUDAMED queued, never minted.
4. **Step 1c — recall measurement** off the HAIR snapshot (funder-report headline: allow-list recall on an EC-cited independent registry). Report the empty-`texts[]` source floor as part of the number.
5. **EUDAMED re-ingest** (`EUDAMED-REINGEST-SPEC`) — carry search-row `riskClass.code` + detail fields into `raw_data` (recovers `eu_risk_class` + intended-use into the merge diff); re-confirm the Basic-UDI deferral. *(The two type bugs this used to bundle are done as of `e7a4cea`.)*
6. **Manufacturer-level dedup (Module 4)** — the GE-DLIR-style under-merges Band A left.
7. **BUG-013** — PMA-supplement PCCP gap (strip `/S\d+` in `normaliseId` or relax the PMA regex; key on the base number).
8. **Cron jobs** — bundle the EUDAMED re-pull (+ monthly NB/cert re-probe trip-wire) + FDA-sweep cadence; `CRON_SECRET`, `vercel.json`, re-enable route auth. Breadth before cadence.

## Also open (carried)

- **`recompute-eudamed-candidates.ts` is uncommitted** (local-only since 17 Jun) — commit it in the next session (priority 1).
- **Promote the HAIR sitemap finding** into `HAIR-EXTRACTION-FINDINGS.md` (house format; source behaviour, not a bug). One-liner already in the `extract-hair.ts` header.
- **Tier-1 docs are not committed to the repo** (STATE/TODO/KNOWN-BUGS + findings live outside git) — continuity risk; the docs and code can drift. Worth committing them alongside the code.
- **Delete the stale `app/api/admin/queue/QueueTable.tsx`** (pre-rewrite copy, dead but a foot-gun).
- **Benign dedup under-merges (cleanup later)** — GE DLIR ×2, EPIQ/Affiniti ×3, Contour Protégé/Protege (accent), SKOUT ×2, Voluson Expert order — resolve via normaliser polish and/or the manufacturer dedup. Volta AF-Xplorer←II and aPROMISE←X roman-numeral merges are defensible; reverse later if disagreed.
- **Tombstone detail pages 404** — `/device/<absorbed>` now not-found; consider redirecting to the `merged_into` survivor (UX nicety).
- **EUDAMED NB/cert/legislation backfill** — deferred, monthly re-probe (`basicUdiDataUuid` populating? — 19 Jun re-check: still null). Registrations `'pending'` until then.
- **Widen the EUDAMED EMDN allow-list** to the full 66 (`eudamed-crosswalk-results.json → topEmdn`); run live discovery (`PUT /api/eudamed-sync`) beyond the seed — *now naming correctly post-`e7a4cea`*.
- **FDA supplementary sweep** — code shipped, not yet run. **FDA Description sourcing** — Indications-for-Use → `device_master.description` (decide source first; not a clean openFDA field).
- **B1/B2** specialty matcher wiring + merge clobber; **B3** CT.gov status codes (BUG-006); **A4** `pipeline_stage`→`discovery_stage` (BUG-003); **A3** regulatory status per jurisdiction.
- **Startup portal** (`STARTUP-PORTAL-SPEC.md`); **RP/NB directory** (`RP-INTEGRATION-SPEC.md`); **Evidence Gate / Oversight-Divergence Triple** (`DIVERGENCE-TRIPLE-SPEC.md`, `EVIDENCE-GATE-BRIEF-STRUCTURE.md`) — now have real cross-jurisdiction data to build on.
- **EUDAMED Vigilance module** — `VIGILANCE-RECONCILIATION-SPEC.md` produced; not expected mandatory until ~2027, partial public access only.
- **Infra** — rotate prod DB password, rename the Supabase project off "Aletia-Index-Staging", Free-plan backup risk, re-establish staging post-cutover.

---

## Key docs

- `STATE.md` — this file. Rewritten fresh each session.
- `TODO.md` — backlog. Completed items deleted, not checkmarked.
- `KNOWN-BUGS.md` — open + resolved bugs (BUG-014/015/016 = the eudamed.ts envelope fix).
- `DOCS.md` — Tier 0: how the documentation system works.
- `README.md` — architecture/schema/onboarding (rewrite still outstanding).
- **EUDAMED leg:** `EUDAMED-STEP-0A-FINDINGS.md` (+9 Jun corrections), `EUDAMED-DETAIL-ENDPOINT-FINDINGS.md` (+19 Jun Resolution), `EUDAMED-REINGEST-SPEC.md`, `EUDAMED-RELOOK-SCOPE-v2.md`, `EUDAMED-EU-ONLY-DISCOVERY-SCOPE.md` (v2).
- **HAIR (Step 1a):** `HANDOVER_2026-06-17_hair-extraction.md`, `HAIR-EXTRACTION-FINDINGS.md` (to be created — sitemap finding).
- **Next session:** `SESSION-PROMPT-eudamed-queue-recompute-review.md`.
- **FDA dedup:** `HANDOVER_2026-06-10_fda-dedup.md`, `FDA-DEDUP-DESIGN-DOC.md`, `HANDOVER_2026-06-10_queue-rewrite.md`.
- Specs: `STARTUP-PORTAL-SPEC.md`, `RP-INTEGRATION-SPEC.md`, `EVIDENCE-GATE-BRIEF-STRUCTURE.md`, `DIVERGENCE-TRIPLE-SPEC.md`, `VIGILANCE-RECONCILIATION-SPEC.md`.
- `archive/` — handovers; not load-bearing.
