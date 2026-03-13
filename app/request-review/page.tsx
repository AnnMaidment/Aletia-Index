'use client'
import { Nav, Footer } from '@/components/NavFooter'

export default function RequestReview() {
  return (
    <>
      <style>{`
        .formGrid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:4px}
        .field{display:flex;flex-direction:column;gap:6px}
        .field label{font-size:13px;color:var(--muted);font-weight:700}
        .field input,.field select,.field textarea{padding:12px 14px;border:1px solid var(--line);border-radius:12px;font-size:14px;font-family:inherit;outline:none;transition:border-color .15s,box-shadow .15s;background:#fff;color:var(--text)}
        .field input:focus,.field select:focus,.field textarea:focus{border-color:rgba(31,111,235,.4);box-shadow:0 0 0 3px rgba(31,111,235,.10)}
        .fullWidth{grid-column:1/-1}
        .primaryBtn{background:linear-gradient(180deg,#2b79ff,#1f6feb);color:white;padding:12px 20px;border-radius:12px;font-weight:700;font-size:14px;box-shadow:0 6px 18px rgba(31,111,235,.22);border:none;cursor:pointer}
        @media(max-width:768px){.formGrid{grid-template-columns:1fr}}
      `}</style>
      <Nav active="" />
      <main className="page">
        <div className="container">
          <h1 className="h1">Request Review</h1>
          <p className="subhead">Submit a tool for assessment. Our clinical team will review and respond within 5 business days.</p>
          <div className="card cardPad" style={{marginTop:'24px',maxWidth:'760px'}}>
            <div className="formGrid">
              <div className="field"><label>Tool name</label><input placeholder="e.g., PresciVA" /></div>
              <div className="field"><label>Developer / Company</label><input placeholder="Company name" /></div>
              <div className="field fullWidth"><label>Intended use</label><input placeholder="Clinical decision support for…" /></div>
              <div className="field">
                <label>Regulatory status</label>
                <select>
                  <option>Unknown / Not disclosed</option>
                  <option>FDA Cleared</option>
                  <option>CE Marked (MDR)</option>
                  <option>SAHPRA (Registered / In process)</option>
                  <option>Other</option>
                </select>
              </div>
              <div className="field"><label>Website link</label><input placeholder="https://" type="url" /></div>
              <div className="field fullWidth"><label>Notes / evidence links</label><textarea rows={5} placeholder="Links to studies, metrics, docs…" style={{resize:'vertical'}}></textarea></div>
            </div>
            <div style={{marginTop:'18px',display:'flex',gap:'12px',flexWrap:'wrap',alignItems:'center'}}>
              <button className="primaryBtn" onClick={() => alert('Thanks! Our clinical team will be in touch within 5 business days.')}>Submit request</button>
              <span style={{color:'var(--muted)',fontSize:'13px'}}>Secure submission workflow coming in v2.</span>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
