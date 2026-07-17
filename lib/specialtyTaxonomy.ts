/**
 * lib/specialtyTaxonomy.ts
 *
 * Canonical mapping from clinical evidence (conditions, device names, titles,
 * summaries, MeSH terms, keywords) to Aletia's specialty_taxonomy.specialty_name
 * values.
 *
 * IMPORTANT: The LHS strings in PATTERNS must match specialty_taxonomy.specialty_name
 * EXACTLY (case-sensitive). The FK constraint on device_master.specialty_link will
 * reject mismatches. Confirm against Supabase before shipping changes:
 *
 *   select distinct specialty_name from specialty_taxonomy order by 1;
 *
 * As of 2026-04-16 the table holds (after running 20260416_extend_specialties.sql):
 *   Anaesthesiology, Cardiology, Dentistry, Dermatology, Emergency Medicine,
 *   Endocrinology, Gastroenterology, Hematology, Infectious Disease,
 *   Intensive Care, Nephrology, Neurology, Obstetrics & Gynaecology, Oncology,
 *   Ophthalmology, Orthopaedics, Otolaryngology, Paediatrics, Pathology,
 *   Primary Care, Psychiatry, Pulmonology, Radiology, Rheumatology, Urology
 *
 * SEPARATION OF CONCERNS (refactor 2026-06-22):
 *   This module answers "what does this evidence indicate?" only. It consumes a
 *   pre-normalised SpecialtyEvidence bundle (see lib/specialtyEvidence.ts) and
 *   never reads raw source field names. The deterministic matcher keys off the
 *   CLINICAL text fields (deviceName, title, conditions, summary, description,
 *   intendedUse) and deliberately IGNORES the bundle's panel / productCode — a
 *   raw FDA panel is a regulatory review lane, not a clinical specialty, and is
 *   reserved for the enrichment phase rather than the deterministic pass.
 *
 * Used by:
 *   - lib/extractQueueSpecialty.ts (backfill the review queue)
 *   - lib/clinicalTrialsIngest.ts  (populate specialty on new ingests — future wire-up)
 */

import type { SpecialtyEvidence } from './specialtyEvidence';

export type SpecialtyConfidence = 'high' | 'medium' | 'low' | 'none';

export interface SpecialtyMatch {
  specialty: string | null;
  confidence: SpecialtyConfidence;
  signals: {
    matched_patterns: string[];
    source_fields: string[];   // e.g. ['conditions','deviceName']
  };
}

interface Pattern {
  specialty: string;
  patterns: RegExp[];
  confidence: SpecialtyConfidence;
}

// -----------------------------------------------------------------------
// Pattern library
//
// Ordering rules inside this array:
//   1. All HIGH-confidence patterns run first across all specialties, then
//      MEDIUM, then LOW. This is enforced by inferSpecialty() below.
//   2. Within a confidence level, organ-specific specialties win over
//      cross-cutting ones (Oncology is intentionally listed last at each
//      level so Radiology / Urology / Pathology etc. claim cancer cases
//      that have a clearer specialty home).
// -----------------------------------------------------------------------

