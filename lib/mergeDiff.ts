/**
 * lib/mergeDiff.ts
 *
 * Field-level merge diff for the admin queue. When an incoming record (a
 * cross-jurisdiction EUDAMED match, or any other source) is merged into an
 * existing device, the operator should see WHERE the incoming data conflicts
 * with or could enrich the device, and choose per field — instead of the route
 * silently gap-filling (loses information) or skipping (throws away genuine
 * enrichment).
 *
 * Scope: CONTENT fields only. Identity (aletia_id, external_legacy_id, the
 * primary identifier) and the additive facts (the new device_external_ids row,
 * the new regional_registrations row) are NEVER part of the diff — a merge
 * always keeps identity and always adds the registration + identifier. The diff
 * is purely about device_master descriptive fields.
 *
 * This is a pure function — no DB, no side effects. The accept route consumes
 * the operator's decisions; the queue drawer renders the diff. Reusable across
 * every merge source (FDA / MHRA / EUDAMED / CT.gov), not EU-specific.
 *
 * Comparison is NORMALISED so trivially-equal values ("GE Healthcare" vs
 * "GE Healthcare GmbH") read as `same`, not `conflict` — otherwise every
 * cross-jurisdiction merge would show noisy false conflicts and the operator
 * would stop on every row. The operator only stops on genuine disagreement.
 */

import { stringSimilarity } from './matchManufacturer'

export type FieldDiffStatus = 'same' | 'enrich' | 'conflict'

export interface FieldDiff {
  /** device_master column name. */
  field: string
  /** Human label for the drawer. */
  label: string
  existing: string | null
  incoming: string | null
  status: FieldDiffStatus
  /** What the drawer should default the decision to. */
  suggested: 'keep' | 'use_incoming'
}

export interface MergeFieldSpec {
  field: string
  label: string
  /** Treat as a manufacturer/org name: suffix-normalised, higher fuzzy tolerance. */
  org?: boolean
  /**
   * Similarity (0..1) at/above which two non-empty values count as the SAME
   * fact rather than a conflict. Default 0.92; org fields default 0.85 (legal
   * suffixes vary more). Set to 1 to require exact (post-normalisation) equality.
   */
  sameThreshold?: number
}

/** The default content fields a device merge diffs over. */
export const DEFAULT_MERGE_FIELDS: MergeFieldSpec[] = [
  { field: 'name', label: 'Device name', sameThreshold: 0.95 },
  { field: 'manufacturer_name', label: 'Manufacturer', org: true, sameThreshold: 0.85 },
  { field: 'intended_use', label: 'Intended use', sameThreshold: 0.9 },
  { field: 'eu_risk_class', label: 'EU risk class', sameThreshold: 1 },
]

// Org legal suffixes are STRIPPED before comparison (not normalised to a token),
// so "GE Healthcare" and "GE Healthcare GmbH" — and "Aidoc Medical Ltd" vs
// "Aidoc Medical GmbH" — compare on the base name and read as `same`, not a
// suffix-noise conflict. The operator still sees both raw values in the drawer.
const ORG_SUFFIXES: RegExp[] = [
  /\bLimited\b/gi, /\bLtd\.?\b/gi, /\bIncorporated\b/gi, /\bInc\.?\b/gi,
  /\bCorporation\b/gi, /\bCorp\.?\b/gi, /\bCompany\b/gi, /\bCo\.?\b/gi,
  /\bGmbH\b/gi, /\bB\.?V\.?\b/gi, /\bS\.?A\.?\b/gi, /\bN\.?V\.?\b/gi,
  /\bAG\b/gi, /\bLLC\b/gi, /\bPLC\b/gi, /\bPty\b/gi, /\bSAS\b/gi, /\bSRL\b/gi,
]

const clean = (s: string | null | undefined): string =>
  (s ?? '').trim().toLowerCase().replace(/[.,]+$/g, '').replace(/\s+/g, ' ')

function normOrg(s: string | null | undefined): string {
  let r = clean(s)
  for (const re of ORG_SUFFIXES) r = r.replace(re, '')
  return r.replace(/\s+/g, ' ').trim()
}

const isEmpty = (s: string | null | undefined): boolean => clean(s) === ''

/**
 * Compute the per-field merge diff between an existing device and an incoming
 * record. `existing` and `incoming` are keyed by device_master column name;
 * pass only the fields you want to diff (or rely on DEFAULT_MERGE_FIELDS).
 *
 * - existing empty, incoming present → `enrich` (suggested: use_incoming)
 * - existing present, incoming empty → omitted (nothing to offer)
 * - both present, normalised-equal / similar ≥ threshold → `same`
 * - both present, genuinely differ → `conflict` (suggested: keep)
 *
 * `same` rows are returned too (so the drawer can show "N fields already
 * agree"), but they carry no decision.
 */
