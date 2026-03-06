# Aletia Index
**Clinical assurance for digital health tools.**

The Aletia Index is a specialised Regulatory Information Management (RIM) and Clinical Trust platform. It serves as a "Seal of Approval" for Artificial Intelligence and Machine Learning-enabled Medical Devices (AI/ML-MD). By bridging the gap between regulatory clearance and real-world clinical utility, it provides a transparent, data-driven environment for clinicians, NGOs, and manufacturers.

- **Live site:** https://www.aletia-index.com
- **Staging:** https://aletia-index.vercel.app
- **Repository:** https://github.com/AnnMaidment/Aletia-Index

---

## What This Is

A searchable, publicly accessible index of AI/ML medical devices. Each device listing shows:

- Regulatory clearance status (FDA, MHRA, CE Mark, SAHPRA)
- Accountability tier (Level 1–5, from Clinical Decision Support to Autonomous Action)
- Aletia Verified badge (awarded after human-in-the-loop clinical audit)
- Green / Amber / Red health status
- Data freshness timestamps (automated sync vs last clinical review)

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | Next.js 16 + TypeScript | Web application framework |
| Styling | Inline CSS per component | See Styling Architecture below |
| Database | PostgreSQL via Supabase | Device, manufacturer, audit data |
| Auth | Supabase Auth (planned) | Manufacturer & auditor logins |
| Payments | Stripe (planned) | Audit fees & subscriptions |
| Hosting | Vercel | Automatic deployment from GitHub |
| Domain | Hostinger → Vercel DNS | aletia-index.com |

---

## Project Structure

```
aletia-index/
├── app/
│   ├── page.tsx                  # Main public index page (device listings)
│   ├── layout.tsx                # Root layout (fonts, metadata, OG tags)
│   ├── globals.css               # Global styles (currently minimal)
│   ├── api/
│   │   └── fda-sync/
│   │       └── route.ts          # Multi-jurisdiction sync API endpoint
│   ├── methodology/
│   ├── insights/
│   ├── clinicians/
│   └── request-review/
├── components/
│   └── NavFooter.tsx             # Shared nav and footer component
├── lib/
│   ├── supabase.ts               # Supabase client initialisation
│   ├── fda.ts                    # openFDA API service layer
│   ├── fdaSync.ts                # FDA → Supabase data translator
│   ├── mhra.ts                   # MHRA PARD API service layer
│   ├── mhraSync.ts               # MHRA → Supabase data translator
│   ├── eudamed.ts                # EUDAMED API (on-demand lookup only — see below)
│   └── eudamedSync.ts            # EUDAMED sync helpers
├── docs/
│   └── MHRA_MANUFACTURER_ENRICHMENT.md  # Manual enrichment tracker
├── public/
│   └── assets/                   # Logo, favicon, OG image (lowercase filenames)
├── .env.local                    # Environment variables (NOT in git)
└── README.md
```

---

## Styling Architecture

CSS is written as inline `<style>` blocks inside each page component rather than a shared stylesheet. This was intentional for rapid prototyping.

**Known limitation:** Styles are duplicated across pages. Changes to colour or font size must be made in every file.

**Planned improvement:** Consolidate all shared styles into `app/globals.css`.

CSS variables (consistent across all files):
```css
--primary: #1f6feb   /* main blue */
--bg:      #f5f7fb   /* page background */
--text:    #0f172a   /* dark text */
--muted:   #64748b   /* grey text */
--line:    #e6ebf3   /* border colour */
```

---

## Database Schema

Six tables in PostgreSQL (hosted on Supabase):

### MANUFACTURERS
| Column | Type | Notes |
|---|---|---|
| id | UUID, PK | |
| name | text | |
| hq_location | text | |
| status | text | Verified / Unverified |
| payment | text | Stripe customer ID — future billing |

### SPECIALTY_TAXONOMY
| Column | Type | Notes |
|---|---|---|
| specialty_name | PK | |
| parent_cat | text | e.g. Psychiatry → Mental Health |

### DEVICE_MASTER
Central table. One row per device.