const PATTERNS: Pattern[] = [
  // ---- Radiology ----
  //
  // High-confidence patterns are conditions where Radiology is the clinical
  // home (not just the modality). Generic imaging modalities like MRI / CT /
  // X-ray are demoted to MEDIUM so that organ-specific specialties (Urology
  // for prostate MRI, Neurology for brain MRI etc.) win at the high-confidence
  // pass. A chest X-ray AI reading for pneumonia will still land in Radiology
  // because "chest radiograph" is explicitly listed — pick the specific term
  // over the general modality.
  {
    specialty: 'Radiology',
    confidence: 'high',
    patterns: [
      /\bmammograph(y|ic)\b/i,
      /\bchest radiograph\b/i,
      /\bpulmonary embolism\b/i,
      /\bintracranial (hemorrhage|haemorrhage)\b/i,
      /\bfracture detection\b/i,
      /\bradiolog(y|ist|ical)\b/i,
    ],
  },
  {
    specialty: 'Radiology',
    confidence: 'medium',
    patterns: [
      /\bmri\b/i,
      /\bmagnetic resonance\b/i,
      /\bct\s+(scan|angiograph|pulmonary)\b/i,
      /\bcomputed tomography\b/i,
      /\bx-?ray\b/i,
      /\bimaging\b/i,
      /\bscreening imag/i,
      /\bbreast cancer screening\b/i,
      /\blung nodule\b/i,
      /\bstroke (detection|imaging)\b/i,
    ],
  },

  // ---- Cardiology ----
  {
    specialty: 'Cardiology',
    confidence: 'high',
    patterns: [
      /\batrial fibrillation\b/i,
      /\becg\b|\belectrocardiogra(m|ph)/i,
      /\bechocardiograph/i,
      /\bheart failure\b/i,
      /\barrhythmia\b/i,
      /\bmyocardial infarction\b/i,
      /\bcoronary artery disease\b/i,
      /\bleft ventricular\b/i,
      /\bcardiovascular disease\b/i,
      /\bvalvular heart disease\b/i,
      /\bheart murmur\b/i,
      /\baortic stenosis\b/i,
      /\baortic (regurgitation|insufficiency)\b/i,
      /\bmitral (regurgitation|insufficiency)\b/i,
      /\btricuspid (regurgitation|insufficiency)\b/i,
    ],
  },
  {
    specialty: 'Cardiology',
    confidence: 'medium',
    patterns: [
      /\bcardia(c|l)\b/i,
      /\bheart disease\b/i,
      /\bcardiology\b/i,
    ],
  },

  // ---- Ophthalmology ----
  {
    specialty: 'Ophthalmology',
    confidence: 'high',
    patterns: [
      /\bdiabetic retinopathy\b/i,
      /\bage-related macular degeneration\b/i,
      /\bamd\b/i,
      /\bglaucoma\b/i,
      /\bfundus (image|photograph)/i,
      /\boct\b.*\b(retina|macular|ophthalm)/i,
      /\boptical coherence tomograph/i,
      /\bretinopathy\b/i,
      /\bretinal\b/i,
    ],
  },
  {
    specialty: 'Ophthalmology',
    confidence: 'medium',
    patterns: [
      /\bophthalm/i,
      /\beye disease\b/i,
      /\bvisual acuity\b/i,
    ],
  },

  // ---- Dermatology ----
  {
    specialty: 'Dermatology',
    confidence: 'high',
    patterns: [
      /\bmelanoma\b/i,
      /\bskin cancer\b/i,
      /\bdermoscop/i,
      /\bbasal cell carcinoma\b/i,
      /\bsquamous cell carcinoma\b/i,
      /\batopic dermatitis\b/i,
      /\bpsoriasis\b/i,
    ],
  },
  {
    specialty: 'Dermatology',
    confidence: 'medium',
    patterns: [
      /\bdermatolog/i,
      /\bskin lesion\b/i,
      /\bcutaneous\b/i,
    ],
  },

  // ---- Pathology ----
  {
    specialty: 'Pathology',
    confidence: 'high',
    patterns: [
      /\bdigital pathology\b/i,
      /\bwhole slide image/i,
      /\bwsi\b/i,
      /\bhistopatholog/i,
      /\bcytopatholog/i,
      /\bcytolog(y|ical)\b/i,
      /whole slide (scan|imag)/i,
      /rapid on-?site evaluation/i,
      /\bbiopsy\b.*(cancer|tumor|tumour|carcinoma)/i,
      /\bprostate biopsy\b/i,
    ],
  },
  {
    specialty: 'Pathology',
    confidence: 'medium',
    patterns: [
      /\bpatholog(y|ist|ical)\b/i,
      /\bhistolog/i,
    ],
  },

  // ---- Neurology ----
  {
    specialty: 'Neurology',
    confidence: 'high',
    patterns: [
      /\bepilep(sy|tic)\b/i,
      /\bseizure detection\b/i,
      /\balzheimer/i,
      /\bparkinson/i,
      /\bmultiple sclerosis\b/i,
      /\beeg\b|\belectroencephalograph/i,
      /\bdementia\b/i,
      /\bcognitive impairment\b/i,
      /\bstroke\b/i,
      /\bisch(a)?emic stroke\b/i,
      /\blarge vessel occlusion\b/i,
      /\bintracerebral h(a)?emorrhage\b/i,
      /\bintracranial aneurysm\b/i,
    ],
  },
  {
    specialty: 'Neurology',
    confidence: 'medium',
    patterns: [
      /\bneurolog/i,
      /\bneurodegener/i,
      /\bbrain (disorder|disease)/i,
    ],
  },

  // ---- Psychiatry (Mental Health parent_cat) ----
  {
    specialty: 'Psychiatry',
    confidence: 'high',
    patterns: [
      /\bdepressive disorder\b/i,
      /\bmajor depression\b/i,
      /\bptsd\b|\bpost-?traumatic stress\b/i,
      /\banxiety disorder\b/i,
      /\bschizophren/i,
      /\bbipolar disorder\b/i,
      /\bsuicid(e|al) (risk|ideation)/i,
      /\baddiction\b|\bsubstance use disorder\b/i,
    ],
  },
  {
    specialty: 'Psychiatry',
    confidence: 'medium',
    patterns: [
      /\bmental health\b/i,
      /\bpsychiatr/i,
      /\bdepression\b/i,
      /\banxiety\b/i,
    ],
  },

  // ---- Pulmonology ----
  //
  // Sleep-disordered breathing / OSA routes here (decision 2026-06-22): there
  // is no Sleep Medicine specialty in the taxonomy, and OSA sits closest to
  // Pulmonology. NOTE: devices that pair sleep apnea WITH arrhythmia/ECG
  // signals (e.g. Belun Ring) will still resolve to Cardiology under the
  // first-match-wins rule, because Cardiology is listed earlier in this array
  // and its arrhythmia/ECG patterns fire at the same HIGH level. That is
  // surfaced honestly: signals.matched_patterns will list BOTH specialties, so
  // a reviewer sees the dual signal. If pure-sleep should always beat cardiac,
  // that needs an explicit precedence decision (not done here).
  {
    specialty: 'Pulmonology',
    confidence: 'high',
    patterns: [
      /\bcopd\b|\bchronic obstructive pulmonary/i,
      /\basthma\b/i,
      /\bpulmonary fibrosis\b/i,
      /\btuberculosis\b|\btb\b/i,
      /\bpneumonia detection\b/i,
      /\bobstructive sleep apn(o|e)a\b/i,
      /\bsleep apn(o|e)a\b/i,
      /\bsleep-?disordered breathing\b/i,
      /\bpolysomnograph/i,
    ],
  },
  {
    specialty: 'Pulmonology',
    confidence: 'medium',
    patterns: [
      /\bpulmonolog/i,
      /\brespirator(y|ies)\b/i,
      /\blung disease\b/i,
      /\bsleep stud(y|ies)\b/i,
    ],
  },

  // ---- Gastroenterology ----
  {
    specialty: 'Gastroenterology',
    confidence: 'high',
    patterns: [
      /\bcolonoscop/i,
      /\bpolyp detection\b/i,
      /\binflammatory bowel disease\b|\bibd\b/i,
      /\bcrohn/i,
      /\bulcerative colitis\b/i,
      /\bcolorectal cancer\b/i,
      /\bbarrett'?s esophagus\b/i,
    ],
  },
  {
    specialty: 'Gastroenterology',
    confidence: 'medium',
    patterns: [
      /\bgastroenterolog/i,
      /\bgastrointestinal\b/i,
      /\bendoscop/i,
    ],
  },

  // ---- Endocrinology ----
  {
    specialty: 'Endocrinology',
    confidence: 'high',
    patterns: [
      /\btype 1 diabetes\b/i,
      /\btype 2 diabetes\b/i,
      /\bcontinuous glucose monitor/i,
      /\bclosed-?loop insulin\b/i,
      /\bhba1c\b/i,
      /\bthyroid (nodule|cancer)/i,
    ],
  },
  {
    specialty: 'Endocrinology',
    confidence: 'medium',
    patterns: [
      /\bendocrinolog/i,
      /\bdiabetes\b/i,
      /\bglucose\b/i,
    ],
  },

  // ---- Urology ----
  {
    specialty: 'Urology',
    confidence: 'high',
    patterns: [
      /\bprostate cancer\b/i,
      /\bbladder cancer\b/i,
      /\brenal cell carcinoma\b/i,
      /\bkidney stone\b/i,
    ],
  },
  {
    specialty: 'Urology',
    confidence: 'medium',
    patterns: [
      /\burolog/i,
    ],
  },

  // ---- Nephrology (kidney disease that isn't cancer) ----
  {
    specialty: 'Nephrology',
    confidence: 'high',
    patterns: [
      /\bchronic kidney disease\b|\bckd\b/i,
      /\bend-?stage renal\b|\besrd\b/i,
      /\bdialysis\b/i,
      /\bacute kidney injury\b|\baki\b/i,
    ],
  },
  {
    specialty: 'Nephrology',
    confidence: 'medium',
    patterns: [
      /\bnephrolog/i,
      /\brenal\b/i,
      /\bkidney disease\b/i,
    ],
  },

  // ---- Obstetrics & Gynaecology ----
  {
    specialty: 'Obstetrics & Gynaecology',
    confidence: 'high',
    patterns: [
      /\bcervical cancer screening\b/i,
      /\bfetal (monitoring|heart rate)/i,
      /\bpregnancy complication/i,
      /\bpreeclampsia\b/i,
      /\bendometri(al|osis)/i,
      /\bovarian cancer\b/i,
    ],
  },
  {
    specialty: 'Obstetrics & Gynaecology',
    confidence: 'medium',
    patterns: [
      /\bobstetric/i,
      /\bgyn(a)?ecolog/i,
      /\bpregnan/i,
    ],
  },

  // ---- Orthopaedics ----
  {
    specialty: 'Orthopaedics',
    confidence: 'high',
    patterns: [
      /\bhip replacement\b/i,
      /\bknee replacement\b/i,
      /\bbone fracture\b/i,
      /\bosteoarthritis\b/i,
      /\bosteoporosis\b/i,
      /\bspinal (stenosis|fusion)/i,
    ],
  },
  {
    specialty: 'Orthopaedics',
    confidence: 'medium',
    patterns: [
      /\borthop(a)?edic/i,
      /\bmusculoskeletal\b/i,
    ],
  },

  // ---- Otolaryngology (ENT) ----
  {
    specialty: 'Otolaryngology',
    confidence: 'high',
    patterns: [
      /\bhead and neck cancer\b/i,
      /\blaryngeal (cancer|lesion)/i,
      /\bhearing loss\b/i,
      /\btympani/i,
      /\bchronic rhinosinusitis\b/i,
    ],
  },
  {
    specialty: 'Otolaryngology',
    confidence: 'medium',
    patterns: [
      /\botolaryngolog/i,
      /\bent\b.*(surger|ear|nose|throat)/i,
    ],
  },

  // ---- Emergency Medicine ----
  {
    specialty: 'Emergency Medicine',
    confidence: 'high',
    patterns: [
      /\btriage\b.*\bemergency\b/i,
      /\bsepsis (detection|early warning)/i,
      /\bearly warning score\b/i,
      /\bemergency department\b/i,
    ],
  },
  {
    specialty: 'Emergency Medicine',
    confidence: 'medium',
    patterns: [
      /\bemergency medicine\b/i,
      /\bacute care\b/i,
    ],
  },

  // ---- Intensive Care ----
  {
    specialty: 'Intensive Care',
    confidence: 'high',
    patterns: [
      /\bintensive care unit\b|\bicu\b/i,
      /\bmechanical ventilation\b/i,
      /\bseptic shock\b/i,
      /\bhemodynamic monitor/i,
    ],
  },
  {
    specialty: 'Intensive Care',
    confidence: 'medium',
    patterns: [
      /\bcritical care\b/i,
      /\bintensive care\b/i,
    ],
  },

  // ---- Anaesthesiology ----
  {
    specialty: 'Anaesthesiology',
    confidence: 'high',
    patterns: [
      /\bdepth of anesthes/i,
      /\bdepth of anaesthes/i,
      /\bperioperative monitor/i,
    ],
  },
  {
    specialty: 'Anaesthesiology',
    confidence: 'medium',
    patterns: [
      /\banesthesiolog/i,
      /\banaesthesiolog/i,
      /\banesthesi/i,
    ],
  },

  // ---- Primary Care ----
  {
    specialty: 'Primary Care',
    confidence: 'medium',
    patterns: [
      /\bprimary care\b/i,
      /\bgeneral practice\b/i,
      /\bgp\b.*(triage|referr)/i,
    ],
  },

  // ---- Paediatrics ----
  {
    specialty: 'Paediatrics',
    confidence: 'high',
    patterns: [
      /\bneonatal intensive care\b|\bnicu\b/i,
      /\bpediatric oncolog/i,
      /\bpaediatric oncolog/i,
      /\bchildhood (cancer|leukemia|leukaemia)\b/i,
    ],
  },
  {
    specialty: 'Paediatrics',
    confidence: 'medium',
    patterns: [
      /\bpediatr/i,
      /\bpaediatr/i,
    ],
  },

  // ---- Infectious Disease ----
  {
    specialty: 'Infectious Disease',
    confidence: 'high',
    patterns: [
      /\bcovid-?19\b|\bsars-cov-?2\b/i,
      /\bhiv\b/i,
      /\btuberculosis screening\b/i,
      /\bantimicrobial resistance\b/i,
    ],
  },

  // ---- Rheumatology ----
  {
    specialty: 'Rheumatology',
    confidence: 'high',
    patterns: [
      /\brheumatoid arthritis\b/i,
      /\blupus\b|\bsystemic lupus\b/i,
      /\bankylosing spondylitis\b/i,
      /\bgout\b/i,
    ],
  },
  {
    specialty: 'Rheumatology',
    confidence: 'medium',
    patterns: [
      /\brheumatolog/i,
      /\bautoimmune\b/i,
    ],
  },

  // ---- Hematology ----
  {
    specialty: 'Hematology',
    confidence: 'high',
    patterns: [
      /\bleukemia\b|\bleukaemia\b/i,
      /\blymphoma\b/i,
      /\bmyeloma\b/i,
      /\banemia\b|\banaemia\b/i,
      /\bsickle cell\b/i,
    ],
  },
  {
    specialty: 'Hematology',
    confidence: 'medium',
    patterns: [
      /\bhematolog/i,
      /\bhaematolog/i,
    ],
  },

  // ---- Dentistry ----
  {
    specialty: 'Dentistry',
    confidence: 'high',
    patterns: [
      /\bdental caries\b/i,
      /\bperiodont/i,
      /\bpanoramic radiograph\b/i,
      /\borthodontic/i,
    ],
  },
  {
    specialty: 'Dentistry',
    confidence: 'medium',
    patterns: [
      /\bdental\b/i,
      /\bdentistr/i,
      /\btooth\b/i,
    ],
  },

  // ---- Oncology (cross-cutting — LOWEST priority so organ-specific wins) ----
  {
    specialty: 'Oncology',
    confidence: 'high',
    patterns: [
      /\boncolog/i,
      /\btumor board\b|\btumour board\b/i,
      /\bchemotherap/i,
      /\bradiotherap/i,
      /\bimmunotherap/i,
    ],
  },
  {
    specialty: 'Oncology',
    confidence: 'medium',
    patterns: [
      /\bcancer\b/i,
      /\btumou?r\b/i,
      /\bmalignan/i,
      /\bneoplasm\b/i,
    ],
  },
];

