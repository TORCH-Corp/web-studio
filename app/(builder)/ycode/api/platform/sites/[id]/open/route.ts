import { NextRequest, NextResponse } from 'next/server';
import { noCache } from '@/lib/api-response';
import { SITE_COOKIE, cookieAttributes, signSiteCookie } from '@/lib/platform/session';
import { getSessionFromCookies, getSiteForOrganization } from '@/lib/platform/site';
import { mayHoldSiteLock } from '@/lib/platform/permissions';
import { acquireSiteLock } from '@/lib/platform/site-lock';

/**
 * GET /ycode/api/platform/sites/{id}/open (part 1, session 1): open a site in
 * the builder. After checking that the site is a live site of the session's
 * organization, it sets the signed `ws_site` cookie (which lives as long as
 * the session) and sends the browser to /ycode. Any other site is not found.
 *
 * Session 6: opening takes the site's editor lock when it is free or the
 * caller's. When another user holds it the site still opens, read-only: the
 * builder shows the editor's name and the proxy refuses its writes (423).
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookies();
  if (!session) return noCache({ error: 'Not authenticated' }, 401);

  const { id } = await context.params;
  const site = await getSiteForOrganization(id, session.org);
  if (!site) return noCache({ error: 'Site not found' }, 404);

  // A reader opens the site read-only and takes no lock (open question 18).
  if (mayHoldSiteLock(session.perms)) {
    try {
      await acquireSiteLock(site.id, { id: session.sub, name: session.name || session.email });
    } catch (error) {
      console.error('[GET /ycode/api/platform/sites/{id}/open] editor lock', error);
      return noCache({ error: 'Failed to take the editor lock' }, 500);
    }
  }

  const remainingSeconds = Math.max(1, session.exp - Math.floor(Date.now() / 1000));
  const value = await signSiteCookie({ site: site.id, org: session.org }, remainingSeconds);

  // A relative Location keeps the redirect on whatever origin served the request (nginx in front).
  const response = new NextResponse(null, { status: 303, headers: { Location: '/ycode' } });
  response.cookies.set({ name: SITE_COOKIE, value, ...cookieAttributes(request.headers, request.nextUrl), maxAge: remainingSeconds });
  return response;
}
