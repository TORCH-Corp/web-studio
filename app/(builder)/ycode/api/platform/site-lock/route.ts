import { noCache } from '@/lib/api-response';
import { getSessionFromCookies, getSiteCookie, getSiteForOrganization, type Site } from '@/lib/platform/site';
import { acquireSiteLock, releaseSiteLock } from '@/lib/platform/site-lock';
import type { BosSession } from '@/lib/platform/session';

/**
 * The open site's editor lock, for the builder (part 1, session 6). The site
 * is the one the signed `ws_site` cookie names, checked against the session's
 * organization, like every builder request.
 *
 *   POST    take the lock if it is free or yours, or refresh it (the builder's
 *           first load and its heartbeat every minute): `{data: {held, holder}}`.
 *           Another user's lock is not an error here: `held: false` and the
 *           holder's name tell the builder to show itself read-only.
 *   DELETE  let go of the lock if it is yours (the builder closing, a sign-out).
 *
 * The proxy's check is manage_content r for both; neither changes a site.
 */
async function openSite(): Promise<{ session: BosSession; site: Site } | { error: Response }> {
  const session = await getSessionFromCookies();
  if (!session) return { error: noCache({ error: 'Not authenticated' }, 401) };
  const cookie = await getSiteCookie();
  const site = cookie && cookie.org === session.org ? await getSiteForOrganization(cookie.site, session.org) : null;
  if (!site) return { error: noCache({ error: 'No site is open' }, 404) };
  return { session, site };
}

export async function POST() {
  const open = await openSite();
  if ('error' in open) return open.error;
  try {
    const { session, site } = open;
    return noCache({ data: await acquireSiteLock(site.id, { id: session.sub, name: session.name || session.email }) });
  } catch (error) {
    console.error('[POST /ycode/api/platform/site-lock]', error);
    return noCache({ error: 'Failed to take the editor lock' }, 500);
  }
}

export async function DELETE() {
  const open = await openSite();
  if ('error' in open) return open.error;
  try {
    return noCache({ data: { released: await releaseSiteLock(open.site.id, open.session.sub) } });
  } catch (error) {
    console.error('[DELETE /ycode/api/platform/site-lock]', error);
    return noCache({ error: 'Failed to release the editor lock' }, 500);
  }
}