// -----------------------------------------------------------------------
// Matching
// -----------------------------------------------------------------------

/**
 * Infer specialty from a pre-normalised SpecialtyEvidence bundle.
 *
 * Runs HIGH-confidence patterns across every specialty first, then MEDIUM,
 * then LOW. First specialty with a hit at a given level wins — but because
 * Oncology is listed LAST in the PATTERNS array, organ-specific matches
 * (Gastroenterology for colonoscopy, Urology for prostate cancer, etc.) claim
 * cases ahead of the generic Oncology label even when a cancer term is present.
 *
 * Only the clinical text fields are matched. panel / productCode / emdn from
 * the evidence bundle are intentionally NOT consulted here (see module header).
 */
export function inferSpecialty(evidence: SpecialtyEvidence): SpecialtyMatch {
  const none: SpecialtyMatch = {
    specialty: null,
    confidence: 'none',
    signals: { matched_patterns: [], source_fields: [] },
  };

  if (!evidence || typeof evidence !== 'object') return none;

  // Clinical-signal corpus. Keys here are the field labels recorded in
  // signals.source_fields, so name them meaningfully.
  const sources: Record<string, string> = {
    deviceName:   evidence.deviceName || '',
    title:        evidence.title || '',
    conditions:   evidence.conditionsText || '',
    intendedUse:  evidence.intendedUseText || '',
    description:  evidence.descriptionText || '',
    summary:      evidence.summaryText || '',
  };

  const matchedPatterns: string[] = [];
  const sourceFieldsHit = new Set<string>();
  let winner: Pattern | undefined;

  const confidenceOrder: SpecialtyConfidence[] = ['high', 'medium', 'low'];
  for (const level of confidenceOrder) {
    for (const p of PATTERNS) {
      if (p.confidence !== level) continue;
      for (const rx of p.patterns) {
        for (const [field, text] of Object.entries(sources)) {
          if (!text) continue;
          if (rx.test(text)) {
            matchedPatterns.push(`${p.specialty}:${rx.source}`);
            sourceFieldsHit.add(field);
            if (winner === undefined) winner = p;
          }
        }
      }
    }
    if (winner !== undefined) break;
  }

  if (winner === undefined) return none;

  const w: Pattern = winner;
  return {
    specialty: w.specialty,
    confidence: w.confidence,
    signals: {
      matched_patterns: matchedPatterns.slice(0, 10),
      source_fields: Array.from(sourceFieldsHit),
    },
  };
}

