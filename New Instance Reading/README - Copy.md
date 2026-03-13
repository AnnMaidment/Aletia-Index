# Aletia Index

Clinical assurance for digital health tools.

The Aletia Index is a specialised Regulatory Information Management (RIM) and Clinical Trust platform. It serves as a "Seal of Approval" for Artificial Intelligence and Machine Learning-enabled Medical Devices (AI/ML-MD). By bridging the gap between FDA/SAHPRA regulatory clearance and real-world clinical utility, it provides a transparent, data-driven environment for clinicians, NGOs, and manufacturers.

- **Live site:** https://www.aletia-index.com
- **Staging:** https://aletia-index.vercel.app
- **Repository:** https://github.com/AnnMaidment/Aletia-Index

---

## What This Is

A searchable, publicly accessible index of AI/ML medical devices. Each device listing shows:

- Regulatory clearance status (FDA, SAHPRA, CE Mark)
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
│   ├── page.tsx               # Main public index page (device listings)
│   ├── layout.tsx             # Root layout (fonts, metadata, OG tags)
│   ├── globals.css            # Global styles (currently minimal)
│   ├── api/
│   │   └── fda-sync/
│   │       └── route.ts       # FDA sync API endpoint
│   ├── methodology/
│   │   └── page.tsx
│   ├── insights/
│   │   └── page.tsx
│   ├── clinicians/
│   │   └── page.tsx
│   └── request-review/
│       └── page.tsx
├── components/
│   └── NavFooter.tsx          # Shared nav and footer component
├── lib/
│   ├── supabase.ts            # Supabase client initialisation
│   ├── fda.ts                 # openFDA API service layer
│   └── fdaSync.ts             # FDA → Supabase data translator
├── public/
│   └── assets/                # Logo, favicon, OG image (lowercase!)
├── .env.local                 # Environment variables (NOT in git)
└── README.md
```

---

## Styling Architecture

CSS is currently written as inline `<style>` blocks inside each page component rather than in a shared stylesheet. This was intentional for rapid prototyping.

**Known limitation:** Styles are duplicated across pages. If you change a colour or font size, you need to update every file.

**Planned improvement:** Consolidate all shared styles into `app/globals.css` so there is a single source of truth for the design system.

The CSS variables (colours, shadows, radii) are consistent across all files:

```css
--primary: #1f6feb    /* main blue */
--bg:      #f5f7fb    /* page background */
--text:    #0f172a    /* dark text */
--muted:   #64748b    /* grey text */
--line:    #e6ebf3    /* border colour */
```

---

## Database Schema

Six tables in PostgreSQL (hosted on Supabase):

```
MANUFACTURERS
├── id (UUID, PK)
├── name
├── hq_location
├── status (Verified / Unverified)
└── payment (Stripe customer ID — for future billing)

SPECIALTY_TAXONOMY
├── specialty_name (PK)
└── parent_cat (e.g. Psychiatry → Mental Health)

DEVICE_MASTER (central table)
├── device_id (PK — matches FDA UDI / K number format)
├── manufacturer_link (FK → manufacturers, nullable)
├── specialty_link (FK → specialty_taxonomy, nullable)
├── mode (Standalone / Integrated)
├── dependency (EHR / Hardware / Cloud)
├── autonomy (Solo / Assistant)
├── intended_use
├── ai_ml_type (Locked / Continuous Learning)
├── accountability_tier (1–5)
├── health_status (Green / Amber / Red)
├── aletia_verified (boolean)
├── country_of_origin (text — e.g. 'US', 'EU', 'ZA')
├── last_automated_sync (timestamp — from FDA API)
└── last_clinical_review (timestamp — from human audit)

REGIONAL_REGISTRATIONS
├── reg_id (UUID, PK)
├── device_link (FK → device_master)
├── country
├── regulatory_body (FDA / SAHPRA / CE Mark)
├── clearance_type (510k / PMA / De Novo / MDR / MDD / Acknowledgement Letter / Full Registration)
└── regulatory_expiry ⚠️ RED FLAG — alert when expiring
-- Unique constraint: (device_link, country, regulatory_body)

CLINICAL_AUDITS
├── audit_id (UUID, PK)
├── device_link (FK → device_master)
├── evidence_review_date ⚠️ RED FLAG — alert when stale
├── confidence_score (1–10)
├── evidence_log (PDF / links)
└── 10-point checklist scores (peer review, demographics, etc.)

