/**
 * lib/fdaDedup.ts
 *
 * Shared core for the FDA same-product dedup (Session 2). Both the read-only
 * detector (scripts/fda-dedup-detect.ts) and the Band-A apply script
 * (scripts/fda-dedup-apply.ts) import the SAME clustering here, so what you
 * review in the dry-run report is exactly what the apply collapses — no risk of
 * detect/apply divergence.
 *
 * Decisions encoded (see FDA-DEDUP-DESIGN-DOC.md):
 *   - device-level identity (one aletia_id per product; submissions are external ids)
 *   - SAME PRODUCT ONLY (version merges, not brand families) — the normaliser
 *     strips version noise but keeps distinctive model tokens; banding routes
 *     anything fuzzy to human review
 *   - merged_into marks absorbed rows (set by the apply; never DELETE)
 *
 * Banding (the Decision-4 input):
 *   A — exact manufacturer + exact normalised name + single product_code → scriptable
 *   B — exact manufacturer + exact normalised name, product_codes differ → queue
 *   C — exact manufacturer + fuzzy version/family name match → queue
 */

import { stringSimilarity } from './matchManufacturer'

export type Band = 'A' | 'B' | 'C'

export const FDA_ID_TYPES = ['fda_k_number', 'fda_de_novo', 'fda_pma'] as const

export interface DeviceRow {
  aletia_id: string
  name: string | null
  manufacturer_name: string | null
  manufacturer_link: string | null
  created_at: string
  data_source: string | null
}

export interface DeviceFacts extends DeviceRow {
  fdaIds: string[]                 // submission numbers attached to this device
  productCodes: string[]           // resolved from the FDA list, deduped
  earliestDecision: string | null  // earliest decision_date across its submissions
}

export interface Cluster {
  band: Band
  manufacturerKey: string
  nameKey: string
  productCodes: string[]
  members: DeviceFacts[]           // sorted: proposed survivor first
  proposedSurvivor: string         // aletia_id — earliest clearance, then earliest created_at
  reason: string
}

/** Fuzzy-name Dice threshold for Band C grouping. */
export const FUZZY_NAME_THRESHOLD = 0.82

// ── Name normalisation ────────────────────────────────────────────────────────
// Strip the tokens that distinguish *versions of one product* (which should
// collapse) while preserving the tokens that distinguish *sibling products*
// (which must not).

const VERSION_NOISE: RegExp[] = [
  // DOTTED versions only: 2.2, 3.1.0, v2.0. Requiring a dot is the V8 GUARD —
  // a bare "V8"/"V7" is a Samsung ultrasound MODEL name, not a version, and
  // must survive so two different models don't collapse to the same generic
  // string ("…Diagnostic Ultrasound System"). The cost is that a genuine bare
  // version bump (RADAC V2→V3) is no longer stripped, so it lands in Band C
  // (reviewed) rather than Band A (scripted) — the safe direction.
  /\bv?\d+\.\d+(?:\.\d+)*\b/gi,
  // Numbers introduced by an explicit version keyword: "Version 3", "ver 2.2".
  /\b(?:version|ver|rev|revision|release)\s*v?\d+(?:\.\d+)*\b/gi,
  /\b(?:version|ver|rev|revision|release)\b/gi,
  /\b(?:gen|generation)\s*\d*\b/gi,
  /\b(?:mk|mark)\s*\d+\b/gi,
  /\b(?:19|20)\d{2}\b/g,                     // stray year — 1900–2099 ONLY. A bare
  // \d{4} also eats 4-digit MODEL numbers ("Ultrasound System 2300" vs "1300",
  // MRT-3020, MRT-1550), collapsing distinct models. Restricting to 19xx/20xx
  // keeps real years stripped while preserving model numbers (1300/2300/3020/1550
  // don't start 19/20). Same lesson as the V8 guard.
  /\b(?:update|upgrade)\b/gi,
  // Roman-numeral version markers. Lone 'v' is deliberately EXCLUDED (it could
  // be a model designator); 'x' is kept (e.g. "aPROMISE X" → "aPROMISE").
  /\b(?:ii|iii|iv|vi|vii|viii|ix|x)\b/gi,
]

