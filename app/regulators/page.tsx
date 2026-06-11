'use client'
import { useState } from 'react'
import { Nav, Footer } from '@/components/NavFooter'

export default function Regulators() {
  const [modalOpen, setModalOpen] = useState(false)
  const [toastShown, setToastShown] = useState(false)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setToastShown(true)
    setTimeout(() => {
      setModalOpen(false)
      setToastShown(false)
      ;(e.target as HTMLFormElement).reset()
    }, 1600)
  }

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
        .subhead{color:var(--muted);font-size:16px;line-height:1.55}
        .card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius2);box-shadow:var(--shadow)}
        .cardPad{padding:32px}
        hr.sep{border:none;border-top:1px solid var(--line);margin:24px 0}
        .sectionTitle{font-size:17px;font-weight:700;color:var(--text);margin-bottom:12px}
        .eyebrow{display:inline-flex;align-items:center;gap:8px;padding:5px 11px;border-radius:999px;background:rgba(255,255,255,.7);color:#173f86;border:1px solid rgba(188,206,233,.8);font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;margin-bottom:14px}
        .heroRow{display:flex;justify-content:space-between;align-items:flex-end;gap:26px;padding-bottom:28px}
        .heroNote{max-width:400px;padding:14px 16px;border:1px solid rgba(195,208,230,.85);border-radius:14px;background:rgba(255,255,255,.63);color:#4d5f7b;font-size:14px;line-height:1.55;flex-shrink:0}
        .lead{font-size:14.5px;line-height:1.75;color:var(--text)}
        .lead strong{color:#092657;font-weight:800}
        .infoGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:4px}
        .infoCard{border-radius:13px;background:#f7f9fc;border:1px solid #dbe5f1;padding:18px 20px;line-height:1.5}
        .infoCard h3{margin:0 0 6px;color:#10234b;font-size:15px;font-weight:700}
        .infoCard p{margin:0;color:#31415f;font-size:14px}
        .contentGrid{display:grid;grid-template-columns:1.25fr .75fr;gap:22px;margin-top:24px}
        .bulletList{margin:0;padding-left:20px;color:#31415f;line-height:1.62;font-size:14px}
        .bulletList li{padding-left:4px;margin-bottom:9px}
        .sidebox{background:linear-gradient(160deg,#f2f7ff,#f5fffe);border:1px solid #d6e4f1;border-radius:15px;padding:20px}
        .sidebox h3{margin:0 0 8px;color:#10234b;font-size:15px;font-weight:700}
        .sidebox p{margin:0;color:#43516c;font-size:14px;line-height:1.65}
        .cta{margin-top:24px;padding:22px 24px;border-radius:16px;border:1px solid #bcd4ee;background:radial-gradient(circle at 10% 20%,rgba(209,247,243,.98),transparent 42%),linear-gradient(120deg,#eef8fc,#edf3ff);display:flex;align-items:center;justify-content:space-between;gap:24px}
        .cta h3{font-family:Georgia,"Times New Roman",serif;font-size:20px;margin:0 0 6px;color:#071a3f}
        .cta p{margin:0;color:#52627b;font-size:14px;line-height:1.55}
        .ctaActions{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;min-width:300px}
        .primaryBtn{background:linear-gradient(180deg,#2b79ff,#1f6feb);color:white;padding:10px 16px;border-radius:12px;font-weight:700;font-size:14px;box-shadow:0 6px 18px rgba(31,111,235,.22);border:none;cursor:pointer;white-space:nowrap}
        .primaryBtn:hover{transform:translateY(-1px)}
        .outlineBtn{background:white;color:#173f86;border:1px solid #ccdaee;padding:10px 16px;border-radius:12px;font-weight:700;font-size:14px;cursor:pointer;white-space:nowrap}
        .footerNote{margin-top:16px;color:#6d7b91;font-size:13px;text-align:center}
        .modal{display:none;position:fixed;inset:0;background:rgba(8,20,45,.46);z-index:60;align-items:center;justify-content:center;padding:18px}
        .modal.open{display:flex}
        .modalCard{width:min(700px,100%);border-radius:20px;background:white;box-shadow:0 25px 70px rgba(7,19,45,.25);padding:28px;position:relative;max-height:90vh;overflow-y:auto}
        .modalCard h2{font-family:Georgia,"Times New Roman",serif;font-size:26px;margin-bottom:8px;color:#071a3f}
        .modalCard>p{color:#61718a;font-size:14px;line-height:1.55}
        .closeBtn{position:absolute;top:14px;right:16px;width:34px;height:34px;border:none;border-radius:50%;background:#f2f5fa;color:#52627b;cursor:pointer;font-size:18px;display:grid;place-items:center}
        .modalForm{margin-top:18px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}
        .formFull{grid-column:1/-1}
        label{font-size:13px;color:#42506a;font-weight:700;display:block;margin-bottom:5px}
        input,select,textarea{width:100%;border:1px solid #d7e0eb;border-radius:10px;padding:10px 12px;font:inherit;color:#1b2c4d;background:#fbfcfe;font-size:14px}
        textarea{min-height:100px;resize:vertical}
        .formActions{grid-column:1/-1;display:flex;justify-content:flex-end;gap:10px;margin-top:3px}
        .secondaryBtn{background:#eaf1ff;color:#173f86;border:none;padding:10px 16px;border-radius:12px;font-weight:700;font-size:14px;cursor:pointer}
        .toast{display:none;margin-top:14px;border-radius:10px;padding:12px;background:#eefaf4;color:#266246;border:1px solid #bfe7d2;font-size:14px}
        .toast.show{display:block}
        @media(max-width:900px){.heroRow{align-items:flex-start;flex-direction:column}.heroNote{max-width:none}.infoGrid,.contentGrid{grid-template-columns:1fr}.cta{align-items:flex-start;flex-direction:column}.ctaActions{min-width:0;justify-content:flex-start}}
        @media(max-width:768px){.h1{font-size:28px}.cardPad{padding:20px}.modalForm{grid-template-columns:1fr}.formFull,.formActions{grid-column:auto}}
      `}</style>

      <Nav active="regulators" />

      <main className="page">
        <div className="container">

          <div className="heroRow">
            <div>
              <div className="eyebrow">Aletia Pathways</div>
              <h1 className="h1">For Regulators</h1>
              <p className="subhead">Reliance needs a post-market layer.</p>
            </div>
            <div className="heroNote">
              Designed for national regulators, ministries of health and harmonising systems that rely on foreign regulatory evidence while retaining responsibility for local oversight.
            </div>
          </div>

          <div className="card cardPad">

            <p className="lead">
              <strong>When you rely on a foreign approval, you inherit its decision — not its surveillance.</strong>
              <br /><br />
              Reliance pathways allow your authority to draw on decisions and evidence from trusted reference jurisdictions when assessing a device for your market. But regulatory evidence is not static. A recall may be issued, a certificate may lapse, a safety signal may emerge, or the product itself may change.
              <br /><br />
              That signal does not always propagate automatically into the local oversight workflow. The local decision may remain standing after the evidence beneath it has changed.
            </p>

            <hr className="sep" />

            <h2 className="sectionTitle">What Aletia provides</h2>
            <div className="infoGrid">
              <article className="infoCard">
                <h3>Linked reference records</h3>
                <p>Aletia links devices relevant to your market to available FDA, MHRA and EU EUDAMED records under a persistent device identity.</p>
              </article>
              <article className="infoCard">
                <h3>Post-market visibility</h3>
                <p>Monitor recalls, certificate changes, stale information and other lifecycle events that may require local review.</p>
              </article>
              <article className="infoCard">
                <h3>Supplier-side attestations</h3>
                <p>Where appropriate, suppliers can confirm local listings, accountable contacts, product versions and material changes on a defined cadence.</p>
              </article>
              <article className="infoCard">
                <h3>Traceable alerts</h3>
                <p>Each alert is source-linked and time-stamped, creating an auditable trail for human review rather than an unverified signal.</p>
              </article>
            </div>

            <div className="contentGrid">
              <div>
                <h2 className="sectionTitle">What your authority can monitor</h2>
                <ul className="bulletList">
                  <li>Recalls, corrective actions and safety signals raised in a reference jurisdiction.</li>
                  <li>Registrations and certificates that have lapsed, been suspended or are approaching expiry.</li>
                  <li>Differences between devices visible in foreign registries and devices listed locally.</li>
                  <li>Supplier records that have not been confirmed within the required period.</li>
                  <li>Lifecycle changes affecting AI/ML-enabled devices, where software updates, model changes and post-deployment performance require particular attention.</li>
                </ul>
              </div>
              <aside className="sidebox">
                <h3>Configured around your framework</h3>
                <p>
                  Aletia Pathways can support a country building an initial product-level list, strengthen an existing registry with linked foreign records, or add an AI-device-specific monitoring layer around established systems.
                </p>
              </aside>
            </div>

            <div className="cta">
              <div>
                <h3>Working with a regulator, ministry of health or health-system programme?</h3>
                <p>Tell us about your jurisdiction and the oversight problem you are trying to solve.</p>
              </div>
              <div className="ctaActions">
                <button className="outlineBtn" onClick={() => setModalOpen(true)}>Tell us about your jurisdiction</button>
                <button className="primaryBtn" onClick={() => setModalOpen(true)}>Explore Aletia Pathways →</button>
              </div>
            </div>

          </div>

          <p className="footerNote">
            Built on published regulatory data and designed to support human decision-making. Aletia improves visibility without replacing the authority of the regulator.
          </p>

        </div>
      </main>

      <Footer />

      <div
        className={`modal${modalOpen ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modalTitle"
        onClick={(e) => { if (e.target === e.currentTarget) setModalOpen(false) }}
      >
        <div className="modalCard">
          <button className="closeBtn" aria-label="Close" onClick={() => setModalOpen(false)}>×</button>
          <h2 id="modalTitle">Tell us about your jurisdiction</h2>
          <p>Share a few details and we will follow up to discuss a suitable Aletia Pathways implementation.</p>

          <form className="modalForm" id="interestForm" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="reg-name">Name</label>
              <input id="reg-name" type="text" placeholder="Your name" required />
            </div>
            <div>
              <label htmlFor="reg-org">Organisation</label>
              <input id="reg-org" type="text" placeholder="Organisation name" required />
            </div>
            <div>
              <label htmlFor="reg-country">Country</label>
              <input id="reg-country" type="text" placeholder="Jurisdiction" required />
            </div>
            <div>
              <label htmlFor="reg-role">Role</label>
              <select id="reg-role" required defaultValue="">
                <option value="" disabled>Select role</option>
                <option>Regulator</option>
                <option>Ministry or public-health authority</option>
                <option>Regional regulatory initiative</option>
                <option>Funder or implementation partner</option>
                <option>Manufacturer or supplier</option>
                <option>Other</option>
              </select>
            </div>
            <div className="formFull">
              <label htmlFor="reg-interest">What would you like to explore?</label>
              <select id="reg-interest" required defaultValue="">
                <option value="" disabled>Select an option</option>
                <option>Build a national device list</option>
                <option>Link an existing registry to foreign records</option>
                <option>Add lifecycle and post-market alerts</option>
                <option>Explore a pilot implementation</option>
                <option>Discuss partnership or funding</option>
                <option>Other</option>
              </select>
            </div>
            <div className="formFull">
              <label htmlFor="reg-email">Work email</label>
              <input id="reg-email" type="email" placeholder="name@organisation.org" required />
            </div>
            <div className="formFull">
              <label htmlFor="reg-message">Optional message</label>
              <textarea id="reg-message" placeholder="Tell us briefly about your current registry or oversight need." />
            </div>
            <div className="formActions">
              <button type="button" className="secondaryBtn" onClick={() => setModalOpen(false)}>Cancel</button>
              <button type="submit" className="primaryBtn">Submit enquiry</button>
            </div>
          </form>

          <div className={`toast${toastShown ? ' show' : ''}`}>
            Thank you. We will be in touch about your jurisdiction.
          </div>
        </div>
      </div>
    </>
  )
}