// -----------------------------------------------------------------------
// Master-pass arbitration (backbone de-baring, July 2026)
//
// The device_master evidence channel includes openFDA classification text,
// which for imaging devices is saturated with MODALITY-LANE vocabulary
// ("radiological image processing", "imaging", "x-ray system"). In trial
// text those words often do signal Radiology as the clinical home; in
// classification text they signal the modality lane. inferSpecialty() —
// tuned for queue/trial text — must not change. This master-specific
// arbitration implements the reviewed policy (spot-check, 8 Jul 2026):
//
//   1. Collect matches across ALL confidence levels for ALL specialties
//      (inferSpecialty stops at the first winning level, which let generic
//      'imaging' at medium beat organ-specific signals at the same level
//      because Radiology is listed first — the NaviCam bug).
//   2. Radiology matches split into HOME-class (mammography, chest
//      radiograph, fracture detection… — Radiology is the clinical home)
//      and MODALITY-class (imaging, radiological, x-ray, MRI, CT… — lane
//      vocabulary).
//   3. Any organ-specific specialty match, or a HOME-class Radiology match,
//      beats MODALITY-class-only Radiology.
//   4. MODALITY-class-only evidence → Radiology at MEDIUM (the modality-led
//      default the reviewer confirmed for CT/MR/x-ray/ultrasound platforms),
//      flagged modalityOnly=true — which is also the candidate list for the
//      future cross-specialty "imaging role" axis.
//
// Brand-knowledge exceptions (Vivid → Cardiology etc.) are NOT encoded here —
// they live in specialty-overrides.csv and take precedence in the script.
// -----------------------------------------------------------------------

