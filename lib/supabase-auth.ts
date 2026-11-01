/**
 * Server-side auth (c0 port): the current Business OS user.
 *
 * ycode's route handlers call `getAuthUser()` and read `user.id`,
 * `user.email` and `user.app_metadata.role`. The user now comes from the
 * Business OS session cookie; the role is derived from the Web Studio
 * permission flags in that session (see lib/platform/session.ts).
 */

import type { SupabaseClient, User } from '@/lib/platform/types';
import { getSessionFromCookies } from '@/lib/platform/site';
import { roleFromPermissions, type BosSession } from '@/lib/platform/session';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export interface AuthResult {
  user: User;
  client: SupabaseClient;
  session: BosSession;
}

export function userFromSession(session: BosSession): User {
  const now = new Date().toISOString();
  return {
    id: session.sub,
    email: session.email,
    aud: 'business-os',
    role: 'authenticated',
    app_metadata: { role: roleFromPermissions(session.perms), organization_id: session.org, permissions: session.perms },
    user_metadata: { name: session.name, full_name: session.name },
    created_at: now,
    updated_at: now,
    identities: [],
    factors: [],
  } as unknown as User;
}

export async function getAuthUser(): Promise<AuthResult | null> {
  const session = await getSessionFromCookies();
  if (!session) return null;
  if (!roleFromPermissions(session.perms)) return null; // no Web Studio permission at all
  // Scoped to the site the builder is working on (the ws_site cookie), not to the organization.
  const client = await getSupabaseAdmin();
  if (!client) return null;
  return { user: userFromSession(session), client, session };
}
