/**
 * scripts/hairExtract.ts
 *
 * EU-only discovery v2, Step 1a — pure parsing for the Health AI Register.
 * No network, no DB. Decodes a HAIR product page's RSC flight stream into a
 * normalised product record. Tested against live-captured fixtures before the
 * runner (extract-hair.ts) is trusted on the full 420-URL sitemap.
 *
 * HAIR is App Router; product data streams in self.__next_f.push([n,"..."])
 * chunks. The decoded stream carries, per product page:
 *   - an analytics event ("product_detail_viewed") with clean identity
 *   - a $L20 props object with title/company/description/certifications[]
 *   - a deeper CMS object with modality/subspeciality/diseases/population/etc
 * (certifications appears twice: the real array, and an RSC "$12:…" reference;
 * we force the array.)
 */

export interface HairCertification {
  type: string // 'ce' | 'fda' | 'ivdr' | 'ivdd' | ...
  class_field?: string | null
  cert_pathway_field?: string | null
  intended_use?: string | null
  number?: string | null
  status_field?: boolean | null
}

export interface HairProduct {
  slug: string | null
  url: string
  register: string | null // 'radiology' | 'pathology' (from domain, falls back to URL)
  name: string | null // product title
  vendor: string | null // company_title
  vendor_slug: string | null
  description: string | null // HTML stripped
  // regulatory (mapped from certifications[])
  ce_class: string | null
  ce_pathway: string | null
  ce_intended_use: string | null
  ce_status: boolean | null
  fda_class: string | null
  fda_pathway: string | null
  fda_number: string | null
  fda_intended_use: string | null
  fda_status: boolean | null
  ivdr_class: string | null
  ivdr_pathway: string | null
  ivdr_status: boolean | null
  // clinical / spec
  modality: string[]
  subspeciality: string[]
  diseases: string | null
  population: string | null
  input_data: string | null
  output_data: string | null
  market_since: string | null
  information_source: string | null // "Vendor" — provenance caveat (v2 scope)
  completeness_score: number | null
  // audit
  certifications_raw: HairCertification[]
  extracted_at: string
}

