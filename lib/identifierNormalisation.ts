/**
 * lib/identifierNormalisation.ts
 *
 * Shared helpers for turning a user-typed or URL-supplied device identifier
 * into something we can look up against the A2b schema.
 *
 * Two shapes matter:
 *
 *   1. Aletia IDs  — canonical. Format `ALT-NNNNNN` (six or more digits). These
 *      are the primary key of device_master.
 *
 *   2. External IDs — whatever the external registry uses. Stored in
 *      device_external_ids.id_value as they appear in the source. Notably,
 *      MHRA device IDs are stored as raw numerics (e.g. "47392"), NOT with
 *      the historical "MHRA-" prefix. FDA K-numbers keep their K prefix
 *      (e.g. "K230001"). NCT numbers keep their NCT prefix.
 *
 * BUG-009 (24 Apr 2026): users who bookmarked pre-A2b URLs like
 *   /device/MHRA-47392
 * or search for that exact string on the home page need to continue to hit.
 * The device is findable — the raw "47392" lives in device_external_ids —
 * but only if we strip the "MHRA-" prefix before the lookup.
 *
 * Keep this list short and explicit. Every entry here is a historical
 * synthesis that A2b undid. If new prefix-strips appear, add them here and
 * they propagate to both the redirect layer (device/[id]/page.tsx) and the
 * home search secondary-id pre-query (page.tsx).
 */

const KNOWN_PREFIX_STRIPS = [
  // Historical "MHRA-47392" shape, now stored raw as "47392"
  /^MHRA-/i,
]

/**
 * Normalise a user-supplied identifier for use against
 * device_external_ids.id_value. Trims whitespace and strips known historical
 * prefixes. Leaves K-numbers, NCT numbers, ALT-xxxxxx etc. untouched.
 */
export function normaliseIdentifierInput(raw: string): string {
  let s = raw.trim()
  for (const prefix of KNOWN_PREFIX_STRIPS) {
    if (prefix.test(s)) {
      s = s.replace(prefix, '')
      break
    }
  }
  return s
}

/**
 * True if the input looks like a canonical Aletia ID. Matches `ALT-` followed
 * by at least 6 digits. Case-insensitive on the prefix for safety (URL copy/
 * paste sometimes lowercases), but the canonical form is always uppercase.
 */
export function isAletiaId(raw: string): boolean {
  return /^ALT-\d{6,}$/i.test(raw.trim())
}

/**
 * Force an Aletia ID string into canonical uppercase form. Only call on
 * values that pass isAletiaId().
 */
export function canonicaliseAletiaId(raw: string): string {
  return raw.trim().toUpperCase()
}
