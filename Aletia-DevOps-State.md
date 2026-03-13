# Aletia Index — DevOps State Document
> Paste this at the start of every DevOps session. Update at the end of each session.
> Last updated: 2026-03-04 (Session 2)

---

## 1. Project Identity

| Field | Value |
|---|---|
| Product | Aletia Index — Clinical assurance for digital health |
| Owner | Annemarie Maidment (annemarie.maidment@gmail.com) |
| Live site | https://www.aletia-index.com |
| Staging | https://aletia-index.vercel.app |
| Repository | https://github.com/AnnMaidment/Aletia-Index |
| Hosting | Vercel (auto-deploy from `main`) |
| Database | PostgreSQL via Supabase |
| Domain registrar | Hostinger (registrar only) |
| DNS | Vercel DNS (ns1.vercel-dns.com / ns2.vercel-dns.com) — all DNS records managed in Vercel |

---

## 2. Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | Next.js 16 + TypeScript | App router |
| Styling | Inline `<style>` per page | ⚠️ Tech debt — see CSS consolidation task |
| Database | PostgreSQL via Supabase | 6 tables |
| Auth | Supabase Auth | 🔲 Planned — not yet implemented |
| Payments | Stripe + Peach Payments | 🔲 Planned — V3 |
| Hosting | Vercel | Auto-deploys from `main` |
| External API | openFDA API | lib/fda.ts + lib/fdaSync.ts |

---

## 3. Branching Strategy

```
main       ← production (auto-deploys to Vercel)
dev        ← staging (test here before merging to main)
feature/xxx ← branch from dev, merge back to dev via PR
```

**Rule:** Never push directly to `main`.

---

## 4. Environment Variables

| Variable | Purpose | Required |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase public key | Yes |
| `OPENFDA_API_KEY` | FDA API authentication | Recommended |
| `SYNC_SECRET` | Secures `/api/fda-sync` endpoint | Yes (production) |

> ⚠️ **RLS Note:** `NEXT_PUBLIC_SUPABASE_ANON_KEY` is client-exposed (by design in Supabase). When auth goes live in V2/V3, Row Level Security (RLS) policies **must** be in place on all tables before manufacturer/auditor roles are introduced. This is a pre-auth prerequisite.

Set in Vercel: Dashboard → Project → Settings → Environment Variables

---

## 5. Database Schema (Supabase / PostgreSQL)

### Tables

**`manufacturers`**
- `id` (UUID, PK), `name`, `hq_location`, `status` (Verified/Unverified), `payment` (Stripe customer ID)

**`specialty_taxonomy`**
- `specialty_name` (PK), `parent_cat` (e.g. Psychiatry → Mental Health)

**`device_master`** ← central table
- `device_id` (PK — FDA UDI / K number format)
- `manufacturer_link` (FK → manufacturers, nullable)
- `specialty_link` (FK → specialty_taxonomy, nullable)
- `mode`, `dependency`, `autonomy`, `intended_use`
- `ai_ml_type` (Locked / Continuous Learning)
- `accountability_tier` (1–5)
- `health_status` (Green / Amber / Red)
- `aletia_verified` (boolean)
- `country_of_origin`
- `last_automated_sync` (timestamp)
- `last_clinical_review` (timestamp)

**`regional_registrations`**
- `reg_id` (UUID, PK), `device_link` (FK), `country`, `regulatory_body`, `clearance_type`, `regulatory_expiry`
- ⚠️ Alert trigger: `regulatory_expiry` approaching

**`clinical_audits`**
- `audit_id` (UUID, PK), `device_link` (FK)
- `evidence_review_date` — ⚠️ Alert trigger: stale reviews
- `confidence_score` (1–10), `evidence_log`, 10-point checklist scores

**`tech_specs`**
- `device_link` (PK/FK), `api_type`, `ehr_compat`, `data_hosting`, `fhir_compatible`, `popia_compliant`

---

## 6. FDA API Integration

**Files:**
- `lib/fda.ts` — openFDA service layer (HTTP calls, typed results)
- `lib/fdaSync.ts` — maps FDA responses → Supabase schema
- `app/api/fda-sync/route.ts` — HTTP endpoint, secured with `SYNC_SECRET`

**Key functions in `lib/fda.ts`:**
- `get510kByKNumber(kNumber)`
- `getPMAByNumber(pmaNumber)`
- `getRecallsByKNumber(kNumber)`
- `getAdverseEventCount(deviceName)`
- `getClassificationByProductCode(productCode)` — rejects Class I
- `searchAIMLDevices()` — up to 1000 devices
- `searchAIMLByProductCodes()`

**Sync endpoint `/api/fda-sync`:**
| Method | URL | Action |
|---|---|---|
| GET | /api/fda-sync | Health check |
| GET | /api/fda-sync?bulk=true | Sync all devices |
| POST | /api/fda-sync | Sync single device |
| PUT | /api/fda-sync | Seed DB from FDA |

**Health Status Logic (auto-derived):**
- 🔴 Red — active recall present
- 🟡 Amber — adverse event count > 50 MDRs
- 🟢 Green — no signals
- Human auditors can override at any time.