| Column | Type | Notes |
|---|---|---|
| device_id | PK | FDA K number, MHRA-{ID}, etc. |
| manufacturer_link | FK → manufacturers | nullable |
| manufacturer_name | text | Plain text name — used for MHRA devices pending FK enrichment |
| specialty_link | FK → specialty_taxonomy | nullable |
| mode | text | Standalone / Integrated |
| dependency | text | EHR / Hardware / Cloud |
| autonomy | text | Solo / Assistant |
| intended_use | text | |
| ai_ml_type | text | Locked / Continuous Learning |
| accountability_tier | int | 1–5 |
| health_status | text | Green / Amber / Red |
| aletia_verified | boolean | |
| country_of_origin | text | 'US', 'GB', 'EU', 'ZA' |
| basic_udi_ulid | text | EUDAMED UDI — for on-demand EU lookup |
| udi | text | **Cross-jurisdiction UDI** — see UDI note below |
| last_automated_sync | timestamptz | |
| last_clinical_review | timestamptz | |

### REGIONAL_REGISTRATIONS
One row per jurisdiction per device. A device cleared in UK and US has two rows.

| Column | Type | Notes |
|---|---|---|
| reg_id | UUID, PK | |
| device_link | FK → device_master | |
| country | text | 'US', 'GB', 'EU', 'ZA' |
| regulatory_body | text | FDA / MHRA / CE Mark / SAHPRA |
| clearance_type | text | 510k / PMA / De Novo / UKCA / MDR / MDD / Acknowledgement Letter / Full Registration |
| device_class | text | Class I / IIa / IIb / III — populated by MHRA sync |
| gmdn_code | text | GMDN code — populated by MHRA sync |
| gmdn_term | text | GMDN term name — populated by MHRA sync |
| last_updated | timestamptz | Last update from source registry |
| regulatory_expiry | timestamptz | ⚠️ RED FLAG — alert when expiring |
| local_distributor | text | |

Unique constraint: `(device_link, country, regulatory_body)`

### CLINICAL_AUDITS
| Column | Type | Notes |
|---|---|---|
| audit_id | UUID, PK | |
| device_link | FK → device_master | |
| evidence_review_date | timestamptz | ⚠️ RED FLAG — alert when stale |
| confidence_score | int | 1–10 |
| evidence_log | text | PDF / links |
| [checklist scores] | int | 10-point checklist |

### TECH_SPECS
| Column | Type | Notes |
|---|---|---|
| device_link | PK/FK → device_master | |
| api_type | text | FHIR / REST |
| ehr_compat | text | Epic, TrakCare, etc. |
| data_hosting | text | Local / Cloud |
| fhir_compatible | boolean | |
| popia_compliant | boolean | |

---

## API Integrations

### Jurisdiction Overview

| Regulatory Body | Country | Clearance Types | Status |
|---|---|---|---|
| FDA | US | 510k, PMA, De Novo | ✅ Production |
| MHRA | GB | UKCA (Class I–III) | ✅ Production |
| CE Mark | EU | MDR, MDD | ⚠️ On-demand lookup only |
| SAHPRA | ZA | Acknowledgement Letter, Full Registration | ⬜ Planned |

---

### FDA Integration

**Source:** openFDA API — https://open.fda.gov/apis/device/

**Scope:** Class II and Class III AI/ML devices only. Class I excluded.

**Files:**
- `lib/fda.ts` — API service layer. Key functions:
  - `get510kByKNumber(kNumber)` — look up a 510(k) clearance
  - `getPMAByNumber(pmaNumber)` — look up a PMA
  - `getRecallsByKNumber(kNumber)` — get active recalls
  - `getAdverseEventCount(deviceName)` — get MDR count (post-market signal)
  - `getClassificationByProductCode(productCode)` — get device class
  - `searchAIMLDevices()` — fetch all AI/ML devices (up to 1000)
  - `searchAIMLByProductCodes()` — fetch by known AI/ML product codes

- `lib/fdaSync.ts` — Data translator. Key functions:
  - `syncDeviceFromFDA(deviceId, { k_number?, pma_number? })` — sync single device
  - `bulkSyncAllDevices()` — sync all FDA devices in database

**Health status logic:**
- 🔴 Red — active recall present
- 🟡 Amber — adverse event count exceeds 50 MDRs
- 🟢 Green — no signals

---

### MHRA PARD Integration

**Source:** MHRA Public Access Registration Database — https://pard.mhra.gov.uk

**Scope:** AI/ML SaMD devices registered in Great Britain under UK MDR 2002. Covers Class I–III and IVDs.

**How it works:** PARD is queried using a curated list of ~35 GMDN (Global Medical Device Nomenclature) terms. The API requires exact lowercase term matches. Devices are filtered to active registrations (`DREGIY` status) and excludes custom-made devices.

