// Technology-name resolution for the index and device pages.
//
// Display standard (see INDEX-DISPLAY-STANDARDISATION-SPEC):
//   primary line / <h1> = the DEVICE / technology name — never the organisation.
//   the manufacturer / sponsor is always the secondary line.
//
// Some CT.gov-sourced rows carry a generic source label as `name`
// (e.g. "Artificial Intelligence (AI)", "Application Validation") rather than a
// real product name. Promoting those into the primary slot would be misleading,
// so they are treated as "no real name" and fall through to a controlled
// placeholder. The proper fix is at queue-accept time (spec scope item 4); this
// guard keeps the rendered page honest until the underlying data is corrected.

export const UNNAMED_TECHNOLOGY = 'Unnamed AI-enabled technology'

// Conservative: only obviously-generic source labels are caught. Borderline-real
// intervention names are left alone. Extend at accept time, not here.
const GENERIC_NAME_PATTERNS: RegExp[] = [
  /^artificial intelligence(\s*\(ai\))?$/i,
  /^ai(\s*\/\s*ml)?$/i,
  /^machine learning$/i,
  /^deep learning$/i,
  /^application validation$/i,
  /^software$/i,
  /^algorithm$/i,
  /^device$/i,
]

/** True when `name` is a usable, specific technology name (not blank, not a generic label). */
export function isRealTechnologyName(name: string | null | undefined): boolean {
  const n = name?.trim()
  if (!n) return false
  return !GENERIC_NAME_PATTERNS.some((re) => re.test(n))
}

/** The technology name to show in the primary slot, with the honest placeholder fallback. */
export function technologyName(name: string | null | undefined): string {
  const n = name?.trim()
  return isRealTechnologyName(n) ? n! : UNNAMED_TECHNOLOGY
}
