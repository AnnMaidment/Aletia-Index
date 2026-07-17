# STATE — Aletia Index

**Rewritten:** 13 July 2026 (session: specialty backbone de-baring, full review + apply)
**Rule:** this file is rewritten fresh at each session end. Code is ground truth; this file is orientation.

---

## Where things stand

The public index (~1,270 shown devices) now has **human-verified specialty coverage across the FDA backbone**. The 8-Jul situation — ~99.6% of shown devices with `specialty_link` null because the bulk-seeded backbone never passed through the accept drawer — is resolved by the de-baring pass: 1,088 devices measured, every writable row human-reviewed, all 1,088 written (see "Specialty pass" below). Null remains the honest value for the ~175 devices whose evidence never rose above brand-name level.

Live Supabase project remains **Aletia-Index-Staging** (`wwianscisjuuzbljprrb`). "Aletia-Index" is stale/retired — do not query it.

## Specialty pass — done this session

**Pipeline (all committed):**
- `lib/specialtyEvidence.ts` — `buildDeviceMasterEvidence()`: master-shaped evidence bundle. Inputs: master name/intended_use/description, FDA-list submission device names, and **openFDA classification device_name + definition per product code** (construct-valid functional descriptions; the FDA advisory panel remains carried-but-never-matched). Product codes are NOT persisted in the DB — they are re-derived at runtime via `device_external_ids` → FDA list CSV.
- `lib/specialtyTaxonomy.ts` — `inferSpecialtyForMaster()`: **channel-aware arbitration**. Radiology matches split into HOME-class (mammography, fracture detection…) vs MODALITY-class (`MASTER_MODALITY_CLASS_SOURCES`: imaging, radiological, x-ray, MRI, CT…). Organ-specific signals beat modality-class Radiology at any level; modality-only evidence → Radiology at MEDIUM flagged `modalityOnly=true`. The queue path `inferSpecialty()` is untouched. A drift-guard fixture fails if the modality-class list falls out of sync with the live Radiology patterns.
- `scripts/debar-specialty-master.ts` (v2) — dry-run emits full report + review workbook; `--apply` REQUIRES `--decisions=<reviewed workbook>` + `--expect=N`; taxonomy pre-validation; snapshot; every update guarded `.is('specialty_link', null)` (fill-nulls only — the script can never overwrite).
- `scripts/test-specialty-inference.ts` — 29 fixtures green (19 original queue + 10 master incl. every spot-check failure mode).
- `specialty-overrides.csv` — **143 rows, committed curation record**: 52 spot-check decisions + 91 full-review decisions + Arterys (13 Jul). Precedence in the script: override > queue-cascade > master text. Future dry-runs reproduce all decisions.
- `debar-specialty-decisions-final.csv` — the applied decision set (1,088 rows, 1,088 writes). Commit alongside the apply snapshot.

**Numbers:** 1,088 workbook rows → Radiology 726, Cardiology 112, Neurology 63, Oncology 31, Gastroenterology 25, Orthopaedics 22, Ophthalmology 21, Pulmonology 17, Pathology 14, Dermatology 12, Urology 10, then the long tail. 805 rows are modality-only platforms (Radiology-medium default). Queue-cascade route resolved 28 devices from approved queue rows (the pre-extractor accepts) after `extract-queue-specialty.ts --status=approved` was run.

## What was learned (do not relearn)

1. **The modality-lane trap.** openFDA classification text is saturated with modality vocabulary ("radiological image processing", "imaging"). Patterns tuned for trial text (where "radiologist" = clinical home) fire on lane vocabulary at high confidence. This is the same construct-validity failure as the rejected panel backfill, re-entering through a new evidence channel. Any future evidence channel must be checked for lane-vs-home vocabulary before matching.
2. **First-specialty-wins was a bug at equal confidence.** Radiology listed first meant generic "imaging" beat genuine organ signals at the same level (NaviCam). Arbitration now collects all matches and pools organ-specific + home-class above modality-class.
3. **"General-purpose imaging" is NOT a specialty.** Decision (13 Jul, backed by FDA/GMDN/EMDN structure): clinical specialty and imaging role/modality are separate axes. Modality buckets do not enter `specialty_taxonomy`. The `modality_only` flag in the report is the ready-made candidate list for a future "imaging role" axis (own spec, own schema — deferred).
4. **The review rule set** (now precedent, applied to 1,088 rows): *detection/triage on imaging → Radiology; disease-pathway quantification → organ specialty; surgical/therapy planning → organ specialty; tumour/RT segmentation → Oncology; fetal heart US → Obstetrics & Gynaecology.* Reviewer exceptions on file: AI-Rad Brain/Prostate modules and ScanDiags kept Radiology; CAC scoring kept Radiology (vs coronary plaque → Cardiology).
5. **Nuclear medicine bundles** (syngo.via MI/Scenium/MBF): Radiology as organizational home absent a Nuclear Medicine taxonomy value.
6. **Brand names carry machine-invisible signal** (Vivid=echo, NeuroQuant=brain). Only overrides capture these — hence the overrides file is load-bearing curation, not convenience.
7. **`extract-queue-specialty.ts` env fix re-landed**: bare `import 'dotenv/config'` → explicit `.env.local` load. The 8-Jul STATE recorded this as done but the committed file didn't have it. Verify claimed fixes against committed code.

