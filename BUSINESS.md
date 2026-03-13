# Aletia Index — Business Strategy & Thinking

*A living document. Add to this as ideas develop.*

---

## The Core Insight

AI medical devices are software. Software can be downloaded anywhere. But regulatory clearance is jurisdiction-specific. A device cleared by the FDA can be marketed in the US — but does that mean it can legally be used in South Africa? In the UK? In Germany? Nobody has built a clear, trustworthy answer to that question.

Aletia's core value is **cross-jurisdictional clarity for AI medical devices** — telling clinicians, hospitals, and manufacturers exactly where a device is cleared, where it isn't, and what the pathway to clearance looks like in new markets.

---

## The Problem We're Solving

1. **Clinicians** are being sold AI diagnostic tools by reps who don't disclose incomplete local registration. There is no easy way to verify.

2. **Manufacturers** want to expand into new markets but don't have a clear map of regulatory sequencing — which clearance unlocks which other markets.

3. **Hospital procurement** needs to verify compliance before purchasing. Currently this is manual, slow, and unreliable.

4. **Patients and consumers** are buying health wearables online with no awareness of whether those devices are approved for local use.

---

## The Business Model (Thinking In Progress)

### What we know
- The public index builds credibility and SEO — it is the foundation, not the revenue
- Manufacturers have money and will have FOMO about being absent from a trusted index
- Clinicians will use it to look up devices — making it a reference destination
- The database is the heart of everything

### Revenue streams to explore

**1. Manufacturer listings (most immediate)**
- Free: basic auto-populated listing from public registries
- Claimed: manufacturer verifies and corrects their listing (free or low cost — this is the hook)
- Premium: press releases, pipeline updates, clinical evidence uploads, regulatory pathway status, contact/demo button
- Featured: placement in specialty searches

The incompleteness of auto-populated listings is the sales hook. A manufacturer finding their listing with missing data or Amber status has an immediate reason to claim and upgrade it.

**2. B2B compliance tool for manufacturers**
- Regulatory pathway navigator: input current clearances, get recommended next jurisdiction sequence
- Key insight: SAHPRA recognises FDA, CE Mark, TGA, and Health Canada — so FDA + CE = SAHPRA fast-track
- Target: manufacturers wanting to enter African markets who don't know the SAHPRA pathway

**3. Clinician/hospital procurement tool**
- One-click compliance report per device per jurisdiction
- Procurement officer verification workflow
- Potential for institutional subscriptions (hospitals, NGOs, health systems)

**4. API licensing (longer term)**
- Once data is clean and structured, sell the data feed to EHR vendors, insurance companies, procurement platforms

**5. Post-market surveillance (longer term)**
- Nobody is clearly surfacing: "this device has 200 adverse events in the US but is being marketed in SA with no local incident reporting"
- This is a journalism play as much as a data play — drives authority and brand

### What we're NOT doing (yet)
- B2C marketing — too expensive, wrong stage
- Consumer-facing subscription — trust is hard to build, monetisation is weak
- Anything requiring full auth/portal before validating demand with simpler tools

---

## The SEO Strategy

Every device gets its own URL: `/device/[id]`

Target keyword clusters nobody owns:
- `[device name] FDA clearance`
- `[device name] MHRA registered`
- `[device name] approved South Africa`
- `is [device name] approved in South Africa`
- `[specialty] AI medical device SAHPRA`

The SA angle is the sharpest differentiator. No one is answering "is this device approved in South Africa" well. Aletia will.

Each device page has:
- Unique title and meta description (auto-generated from device data)
- JSON-LD MedicalDevice structured data (rich results in Google)
- Open Graph tags (social sharing)
- SSR rendering (Google sees full content immediately)

---

## The Regulatory Pathway Intelligence

This is a future product but worth capturing the logic now.

**Key insight: clearances have mutual recognition relationships**