/** Concatenate and JSON-decode every self.__next_f.push([n,"..."]) string chunk. */
export function decodeFlight(html: string): string {
  const re = /self\.__next_f\.push\(\[\d+,\s*("(?:[^"\\]|\\.)*")\s*\]\)/g
  let m: RegExpExecArray | null
  let out = ''
  while ((m = re.exec(html))) {
    try {
      out += JSON.parse(m[1]) as string
    } catch {
      /* skip malformed chunk */
    }
  }
  return out
}

function scanString(s: string, start: number): string {
  let i = start + 1
  while (i < s.length) {
    const c = s[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '"') return s.slice(start, i + 1)
    i++
  }
  return s.slice(start)
}

function scanBracket(s: string, start: number): string {
  const open = s[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inStr = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (c === '\\') {
        i++
        continue
      }
      if (c === '"') inStr = false
      continue
    }
    if (c === '"') {
      inStr = true
      continue
    }
    if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return s.slice(start)
}

/** Raw JSON token following the first `key` whose value optionally startsWith a given char. */
function rawValueAfter(s: string, key: string, startsWith?: string): string | null {
  let from = 0
  for (;;) {
    const k = s.indexOf(key, from)
    if (k === -1) return null
    let i = k + key.length
    while (i < s.length && /\s/.test(s[i])) i++
    const c = s[i]
    if (startsWith && c !== startsWith) {
      from = k + key.length
      continue
    }
    if (c === '"') return scanString(s, i)
    if (c === '{' || c === '[') return scanBracket(s, i)
    let j = i
    while (j < s.length && !',}]'.includes(s[j])) j++
    return s.slice(i, j)
  }
}

function getString(s: string, key: string, startsWith?: string): string | null {
  const r = rawValueAfter(s, key, startsWith)
  if (r == null) return null
  try {
    const v = JSON.parse(r)
    return typeof v === 'string' ? v : null
  } catch {
    return null
  }
}

function getNumber(s: string, key: string): number | null {
  const r = rawValueAfter(s, key)
  if (r == null) return null
  const n = Number(r)
  return Number.isFinite(n) ? n : null
}

function getJson<T>(s: string, key: string, startsWith?: string): T | null {
  const r = rawValueAfter(s, key, startsWith)
  if (r == null) return null
  try {
    return JSON.parse(r) as T
  } catch {
    return null
  }
}

function stripHtml(html: string | null): string | null {
  if (!html) return null
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function registerFromUrl(url: string): string | null {
  const m = url.match(/healthairegister\.com\/([^/]+)\/products\//)
  return m ? m[1] : null
}

interface RawCert {
  type?: string
  value?: {
    class_field?: string | null
    cert_pathway_field?: string | null
    intended_use?: string | null
    number?: string | null
    status_field?: boolean | null
  }
}

/** Parse one decoded flight stream into a normalised product record. */
export function parseProduct(stream: string, url: string): HairProduct {
  const certsRaw = getJson<RawCert[]>(stream, '"certifications":', '[') ?? []
  const certs: HairCertification[] = certsRaw.map((c) => ({
    type: (c.type ?? '').toLowerCase(),
    class_field: c.value?.class_field ?? null,
    cert_pathway_field: c.value?.cert_pathway_field ?? null,
    intended_use: c.value?.intended_use ?? null,
    number: c.value?.number ?? null,
    status_field: c.value?.status_field ?? null,
  }))
  const certOf = (t: string) => certs.find((c) => c.type === t)
  const ce = certOf('ce')
  const fda = certOf('fda')
  const ivdr = certOf('ce_ivd') ?? certOf('ivdr') ?? certOf('ivdd')

  // pathology pathway arrives as the long form; normalise to IVDR / IVDD
  const normIvd = (s: string | null | undefined): string | null => {
    if (!s) return null
    if (/IVDR|In Vitro Diagnostic Regulation/i.test(s)) return 'IVDR'
    if (/IVDD|In Vitro Diagnostic Directive/i.test(s)) return 'IVDD'
    return s
  }

  const name = getString(stream, '"product_title":') ?? getString(stream, '"title":')
  const vendor = getString(stream, '"company_title":')
  const vendorSlug = getString(stream, '"company_slug":')
  const slug = getString(stream, '"product_slug":')
  const domain = getString(stream, '"domain":')

  return {
    slug,
    url,
    register: domain ?? registerFromUrl(url),
    name,
    vendor,
    vendor_slug: vendorSlug,
    description: stripHtml(getString(stream, '"description":')),
    ce_class: ce?.class_field ?? null,
    ce_pathway: ce?.cert_pathway_field ?? null,
    ce_intended_use: ce?.intended_use ?? null,
    ce_status: ce?.status_field ?? null,
    fda_class: fda?.class_field ?? null,
    fda_pathway: fda?.cert_pathway_field ?? null,
    fda_number: fda?.number ?? null,
    fda_intended_use: fda?.intended_use ?? null,
    fda_status: fda?.status_field ?? null,
    ivdr_class: ivdr?.class_field ?? null,
    ivdr_pathway: normIvd(ivdr?.cert_pathway_field),
    ivdr_status: ivdr?.status_field ?? null,
    modality: getJson<string[]>(stream, '"modality":', '[') ?? [],
    subspeciality: getJson<string[]>(stream, '"subspeciality":', '[') ?? [],
    diseases: getString(stream, '"diseases":'),
    population: getString(stream, '"population":'),
    input_data: getString(stream, '"input_data":'),
    output_data: getString(stream, '"output_data":'),
    market_since: getString(stream, '"market_since":'),
    information_source: getString(stream, '"information_source":'),
    completeness_score: getNumber(stream, '"completeness_score":'),
    certifications_raw: certs,
    extracted_at: new Date().toISOString(),
  }
}
