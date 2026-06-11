/**
 * scripts/probe-eudamed-detail.ts  (THROWAWAY — tsconfig-excluded)
 *
 * Dump the FULL raw udiDiData detail JSON for one or more euUuids, so we can
 * see whether risk class is present (and under what path) before committing to
 * the raw_data backfill. No DB / no env needed — hits the public endpoint
 * directly.
 *
 *   npx tsx scripts/probe-eudamed-detail.ts a45cc9a2-dfc9-4c65-a706-128447039ccd
 *   npx tsx scripts/probe-eudamed-detail.ts <uuid1> <uuid2> ...
 */

const BASE = 'https://ec.europa.eu/tools/eudamed/api'

async function main() {
  const uuids = process.argv.slice(2)
  if (uuids.length === 0) {
    console.error('Pass one or more euUuids (the queue row source_id).')
    process.exit(1)
  }

  for (const uuid of uuids) {
    const url = `${BASE}/devices/udiDiData/${uuid}?languageIso2Code=en`
    console.log(`\n===== ${uuid} =====`)
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) {
      console.log(`  HTTP ${res.status} ${res.statusText}`)
      continue
    }
    const json: Record<string, unknown> = await res.json()

    // Full dump for eyeballing.
    console.log(JSON.stringify(json, null, 2))

    // Highlight any top-level key whose name hints at risk / class.
    const hits = Object.keys(json).filter((k) => /risk|class/i.test(k))
    console.log(`\n  -> top-level keys matching /risk|class/: ${hits.length ? hits.join(', ') : '(none)'}`)
    for (const k of hits) {
      console.log(`     ${k} = ${JSON.stringify(json[k])}`)
    }
    await new Promise((r) => setTimeout(r, 500))
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
