'use client'
import { useState } from 'react'

export function Nav({ active }: { active: string }) {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <>
      <style>{`
        .topbar{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.88);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
        .nav{height:68px;display:flex;align-items:center;justify-content:space-between;gap:14px}
        .brand{display:flex;align-items:center;gap:12px;text-decoration:none}
        .logoWrap{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,rgba(31,111,235,.15),rgba(14,165,233,.15));border:1px solid rgba(31,111,235,.22);display:grid;place-items:center;box-shadow:0 4px 16px rgba(15,23,42,.06);overflow:hidden;flex-shrink:0}
        .logoWrap img{width:28px;height:28px;object-fit:contain;display:block}
        .brandName{font-weight:800;letter-spacing:.3px;font-size:15px;color:#0f172a}
        .brandTag{font-size:12px;color:#64748b;margin-top:2px}
        .navlinks{display:flex;align-items:center;gap:4px}
        .navlinks a{font-size:14px;color:#334155;padding:8px 10px;border-radius:10px;text-decoration:none;transition:background .15s}
        .navlinks a:hover{background:#f1f5ff}
        .navlinks a.active{color:#1f6feb;background:#eef4ff;font-weight:600}
        .navRight{display:flex;align-items:center;gap:10px}
        .iconBtn{width:38px;height:38px;border-radius:12px;border:1px solid var(--line);background:#fff;display:grid;place-items:center;cursor:pointer}
        .primaryBtn{background:linear-gradient(180deg,#2b79ff,#1f6feb);color:white;padding:10px 16px;border-radius:12px;font-weight:700;font-size:14px;box-shadow:0 6px 18px rgba(31,111,235,.22);border:none;cursor:pointer;text-decoration:none;white-space:nowrap}
        .hamburger{display:none;width:38px;height:38px;border-radius:12px;border:1px solid var(--line);background:#fff;align-items:center;justify-content:center;cursor:pointer;flex-direction:column;gap:5px;padding:10px}
        .hamburger span{display:block;width:18px;height:2px;background:#334155;border-radius:2px}
        .mobileMenu{display:none;position:fixed;top:68px;left:0;right:0;background:rgba(255,255,255,.97);backdrop-filter:blur(12px);border-bottom:1px solid var(--line);padding:16px 18px;z-index:49;flex-direction:column;gap:4px}
        .mobileMenu.open{display:flex}
        .mobileMenu a{font-size:15px;color:#334155;padding:12px 14px;border-radius:12px;font-weight:500;text-decoration:none}
        .mobileMenu a.active{color:#1f6feb;background:#eef4ff;font-weight:600}
        .mobileMenu .primaryBtn{width:100%;text-align:center;margin-top:8px;padding:13px;display:block}
        @media(max-width:768px){.navlinks{display:none}.navRight .primaryBtn{display:none}.navRight .iconBtn{display:none}.hamburger{display:flex}}
      `}</style>
      <div className="topbar">
        <div className="container">
          <div className="nav">
            <a className="brand" href="/">
              <div className="logoWrap">
                <img src="/assets/aletia.png" alt="Aletia Index" />
              </div>
              <div>
                <div className="brandName">ALETIA <span style={{color:'#1f6feb'}}>INDEX</span></div>
                <div className="brandTag">Clinical assurance for digital health</div>
              </div>
            </a>
            <div className="navlinks">
              <a href="/" className={active === 'index' ? 'active' : ''}>Index</a>
              <a href="/methodology" className={active === 'methodology' ? 'active' : ''}>Methodology</a>
              <a href="/insights" className={active === 'insights' ? 'active' : ''}>Insights</a>
              <a href="/clinicians" className={active === 'clinicians' ? 'active' : ''}>For Clinicians</a>
              <a href="/regulators" className={active === 'regulators' ? 'active' : ''}>For Regulators</a>
            </div>
            <div className="navRight">
              <button className="iconBtn" aria-label="Search">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                  <path d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" stroke="#334155" strokeWidth="1.8"/>
                  <path d="M16.2 16.2 21 21" stroke="#334155" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
              </button>
              <a href="/request-review" className="primaryBtn">Request Review</a>
              <button className="hamburger" onClick={() => setMenuOpen(!menuOpen)}>
                <span/><span/><span/>
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className={`mobileMenu ${menuOpen ? 'open' : ''}`}>
        <a href="/" className={active === 'index' ? 'active' : ''} onClick={() => setMenuOpen(false)}>Index</a>
        <a href="/methodology" className={active === 'methodology' ? 'active' : ''} onClick={() => setMenuOpen(false)}>Methodology</a>
        <a href="/insights" className={active === 'insights' ? 'active' : ''} onClick={() => setMenuOpen(false)}>Insights</a>
        <a href="/clinicians" className={active === 'clinicians' ? 'active' : ''} onClick={() => setMenuOpen(false)}>For Clinicians</a>
        <a href="/regulators" className={active === 'regulators' ? 'active' : ''} onClick={() => setMenuOpen(false)}>For Regulators</a>
        <a href="/request-review" className="primaryBtn" onClick={() => setMenuOpen(false)}>Request Review</a>
      </div>
    </>
  )
}

export function Footer() {
  return (
    <>
      <style>{`
        .footer{border-top:1px solid var(--line);background:rgba(255,255,255,.7);padding:22px 0;margin-top:40px}
        .footerGrid{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;color:#64748b;font-size:12.5px}
        .footerLinks{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start}
        .footerLinks a{color:#64748b;text-decoration:none;transition:color .15s}
        .footerLinks a:hover{color:#0f172a}
      `}</style>
      <footer className="footer">
        <div className="container">
          <div className="footerGrid">
            <div>
              <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'10px'}}>
                <div className="logoWrap" style={{width:'34px',height:'34px',borderRadius:'10px',boxShadow:'none'}}>
                  <img src="/assets/aletia.png" alt="Aletia" style={{width:'22px',height:'22px'}}/>
                </div>
                <div>
                  <div style={{fontWeight:800,color:'#0f172a',fontSize:'14px'}}>Aletia Index</div>
                  <div style={{fontSize:'12px'}}>Clinical assurance for digital health tools</div>
                </div>
              </div>
              <p style={{maxWidth:'60ch',lineHeight:1.55}}>
                We independently evaluate health technologies against structured assurance criteria. We do not endorse, certify, or validate clinical outcomes.
              </p>
              <p style={{marginTop:'8px'}}>© {new Date().getFullYear()} Aletia Index. All rights reserved.</p>
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
