import { noCache } from '@/lib/api-response';
import { sessionView } from '@/lib/platform/session-view';
import { getSessionFromCookies, getSiteCookie, getSiteForOrganization } from '@/lib/platform/site';

/**
 * GET /ycode/api/auth/session: the Business OS user of this browser, if any,
 * with the organization, the site the builder is on, the Web Studio flags and
 * the role derived from them (part 1, session 2), so the builder can gate its
 * own controls and know when to renew. Public: without a session it says so.
 */
export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) {
    return noCache({ data: { session: null, user: null, organization: null, site: null, permissions: null, role: null, expiresAt: null } });
  }
  const siteCookie = await getSiteCookie();
  const site = siteCookie && siteCookie.org === session.org ? await getSiteForOrganization(siteCookie.site, session.org) : null;
  return noCache({ data: sessionView(session, site) });
}