**Scope:** Class II and III AI/ML devices only. Class I excluded.

---

## 7. Roadmap Status

### V1 — Complete ✅
- [x] Public searchable device index
- [x] Supabase database with real schema
- [x] Device detail modal
- [x] Search and filter by specialty and status
- [x] Deployed to Vercel + custom domain
- [x] All nav pages (Methodology, Insights, Clinicians, Request Review)
- [x] Logo, favicon, OG cover image

### V2 — In Progress 🔄
- [x] openFDA API integration (automated sync)
- [x] 114 real AI/ML devices seeded from FDA
- [x] Multi-jurisdiction registration support (FDA / CE Mark / SAHPRA)
- [x] `country_of_origin` field on `device_master`
- [x] `app/robots.ts` — robots.txt live in production
- [x] `app/sitemap.ts` — sitemap.xml live in production
- [x] `dev` branch created — branching strategy now functional
- [x] Google Search Console verification meta tag added to `layout.tsx`
- [x] Google Search Console TXT record added to Vercel DNS
- [x] Sitemap submitted to Google Search Console
- [ ] Google Search Console verification — ⏳ DNS propagating (in progress)
- [ ] **AI crawler policy decision** — robots.ts currently allows all crawlers incl. GPTBot/ClaudeBot. Decision pending on whether to block, allow, or partially allow. Tied to V3 API licensing strategy.
- [ ] **CSS consolidation** — move inline styles → `app/globals.css`
- [ ] **Individual device report pages** — `/device/[id]` dynamic routes
- [ ] **About / Privacy / Terms pages**
- [ ] **Manufacturer portal** — claim and manage device profiles
- [ ] **Auth** — Supabase Auth for manufacturer and auditor roles

### V3 — Future 🔲
- [ ] 10-Point Clinical Assurance Checklist audit workflow
- [ ] Stripe / Peach Payments integration
- [ ] SAHPRA-specific compliance fields
- [ ] API licensing and data watermarking
- [ ] Vercel Cron Job — nightly automated FDA sync

---

## 8. Key Architectural Decisions & Rationale

| Decision | Rationale | Implications |
|---|---|---|
| Inline `<style>` per page | Rapid prototyping speed | Must consolidate before V3; updating brand colours requires touching every file |
| Supabase anon key client-exposed | Standard Supabase pattern | RLS policies are mandatory before auth goes live |
| `device_id` matches FDA format (K number / UDI) | Direct foreign key alignment with FDA data | Simplifies sync; must handle non-FDA devices (CE Mark, SAHPRA) with a consistent ID scheme |
| Health status auto-derived from FDA, human-overridable | Reduces manual work; preserves clinical authority | Need audit trail for overrides — consider logging who changed status and when |
| `SYNC_SECRET` on FDA sync endpoint | Prevents unauthenticated triggering of bulk syncs | Must rotate if ever exposed; consider moving to cron-only in V3 |

---

## 9. Known Tech Debt

| Item | Severity | Notes |
|---|---|---|
| CSS duplicated across all page files | Medium | Planned consolidation into `globals.css` |
| No RLS policies on Supabase tables | 🔴 High (before auth) | Must implement before manufacturer/auditor auth goes live |
| No audit log for health status overrides | Medium | Important for clinical trust credibility |
| No error boundary / fallback UI for FDA API failures | Medium | If openFDA is down, sync silently fails |
| No rate-limit handling on FDA API calls | Low-Medium | openFDA has rate limits; bulk sync could hit them |
| Vercel Cron Job not yet set up | Low | Currently manual sync only |
| Vercel preview deployments not configured for `dev` branch | Low | `dev` pushes don't auto-deploy to staging URL; must configure in Vercel Dashboard → Project → Settings → Git |
| PDF files in project root | Low | `README4March2026.pdf` and `Aletia-DevOps-State.md` found in repo root — move outside project folder or add to `.gitignore` |

---

## 10. Active Session Log

| Date | Session Summary | Decisions Made | Open Actions |
|---|---|---|---|
| 2026-03-04 | Initial DevOps State Document created. README ingested. | Agreed on living doc handoff approach. | Ann to confirm current sprint focus for V2. |
| 2026-03-04 | SEO recovery session. Created `dev` branch. Added `robots.ts` and `sitemap.ts`. Fixed `layout.tsx` metadata (duplicate block). Added Google verification meta tag. Diagnosed DNS architecture (Vercel nameservers). Added Google TXT verification record to Vercel DNS. Submitted sitemap to Search Console. | DNS managed in Vercel not Hostinger. AI crawler policy deferred. README.md stays in repo; DevOps State doc lives outside repo. | Google Search Console verification pending DNS propagation. AI crawler policy decision needed before V3. Vercel preview deployments for `dev` branch to be configured. PDF files to be moved outside project folder. |

---

## 11. Next Session Checklist

When starting a new session, paste this document and tell the DevOps brain:
1. What you worked on since last session
2. What you want to focus on this session
3. Any new decisions, blockers, or changes to the stack

---

*Aletia Index DevOps State — maintained by Claude (DevOps role) for Annemarie Maidment*
