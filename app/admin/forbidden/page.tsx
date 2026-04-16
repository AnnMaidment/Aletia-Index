/**
 * app/admin/forbidden/page.tsx
 *
 * Shown when a user is authenticated but not in admin_users.
 */

export default function Forbidden() {
  return (
    <div className="admin-login-wrap">
      <div className="admin-login-card" style={{ textAlign: 'center' }}>
        <h1>No admin access</h1>
        <p>
          Your account is signed in but does not have admin permissions.
          If this is a mistake, contact the project owner.
        </p>
        <form action="/api/admin/logout" method="post" style={{ marginTop: 16 }}>
          <button className="btn" type="submit">Sign out</button>
        </form>
      </div>
    </div>
  );
}
