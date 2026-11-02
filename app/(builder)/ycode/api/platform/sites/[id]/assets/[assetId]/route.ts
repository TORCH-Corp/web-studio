import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { getAssetProxyUrl, getInlineSvgAssetUrl } from '@/lib/asset-utils';
import { getAssetById } from '@/lib/repositories/assetRepository';
import { getSessionFromCookies, getSiteForOrganization, runWithSite } from '@/lib/platform/site';
import { isValidUUID } from '@/lib/utils';
import { GET as serveAsset } from '@/app/a/[hash]/[...name]/route';

const RESIZE_PARAMS = ['width', 'height', 'quality'];

/**
 * GET /ycode/api/platform/sites/{id}/assets/{assetId} (part 1, session 10): one
 * image of a site of the session's organization, for the Tauri app's Site
 * settings screen (the share image and the picker's thumbnails). `?width=`,
 * `?height=` and `?quality=` resize it as `/a/` does.
 *
 * `/a/{hash}/{name}` finds an asset only for the site the request resolves to
 * (the `ws_site` cookie in the builder, the host on a published page), and the
 * app has neither. So this route checks the image is the site's and hands the
 * request to ycode's `/a/` handler with the site set: storage, resizing and
 * the SVG headers stay ycode's. The permission check is the proxy's:
 * manage_sites r. Not an image of this site is 404.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string; assetId: string }> }) {
  const session = await getSessionFromCookies();
  if (!session) return noCache({ error: 'Not authenticated' }, 401);

  const { id, assetId } = await context.params;
  const site = await getSiteForOrganization(id, session.org);
  if (!site) return noCache({ error: 'Site not found' }, 404);
  if (!isValidUUID(assetId)) return noCache({ error: 'Image not found' }, 404);

  return runWithSite(site.id, async () => {
    const asset = await getAssetById(assetId, false);
    if (!asset || !asset.mime_type.startsWith('image/')) return noCache({ error: 'Image not found' }, 404);

    // The canonical `/a/` URL (an inline SVG's carries its version), so the
    // handler serves the image instead of redirecting to it; plus the resize.
    const target = new URL(asset.storage_path ? getAssetProxyUrl(asset)! : getInlineSvgAssetUrl(asset), request.nextUrl.origin);
    for (const key of RESIZE_PARAMS) {
      const value = request.nextUrl.searchParams.get(key);
      if (value !== null) target.searchParams.set(key, value);
    }
    const [hash, ...name] = target.pathname.split('/').slice(2);
    return serveAsset(new NextRequest(target, { headers: request.headers }), { params: Promise.resolve({ hash, name }) });
  });
}
