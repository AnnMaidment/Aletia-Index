# Aletia Index

**Clinical assurance for digital health tools.**

The Aletia Index is a Regulatory Information Management and clinical-trust platform for AI and machine-learning enabled medical devices. It resolves the same device across jurisdictions to one canonical identity and shows where it is cleared, where it is not, and what has happened to it since.

- **Live site:** https://www.aletia-index.com
- **Repository:** https://github.com/AnnMaidment/Aletia-Index

---

## How to read this file

This is **Tier 2** documentation under `DOCS.md`: architecture and onboarding — the picture for someone new to the project. It changes when the architecture genuinely changes, not every session.

For where the project is *right now*, read `STATE.md`, then `TODO.md`, then `KNOWN-BUGS.md`. Those are Tier 1 and are rewritten every session.

**When this file disagrees with the code, the code is right.** Order of authority: code → STATE → TODO / KNOWN-BUGS → this README → specs → archive. For schema questions specifically, `supabase/migrations/` beats the schema section below.

*Restored 26 August 2026. The previous version was deleted on 1 June (`3f36864`) and had drifted three months out of date — it reported roughly 5,100 devices when the real figure was a quarter of that, and it listed row-level security as future work. Both errors mattered; see the history note at the foot of this file.*

---

## What this is

A searchable, public index of AI/ML medical devices. Each listing carries:

- Regulatory clearance status across jurisdictions (FDA, MHRA, EU MDR / EUDAMED; SAHPRA planned)
- Every external identifier the device holds — FDA K-numbers, De Novo and PMA numbers, MHRA device IDs, EUDAMED UDI-DIs, clinical-trial NCT numbers — unified under one canonical Aletia ID
- Accountability tier (1–5, Clinical Decision Support through Autonomous Action)
- Aletia Verified badge, awarded only after a human clinical audit
- Green / Amber / Red health status derived from registry signals
- Data freshness — automated sync timestamp against last clinical review
- Clinical-trial history, pipeline stage for pre-clearance devices, PCCP authorisation status

The defining idea: **one device, one canonical identity, many external identifiers.** A tool cleared by the FDA in 2022, registered with the MHRA in 2023 and running three trials in 2024 is one device with one Aletia ID and many attached identifiers — not five listings.

**Scale, as of 26 August 2026:** roughly 1,270 devices shown publicly — about 1,175 FDA-attached, 58 MHRA, a small EU set — plus 307 rows awaiting review in the ingestion queue. If you have seen a figure near 5,000 anywhere, it predates the June 2026 FDA rebuild, which replaced a keyword proxy with the FDA's own published AI/ML list and pruned the over-capture (BUG-012), and the same-product dedup that followed.

---

## Tech stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | Next.js 16 + TypeScript | Server components, URL-driven filtering |
| Styling | `app/globals.css` + per-page inline blocks | See Styling |
| Database | PostgreSQL via Supabase | Devices, registrations, trials, audits |
| Auth | Supabase Auth | Manufacturer claim accounts; admin access |
| Email | Resend | Claim-flow token delivery |
| Hosting | Vercel | Auto-deploys from `main` |

---

## Project structure