**Files:**
- `lib/mhra.ts` — API service layer. Key functions:
  - `searchMhraDevicesByGmdn(gmdnTerm)` — fetch devices by GMDN term
  - `searchAllMhraAIMLDevices()` — loop all 35 curated terms, deduplicate
  - `searchMhraManufacturer(name)` — manufacturer lookup by name
  - `MHRA_AIML_GMDN_TERMS` — exported array of curated GMDN terms

- `lib/mhraSync.ts` — Data translator. Key functions:
  - `syncDeviceFromMHRA(device, manufacturer)` — sync single device
  - `bulkSyncAllMhraDevices()` — re-sync all MHRA devices in database

**Health status logic:**
- 🔴 Red — registration status is not `DREGIY` (lapsed/suspended)
- 🟡 Amber — active but `LAST_UPDATED_DATE` is more than 2 years ago
- 🟢 Green — active registration, updated within 2 years

**Manufacturer names:** PARD's device API returns `MAN_ORGANISATION_ID` only, not the name. 58 seeded devices currently show as `MHRA Manufacturer {ID}`. Manual enrichment is tracked in `docs/MHRA_MANUFACTURER_ENRICHMENT.md`.

---

### EUDAMED — On-Demand Lookup Only

**Source:** European database on medical devices — https://ec.europa.eu/tools/eudamed

**Why not bulk seeded:** EUDAMED's API does not support reliable filtering for AI/ML devices. Queries return up to 1.2 million devices with no product-code equivalent to filter by device type. Bulk seeding produced irrelevant results (mattresses, pregnancy tests, etc.).

**Current use:** On-demand lookup only. Given a `basic_udi_ulid`, the EUDAMED API can return registration details for a specific device. This is useful for enriching existing records when the UDI is known.

**Files:** `lib/eudamed.ts`, `lib/eudamedSync.ts` — present in codebase, not used for seeding.

---

### The Sync Endpoint

`app/api/fda-sync/route.ts` — secured with `SYNC_SECRET` header `x-sync-token`.

| Method | URL | Action |
|---|---|---|
| GET | `/api/fda-sync` | Health check / endpoint listing |
| GET | `/api/fda-sync?bulk=true` | Re-sync all FDA devices |
| GET | `/api/fda-sync?bulk=true&source=mhra` | Re-sync all MHRA devices |
| GET | `/api/fda-sync?source=eudamed&basic_udi_ulid=X` | On-demand EUDAMED lookup |
| POST | `/api/fda-sync` | Sync single FDA device |
| POST | `/api/fda-sync?source=mhra` | Sync single MHRA device |
| PUT | `/api/fda-sync` | Seed FDA AI/ML devices |
| PUT | `/api/fda-sync?source=mhra` | Seed MHRA AI/ML devices (~35 GMDN queries) |

**PowerShell examples:**
```powershell
# Seed MHRA devices
Invoke-RestMethod -Uri "https://www.aletia-index.com/api/fda-sync?source=mhra" `
  -Method Put `
  -Headers @{"x-sync-token" = "your_secret_here"}

# Sync single MHRA device
Invoke-RestMethod -Uri "https://www.aletia-index.com/api/fda-sync?source=mhra" `
  -Method Post `
  -ContentType "application/json" `
  -Headers @{"x-sync-token" = "your_secret_here"} `
  -Body '{"device_id": "MHRA-169275", "gmdn_term": "retinal image analysis software"}'

# Seed FDA devices
Invoke-RestMethod -Uri "https://www.aletia-index.com/api/fda-sync" `
  -Method Put `
  -Headers @{"x-sync-token" = "your_secret_here"}
```

---

## Cross-Jurisdiction Device Matching (Future)

Different registries use different identifiers — FDA uses K numbers, MHRA uses numeric DEVICE_IDs. There is no direct shared key today.

**The future bridge is UDI (Unique Device Identifier).** The US, UK, EU, and most major markets are converging on UDI as a global standard. A device cleared in both the UK and US should carry the same UDI across both registries.

`device_master` has a `udi` column (nullable text) reserved for this purpose. When UDI data becomes available from MHRA PARD or other sources, it will enable grouping multiple `regional_registrations` rows under a single canonical device identity — supporting a UI that shows "this device is cleared in US + UK + EU" as a unified listing.

GMDN codes (present in `regional_registrations`) provide a weaker but available cross-jurisdiction link at the device *type* level today.

---

## Getting Started (Local Development)

### Prerequisites
- Node.js v20+ — https://nodejs.org
- Git — https://git-scm.com
- A Supabase account — https://supabase.com

### 1. Clone the repository
```bash
git clone https://github.com/AnnMaidment/Aletia-Index.git
cd Aletia-Index
```

