import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/platform/session';
import { getSessionFromCookies, getSiteCookie } from '@/lib/platform/site';
import { releaseSiteLock } from '@/lib/platform/site-lock';

/**
 * POST /ycode/api/auth/logout — ends the Business OS session in this browser,
 * and lets go of the editor lock the user held on the site they had open
 * (part 1, session 6). A lock that cannot be released lapses by itself after
 * 15 minutes, so a failure here is logged and does not keep the user signed in.
 */
export async function POST() {
  const session = await getSessionFromCookies();
  const site = await getSiteCookie();
  if (session && site && site.org === session.org) {
    try {
      await releaseSiteLock(site.site, session.sub);
    } catch (error) {
      console.error('[POST /ycode/api/auth/logout] editor lock', error);
    }
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set({ name: SESSION_COOKIE, value: '', path: '/', maxAge: 0 });
  return response;
}
