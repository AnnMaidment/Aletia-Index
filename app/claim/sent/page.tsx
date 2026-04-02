// app/claim/sent/page.tsx
export default function ClaimSentPage() {
  return (
    <main style={{ maxWidth: 480, margin: '80px auto', padding: '0 24px' }}>
      <h1>Check your email</h1>
      <p>
        We have sent a claim link to your email address. 
        Click the link to verify and take control of your listing.
      </p>
      <p style={{ color: '#64748b', fontSize: 14 }}>
        The link expires in 72 hours. Check your spam folder if you 
        do not see it within a few minutes.
      </p>
    </main>
  )
}