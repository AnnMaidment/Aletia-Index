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

  useEffect(() => { fetchDevices() }, [])

  useEffect(() => {
    let result = devices
    if (search) {
      result = result.filter(d =>
        d.device_id.toLowerCase().includes(search.toLowerCase()) ||
        d.intended_use.toLowerCase().includes(search.toLowerCase()) ||
        d.manufacturers?.name.toLowerCase().includes(search.toLowerCase()) ||
        d.specialty_link.toLowerCase().includes(search.toLowerCase())
      )
    }
    if (specialtyFilter !== 'All') result = result.filter(d => d.specialty_link === specialtyFilter)
    if (statusFilter !== 'All') result = result.filter(d => d.health_status === statusFilter)
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
  const greenDash = Math.round((greenCount / total) * 251)
  const amberDash = Math.round((amberCount / total) * 251)

  return (
    <>
      <style>{`
        :root {
          --primary:#1f6feb; --primary2:#2b79ff;
          --secondary:#0b7f7d; --secondary2:#0ea5a3;
          --bg:#f5f7fb; --surface:#ffffff;
          --text:#0f172a; --muted:#64748b;
          --line:#e6ebf3; --shadow:0 10px 30px rgba(15,23,42,.08);
          --shadow2:0 4px 16px rgba(15,23,42,.06);
          --blue:#1f6feb; --blue2:#0ea5e9;
          --chip:#f0f4ff; --chipText:#1e40af;
          --successBg:#e9f9ef; --successText:#137a3b;
          --warnBg:#fff4e5; --warnText:#a15c00;
          --dangerBg:#ffecec; --dangerText:#9f1d1d;
          --radius:14px; --radius2:18px;
        }
        *{box-sizing:border-box; margin:0; padding:0}
        body{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif; background:radial-gradient(900px 500px at 80% -10%,rgba(31,111,235,.10),transparent 55%),radial-gradient(900px 500px at 10% 10%,rgba(14,165,233,.08),transparent 55%),var(--bg); color:var(--text); min-height:100vh}
        a{color:inherit; text-decoration:none}
        .container{max-width:1320px; margin:0 auto; padding:0 18px}
        .topbar{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.85);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
        .nav{height:68px;display:flex;align-items:center;justify-content:space-between;gap:14px}
        .brand{display:flex;align-items:center;gap:12px}
        .logo{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,rgba(31,111,235,.18),rgba(14,165,233,.18));border:1px solid rgba(31,111,235,.22);display:grid;place-items:center;box-shadow:var(--shadow2);overflow:hidden}
        .brandName{font-weight:800;letter-spacing:.3px;font-size:15px}
        .brandTag{font-size:12px;color:var(--muted);margin-top:2px}
        .navlinks{display:flex;align-items:center;gap:18px}
        .navlinks a{font-size:14px;color:#334155;padding:8px 10px;border-radius:10px}
        .navlinks a:hover{background:#f1f5ff}
        .navlinks a.active{color:var(--primary);background:#eef4ff}
        .navRight{display:flex;align-items:center;gap:10px}
        .iconBtn{width:38px;height:38px;border-radius:12px;border:1px solid var(--line);background:var(--surface);display:grid;place-items:center;cursor:pointer}
        .primaryBtn{background:linear-gradient(180deg,var(--primary2),var(--primary));color:white;padding:10px 14px;border-radius:12px;font-weight:700;font-size:14px;box-shadow:0 10px 18px rgba(31,111,235,.18);border:none;cursor:pointer}
        .primaryBtn:hover{filter:brightness(1.03)}
        .secondaryBtn{padding:11px 12px;border-radius:12px;border:1px solid var(--line);background:var(--surface);font-weight:600;color:#334155;cursor:pointer;font-size:14px}
        .secondaryBtn:hover{box-shadow:var(--shadow2)}
        .page{padding:34px 0 60px}
        .h1{font-size:40px;letter-spacing:-.02em;font-weight:800}
        .subhead{margin:10px 0 0;color:var(--muted);font-size:16px;line-height:1.55;max-width:70ch}
        .pageBand{margin:-34px -18px 0;padding:34px 18px 18px;border-radius:0 0 22px 22px;background:radial-gradient(1200px 520px at 12% 10%,rgba(14,165,163,.10),transparent 60%),radial-gradient(1200px 520px at 65% 0%,rgba(31,111,235,.10),transparent 62%);border-bottom:1px solid rgba(230,235,243,.9)}
        .grid{margin-top:22px;display:grid;grid-template-columns:1.7fr 1fr;gap:18px}
        @media(max-width:980px){.grid{grid-template-columns:1fr}.h1{font-size:34px}}
        .card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius2);box-shadow:var(--shadow)}
        .cardPad{padding:18px}
        .searchRow{margin-top:18px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
        .search{flex:1;min-width:240px;display:flex;align-items:center;gap:10px;padding:12px;border:1px solid var(--line);border-radius:14px;background:#fbfcff}
        .search input{width:100%;border:none;outline:none;background:transparent;font-size:14px}
        .metaLine{margin-top:10px;color:var(--muted);font-size:13px;display:flex;gap:10px;align-items:center}
        .pills{margin-top:12px;display:flex;gap:10px;flex-wrap:wrap}
        .pill{background:var(--chip);border:1px solid rgba(31,111,235,.12);color:var(--chipText);padding:8px 10px;border-radius:999px;font-size:13px;font-weight:600;cursor:pointer}
        .pill.light{background:#f8fafc;border:1px solid var(--line);color:#334155}
        .pill.active{background:var(--primary);color:white;border-color:var(--primary)}
        .table{width:100%;border-collapse:collapse}
        .table th{text-align:left;font-size:12px;color:var(--muted);font-weight:700;padding:12px 14px;border-bottom:1px solid var(--line)}
        .table td{padding:14px;border-bottom:1px solid var(--line);vertical-align:top}
        .table tr:hover td{background:#f8faff;cursor:pointer}
        .rowTitle{display:flex;gap:12px;align-items:center}
        .appIcon{width:42px;height:42px;border-radius:12px;background:linear-gradient(135deg,rgba(31,111,235,.18),rgba(14,165,233,.14));border:1px solid rgba(31,111,235,.16);display:grid;place-items:center;flex:0 0 auto}
        .appName{font-weight:800}
        .appOrg{font-size:12px;color:var(--muted);margin-top:2px}
        .small{font-size:13px;color:var(--muted);margin-top:6px;line-height:1.45}
        .badge{display:inline-flex;align-items:center;gap:7px;padding:7px 10px;border-radius:999px;font-size:12px;font-weight:800;border:1px solid transparent;white-space:nowrap}
        .badge.ok{background:var(--successBg);color:var(--successText);border-color:rgba(19,122,59,.18)}
        .badge.warn{background:var(--warnBg);color:var(--warnText);border-color:rgba(161,92,0,.18)}
        .badge.danger{background:var(--dangerBg);color:var(--dangerText);border-color:rgba(159,29,29,.18)}
        .badge.neutral{background:#f1f5f9;color:#334155;border-color:rgba(100,116,139,.18)}
        .badge.verified{background:var(--successBg);color:var(--successText);border-color:rgba(19,122,59,.18)}
        .reportBtn{display:inline-flex;align-items:center;justify-content:center;padding:10px 14px;border-radius:14px;font-weight:800;font-size:13px;color:#ffffff;background:linear-gradient(180deg,var(--secondary2),var(--secondary));box-shadow:0 10px 16px rgba(14,165,163,.18);border:none;cursor:pointer}
        .reportBtn:hover{filter:brightness(1.03)}
        .kpi{display:flex;gap:12px;align-items:center;justify-content:space-between}
        .kpi h3{font-size:14px}
        .kpi p{margin:6px 0 0;color:var(--muted);font-size:12.5px;line-height:1.4}
        .donutWrap{display:flex;gap:12px;align-items:center;margin-top:14px}
        .legend{display:flex;flex-direction:column;gap:8px;font-size:12.5px;color:#334155}
        .legendRow{display:flex;gap:10px;align-items:center}
        .swatch{width:10px;height:10px;border-radius:3px;flex-shrink:0}
        hr.sep{border:none;border-top:1px solid var(--line);margin:16px 0}
        .three{margin-top:18px;display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
        @media(max-width:980px){.three{grid-template-columns:1fr}}
        .infoCard{padding:16px}
        .infoTop{display:flex;gap:10px;align-items:flex-start}
        .infoIcon{width:38px;height:38px;border-radius:12px;background:#eef4ff;border:1px solid rgba(31,111,235,.14);display:grid;place-items:center}
        .infoCard h4{font-size:14px}
        .infoCard p{margin:6px 0 0;color:var(--muted);font-size:12.8px;line-height:1.45}
        .banner{margin-top:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:16px;background:linear-gradient(90deg,rgba(31,111,235,.08),rgba(14,165,233,.06));border:1px solid rgba(31,111,235,.14);border-radius:var(--radius2)}
        .banner b{font-size:14px}
        .banner span{color:var(--muted);font-size:13px}
        .footer{border-top:1px solid var(--line);background:rgba(255,255,255,.7);padding:22px 0}
        .footerGrid{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;color:var(--muted);font-size:12.5px}
        .footerLinks{display:flex;gap:14px;flex-wrap:wrap}
        .footerLinks a{color:var(--muted)}
        .footerLinks a:hover{color:var(--text)}
        .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100;display:flex;align-items:center;justify-content:center;padding:16px}
        .modal{background:white;border-radius:22px;max-width:680px;width:100%;max-height:88vh;overflow-y:auto}
        .modal-header{padding:24px 24px 16px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:flex-start}
        .modal-body{padding:24px}
        .modal-section{margin-bottom:20px}
        .modal-label{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}
        .modal-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:12px}
        .modal-row{background:#f8fafc;border-radius:12px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center}
        .closeBtn{background:none;border:none;font-size:22px;color:var(--muted);cursor:pointer;line-height:1}
      `}</style>

      {/* NAV */}
      <div className="topbar">
        <div className="container">
          <div className="nav">
            <a className="brand" href="/">
              <div className="logo">
                <svg viewBox="0 0 24 24" fill="none" width="26" height="26">
                  <path d="M12 3 4 21h4l1.3-3h5.4L16 21h4L12 3Zm1.6 10H10.4L12 8.6 13.6 13Z" fill="#1f6feb"/>
                </svg>
              </div>
              <div>
                <div className="brandName">ALETIA <span style={{color:'var(--blue)',fontWeight:800}}>INDEX</span></div>
                <div className="brandTag">Clinical assurance for digital health</div>
              </div>
            </a>
            <div className="navlinks">
              <a href="/" className="active">Index</a>
              <a href="#">Methodology</a>
              <a href="#">Insights</a>
              <a href="#">For Clinicians</a>
            </div>
            <div className="navRight">
              <button className="iconBtn" aria-label="Search">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" stroke="#334155" strokeWidth="1.8"/>
                  <path d="M16.2 16.2 21 21" stroke="#334155" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
              </button>
              <button className="primaryBtn">Request Review</button>
            </div>
          </div>
        </div>
      </div>

      {/* MAIN */}
      <main className="page">
        <div className="container">
          <div className="pageBand" style={{margin:'-34px -18px 0',padding:'34px 18px 18px',borderRadius:'0 0 22px 22px'}}>
            <h1 className="h1">Assessment Listings</h1>
            <p className="subhead">Independent clinical assurance for digital health tools.</p>
          </div>

          <div className="grid">
            {/* LEFT: TABLE */}
            <section className="card cardPad">
              <div className="searchRow">
                <div className="search">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" stroke="#334155" strokeWidth="1.8"/>
                    <path d="M16.2 16.2 21 21" stroke="#334155" strokeWidth="1.8" strokeLinecap="round"/>
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
                  style={{padding:'11px 12px'}}
                >
                  <option value="All">All Specialties</option>
                  {specialties.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div className="metaLine">
                <span style={{display:'inline-flex',alignItems:'center',gap:'8px'}}>
                  <span style={{width:'8px',height:'8px',borderRadius:'99px',background:'var(--blue)',display:'inline-block'}}></span>
                  <b style={{color:'var(--text)'}}>{filtered.length}</b> Technologies listed
                </span>
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

              <div style={{marginTop:'14px',overflow:'auto',borderRadius:'16px',border:'1px solid var(--line)'}}>
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{minWidth:'280px'}}>Tool</th>
                      <th style={{minWidth:'160px'}}>Use Case</th>
                      <th style={{minWidth:'190px'}}>Regulatory Status</th>
                      <th style={{minWidth:'110px'}}>Risk</th>
                      <th style={{minWidth:'200px'}}>Lifecycle Signals</th>
                      <th style={{minWidth:'120px',textAlign:'right'}}> </th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={6} style={{textAlign:'center',padding:'40px',color:'var(--muted)'}}>Loading devices...</td></tr>
                    ) : filtered.length === 0 ? (
                      <tr><td colSpan={6} style={{textAlign:'center',padding:'40px',color:'var(--muted)'}}>No devices found.</td></tr>
                    ) : filtered.map(device => {
                      const risk = riskBadge(device.health_status)
                      return (
                        <tr key={device.device_id} onClick={() => setSelected(device)}>
                          <td>
                            <div className="rowTitle">
                              <div className="appIcon">
                                <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
                                  <path d="M12 3 4 21h4l1.3-3h5.4L16 21h4L12 3Zm1.6 10H10.4L12 8.6 13.6 13Z" fill="#1f6feb"/>
                                </svg>
                              </div>
                              <div>
                                <div className="appName">{device.manufacturers?.name}</div>
                                <div className="appOrg">{device.device_id}</div>
                                <div className="small">{device.intended_use}</div>
                              </div>
                            </div>
                          </td>
                          <td>{device.specialty_link}</td>
                          <td>{regBadge(device.regional_registrations)}</td>
                          <td><span className={risk.cls}>{risk.label}</span></td>
                          <td>
                            <div><b>Reviewed {formatDate(device.last_clinical_review)}</b></div>
                            <div className="small">
                              {device.aletia_verified ? '✓ Aletia Verified' : 'Pending verification'}
                            </div>
                          </td>
                          <td style={{textAlign:'right'}}>
                            <button className="reportBtn" onClick={e => { e.stopPropagation(); setSelected(device) }}>
                              See Report
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="three">
                <div className="card infoCard">
                  <div className="infoTop">
                    <div className="infoIcon">
                      <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
                        <path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" stroke="#1f6feb" strokeWidth="1.8"/>
                        <path d="M8 8h8M8 12h8M8 16h6" stroke="#1f6feb" strokeWidth="1.8" strokeLinecap="round"/>
                      </svg>
                    </div>
                    <div>
                      <h4>Structured Assessment</h4>
                      <p>Documented review of regulatory posture, evidence claims, and post‑market oversight signals.</p>
                    </div>
                  </div>
                </div>
                <div className="card infoCard">
                  <div className="infoTop">
                    <div className="infoIcon">
                      <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
                        <path d="M12 3v18M3 12h18" stroke="#0ea5e9" strokeWidth="1.8" strokeLinecap="round"/>
                        <path d="M6 16c2 2 4 3 6 3s4-1 6-3" stroke="#0ea5e9" strokeWidth="1.8" strokeLinecap="round"/>
                      </svg>
                    </div>
                    <div>
                      <h4>Evidence Signals</h4>
                      <p>Summary of validation data, stability, and outcomes evidence—kept readable for clinicians.</p>
                    </div>
                  </div>
                </div>
                <div className="card infoCard">
                  <div className="infoTop">
                    <div className="infoIcon">
                      <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
                        <path d="M4 7h16M4 12h16M4 17h16" stroke="#1f6feb" strokeWidth="1.8" strokeLinecap="round"/>
                        <path d="M7 7v10" stroke="#0ea5e9" strokeWidth="1.8" strokeLinecap="round"/>
                      </svg>
                    </div>
                    <div>
                      <h4>Lifecycle Transparency</h4>
                      <p>Indicators for change control, monitoring, and transparency practices across the product lifecycle.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="banner">
                <div>
                  <b>Transparent Methodology</b><br/>
                  <span>We publish evaluation criteria, assessment process, and evidence grading standards.</span>
                </div>
                <button className="secondaryBtn">View methodology</button>
              </div>
            </section>

            {/* RIGHT: SIDEBAR */}
            <aside className="card cardPad">
              <div className="kpi">
                <div>
                  <h3>Analysis Overview</h3>
                  <p>Distribution across listing categories.</p>
                </div>
              </div>

              <div className="donutWrap">
                <svg width="132" height="132" viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r="40" fill="none" stroke="#e6ebf3" strokeWidth="16"/>
                  <circle cx="60" cy="60" r="40" fill="none" stroke="#1f6feb" strokeWidth="16"
                    strokeDasharray={`${greenDash} 251`} strokeDashoffset="0"
                    transform="rotate(-90 60 60)"/>
                  <circle cx="60" cy="60" r="40" fill="none" stroke="#f59e0b" strokeWidth="16"
                    strokeDasharray={`${amberDash} 251`} strokeDashoffset={`-${greenDash}`}
                    transform="rotate(-90 60 60)"/>
                  <circle cx="60" cy="60" r="28" fill="white"/>
                  <text x="60" y="56" textAnchor="middle" fontSize="13" fontWeight="800" fill="#0f172a">{devices.length}</text>
                  <text x="60" y="68" textAnchor="middle" fontSize="9" fill="#64748b">devices</text>
                </svg>
                <div className="legend">
                  <div className="legendRow"><span className="swatch" style={{background:'#1f6feb'}}></span> {greenCount} • Green Status</div>
                  <div className="legendRow"><span className="swatch" style={{background:'#f59e0b'}}></span> {amberCount} • Amber Status</div>
                  <div className="legendRow"><span className="swatch" style={{background:'#ef4444'}}></span> {redCount} • Red Status</div>
                  <div className="legendRow"><span className="swatch" style={{background:'#10b981'}}></span> {verifiedCount} • Aletia Verified</div>
                  <div className="legendRow"><span className="swatch" style={{background:'#6366f1'}}></span> {sahpraCount} • SAHPRA</div>
                </div>
              </div>

              <hr className="sep"/>

              <div className="card" style={{boxShadow:'none'}}>
                <div className="cardPad">
                  <div style={{fontSize:'12px',color:'var(--muted)',fontWeight:800,letterSpacing:'.08em'}}>QUICK FILTERS</div>
                  <div className="pills" style={{marginTop:'10px'}}>
                    {['SaMD','FDA Cleared','CE Marked','SAHPRA','Mental Health'].map(f => (
                      <span key={f} className="pill" onClick={() => setSearch(f)}>{f}</span>
                    ))}
                  </div>
                  <div style={{marginTop:'14px',fontSize:'12px',color:'var(--muted)',fontWeight:800,letterSpacing:'.08em'}}>ABOUT</div>
                  <p className="small" style={{marginTop:'8px'}}>
                    The Aletia Index provides independent clinical assurance for AI/ML medical devices. Data is verified by our clinical team against the 10-Point Assurance Checklist.
                  </p>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </main>

      {/* FOOTER */}
      <footer className="footer">
        <div className="container">
          <div className="footerGrid">
            <div>
              <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                <div className="logo" style={{width:'34px',height:'34px',borderRadius:'11px',boxShadow:'none'}}>
                  <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
                    <path d="M12 3 4 21h4l1.3-3h5.4L16 21h4L12 3Zm1.6 10H10.4L12 8.6 13.6 13Z" fill="#1f6feb"/>
                  </svg>
                </div>
                <div>
                  <div style={{fontWeight:800,color:'var(--text)',letterSpacing:'.3px'}}>Aletia Index</div>
                  <div>Clinical assurance for digital health tools</div>
                </div>
              </div>
              <div style={{marginTop:'10px',maxWidth:'70ch'}}>
                We independently evaluate health technologies against structured assurance criteria. We do not endorse, certify, or validate clinical outcomes.
              </div>
              <div style={{marginTop:'10px'}}>© {new Date().getFullYear()} Aletia Index. All rights reserved.</div>
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

      {/* MODAL */}
      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div style={{display:'flex',gap:'8px',alignItems:'center',marginBottom:'6px',flexWrap:'wrap'}}>
                  <span className="badge neutral">{selected.device_id}</span>
                  {selected.aletia_verified && <span className="badge verified">✓ Aletia Verified</span>}
                  <span className={riskBadge(selected.health_status).cls}>{riskBadge(selected.health_status).label} Risk</span>
                </div>
                <h2 style={{fontSize:'20px',fontWeight:900}}>{selected.manufacturers?.name}</h2>
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
                <div>
                  <div className="modal-label">Specialty</div>
                  <p style={{fontSize:'14px'}}>{selected.specialty_link}</p>
                </div>
                <div>
                  <div className="modal-label">AI Type</div>
                  <p style={{fontSize:'14px'}}>{selected.ai_ml_type}</p>
                </div>
                <div>
                  <div className="modal-label">Mode</div>
                  <p style={{fontSize:'14px'}}>{selected.mode} / {selected.autonomy}</p>
                </div>
                <div>
                  <div className="modal-label">Accountability Tier</div>
                  <p style={{fontSize:'14px'}}>Tier {selected.accountability_tier}</p>
                </div>
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
                <div>
                  <div className="modal-label">Last Automated Sync</div>
                  <p style={{fontSize:'14px',fontWeight:600}}>{formatDate(selected.last_automated_sync)}</p>
                </div>
                <div>
                  <div className="modal-label">Last Clinical Review</div>
                  <p style={{fontSize:'14px',fontWeight:600}}>{formatDate(selected.last_clinical_review)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}