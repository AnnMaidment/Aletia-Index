import type { Metadata } from 'next'
import { Nav, Footer } from '@/components/NavFooter'

export const metadata: Metadata = {
  title: 'For Clinicians',
  description: 'A practical guide to using the Aletia Index for safe AI tool adoption and procurement in clinical settings.',
  alternates: { canonical: 'https://www.aletia-index.com/clinicians' },
}

export default function Clinicians() {
  return (
    <>
      <style>{`
        .three{margin-top:16px}
        .infoCard{box-shadow:none !important}
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
