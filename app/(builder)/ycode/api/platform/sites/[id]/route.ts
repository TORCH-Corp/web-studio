import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { SITE_COOKIE } from '@/lib/platform/session';
import { getSessionFromCookies, getSiteCookie, getSiteForOrganization, softDeleteSite } from '@/lib/platform/site';

/**
 * DELETE /ycode/api/platform/sites/{id} (part 1, session 1): soft-delete a site
 * of the session's organization. It leaves All sites and its hosts stop
 * resolving; its rows stay in the database. A site of another organization
 * is not found. Session 2 adds the permission check (manage_sites d).
 */
export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookies();
  if (!session) return noCache({ error: 'Not authenticated' }, 401);

  const { id } = await context.params;
  const site = await getSiteForOrganization(id, session.org);
  if (!site) return noCache({ error: 'Site not found' }, 404);

  try {
    await softDeleteSite(site.id);
  } catch (error) {
    console.error('[DELETE /ycode/api/platform/sites/{id}]', error);
    return noCache({ error: 'Failed to delete site' }, 500);
  }

  const response = noCache({ data: { id: site.id, deleted: true } });
  const current = await getSiteCookie();
  if (current?.site === site.id) {
    response.cookies.set({ name: SITE_COOKIE, value: '', path: '/', maxAge: 0 });
  }
  return response;
}
