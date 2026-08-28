import { Nav, Footer } from '@/components/NavFooter'

// ─────────────────────────────────────────────────────────────────────────────
// ⚠ FILL THIS IN BEFORE MERGING TO MAIN — see app/privacy/page.tsx for the
// same block and the reasoning. Terms without an identified counterparty are
// not enforceable against anyone.
// ─────────────────────────────────────────────────────────────────────────────
const OPERATOR = {
  legalName:    '[registered company name]',
  contactEmail: '[contact email]',
}

const LAST_UPDATED = '26 August 2026'

export const metadata = {
  title: 'Terms of Use — Aletia Index',
  description:
    'The terms on which Aletia Index is made available, what the index is, and what it is not.',
}

export default function Terms() {
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
        .subhead{color:var(--muted);font-size:16px;line-height:1.55;max-width:70ch;margin-bottom:0}
        .card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius2);box-shadow:var(--shadow);max-width:80ch}
        .cardPad{padding:32px}
        hr.sep{border:none;border-top:1px solid var(--line);margin:24px 0}
        .prose{font-size:14.5px;line-height:1.75;color:var(--text)}
        .prose p+p{margin-top:12px}
        .prose ul{margin:10px 0 0 20px}
        .prose li{margin-bottom:8px}
        .prose a.link{color:var(--primary);text-decoration:underline}
        .sectionTitle{font-size:17px;font-weight:700;color:var(--text);margin-bottom:12px;margin-top:0}
        .stamp{font-size:13px;color:var(--muted);margin-top:6px}
        @media(max-width:768px){.h1{font-size:28px}.cardPad{padding:20px}}
      `}</style>
      <Nav active="" />
      <main className="page">
        <div className="container">
          <h1 className="h1">Terms of Use</h1>
          <p className="subhead">
            What the index is, what it is not, and the basis on which you may use it.
          </p>
          <p className="stamp">Last updated {LAST_UPDATED}</p>

          <div className="card cardPad" style={{ marginTop: 24 }}>

            <div className="prose">
              <p>
                Aletia Index is operated by {OPERATOR.legalName}. By using the site you accept these
                terms. If you do not, please do not use it.
              </p>
            </div>

            <hr className="sep" />

            <h2 className="sectionTitle">What the index is</h2>
            <div className="prose">
              <p>
                A reference work. We collect what public regulatory registers say about AI and
                machine-learning enabled medical devices, resolve the same device across
                jurisdictions to a single canonical identity, and present the result so that the
                question &ldquo;where is this device cleared, and where is it not&rdquo; can be
                answered in one place.
              </p>
              <p>
                Our sources are the registers themselves — the FDA, the MHRA, EUDAMED and others —
                together with clinical trial registries and, where a manufacturer has claimed a
                listing, information they supply. Each device page shows where its information came
                from and when it was last synchronised.
              </p>
            </div>

            <hr className="sep" />

            <h2 className="sectionTitle">What it is not</h2>
            <div className="prose">
              <p>This matters more than anything else on this page.</p>
              <ul>
                <li>
                  <strong>Not medical advice.</strong> Nothing here is a clinical recommendation.
                  Decisions about patient care are for qualified clinicians exercising their own
                  judgement.
                </li>
                <li>
                  <strong>Not a regulatory determination.</strong> We do not approve, certify,
                  license or endorse any device, and we have no authority to do so. Only the
                  relevant regulator can tell you whether a device may lawfully be supplied or used
                  in a given country. Before you rely on a regulatory status for any decision that
                  matters, verify it against the regulator&apos;s own register.
                </li>
                <li>
                  <strong>Not a validation of clinical performance.</strong> That a device appears
                  here says only that a regulator cleared it and that we recorded the fact. It says
                  nothing about how well the device works in your setting or on your population.
                </li>
                <li>
                  <strong>Not complete or continuously current.</strong> Registers publish on their
                  own schedules, sometimes incompletely; some fields are not publicly retrievable at
                  all. Our records are synchronised periodically, not live.
                </li>
              </ul>
              <p>
                Where we mark a device as <em>Aletia Verified</em>, that badge means a human
                reviewer completed our published assurance checklist. It remains our opinion, and it
                is not a regulatory status.
              </p>
            </div>

            <hr className="sep" />

            <h2 className="sectionTitle">Accuracy, and telling us when we are wrong</h2>
            <div className="prose">
              <p>
                We take accuracy seriously and correct errors when we learn of them, but we cannot
                guarantee that every record is complete or up to date. The index is provided as it
                stands. If you find something wrong — particularly about your own device — tell us
                at {OPERATOR.contactEmail} and we will look at it.
              </p>
            </div>

            <hr className="sep" />

            <h2 className="sectionTitle">Claiming a listing</h2>
            <div className="prose">
              <p>
                A manufacturer may claim its own entry to keep it current. In doing so you confirm
                that you are authorised to act for that organisation and that what you supply is
                accurate and not misleading. We may verify a claim, decline it, or withdraw it if it
                turns out to have been made without authority. Claiming a listing does not give you
                editorial control of the regulatory information we source from the registers.
              </p>
            </div>

            <hr className="sep" />

            <h2 className="sectionTitle">Using the site fairly</h2>
            <div className="prose">
              <p>
                You are welcome to read, search, cite and link to the index, including in research
                and professional work. Please do not attempt to gain unauthorised access to any part
                of the system, place automated load on it that interferes with other people&apos;s
                use, or extract the database wholesale to reproduce a substantially similar service.
                If you want bulk or programmatic access, ask us.
              </p>
            </div>

            <hr className="sep" />

            <h2 className="sectionTitle">Intellectual property</h2>
            <div className="prose">
              <p>
                Regulatory facts are not ours to own, and we claim nothing over them. The selection,
                arrangement, canonical identifiers, written analysis and design of the index are
                ours. Third-party names and trade marks belong to their owners and appear here for
                identification.
              </p>
            </div>

            <hr className="sep" />

            <h2 className="sectionTitle">Liability</h2>
            <div className="prose">
              <p>
                The site is provided without warranties of any kind, to the fullest extent the law
                allows. We are not liable for loss arising from reliance on the index, including
                clinical, commercial or regulatory decisions — which is why the verification point
                above is stated as plainly as it is. Nothing here excludes liability that cannot
                lawfully be excluded, including for death or personal injury caused by negligence,
                or for fraud.
              </p>
            </div>

            <hr className="sep" />

            <h2 className="sectionTitle">Changes, and the law that applies</h2>
            <div className="prose">
              <p>
                We may amend these terms; the date at the top will move when we do, and continued
                use means you accept the amended version. These terms are governed by the law of the
                Republic of South Africa, and the South African courts have jurisdiction.
              </p>
              <p>
                How we handle personal information is set out separately in our{' '}
                <a className="link" href="/privacy">Privacy Notice</a>.
              </p>
            </div>

          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
