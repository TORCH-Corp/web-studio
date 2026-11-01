import { NextRequest, NextResponse } from 'next/server';
import { noCache } from '@/lib/api-response';
import { SITE_COOKIE, signSiteCookie } from '@/lib/platform/session';
import { getSessionFromCookies, getSiteForOrganization } from '@/lib/platform/site';

/**
 * GET /ycode/api/platform/sites/{id}/open (part 1, session 1): open a site in
 * the builder. After checking that the site is a live site of the session's
 * organization, it sets the signed `ws_site` cookie (which lives as long as
 * the session) and sends the browser to /ycode. Any other site is not found.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookies();
  if (!session) return noCache({ error: 'Not authenticated' }, 401);

  const { id } = await context.params;
  const site = await getSiteForOrganization(id, session.org);
  if (!site) return noCache({ error: 'Site not found' }, 404);

  const remainingSeconds = Math.max(1, session.exp - Math.floor(Date.now() / 1000));
  const value = await signSiteCookie({ site: site.id, org: session.org }, remainingSeconds);

  // A relative Location keeps the redirect on whatever origin served the request (nginx in front).
  const response = new NextResponse(null, { status: 303, headers: { Location: '/ycode' } });
  response.cookies.set({ name: SITE_COOKIE, value, path: '/', httpOnly: true, sameSite: 'lax', maxAge: remainingSeconds });
  return response;
}
