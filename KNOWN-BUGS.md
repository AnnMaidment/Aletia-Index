# Aletia Index — Known Bugs

**Last updated: 19 June 2026.** (EUDAMED localised-text envelope bugs A/B/C fixed + verified live; commit `e7a4cea`. Prior: 11 June queue-rewrite + FDA dedup, `706054b`.)

> **⚠ Reconstructed file.** The original `KNOWN-BUGS.md` was not available when this was rebuilt on 25 May. This version is reconstructed from BUG references across STATE, TODO, and the handovers. It should be **reconciled against the real `KNOWN-BUGS.md`** if one still exists in the repo or an earlier export — file:line references in particular need confirming against current code. Where a detail couldn't be recovered from the docs, it's marked *(detail unconfirmed)*.

**Convention:** a bug is `[resolved]` only when the fix is committed to `main` and verified in production. `[open]` means still reproducible or unverified.

---

## Open

### BUG-003 — `pipeline_stage` vocabulary split across code paths
`pipeline_stage` is interpreted/written inconsistently between ingest paths and the display layer. Not fully resolved by A2b. **Resolves cleanly under A4** (the `pipeline_stage` → `discovery_stage` rename, which collapses to two values). Until then, treat `pipeline_stage` values with care across the FDA/MHRA/EUDAMED sync paths vs the admin accept route.

### BUG-006 — CT.gov status codes collapsed rather than normalised
ClinicalTrials.gov status values (`WITHDRAWN`, `SUSPENDED`, `not_yet_recruiting`, etc.) are not all mapped distinctly. Revisit post-A2b now that real trial data flows into `device_trials`. Fix tracked as TODO B3.

### BUG-007 — cosmetic, low priority
*(Detail unconfirmed — recovered only as "cosmetic and low priority" from the docs.)* Confirm against the real file and restore the description.

### BUG-010 — graduation rule not applied on regulatory sync paths
First regulatory approval in any jurisdiction should set `pipeline_stage = null`. **FDA half resolved 5 Jun; EUDAMED discovery path resolved 9 Jun** (`ingestEudamedDevice` sets `pipeline_stage = null` on EU clearance, create/update paths). **MHRA half remains open.** On the admin *merge* path no source re-graduates (the target is already graduated — moot). Tracked as TODO B4.

### BUG-013 — pccpIngest drops PMA supplement submissions (`P######/Sxxx`)
`classifySubmissionNumber` in `lib/pccpIngest.ts:158` matches PMA as `^P[0-9]+$`, so a PMA *supplement* number like `P190016/S007` fails the shape check and the row is skipped with an `Unrecognised submission_number shape` error. The 10 Jun PCCP run logged **~40** such errors — i.e. ~40 authorized-PCCP PMA supplements are not being recorded. Pre-existing; surfaced (not caused) by the post-dedup PCCP run.

**Fix:** key on the base PMA number before the supplement suffix — either strip `/S\d+` in `normaliseId`, or relax the PMA branch to `^P[0-9]+(?:/S[0-9]+)?$` and classify on the base. Self-contained; do as its own task, not bolted onto dedup.

---

## Resolved

### BUG-014 — EUDAMED `additionalDescription` is a localised-text envelope, not a string (keyword guard silently dead)
The live `udiDiData` detail returns `additionalDescription` as `{ texts: [{ language: { isoCode }, text }] }`, but `EudamedUdiDetail` declared it `string | null` and `fetchEudamedAiMlDevices` passed it straight into `hasAiKeyword(...)`. The object stringified to `"[object Object]"`, so the keyword precision guard never saw description text — one of the two corroborating signals in `classifyEudamedCandidate` was dead on that field, silently pushing keyword-only devices from `include` to `queue`.

**Status (19 Jun): Resolved.** A shared `extractLocalisedText()` helper resolves the envelope (default-language → `allLanguagesApplicable` → `en` → first non-empty) before keyword-matching; `additionalDescription` retyped. Verified live (Part B re-run): the keyword guard is now *able* to fire on description text. Capability restored; **no measured guard-split change on the 10-device sample** (7 include / 3 queue, unchanged) because those devices carry no AI lexicon — the honest claim is "capability restored", not "more hits". Committed `main` `e7a4cea`.

### BUG-015 — EUDAMED `tradeName.textByDefaultLanguage` null; real name in `texts[]` (null device_name → Dice degraded)
The live shape is `{ texts: [{ language: null, text: "<name>", allLanguagesApplicable: true }], textByDefaultLanguage: null }`. The client read `textByDefaultLanguage` (null) then fell back to `row.tradeName` (usually null on search) → null `device_name`. That flows through `eudamedSync.ts` into the 4d gate, where `matchingCandidates.ts` sets Dice to 0 when either name is missing → no merge candidate → degraded EU crosswalk hit-rate.

**Status (19 Jun): Resolved.** Same `extractLocalisedText()` helper reads `texts[]`. Verified live (Part B re-run): residual null names dropped **4/10 → 3/10** on the sample, and "Syngo Carbon Space" recovered from `texts[0]`. The 3 remaining nulls (NeoLogica ×2, Shanghai United Imaging) are **genuinely absent in EUDAMED** (empty `texts[]`) — a source limitation, not a code defect; these will Dice-zero in the gate and queue with no candidate (see `EUDAMED-DETAIL-ENDPOINT-FINDINGS.md`). Committed `main` `e7a4cea`.

### BUG-016 — EUDAMED `cndNomenclatures[].description` same envelope (`emdn_description` null)
The EMDN description site (`emdn?.description`) used the same localised-text envelope and was read via the old `.textByDefaultLanguage` path, resolving `emdn_description` to null. Third instance of the BUG-014/015 root cause.