```
aletia-index/
├── app/
│   ├── page.tsx                  # Public index — server component, URL-driven filtering
│   ├── layout.tsx · globals.css · sitemap.ts · robots.ts
│   ├── components/               # Client islands: FiltersBar, DeviceGrid, QuickFilters,
│   │                             #   MobileMenu, AutonomousBadge
│   ├── device/[id]/              # Canonical device page; 308-redirects legacy IDs
│   │   ├── page.tsx · shared.tsx · PreApprovalDevicePage.tsx · InterestButton.tsx
│   ├── admin/(protected)/        # queue · claims · overview · audit
│   ├── dashboard/                # Authenticated manufacturer view
│   ├── claim/                    # token landing · request · sent · invalid · already-claimed
│   ├── api/
│   │   ├── claim/                # request · complete · send · status
│   │   ├── admin/queue/          # accept · reject · duplicate · candidates ·
│   │   │                         #   merge-preview · dedup-merge · note · extract-specialty
│   │   ├── admin/claims/         # approve · reject
│   │   ├── fda-sync/             # FDA, and MHRA via ?source=mhra
│   │   ├── eudamed-sync/         # EUDAMED discovery + ingest
│   │   ├── pccp-ingest/ · queue-sync/ · breakthrough-ingest/ · clinical-trials-ingest/
│   ├── about/ · methodology/ · insights/ · clinicians/ · regulators/ · request-review/
│   └── privacy/ · terms/
├── components/NavFooter.tsx
├── lib/
│   ├── supabase.ts · supabase-admin.ts   # Publishable (SSR-safe) + secret-key clients
│   ├── ingestion.ts                      # The 4d gate — processExternalIdentifier
│   ├── matchingCandidates.ts · matchManufacturer.ts
│   ├── fda.ts · fdaList.ts · fdaSync.ts · fdaDedup.ts
│   ├── mhra.ts · mhraSync.ts
│   ├── eudamed.ts · eudamedList.ts · eudamedSync.ts · scarletEudamedQuery.ts
│   ├── clinicalTrials.ts · clinicalTrialsIngest.ts
│   ├── pccpIngest.ts · breakthroughIngest.ts
│   ├── specialtyTaxonomy.ts · specialtyEvidence.ts · extractQueueSpecialty.ts
│   ├── displayName.ts · mergeDiff.ts · filterState.ts · identifierNormalisation.ts
│   ├── adminAudit.ts · 11_proxy.ts · email.ts · types.ts
├── scripts/                              # Probes, seeds, one-shot migrations, fixtures
├── supabase/migrations/                  # Schema source of truth
└── .env.local                            # Never committed
```

---

## Styling

Shared CSS lives in `app/globals.css`; content pages carry a small inline block. The palette:

```css
--primary: #1f6feb   /* main blue */
--bg:      #f5f7fb   /* page background */
--text:    #0f172a   /* dark text */
--muted:   #64748b   /* grey text */
--line:    #e6ebf3   /* border colour */
```

---

## Database schema

The authoritative schema is the timestamped migration set in `supabase/migrations/`. What follows is orientation.

### `device_master`
One row per device. PK `aletia_id`, format `ALT-NNNNNN`, allocated by `aletia_id_seq`.

Fields worth knowing: `external_legacy_id` (denormalised mirror of the primary external ID), `name`, `manufacturer_link` / `manufacturer_name`, `description` (added 3 June), `intended_use`, `specialty_link`, `search_vector` (GIN-indexed generated column), `ai_ml_integral`, `accountability_tier`, `health_status`, `aletia_verified`, `approval_status`, `pipeline_stage`, `data_source`, PCCP and breakthrough fields, claim-flow state, and the two freshness timestamps.

**Two columns are load-bearing on every public read** and are easy to forget:

- `excluded` — soft-delete for out-of-scope rows
- `merged_into` — non-null means this row was absorbed into another as a same-product duplicate (added 10 June)

Public queries must filter **both** `excluded = false` **and** `merged_into IS NULL`. Omitting either resurrects rows that should not be visible.

### `device_external_ids`
One row per external identifier. **The single source of truth for identifier-to-device resolution.** Unique on `(id_type, id_value)`; exactly one `is_primary` per device, trigger-enforced.

`id_type` values: `fda_k_number`, `fda_de_novo`, `fda_pma`, `mhra_device_id`, `eudamed_udi_di`, `ce_certificate`, `eudamed_basic_udi`, `nct`, `udi_di`, `scarlet_pccp_id`, `legacy_unclassified`, plus reserved values for Health Canada, TGA and PMDA.

Values are stored as the source emits them: K-numbers keep their `K`, NCTs keep `NCT`, MHRA IDs are raw numerics with no prefix. PMA **supplements** are the exception — `P190016/S007` resolves to its base `P190016`, because identity belongs to the device and the supplement is history about it (`lib/fdaSubmissionId.ts`).

### `device_trials`
One row per trial per device. Unique on `(aletia_id, nct_id)` for UPSERT; a partial unique on `(aletia_id) WHERE nct_id IS NULL` prevents duplicate null-NCT rows.

