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

  if (pccp === 'approved') {
    query = query.eq('pccp_status', 'approved')
  }

  // Autonomous filter — mutually exclusive with PCCP filter
  if (autonomous === 'true') {
    query = query.eq('autonomous_output_mode', true)
  }

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
  if (status === 'Pipeline') {
    query = query.not('pipeline_stage', 'is', null)
  } else if (status !== 'All') {
    query = query.is('pipeline_stage', null).eq('health_status', status)
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
  const pipeline = all.filter((d: { pipeline_stage: string | null }) =>  d.pipeline_stage)
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
  if (search)              fq.set('search',    search)
  if (specialty !== 'All') fq.set('specialty', specialty)
  if (status    !== 'All') fq.set('status',    status)
  if (source    !== 'All') fq.set('source',    source)
  if (pccp === 'approved') fq.set('pccp',      'approved')
  if (autonomous === 'true') fq.set('autonomous', 'true')
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
          font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;
          background:
            radial-gradient(1200px 520px at 12% 10%,rgba(14,165,163,.10),transparent 60%),
            radial-gradient(1200px 520px at 65% 0%,rgba(31,111,235,.10),transparent 62%),
            var(--bg);
          color:var(--text);
          min-height:100vh;
        }
        a{color:inherit;text-decoration:none}

        /* ── LAYOUT ── */
        .container{max-width:1320px;margin:0 auto;padding:0 18px}

        /* ── NAV ── */
        .topbar{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.88);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
        .nav{height:68px;display:flex;align-items:center;justify-content:space-between;gap:14px}
        .brand{display:flex;align-items:center;gap:12px}
        .logoWrap{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,rgba(31,111,235,.15),rgba(14,165,233,.15));border:1px solid rgba(31,111,235,.22);display:grid;place-items:center;box-shadow:var(--shadow2);overflow:hidden;flex-shrink:0}
        .logoWrap img{width:28px;height:28px;object-fit:contain;display:block}
        .brandName{font-weight:800;letter-spacing:.3px;font-size:15px}
        .brandTag{font-size:12px;color:var(--muted);margin-top:2px}
        .navlinks{display:flex;align-items:center;gap:4px}
        .navlinks a{font-size:14px;color:#334155;padding:8px 10px;border-radius:10px;transition:background .15s}
        .navlinks a:hover{background:#f1f5ff}
        .navlinks a.active{color:var(--primary);background:#eef4ff;font-weight:600}
        .navRight{display:flex;align-items:center;gap:10px}
        .primaryBtn{background:linear-gradient(180deg,var(--primary2),var(--primary));color:white;padding:10px 16px;border-radius:12px;font-weight:700;font-size:14px;box-shadow:0 6px 18px rgba(31,111,235,.22);border:none;cursor:pointer;white-space:nowrap;transition:filter .15s;text-decoration:none;display:inline-block}
        .primaryBtn:hover{filter:brightness(1.06)}
        .secondaryBtn{padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:var(--surface);font-weight:600;color:#334155;cursor:pointer;font-size:14px;transition:box-shadow .15s}
        .secondaryBtn:hover{box-shadow:var(--shadow2)}

        /* Mobile menu */
        .hamburger{display:none;width:38px;height:38px;border-radius:12px;border:1px solid var(--line);background:var(--surface);align-items:center;justify-content:center;cursor:pointer;flex-direction:column;gap:5px;padding:10px}
        .hamburger span{display:block;width:18px;height:2px;background:#334155;border-radius:2px}
        .mobileMenu{display:none;position:fixed;top:68px;left:0;right:0;background:rgba(255,255,255,.97);backdrop-filter:blur(12px);border-bottom:1px solid var(--line);padding:16px 18px;z-index:49;flex-direction:column;gap:4px}
        .mobileMenu.open{display:flex}
        .mobileMenu a{font-size:15px;color:#334155;padding:12px 14px;border-radius:12px;font-weight:500}
        .mobileMenu a:hover{background:#f1f5ff}
        .mobileMenu a.active{color:var(--primary);background:#eef4ff;font-weight:600}
        .mobileMenu .primaryBtn{width:100%;text-align:center;margin-top:8px;padding:13px}

        /* ── PAGE ── */
        .page{padding:28px 0 60px}

        /* ── MAIN GRID ── */
        .mainGrid{display:grid;grid-template-columns:1fr 280px;gap:18px;align-items:start}

        /* ── CARD ── */
        .card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius2);box-shadow:var(--shadow)}
        .cardPad{padding:18px}

        /* ── SEARCH ROW ── */
        .searchRow{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
        .search{flex:1;min-width:200px;display:flex;align-items:center;gap:10px;padding:11px 14px;border:1px solid var(--line);border-radius:14px;background:#fbfcff;transition:box-shadow .15s}
        .search:focus-within{box-shadow:0 0 0 3px rgba(31,111,235,.12);border-color:rgba(31,111,235,.4)}
        .search input{width:100%;border:none;outline:none;background:transparent;font-size:14px;color:var(--text)}
        .search input::placeholder{color:var(--muted)}

        /* ── META LINE ── */
        .metaLine{color:var(--muted);font-size:13px;display:flex;gap:10px;align-items:center;margin-bottom:10px}

        /* ── PILLS ── */
        .pills{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
        .pill{background:var(--chip);border:1px solid rgba(31,111,235,.12);color:var(--chipText);padding:7px 12px;border-radius:999px;font-size:13px;font-weight:600;cursor:pointer;transition:all .15s;white-space:nowrap}
        .pill.light{background:#f8fafc;border:1px solid var(--line);color:#334155}
        .pill.active{background:var(--primary);color:white;border-color:var(--primary)}
        .pill:hover{box-shadow:var(--shadow2)}

        /* ── TABLE ── */
        .tableWrap{overflow-x:auto;border-radius:16px;border:1px solid var(--line)}
        .table{width:100%;border-collapse:collapse;min-width:600px}
        .table th{text-align:left;font-size:12px;color:var(--muted);font-weight:700;padding:12px 14px;border-bottom:1px solid var(--line);white-space:nowrap}
        .table td{padding:13px 14px;border-bottom:1px solid var(--line);vertical-align:middle;font-size:14px}
        .table tr:last-child td{border-bottom:none}
        .table tbody tr{transition:background .12s}
        .table tbody tr:hover td{background:#f8faff}
        .rowTitle{display:flex;gap:11px;align-items:center}
        .appIcon{width:40px;height:40px;border-radius:11px;background:linear-gradient(135deg,rgba(31,111,235,.15),rgba(14,165,233,.12));border:1px solid rgba(31,111,235,.14);display:grid;place-items:center;flex-shrink:0}
        .appName{font-weight:700;font-size:14px;line-height:1.3}
        .appOrg{font-size:11px;color:var(--muted);margin-top:2px;font-family:ui-monospace,monospace}
        .small{font-size:12.5px;color:var(--muted);margin-top:4px;line-height:1.45;max-width:260px}

        /* ── BADGES ── */
        .badge{display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:999px;font-size:12px;font-weight:700;border:1px solid transparent;white-space:nowrap}
        .badge.ok{background:var(--successBg);color:var(--successText);border-color:rgba(19,122,59,.15)}
        .badge.warn{background:var(--warnBg);color:var(--warnText);border-color:rgba(161,92,0,.15)}
        .badge.danger{background:var(--dangerBg);color:var(--dangerText);border-color:rgba(159,29,29,.15)}
        .badge.neutral{background:#f1f5f9;color:#334155;border-color:rgba(100,116,139,.15)}
        .badge.verified{background:var(--successBg);color:var(--successText);border-color:rgba(19,122,59,.15)}
        .badge.pipeline{background:#f0f4ff;color:#1e40af;border-color:rgba(31,64,174,.15)}
        .badge.research{background:#f0f4ff;color:#1e40af;border-color:rgba(31,64,174,.15);font-size:11px;padding:3px 8px}
        .badge.breakthrough{background:#eff6ff;color:#1d4ed8;border-color:rgba(29,78,216,.15)}

        /* ── REPORT BTN ── */
        .reportBtn{display:inline-flex;align-items:center;justify-content:center;padding:8px 14px;border-radius:12px;font-weight:700;font-size:13px;color:#fff;background:linear-gradient(180deg,var(--secondary2),var(--secondary));box-shadow:0 6px 14px rgba(14,165,163,.18);border:none;cursor:pointer;transition:filter .15s;white-space:nowrap;text-decoration:none}
        .reportBtn:hover{filter:brightness(1.06)}
        .quickViewBtn{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:10px;border:1px solid var(--line);background:var(--surface);cursor:pointer;transition:box-shadow .15s;margin-right:6px;flex-shrink:0}
        .quickViewBtn:hover{box-shadow:var(--shadow2)}
        .actionCell{display:flex;align-items:center;justify-content:flex-end;gap:4px}

        /* ── INFO CARDS ── */
        .three{margin-top:18px;display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
        .infoCard{padding:16px}
        .infoTop{display:flex;gap:10px;align-items:flex-start}
        .infoIcon{width:36px;height:36px;border-radius:11px;background:#eef4ff;border:1px solid rgba(31,111,235,.14);display:grid;place-items:center;flex-shrink:0}
        .infoCard h4{font-size:13px;font-weight:700;margin-bottom:4px}
        .infoCard p{color:var(--muted);font-size:12.5px;line-height:1.45}

        /* ── BANNER ── */
        .banner{margin-top:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:16px;background:linear-gradient(90deg,rgba(31,111,235,.07),rgba(14,165,233,.05));border:1px solid rgba(31,111,235,.13);border-radius:var(--radius2)}
        .banner b{font-size:14px}
        .banner span{color:var(--muted);font-size:13px}

        /* ── SIDEBAR ── */
        .sidebar{display:flex;flex-direction:column;gap:16px}
        .kpiHead h3{font-size:14px;font-weight:700;margin-bottom:4px}
        .kpiHead p{color:var(--muted);font-size:12.5px;line-height:1.4}
        .donutWrap{display:flex;gap:14px;align-items:center;margin-top:14px}
        .legend{display:flex;flex-direction:column;gap:7px;font-size:12.5px;color:#334155}
        .legendRow{display:flex;gap:8px;align-items:center}
        .swatch{width:9px;height:9px;border-radius:3px;flex-shrink:0}
        hr.sep{border:none;border-top:1px solid var(--line);margin:14px 0}

        /* ── QUICK FILTERS SIDEBAR ── */
        .sideSection{font-size:12px;color:var(--muted);font-weight:800;letter-spacing:.08em;margin-bottom:8px}

        /* ── FOOTER ── */
        .footer{border-top:1px solid var(--line);background:rgba(255,255,255,.7);padding:22px 0;margin-top:40px}
        .footerGrid{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;color:var(--muted);font-size:12.5px}
        .footerLinks{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start}
        .footerLinks a{color:var(--muted);transition:color .15s}
        .footerLinks a:hover{color:var(--text)}

        /* ── MODAL ── */
        .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(3px)}
        .modal{background:white;border-radius:22px;max-width:680px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 24px 60px rgba(15,23,42,.18)}
        .modal-header{padding:22px 24px 16px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:flex-start;gap:12px;position:sticky;top:0;background:white;border-radius:22px 22px 0 0;z-index:1}
        .modal-body{padding:22px 24px}
        .modal-section{margin-bottom:18px}
        .modal-label{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}
        .modal-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px}
        .modal-row{background:#f8fafc;border-radius:11px;padding:11px 14px;display:flex;justify-content:space-between;align-items:center;gap:8px}
        .closeBtn{background:none;border:none;font-size:22px;color:var(--muted);cursor:pointer;line-height:1;padding:4px;border-radius:8px;transition:color .15s;flex-shrink:0}
        .closeBtn:hover{color:var(--text)}

        /* ── RESPONSIVE ── */
        @media(max-width:1024px){
          .mainGrid{grid-template-columns:1fr}
          .sidebar{flex-direction:row;flex-wrap:wrap}
          .sidebar .card{flex:1;min-width:240px}
          .three{grid-template-columns:1fr 1fr}
        }
        @media(max-width:768px){
          .navlinks{display:none}
          .navRight .primaryBtn{display:none}
          .hamburger{display:flex}
          .three{grid-template-columns:1fr}
          .modal-grid{grid-template-columns:1fr}
          .table th:nth-child(4),.table td:nth-child(4),
          .table th:nth-child(5),.table td:nth-child(5){display:none}
          .small{display:none}
          .sidebar{flex-direction:column}
        }
        @media(max-width:480px){
          .container{padding:0 12px}
          .brandTag{display:none}
          .reportBtn{padding:7px 10px;font-size:12px}
          .page{padding:16px 0 40px}
          .table th:nth-child(3),.table td:nth-child(3){display:none}
        }
      `}</style>

      {/* ── NAV ── */}
      <div className="topbar">
        <div className="container">
          <div className="nav">
            <a className="brand" href="/">
              <div className="logoWrap">
                <img src="/assets/aletia.png" alt="Aletia Index" />
              </div>
              <div>
                <div className="brandName">ALETIA <span style={{ color: 'var(--blue)', fontWeight: 800 }}>INDEX</span></div>
                <div className="brandTag">Clinical assurance for digital health</div>
              </div>
            </a>
            <div className="navlinks">
              <a href="/" className="active">Index</a>
              <a href="/methodology">Methodology</a>
              <a href="/insights">Insights</a>
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
                  pipelineCount={pipeline.length}
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
                    {/* Green — stroke must match badge.ok colour */}
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
                    {pipeline.length > 0 && (
                      <div className="legendRow"><span className="swatch" style={{ background: '#6366f1' }} />{pipeline.length} · Pipeline</div>
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
                <div className="logoWrap" style={{ width: '34px', height: '34px', borderRadius: '10px', boxShadow: 'none' }}>
                  <img src="/assets/aletia.png" alt="Aletia Index" style={{ width: '22px', height: '22px' }} />
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
