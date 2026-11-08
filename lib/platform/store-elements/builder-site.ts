/**
 * The site the builder has open, for the routes the store elements' settings
 * call (part 2, session W4): the picker of a product grid's categories and of a
 * product card's product. The session and the `ws_site` cookie say which site;
 * a cookie for another organization's site is no site. The permission check
 * (manage_content) is the proxy's, lib/platform/permissions.ts.
 */

import { getSessionFromCookies, getSiteCookie, getSiteForOrganization, type Site } from '@/lib/platform/site';

export type BuilderSite = { site: Site } | { status: 401 | 404; error: string };

export async function openBuilderSite(): Promise<BuilderSite> {
  const session = await getSessionFromCookies();
  if (!session) return { status: 401, error: 'Not authenticated' };
  const cookie = await getSiteCookie();
  if (!cookie || cookie.org !== session.org) return { status: 404, error: 'No site is open' };
  const site = await getSiteForOrganization(cookie.site, session.org);
  return site ? { site } : { status: 404, error: 'No site is open' };
}
