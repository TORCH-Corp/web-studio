/**
 * Route-handler auth client (c0 port).
 *
 * The few routes that used a cookie-bound Supabase client to read or end the
 * session get the same two calls backed by the Business OS session cookie.
 */

import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySession } from '@/lib/platform/session';
import { sessionView } from '@/lib/platform/session-view';

export async function createRouteClient() {
  const cookieStore = await cookies();
  return {
    auth: {
      async getSession() {
        const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value);
        if (!session) return { data: { session: null }, error: null };
        return { data: { session: sessionView(session, null).session }, error: null };
      },
      async signOut() {
        cookieStore.set({ name: SESSION_COOKIE, value: '', path: '/', maxAge: 0 });
        return { error: null };
      },
      async exchangeCodeForSession() {
        return { error: { message: 'Sign-in happens in Business OS, not in Web Studio' } };
      },
    },
  };
}
