import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { listSiteCollections } from '@/lib/platform/collections';
import { hasFlag } from '@/lib/platform/session';
import { getSessionFromCookies, getSiteForOrganization } from '@/lib/platform/site';

/**
 * GET /ycode/api/platform/sites/{id}/collections (part 3, session W6; PRD V1.0
 * "Collections"): the collections of one site of the session's organization,
 * for the Tauri app's Collections screen. The draft rows that are not deleted,
 * in the builder's own order. A site of another organization, or one that does
 * not exist, is not found. The permission check is the proxy's:
 * `webstudio.manage_content` r (lib/platform/permissions.ts).
 *
 *   → { data: [{ id, name, item_count, last_change, builder_path }], can_change }
 *     item_count    the collection's items that are not deleted
 *     last_change   ISO date: the latest change of the collection and of its items; no person, the fork records none
 *     builder_path  the builder's route for the collection (`/ycode/collections/{id}`), on the site the app opened
 *     can_change    whether the user holds `webstudio.manage_content` u: the app shows "Open in builder" when it
 *                   is true and the read-only note when it is not (the builder itself refuses a reader's writes)
 *
 * Creating and editing a collection is done in the builder; there is no write here.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookies();
  if (!session) return noCache({ error: 'Not authenticated' }, 401);

  const { id } = await context.params;
  const site = await getSiteForOrganization(id, session.org);
  if (!site) return noCache({ error: 'Site not found' }, 404);

  try {
    const data = await listSiteCollections(site);
    return noCache({ data, can_change: hasFlag(session, 'webstudio.manage_content', 'u') });
  } catch (error) {
    console.error('[GET /ycode/api/platform/sites/{id}/collections]', error);
    return noCache({ error: 'Failed to list the site\'s collections' }, 500);
  }
}
