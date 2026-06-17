/**
 * scripts/fix-hair-ivdr.ts
 *
 * One-shot repair: the first extract (2026-06-17) mapped pathology IVD certs
 * with the wrong type key, so ivdr_class/ivdr_pathway came out null. The real
 * cert type is "ce_ivd" and the data is already in certifications_raw, so this
 * recomputes the three ivdr_* fields in place — no re-crawl.
 *
 * Writes <snapshot>.fixed.json (never overwrites the original) + a one-line
 * report. Diff the two, then replace the original if it looks right.
 *
 *   npx tsx scripts/fix-hair-ivdr.ts HAIR-SNAPSHOT-2026-06-17.json
 */

import { readFileSync, writeFileSync } from 'fs'

const file = process.argv[2] ?? 'HAIR-SNAPSHOT-2026-06-17.json'

interface Cert {
  type: string
  class_field?: string | null
  cert_pathway_field?: string | null
  status_field?: boolean | null
}
interface Product {
  certifications_raw: Cert[]
  ivdr_class: string | null
  ivdr_pathway: string | null
  ivdr_status: boolean | null
  [k: string]: unknown
}

const normIvd = (s: string | null | undefined): string | null => {
  if (!s) return null
  if (/IVDR|In Vitro Diagnostic Regulation/i.test(s)) return 'IVDR'
  if (/IVDD|In Vitro Diagnostic Directive/i.test(s)) return 'IVDD'
  return s
}

const snap = JSON.parse(readFileSync(file, 'utf8')) as { products: Product[] }
let fixed = 0
const pathwayTally: Record<string, number> = {}

for (const p of snap.products) {
  const ivd =
    p.certifications_raw.find((c) => c.type === 'ce_ivd') ??
    p.certifications_raw.find((c) => c.type === 'ivdr') ??
    p.certifications_raw.find((c) => c.type === 'ivdd')
  if (!ivd) continue
  const pathway = normIvd(ivd.cert_pathway_field)
  if (p.ivdr_pathway !== pathway || p.ivdr_class !== (ivd.class_field ?? null)) fixed++
  p.ivdr_class = ivd.class_field ?? null
  p.ivdr_pathway = pathway
  p.ivdr_status = ivd.status_field ?? null
  if (pathway) pathwayTally[pathway] = (pathwayTally[pathway] ?? 0) + 1
}

const out = file.replace(/\.json$/, '.fixed.json')
writeFileSync(out, JSON.stringify(snap, null, 2))
console.log(`Repaired ivdr_* on ${fixed} products.`)
console.log(`IVDR pathway tally now: ${JSON.stringify(pathwayTally)}`)
console.log(`Oracle (pathology): {IVDD:70, IVDR:30}`)
console.log(`Written: ${out}  (original untouched — diff, then replace if good)`)
