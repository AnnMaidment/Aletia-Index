/**
 * lib/adminAudit.ts
 *
 * Central helper: every admin mutation calls writeAudit(...) on success.
 *
 * Usage pattern in API routes:
 *
 *   const actor = await getAdminActor(req);   // throws 401 if not admin
 *   // ... perform mutation with supabaseAdmin ...
 *   await writeAudit({
 *     actor,
 *     action: 'queue.accept',
 *     target_table: 'ingestion_review_queue',
 *     target_id: queueId,
 *     payload: { created_device_id: deviceId },
 *     req,
 *   });
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import type { NextRequest } from 'next/server';
import { cookies } from 'next/headers';

// ---------------------------------------------------------------------
// Admin actor resolution
// ---------------------------------------------------------------------

export interface AdminActor {
  user_id: string;
  email: string;
  role: 'admin' | 'super_admin' | 'readonly';
}

/**
 * Resolve the current admin user from the session cookie.
 * Throws if no session or user is not in admin_users table.
 *
 * Call this at the top of every admin API route.
 */
export async function getAdminActor(): Promise<AdminActor> {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name) => cookieStore.get(name)?.value,
        set: () => {},
        remove: () => {},
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new AdminAuthError('Not authenticated', 401);

  // Verify against admin_users using service role (anon can't read that table)
  const admin = getServiceClient();
  const { data, error } = await admin
    .from('admin_users')
    .select('user_id, email, role')
    .eq('user_id', user.id)
    .single();

  if (error || !data) throw new AdminAuthError('Not an admin', 403);

  // Touch last_seen_at (fire and forget)
  admin.from('admin_users')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .then(() => {});

  return data as AdminActor;
}

export class AdminAuthError extends Error {
  constructor(msg: string, public status: number) {
    super(msg);
  }
}

// ---------------------------------------------------------------------
// Audit write
// ---------------------------------------------------------------------

export interface AuditParams {
  actor: AdminActor;
  action: string;
  target_table?: string;
  target_id?: string;
  payload?: Record<string, any>;
  req?: Request | NextRequest;
}

export async function writeAudit(p: AuditParams): Promise<void> {
  const admin = getServiceClient();

  let ip: string | undefined;
  let ua: string | undefined;
  if (p.req) {
    ip =
      p.req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      p.req.headers.get('x-real-ip') ||
      undefined;
    ua = p.req.headers.get('user-agent') ?? undefined;
  }

  const { error } = await admin.from('audit_log').insert({
    actor_user_id: p.actor.user_id,
    actor_email: p.actor.email,
    action: p.action,
    target_table: p.target_table ?? null,
    target_id: p.target_id ?? null,
    payload: p.payload ?? null,
    ip_address: ip ?? null,
    user_agent: ua ?? null,
  });

  // Never throw from audit — we don't want a logging failure to unwind a successful mutation.
  // Surface to console for Vercel log inspection.
  if (error) console.error('[audit_log] write failed:', error.message, { action: p.action });
}

// ---------------------------------------------------------------------
// Service client singleton
// ---------------------------------------------------------------------

let _service: SupabaseClient | null = null;
export function getServiceClient(): SupabaseClient {
  if (_service) return _service;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase admin env vars');
  _service = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _service;
}
