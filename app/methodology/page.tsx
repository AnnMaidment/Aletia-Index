import { Nav, Footer } from '@/components/NavFooter'

export default function Methodology() {
  return (
    <>
      <style>{`.banner{margin-top:20px}`}</style>
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
