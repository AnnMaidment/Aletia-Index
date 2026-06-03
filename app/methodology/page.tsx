import { Nav, Footer } from '@/components/NavFooter'

export default function Methodology() {
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
        .signalList{list-style:none;display:flex;flex-direction:column;gap:14px;margin-top:2px}
        .signalList li{padding:14px 16px;background:#f8fafc;border:1px solid var(--line);border-radius:12px;font-size:14px;line-height:1.65}
        .signalList li strong{display:block;font-weight:700;margin-bottom:3px}
        .sourceList{list-style:none;display:flex;flex-direction:column;gap:10px;margin-top:2px}
        .sourceList li{padding:12px 16px;background:#f8fafc;border:1px solid var(--line);border-radius:12px;font-size:14px;line-height:1.6}
        .sourceList li strong{font-weight:700}
        .ruleList{list-style:none;display:flex;flex-direction:column;gap:8px;margin-top:2px}
        .ruleList li{padding:10px 14px;background:#fff9ec;border:1px solid rgba(161,92,0,.18);border-radius:10px;font-size:14px;line-height:1.6;color:#92400e}
        @media(max-width:768px){.h1{font-size:28px}.cardPad{padding:20px}}
      `}</style>
      <Nav active="methodology" />
      <main className="page">
        <div className="container">
          <h1 className="h1">Methodology</h1>
          <p className="subhead">How Aletia knows what it knows</p>

          <div className="card cardPad" style={{ marginTop: 24 }}>

            {/* Intro */}
            <div className="prose">
              <p>Aletia Index is only as useful as it is trustworthy, so this page sets out exactly how we build and maintain the record — where the data comes from, what each signal means, what a human has verified versus what a machine has synced, and the lines we will not cross. If anything here is unclear, that is a fault worth telling us about: a clinical reference that cannot explain itself does not deserve to be relied on.</p>
            </div>

            <hr className="sep" />

            {/* One device, one identity */}
            <h2 className="sectionTitle">One device, one identity</h2>
            <div className="prose">
              <p>Every device in the index is given a single canonical identifier — an Aletia ID in the form ALT-NNNNNN. Every other identifier a device carries — FDA K-numbers, De Novo and PMA numbers, MHRA device IDs, CE certificates, EUDAMED UDIs, clinical-trial NCT numbers — is attached to that one identity rather than spawning a separate listing. This is what lets the index answer &ldquo;is this device cleared in that country&rdquo; cleanly, instead of leaving a clinician to guess whether two differently-named records are the same product.</p>
            </div>

            <hr className="sep" />

            {/* Where the data comes from */}
            <h2 className="sectionTitle">Where the data comes from</h2>
            <div className="prose" style={{ marginBottom: 14 }}>
              <p>Each record is assembled from public regulatory and clinical sources and labelled by how it arrived:</p>
            </div>
            <ul className="sourceList">
              <li><strong>Registry sync</strong> — pulled directly from official registers, including the FDA, the UK&apos;s MHRA, and EU MDR / EUDAMED, with SAHPRA on the roadmap. This is the backbone of the index.</li>
              <li><strong>Clinical-trial ingestion</strong> — trial history drawn from ClinicalTrials.gov and other registries, attached to the device it belongs to.</li>
              <li><strong>Manufacturer-submitted</strong> — corrections and additional detail provided by a manufacturer who has claimed and verified their own listing.</li>
              <li><strong>Aletia research</strong> — records we have identified and built by hand, typically for devices still in the pipeline that no registry has yet captured.</li>
            </ul>
            <div className="prose" style={{ marginTop: 14 }}>
              <p>Every record shows which of these it came from, so the basis for any claim is visible rather than implied.</p>
            </div>

            <hr className="sep" />

            {/* What the signals mean */}
            <h2 className="sectionTitle">What the signals mean</h2>
            <ul className="signalList">
              <li>
                <strong>Regulatory status, per jurisdiction</strong>
                A device&apos;s clearance is recorded separately for each jurisdiction it appears in, because that is the only way the cross-border question has an honest answer. <em>Cleared somewhere</em> is never displayed as <em>cleared everywhere</em>.
              </li>
              <li>
                <strong>Health Status — Green, Amber, Red</strong>
                A derived signal, read from the registries rather than asserted by us. From the FDA, an active recall reads Red, a high volume of adverse-event reports reads Amber, and no adverse signals reads Green. From the MHRA, a lapsed registration reads Red, a registration not updated in over two years reads Amber, and an active, current registration reads Green. Where we lack the signal to judge, a record defaults to Amber rather than to a reassuring Green — caution is the safer default for a clinical reference.
              </li>
              <li>
                <strong>Accountability Tier (1–5)</strong>
                Not every &ldquo;AI device&rdquo; carries the same weight of consequence. We place each device on a five-point scale by how much it is trusted to act: Tier 1 clinical decision support, Tier 2 diagnostic aid, Tier 3 diagnostic decision, Tier 4 autonomous screening, Tier 5 autonomous action. The tier is a literacy tool — it tells you, at a glance, how much of the clinical judgement the device is being relied on to carry.
              </li>
              <li>
                <strong>Data freshness — two clocks, shown side by side</strong>
                Every device carries two timestamps: when it was last synced from a registry, and when a human last reviewed it clinically. We display the gap between them on purpose. A record can be freshly synced and yet not recently examined; you are entitled to know which.
              </li>
              <li>
                <strong>PCCP status</strong>
                Where a device operates under a Predetermined Change Control Plan — the mechanism by which a manufacturer is permitted to update an adaptive model without re-clearing it from scratch — we record that, because for a learning system it is central to whether the version in front of you is the version that was assessed.
              </li>
            </ul>

            <hr className="sep" />

            {/* Aletia Verified */}
            <h2 className="sectionTitle">Aletia Verified</h2>
            <div className="prose">
              <p>A small number of devices carry the Aletia Verified badge. It is awarded only after a human auditor completes our 10-Point Clinical Assurance Checklist for that device. It cannot be bought, and it cannot be self-assigned by a manufacturer. It is the strongest signal the index gives, precisely because it is the hardest to earn.</p>
            </div>

            <hr className="sep" />

            {/* Independence */}
            <h2 className="sectionTitle">Independence — the lines we do not cross</h2>
            <div className="prose" style={{ marginBottom: 14 }}>
              <p>Aletia carries commercial layers. Manufacturers can claim and enrich their listings. Vetted regulatory professionals and research partners can be surfaced to the people looking for them. A separate market-intelligence view, Aletia Intelligence, carries funding, founder, and investment signals for those who want them. None of this is hidden, and none of it is allowed to touch the clinical record. The discipline is absolute:</p>
            </div>
            <ul className="ruleList">
              <li>Commercial relationships never influence a device&apos;s ranking, ordering, or clinical assessment.</li>
              <li>Financial and investment signals never appear on the clinical index — they live only inside Aletia Intelligence, clearly marked as a separate lens.</li>
              <li>Anyone who pays to be listed is disclosed as paying, and that disclosure sits beside the listing every time it appears.</li>
              <li>A clinical assessment is conducted independently of any commercial relationship with the parties it may sit next to.</li>
            </ul>
            <div className="prose" style={{ marginTop: 14 }}>
              <p>If a paying customer ever asks us to bend one of these, the answer is on this page, and the answer is no. The credibility of the clinical index is the only asset that matters; we will not spend it.</p>
            </div>

          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
