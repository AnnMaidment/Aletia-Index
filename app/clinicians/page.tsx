import { Nav, Footer } from '@/components/NavFooter'

export default function Clinicians() {
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
        .subhead{color:var(--muted);font-size:16px;line-height:1.55;max-width:70ch}
        .card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius2);box-shadow:var(--shadow)}
        .cardPad{padding:24px}
        .three{margin-top:16px;display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
        .infoCard{padding:16px;box-shadow:none !important}
        .infoTop{display:flex;gap:10px;align-items:flex-start}
        .infoIcon{width:36px;height:36px;border-radius:11px;background:#eef4ff;border:1px solid rgba(31,111,235,.14);display:grid;place-items:center;flex-shrink:0}
        .infoCard h4{font-size:13px;font-weight:700;margin-bottom:4px}
        .infoCard p{color:var(--muted);font-size:12.5px;line-height:1.45}
        .banner{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:16px;background:linear-gradient(90deg,rgba(31,111,235,.07),rgba(14,165,233,.05));border:1px solid rgba(31,111,235,.13);border-radius:var(--radius2);margin-top:16px}
        .secondaryBtn{padding:10px 14px;border-radius:12px;border:1px solid var(--line);background:var(--surface);font-weight:600;color:#334155;font-size:14px;text-decoration:none;display:inline-block}
        @media(max-width:768px){.h1{font-size:28px}.three{grid-template-columns:1fr}}
      `}</style>
      <Nav active="clinicians" />
      <main className="page">
        <div className="container">
          <h1 className="h1">For Clinicians</h1>
          <p className="subhead">A practical view of what the Index shows — and how to use it for safe adoption and procurement.</p>
          <div className="card cardPad" style={{marginTop:'24px'}}>
            <h3 style={{fontSize:'16px',fontWeight:700,marginBottom:'4px'}}>What to look for</h3>
            <div className="three">
              {[
                { title:'Intended use fit', desc:"Does the tool match your clinical setting and decision context?", color:'#1f6feb' },
                { title:'Evidence strength', desc:"Is there peer‑reviewed evidence, and does it generalize to your patients?", color:'#1f6feb' },
                { title:'Lifecycle signals', desc:"Are updates, monitoring, and safety reporting transparent?", color:'#0ea5e9' },
              ].map(item => (
                <div key={item.title} className="card infoCard">
                  <div className="infoTop">
                    <div className="infoIcon">
                      <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
                        <path d="M12 2 3 6v6c0 5 4 9 9 10 5-1 9-5 9-10V6l-9-4Z" stroke={item.color} strokeWidth="1.8"/>
                        <path d="M9 12l2 2 4-5" stroke="#0ea5e9" strokeWidth="1.8" strokeLinecap="round"/>
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
                <b style={{fontSize:'14px'}}>Want a "clinic-ready" checklist PDF?</b><br/>
                <span style={{color:'var(--muted)',fontSize:'13px'}}>We can generate one as a downloadable asset once wording is final.</span>
              </div>
              <a className="secondaryBtn" href="/request-review">Request review</a>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
