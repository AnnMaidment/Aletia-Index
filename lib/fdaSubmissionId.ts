// ============================================================
// lib/fdaSubmissionId.ts
//
// One home for FDA submission-number shape logic. Pure — no network, no DB.
//
// Why this module exists (25 August). The same three-line shape check was
// copy-pasted into four places: lib/pccpIngest.ts and three arms of
// app/api/admin/queue/accept/route.ts. All four carried the same defect
// (BUG-013): PMA was matched as `^P[0-9]+$`, which does not match a PMA
// SUPPLEMENT — "P190016/S007". The two failure modes differed by site:
//
//   - pccpIngest: the row failed the shape check and was skipped outright.
//     ~40 authorized-PCCP supplements lost on the 10 Jun run.
//   - accept route (legacy_queue / oleary_csv arms): the PMA branch missed and
//     the code fell through to a `fda_k_number` DEFAULT — so accepting such a
//     row would have written a supplement string into device_external_ids
//     under the wrong id_type. Quieter than a skip, and worse: a mistyped
//     canonical identifier that the 4d gate would never match again.
//
// Device identity is the BASE PMA number. device_external_ids holds
// "P190016"; the FDA list and openFDA both key on the base. A supplement is
// history *about* that device, not a second device. So: strip the supplement
// for identity, keep the full string for audit trails and anomaly reports.
// ============================================================

export type FdaSubmissionType = 'fda_k_number' | 'fda_de_novo' | 'fda_pma'

/** Uppercase, strip all whitespace. "k251293" → "K251293". */
export function normaliseId(raw: string): string {
  return (raw ?? '').toUpperCase().replace(/\s+/g, '').trim()
}

// normaliseId removes whitespace before these run, so a source that writes
// "P190016 S007" arrives as "P190016S007" — hence the slashless branch. It is
// pinned to exactly 6 base digits (PMA numbers are P + YYNNNN) so it cannot
// mis-split an identifier that merely ends in S-digits, e.g. "K250007S001".
const PMA_SUPPLEMENT_SLASHED   = /^(P[0-9]+)\/S[0-9]+$/
const PMA_SUPPLEMENT_SLASHLESS = /^(P[0-9]{6})S[0-9]+$/

/**
 * The identifier a device is actually keyed on. For a PMA supplement this is
 * the base PMA number; for every other shape the id is returned unchanged.
 * Expects an already-normalised id.
 */
export function baseSubmissionId(id: string): string {
  const m = PMA_SUPPLEMENT_SLASHED.exec(id) ?? PMA_SUPPLEMENT_SLASHLESS.exec(id)
  return m ? m[1] : id
}

/**
 * Classify a submission number by shape, on its BASE form.
 * Returns null when the shape is not a recognised FDA submission number —
 * callers must treat null as "do not guess", never as a default to K-number.
 */
export function classifySubmissionNumber(id: string): FdaSubmissionType | null {
  const base = baseSubmissionId(id)
  if (/^K[0-9]+$/.test(base))   return 'fda_k_number'
  if (/^DEN[0-9]+$/.test(base)) return 'fda_de_novo'
  if (/^P[0-9]+$/.test(base))   return 'fda_pma'
  return null
}

/**
 * Convenience for identifier-attachment sites: normalise, classify, and hand
 * back the id_value that should be STORED (the base). Null when unclassifiable.
 */
export function resolveFdaSubmission(
  raw: string,
): { id_type: FdaSubmissionType; id_value: string } | null {
  const normalised = normaliseId(raw)
  const id_type = classifySubmissionNumber(normalised)
  if (!id_type) return null
  return { id_type, id_value: baseSubmissionId(normalised) }
}