TECH_SPECS
├── device_link (PK/FK → device_master)
├── api_type (FHIR / REST)
├── ehr_compat (Epic, TrakCare, etc.)
├── data_hosting (Local / Cloud)
├── fhir_compatible (boolean)
└── popia_compliant (boolean)
```

---

## FDA API Integration

The Aletia Index integrates with the [openFDA API](https://open.fda.gov/apis/device/) to automatically populate and sync device data.

**Scope:** Class II and Class III AI/ML medical devices only. Class I devices are out of scope.

**Jurisdictions supported:**

| Regulatory Body | Country | Clearance Types |
|---|---|---|
| FDA | US | 510k, PMA, De Novo |
| CE Mark | EU | MDR, MDD |
| SAHPRA | ZA | Acknowledgement Letter, Full Registration |

### Files

**`lib/fda.ts`** — The openFDA API service layer. Handles all HTTP calls to the FDA and returns typed results. Key functions:

- `get510kByKNumber(kNumber)` — look up a 510(k) clearance by K number
- `getPMAByNumber(pmaNumber)` — look up a PMA by PMA number
- `getRecallsByKNumber(kNumber)` — get active recalls for a device
- `getAdverseEventCount(deviceName)` — get total MDR count (post-market signal)
- `getClassificationByProductCode(productCode)` — get device class (rejects Class I)
- `searchAIMLDevices()` — fetch all AI/ML devices from the 510(k) database (up to 1000)
- `searchAIMLByProductCodes()` — fetch by known AI/ML product codes

**`lib/fdaSync.ts`** — The data translator. Maps FDA API responses onto the Supabase schema and writes to `DEVICE_MASTER` and `REGIONAL_REGISTRATIONS`. Key functions:

- `syncDeviceFromFDA(deviceId, { k_number?, pma_number? })` — sync a single device
- `bulkSyncAllDevices()` — sync all FDA-registered devices in the database

**`app/api/fda-sync/route.ts`** — The HTTP endpoint. Secured with `SYNC_SECRET`.

| Method | URL | Action |
|---|---|---|
| GET | `/api/fda-sync` | Health check |
| GET | `/api/fda-sync?bulk=true` | Sync all devices |
| POST | `/api/fda-sync` | Sync a single device |
| PUT | `/api/fda-sync` | Seed database from FDA |

### Health Status Logic

Health status is derived automatically from FDA signals:

- **Red** — active recall present
- **Amber** — adverse event count exceeds 50 MDRs
- **Green** — no signals

Human auditors can override health status at any time.

### Seeding the Database

To pull all AI/ML Class II/III devices from the FDA into the database:

```bash
curl -X PUT https://www.aletia-index.com/api/fda-sync \
  -H "x-sync-token: your_secret_here"
```

Or in PowerShell:

```powershell
Invoke-RestMethod -Uri "https://www.aletia-index.com/api/fda-sync" `
  -Method Put `
  -Headers @{ "x-sync-token" = "your_secret_here" }
```

### Syncing a Single Device

```powershell
Invoke-WebRequest -Uri "https://www.aletia-index.com/api/fda-sync" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"device_id": "K213201", "k_number": "K213201"}' `
  -Headers @{ "x-sync-token" = "your_secret_here" } `
  -UseBasicParsing
```

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

Create a `.env.local` file in the root of the project:

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

Open http://localhost:3000 in your browser.

---

## Deployment

The project auto-deploys to Vercel on every push to the `main` branch.

```bash
git add .
git commit -m "Your change description"
git push
```

**Environment variables** must also be set in Vercel:
Vercel Dashboard → Project → Settings → Environment Variables

| Variable | Where to get it | Required |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API Keys | Yes |
| `OPENFDA_API_KEY` | https://open.fda.gov/apis/authentication/ | Recommended |
| `SYNC_SECRET` | Any long random string you choose | Yes (production) |

---

## Branching Strategy

```
main          ← production (auto-deploys to Vercel)
dev           ← staging (test here before merging to main)
feature/xxx   ← individual features (branch from dev)
```

Never push directly to `main`. Always work on a feature branch and merge via pull request.

---

## Roadmap

### V1 (Complete)
- ✅ Public searchable device index
- ✅ Supabase database with real schema
- ✅ Device detail modal
- ✅ Search and filter by specialty and status
- ✅ Deployed to Vercel
- ✅ Custom domain (aletia-index.com)
- ✅ All navigation pages (Methodology, Insights, Clinicians, Request Review)
- ✅ Logo, favicon, OG cover image

### V2 (In Progress)
- ✅ openFDA API integration (automated device data sync)
- ✅ 114 real AI/ML devices seeded from FDA
- ✅ Multi-jurisdiction registration support (FDA / CE Mark / SAHPRA)
- ✅ country_of_origin field on device_master
- ⬜ Consolidate CSS into globals.css
- ⬜ Individual device report pages (/device/UDI-VIZ-001)
- ⬜ About / Privacy / Terms pages
- ⬜ Manufacturer portal (claim and manage device profiles)
- ⬜ Auth (Supabase Auth for manufacturer and auditor roles)

### V3 (Future)
- ⬜ 10-Point Clinical Assurance Checklist audit workflow
- ⬜ Stripe / Peach Payments integration
- ⬜ SAHPRA-specific compliance fields
- ⬜ API licensing and data watermarking
- ⬜ Vercel Cron Job for nightly automated FDA sync

---

## Key Concepts

**Accountability Tier** — A 1–5 scale classifying how autonomous the AI device is:

- Tier 1: Clinical Decision Support
- Tier 2: Diagnostic Aid
- Tier 3: Diagnostic Decision
- Tier 4: Autonomous Screening
- Tier 5: Autonomous Action

**Dual-Timestamp Logic** — Every device has two timestamps:

- `last_automated_sync` — when the FDA API last updated the record
- `last_clinical_review` — when a human auditor last reviewed it

**Aletia Verified** — A badge awarded only after a human auditor completes the 10-Point Clinical Assurance Checklist. It cannot be self-assigned by manufacturers.

**Health Status** — Automatically derived from FDA signals (recalls, adverse events) but overridable by human auditors. Red = active recall. Amber = elevated MDR count. Green = no signals.

---

## Access & Credentials

To get access to the project you will need:

- **GitHub** — Ask @AnnMaidment to add you as a collaborator
- **Supabase** — Ask for an invite to the aletia-index project
- **Vercel** — Ask for an invite to the annmaidments-projects team
- **.env.local file** — Shared privately (never committed to git)

---

## Contact

**Project Owner:** Annemarie Maidment
**Email:** annemarie.maidment@gmail.com

---

*Aletia Index — Independent clinical assurance for digital health tools.*