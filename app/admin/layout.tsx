/**
 * app/admin/layout.tsx
 *
 * Root layout for the entire /admin tree. Intentionally minimal:
 * its only job is to load admin.css for every admin page (public and
 * protected alike).
 *
 * Auth + the visual shell (sidebar, badges, signout) live in
 * app/admin/(protected)/layout.tsx — they apply only to routes inside
 * the (protected) route group.
 *
 * Public admin routes (login, forbidden) live under (public)/ and
 * inherit only this root layout, so they render without the sidebar.
 */

import './admin.css';

export const dynamic = 'force-dynamic';

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
