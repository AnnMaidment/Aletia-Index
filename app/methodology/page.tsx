import { Nav, Footer } from '@/components/NavFooter'

export default function Methodology() {
  return (
    <>
      <style>{`
        :root{--primary:#1f6feb;--bg:#f5f7fb;--surface:#fff;--text:#0f172a;--muted:#64748b;--line:#e6ebf3;--shadow:0 10px 30px rgba(15,23,42,.08);--shadow2:0 4px 16px rgba(15,23,42,.06);--radius2:18px}
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;background:radial-gradient(1200px 520px at 12% 10%,rgba(14,165,163,.10),transparent 60%),radial-gradient(1200px 520px at 65% 0%,rgba(31,111,235,.10),transparent 62%),var(--bg);color:var(--text);min-height:100vh}
        a{color:inherit;text-decoration:none}
        .container{max-width:1320px;margin:0 auto;padding:0 18px}
        .page{padding:34px 0 60px}
        .h1{font-size:38px;letter-spacing:-.02em;font-weight:800;margin-bottom:10px}
        .subhead{color:var(--muted);font-size:16px;line-height:1.55;max-width:70ch;margin-bottom:0}
        .card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius2);box-shadow:var(--shadow)}
        .cardPad{padding:24px}
        hr.sep{border:none;border-top:1px solid var(--line);margin:20px 0}
        .banner{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:16px;background:linear-gradient(90deg,rgba(31,111,235,.07),rgba(14,165,233,.05));border:1px solid rgba(31,111,235,.13);border-radius:var(--radius2);margin-top:20px}
        .secondaryBtn{padding:10px 14px;border-radius:12px;border:1px solid var(--line);background:var(--surface);font-weight:600;color:#334155;cursor:pointer;font-size:14px;text-decoration:none;display:inline-block}
        @media(max-width:768px){.h1{font-size:28px}}
      `}</style>
      <Nav active="methodology" />
      <main className="page">
        <div className="container">
          <h1 className="h1">Methodology</h1>
          <p className="subhead">How assessments are structured, what "Verified" means, and how evidence is graded.</p>
          <div className="card cardPad" style={{marginTop:'24px'}}>
            <h3 style={{marginBottom:'10px',fontSize:'16px',fontWeight:700}}>1) Scope</h3>
            <p style={{color:'var(--muted)',fontSize:'14px',lineHeight:1.7}}>
              Aletia Index provides independent clinical assurance signals for digital health technologies.
              Listings summarize regulatory posture, evidence signals, and lifecycle transparency indicators.
            </p>
            <hr className="sep"/>
            <h3 style={{marginBottom:'10px',fontSize:'16px',fontWeight:700}}>2) Evidence Signals</h3>
            <ul style={{color:'var(--muted)',lineHeight:1.8,paddingLeft:'20px',fontSize:'14px'}}>
              <li>Claim–evidence traceability (what is claimed vs what is supported)</li>
              <li>Validation design (population, setting, endpoints)</li>
              <li>Performance reporting (metrics, uncertainty, subgroup performance)</li>
              <li>Representativeness and external validity notes</li>
            </ul>
            <hr className="sep"/>
            <h3 style={{marginBottom:'10px',fontSize:'16px',fontWeight:700}}>3) Lifecycle Transparency</h3>
            <ul style={{color:'var(--muted)',lineHeight:1.8,paddingLeft:'20px',fontSize:'14px'}}>
              <li>Change control and versioning visibility</li>
              <li>Post‑market monitoring signals</li>
              <li>Safety reporting pathways</li>
              <li>Interoperability and data governance disclosures</li>
            </ul>
            <div className="banner">
              <div>
                <b style={{fontSize:'14px'}}>Want this to read more "regulatory" or more "clinical"?</b><br/>
                <span style={{color:'var(--muted)',fontSize:'13px'}}>We can tune the language and add a one‑page "What clinicians should look for".</span>
              </div>
              <a className="secondaryBtn" href="/clinicians">For Clinicians</a>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
