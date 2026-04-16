import { createClient } from '@supabase/supabase-js'
import { Suspense } from 'react'
import MobileMenu   from './components/MobileMenu'
import FiltersBar   from './components/FiltersBar'
import DeviceGrid   from './components/DeviceGrid'
import QuickFilters from './components/QuickFilters'
import type { Device } from '@/lib/types'
export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

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
  const search     = strParam(params, 'search')
  const specialty  = strParam(params, 'specialty') || 'All'
  const status     = strParam(params, 'status')    || 'All'
  const source     = strParam(params, 'source')    || 'All'
  const pccp       = strParam(params, 'pccp') || 'approved'
  const autonomous = strParam(params, 'autonomous')
  const pipeline   = strParam(params, 'pipeline')          // 'true' when Pipeline mode active
  const page       = Math.max(1, parseInt(strParam(params, 'page') || '1') || 1)

  const supabase = getSupabase()

  // ── Manufacturer name pre-query ─────────────────────────────────────────────
  let manufacturerDeviceIds: string[] = []
  if (search) {
    const { data: mfrData } = await supabase
      .from('device_master')
      .select('device_id, manufacturers!inner(name)')
      .eq('excluded', false)
      .or(`name.ilike.%${search}%`, { referencedTable: 'manufacturers' })
      .range(0, 9999)
    manufacturerDeviceIds = (mfrData ?? []).map(
      (d: { device_id: string }) => d.device_id,
    )
  }

  // ── Filtered + paginated query ──────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase
    .from('device_master')
    .select(
      `device_id, intended_use, manufacturer_name, specialty_link,
       health_status, pipeline_stage, data_source, excluded,
       aletia_verified, breakthrough_designation,
       ai_ml_type, accountability_tier, mode, autonomy,
       last_automated_sync, last_clinical_review,
       autonomous_output_mode, autonomous_output_description, eu_risk_class,
       manufacturers(name, hq_location),
       regional_registrations(country, regulatory_body, clearance_type),
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
    const idPart = manufacturerDeviceIds.length > 0
      ? `,device_id.in.(${manufacturerDeviceIds.join(',')})`
      : ''
    query = query.or(
      `device_id.ilike.%${search}%,intended_use.ilike.%${search}%,manufacturer_name.ilike.%${search}%${idPart}`,
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
  const [{ data: statsData }, { data: specData }] = await Promise.all([
    supabase
      .from('device_master')
      .select('health_status, pipeline_stage, aletia_verified, regional_registrations(country)')
      .eq('excluded', false)
      .range(0, 9999),
    supabase
      .from('device_master')
      .select('specialty_link')
      .eq('excluded', false)
      .not('specialty_link', 'is', null)
      .range(0, 9999),
  ])

  const all      = statsData ?? []
  const cleared  = all.filter((d: { pipeline_stage: string | null }) => !d.pipeline_stage)
  const pipelineDevices = all.filter((d: { pipeline_stage: string | null }) =>  d.pipeline_stage)
  const green    = cleared.filter((d: { health_status: string }) => d.health_status === 'Green').length
  const amber    = cleared.filter((d: { health_status: string }) => d.health_status === 'Amber').length
  const red      = cleared.filter((d: { health_status: string }) => d.health_status === 'Red').length
  const verified = all.filter((d: { aletia_verified: boolean }) => d.aletia_verified).length
  const sahpra   = all.filter((d: { regional_registrations?: { country: string }[] }) =>
    d.regional_registrations?.some(r => r.country === 'South Africa'),
  ).length

  const specialties = [...new Set(
    (specData ?? []).map((d: { specialty_link: string }) => d.specialty_link),
  )].sort() as string[]

  // ── Donut chart offsets ─────────────────────────────────────────────────────
  const circ      = 251
  const total     = cleared.length || 1
  const greenDash = Math.round((green / total) * circ)
  const amberDash = Math.round((amber / total) * circ)
  const redDash   = Math.round((red   / total) * circ)

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
        .hero{padding:52px 0 40px;text-align:center}
        .heroEyebrow{display:inline-flex;align-items:center;gap:7px;padding:5px 14px;background:var(--chip);color:var(--chipText);border-radius:99px;font-size:12px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;margin-bottom:18px}
        .heroTitle{font-size:clamp(28px,4.5vw,46px);font-weight:900;color:var(--text);letter-spacing:-.5px;line-height:1.12;margin-bottom:14px}
        .heroTitle span{background:linear-gradient(135deg,#1f6feb,#0b7f7d);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
        .heroSub{font-size:16px;color:var(--muted);max-width:58ch;margin:0 auto 28px;line-height:1.6}
        .heroActions{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}

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
        .donutWrap{display:flex;gap:18px;align-items:center}
        .legend{display:flex;flex-direction:column;gap:6px;font-size:12.5px;color:var(--text)}
        .legendRow{display:flex;align-items:center;gap:8px}
        .swatch{width:10px;height:10px;border-radius:3px;flex-shrink:0}
        .sideSection{font-size:10.5px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:var(--muted);margin-bottom:8px}

        /* ── INFO CARDS ── */
        .three{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:20px}
        @media(max-width:700px){.three{grid-template-columns:1fr}}
        .infoCard{padding:14px 16px}
        .infoTop{display:flex;gap:12px;align-items:flex-start}
        .infoIcon{width:36px;height:36px;border-radius:10px;background:#f0f4ff;display:flex;align-items:center;justify-content:center;flex-shrink:0}
        .infoCard h4{font-size:13px;font-weight:700;color:var(--text);margin-bottom:4px}
        .infoCard p{font-size:12px;line-height:1.5}

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

              {/* Info cards */}
              <div className="three">
                {[
                  { title: 'Structured Assessment', desc: 'Documented review of regulatory posture, evidence claims, and post‑market oversight signals.',           color: '#1f6feb' },
                  { title: 'Evidence Signals',       desc: 'Summary of validation data, stability, and outcomes evidence—kept readable for clinicians.',            color: '#0ea5e9' },
                  { title: 'Lifecycle Transparency', desc: 'Indicators for change control, monitoring, and transparency practices across the product lifecycle.',  color: '#1f6feb' },
                ].map(item => (
                  <div key={item.title} className="card infoCard">
                    <div className="infoTop">
                      <div className="infoIcon">
                        <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
                          <path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" stroke={item.color} strokeWidth="1.8" />
                          <path d="M8 8h8M8 12h8M8 16h6" stroke={item.color} strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                      </div>
                      <div>
                        <h4>{item.title}</h4>
                        <p>{item.desc}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

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
                <div className="kpiHead">
                  <h3>Analysis Overview</h3>
                  <p>Distribution of cleared devices by health status.</p>
                </div>
                <div className="donutWrap">
                  <svg width="120" height="120" viewBox="0 0 120 120" style={{ flexShrink: 0 }}>
                    <circle cx="60" cy="60" r="40" fill="none" stroke="#e6ebf3" strokeWidth="16" />
                    {/* Green */}
                    <circle cx="60" cy="60" r="40" fill="none" stroke="#137a3b" strokeWidth="16"
                      strokeDasharray={`${greenDash} ${circ}`}
                      strokeDashoffset="0"
                      transform="rotate(-90 60 60)" />
                    {/* Amber */}
                    <circle cx="60" cy="60" r="40" fill="none" stroke="#a15c00" strokeWidth="16"
                      strokeDasharray={`${amberDash} ${circ}`}
                      strokeDashoffset={`-${greenDash}`}
                      transform="rotate(-90 60 60)" />
                    {/* Red */}
                    <circle cx="60" cy="60" r="40" fill="none" stroke="#9f1d1d" strokeWidth="16"
                      strokeDasharray={`${redDash} ${circ}`}
                      strokeDashoffset={`-${greenDash + amberDash}`}
                      transform="rotate(-90 60 60)" />
                    <circle cx="60" cy="60" r="28" fill="white" />
                    <text x="60" y="56" textAnchor="middle" fontSize="13" fontWeight="800" fill="#0f172a">{cleared.length}</text>
                    <text x="60" y="68" textAnchor="middle" fontSize="9" fill="#64748b">cleared</text>
                  </svg>
                  <div className="legend">
                    <div className="legendRow"><span className="swatch" style={{ background: '#137a3b' }} />{green} · Green</div>
                    <div className="legendRow"><span className="swatch" style={{ background: '#a15c00' }} />{amber} · Amber</div>
                    <div className="legendRow"><span className="swatch" style={{ background: '#9f1d1d' }} />{red} · Red</div>
                    <div className="legendRow"><span className="swatch" style={{ background: '#0b7f7d' }} />{verified} · Verified</div>
                    <div className="legendRow"><span className="swatch" style={{ background: '#1e40af' }} />{sahpra} · SAHPRA</div>
                    {pipelineDevices.length > 0 && (
                      <div className="legendRow"><span className="swatch" style={{ background: '#6366f1' }} />{pipelineDevices.length} · Pipeline</div>
                    )}
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
