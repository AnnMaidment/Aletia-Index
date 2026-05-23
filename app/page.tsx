import { createClient } from '@supabase/supabase-js'
import { Suspense } from 'react'
import MobileMenu   from './components/MobileMenu'
import FiltersBar   from './components/FiltersBar'
import DeviceGrid   from './components/DeviceGrid'
import QuickFilters from './components/QuickFilters'
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
  // statsData is intentionally lean — only the fields the stats strip and the
  // pipeline pill in FiltersBar need. Health-status and aletia_verified were
  // pulled when the sidebar donut existed; both are gone now.
  const [{ data: statsData }, { data: specData }, { count: pccpCount }] = await Promise.all([
    supabase
      .from('device_master')
      .select('pipeline_stage, regional_registrations(country)')
      .eq('excluded', false)
      .range(0, 9999),
    supabase
      .from('device_master')
      .select('specialty_link')
      .eq('excluded', false)
      .not('specialty_link', 'is', null)
      .range(0, 9999),
    supabase
      .from('device_master')
      .select('aletia_id', { count: 'exact', head: true })
      .eq('excluded', false)
      .eq('pccp_status', 'approved'),
  ])

  const all      = statsData ?? []
  const pipelineDevices = all.filter((d: { pipeline_stage: string | null }) =>  d.pipeline_stage)

  // Jurisdiction coverage — a device cleared in two regions counts toward
  // both buckets. This is coverage, not partition; the totals deliberately
  // sum to more than `corpusTotal`.
  type RegRow = { country: string }
  type DeviceRegs = { regional_registrations?: RegRow[] }
  const hasCountry = (d: DeviceRegs, code: string) =>
    d.regional_registrations?.some(r => r.country === code) ?? false

  const fdaCount  = all.filter((d: DeviceRegs) => hasCountry(d, 'US')).length
  const mhraCount = all.filter((d: DeviceRegs) => hasCountry(d, 'GB')).length
  const euCount   = all.filter((d: DeviceRegs) => hasCountry(d, 'EU')).length

  const corpusTotal = all.length

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
        .hero{padding:48px 0 30px}
        .heroInner{max-width:74ch}
        .heroEyebrow{display:inline-flex;align-items:center;gap:7px;padding:6px 15px;background:var(--tealChip);color:var(--tealChipText);border:1px solid var(--tealChipBorder);border-radius:99px;font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;margin-bottom:18px}
        .heroEyebrow .dot{width:7px;height:7px;border-radius:99px;background:var(--secondary2);box-shadow:0 0 0 3px rgba(14,165,163,.25)}
        .heroTitle{font-size:clamp(28px,4.5vw,44px);font-weight:900;color:var(--text);letter-spacing:-.5px;line-height:1.12;margin-bottom:16px}
        .heroTitle span{background:linear-gradient(135deg,#1f6feb,#0b7f7d);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
        .heroSub{font-size:16px;color:var(--muted);line-height:1.6;max-width:64ch}

        /* ── STATS STRIP (sidebar, replaces donut card) ── */
        .statsHead{margin-bottom:14px}
        .statsHead h3{font-size:15px;font-weight:800;color:var(--text)}
        .statsHead p{font-size:12px;color:var(--muted);margin-top:3px}
        .statsList{display:flex;flex-direction:column;gap:10px}
        .statRow{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid var(--line)}
        .statRow:last-child{border-bottom:none}
        .statLabel{font-size:12.5px;color:var(--muted);font-weight:500}
        .statValue{font-size:18px;font-weight:800;color:var(--text);font-variant-numeric:tabular-nums;letter-spacing:-.2px}
        .statSub{display:flex;flex-direction:column;gap:6px;padding:8px 0 6px}
        .statSubLabel{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px}
        .statSubRows{display:flex;flex-direction:column;gap:5px}
        .statSubRow{display:flex;align-items:baseline;justify-content:space-between;font-size:13px;color:var(--text)}
        .statSubRow .statValue{font-size:14px;font-weight:700}

        /* ── LAYOUT ── */
        .container{max-width:1240px;margin:0 auto;padding:0 20px}
        .page{padding-bottom:60px}
        .mainGrid{display:grid;grid-template-columns:1fr 300px;gap:20px;align-items:start}
        @media(max-width:900px){.mainGrid{grid-template-columns:1fr}.sidebar{display:none}}

        /* ── CARD ── */
        .card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius2);box-shadow:var(--shadow2)}
        .cardPad{padding:20px}

        /* ── FILTERS ── */
        .searchRow{display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap}
        .search{flex:1;min-width:200px;display:flex;align-items:center;gap:10px;padding:0 14px;background:#f8fafc;border:1.5px solid var(--line);border-radius:12px;transition:border-color .15s}
        .search:focus-within{border-color:var(--primary)}
        .search input{flex:1;border:none;background:transparent;outline:none;font-size:14px;color:var(--text);padding:10px 0}
        .search input::placeholder{color:#94a3b8}
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

        /* ── SIDEBAR ── */
        .sidebar{display:flex;flex-direction:column;gap:16px;position:sticky;top:80px}
        .kpiHead{margin-bottom:16px}
        .kpiHead h3{font-size:15px;font-weight:800;color:var(--text)}
        .kpiHead p{font-size:12px;color:var(--muted);margin-top:3px}
        .sideSection{font-size:10.5px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:var(--muted);margin-bottom:8px}

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
              <a href="/request-review" className="primaryBtn">Request Review</a>
              <MobileMenu />
            </div>
          </div>
        </div>
      </div>

      {/* ── HERO ── */}
      <section className="hero">
        <div className="container">
          <div className="heroInner">
            <span className="heroEyebrow"><span className="dot" />Live Regulatory Index</span>
            <h1 className="heroTitle">AI/ML Medical Device <span>Index</span></h1>
            <p className="heroSub">
              A live index of AI/ML-enabled medical devices cleared by the FDA, MHRA, and under EU MDR —
              searchable by specialty, jurisdiction, regulatory class, and lifecycle stage.
            </p>
          </div>
        </div>
      </section>

      {/* ── MAIN ── */}
      <main className="page">
        <div className="container">
          <div className="mainGrid">

            {/* ── LEFT: TABLE ── */}
            <section className="card cardPad">
              <Suspense fallback={null}>
                <FiltersBar
                  specialties={specialties}
                  totalCount={totalCount ?? 0}
                  pipelineCount={pipelineDevices.length}
                  corpusTotal={corpusTotal}
                />
              </Suspense>

              <Suspense fallback={
                <div className="tableWrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ minWidth: '260px' }}>Tool</th>
                        <th style={{ minWidth: '140px' }}>Use Case</th>
                        <th style={{ minWidth: '180px' }}>Regulatory Status</th>
                        <th style={{ minWidth: '100px' }}>Risk</th>
                        <th style={{ minWidth: '180px' }}>Lifecycle Signals</th>
                        <th style={{ minWidth: '110px', textAlign: 'right' }}> </th>
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

            {/* ── RIGHT: SIDEBAR ── */}
            <aside className="sidebar">
              <div className="card cardPad">
                <div className="statsHead">
                  <h3>The Index</h3>
                  <p>Live counts across the corpus.</p>
                </div>
                <div className="statsList">
                  <div className="statRow">
                    <span className="statLabel">Total indexed</span>
                    <span className="statValue">{corpusTotal.toLocaleString()}</span>
                  </div>
                  <div className="statRow">
                    <span className="statLabel">PCCP-authorised</span>
                    <span className="statValue">{(pccpCount ?? 0).toLocaleString()}</span>
                  </div>
                  <div className="statSub">
                    <span className="statSubLabel">By jurisdiction</span>
                    <div className="statSubRows">
                      <div className="statSubRow">
                        <span>FDA</span>
                        <span className="statValue">{fdaCount.toLocaleString()}</span>
                      </div>
                      <div className="statSubRow">
                        <span>MHRA</span>
                        <span className="statValue">{mhraCount.toLocaleString()}</span>
                      </div>
                      <div className="statSubRow">
                        <span>EU MDR</span>
                        <span className="statValue">{euCount.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                  <div className="statRow">
                    <span className="statLabel">In pipeline</span>
                    <span className="statValue">{pipelineDevices.length.toLocaleString()}</span>
                  </div>
                </div>
              </div>

              <div className="card cardPad">
                <div className="sideSection">QUICK FILTERS</div>
                <Suspense fallback={null}>
                  <QuickFilters />
                </Suspense>
                <hr className="sep" />
                <div className="sideSection">ABOUT</div>
                <p style={{ fontSize: '12.5px', color: 'var(--muted)', lineHeight: 1.55, marginTop: '6px' }}>
                  The Aletia Index provides independent clinical assurance for AI/ML medical devices. Data is verified by our clinical team against the 10-Point Assurance Checklist.
                </p>
              </div>
            </aside>

          </div>
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