### `regional_registrations`
One row per jurisdiction per device. `device_link` is an `aletia_id` — the column name predates A2a. Carries `external_id_value` as a denormalised pointer, plus GMDN terms, expiry, recall and adverse-event fields.

### `ingestion_review_queue`
Staging for discovered devices that did not exact-match. `status` is one of `pending` / `approved` / `rejected` / `duplicate`, with `possible_merge_candidates` holding the scored candidate array.

Note the partial unique index: `(source, source_id) WHERE status = 'pending'` — one *open* row per identifier, with any number of terminal rows alongside it.

### `ingestion_anomalies`
Observability bus for ingest paths meeting data shapes they did not expect.

### Others
`manufacturers`, `specialty_taxonomy`, `clinical_audits`, `tech_specs`, `claim_requests`, `pre_approval_profile`, `admin_users`, `audit_log`, `ingest_runs`.

### Row-level security

**RLS is enabled on every table in the `public` schema** (migration `20260826120000_enable_rls.sql`). This is not optional configuration and not a future feature:

- Eight tables carry a permissive `SELECT` policy because the public site reads them. Five are reached *only* as PostgREST embedded selects from `/device/[id]` — `manufacturers`, `regional_registrations`, `tech_specs`, `clinical_audits`, `pre_approval_profile`, `device_trials`. An embed needs read access on the embedded table, so a missing policy blanks that section of the page rather than raising an error.
- `ingestion_review_queue`, `ingestion_anomalies` and `specialty_taxonomy` have RLS and **no policies** — sealed to everything except `service_role`, which bypasses RLS.
- `claim_requests` keeps public select and insert to support the claim flow. See KNOWN-BUGS: that select policy exposes claim tokens and should be closed.

Adding a table means adding its policy in the same migration. A table with RLS on and no policy is invisible to the public key; a table with RLS off is writable by anyone holding the publishable key, which ships in the browser bundle by design.

---

## Core architectural concepts

### 1. Aletia ID = canonical device identity

Every device is `ALT-NNNNNN`, allocated by a database sequence. External identifiers attach through `device_external_ids`. URLs are canonical at `/device/ALT-NNNNNN`; any legacy identifier URL 308-redirects, preserving inbound links from pre-A2b references.

**Device-level identity, submission-level history.** The FDA list is one row per *submission*, so a product cleared four times produced four Aletia IDs. The June 2026 dedup collapses those to one survivor — earliest clearance wins — carrying the rest as secondary identifiers with `merged_into` set on the absorbed rows.

### 2. The 4d gate — never auto-merge without an exact match

Every discovery-capable path goes through `lib/ingestion.ts → processExternalIdentifier`:

1. **Exact `(id_type, id_value)` hit** → bump `last_seen_at`, return `updated_existing`.
2. **A queue row already exists** for this `(source, source_id)` → `already_queued` if it is still pending; `skipped_prior_decision` if a human already rejected, duplicated or approved it.
3. **Compute merge candidates** — manufacturer match plus Dice coefficient on the device name.
4. **Candidates exist, or `autoCreate` is false** → insert a queue row and return `queued_for_review`.
5. **No candidates and auto-create allowed** → `create_device_atomic` allocates an ID and inserts device, identifier and optional trial in one transaction.

The discipline: an exact identifier match is the only thing that auto-resolves. **False positives are worse than duplicates** — a bad merge corrupts identity, a duplicate is recoverable.

Step 2's status-awareness matters more than it looks. It used to check only `status = 'pending'`, so a rejected row was invisible to the next sweep and the same candidate came back on every run, forever.

### 3. Inclusion standard

A device belongs in the index **only if it is AI/ML by the relevant regulator's own classification.** Every proxy for that judgement has failed at least once:

- **FDA** — membership of the FDA's published AI/ML list. A hand-maintained product-code and keyword proxy over- and under-captured in both directions (BUG-012).
- **EUDAMED** — no AI flag exists, so an EMDN code allow-list (`lib/eudamedList.ts`) proposes candidates. Heuristic-only matches are *queued*, never auto-included.
- **MHRA** — the GMDN term list is a **software** filter, not an AI filter. `ophthalmology pacs software` and `ct system application software` are on it. The MHRA path therefore queues rather than creates.
- **CT.gov** — `lib/ctgovScope.ts` applies an integrality bar: the AI must be integral to the *device under study*. Bare `neural network` is not evidence; in an fMRI trial it means the brain.

