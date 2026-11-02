import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { getSessionFromCookies, getSiteForOrganization } from '@/lib/platform/site';
import { parseSiteAssetsQuery } from '@/lib/platform/site-assets-input';
import { listSiteImages } from '@/lib/platform/site-assets';

/**
 * GET /ycode/api/platform/sites/{id}/assets (part 1, session 10): the images of
 * one site of the session's organization that can be its share image, for the
 * Tauri app's Site settings screen. Drafts, as the builder's asset list shows
 * them; JPEG, PNG, GIF and WebP only. A site of another organization is not
 * found. The permission check is the proxy's: manage_sites r, the same as the
 * settings it serves.
 *
 *   ?search=  part of the file name   ?page=  from 1   ?limit=  1 to 100 (50)
 *   → { data: [{ id, filename, mime_type, width, height }], total, page, limit, has_more }
 *
 * Each image is served by `GET /sites/{id}/assets/{assetId}`.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookies();
  if (!session) return noCache({ error: 'Not authenticated' }, 401);

  const { id } = await context.params;
  const site = await getSiteForOrganization(id, session.org);
  if (!site) return noCache({ error: 'Site not found' }, 404);

  const { query, errors } = parseSiteAssetsQuery(request.nextUrl.searchParams);
  if (!query) return noCache({ error: 'Invalid query', details: errors }, 400);

  try {
    return noCache(await listSiteImages(site, query));
  } catch (error) {
    console.error('[GET /ycode/api/platform/sites/{id}/assets]', error);
    return noCache({ error: 'Failed to list the site\'s images' }, 500);
  }
}
