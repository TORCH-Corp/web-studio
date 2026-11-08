import { NextResponse, type NextRequest } from 'next/server';
import { storeImage } from '@/lib/platform/catalogue';
import { sellingSite, storeFailure } from '@/lib/platform/store-api';
import { isUuid } from '@/lib/platform/store-query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A day: the copy is checked against Document Center once a day (lib/platform/store-media.ts), so a browser keeps it as long. */
const CACHE_CONTROL = 'public, max-age=86400';

const notFound = () => new NextResponse('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });

/** Whether an If-None-Match header names this entity tag (weak or strong, one of a list, or `*`). */
function matches(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header.split(',').some((tag) => {
    const value = tag.trim();
    return value === '*' || value === etag || value === `W/${etag}`;
  });
}

/**
 * GET /store-media/{documentId}?item={productId} (part 2, session W2; PRD V1.1
 * "Catalogue", OQ 1): an image of a product the site sells, under the site's
 * own host. The bytes are a Document Center document of the organization,
 * fetched once with Web Studio's DOCUMENT_CENTER_API_KEY and kept on disk
 * (lib/platform/store-media.ts), so Document Center is not called per view. The
 * catalogue's image URLs carry the product, which says which images may be
 * served: the product's, its variants', its gallery's; any other document of
 * the organization is not found. A store that does not sell, the builder host,
 * and an unknown host answer 404.
 *
 * 200 with the image, `cache-control: public, max-age=86400`, the sha256 as its
 * ETag (304 on If-None-Match) · 404 · 503 { code } when Product & Services (to
 * check the product) or Document Center (an image not kept yet) cannot be asked.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ documentId: string }> }) {
  try {
    const { documentId } = await context.params;
    const productId = request.nextUrl.searchParams.get('item');
    if (!isUuid(documentId) || !isUuid(productId)) return notFound();
    const selling = await sellingSite(request);
    if (!selling) return notFound();
    const file = await storeImage(selling.site, productId.toLowerCase(), documentId.toLowerCase());
    if (!file) return notFound();

    const etag = `"${file.meta.sha256}"`;
    const headers = { etag, 'cache-control': CACHE_CONTROL, 'x-content-type-options': 'nosniff' };
    if (matches(request.headers.get('if-none-match'), etag)) return new NextResponse(null, { status: 304, headers });
    return new NextResponse(new Uint8Array(file.data), {
      headers: { ...headers, 'content-type': file.meta.contentType, 'content-length': String(file.data.length) },
    });
  } catch (error) {
    return storeFailure(error, 'GET /store-media/{documentId}');
  }
}
