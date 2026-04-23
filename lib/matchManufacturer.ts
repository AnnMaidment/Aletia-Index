import { createClient, SupabaseClient } from '@supabase/supabase-js'

export type MatchConfidence = 'high' | 'medium' | 'low'

export interface ManufacturerMatch {
  id: string
  name: string
  confidence: MatchConfidence
}

/**
 * Attempts to match an incoming manufacturer name string against the
 * manufacturers table using a tiered strategy:
 *
 *  1. Exact match (case-insensitive, after suffix normalisation)  → high
 *  2. First-token contains match with similarity scoring          → medium
 *  3. No match                                                    → null
 */
export async function matchManufacturer(
  incomingName: string,
  supabase: SupabaseClient
): Promise<ManufacturerMatch | null> {
  const cleaned = incomingName.trim()
  if (!cleaned) return null

  const normalised = normaliseSuffixes(cleaned)

  // ── Tier 1: exact match on original and normalised forms ──────────────────
  for (const candidate of dedupe([cleaned, normalised])) {
    const { data: exact, error } = await supabase
      .from('manufacturers')
      .select('id, name')
      .ilike('name', candidate)
      .limit(1)
      .single()

    if (!error && exact) {
      return { id: exact.id, name: exact.name, confidence: 'high' }
    }
  }

  // ── Tier 2: first-token contains match, normalised similarity scoring ─────
  const firstToken = normalised.split(/\s+/)[0]

  if (firstToken.length >= 4) {
    const { data: contains, error: containsError } = await supabase
      .from('manufacturers')
      .select('id, name')
      .ilike('name', `%${firstToken}%`)
      .limit(10)

    if (!containsError && contains && contains.length > 0) {
      const scored = contains.map((m) => ({
        ...m,
        score: stringSimilarity(
          normalised.toLowerCase(),
          normaliseSuffixes(m.name).toLowerCase()
        ),
      }))
      scored.sort((a, b) => b.score - a.score)

      const [best, second] = scored

      if (best.score >= 0.85) {
        // Very high similarity — treat as high confidence
        return { id: best.id, name: best.name, confidence: 'high' }
      }

      if (best.score >= 0.6 && (!second || best.score - second.score >= 0.2)) {
        return { id: best.id, name: best.name, confidence: 'medium' }
      }
    }
  }

  return null
}

// ── Suffix normalisation ──────────────────────────────────────────────────────
// Converts verbose legal suffixes to their short forms so
// "Skin Analytics Limited" matches "Skin Analytics Ltd" in the DB.

const SUFFIX_MAP: [RegExp, string][] = [
  [/\bLimited\b/gi,      'Ltd'],
  [/\bIncorporated\b/gi, 'Inc'],
  [/\bCorporation\b/gi,  'Corp'],
  [/\bCompany\b/gi,      'Co'],
  [/\bPrivate\b/gi,      'Pty'],
  [/\bPublic\b/gi,       'PLC'],
  [/\bSociété Anonyme\b/gi, 'SA'],
  [/\bGesellschaft mit beschränkter Haftung\b/gi, 'GmbH'],
  [/[.,]+$/g,            ''],   // strip trailing punctuation
]

function normaliseSuffixes(name: string): string {
  let result = name
  for (const [pattern, replacement] of SUFFIX_MAP) {
    result = result.replace(pattern, replacement)
  }
  return result.replace(/\s+/g, ' ').trim()
}

// ── Dice coefficient bigram similarity ────────────────────────────────────────

export function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0

  const aBigrams = new Map<string, number>()
  for (let i = 0; i < a.length - 1; i++) {
    const bigram = a.slice(i, i + 2)
    aBigrams.set(bigram, (aBigrams.get(bigram) ?? 0) + 1)
  }

  let intersectionCount = 0
  for (let i = 0; i < b.length - 1; i++) {
    const bigram = b.slice(i, i + 2)
    const count = aBigrams.get(bigram) ?? 0
    if (count > 0) {
      aBigrams.set(bigram, count - 1)
      intersectionCount++
    }
  }

  return (2.0 * intersectionCount) / (a.length + b.length - 2)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)]
}