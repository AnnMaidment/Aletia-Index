import { Nav, Footer } from '@/components/NavFooter'

export default function Insights() {
  return (
    <>
      <style>{`
        :root{--primary:#1f6feb;--bg:#f5f7fb;--surface:#fff;--text:#0f172a;--muted:#64748b;--line:#e6ebf3;--shadow:0 10px 30px rgba(15,23,42,.08);--radius2:18px}
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;background:radial-gradient(1200px 520px at 12% 10%,rgba(14,165,163,.10),transparent 60%),radial-gradient(1200px 520px at 65% 0%,rgba(31,111,235,.10),transparent 62%),var(--bg);color:var(--text);min-height:100vh}
        a{color:inherit;text-decoration:none}
        .container{max-width:1320px;margin:0 auto;padding:0 18px}
        .page{padding:34px 0 60px}
        .h1{font-size:38px;letter-spacing:-.02em;font-weight:800;margin-bottom:10px}
        .subhead{color:var(--muted);font-size:16px;line-height:1.55;max-width:70ch}
        .card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius2);box-shadow:var(--shadow)}
        .cardPad{padding:24px}
        .three{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:18px}
        .infoCard{padding:16px;transition:box-shadow .15s;cursor:pointer}
        .infoCard:hover{box-shadow:0 16px 40px rgba(15,23,42,.12)}
        .infoTop{display:flex;gap:10px;align-items:flex-start}
        .infoIcon{width:36px;height:36px;border-radius:11px;background:#eef4ff;border:1px solid rgba(31,111,235,.14);display:grid;place-items:center;flex-shrink:0}
        .infoCard h4{font-size:13px;font-weight:700;margin-bottom:4px}
        .infoCard p{color:var(--muted);font-size:12.5px;line-height:1.45}
        @media(max-width:768px){.h1{font-size:28px}.three{grid-template-columns:1fr}}
      `}</style>
      <Nav active="insights" />
      <main className="page">
        <div className="container">
          <h1 className="h1">Insights</h1>
          <p className="subhead">Short, practical write‑ups on clinical assurance, digital health governance, and implementation.</p>
          <div className="three">
           {[
  { title:"Reading an AI tool's evidence", desc:"What metrics matter, what validation really means, and how to spot weak claims." },
  { title:"Lifecycle transparency", desc:"Change logs, monitoring, and what responsible updates look like for SaMD." },
  { title:"Regulatory posture in practice", desc:"How to interpret cleared, registered, and pending across jurisdictions." },
].map(item => (
              <article key={item.title} className="card infoCard">
                <div className="infoTop">
                  <div className="infoIcon">
                    <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
                      <path d="M4 19V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14" stroke="#1f6feb" strokeWidth="1.8"/>
                      <path d="M8 8h8M8 12h8M8 16h6" stroke="#0ea5e9" strokeWidth="1.8" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <div>
                    <h4>{item.title}</h4>
                    <p>{item.desc}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <div className="card cardPad" style={{marginTop:'18px',fontSize:'14px',color:'var(--muted)'}}>
            <b style={{color:'var(--text)'}}>Coming soon:</b> an Insights Hub with categories, tags, and a newsletter signup.
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
