/**
 * lib/eudamedList.ts
 * The AI-isolation heuristic for EUDAMED — the EU analogue of the FDA AI/ML list.
 *
 * Where FDA hands us an authoritative AI/ML list to seed from (lib/fdaList.ts),
 * EUDAMED has NO AI flag and NO AI list. The substitute, established by the
 * Step 0A probe (EUDAMED-STEP-0A-FINDINGS.md §4, 9 June 2026), is an **EMDN
 * `cndCode` allow-list learned from confirmed FDA positives**, queried
 * server-side, then precision-guarded. This file IS that heuristic — a dated,
 * versioned, source-referenced artifact. Treat it as reusable regulatory IP,
 * not an ingest detail.
 *
 * DEFAULT POSTURE: precision over recall. A loose heuristic re-creates the
 * ~4,612-device over-capture we just pruned on the FDA side, but in the EU.
 * Query the confirmed leaves; queue the uncertain (never auto-include).
 *
 * VERSION: v1 (Step 0A, 9 June 2026). Update only with a dated note when the
 * allow-list changes. The full set of 66 confirmed EMDN codes lives in
 * eudamed-crosswalk-results.json → topEmdn; the dominant confirmed leaves are
 * encoded below. Widen a leaf to its parent (e.g. Z1103, Z1105) ONLY after
 * eyeballing what the widening pulls in — see EUDAMED-RELOOK-SCOPE-v2.md.
 */

export const EUDAMED_HEURISTIC_VERSION = 'v1-2026-06-09';

/**
 * EMDN cndCode allow-list — the confirmed leaves carried by the 218 strict
 * crosswalk matches (Step 0A §4). `cndCode` is a SERVER-SIDE PREFIX filter on
 * the EUDAMED search endpoint, so a parent like `Z11` matches its whole family.
 * We deliberately query the SPECIFIC leaves (precision over recall), not `Z11`
 * wholesale (~19,781 records, mostly non-AI).
 *
 * The count next to each code is how many of the 218 confirmed devices carried
 * it — provenance, not used at runtime. To widen coverage, paste the remaining
 * codes from eudamed-crosswalk-results.json → topEmdn here, with a dated note.
 */
export const AI_EMDN_ALLOWLIST: readonly string[] = [
  // Z11###### family — dominant
  'Z11069092', // (24)
  'Z11030692', // (18)
  'Z11050104', // (14)
  'Z11030592', // (12)
  'Z11039092', // (8)
  'Z11040104', // (6)
  'Z11040106', // (5)
  'Z119082',   // (5)
  'Z11030282', // (4)
  // Z12######
  'Z12110192', // (7)
  'Z129092',   // (5)
  'Z12080192', // (4)
  // Non-Z tail (V = likely IVD branch; W = ?)
  'V92',        // (9)
  'V0399',      // (5)
  'W02020199',  // (4)
] as const;

/**
 * Precision-guard keyword vocabulary (Step 0A §4), denoised of stopwords like
 * "object", "system", "with". A keyword hit in tradeName / additionalDescription
 * is a SECONDARY signal — it raises confidence but does not by itself decide
 * inclusion. The confirmed-vocabulary tokens plus the generic AI lexicon.
 */
export const AI_KEYWORDS: readonly string[] = [
  // generic AI/ML lexicon
  'artificial intelligence', 'machine learning', 'deep learning', 'neural',
  ' ai ', 'ai-', '-ai', 'cad', 'cade', 'cadx',
  // task verbs that recur in the confirmed set
  'triage', 'reconstruction', 'quantification', 'detection', 'segmentation',
  // confirmed product-name tokens (high specificity)
  'briefcase', 'swoop', 'overjet', 'cina', 'quantib', 'deeprhythm',
] as const;

/** Lowercased keyword hit test over a free-text blob (name + description). */
export function hasAiKeyword(...texts: (string | null | undefined)[]): boolean {
  const blob = ` ${texts.filter(Boolean).join(' ').toLowerCase()} `;
  return AI_KEYWORDS.some((kw) => blob.includes(kw));
}

/**
 * The genuine "is this software?" signal at the basic-UDI endpoint:
 * specialDeviceType.code contains "software" (e.g.
 * "refdata.special-device-type.software"). This is NOT the same as
 * udiPiType.softwareIdentification, which is a UDI production-identifier type
 * and must NEVER be used as an AI/software signal (Step 0A §2).
 */
export function isSoftwareSpecialType(specialDeviceTypeCode: string | null | undefined): boolean {
  return !!specialDeviceTypeCode && specialDeviceTypeCode.toLowerCase().includes('software');
}

export type EudamedConfidence = 'include' | 'queue' | 'reject';

export interface CandidateSignals {
  emdnOnAllowlist: boolean;   // surfaced by an allow-list cndCode
  isSoftware: boolean;        // specialDeviceType.code = …software
  keywordHit: boolean;        // AI keyword in name/description
}

/**
 * Stack the precision guards into a coarse decision. Per the precision-over-
 * recall posture, only a device that is on the allow-list AND shows at least
 * one corroborating signal (software type or keyword) is a confident AI device.
 * Allow-list-only (no corroboration) is still plausibly AI but uncertain → queue.
 * Nothing here AUTO-INCLUDES into the curated index on its own; the ingest path
 * decides whether 'include' auto-creates or still routes to the 4d gate.
 */
export function classifyEudamedCandidate(s: CandidateSignals): EudamedConfidence {
  if (!s.emdnOnAllowlist) return 'reject';        // off the heuristic entirely
  if (s.isSoftware || s.keywordHit) return 'include';
  return 'queue';                                  // on-allowlist but uncorroborated
}
