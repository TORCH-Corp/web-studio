import type { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { listCategories } from '@/lib/platform/catalogue';
import { sellingSite, storeFailure, storeNotFound } from '@/lib/platform/store-api';

export const dynamic = 'force-dynamic';

/**
 * GET /ycode/api/store/categories (part 2, session W2; OQ 8 and 9): the shop
 * home's categories. The site's chosen categories that are live, in their saved
 * order, or the top-level categories when it chose none; each with what the
 * site sells in it and under it and the first such product's image.
 *
 *   → { data: [{ id, name, name_ar, item_count, first_product_image: url | null }] }
 *
 * A category's link is the products page with ?category={id}, which the grid
 * passes to the products route. Anonymous, on the site's own host only.
 * 404 { code: store_not_found } · 503.
 */
export async function GET(request: NextRequest) {
  try {
    const selling = await sellingSite(request);
    if (!selling) return storeNotFound();
    return noCache({ data: await listCategories(selling.site) });
  } catch (error) {
    return storeFailure(error, 'GET /ycode/api/store/categories');
  }
}