## Corrections to the 8-Jul STATE

- **EUDAMED candidate recompute is COMMITTED and APPLIED** (commit `971688b`, applied 12 Jun, 0-change dry-run verified). The 8-Jul rewrite regressed to an earlier draft claiming it was uncommitted with a 159/68 split. Correct queue state: **186 single-candidate + 41 multi-candidate**.
- Tier-1 docs were committed with browser suffixes: rename `STATE (14).md` → `STATE.md`, `KNOWN-BUGS (10).md` → `KNOWN-BUGS.md`.

## Next priorities (agreed sequencing, 8 Jul session)

1. **Ingest-hardening batch** — unblocks all crons:
   a. **Status-aware queue dedup** (`lib/ingestion.ts` step 2 checks `status='pending'` only → rejected rows re-queue on every re-run; human decisions are not durable). Highest-leverage single fix.
   b. **CT.gov scope classifier** (`lib/ctgovScope.ts`): integrality bar, stimulation-literature hard exclusions, drop bare `'neural network'`; **validate against the 487 labelled rows in `scope-decisions.csv`** (confusion matrix; high tier gated on ~zero false inclusions). Tiered gate: out_of_scope dropped, in_scope_low queued, in_scope_high+commercial+no-candidates may auto-create with inline specialty extraction. Auto-create survives only if validation earns it.
   c. **MHRA posture fix**: `autoCreate=false`, no blanket `ai_ml_integral=true` (GMDN software-category terms are not AI categories) + **one-off audit of the 58 bulk-created MHRA devices** (probe workbook → review → exclusions with dry-run/--expect).
   d. **BUG-013**: PMA supplement IDs dropped in `pccpIngest` normaliser. Fix before PCCP cron. O'Leary URLs also 404 (`…/202408-pccp/data/…` path).
   e. **Breakthrough probe**: read-only scan for `BREAKTHROUGH:%` pre-approval rows stamped `ai_ml_integral=true` (route has NO AI filter — worse than MHRA). Route stays parked; do not cron.
2. **Queue grind**: EUDAMED drawer (186 single → 41 multi), FDA Band B+C (80 rows), then HAIR Step 1b (write reconcile results to queue) and Step 1c recall measurement. EUDAMED backfill window closes **Nov 2026** — EU-only discovery stays gated behind this.
3. **Cron wiring** (`vercel.json`, `CRON_SECRET`, re-enable commented-out route auth on CT.gov/breakthrough): FDA + EUDAMED + MHRA monthly, PCCP fortnightly, CT.gov monthly post-classifier. FDA cron recipe: re-pull list → ingest → `fda-dedup-detect` dry-run as hygiene.
4. **Backlog observation** (from the de-baring scan): same-name device families beyond the queued 80 look like Band-B/C dedup candidates — AI-Rad Companion pairs, EchoPAC ×3, syngo.CT Lung CAD ×3, icobrain, Quantib Brain, UNiD ×2, BoneMRI ×2, InferRead ×2, LiverMultiScan ×3. Specialty is internally consistent within each family, so merges won't fork it.
5. **Future feature (own spec, not now):** imaging-role / modality axis alongside clinical specialty. Candidate list = `modality_only` rows in the debar report.

## Invariants (standing)

- `aletia_id` stability is load-bearing. **No wipe-and-reingest** — decided 8 Jul against a full re-ingest: fix filters at source, re-run idempotently through the 4d gate, preserve identity + curation.
- Provenance registers never blend. Null is the honest default; the specialty pass fills nulls only and never overwrites.
- Dry-run → snapshot → `--apply --expect N` for every bulk write. "Done" = committed to `main` + verified in production.
- False positives worse than duplicates; ambiguity goes to the queue, not to auto-writes.
