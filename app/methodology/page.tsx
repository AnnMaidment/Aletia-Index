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
        .sectionHead{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
        .sectionHead h3{font-size:16px;font-weight:700;color:var(--text)}
        .statusPill{font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;padding:3px 9px;border-radius:99px;border:1px solid transparent}
        .statusPill.built{background:#ecfdf5;color:#065f46;border-color:rgba(6,95,70,.15)}
        .statusPill.progress{background:#fffbeb;color:#92400e;border-color:rgba(146,64,14,.18)}
        .statusPill.planned{background:#eef2ff;color:#3730a3;border-color:rgba(55,48,163,.16)}
        .statusPill.disclosure{background:#f1f5f9;color:#475569;border-color:rgba(71,85,105,.18)}
        .prose{color:var(--text);font-size:14px;line-height:1.7}
        .prose p + p{margin-top:10px}
        .prose .muted{color:var(--muted)}
        @media(max-width:768px){.h1{font-size:28px}}
      `}</style>
      <Nav active="methodology" />
      <main className="page">
        <div className="container">
          <h1 className="h1">Methodology</h1>
          <p className="subhead">
            What Aletia Index assesses, what's built today, and what's coming. Sections are
            labelled by current state so it's clear what you can rely on now and what's still in progress.
          </p>
          <div className="card cardPad" style={{marginTop:'24px'}}>

            {/* ── 1. Structured Assessment ── */}
            <div className="sectionHead">
              <h3>1) Structured Assessment</h3>
              <span className="statusPill built">Built</span>
            </div>
            <div className="prose">
              <p>
                Every device in the Index is anchored to a canonical Aletia identifier and tracked
                across jurisdictions. We surface the regulatory posture from primary sources —
                FDA 510(k) and De Novo authorisations, MHRA PARD registrations, EU MDR clearances
                via EUDAMED — and reconcile multiple identifiers (K-numbers, NCT numbers, MHRA IDs,
                CE certificates) onto a single device record.
              </p>
              <p className="muted">
                The Index is queryable today by specialty, jurisdiction, lifecycle stage, and PCCP
                authorisation status. Each device has a permanent URL with structured metadata for
                indexing and citation.
              </p>
            </div>

            <hr className="sep"/>

            {/* ── 2. Evidence Signals ── */}
            <div className="sectionHead">
              <h3>2) Evidence Signals</h3>
              <span className="statusPill progress">In progress</span>
            </div>
            <div className="prose">
              <p>
                Independent clinical assurance reviews against a 10-Point Assurance Checklist
                covering claim–evidence traceability, validation design (population, setting,
                endpoints), performance reporting (metrics, uncertainty, subgroup performance),
                and representativeness.
              </p>
              <p className="muted">
                Reviews are conducted by Aletia's clinical team and result in the
                <span style={{fontWeight:600,color:'var(--text)'}}> Aletia Verified </span>
                badge. The badge cannot be self-assigned. Reviews are in progress; verified
                devices will surface as those reviews land, and the methodology behind each
                checkpoint will be published alongside the first cohort.
              </p>
            </div>

            <hr className="sep"/>

            {/* ── 3. Lifecycle Transparency ── */}
            <div className="sectionHead">
              <h3>3) Lifecycle Transparency</h3>
              <span className="statusPill planned">Planned</span>
            </div>
            <div className="prose">
              <p>
                Indicators for change control and versioning visibility, post-market monitoring
                signals, safety reporting pathways, and interoperability disclosures. The goal
                is to make it visible whether a device is being maintained — not just whether
                it was once cleared.
              </p>
              <p className="muted">
                Source data for this layer (FDA adverse event reports, MHRA field safety
                notices, PCCP modification tracking) is partially ingested; the synthesis and
                display layer is the next workstream after Evidence Signals lands.
              </p>
            </div>

            <hr className="sep"/>

            {/* ── 4. Regulatory professionals and Notified Bodies ── */}
            <div className="sectionHead">
              <h3>4) Regulatory professionals and Notified Bodies</h3>
              <span className="statusPill disclosure">Disclosure</span>
            </div>
            <div className="prose">
              <p>
                Aletia plans to surface vetted regulatory professionals and Notified Bodies
                contextually, matched to the filter state a user is engaging — specialty,
                jurisdiction, lifecycle stage, and specialist work-type (PCCP authoring,
                conformity assessment, post-market surveillance).
              </p>
              <p>
                Listed professionals will pay for inclusion. Specialism claims will be vetted
                against verifiable work product before listing and re-validated annually.
                Placements are editorially separate from Aletia's clinical assessments of
                devices — listing or non-listing of a professional has no influence on how
                a device is reviewed, ranked, or surfaced.
              </p>
              <p className="muted">
                Pricing, the full vetting protocol, and the appeal pathway for declined
                applications will be published here when the directory launches.
              </p>
            </div>

          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
