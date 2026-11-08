/**
 * What the builder is told about its session (part 1, session 2): the answer
 * of GET /ycode/api/auth/session and of the callback when the browser calls it
 * for a renewal. `session` and `user` keep the supabase-js shape ycode's auth
 * store reads; the rest is Business OS: the organization, the site the builder
 * is on, the Web Studio flags, the role derived from them, and when the cookie
 * runs out.
 */

import type { Session, User } from '@/lib/platform/types';
import { hasSalesOrdersExecute, roleFromPermissions, type BosSession } from './session';
import type { Site } from './site';
import { userFromSession } from '@/lib/supabase-auth';

export interface SessionView {
  session: Session;
  user: User;
  organization: string;
  site: { id: string; name: string; slug: string } | null;
  permissions: BosSession['perms'];
  /** The user's x flag on Sales's sales.manage_orders, read at sign-in (part 2, session W8). */
  sales_manage_orders_x: boolean;
  role: ReturnType<typeof roleFromPermissions>;
  /** Unix seconds: when the bos_session cookie expires (the access token's expiry). */
  expiresAt: number;
}

export function sessionView(session: BosSession, site: Site | null): SessionView {
  const user = userFromSession(session);
  return {
    session: {
      user,
      access_token: 'business-os',
      token_type: 'bearer',
      expires_at: session.exp,
      expires_in: Math.max(0, session.exp - Math.floor(Date.now() / 1000)),
      refresh_token: '',
    } as Session,
    user,
    organization: session.org,
    site: site ? { id: site.id, name: site.name, slug: site.slug } : null,
    permissions: session.perms,
    sales_manage_orders_x: hasSalesOrdersExecute(session),
    role: roleFromPermissions(session.perms),
    expiresAt: session.exp,
  };
}
