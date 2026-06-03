import { Nav, Footer } from '@/components/NavFooter'

export default function About() {
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
        .card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius2);box-shadow:var(--shadow)}
        .cardPad{padding:32px}
        hr.sep{border:none;border-top:1px solid var(--line);margin:24px 0}
        .prose{font-size:14.5px;line-height:1.75;color:var(--text)}
        .prose p+p{margin-top:12px}
        .sectionTitle{font-size:17px;font-weight:700;color:var(--text);margin-bottom:12px;margin-top:0}
        @media(max-width:768px){.h1{font-size:28px}.cardPad{padding:20px}}
      `}</style>
      <Nav active="about" />
      <main className="page">
        <div className="container">
          <h1 className="h1">About</h1>
          <p className="subhead">Independent clinical assurance for digital health tools</p>

          <div className="card cardPad" style={{ marginTop: 24 }}>

            {/* Intro */}
            <div className="prose">
              <p>An AI medical device is software. Software travels anywhere — but regulatory clearance does not. A tool cleared by the FDA can be sold in the United States, yet whether it may lawfully be used in South Africa, the United Kingdom, or Germany is a separate question with a separate answer. Until now, nobody has built a clear, trustworthy place to ask it.</p>
              <p>Aletia Index exists to answer one question well: where is this device cleared, where is it not, and what does that mean for the person relying on it?</p>
              <p>We are a reference standard for AI/ML-enabled medical devices — a single, public index that holds each device&apos;s regulatory status across jurisdictions in one place. The defining idea is simple. One device, one identity, many identifiers. A tool cleared by the FDA, registered with the MHRA, carrying a CE certificate, and running trials under three NCT numbers is not five listings — it is one device, under one canonical Aletia ID, with every identifier it has ever carried attached to it. That is the unit of truth the rest of the index is built on.</p>
            </div>

            <hr className="sep" />

            {/* Why this matters now */}
            <h2 className="sectionTitle">Why this matters now</h2>
            <div className="prose">
              <p>Medical device regulation was built for things that are tested once and approved once: pharmaceuticals, and hardware that does not change after it ships. AI is not that. It learns, it updates, and the version a clinician uses today may not be the version that was cleared. The honest regulatory question is no longer only <em>can this be approved</em> — it is <em>can it be overseen across its whole life</em>. The field is moving from gatekeeping, where safety is treated as a fixed property settled at approval, toward stewardship, where safety is understood as something that has to be watched continuously, into clinical practice itself.</p>
              <p>Aletia is built for that second world. We do not treat a clearance as the end of the story. We surface the things that change after it — adverse-event signals, recalls, lapsed registrations, predetermined change plans, the gap between when a record was last synced and when a human last reviewed it — because those are what determine whether a device is safe to rely on here, today.</p>
            </div>

            <hr className="sep" />

            {/* The South African vantage point */}
            <h2 className="sectionTitle">The South African vantage point</h2>
            <div className="prose">
              <p>Aletia is built from South Africa, and that is deliberate. The hardest version of the cross-jurisdiction question — is something cleared elsewhere actually usable here? — is felt most sharply in markets that rely on recognition of foreign clearances rather than originating their own. It is also the question almost no one answers well. Working from that vantage point keeps the index honest about the difference between <em>approved somewhere</em> and <em>approved where you are</em>, and it makes Aletia useful to the manufacturers, clinicians, and funders trying to bridge that gap in either direction.</p>
            </div>

            <hr className="sep" />

            {/* Who builds this */}
            <h2 className="sectionTitle">Who builds this</h2>
            <div className="prose">
              <p>Aletia is the work of Annemarie Maidment, whose research examines how regulatory frameworks can support genuine lifecycle oversight of adaptive, software-based medical technologies. The index is the applied edge of that research: every classification, every status, every distinction it draws reflects a working understanding of where the regulatory boundary actually sits across the FDA, the EU&apos;s MDR, the UK&apos;s MHRA, and South Africa&apos;s SAHPRA. Getting that boundary right is the entire point. It is the one thing we will not compromise on.</p>
            </div>

          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
