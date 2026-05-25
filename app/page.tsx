import { createClient } from '@supabase/supabase-js'
import { Suspense } from 'react'
import MobileMenu   from './components/MobileMenu'
import FiltersBar   from './components/FiltersBar'
import DeviceGrid   from './components/DeviceGrid'
import type { Device } from '@/lib/types'
import { normaliseIdentifierInput } from '@/lib/identifierNormalisation'
export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

// Minimum search length enforced server-side. Mirrors the client-side guard
// in FiltersBar — defends against hand-crafted URLs like ?search=e that
// would otherwise trigger the full query pipeline.
const MIN_SEARCH_LENGTH_SERVER = 2

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}

function strParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string {
  const v = params[key]
  return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : ''
}

// Strip PostgREST OR-clause delimiters (%, comma, parens, asterisk) from a
// raw search term before splicing into .or() / ilike strings. Supabase's JS
// client does NOT escape these for you when you hand-build OR strings.
// Without this, searches like "K(230001)" or "drug,test" break the query.
function sanitiseSearch(raw: string): string {
  return raw.replace(/[%,()*]/g, '').trim()
}

// Maps the UI pill labels to pipeline_stage column values.
const PIPELINE_STAGE_MAP: Record<string, string> = {
  'Development':    'development',
  'Pre-Submission': 'pre_submission',
  'Clinical Trial': 'clinical_trial',
  'Under Review':   'under_review',
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params     = await searchParams
  const rawSearch  = strParam(params, 'search')
  const specialty  = strParam(params, 'specialty') || 'All'
  const status     = strParam(params, 'status')    || 'All'
  const source     = strParam(params, 'source')    || 'All'
  const pccp       = strParam(params, 'pccp') || 'approved'
  const autonomous = strParam(params, 'autonomous')
  const pipeline   = strParam(params, 'pipeline')          // 'true' when Pipeline mode active
  const page       = Math.max(1, parseInt(strParam(params, 'page') || '1') || 1)

  // Sanitise + length-guard the search term. If empty or below the minimum
  // length, treat as no search — every downstream `if (search)` becomes false
  // and the pre-queries are skipped entirely.
  const sanitised = sanitiseSearch(rawSearch)
  const search    = sanitised.length >= MIN_SEARCH_LENGTH_SERVER ? sanitised : ''

  const supabase = getSupabase()

  // ── Manufacturer name pre-query ─────────────────────────────────────────────
  // Capped at 200 rows. If a search matches >200 manufacturer-name hits, the
  // search is too vague to be useful — the user needs to type more characters.
  // Previous cap was 10,000 which made every keystroke wait on a large
  // round-trip even for short searches.
  let manufacturerDeviceIds: string[] = []
  if (search) {
    const { data: mfrData } = await supabase
      .from('device_master')
      .select('aletia_id, manufacturers!inner(name)')
      .eq('excluded', false)
      .or(`name.ilike.%${search}%`, { referencedTable: 'manufacturers' })
      .range(0, 199)
    manufacturerDeviceIds = (mfrData ?? []).map(
      (d: { aletia_id: string }) => d.aletia_id,
    )
  }

  // ── Secondary external-ID pre-query (A2b: Option 4 for cross-ID search) ────
  // If the user types "K230001" or "MHRA-47392" or "NCT05386654" and that ID
  // is a SECONDARY identifier on some device (not the primary external_legacy_id),
  // we still want the search to hit. Pull matching aletia_ids from
  // device_external_ids and include them in the main query's OR clause.
  //
  // BUG-009 (24 Apr 2026): post-A2b, MHRA device IDs live raw in
  // device_external_ids (e.g. "47392", not "MHRA-47392"). Users who type the
  // legacy prefixed form would miss. normaliseIdentifierInput strips the
  // known historical prefixes before lookup.
  //
  // Capped at 100 rows. External-ID matches are typically 1–5 hits for a
  // well-formed identifier search (K230001 → one device). 100 is more than
  // sufficient and keeps the round-trip fast.
  let secondaryIdMatches: string[] = []
  const normalisedSearch = search ? sanitiseSearch(normaliseIdentifierInput(search)) : ''
  if (search) {
    const { data: extIdData } = await supabase
      .from('device_external_ids')
      .select('aletia_id')
      .ilike('id_value', `%${normalisedSearch}%`)
      .range(0, 99)
    secondaryIdMatches = [...new Set(
      (extIdData ?? []).map((r: { aletia_id: string }) => r.aletia_id),
    )]
  }

  // ── Filtered + paginated query ──────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase
    .from('device_master')
    .select(
      `aletia_id, external_legacy_id, name, intended_use, manufacturer_name, specialty_link,
       health_status, pipeline_stage, data_source, excluded,
       aletia_verified, breakthrough_designation,
       ai_ml_type, accountability_tier, mode, autonomy,
       last_automated_sync, last_clinical_review,
       autonomous_output_mode, autonomous_output_description, eu_risk_class,
       manufacturers(name, hq_location),
       regional_registrations(country, regulatory_body, clearance_type, external_id_value),
       tech_specs(api_type, ehr_compat, data_hosting, fhir_compatible, popia_compliant)`,
            { count: 'exact' },
    )
    .eq('excluded', false)

  // ── Mode filters (mutually exclusive) ──────────────────────────────────────
  if (pipeline === 'true') {
    // Pipeline mode — only pre-approval devices
    query = query.not('pipeline_stage', 'is', null)

    // Optional sub-stage filter
    const devStage = PIPELINE_STAGE_MAP[status]
    if (devStage) {
      query = query.eq('pipeline_stage', devStage)
    }
  } else {
    // Cleared-device mode
    query = query.is('pipeline_stage', null)

    if (pccp === 'approved') {
      query = query.eq('pccp_status', 'approved')
    }

    if (autonomous === 'true') {
      query = query.eq('autonomous_output_mode', true)
    }

    // Health-status sub-filter (Green / Amber / Red)
    if (status !== 'All') {
      query = query.eq('health_status', status)
    }
  }

  // ── Shared filters ──────────────────────────────────────────────────────────
  if (search) {
    // Collect all aletia_ids that match via either manufacturer name or
    // secondary external identifiers. Dedupe.
    const idMatches = [...new Set([...manufacturerDeviceIds, ...secondaryIdMatches])]
    const idPart = idMatches.length > 0
      ? `,aletia_id.in.(${idMatches.join(',')})`
      : ''
    // Direct-column matches: aletia_id, external_legacy_id, name, intended_use,
    // manufacturer_name. Plus the aletia_id.in.(…) subquery for any device
    // whose manufacturer or secondary external ID matched.
    // `search` is pre-sanitised — no further escaping needed here.
    query = query.or(
      `aletia_id.ilike.%${search}%,external_legacy_id.ilike.%${search}%,name.ilike.%${search}%,intended_use.ilike.%${search}%,manufacturer_name.ilike.%${search}%${idPart}`,
    )
  }

  if (specialty !== 'All') {
    query = query.eq('specialty_link', specialty)
  }

  if (source !== 'All') {
    if (source === 'registry_sync') {
      query = query.or('data_source.eq.registry_sync,data_source.is.null')
    } else {
      query = query.eq('data_source', source)
    }
  }

  const { data: devices, count: totalCount } = (await query.range(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE - 1,
  )) as { data: Device[] | null; count: number | null }

  // ── Global stats (unfiltered) + specialties ─────────────────────────────────
  // All six numbers are HEAD counts ({ count: 'exact', head: true }) — zero row
  // transfer, so none are subject to Supabase's server-side db-max-rows cap
  // (the old .range(0, 9999) + count-in-JS approach silently truncated at the
  // 1000-row cap, capping corpusTotal/fda/mhra/eu/pipeline at ~1000). Jurisdiction
  // counts are coverage, not partition: a device cleared in two regions counts
  // toward both buckets, so the three deliberately sum to more than corpusTotal.
  const [
    { count: corpusTotal },
    { count: pipelineCount },
    { count: pccpCount },
    { count: fdaCount },
    { count: mhraCount },
    { count: euCount },
    { data: specData },
  ] = await Promise.all([
    supabase
      .from('device_master')
      .select('aletia_id', { count: 'exact', head: true })
      .eq('excluded', false),
    supabase
      .from('device_master')
      .select('aletia_id', { count: 'exact', head: true })
      .eq('excluded', false)
      .not('pipeline_stage', 'is', null),
    supabase
      .from('device_master')
      .select('aletia_id', { count: 'exact', head: true })
      .eq('excluded', false)
      .eq('pccp_status', 'approved'),
    supabase
      .from('device_master')
      .select('aletia_id, regional_registrations!inner(country)', { count: 'exact', head: true })
      .eq('excluded', false)
      .eq('regional_registrations.country', 'US'),
    supabase
      .from('device_master')
      .select('aletia_id, regional_registrations!inner(country)', { count: 'exact', head: true })
      .eq('excluded', false)
      .eq('regional_registrations.country', 'GB'),
    supabase
      .from('device_master')
      .select('aletia_id, regional_registrations!inner(country)', { count: 'exact', head: true })
      .eq('excluded', false)
      .eq('regional_registrations.country', 'EU'),
    supabase
      .from('device_master')
      .select('specialty_link')
      .eq('excluded', false)
      .not('specialty_link', 'is', null)
      .range(0, 9999),
  ])

  const specialties = [...new Set(
    (specData ?? []).map((d: { specialty_link: string }) => d.specialty_link),
  )].sort() as string[]

  // ── filterQuery — passed to DeviceGrid for Link-based pagination ────────────
  const fq = new URLSearchParams()
  if (search)                fq.set('search',    search)
  if (specialty !== 'All')   fq.set('specialty', specialty)
  if (status    !== 'All')   fq.set('status',    status)
  if (source    !== 'All')   fq.set('source',    source)
  if (pipeline  === 'true')  fq.set('pipeline',  'true')
  // Only persist pccp / autonomous when not in pipeline mode
  if (pipeline !== 'true') {
    if (pccp === 'approved')      fq.set('pccp',       'approved')
    if (autonomous === 'true')    fq.set('autonomous',  'true')
  }
  const filterQuery = fq.toString()

  return (
    <>
      <style>{`
        :root {
          --primary:#1f6feb; --primary2:#2b79ff;
          --secondary:#0b7f7d; --secondary2:#0ea5a3;
          --bg:#f5f7fb; --surface:#ffffff;
          --text:#0f172a; --muted:#64748b;
          --line:#e6ebf3;
          --shadow:0 10px 30px rgba(15,23,42,.08);
          --shadow2:0 4px 16px rgba(15,23,42,.06);
          --blue:#1f6feb; --blue2:#0ea5e9;
          --chip:#f0f4ff; --chipText:#1e40af;
          --tealChip:#d8f0ec; --tealChipText:#0b6b5f; --tealChipBorder:#9fd9cf;
          --cardBorder:#d8e0ec;
          --tealBtn:#0b8276; --tealBtn2:#0ea5a3;
          --successBg:#e9f9ef; --successText:#137a3b;
          --warnBg:#fff4e5; --warnText:#a15c00;
          --dangerBg:#ffecec; --dangerText:#9f1d1d;
          --radius:14px; --radius2:18px;
        }
        *{box-sizing:border-box;margin:0;padding:0}
        html{scroll-behavior:smooth}
     body{
  font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  background:
    radial-gradient(1200px 520px at 12% 10%,rgba(14,165,163,.10),transparent 60%),
    radial-gradient(1200px 520px at 65% 0%,rgba(31,111,235,.10),transparent 62%),
    var(--bg);
  color:var(--muted); font-size:14px; line-height:1.5;
}
        a{color:inherit;text-decoration:none}
        button{cursor:pointer;font-family:inherit}

        /* ── NAV ── */
        .nav{position:sticky;top:0;z-index:100;background:rgba(255,255,255,.92);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
        .navInner{display:flex;align-items:center;justify-content:space-between;padding:12px 0}
        .logo{display:flex;align-items:center;gap:10px;text-decoration:none}
        .logoWrap{width:38px;height:38px;border-radius:11px;overflow:hidden;display:flex;align-items:center;justify-content:center}
        .logoText{font-size:16px;font-weight:800;color:var(--text);letter-spacing:.3px}
        .logoBadge{font-size:10px;font-weight:700;color:var(--muted);letter-spacing:.5px;text-transform:uppercase;margin-top:1px}
        .navLinks{display:flex;gap:24px;font-size:13.5px;font-weight:500}
        .navLinks a{color:var(--muted);transition:color .15s}
        .navLinks a:hover{color:var(--text)}
        .navRight{display:flex;align-items:center;gap:10px}

        /* ── HERO ── */
        .hero{padding:20px 0}
        .heroGrid{display:grid;grid-template-columns:minmax(280px,0.85fr) 1.15fr;gap:40px;align-items:center}
        .heroEyebrow{align-self:flex-start;display:inline-flex;align-items:center;gap:7px;padding:6px 15px;background:var(--tealChip);color:var(--tealChipText);border:1px solid var(--tealChipBorder);border-radius:99px;font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;margin-bottom:10px}
        .heroEyebrow .dot{width:7px;height:7px;border-radius:99px;background:var(--secondary2);box-shadow:0 0 0 3px rgba(14,165,163,.25)}
        .heroTitle{font-size:clamp(28px,3.6vw,40px);font-weight:900;color:var(--text);letter-spacing:-.5px;line-height:1.1;margin:0}
        .heroTitle span{background:linear-gradient(135deg,#1f6feb,#0b7f7d);-webkit-background-clip:text;-webkit-text-fill-color:transparent}

        /* ── STAT STRIP (hero, replaces sidebar stats) ── */
        .statStrip{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}
        .statCard{background:var(--surface);border:1px solid var(--cardBorder);border-radius:12px;padding:12px 14px}
        .statCard .lbl{font-size:10.5px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--muted)}
        .statCard .num{font-size:23px;font-weight:900;color:var(--text);letter-spacing:-.5px;line-height:1.1;margin:3px 0 2px;font-variant-numeric:tabular-nums}
        .statCard .sub{font-size:11px;color:var(--muted)}
        @media(max-width:980px){.heroGrid{grid-template-columns:1fr;gap:22px}.statStrip{grid-template-columns:repeat(3,1fr)}}
        @media(max-width:560px){.statStrip{grid-template-columns:repeat(2,1fr)}}

        /* ── LAYOUT ── */
        .container{max-width:1240px;margin:0 auto;padding:0 20px}
        .page{padding-bottom:60px}

        /* ── CARD ── */
        .card{background:var(--surface);border:1.5px solid var(--cardBorder);border-radius:var(--radius2);box-shadow:var(--shadow2)}
        .cardPad{padding:20px}

        /* ── FILTERS ── */
        .searchRow{display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap}
        .search{flex:1;min-width:200px;display:flex;align-items:center;gap:10px;padding:0 14px;background:#f1f3f7;border:1.5px solid transparent;border-radius:12px;transition:background .15s,border-color .15s,box-shadow .15s}
        .search:focus-within,.search.hasText{background:#fff;border-color:var(--secondary);box-shadow:0 0 0 3px rgba(11,127,125,.14)}
        .search .mag{stroke:#94a3b8;transition:stroke .15s}
        .search:focus-within .mag,.search.hasText .mag{stroke:var(--secondary)}
        .search input{flex:1;border:none;background:transparent;outline:none;font-size:14px;color:var(--text);padding:10px 0}
        .search input::placeholder{color:#94a3b8}
        .clearBtn{flex-shrink:0;width:22px;height:22px;border-radius:99px;border:none;background:#e2e8f0;color:#64748b;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:13px;line-height:1;transition:background .12s,color .12s}
        .clearBtn:hover{background:#cbd5e1;color:#334155}
        .metaLine{display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:10px}
        .pills{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:10px;align-items:center}
        .pill{padding:6px 13px;border-radius:99px;font-size:12.5px;font-weight:600;cursor:pointer;border:1.5px solid transparent;transition:all .15s;white-space:nowrap;user-select:none}
        .pill.light{background:#f8fafc;color:var(--muted);border-color:var(--line)}
        .pill.light:hover{background:#f1f5f9;color:var(--text)}
        .pill.active,.pill:not(.light){background:var(--primary);color:#fff;border-color:var(--primary)}
        .pill.light.active{background:var(--primary);color:#fff;border-color:var(--primary)}

        /* ── TABLE ── */
        .tableWrap{overflow-x:auto;margin:0 -20px;padding:0 20px}
        .table{width:100%;border-collapse:collapse;font-size:13.5px}
        .table th{padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;border-bottom:1.5px solid var(--line);white-space:nowrap}
        .table td{padding:14px 12px;border-bottom:1px solid var(--line);vertical-align:top}
        .table tr:last-child td{border-bottom:none}
        .table tbody tr:hover td{background:#fafbfd}
        /* Pipeline row — greyed, softer hover */
        .table tbody tr.pipelineRow td{opacity:.75}
        .table tbody tr.pipelineRow:hover td{background:#f8fafc;opacity:1}

        /* ── ROW CELLS ── */
        .rowTitle{display:flex;gap:10px;align-items:flex-start}
        .appIcon{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#e8f0fe,#dbeafe);display:flex;align-items:center;justify-content:center;flex-shrink:0;border:1px solid rgba(31,111,235,.12)}
        .appName{font-size:14px;font-weight:700;color:var(--text);line-height:1.3;transition:color .15s}
        .appName:hover{color:var(--primary)}
        .appOrg{font-size:11.5px;color:var(--muted);margin-top:2px}
        .small{font-size:12px;color:var(--muted);margin-top:5px;line-height:1.45}
        .actionCell{display:flex;gap:6px;justify-content:flex-end;align-items:center}

        /* ── BADGES ── */
        .badge{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:99px;font-size:11.5px;font-weight:700;border:1.5px solid transparent}
        .badge.ok{background:var(--successBg);color:var(--successText);border-color:rgba(19,122,59,.15)}
        .badge.warn{background:var(--warnBg);color:var(--warnText);border-color:rgba(161,92,0,.15)}
        .badge.danger{background:var(--dangerBg);color:var(--dangerText);border-color:rgba(159,29,29,.15)}
        .badge.neutral{background:#f1f5f9;color:#475569;border-color:#e2e8f0}
        .badge.pipeline{background:#ede9fe;color:#5b21b6;border-color:rgba(91,33,182,.15)}
        .badge.verified{background:#ecfdf5;color:#065f46;border-color:rgba(6,95,70,.15)}
        .badge.breakthrough{background:#fef3c7;color:#92400e;border-color:rgba(146,64,14,.15)}
        .badge.research{background:#eff6ff;color:#1d4ed8;border-color:rgba(29,78,216,.15)}
        .badge.trial{background:#f5f3ff;color:#6d28d9;border-color:rgba(109,40,217,.15)}

        /* ── BUTTONS ── */
        .primaryBtn{padding:9px 18px;border-radius:12px;background:linear-gradient(135deg,var(--primary),var(--primary2));color:#fff;font-weight:700;font-size:13.5px;border:none;cursor:pointer;transition:opacity .15s;display:inline-flex;align-items:center;gap:7px}
        .primaryBtn:hover{opacity:.88}

        /* ── NAV GRADIENT PILLS (Take tour + Request Review) ── */
        /* Twins: matched gradient pills with hover-lift and a slow click-invert
           to white + coloured outline. 2px transparent border reserved at rest
           so the outline appears without shifting layout. */
        .tourBtn,.reviewBtn{padding:9px 18px;border-radius:12px;color:#fff;font-weight:700;font-size:13.5px;border:2px solid transparent;cursor:pointer;display:inline-flex;align-items:center;gap:7px;text-decoration:none;transition:transform .12s,box-shadow .12s,background .28s ease,color .28s ease,border-color .28s ease}
        .tourBtn{background:linear-gradient(135deg,var(--tealBtn),var(--tealBtn2));box-shadow:0 2px 10px rgba(11,130,118,.22)}
        .reviewBtn{background:linear-gradient(135deg,var(--primary),var(--primary2));box-shadow:0 2px 10px rgba(31,111,235,.22)}
        .tourBtn:hover{transform:translateY(-1px);box-shadow:0 5px 16px rgba(11,130,118,.28)}
        .reviewBtn:hover{transform:translateY(-1px);box-shadow:0 5px 16px rgba(31,111,235,.28)}
        .tourBtn:active{background:#fff;color:var(--tealBtn);border-color:var(--tealBtn);box-shadow:none;transform:translateY(0)}
        .reviewBtn:active{background:#fff;color:var(--primary);border-color:var(--primary);box-shadow:none;transform:translateY(0)}
        .secondaryBtn{padding:9px 14px;border-radius:12px;background:#f1f5f9;color:var(--text);font-weight:600;font-size:13.5px;border:1.5px solid var(--line);cursor:pointer;transition:all .15s;display:inline-flex;align-items:center;gap:7px;white-space:nowrap}
        .secondaryBtn:hover{background:#e2e8f0}
        .quickViewBtn{width:30px;height:30px;border-radius:8px;background:#f1f5f9;border:1.5px solid var(--line);display:flex;align-items:center;justify-content:center;transition:all .15s}
        .quickViewBtn:hover{background:#e2e8f0}
        .reportBtn{padding:7px 14px;border-radius:10px;background:linear-gradient(135deg,var(--primary),var(--primary2));color:#fff;font-weight:700;font-size:12px;border:none;display:inline-flex;align-items:center;gap:5px;cursor:pointer;transition:opacity .15s;text-decoration:none}
        .reportBtn:hover{opacity:.85}

        /* ── PAGINATION ── */

        /* ── MODAL ── */
        .modal-overlay{position:fixed;inset:0;background:rgba(15,23,42,.45);backdrop-filter:blur(4px);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px}
        .modal{background:#fff;border-radius:20px;width:100%;max-width:560px;max-height:88vh;overflow-y:auto;box-shadow:0 24px 60px rgba(15,23,42,.18)}
        .modal-header{display:flex;gap:14px;align-items:flex-start;padding:22px 22px 14px}
        .modal-body{padding:0 22px 22px}
        .modal-section{margin-bottom:12px}
        .modal-label{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}
        .modal-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
        .modal-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--line)}
        .modal-row:last-child{border-bottom:none}
        .closeBtn{width:32px;height:32px;border-radius:8px;background:#f1f5f9;border:none;display:flex;align-items:center;justify-content:center;font-size:16px;color:var(--muted);flex-shrink:0;cursor:pointer}
        .closeBtn:hover{background:#e2e8f0}
        .sep{border:none;border-top:1px solid var(--line);margin:14px 0}

        /* ── BANNER ── */
        .banner{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:16px;padding:16px 18px;background:linear-gradient(135deg,#f0f4ff,#e8f0fe);border-radius:var(--radius);border:1px solid rgba(31,111,235,.12)}
        .banner b{font-size:13.5px;color:var(--text)}
        .banner span{font-size:12.5px;color:var(--muted)}

        /* ── FOOTER ── */
        .footer{background:var(--surface);border-top:1px solid var(--line);padding:40px 0;margin-top:40px;color:var(--muted);font-size:13px}
        .footerGrid{display:grid;grid-template-columns:1fr auto;gap:40px;align-items:start}
        @media(max-width:640px){.footerGrid{grid-template-columns:1fr}}
        .footerLinks{display:flex;flex-direction:column;gap:8px;font-size:13px}
        .footerLinks a:hover{color:var(--text)}

        /* ── MOBILE NAV ── */
        .hamburger{display:none;flex-direction:column;justify-content:center;gap:5px;width:36px;height:36px;background:transparent;border:none;padding:6px;cursor:pointer;flex-shrink:0}
        .hamburger span{display:block;width:22px;height:2px;background:var(--text);border-radius:2px;transition:all .2s}
        .mobileMenu{display:none}
        @media(max-width:640px){
          .navLinks{display:none}
          .hamburger{display:flex}
          .mobileMenu{display:flex;flex-direction:column;gap:12px;position:fixed;top:63px;left:0;right:0;background:#fff;padding:16px 20px;border-bottom:1px solid var(--line);box-shadow:0 8px 24px rgba(15,23,42,.08);z-index:99;transform:translateY(-110%);opacity:0;transition:transform .2s ease,opacity .15s ease;pointer-events:none}
          .mobileMenu.open{transform:translateY(0);opacity:1;pointer-events:auto}
          .mobileMenu a{font-size:15px;font-weight:600;color:var(--text);padding:6px 0;border-bottom:1px solid var(--line)}
          .mobileMenu a:last-child{border-bottom:none;margin-top:4px;text-align:center}
        }
      `}</style>

      {/* ── NAV ── */}
      <div className="nav">
        <div className="container">
          <div className="navInner">
            <a href="/" className="logo">
              <div className="logoWrap">
                <img src="/assets/aletia.png" alt="Aletia Index" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
              <div>
                <div className="logoText">Aletia Index</div>
                <div className="logoBadge">Clinical Assurance</div>
              </div>
            </a>
            <div className="navLinks">
              <a href="/about">About</a>
              <a href="/methodology">Methodology</a>
              <a href="/clinicians">For Clinicians</a>
            </div>
            <div className="navRight">
              <button type="button" className="tourBtn" aria-label="Take a tour">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 3.5v17l13-8.5-13-8.5Z" fill="currentColor" /></svg>
                Take tour
              </button>
              <a href="/request-review" className="reviewBtn">Request Review</a>
              <MobileMenu />
            </div>
          </div>
        </div>
      </div>

      {/* ── HERO ── */}
      <section className="hero">
        <div className="container">
          <div className="heroGrid">
            <div>
              <span className="heroEyebrow"><span className="dot" />Live Regulatory Index</span>
              <h1 className="heroTitle">AI/ML Medical Device <span>Index</span></h1>
            </div>
            <div className="statStrip">
              <div className="statCard"><div className="lbl">Total</div><div className="num">{(corpusTotal ?? 0).toLocaleString()}</div><div className="sub">indexed records</div></div>
              <div className="statCard"><div className="lbl">FDA</div><div className="num">{(fdaCount ?? 0).toLocaleString()}</div><div className="sub">US records</div></div>
              <div className="statCard"><div className="lbl">MHRA</div><div className="num">{(mhraCount ?? 0).toLocaleString()}</div><div className="sub">UK records</div></div>
              <div className="statCard"><div className="lbl">EU MDR</div><div className="num">{(euCount ?? 0).toLocaleString()}</div><div className="sub">EU records</div></div>
              <div className="statCard"><div className="lbl">PCCP</div><div className="num">{(pccpCount ?? 0).toLocaleString()}</div><div className="sub">authorised</div></div>
              <div className="statCard"><div className="lbl">Pipeline</div><div className="num">{(pipelineCount ?? 0).toLocaleString()}</div><div className="sub">trial / review</div></div>
            </div>
          </div>
        </div>
      </section>

      {/* ── MAIN ── */}
      <main className="page">
        <div className="container">

          {/* ── DEVICE TABLE (full-width since sidebar removed) ── */}
          <section className="card cardPad">
            <Suspense fallback={null}>
                <FiltersBar
                  specialties={specialties}
                  totalCount={totalCount ?? 0}
                  pipelineCount={pipelineCount ?? 0}
                  corpusTotal={corpusTotal ?? 0}
                />
              </Suspense>

              <Suspense fallback={
                <div className="tableWrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ minWidth: '230px' }}>Tool</th>
                        <th style={{ minWidth: '340px' }}>Description</th>
                        <th style={{ minWidth: '170px' }}>Regulatory Status</th>
                        <th style={{ minWidth: '90px' }}>Risk</th>
                        <th style={{ minWidth: '130px' }}>Last sync</th>
                        <th style={{ minWidth: '100px', textAlign: 'right' }}> </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)' }}>
                          Loading…
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              }>
                <DeviceGrid
                  devices={devices ?? []}
                  totalCount={totalCount ?? 0}
                  page={page}
                  pageSize={PAGE_SIZE}
                  filterQuery={filterQuery}
                />
              </Suspense>

              <div className="banner">
                <div>
                  <b>Transparent Methodology</b><br />
                  <span>We publish evaluation criteria, assessment process, and evidence grading standards.</span>
                </div>
                <a href="/methodology" className="secondaryBtn">View methodology</a>
              </div>
            </section>

        </div>
      </main>

      {/* ── FOOTER ── */}
      <footer className="footer">
        <div className="container">
          <div className="footerGrid">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                <div className="logoWrap" style={{ width: '34px', height: '34px', borderRadius: '10px' }}>
                  <img src="/assets/aletia.png" alt="Aletia Index" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <div>
                  <div style={{ fontWeight: 800, color: 'var(--text)', letterSpacing: '.3px', fontSize: '14px' }}>Aletia Index</div>
                  <div style={{ fontSize: '12px' }}>Clinical assurance for digital health tools</div>
                </div>
              </div>
              <p style={{ maxWidth: '60ch', lineHeight: 1.55 }}>
                We independently evaluate health technologies against structured assurance criteria. We do not endorse, certify, or validate clinical outcomes.
              </p>
              <p style={{ marginTop: '8px' }}>© {new Date().getFullYear()} Aletia Index. All rights reserved.</p>
            </div>
            <div className="footerLinks">
              <a href="/about">About</a>
              <a href="/methodology">Methodology</a>
              <a href="/request-review">Request Review</a>
              <a href="/privacy">Privacy</a>
              <a href="/terms">Terms</a>
            </div>
          </div>
        </div>
      </footer>
    </>
  )
}
