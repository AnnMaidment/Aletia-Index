/**
 * scripts/extract-hair.ts
 *
 * EU-only discovery v2, Step 1a — the extractor. Read-only against the web;
 * writes ONE local snapshot file. No DB access.
 *
 * Walks the HAIR sitemap (sitemap-0.xml → ~420 product URLs across the
 * radiology + pathology registers), fetches each product page, decodes its
 * RSC flight stream (scripts/hairExtract.ts), and writes:
 *   HAIR-SNAPSHOT-<YYYY-MM-DD>.json
 * the dated, repeatable audit record the v2 scope calls for.
 *
 * Politeness (v2 scope: "extract politely, rate-limited, attributed"):
 * identifying User-Agent, 1.2s between requests by default. ~420 pages ≈ 8–9
 * min. Failures are recorded, not fatal — the run completes and reports them.
 *
 * Built-in correctness oracle: the listing-page facet counts are known
 * (radiology MDR 198 / MDD 107 / 510(k) 162; pathology IVDD 70 / IVDR 30 /
 * 510(k) 4). The summary tallies the extracted certs the same way so you can
 * eyeball extraction completeness against those figures before trusting it.
 *
 *   npx tsx scripts/extract-hair.ts                 # full run
 *   npx tsx scripts/extract-hair.ts --limit 10      # first 10 (smoke test)
 *   npx tsx scripts/extract-hair.ts --delay 2000    # gentler rate limit
 *   npx tsx scripts/extract-hair.ts --ua-contact you@example.com
 */

import { writeFileSync } from 'fs'
import { decodeFlight, parseProduct, type HairProduct } from './hairExtract'

const SITEMAP_INDEX = 'https://healthairegister.com/sitemap.xml'
const SITEMAP_SEEDS = [
  'https://healthairegister.com/sitemap.xml',
  'https://healthairegister.com/sitemap-0.xml',
]
const LISTING_PAGES = [
  'https://healthairegister.com/radiology/products',
  'https://healthairegister.com/pathology/products',
  'https://healthairegister.com/platforms/products',
]

const arg = (flag: string): string | null => {
  const i = process.argv.indexOf(flag)
  return i !== -1 ? process.argv[i + 1] ?? null : null
}
const LIMIT = arg('--limit') ? parseInt(arg('--limit')!, 10) : Infinity
const DELAY = arg('--delay') ? parseInt(arg('--delay')!, 10) : 1200
const CONTACT = arg('--ua-contact') ?? 'www.aletia-index.com'
const URLS_ONLY = process.argv.includes('--urls-only')
const UA = `AletiaIndexBot/0.1 (medical-device registry reconciliation; ${CONTACT})`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const isProductUrl = (u: string) => /\/products\/[^/]+/.test(u) && !/\/products\/?$/.test(u)

async function fetchText(url: string): Promise<{ status: number; ct: string; body: string }> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  return { status: res.status, ct: res.headers.get('content-type') ?? '', body: await res.text() }
}

function locsOf(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
}
const looksXml = (ct: string, body: string) => /xml/.test(ct) || body.trimStart().startsWith('<?xml')

/**
 * Collect product URLs robustly. The HAIR sitemap is dynamic and sometimes
 * serves only section roots; sitemap.xml is an index pointing to child
 * sitemaps. Strategy: gather candidate sitemap URLs (seeds + any child
 * sitemaps referenced by the index), fetch each with retries, harvest product
 * <loc>s. Fall back to listing-page flight slugs if the sitemaps stay cold.
 */
async function collectProductUrls(): Promise<{ urls: string[]; trace: string[] }> {
  const trace: string[] = []
  const products = new Set<string>()
  const sitemapsToTry = new Set<string>(SITEMAP_SEEDS)

  // First pass over the index to discover child sitemaps.
  try {
    const idx = await fetchText(SITEMAP_INDEX)
    if (looksXml(idx.ct, idx.body)) {
      for (const loc of locsOf(idx.body)) {
        if (/\.xml(\?|$)/i.test(loc)) sitemapsToTry.add(loc)
        else if (isProductUrl(loc)) products.add(loc)
      }
    }
    trace.push(`index ${SITEMAP_INDEX}: ${idx.status}, ${idx.body.length}b, child sitemaps now queued: ${sitemapsToTry.size}`)
  } catch (e) {
    trace.push(`index fetch error: ${(e as Error).message}`)
  }

  // Fetch each candidate sitemap, with retries for the dynamic/cold responses.
  for (const sm of sitemapsToTry) {
    let got = 0
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await fetchText(sm)
        if (looksXml(r.ct, r.body)) {
          const locs = locsOf(r.body)
          // a child sitemap referenced from the index may itself be an index
          for (const loc of locs) {
            if (isProductUrl(loc)) products.add(loc)
            else if (/\.xml(\?|$)/i.test(loc) && !sitemapsToTry.has(loc)) {
              try {
                const c = await fetchText(loc)
                if (looksXml(c.ct, c.body)) locsOf(c.body).filter(isProductUrl).forEach((u) => products.add(u))
              } catch { /* skip child */ }
              await sleep(400)
            }
          }
          got = locs.filter(isProductUrl).length
          trace.push(`sitemap ${sm} (try ${attempt}): ${r.status}, ${r.body.length}b, ${locs.length} locs, ${got} product urls`)
          if (got > 0) break
        } else {
          trace.push(`sitemap ${sm} (try ${attempt}): ${r.status}, not xml (${r.ct}) — likely SPA shell`)
        }
      } catch (e) {
        trace.push(`sitemap ${sm} (try ${attempt}): error ${(e as Error).message}`)
      }
      await sleep(800)
    }
  }

  // Fallback: derive slugs from listing-page flight data if sitemaps came up short.
  if (products.size < 50) {
    trace.push(`sitemaps yielded only ${products.size} product urls — falling back to listing-page flight slugs`)
    for (const base of LISTING_PAGES) {
      const seen = new Set<string>()
      for (let page = 1; page <= 30; page++) {
        const url = page === 1 ? base : `${base}?page=${page}`
        try {
          const r = await fetchText(url)
          const stream = decodeFlight(r.body)
          const slugs = [...stream.matchAll(/"slug":"([a-z0-9-]+)"/g)].map((m) => m[1])
          const newSlugs = slugs.filter((s) => !seen.has(s))
          newSlugs.forEach((s) => {
            seen.add(s)
            products.add(`${base}/${s}`)
          })
          trace.push(`listing ${url}: ${slugs.length} slugs, ${newSlugs.length} new`)
          if (newSlugs.length === 0) break // pagination exhausted (or param ignored)
        } catch (e) {
          trace.push(`listing ${url}: error ${(e as Error).message}`)
          break
        }
        await sleep(DELAY)
      }
    }
  }

  return { urls: [...products], trace }
}

