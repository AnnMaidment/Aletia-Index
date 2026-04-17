/**
 * app/admin/(public)/forbidden/page.tsx
 *
 * Shown when a user is authenticated but not in admin_users.
 * Under (public)/ so it does not inherit the admin shell — avoids
 * the redirect loop that would otherwise happen when a non-admin
 * hits this page (shell layout tries to redirect them here again).
 *
 * Route group parentheses do not affect the URL; this still resolves
 * to /admin/forbidden.
 */

import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function ForbiddenPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--bg, #f5f7fb)',
        padding: 20,
      }}
    >
      <div
        style={{
          background: '#fff',
          border: '1px solid #e6ebf3',
          borderRadius: 10,
          padding: '32px 36px',
          width: 440,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 36, marginBottom: 8 }}>⛔</div>
        <h1 style={{ margin: '0 0 8px', fontSize: 20, color: '#0f172a' }}>
          Admin access required
        </h1>
        <p style={{ color: '#64748b', fontSize: 14, margin: '0 0 20px', lineHeight: 1.5 }}>
          Your account is signed in but not authorised for the Aletia admin portal.
          If you think this is a mistake, contact the project owner.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <Link
            href="/api/admin/logout"
            style={{
              padding: '8px 14px',
              background: '#1f6feb',
              color: '#fff',
              borderRadius: 6,
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            Sign out
          </Link>
          <Link
            href="/"
            style={{
              padding: '8px 14px',
              background: '#fff',
              color: '#0f172a',
              border: '1px solid #e6ebf3',
              borderRadius: 6,
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            Back to site
          </Link>
        </div>
      </div>
    </div>
  );
}
