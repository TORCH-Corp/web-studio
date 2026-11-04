import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { SITE_COOKIE } from '@/lib/platform/session';
import { getSessionFromCookies, getSiteCookie, getSiteForOrganization, getSiteSummary, softDeleteSite } from '@/lib/platform/site';
import { getSiteLock } from '@/lib/platform/site-lock';

/**
 * GET /ycode/api/platform/sites/{id} (part 1, session 6): one live site of the
 * session's organization, as the sites list shows it, with its editor lock:
 * `lock` is null when nobody has the site open, otherwise `{holder, user_id,
 * since, held_by_you}` (a lock whose heartbeat is older than 15 minutes is
 * free, so it is null). The Tauri app shows it in All sites. The permission
 * check is the proxy's: manage_sites r.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookies();
  if (!session) return noCache({ error: 'Not authenticated' }, 401);

  const { id } = await context.params;
  try {
    const site = await getSiteSummary(id, session.org);
    if (!site) return noCache({ error: 'Site not found' }, 404);
    const holder = await getSiteLock(site.id);
    const lock = holder
      ? { holder: holder.name, user_id: holder.user_id, since: holder.since, held_by_you: holder.user_id === session.sub }
      : null;
    return noCache({ data: { ...site, lock } });
  } catch (error) {
    console.error('[GET /ycode/api/platform/sites/{id}]', error);
    return noCache({ error: 'Failed to load site' }, 500);
  }
}

/**
 * DELETE /ycode/api/platform/sites/{id} (part 1, session 1): soft-delete a site
 * of the session's organization. It leaves All sites and its hosts stop
 * resolving; its rows stay in the database. A site of another organization
 * is not found. The permission check is the proxy's: manage_sites d.
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