/**
 * Radiology pattern sources classified as MODALITY-lane vocabulary for the
 * master pass. Everything else in the Radiology blocks is HOME-class.
 * A fixture asserts every entry still exists in PATTERNS (drift guard).
 */
export const MASTER_MODALITY_CLASS_SOURCES: readonly string[] = [
  '\\bradiolog(y|ist|ical)\\b',
  '\\bmri\\b',
  '\\bmagnetic resonance\\b',
  '\\bct\\s+(scan|angiograph|pulmonary)\\b',
  '\\bcomputed tomography\\b',
  '\\bx-?ray\\b',
  '\\bimaging\\b',
  '\\bscreening imag',
];

/** All Radiology pattern regex sources — exported for the drift-guard fixture. */
export function radiologyPatternSources(): string[] {
  return PATTERNS.filter((p) => p.specialty === 'Radiology').flatMap((p) =>
    p.patterns.map((rx) => rx.source)
  );
}

export interface MasterSpecialtyMatch extends SpecialtyMatch {
  /** True when the ONLY evidence was modality-lane Radiology vocabulary. */
  modalityOnly: boolean;
}

export function inferSpecialtyForMaster(evidence: SpecialtyEvidence): MasterSpecialtyMatch {
  const none: MasterSpecialtyMatch = {
    specialty: null,
    confidence: 'none',
    signals: { matched_patterns: [], source_fields: [] },
    modalityOnly: false,
  };
  if (!evidence || typeof evidence !== 'object') return none;

  const sources: Record<string, string> = {
    deviceName:   evidence.deviceName || '',
    title:        evidence.title || '',
    conditions:   evidence.conditionsText || '',
    intendedUse:  evidence.intendedUseText || '',
    description:  evidence.descriptionText || '',
    summary:      evidence.summaryText || '',
  };

  const modalitySet = new Set(MASTER_MODALITY_CLASS_SOURCES);

  interface Hit { pattern: Pattern; rxSource: string; field: string; isModality: boolean }
  const hits: Hit[] = [];
  for (const p of PATTERNS) {
    for (const rx of p.patterns) {
      for (const [field, text] of Object.entries(sources)) {
        if (!text) continue;
        if (rx.test(text)) {
          hits.push({
            pattern: p,
            rxSource: rx.source,
            field,
            isModality: p.specialty === 'Radiology' && modalitySet.has(rx.source),
          });
        }
      }
    }
  }
  if (hits.length === 0) return none;

  const matchedPatterns = Array.from(
    new Set(hits.map((h) => `${h.pattern.specialty}:${h.rxSource}`))
  ).slice(0, 10);
  const sourceFields = Array.from(new Set(hits.map((h) => h.field)));

  // Candidate pool: everything except modality-class Radiology.
  const pool = hits.filter((h) => !h.isModality);

  if (pool.length > 0) {
    // Same semantics as inferSpecialty, restricted to the pool: high → medium
    // → low; within a level, PATTERNS array order (organ-specific before
    // Oncology; Radiology home-class competes normally).
    const order: SpecialtyConfidence[] = ['high', 'medium', 'low'];
    for (const level of order) {
      for (const p of PATTERNS) {
        if (p.confidence !== level) continue;
        if (pool.some((h) => h.pattern === p)) {
          return {
            specialty: p.specialty,
            confidence: p.confidence,
            signals: { matched_patterns: matchedPatterns, source_fields: sourceFields },
            modalityOnly: false,
          };
        }
      }
    }
  }

  // Only modality-class Radiology matched → modality-led default.
  return {
    specialty: 'Radiology',
    confidence: 'medium',
    signals: { matched_patterns: matchedPatterns, source_fields: sourceFields },
    modalityOnly: true,
  };
}
