/**
 * scripts/test-pccp-submission-ids.ts
 *
 * Fixtures for the PCCP submission-number normaliser and classifier (BUG-013).
 * Pure — no network, no database.
 *
 *   npx tsx scripts/test-pccp-submission-ids.ts
 *
 * The bug: `classifySubmissionNumber` matched PMA as `^P[0-9]+$`, so a PMA
 * SUPPLEMENT ("P190016/S007") failed the shape check and the row was skipped.
 * ~40 authorized-PCCP supplements were dropped on the 10 Jun run.
 *
 * The regression these fixtures guard is narrow and easy to reintroduce: the
 * fix must recognise the supplement AND resolve it to the BASE PMA number,
 * because device_external_ids only ever holds the base. Getting the first half
 * right and the second half wrong turns a skipped row into a missed lookup —
 * quieter, and worse.
 */

import { normaliseId, baseSubmissionId, classifySubmissionNumber } from '../lib/fdaSubmissionId'

interface Case {
  raw: string
  base: string
  type: 'fda_k_number' | 'fda_de_novo' | 'fda_pma' | null
  why: string
}

const CASES: Case[] = [
  // ── the ordinary shapes (must not regress) ────────────────────────────────
  { raw: 'K251293',       base: 'K251293',  type: 'fda_k_number', why: '510(k)' },
  { raw: 'k251293',       base: 'K251293',  type: 'fda_k_number', why: '510(k), lowercase' },
  { raw: ' K251293 ',     base: 'K251293',  type: 'fda_k_number', why: '510(k), padded' },
  { raw: 'DEN190040',     base: 'DEN190040', type: 'fda_de_novo', why: 'De Novo' },
  { raw: 'den190040',     base: 'DEN190040', type: 'fda_de_novo', why: 'De Novo, lowercase' },
  { raw: 'P190016',       base: 'P190016',  type: 'fda_pma',      why: 'PMA, no supplement' },

  // ── BUG-013: the shapes that used to be dropped ───────────────────────────
  { raw: 'P190016/S007',  base: 'P190016',  type: 'fda_pma', why: 'PMA supplement, canonical slashed form' },
  { raw: 'p190016/s007',  base: 'P190016',  type: 'fda_pma', why: 'PMA supplement, lowercase' },
  { raw: 'P190016 / S007', base: 'P190016', type: 'fda_pma', why: 'PMA supplement, spaces around slash' },
  { raw: 'P190016 S007',  base: 'P190016',  type: 'fda_pma', why: 'PMA supplement, space-separated (no slash after whitespace strip)' },
  { raw: 'P190016/S12',   base: 'P190016',  type: 'fda_pma', why: 'PMA supplement, 2-digit sequence' },
  { raw: 'P810001/S001',  base: 'P810001',  type: 'fda_pma', why: 'PMA supplement, 1980s base number' },

  // ── guards: the fix must not over-strip ───────────────────────────────────
  { raw: 'K250007S001',   base: 'K250007S001', type: null, why: 'K-number with S-suffix is not a PMA supplement — must NOT be split' },
  { raw: 'P19S007',       base: 'P19S007',  type: null,    why: 'slashless branch is pinned to 6 base digits; this is malformed, not a supplement' },
  { raw: 'S007',          base: 'S007',     type: null,    why: 'bare supplement with no base is unclassifiable' },
  { raw: 'P190016/X007',  base: 'P190016/X007', type: null, why: 'only /S supplements are PMA supplements' },
  { raw: 'NOTANID',       base: 'NOTANID',  type: null,    why: 'garbage stays garbage' },
  { raw: '',              base: '',         type: null,    why: 'empty' },
]

let pass = 0
const failures: string[] = []

for (const c of CASES) {
  const normalised = normaliseId(c.raw)
  const base = baseSubmissionId(normalised)
  const type = classifySubmissionNumber(normalised)

  const errs: string[] = []
  if (base !== c.base) errs.push(`base ${JSON.stringify(base)} ≠ expected ${JSON.stringify(c.base)}`)
  if (type !== c.type) errs.push(`type ${JSON.stringify(type)} ≠ expected ${JSON.stringify(c.type)}`)

  if (errs.length) {
    failures.push(`  ✗ ${JSON.stringify(c.raw).padEnd(18)} ${c.why}\n      ${errs.join('\n      ')}`)
  } else {
    pass++
    console.log(`  ✓ ${JSON.stringify(c.raw).padEnd(18)} → base=${base || '(empty)'} type=${type ?? 'null'}   ${c.why}`)
  }
}

console.log(`\n${pass}/${CASES.length} passed`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(f)
  process.exit(1)
}
console.log('All PCCP submission-id fixtures green.\n')
