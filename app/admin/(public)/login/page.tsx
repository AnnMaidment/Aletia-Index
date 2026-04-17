/**
 * app/admin/login/page.tsx
 *
 * Invite-only admin login. No sign-up, no password reset UI here — admins
 * are created via Supabase Auth dashboard + insertion into admin_users.
 *
 * Public route (middleware skips /admin/login).
 */

'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';

function LoginInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get('next') || '/admin';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInErr) {
      setError('Sign in failed. Check your credentials.');
      setLoading(false);
      return;
    }

    // Middleware will re-check admin_users on the next request; if the user
    // is authenticated but not in admin_users they'll be bounced to /admin/forbidden.
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="admin-login-wrap">
      <form className="admin-login-card" onSubmit={onSubmit}>
        <h1>Aletia Admin</h1>
        <p>Invite-only access. Contact the project owner if you need an account.</p>

        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button type="submit" className="btn primary" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>

        {error && <div className="admin-login-error">{error}</div>}
      </form>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<div className="admin-login-wrap">Loading…</div>}>
      <LoginInner />
    </Suspense>
  );
}