const NAME_SUFFIX_NOISE: RegExp[] = [
  /\b(?:software|system|platform|solution|suite|application|app|module|device)\b/gi,
  /[®™©]/g,
  /[,.\-_/]+/g,
]

export function normaliseName(raw: string | null): string {
  if (!raw) return ''
  let s = raw.toLowerCase()
  for (const re of VERSION_NOISE) s = s.replace(re, ' ')
  for (const re of NAME_SUFFIX_NOISE) s = s.replace(re, ' ')
  return s.replace(/\s+/g, ' ').trim()
}

// Manufacturer key: prefer the FK (manufacturer_link — exact); fall back to a
// suffix-stripped manufacturer_name so never-linked devices still group.
export function manufacturerKey(d: DeviceRow): string {
  if (d.manufacturer_link) return `link:${d.manufacturer_link}`
  const n = (d.manufacturer_name ?? '')
    .toLowerCase()
    .replace(/\b(?:inc|llc|ltd|limited|corp|corporation|co|gmbh|sa|ag|bv|nv|plc|pty)\b/g, '')
    .replace(/[,.\-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return n ? `name:${n}` : ''
}

function uniq<T>(arr: T[]): T[] { return [...new Set(arr)] }

function makeCluster(
  band: Band, manufacturerKey: string, nameKey: string,
  productCodes: string[], members: DeviceFacts[], reason: string,
): Cluster {
  // Proposed survivor: earliest FDA decision_date, tie-broken by earliest created_at.
  const sorted = [...members].sort((a, b) => {
    const ad = a.earliestDecision ?? '9999'
    const bd = b.earliestDecision ?? '9999'
    if (ad !== bd) return ad < bd ? -1 : 1
    return a.created_at < b.created_at ? -1 : 1
  })
  return { band, manufacturerKey, nameKey, productCodes, members: sorted, proposedSurvivor: sorted[0].aletia_id, reason }
}

/**
 * Cluster FDA-attached devices into same-product groups. Pure: takes assembled
 * facts, returns clusters of size >= 2. Caller filters by band / size.
 */
export function clusterDevices(facts: DeviceFacts[]): Cluster[] {
  const byMfr = new Map<string, DeviceFacts[]>()
  for (const f of facts) {
    const key = manufacturerKey(f)
    if (!key) continue // no manufacturer signal — can't safely cluster; left singleton
    const arr = byMfr.get(key) ?? []
    arr.push(f)
    byMfr.set(key, arr)
  }

  const clusters: Cluster[] = []

  for (const [mfrKey, group] of byMfr) {
    if (group.length < 2) continue

    // Exact normalised-name buckets within this manufacturer → Band A or B.
    const byName = new Map<string, DeviceFacts[]>()
    for (const f of group) {
      const nk = normaliseName(f.name)
      if (!nk) continue
      const arr = byName.get(nk) ?? []
      arr.push(f)
      byName.set(nk, arr)
    }

    const claimed = new Set<string>()
    for (const [nameKey, members] of byName) {
      if (members.length < 2) continue
      members.forEach((m) => claimed.add(m.aletia_id))
      const codes = uniq(members.flatMap((m) => m.productCodes))
      const band: Band = codes.length <= 1 ? 'A' : 'B'
      clusters.push(makeCluster(band, mfrKey, nameKey, codes, members,
        band === 'A'
          ? 'exact manufacturer + exact normalised name + single product code'
          : 'exact manufacturer + exact normalised name; product codes differ — review same-product assumption'))
    }

    // Remaining members → fuzzy version/family pass → Band C.
    const remaining = group.filter((f) => !claimed.has(f.aletia_id) && normaliseName(f.name))
    for (let i = 0; i < remaining.length; i++) {
      if (claimed.has(remaining[i].aletia_id)) continue
      const seed = remaining[i]
      const seedKey = normaliseName(seed.name)
      const members = [seed]
      for (let j = i + 1; j < remaining.length; j++) {
        if (claimed.has(remaining[j].aletia_id)) continue
        if (stringSimilarity(seedKey, normaliseName(remaining[j].name)) >= FUZZY_NAME_THRESHOLD) {
          members.push(remaining[j])
        }
      }
      if (members.length >= 2) {
        members.forEach((m) => claimed.add(m.aletia_id))
        const codes = uniq(members.flatMap((m) => m.productCodes))
        clusters.push(makeCluster('C', mfrKey, seedKey, codes, members,
          'exact manufacturer + fuzzy version/family name match — QUEUE; family-vs-product judgement required'))
      }
    }
  }

  return clusters
}

// ── Absorb planner ────────────────────────────────────────────────────────────
// The exact DB operations to collapse one cluster into its survivor. Pure: no
// DB access — the apply script executes these. Mirrors the design doc §5.

export interface ExternalIdMove {
  external_id_row_id: string   // device_external_ids.id
  from_aletia_id: string
  id_type: string
  id_value: string
}

export interface AbsorbPlan {
  survivor: string
  absorbed: string[]                 // aletia_ids tombstoned (merged_into = survivor)
  idMoves: ExternalIdMove[]          // external-id rows re-pointed to survivor
  // regional_registrations are NOT moved: the survivor already holds a US/FDA
  // reg and the (device_link,country,regulatory_body) unique constraint would
  // collide. Absorbed regs are tombstoned alongside their device via merged_into
  // (the public index filters merged_into IS NULL). Recorded for transparency.
  note: string
}

export interface ExternalIdRow {
  id: string
  aletia_id: string
  id_type: string
  id_value: string
}

/**
 * Plan the absorb for a cluster (detector path — survivor is the proposed one,
 * all other members are absorbed). Delegates to planAbsorbFromIds.
 */
export function planAbsorb(
  cluster: Cluster,
  externalIdsByDevice: Map<string, ExternalIdRow[]>,
): AbsorbPlan {
  const absorbed = cluster.members
    .filter((m) => m.aletia_id !== cluster.proposedSurvivor)
    .map((m) => m.aletia_id)
  return planAbsorbFromIds(cluster.proposedSurvivor, absorbed, externalIdsByDevice)
}

/**
 * Plan the absorb from an explicit survivor + absorbed set (queue path — the
 * operator may pick a different survivor than proposed and absorb a subset of
 * the cluster, e.g. splitting a brand family). `survivorPairs` are skipped so a
 * duplicate (id_type,id_value) never violates the unique index.
 */
export function planAbsorbFromIds(
  survivor: string,
  absorbed: string[],
  externalIdsByDevice: Map<string, ExternalIdRow[]>,
): AbsorbPlan {
  const survivorPairs = new Set(
    (externalIdsByDevice.get(survivor) ?? []).map((r) => `${r.id_type}|${r.id_value}`),
  )
  const idMoves: ExternalIdMove[] = []

  for (const absorbedId of absorbed) {
    if (absorbedId === survivor) continue
    for (const row of externalIdsByDevice.get(absorbedId) ?? []) {
      const pair = `${row.id_type}|${row.id_value}`
      if (survivorPairs.has(pair)) continue // already on survivor — skip (avoid unique clash)
      survivorPairs.add(pair)
      idMoves.push({
        external_id_row_id: row.id,
        from_aletia_id: absorbedId,
        id_type: row.id_type,
        id_value: row.id_value,
      })
    }
  }

  return {
    survivor,
    absorbed: absorbed.filter((a) => a !== survivor),
    idMoves,
    note: 'regional_registrations tombstoned via merged_into (not moved — unique (device_link,country,regulatory_body))',
  }
}