**Status (19 Jun): Resolved.** Fixed with the same helper in the same pass (judgment call, deliberately folded in with A/B rather than logged for later). Committed `main` `e7a4cea`.

### BUG-011 — admin Mark-duplicate 400s (contract mismatch, no target)
The drawer's Mark-duplicate sent `{ queue_id, review_note }` while `duplicate/route.ts` required `{ queueId, targetDeviceId, note }` — snake/camel mismatch and no target device, so every Mark-duplicate 400'd.

**Status (10 Jun): Resolved.** Contract aligned to snake_case on both sides (`{ queue_id, target_device_id, review_note }`, matching accept/reject), and the drawer's duplicate flow now collects a required "duplicate of ALT-…" target. The route's behaviour is unchanged otherwise: queue disposition only, `device_master` untouched, `raw_data.duplicate_of` recorded.

### BUG-012 — FDA discovery proxy under- and over-captured AI/ML devices
The FDA discovery path decided "is this AI/ML?" with a hand-maintained proxy that failed both ways: under-capture (`AIML_PRODUCT_CODES` + keyword, 510(k) endpoint only, `limit:1000` no pagination → `QIH` clipped; De Novo/PMA never queried; off-list AI devices missed) and over-capture (`buildFdaDeviceSeed` set `intended_use = device_name` and `ai_ml_integral = true` unconditionally, so broad imaging codes' non-AI devices read as AI). Result: ~5,017 "FDA" rows vs ~1,430 on the FDA's own AI list.

**Status (5 Jun): Resolved.** FDA published list is now the authoritative seed (`lib/fdaList.ts`); supplementary sweep is paginated across 510(k)/De Novo/PMA; `ai_ml_integral` = list membership; off-list over-capture pruned via `excluded` (~4,612, reversible). Index reconciled to ~1,526 in-scope. *(Data applied to prod; the four rebuild files committed + deployed — `main` `d1dbeeb`.)*

### BUG-001 — pre-approval profile read/write used wrong field names
`buildPreApprovalProfile` read the wrong field names; trial data handling was incorrect. **Closed by A2b** — trial data moved out of `pre_approval_profile` into `device_trials`, and the backfill/ingest paths were rewritten. Verified through the A2b ingest rewrite.

### BUG-002 — `device_name` silently discarded on create
The accept/create path dropped the device name. **Closed by A2b** — the accept route now writes the `name` column on `device_master`; further hardened by the create path. Verified. *(Further reinforced 10 Jun: the queue-rewrite deleted the implicit `fillIfNull` line that wrote `device_name` into `intended_use`.)*

### BUG-004 — five missing `pre_approval_profile` rows
Five legacy devices lacked expected `pre_approval_profile` rows.

**Status (3 Jun):** Resolved. `scripts/backfill-pipeline-descriptions.ts` re-fetched all 36 CT.gov pipeline trials by NCT and wrote the missing `device_trials` rows (the 10 orphans + others), plus `device_master.description`/`name`. The original `pre_approval_profile`-row question is folded into D3's re-evaluation (those columns may now be redundant against `device_trials`).

### BUG-005 — inconsistent `device_id` generation
Inconsistent identifier generation on the create path. **Closed by A2b** — identity is now the DB-allocated `aletia_id`, and external identifiers are created through the 4d gate via `create_device_atomic`. Verified.

### BUG-008 — accept-route atomicity gap
The create path was non-transactional: a device_master row could commit while the external-identifier append failed, leaving an orphan (observed as the ALT-006163 / ALT-006165 failure on staging, patched manually via SQL at the time). **Closed** by the `create_device_atomic` RPC (migration `20260424120000`), which wraps device_master + device_external_ids + optional device_trials in one transaction — any write fault rolls the whole thing back. Also defused a latent NOT NULL gap on `device_master.external_legacy_id`. Verified.

### BUG-009 — home search missed MHRA-prefixed query strings
Post-A2b, MHRA IDs are stored raw (`47392`, not `MHRA-47392`), so a user searching the prefixed form got no hit on the secondary-ID pre-query. **Closed** — `app/page.tsx` now runs `normaliseIdentifierInput(search)` (strips the `MHRA-` prefix) before the `device_external_ids.id_value` lookup; the direct-column ilike on `external_legacy_id` still matches the historical stored form, so both shapes resolve. Verified.

---

## Notes
- **BUG-014, BUG-015, BUG-016 share one root cause** (the EUDAMED localised-text envelope) **and one fix** (`extractLocalisedText()` in `lib/eudamed.ts`, exported for unit-testing). Fold to a single entry if you prefer a tighter register.
- BUG-001, BUG-002, BUG-005 were closed together as a side effect of the A2b ingest-path rewrites.
- Several bug references across the docs point to file:line locations that have since changed in the A2b rewrite — re-grep before relying on any line number here.
- **Not bugs (don't re-log):** (a) EUDAMED registrations carrying `regulatory_body`/`clearance_type` = `'pending'` — a correct reflection of source state (NB module unpopulated pre-28-May-2026), tracked as a TODO backfill with a monthly re-probe; see `EUDAMED-STEP-0A-FINDINGS.md` §2 correction. (b) The 21 `unmatched` PCCP anomalies from the 10 Jun run — FDA-sync discovery backlog (submissions not yet in `device_external_ids`), not a dedup regression; the apply's invariant confirmed all 1,425 submissions still resolve to one in-scope device. They self-resolve once FDA sync discovers them. (c) **EUDAMED devices with empty `tradeName.texts[]`** (no retrievable name even post-BUG-015) — a source limitation, not a defect; they Dice-zero and queue without a candidate.