| Have this | Helps with |
|---|---|
| FDA 510(k) | MHRA recognition route (UK fast-track for FDA-cleared devices) |
| CE Mark | SAHPRA mutual recognition pathway |
| FDA + CE Mark | Most emerging markets including SA |
| SAHPRA | Gateway to other African markets |

SAHPRA specifically grants recognition to: FDA, CE Mark, TGA (Australia), Health Canada.

So for a manufacturer asking "what's my next move after FDA clearance?" — the answer is often CE Mark, because that unlocks both Europe AND the SAHPRA fast-track.

This sequencing logic is a product. A "Regulatory Pathway Navigator" that takes current clearances as input and outputs recommended next steps, requirements, and estimated timelines.

---

## The Wearables / Consumer Health Extension

The original focus is clinical AI medical devices. But the same problem exists in consumer health:
- Apple Watch ECG — FDA cleared, but what does that mean in SA?
- CGMs (continuous glucose monitors) — available on SA pharmacy shelves, but which regulatory framework applies?
- Mental health apps — marketed aggressively, regulatory status unclear

This is a bigger market with weaker competition. The risk:
- Liability exposure if data is wrong
- Consumer trust is harder to build than B2B trust
- Monetisation is weaker at consumer level

**Verdict:** Don't build for consumers now. But SEO-index wearables alongside clinical devices so that organic traffic from consumer searches arrives at Aletia. Let the audience build before deciding how to monetise it.

---

## The China / NMPA Angle

NMPA (National Medical Products Administration) is the Chinese regulator. Adding it would make Aletia the only resource tracking US + UK + EU + SA + China in one place.

**Challenge:** NMPA requires registration to access the API. Manually seeding high-profile devices is feasible in the short term.

**Why it matters:** A device with FDA + CE + NMPA clearance is a very different risk profile from FDA only. That signal is valuable to procurement teams globally.

---

## Competitive Landscape

- **FDA 510(k) database** — exists but US-only, technical, not user-friendly
- **EUDAMED** — EU only, no AI/ML filter, hard to use
- **Hardian Health (HaRi)** — UK-focused, building similar capability, still in beta
- **No one** is doing cross-jurisdiction + post-market + SA in one place

Our moat: the combination of jurisdictions (especially SAHPRA), the clinical assurance layer (Aletia Verified), and the SEO strategy that makes us the reference point for device lookups.

---

## 30-Day Revenue Plan

**Week 1:** Finish device pages and SEO metadata. Nothing is sellable without URLs.

**Week 2:** Direct outreach to 10 manufacturers already in the index with incomplete listings. UK companies first — shorter sales cycles. Pitch: "Your listing exists. It's incomplete. Here's how to fix it and what premium looks like."

**Week 3:** Get one paying customer at any price (£50-200/month). Proof of concept matters more than revenue amount right now.

**Week 4:** Use first customer as reference. Return to the other 9 with social proof.

**Realistic month 1 revenue:** £100-400. Not transformative — but it proves the model.

---

## Questions Still To Answer

- What is the exact pricing structure for manufacturer tiers?
- Who is the right first salesperson contact at a manufacturer — regulatory affairs, marketing, or CEO?
- Should the "claim your listing" flow be a form or a live page?
- What does the Aletia Verified audit actually look like operationally — who does it, how long does it take, what does it cost?
- Is there a partnership angle with SAHPRA directly?
- What would an NGO or global health organisation pay for access to this data?
- Should insights/blog content be prioritised for SEO before or after device pages are indexed?

---

## Ideas Parking Lot

- Partnership with medical device regulatory consultancies (they have manufacturer clients who need exactly this)
- White-label version for hospital procurement systems
- Email alert service: "Your device's MHRA registration expires in 90 days"
- Conference presence: MEDICA, Arab Health, Africa Health — manufacturer-heavy audiences
- Academic/research licensing for health policy researchers

---

*Last updated: March 2026*
*Owner: Annemarie Maidment — annemarie.maidment@gmail.com*
