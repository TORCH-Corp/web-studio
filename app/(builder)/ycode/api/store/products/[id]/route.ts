import type { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { getProduct } from '@/lib/platform/catalogue';
import { sellingSite, storeFailure, storeNotFound } from '@/lib/platform/store-api';
import { isUuid } from '@/lib/platform/store-query';

export const dynamic = 'force-dynamic';

/**
 * GET /ycode/api/store/products/{id} (part 2, session W2): one product a
 * published site sells, for the product page, with every image it has and
 * every variant, the ones that cannot be bought marked `available: false` with
 * the reason (inactive, no_price, no_rate). The shape is the list's
 * (`../route.ts`). Anonymous, on the site's own host only.
 *
 * 404 { code: product_not_found }: not an item the site sells now (a variant's
 * own id, an item without a price, outside the site's categories, a product
 * none of whose variants can be bought) · 404 { code: store_not_found } · 503.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const selling = await sellingSite(request);
    if (!selling) return storeNotFound();
    const { id } = await context.params;
    const product = isUuid(id) ? await getProduct(selling.site, id.toLowerCase()) : null;
    if (!product) return noCache({ error: 'This product is not on sale', code: 'product_not_found' }, 404);
    return noCache({ data: product });
  } catch (error) {
    return storeFailure(error, 'GET /ycode/api/store/products/{id}');
  }
}
