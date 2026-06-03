import { Nav, Footer } from '@/components/NavFooter'

export default function Clinicians() {
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
        .sectionTitle{font-size:17px;font-weight:700;color:var(--text);margin-bottom:12px}
        .checkList{list-style:none;display:flex;flex-direction:column;gap:12px;margin-top:2px}
        .checkList li{padding:14px 16px;background:#f8fafc;border:1px solid var(--line);border-radius:12px;font-size:14px;line-height:1.65}
        .checkList li strong{display:block;font-weight:700;margin-bottom:3px}
        .factList{list-style:none;display:flex;flex-direction:column;gap:8px;margin-top:2px}
        .factList li{padding-left:18px;position:relative;font-size:14px;line-height:1.65}
        .factList li::before{content:"—";position:absolute;left:0;color:var(--muted)}
        @media(max-width:768px){.h1{font-size:28px}.cardPad{padding:20px}}
      `}</style>
      <Nav active="clinicians" />
      <main className="page">
        <div className="container">
          <h1 className="h1">For Clinicians</h1>
          <p className="subhead">Should you rely on this tool?</p>

          <div className="card cardPad" style={{ marginTop: 24 }}>

            {/* Intro */}
            <div className="prose">
              <p>You are being shown AI tools at a pace no one can reasonably keep up with — by vendors, by procurement, by colleagues, sometimes by patients. The pitch is always confident. What is rarely on the slide is the part that determines your exposure: is this actually cleared for use here, for this purpose, and how much of the decision is it being trusted to make?</p>
              <p>That is the question Aletia is built to answer, and it is the question you carry the liability for getting wrong.</p>
            </div>

            <hr className="sep" />

            {/* What you can check */}
            <h2 className="sectionTitle">What you can check in a minute</h2>
            <ul className="checkList">
              <li>
                <strong>Is it cleared where you practise — not just somewhere?</strong>
                A device cleared by the FDA is not, by that fact, cleared for use in your jurisdiction. Aletia shows clearance status per country, so &ldquo;approved in the US&rdquo; stops standing in for &ldquo;approved here.&rdquo; If a rep&apos;s claim and the register disagree, you will see it.
              </li>
              <li>
                <strong>What is it actually being trusted to do?</strong>
                Our Accountability Tier (1 to 5) tells you, plainly, how much clinical judgement the tool is being relied on to carry — from a support tool that flags something for you to look at, up to a system making an autonomous call. A tool that triages is a different liability question from a tool that decides, and the tier makes that difference legible before you lean on it.
              </li>
              <li>
                <strong>Has anything changed since it was cleared?</strong>
                Recalls, a rising count of adverse-event reports, a registration that has lapsed or gone stale — these are the things that turn a safe-on-paper device into a present risk. Aletia reads them from the registries and surfaces them as a simple Green / Amber / Red signal, with the detail underneath if you want it.
              </li>
              <li>
                <strong>Is the version in front of you the version that was assessed?</strong>
                Adaptive AI updates itself. Where a device runs under a Predetermined Change Control Plan, we flag it — because for a learning system, &ldquo;cleared&rdquo; and &ldquo;still the same thing that was cleared&rdquo; are not the same statement.
              </li>
            </ul>

            <hr className="sep" />

            {/* Protects judgement */}
            <h2 className="sectionTitle">Aletia does not replace your judgement — it protects it</h2>
            <div className="prose">
              <p>This is the important part. Aletia is not a tool that tells you whether to trust an AI&apos;s clinical output, and it never will be. The clinician stays in the loop; that is the whole point. What we do is give you the regulatory and assurance footing underneath that decision — what the device is cleared to do, where, how much autonomy it claims, and whether anything has changed since — so that your judgement is the last safeguard, not the only one.</p>
              <p>Good oversight of these tools is not a single approval signed off once and trusted forever. It is something exercised continuously, in practice, by the people actually using them. Aletia is built to support that work, not to stand in for it.</p>
            </div>

            <hr className="sep" />

            {/* What this is */}
            <h2 className="sectionTitle">What this is, and what it is not</h2>
            <ul className="factList">
              <li>It is an independent, public record of where AI/ML medical devices stand across jurisdictions, and how current that record is.</li>
              <li>It is a way to verify, fast, what you are told about a tool before you rely on it.</li>
              <li>It is not clinical advice, and it is not a substitute for your own assessment of whether a device fits the patient in front of you.</li>
              <li>It is not influenced by who pays us. Commercial relationships never touch a device&apos;s clinical assessment — see our <a href="/methodology" style={{color:'var(--primary)',fontWeight:600}}>Methodology</a> for exactly how that separation is held.</li>
            </ul>
            <div className="prose" style={{ marginTop: 18 }}>
              <p>If a tool you use, or are being asked to use, is missing from the index or looks wrong, tell us. The record gets better the more the people relying on it push back on it.</p>
            </div>

          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