### 2. Install dependencies
```bash
npm install
```

### 3. Set up environment variables
Create a `.env.local` file in the root:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_publishable_key_here
OPENFDA_API_KEY=your_fda_api_key_here
SYNC_SECRET=your_sync_secret_here
```

### 4. Run the development server
```bash
npm run dev
```
Open http://localhost:3000.

---

## Deployment

The project auto-deploys to Vercel on every push to `main`.

Environment variables must also be set in Vercel: Dashboard → Project → Settings → Environment Variables.

| Variable | Where to get it | Required |
|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL | Supabase → Settings → API | Yes |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Supabase → Settings → API Keys | Yes |
| OPENFDA_API_KEY | https://open.fda.gov/apis/authentication/ | Recommended |
| SYNC_SECRET | Any long random string you choose | Yes (production) |

---

## Branching Strategy

Never push directly to `main`. Always work on a feature branch and merge via pull request.

```
main              ← production (auto-deploys to Vercel)
dev               ← staging (test here before merging to main)
feature/xxx       ← individual features (branch from dev or main)
```

```bash
# Start new work
git checkout main
git pull origin main
git checkout -b feature/my-feature

# Save progress
git add .
git commit -m "feat: description"
git push origin feature/my-feature

# Then open PR on GitHub → merge → Vercel deploys
```

---

## Roadmap

### V1 ✅ Complete
- Public searchable device index
- Supabase database with real schema
- Device detail modal
- Search and filter by specialty and status
- Deployed to Vercel with custom domain
- All navigation pages (Methodology, Insights, Clinicians, Request Review)

### V2 ✅ / ⬜ In Progress
- ✅ openFDA API integration — 114 real AI/ML devices seeded
- ✅ MHRA PARD integration — 58 UK AI/ML devices seeded
- ✅ Multi-jurisdiction registration support
- ✅ `country_of_origin` and `manufacturer_name` fields on device_master
- ✅ `regional_registrations` enriched with GMDN code, term, device class
- ✅ `udi` column added to device_master (reserved for cross-jurisdiction matching)
- ⬜ MHRA manufacturer name enrichment (44 IDs pending — see docs/)
- ⬜ Consolidate CSS into globals.css
- ⬜ Individual device report pages (`/device/[id]`)
- ⬜ About / Privacy / Terms pages
- ⬜ Manufacturer portal (claim and manage device profiles)
- ⬜ Auth (Supabase Auth for manufacturer and auditor roles)

### V3 Future
- ⬜ 10-Point Clinical Assurance Checklist audit workflow
- ⬜ Stripe / Peach Payments integration
- ⬜ SAHPRA integration
- ⬜ Vercel Cron Job for nightly automated sync
- ⬜ Audit trail / change log for device_master updates
- ⬜ Cross-jurisdiction UDI matching (unified device listings across FDA + MHRA + EUDAMED)
- ⬜ API licensing and data watermarking

---

## Key Concepts

**Accountability Tier** — A 1–5 scale classifying how autonomous the AI device is:
- Tier 1: Clinical Decision Support
- Tier 2: Diagnostic Aid
- Tier 3: Diagnostic Decision
- Tier 4: Autonomous Screening
- Tier 5: Autonomous Action

**Dual-Timestamp Logic** — Every device has two timestamps:
- `last_automated_sync` — when the API last updated the record
- `last_clinical_review` — when a human auditor last reviewed it

**Aletia Verified** — A badge awarded only after a human auditor completes the 10-Point Clinical Assurance Checklist. It cannot be self-assigned by manufacturers.

**Health Status** — Automatically derived from registry signals but overridable by human auditors:
- FDA: Red = active recall. Amber = >50 MDRs. Green = no signals.
- MHRA: Red = lapsed registration. Amber = not updated in 2+ years. Green = active and current.

**GMDN** — Global Medical Device Nomenclature. A standardised international coding system for device types. Used by MHRA PARD as the primary search key. Provides a cross-jurisdiction link at the device *type* level (not individual product level).

---

## Access & Credentials

To get access to the project you will need:
- **GitHub** — Ask @AnnMaidment to add you as a collaborator
- **Supabase** — Ask for an invite to the `aletia-index` project
- **Vercel** — Ask for an invite to the `annmaidments-projects` team
- **`.env.local` file** — Shared privately (never committed to git)

---

## Contact

**Project Owner:** Annemarie Maidment
**Email:** annemarie.maidment@gmail.com

*Aletia Index — Independent clinical assurance for digital health tools.*
