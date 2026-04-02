// app/claim/already-claimed/page.tsx
export default function AlreadyClaimedPage() {
  return (
    <main style={{ maxWidth: 480, margin: '80px auto', padding: '0 24px' }}>
      <h1>Already claimed</h1>
      <p>
        This listing has already been claimed. If you believe this is 
        an error, contact{' '}
        <a href="mailto:annemarie.maidment@gmail.com">
          annemarie.maidment@gmail.com
        </a>.
      </p>
    </main>
  )
}