The recurring failure is the same each time: vocabulary mistaken for function. Check any new evidence channel for it before trusting it.

### 4. `create_device_atomic`

A plpgsql function wrapping the device, identifier and optional trial inserts in one transaction, replacing an earlier non-transactional pattern that produced orphan rows. **Note its default:** `COALESCE((p_device->>'ai_ml_integral')::boolean, true)` — omitting the field yields `true`, so a path that declines to make an AI claim must pass `false` explicitly.

### 5. `pipeline_stage` and `approval_status` are independent

`approval_status` (`approved` / `pre_approval`) selects the page template. `pipeline_stage` is null for cleared devices and drives the pipeline stepper otherwise. A device is in pipeline iff it has no regulatory approval anywhere; the first approval in any jurisdiction graduates it by setting `pipeline_stage = null`, and every sync path now applies that rule.

### 6. Accountability tier (1–5)

Clinical Decision Support · Diagnostic Aid · Diagnostic Decision · Autonomous Screening · Autonomous Action.

### 7. Dual-timestamp freshness

`last_automated_sync` against `last_clinical_review`. The gap is displayed as a trust signal.

### 8. Health status

FDA: Red on an active recall, Amber above 50 MDRs, Green otherwise. MHRA: Red for a lapsed registration, Amber if untouched for two years, Green if current.

### 9. Provenance registers never blend

Regulator-sourced, Aletia-verified and manufacturer-attested facts render distinctly and are never merged. Provenance itself is not public. Null is the honest default — the specialty backfill fills nulls only and never overwrites.

---

## API integrations

| Body | Country | Clearance types | Status |
|---|---|---|---|
| FDA | US | 510(k), De Novo, PMA | Production |
| MHRA | GB | UKCA | Production — discovery queues, does not auto-create |
| EUDAMED | EU | MDR, MDD | Partial — 227 crosswalk rows in review; NB/certificate data not yet retrievable |
| SAHPRA | ZA | — | Planned |

**FDA** — openFDA plus the FDA's published AI/ML device list (`lib/fdaList.ts`), which is the authoritative seed. Paginated across 510(k), De Novo and PMA.

**MHRA PARD** — raw numeric IDs stored without a prefix; legacy `/device/MHRA-47392` URLs redirect via `identifierNormalisation`.

**EUDAMED** — `lib/eudamed.ts`. Several name-like fields arrive as a localised-text envelope (`{ textByDefaultLanguage, texts[] }`) rather than a string; `extractLocalisedText()` resolves them. Some devices have an empty `texts[]` and are simply un-nameable from the public surface — a source-side floor on crosswalk recall, not a defect.

**ClinicalTrials.gov** — scope-classified before ingest; see the inclusion standard above.

**PCCP** — Brendan O'Leary's bi-weekly CSV, joined through `device_external_ids`. The URLs need re-verification; they have been reported 404ing.

### Sync endpoints

Protected by `SYNC_SECRET` (header `x-sync-token`) or `CRON_SECRET`. **No `vercel.json` exists yet** — nothing is scheduled, and every route is triggered by hand. Cron rollout is gated on the ingest-hardening batch; see `TODO.md`.

---

## Local development

**Prerequisites:** Node 20+, Git, a Supabase account.

```bash
git clone https://github.com/AnnMaidment/Aletia-Index.git
cd Aletia-Index
npm install
```