function tally(products: HairProduct[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}
  const bump = (group: string, key: string | null) => {
    if (!key) return
    out[group] ??= {}
    out[group][key] = (out[group][key] ?? 0) + 1
  }
  for (const p of products) {
    bump('register', p.register)
    bump('ce_pathway', p.ce_pathway)
    bump('fda_pathway', p.fda_pathway)
    bump('ivdr_pathway', p.ivdr_pathway)
    bump('ce_class', p.ce_class)
    bump('fda_class', p.fda_class)
  }
  return out
}

async function main() {
  console.log(`\n=== HAIR extractor ===\nUA: ${UA}\nDelay: ${DELAY}ms  Limit: ${LIMIT}${URLS_ONLY ? '  (URLS-ONLY)' : ''}\n`)

  // 1. Collect product URLs (robust: index → children → retries → listing fallback)
  const { urls, trace } = await collectProductUrls()
  console.log('URL collection trace:')
  trace.forEach((t) => console.log('  ' + t))
  const unique = urls.slice(0, LIMIT)
  console.log(`\nTotal product URLs collected: ${urls.length}${LIMIT !== Infinity ? ` (limited to ${unique.length})` : ''}`)
  console.log('Sample:')
  unique.slice(0, 5).forEach((u) => console.log('  ' + u))

  if (URLS_ONLY) {
    console.log('\n--urls-only: stopping before page fetch. Re-run without the flag to extract.')
    return
  }
  if (!unique.length) {
    console.log('\nNo URLs collected — not writing a snapshot. Check the trace above.')
    process.exit(1)
  }
  console.log('')

  // 2. Fetch + parse each
  const products: HairProduct[] = []
  const failures: { url: string; error: string }[] = []
  let i = 0
  for (const url of unique) {
    i++
    try {
      const r = await fetchText(url)
      if (r.status !== 200) throw new Error(`HTTP ${r.status}`)
      const stream = decodeFlight(r.body)
      const product = parseProduct(stream, url)
      if (!product.name && !product.slug) {
        failures.push({ url, error: 'no product fields decoded (shape drift?)' })
        console.log(`  [${i}/${unique.length}] EMPTY  ${url}`)
      } else {
        products.push(product)
        if (i % 25 === 0 || i === unique.length) {
          console.log(`  [${i}/${unique.length}] ${product.vendor ?? '?'} — ${product.name ?? '?'}`)
        }
      }
    } catch (e) {
      failures.push({ url, error: (e as Error).message })
      console.log(`  [${i}/${unique.length}] FAIL   ${url} — ${(e as Error).message}`)
    }
    if (i < unique.length) await sleep(DELAY)
  }

  // 3. Snapshot
  const date = new Date().toISOString().slice(0, 10)
  const outfile = `HAIR-SNAPSHOT-${date}.json`
  const snapshot = {
    source: 'healthairegister.com',
    sitemap_index: SITEMAP_INDEX,
    url_collection_trace: trace,
    extracted_at: new Date().toISOString(),
    user_agent: UA,
    product_count: products.length,
    failure_count: failures.length,
    products,
    failures,
  }
  writeFileSync(outfile, JSON.stringify(snapshot, null, 2))

  // 4. Summary + oracle
  const t = tally(products)
  console.log(`\n=== Summary ===`)
  console.log(`Extracted: ${products.length}   Failed/empty: ${failures.length}`)
  console.log(`By register: ${JSON.stringify(t.register ?? {})}`)
  console.log(`CE pathway:  ${JSON.stringify(t.ce_pathway ?? {})}`)
  console.log(`FDA pathway: ${JSON.stringify(t.fda_pathway ?? {})}`)
  console.log(`IVDR pathway:${JSON.stringify(t.ivdr_pathway ?? {})}`)
  console.log(`\nOracle (listing facet counts, for eyeball comparison):`)
  console.log(`  radiology — CE: {MDR:198, MDD:107}  FDA: {510(k):162, De novo:1, PMA:1}`)
  console.log(`  pathology — IVDR/IVDD: {IVDD:70, IVDR:30}  FDA: {510(k):4, De novo:1}`)
  console.log(`(Extracted totals should land close; large gaps mean shape drift on some pages — check failures[].)`)
  console.log(`\nSnapshot written: ${outfile}`)
  console.log(`Next: commit the snapshot, then Step 1b — three-way reconcile (Aletia 4d gate + EUDAMED tradeName crosswalk).`)
}

main().catch((e) => {
  console.error('extract-hair failed:', e)
  process.exit(1)
})