export function computeMergeDiff(
  existing: Record<string, string | null | undefined>,
  incoming: Record<string, string | null | undefined>,
  fields: MergeFieldSpec[] = DEFAULT_MERGE_FIELDS,
): FieldDiff[] {
  const out: FieldDiff[] = []

  for (const spec of fields) {
    const exRaw = existing[spec.field] ?? null
    const inRaw = incoming[spec.field] ?? null
    const exEmpty = isEmpty(exRaw)
    const inEmpty = isEmpty(inRaw)

    // Nothing incoming to offer, or both empty → skip entirely.
    if (inEmpty) continue

    if (exEmpty) {
      out.push({
        field: spec.field, label: spec.label,
        existing: exRaw, incoming: inRaw,
        status: 'enrich', suggested: 'use_incoming',
      })
      continue
    }

    // Both present — same fact or conflict?
    const threshold = spec.sameThreshold ?? 0.92
    const a = spec.org ? normOrg(exRaw) : clean(exRaw)
    const b = spec.org ? normOrg(inRaw) : clean(inRaw)
    const same = a === b || (threshold < 1 && stringSimilarity(a, b) >= threshold)

    out.push({
      field: spec.field, label: spec.label,
      existing: exRaw, incoming: inRaw,
      status: same ? 'same' : 'conflict',
      suggested: 'keep',
    })
  }

  return out
}

/**
 * Build the `incoming` field map for computeMergeDiff from a queue row's
 * raw_data, per source. The cardinal rule (BUG-002's root): intended_use is
 * mapped ONLY from the source's real intended-use/medical-purpose text, never
 * synthesised from the device name. Sources with no such text leave it null —
 * it then simply never appears as an enrich row.
 *
 * Raw shapes (grounded against the writers, 10 June 2026):
 *   eudamed_sync — spread EudamedDeviceRecord (lib/eudamedSync.ts) or the
 *     crosswalk-seed shape (scripts/seed-eudamed.ts): device_name,
 *     manufacturer_name, risk_class, medical_purpose (sync path only; the
 *     Basic UDI record carrying it is not retrievable as of 9 June 2026).
 *   fda_sync / pccp_ingest / oleary_csv — lib/fdaSync.ts payload: device_name,
 *     applicant. No intended-use text on the FDA list/sweep payloads.
 *   mhra_sync — lib/mhraSync.ts payload: GMDN_TERM_NAME (the gate's deviceName).
 *     Manufacturer name is not in the payload; fall back to the queue column.
 *   clinical_trials — spread ClinicalTrial; the queue columns carry the
 *     device/sponsor names. brief_summary is trial prose, NOT intended use.
 *
 * `queueRow` supplies the device_name/manufacturer columns as fallback so a
 * thin raw_data still produces a usable map.
 */
export function buildIncomingFields(
  source: string,
  raw: Record<string, unknown>,
  queueRow: { device_name: string | null; manufacturer: string | null },
): Record<string, string | null> {
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() !== '' ? v : null

  switch (source) {
    case 'eudamed_sync':
      return {
        name:              str(raw.device_name) ?? queueRow.device_name,
        manufacturer_name: str(raw.manufacturer_name) ?? queueRow.manufacturer,
        intended_use:      str(raw.medical_purpose),
        eu_risk_class:     str(raw.risk_class),
      }
    case 'fda_sync':
    case 'pccp_ingest':
    case 'oleary_csv':
      return {
        name:              str(raw.device_name) ?? queueRow.device_name,
        manufacturer_name: str(raw.applicant) ?? queueRow.manufacturer,
        intended_use:      null,
        eu_risk_class:     null,
      }
    case 'mhra_sync':
      return {
        name:              str(raw.GMDN_TERM_NAME) ?? queueRow.device_name,
        manufacturer_name: queueRow.manufacturer,
        intended_use:      null,
        // DEVICE_SUB_TYPE_DESC is a UK classification, not an EU risk class.
        eu_risk_class:     null,
      }
    default:
      // clinical_trials and anything else: queue columns only, no intended use.
      return {
        name:              queueRow.device_name,
        manufacturer_name: queueRow.manufacturer,
        intended_use:      null,
        eu_risk_class:     null,
      }
  }
}

/** Convenience: only the rows that need the operator's attention. */
export function actionableDiffs(diffs: FieldDiff[]): FieldDiff[] {
  return diffs.filter((d) => d.status !== 'same')
}

/**
 * Resolve a diff + the operator's decisions into the device_master patch to
 * apply on merge. Only `use_incoming` decisions produce a write; `keep` (and
 * anything not decided) leaves the existing value untouched. This REPLACES the
 * accept route's implicit fillIfNull — the route applies exactly this patch.
 */
export function resolveMergePatch(
  diffs: FieldDiff[],
  decisions: Record<string, 'keep' | 'use_incoming'>,
): Record<string, string> {
  const patch: Record<string, string> = {}
  for (const d of diffs) {
    const decision = decisions[d.field] ?? d.suggested
    if (decision === 'use_incoming' && d.incoming != null && d.incoming.trim() !== '') {
      patch[d.field] = d.incoming
    }
  }
  return patch
}