Create `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
OPENFDA_API_KEY=...
SYNC_SECRET=long_random_string
CRON_SECRET=long_random_string
RESEND_API_KEY=re_...
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

**On the Supabase keys.** The variable names still say `ANON` and `SERVICE_ROLE`, but the values are the newer **publishable** (`sb_publishable_…`) and **secret** (`sb_secret_…`) keys from Settings → API Keys → *Publishable and secret API keys*. The legacy JWT anon and service_role keys have been deactivated on this project and cannot be rotated in place — Supabase removed that capability. Do not go looking for a `service_role` key to copy; there isn't one any more.

The publishable key is safe in the browser **because RLS protects the tables**, not because the key is secret. It ships in the client bundle by design.

`lib/supabase-admin.ts` holds the secret key and bypasses RLS. **Never import it into a client component.**

```bash
npm run dev            # http://localhost:3000
npx tsc --noEmit       # typecheck
npx eslint lib app scripts
```

Fixture suites, all pure and offline:

```bash
npx tsx scripts/test-specialty-inference.ts
npx tsx scripts/test-pccp-submission-ids.ts
npx tsx scripts/test-ctgov-scope.ts
```

**Supabase Auth:** Authentication → Providers → Email → *Confirm email* must be **off**, so claim completion can establish a session immediately.

**Migrations:** `npx supabase db push`. The CLI has been unreliable against this project; the SQL editor is the fallback and has been the normal path for several changes.

---

## Working conventions

Two rules govern anything that writes to the database in bulk:

1. **Dry run → snapshot → `--apply --expect N`.** Every bulk script defaults to a dry run, writes a rollback pre-image before its first write, and refuses to apply unless the caller states the expected row count. If the count moved, the script aborts rather than guessing.
2. **"Done" means committed to `main` and verified in production.** Discussed, intended, merged to a branch or applied locally do not count.

And one that governs identity: `aletia_id` stability is load-bearing. There is no wipe-and-reingest. Filters get fixed at source and re-run idempotently through the 4d gate, preserving identity and curation.

---

## Deployment

Auto-deploys to Vercel from `main`; feature branches get preview URLs.

Environment variables are scoped separately for Production and Preview — a value updated in one scope only will fail in the other. In Vercel's variable editor, `NEXT_PUBLIC_*` variables must be typed **Config**, not Secret: the prefix means the value is compiled into the browser bundle, and Vercel will not let a public-prefixed variable be write-only.

To send from `noreply@aletia-index.com`, verify the domain in Resend and add the DNS records.

---

## Branching

```
main              ← production, auto-deploys
feature/xxx       ← branch off main, PR, merge
```

---

## Key concepts at a glance

**Aletia ID** — canonical device identity, `ALT-NNNNNN`.
**External identifier** — any non-Aletia identifier, attached via `device_external_ids`. One device, many.
**4d gate** — shared ingestion discipline. Exact match auto-resolves; everything fuzzy goes to review.
**Inclusion standard** — AI/ML by the regulator's own classification, never by keyword.
**Approval status** — `approved` / `pre_approval`; selects the page template.
**Pipeline stage** — null once cleared anywhere.
**Accountability tier** — 1–5 autonomy scale.
**Dual-timestamp logic** — sync time against review time, shown as freshness.
**Aletia Verified** — human-audit badge, not self-assignable.
**PCCP status** — `approved` / `not_submitted` / `not_applicable_jurisdiction` / `unknown`.
**`merged_into`** — this row was absorbed into another; must be filtered out of every public read.

---

## Roadmap

Deliberately short. `TODO.md` is the backlog; a roadmap duplicated here rots and then misleads — the version of this file deleted in June listed RLS as a "Later" item while twelve tables sat unprotected.

**Now:** ingest hardening, then cron wiring. **Next:** the EUDAMED review queue, before the legacy backfill window closes in November 2026. **Later:** SAHPRA, the startup portal, the RP/NB directory, the evidence-gate work.

---

## Access

- **GitHub** — ask @AnnMaidment for a collaborator invite
- **Supabase / Vercel** — ask for a project invite
- **`.env.local`** — shared privately, never committed

---

## History note

This README was deleted on 1 June 2026 and restored on 26 August. The version it replaces had drifted about three months behind the code, and two of its errors were not merely stale but harmful: it reported roughly 5,100 live devices when the true figure was about 1,270, and it listed row-level security under future work — while every table in the public schema was in fact writable by anyone holding the publishable key.

The lesson is the one `DOCS.md` already states: **code is ground truth, and a document that is not maintained is worse than no document**, because it is believed. If you are reading this and it disagrees with what you see in the code, the code wins — and please fix this file in the same session.

---

**Project owner:** Annemarie Maidment
*Aletia Index — independent clinical assurance for digital health tools.*
