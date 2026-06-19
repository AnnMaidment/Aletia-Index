# EUDAMED detail-endpoint findings — risk class absent, three localised-text bugs

**Date:** 10 June 2026 (original); **resolution added 19 June 2026.**
**Source:** live `udiDiData/{uuid}` dump during the queue-rewrite session (the
`eu_risk_class` raw_data backfill attempt), plus the 17–19 June bug-fix probe.
**Status:** the backfill was **built, dry-run, and abandoned** — empirically it
cannot recover what it was for. The two (now three) type bugs are **fixed**
(see Resolution). Recorded here so the EUDAMED ingest work inherits the finding
instead of rediscovering it.

---

## TL;DR

The `udiDiData/{uuid}` **detail** endpoint does **not** carry risk class — not
top-level, not nested. A full dump of a real device (PeekMed web,
`a45cc9a2-dfc9-4c65-a706-128447039ccd`, EMDN V0399) confirmed it. So a
detail-only backfill of `eu_risk_class` onto the 227 queued `eudamed_sync` rows
recovers nothing. Abandoned. Risk-class recovery belongs to the **search-based**
re-ingest (`EUDAMED-REINGEST-SPEC`), which carries the search-row fields into
`raw_data` natively.

This is the same shape of lesson as the Basic-UDI deferral: **the public device
API splits fields across endpoints, and the cheap one (detail) is missing more
than the spec implied.** Probe live before assuming any field path.

---

## What the detail endpoint actually carries (confirmed)

From the live dump, the useful top-level fields are: `primaryDi.code`,
`tradeName` (see bug 2), `additionalDescription` (see bug 1), `cndNomenclatures`
(EMDN), `udiPiType.softwareIdentification`, `deviceStatus.type.code`,
`placedOnTheMarket`/`marketInfoLink` (member-state availability),
`additionalInformationUrl`. **No `riskClass`. No `medicalPurpose`. No
certificate / notified-body data.**

`medical_purpose`, NB, certificates → Basic UDI record (already known
unreachable, deferred — `EUDAMED-STEP-0A-FINDINGS.md` §2).
`risk_class` → **not on detail at all** (this finding). The discovery client
reads it as `detail?.riskClass?.code ?? row.riskClass?.code`; the **search row**
is where it lives, and the detail fallback was always going to be null.

### Consequence for the merge diff
The queue merge diff's four fields are name, manufacturer_name, intended_use,
eu_risk_class. For EU rows today: name + manufacturer come from the crosswalk;
`intended_use` is unreachable (Basic UDI); `eu_risk_class` is unrecoverable
without a search re-pull. So **EU merge diffs show name + manufacturer only**
until the re-ingest. The mapping code (`buildIncomingFields` in
`lib/mergeDiff.ts`) is in place and lights up automatically when `raw_data`
carries `risk_class` / `medical_purpose` — no UI change needed then.

---

## Three localised-text type bugs in `lib/eudamed.ts` (RESOLVED 19 Jun 2026)

All three were real; the discovery path leaned on search-row fallbacks heavily
enough that they degraded quality silently rather than failing hard. They share
one root cause — the EUDAMED **localised-text envelope** — and one fix.

### Bug A (→ BUG-014) — `additionalDescription` is an object, typed as a string
Live shape:
```json
"additionalDescription": { "texts": [ { "language": { "isoCode": "en" }, "text": "Surgery planning software" } ] }
```
`EudamedUdiDetail.additionalDescription` was declared `string | null`, and
`fetchEudamedAiMlDevices` passed it straight into
`hasAiKeyword(deviceName, detail?.additionalDescription)`. So the keyword check
was handed an **object**, not text — it silently matched nothing on that field.

### Bug B (→ BUG-015) — `tradeName.textByDefaultLanguage` is null; real name is in `texts[]`
Live shape:
```json
"tradeName": { "texts": [ { "language": null, "text": "PeekMed web", "allLanguagesApplicable": true } ], "textByDefaultLanguage": null }
```
The client read `detail?.tradeName?.textByDefaultLanguage ?? row.tradeName`.
When `allLanguagesApplicable: true`, `textByDefaultLanguage` is null and the
name sits in `texts[0].text`. So device naming fell through to the search-row
`tradeName` (often null on search) more than intended → null `device_name` →
Dice-zero in the 4d gate.

### Bug C (→ BUG-016) — `cndNomenclatures[].description` same envelope
`emdn_description` was read via `.textByDefaultLanguage` on the same envelope
shape, so it resolved null. Third instance of the same root cause.

---

## Resolution (19 June 2026) — commit `e7a4cea`

Fixed with a single shared helper, `extractLocalisedText()`, in `lib/eudamed.ts`,
applied at all three sites; `EudamedUdiDetail.tradeName` / `.additionalDescription`
/ `cndNomenclatures[].description` retyped to a shared `EudamedLocalisedText`
envelope. Resolution precedence:
**`textByDefaultLanguage` → `allLanguagesApplicable` entry → `en` entry → first
non-empty `text`** (whitespace counts as absent; a bare string is tolerated).

**Verification:**
- Offline fixture (13 cases, incl. the two real captured shapes above) — pass.
- `tsc --noEmit` + eslint — clean (full project, on the dev machine).
- Live Part B re-run (`limitPerCode: 5`, 2 codes, 10 devices):
  - Residual null names **4/10 → 3/10**; "Syngo Carbon Space" recovered from `texts[0]`.
  - Guard split **7 include / 3 queue — unchanged** (the fix touches naming +
    keyword *accuracy*, not guard logic). Correct.
  - `keyword_hit` still rare (2/10): `udiPiType.softwareIdentification` carries
    include confidence; the sampled devices have no AI lexicon in name/description.
    The fix restored the keyword guard's **ability** to fire on description text;
    it did not (and should not be claimed to) add hits in this sample.

### New finding — some devices have no retrievable name (empty `texts[]`)
The 3 residual null names (NeoLogica ×2, Shanghai United Imaging) are **genuinely
absent in EUDAMED**: `tradeName.texts[]` is empty, not a code issue. Even
post-fix these resolve to null `device_name`, fall back to the (null) search-row
`tradeName`, and therefore **Dice-zero in the 4d gate and queue with no
candidate.** This is a **source-side ceiling on EU crosswalk recall**, not a
defect — it must be read into the Step 1c recall number (a fraction of EUDAMED
devices are simply un-nameable from the public surface and cannot crosswalk on
name). Logged in `KNOWN-BUGS.md` Notes as a "not a bug".

---

## Recommended actions (status as of 19 Jun 2026)

1. ~~**Fix bugs A and B** in `lib/eudamed.ts`~~ — **DONE** (`e7a4cea`); C folded in.
2. **Risk-class + intended-use recovery rides the re-ingest**, not a bespoke
   backfill — re-pull via `cndCode` search, carry `riskClass.code` (search row)
   and the detail fields into `raw_data` in one pass. Folds into
   `EUDAMED-REINGEST-SPEC`.
3. **Re-confirm the Basic-UDI deferral** in the same pass (monthly re-probe for
   the post-28-May NB/Certificates mandate populating `medicalPurpose` / NB).
   *(19 Jun re-check: `basicUdi.uuid` still null — no change from 9 June.)*
4. **Re-score the 227 pending queue rows.** Their candidate sets were scored at
   ingest against the buggy null names, and the drawer deliberately does NOT
   recompute rows that already have stored candidates. Cashing in the name fix
   for the existing queue needs a deliberate re-scoring pass (see STATE — next
   step). Until then: EU merge diffs are name + manufacturer only — **acceptable
   and expected.**
