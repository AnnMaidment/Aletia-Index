import { Nav, Footer } from '@/components/NavFooter'

export default function Insights() {
  return (
    <>
      <style>{`
        .infoCard{transition:box-shadow .15s;cursor:pointer}
        .infoCard:hover{box-shadow:0 16px 40px rgba(15,23,42,.12)}
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
