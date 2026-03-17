'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Device = {
  device_id: string
  intended_use: string
  ai_ml_type: string
  accountability_tier: number
  health_status: 'Green' | 'Amber' | 'Red'
  aletia_verified: boolean
  last_automated_sync: string
  last_clinical_review: string | null
  specialty_link: string
  mode: string
  autonomy: string
  manufacturers: { name: string; hq_location: string }
  regional_registrations: { country: string; regulatory_body: string; clearance_type: string }[]
  tech_specs: { api_type: string; ehr_compat: string; data_hosting: string; fhir_compatible: boolean; popia_compliant: boolean } | null
}

export default function Home() {
  const [devices, setDevices] = useState<Device[]>([])
  const [filtered, setFiltered] = useState<Device[]>([])

  const [search, setSearch] = useState('')
  const [specialtyFilter, setSpecialtyFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Device | null>(null)
  const [specialties, setSpecialties] = useState<string[]>([])
  const [menuOpen, setMenuOpen] = useState(false)

  const [currentPage, setCurrentPage] = useState(1)
const PAGE_SIZE = 25

  useEffect(() => { fetchDevices() }, [])

 useEffect(() => {
  let result = devices
  if (search) {
    const q = search.toLowerCase()
    result = result.filter(d =>
      (d.device_id ?? '').toLowerCase().includes(q) ||
      (d.intended_use ?? '').toLowerCase().includes(q) ||
      (d.manufacturers?.name ?? '').toLowerCase().includes(q) ||
      (d.specialty_link ?? '').toLowerCase().includes(q)
    )
  }
  if (specialtyFilter !== 'All') result = result.filter(d => d.specialty_link === specialtyFilter)
  if (statusFilter !== 'All') result = result.filter(d => d.health_status === statusFilter)
    setCurrentPage(1)
  setFiltered(result)

}, [search, specialtyFilter, statusFilter, devices])

  async function fetchDevices() {
    const { data, error } = await supabase
      .from('device_master')
      .select(`*, manufacturers(name, hq_location), regional_registrations(country, regulatory_body, clearance_type), tech_specs(api_type, ehr_compat, data_hosting, fhir_compatible, popia_compliant)`)
    if (error) { console.error(error); setLoading(false); return }
    setDevices(data || [])
    setFiltered(data || [])
    setSpecialties([...new Set((data || []).map((d: Device) => d.specialty_link))])
    setLoading(false)
  }

  const riskBadge = (status: string) => {
    if (status === 'Green') return { cls: 'badge ok', label: 'Lower' }
    if (status === 'Red') return { cls: 'badge danger', label: 'Higher' }
    return { cls: 'badge warn', label: 'Moderate' }
  }

  const regBadge = (regs: Device['regional_registrations']) => {
    if (!regs || regs.length === 0) return <span className="badge neutral">Unregistered</span>
    return <span className="badge neutral">{regs.map(r => r.clearance_type).join(' • ')}</span>
  }

  const formatDate = (d: string | null) => {
    if (!d) return 'Not reviewed'
    return new Date(d).toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' })
  }

  const verifiedCount = devices.filter(d => d.aletia_verified).length
  const sahpraCount = devices.filter(d => d.regional_registrations?.some(r => r.country === 'South Africa')).length
  const greenCount = devices.filter(d => d.health_status === 'Green').length
  const amberCount = devices.filter(d => d.health_status === 'Amber').length
  const redCount = devices.filter(d => d.health_status === 'Red').length
  const total = devices.length || 1
  const circ = 251
  const greenDash = Math.round((greenCount / total) * circ)
  const amberDash = Math.round((amberCount / total) * circ)
  const redDash = Math.round((redCount / total) * circ)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
const paginated = filtered.slice(
  (currentPage - 1) * PAGE_SIZE,
  currentPage * PAGE_SIZE
)

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
        .iconBtn{width:38px;height:38px;border-radius:12px;border:1px solid var(--line);background:var(--surface);display:grid;place-items:center;cursor:pointer;transition:box-shadow .15s}
        .iconBtn:hover{box-shadow:var(--shadow2)}
        .primaryBtn{background:linear-gradient(180deg,var(--primary2),var(--primary));color:white;padding:10px 16px;border-radius:12px;font-weight:700;font-size:14px;box-shadow:0 6px 18px rgba(31,111,235,.22);border:none;cursor:pointer;white-space:nowrap;transition:filter .15s}
        .primaryBtn:hover{filter:brightness(1.06)}
        .secondaryBtn{padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:var(--surface);font-weight:600;color:#334155;cursor:pointer;font-size:14px;transition:box-shadow .15s}
        .secondaryBtn:hover{box-shadow:var(--shadow2)}

        /* Mobile menu */
        .hamburger{display:none;width:38px;height:38px;border-radius:12px;border:1px solid var(--line);background:var(--surface);align-items:center;justify-content:center;cursor:pointer;flex-direction:column;gap:5px;padding:10px}
        .hamburger span{display:block;width:18px;height:2px;background:#334155;border-radius:2px;transition:all .2s}
        .mobileMenu{display:none;position:fixed;top:68px;left:0;right:0;background:rgba(255,255,255,.97);backdrop-filter:blur(12px);border-bottom:1px solid var(--line);padding:16px 18px;z-index:49;flex-direction:column;gap:4px}
        .mobileMenu.open{display:flex}
        .mobileMenu a{font-size:15px;color:#334155;padding:12px 14px;border-radius:12px;font-weight:500}
        .mobileMenu a:hover{background:#f1f5ff}
        .mobileMenu a.active{color:var(--primary);background:#eef4ff;font-weight:600}
        .mobileMenu .primaryBtn{width:100%;text-align:center;margin-top:8px;padding:13px}

        /* ── PAGE ── */
        .page{padding:28px 0 60px}

        /* ── MAIN GRID ── */
        .mainGrid{
          display:grid;
          grid-template-columns:1fr 280px;
          gap:18px;
          align-items:start;
        }

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
          .navRight .iconBtn{display:none}
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
                <div className="brandName">ALETIA <span style={{color:'var(--blue)',fontWeight:800}}>INDEX</span></div>
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
              <button className="hamburger" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu">
                <span></span><span></span><span></span>
              </button>
            </div>
          </div>
        </div>
      </div>

      
      {/* Mobile menu */}
      <div className={`mobileMenu ${menuOpen ? 'open' : ''}`}>
        <a href="/" className="active" onClick={() => setMenuOpen(false)}>Index</a>
        <a href="#" onClick={() => setMenuOpen(false)}>Methodology</a>
        <a href="#" onClick={() => setMenuOpen(false)}>Insights</a>
        <a href="#" onClick={() => setMenuOpen(false)}>For Clinicians</a>
        <button className="primaryBtn" onClick={() => setMenuOpen(false)}>Request Review</button>
      </div>

      {/* ── MAIN ── */}
      <main className="page">
        <div className="container">
          <div className="mainGrid">

            {/* ── LEFT: TABLE ── */}
            <section className="card cardPad">
              <div className="searchRow">
                <div className="search">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style={{flexShrink:0}}>
                    <path d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" stroke="#94a3b8" strokeWidth="1.8"/>
                    <path d="M16.2 16.2 21 21" stroke="#94a3b8" strokeWidth="1.8" strokeLinecap="round"/>
                  </svg>
                  <input
                    placeholder="Search by technology name, use case, developer, regulatory class…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
                <select
                  className="secondaryBtn"
                  value={specialtyFilter}
                  onChange={e => setSpecialtyFilter(e.target.value)}
                >
                  <option value="All">All Specialties</option>
                  {specialties.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div className="metaLine">
                <span style={{width:'8px',height:'8px',borderRadius:'99px',background:'var(--blue)',display:'inline-block',flexShrink:0}}></span>
                <b style={{color:'var(--text)'}}>{filtered.length}</b> Technologies listed
              </div>

              <div className="pills">
                {['All','Green','Amber','Red'].map(s => (
                  <span
                    key={s}
                    className={`pill light ${statusFilter === s ? 'active' : ''}`}
                    onClick={() => setStatusFilter(s)}
                  >{s === 'All' ? 'All' : `${s} Status`}</span>
                ))}
                <span className="pill light">AI/ML</span>
                <span className="pill light">Clinical Apps</span>
              </div>

              <div className="tableWrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{minWidth:'260px'}}>Tool</th>
                      <th style={{minWidth:'140px'}}>Use Case</th>
                      <th style={{minWidth:'180px'}}>Regulatory Status</th>
                      <th style={{minWidth:'100px'}}>Risk</th>
                      <th style={{minWidth:'180px'}}>Lifecycle Signals</th>
                      <th style={{minWidth:'110px',textAlign:'right'}}> </th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={6} style={{textAlign:'center',padding:'40px',color:'var(--muted)'}}>Loading devices…</td></tr>
                    ) : filtered.length === 0 ? (
                      <tr><td colSpan={6} style={{textAlign:'center',padding:'40px',color:'var(--muted)'}}>No devices found.</td></tr>
                    ) : paginated.map(device => {
                      const risk = riskBadge(device.health_status)
                      return (
                        <tr key={device.device_id}>
                          <td>
                            <div className="rowTitle">
                              <div className="appIcon">
                                <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
                                  <path d="M12 3 4 21h4l1.3-3h5.4L16 21h4L12 3Zm1.6 10H10.4L12 8.6 13.6 13Z" fill="#1f6feb"/>
                                </svg>
                              </div>
                              <div>
                              <a 
  href={`/device/${device.device_id}`} 
  className="appName"
  style={{ 
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden'
  }}
>
  {device.manufacturers?.name || device.manufacturer_name || device.device_id}
</a>
                                <div className="appOrg">{device.device_id}</div>

                                <div className="small" style={{
  display: '-webkit-box',
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden'
}}>{device.intended_use}</div>
                              </div>
                            </div>
                          </td>
                          <td style={{color:'var(--muted)',fontSize:'13px'}}>{device.specialty_link}</td>
                          <td>{regBadge(device.regional_registrations)}</td>
                          <td><span className={risk.cls}>{risk.label}</span></td>
                          <td>
                            <div style={{fontSize:'13px',fontWeight:600}}>Reviewed {formatDate(device.last_clinical_review)}</div>
                            <div className="small">
                              {device.aletia_verified ? '✓ Aletia Verified' : 'Pending verification'}
                            </div>
                          </td>
                          <td style={{textAlign:'right'}}>
                            <div className="actionCell">
                              <button className="quickViewBtn" title="Quick view" onClick={() => setSelected(device)}>
                                <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                                  <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z" stroke="#64748b" strokeWidth="1.8"/>
                                  <circle cx="12" cy="12" r="3" stroke="#64748b" strokeWidth="1.8"/>
                                </svg>
                              </button>
                              <a href={`/device/${device.device_id}`} className="reportBtn">
                                Get Report
                              </a>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {totalPages > 1 && (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 16px',
    borderTop: '1px solid var(--line)',
    fontSize: 13,
    color: 'var(--muted)'
  }}>
    <span>
      Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} devices
    </span>
    <div style={{ display: 'flex', gap: 6 }}>
      <button
        className="secondaryBtn"
        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
        disabled={currentPage === 1}
        style={{ padding: '7px 12px', fontSize: 13, opacity: currentPage === 1 ? 0.4 : 1 }}
      >
        ← Prev
      </button>
      <span style={{
        padding: '7px 12px',
        borderRadius: 12,
        background: '#f1f5f9',
        fontWeight: 700,
        color: 'var(--text)',
        fontSize: 13
      }}>
        {currentPage} / {totalPages}
      </span>
      <button
        className="secondaryBtn"
        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
        disabled={currentPage === totalPages}
        style={{ padding: '7px 12px', fontSize: 13, opacity: currentPage === totalPages ? 0.4 : 1 }}
      >
        Next →
      </button>
    </div>
  </div>
)}
              </div>

              <div className="three">
                {[
                  { title:'Structured Assessment', desc:'Documented review of regulatory posture, evidence claims, and post‑market oversight signals.', color:'#1f6feb' },
                  { title:'Evidence Signals', desc:'Summary of validation data, stability, and outcomes evidence—kept readable for clinicians.', color:'#0ea5e9' },
                  { title:'Lifecycle Transparency', desc:'Indicators for change control, monitoring, and transparency practices across the product lifecycle.', color:'#1f6feb' },
                ].map(item => (
                  <div key={item.title} className="card infoCard">
                    <div className="infoTop">
                      <div className="infoIcon">
                        <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
                          <path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" stroke={item.color} strokeWidth="1.8"/>
                          <path d="M8 8h8M8 12h8M8 16h6" stroke={item.color} strokeWidth="1.8" strokeLinecap="round"/>
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
                  <b>Transparent Methodology</b><br/>
                  <span>We publish evaluation criteria, assessment process, and evidence grading standards.</span>
                </div>
                <button className="secondaryBtn">View methodology</button>
              </div>
            </section>

            {/* ── RIGHT: SIDEBAR ── */}
            <aside className="sidebar">
              <div className="card cardPad">
                <div className="kpiHead">
                  <h3>Analysis Overview</h3>
                  <p>Distribution across listing categories.</p>
                </div>
                <div className="donutWrap">
                  <svg width="120" height="120" viewBox="0 0 120 120" style={{flexShrink:0}}>
                    <circle cx="60" cy="60" r="40" fill="none" stroke="#e6ebf3" strokeWidth="16"/>
                    <circle cx="60" cy="60" r="40" fill="none" stroke="#1f6feb" strokeWidth="16"
                      strokeDasharray={`${greenDash} ${circ}`} strokeDashoffset="0"
                      transform="rotate(-90 60 60)"/>
                    <circle cx="60" cy="60" r="40" fill="none" stroke="#0ea5e9" strokeWidth="16"
                      strokeDasharray={`${amberDash} ${circ}`} strokeDashoffset={`-${greenDash}`}
                      transform="rotate(-90 60 60)"/>
                    <circle cx="60" cy="60" r="40" fill="none" stroke="#1e3a8a" strokeWidth="16"
                      strokeDasharray={`${redDash} ${circ}`} strokeDashoffset={`-${greenDash + amberDash}`}
                      transform="rotate(-90 60 60)"/>
                    <circle cx="60" cy="60" r="28" fill="white"/>
                    <text x="60" y="56" textAnchor="middle" fontSize="13" fontWeight="800" fill="#0f172a">{devices.length}</text>
                    <text x="60" y="68" textAnchor="middle" fontSize="9" fill="#64748b">devices</text>
                  </svg>
                  <div className="legend">
                    <div className="legendRow"><span className="swatch" style={{background:'#1f6feb'}}></span>{greenCount} • Green</div>
                    <div className="legendRow"><span className="swatch" style={{background:'#0ea5e9'}}></span>{amberCount} • Amber</div>
                    <div className="legendRow"><span className="swatch" style={{background:'#1e3a8a'}}></span>{redCount} • Red</div>
                    <div className="legendRow"><span className="swatch" style={{background:'#0b7f7d'}}></span>{verifiedCount} • Verified</div>
                    <div className="legendRow"><span className="swatch" style={{background:'#2b79ff'}}></span>{sahpraCount} • SAHPRA</div>
                  </div>
                </div>
              </div>

              <div className="card cardPad">
                <div className="sideSection">QUICK FILTERS</div>
                <div className="pills" style={{marginTop:'8px'}}>
                  {['SaMD','FDA Cleared','CE Marked','SAHPRA','Mental Health'].map(f => (
                    <span key={f} className="pill" onClick={() => setSearch(f)}>{f}</span>
                  ))}
                </div>
                <hr className="sep"/>
                <div className="sideSection">ABOUT</div>
                <p style={{fontSize:'12.5px',color:'var(--muted)',lineHeight:1.55,marginTop:'6px'}}>
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
              <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'10px'}}>
                <div className="logoWrap" style={{width:'34px',height:'34px',borderRadius:'10px',boxShadow:'none'}}>
                  <img src="/assets/aletia.png" alt="Aletia Index" style={{width:'22px',height:'22px'}}/>
                </div>
                <div>
                  <div style={{fontWeight:800,color:'var(--text)',letterSpacing:'.3px',fontSize:'14px'}}>Aletia Index</div>
                  <div style={{fontSize:'12px'}}>Clinical assurance for digital health tools</div>
                </div>
              </div>
              <p style={{maxWidth:'60ch',lineHeight:1.55}}>
                We independently evaluate health technologies against structured assurance criteria. We do not endorse, certify, or validate clinical outcomes.
              </p>
              <p style={{marginTop:'8px'}}>© {new Date().getFullYear()} Aletia Index. All rights reserved.</p>
            </div>
            <div className="footerLinks">
              <a href="#">About</a>
              <a href="#">Methodology</a>
              <a href="#">Request Review</a>
              <a href="#">Privacy</a>
              <a href="#">Terms</a>
            </div>
          </div>
        </div>
      </footer>

      {/* ── MODAL ── */}
      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{flex:1}}>
                <div style={{display:'flex',gap:'7px',alignItems:'center',marginBottom:'8px',flexWrap:'wrap'}}>
                  <span className="badge neutral">{selected.device_id}</span>
                  {selected.aletia_verified && <span className="badge verified">✓ Aletia Verified</span>}
                  <span className={riskBadge(selected.health_status).cls}>{riskBadge(selected.health_status).label} Risk</span>
                </div>
                <h2 style={{fontSize:'19px',fontWeight:900,lineHeight:1.2}}>{selected.manufacturers?.name}</h2>
                <p style={{color:'var(--muted)',fontSize:'13px',marginTop:'4px'}}>{selected.manufacturers?.hq_location}</p>
              </div>
              <button className="closeBtn" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="modal-section">
                <div className="modal-label">Intended Use</div>
                <p style={{fontSize:'14px',color:'var(--text)',lineHeight:1.6}}>{selected.intended_use}</p>
              </div>
              <div className="modal-grid">
                <div><div className="modal-label">Specialty</div><p style={{fontSize:'14px'}}>{selected.specialty_link}</p></div>
                <div><div className="modal-label">AI Type</div><p style={{fontSize:'14px'}}>{selected.ai_ml_type}</p></div>
                <div><div className="modal-label">Mode</div><p style={{fontSize:'14px'}}>{selected.mode} / {selected.autonomy}</p></div>
                <div><div className="modal-label">Accountability Tier</div><p style={{fontSize:'14px'}}>Tier {selected.accountability_tier}</p></div>
              </div>
              <hr className="sep"/>
              <div className="modal-section">
                <div className="modal-label">Regulatory Registrations</div>
                {selected.regional_registrations?.map(r => (
                  <div key={r.regulatory_body} className="modal-row" style={{marginTop:'8px'}}>
                    <span style={{fontSize:'13px',fontWeight:600}}>{r.country}</span>
                    <span style={{fontSize:'12px',color:'var(--primary)',fontWeight:700}}>{r.regulatory_body}</span>
                    <span style={{fontSize:'12px',color:'var(--muted)'}}>{r.clearance_type}</span>
                  </div>
                ))}
              </div>
              {selected.tech_specs && (
                <>
                  <hr className="sep"/>
                  <div className="modal-section">
                    <div className="modal-label">Technical Profile</div>
                    <div className="modal-grid" style={{marginTop:'8px'}}>
                      <div className="modal-row"><span style={{fontSize:'13px',color:'var(--muted)'}}>API Type</span><span style={{fontSize:'13px',fontWeight:600}}>{selected.tech_specs.api_type}</span></div>
                      <div className="modal-row"><span style={{fontSize:'13px',color:'var(--muted)'}}>Hosting</span><span style={{fontSize:'13px',fontWeight:600}}>{selected.tech_specs.data_hosting}</span></div>
                      <div className="modal-row"><span style={{fontSize:'13px',color:'var(--muted)'}}>FHIR</span><span style={{fontSize:'13px',fontWeight:600}}>{selected.tech_specs.fhir_compatible ? '✓ Yes' : '✗ No'}</span></div>
                      <div className="modal-row"><span style={{fontSize:'13px',color:'var(--muted)'}}>POPIA</span><span style={{fontSize:'13px',fontWeight:600}}>{selected.tech_specs.popia_compliant ? '✓ Compliant' : '✗ No'}</span></div>
                    </div>
                  </div>
                </>
              )}
              <hr className="sep"/>
              <div className="modal-grid">
                <div><div className="modal-label">Last Automated Sync</div><p style={{fontSize:'14px',fontWeight:600}}>{formatDate(selected.last_automated_sync)}</p></div>
                <div><div className="modal-label">Last Clinical Review</div><p style={{fontSize:'14px',fontWeight:600}}>{formatDate(selected.last_clinical_review)}</p></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
