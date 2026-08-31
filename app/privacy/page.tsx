import { Nav, Footer } from '@/components/NavFooter'

// ─────────────────────────────────────────────────────────────────────────────
// Responsible party, per POPIA s18(1)(b).
//
// ⚠ ONE PRECONDITION BEFORE THIS GOES LIVE: privacy@aletia-index.com must
// actually receive mail. As at 26 Aug 2026 the domain has NO MX records, so
// anything sent to it bounces — and a privacy notice publishing a dead address
// is worse than one publishing none, because it looks like a channel and
// isn't. Resend's sending setup lives on the send. subdomain, so adding MX and
// SPF for a mailbox provider on the root does not disturb it.
//
// The Information Officer is the head of the private body by default under
// POPIA; registration with the Information Regulator is a separate mandatory
// step and is tracked in TODO.md.
// ─────────────────────────────────────────────────────────────────────────────
const RESPONSIBLE_PARTY = {
  legalName:          'Aletia Health (Pty) Ltd',
  registrationNumber: '2026/435000/07',
  address:            'Plot 60, Kalkheuvel West, Lanseria, 1739, South Africa',
  informationOfficer: 'A Maidment',
  contactEmail:       'privacy@aletia-index.com',
}

const LAST_UPDATED = '26 August 2026'

export const metadata = {
  title: 'Privacy Notice — Aletia Index',
  description:
    'How Aletia Index collects, uses and protects personal information, and your rights under POPIA.',
}

export default function Privacy() {
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
          <h1 className="h1">Privacy Notice</h1>
          <p className="subhead">
            How we handle personal information, and what you can require of us.
          </p>
          <p className="stamp">Last updated {LAST_UPDATED}</p>

          <div className="card cardPad" style={{ marginTop: 24 }}>

            <div className="prose">
              <p>
                Aletia Index is an index of medical devices, not of people. Almost everything we
                publish comes from public regulatory registers and concerns products rather than
                individuals. This notice covers the narrow set of circumstances in which we do hold
                personal information — principally when someone claims a manufacturer listing or
                contacts us — and explains what we do with it.
              </p>
              <p>
                It is written to meet section 18 of South Africa&apos;s Protection of Personal
                Information Act 4 of 2013 (POPIA).
              </p>
            </div>

            <hr className="sep" />

            <h2 className="sectionTitle">Who is responsible</h2>
            <div className="prose">
              <p>
                The responsible party is {RESPONSIBLE_PARTY.legalName} (registration number{' '}
                {RESPONSIBLE_PARTY.registrationNumber}), of {RESPONSIBLE_PARTY.address}.
              </p>
              <p>
                Our Information Officer is {RESPONSIBLE_PARTY.informationOfficer}. Any question,
                request or complaint about personal information should go to{' '}
                {RESPONSIBLE_PARTY.contactEmail}.
              </p>
            </div>

            <hr className="sep" />

            <h2 className="sectionTitle">What we collect, and why</h2>
            <div className="prose">
              <p>We collect personal information in three situations, and no others.</p>
              <ul>
                <li>
                  <strong>Claiming a listing.</strong> If you ask to take ownership of a
                  manufacturer&apos;s entry, we collect your name, email address, your role at the
                  organisation, and the company website you give us. We use these to verify that you
                  are entitled to speak for that manufacturer, to send you a verification link, and
                  to attach the claim to the listing.
                </li>
                <li>
                  <strong>Holding an account.</strong> Completing a claim creates an account so you
                  can manage the listing. We store your email address and an encrypted password.
                </li>
                <li>
                  <strong>Using the site at all.</strong> Our hosting and database providers keep
                  ordinary server logs — IP address, browser type, pages requested, timestamps —
                  for security and diagnostics. We do not run analytics, advertising or tracking
                  cookies. The only cookie we set is the session cookie that keeps you signed in.
                </li>
              </ul>
              <p>
                Where a public regulatory register names an individual — for instance a manufacturer
                contact on a registration record — that information reaches us from the register, not
                from the person, and we publish only what the register itself publishes.
              </p>
            </div>

            <hr className="sep" />

            <h2 className="sectionTitle">Whether you have to give it to us</h2>
            <div className="prose">
              <p>
                Supplying personal information is entirely voluntary. You can search, read and use
                the whole index without giving us anything. The only consequence of withholding it
                is that we cannot verify a claim, so the listing stays unclaimed and you cannot hold
                an account. No law obliges us to collect any of it.
              </p>
            </div>

            <hr className="sep" />

            <h2 className="sectionTitle">Who else sees it</h2>
            <div className="prose">
              <p>
                We do not sell personal information, and we do not share it for marketing. Three
                service providers process it on our behalf, under contract and on our instructions:
              </p>
              <ul>
                <li><strong>Supabase</strong> — database and authentication</li>
                <li><strong>Vercel</strong> — website hosting</li>
                <li><strong>Resend</strong> — sending the verification and notification emails</li>
              </ul>
              <p>
                All three operate outside South Africa, so your information is transferred across
                borders. POPIA permits this where the receiving party is bound by rules that give
                comparable protection; each of these providers commits contractually to standards of
                that kind. We will otherwise disclose personal information only where the law
                requires it.
              </p>
            </div>

            <hr className="sep" />

            <h2 className="sectionTitle">How long we keep it</h2>
            <div className="prose">
              <p>
                Claim requests are kept while the claim is being decided and for a reasonable period
                afterwards, so that we have a record of who was granted control of a listing and on
                what basis. Account details are kept while the account is open. Ask us to close your
                account and we will delete it, other than anything we must retain to show that a
                listing was properly claimed. Server logs are kept only as long as our providers
                retain them for security purposes.
              </p>
            </div>

            <hr className="sep" />

            <h2 className="sectionTitle">Your rights</h2>
            <div className="prose">
              <p>Under POPIA you may:</p>
              <ul>
                <li>ask what personal information we hold about you, and receive a copy;</li>
                <li>ask us to correct or delete information that is wrong, misleading, excessive or out of date;</li>
                <li>object to our processing your information, on reasonable grounds;</li>
                <li>withdraw any consent you have given, without affecting what was lawful beforehand.</li>
              </ul>
              <p>
                Write to {RESPONSIBLE_PARTY.contactEmail} and we will respond as promptly as we
                reasonably can.
              </p>
              <p>
                If you are not satisfied with how we have handled a request, you may complain to the
                Information Regulator (South Africa) — JD House, 27 Stiemens Street, Braamfontein,
                Johannesburg 2001;{' '}
                <a className="link" href="https://inforegulator.org.za" target="_blank" rel="noopener noreferrer">
                  inforegulator.org.za
                </a>.
              </p>
            </div>

            <hr className="sep" />

            <h2 className="sectionTitle">Security</h2>
            <div className="prose">
              <p>
                Personal information is held in an access-controlled database with row-level
                security enabled, and administrative actions are recorded in an audit log.
                Passwords are stored as salted hashes by our authentication provider and are never
                visible to us. No system is perfect; if a breach ever affects your personal
                information, we will notify you and the Information Regulator as POPIA requires.
              </p>
            </div>

            <hr className="sep" />

            <h2 className="sectionTitle">Changes</h2>
            <div className="prose">
              <p>
                We will update this notice when what we do changes, and the date at the top will
                move. Material changes affecting people who hold accounts will be notified by email.
              </p>
            </div>

          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
