import type { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { listProducts } from '@/lib/platform/catalogue';
import { sellingSite, storeFailure, storeNotFound } from '@/lib/platform/store-api';
import { parseProductsQuery } from '@/lib/platform/store-query';

export const dynamic = 'force-dynamic';

/**
 * GET /ycode/api/store/products (part 2, session W2; PRD V1.1 "Catalogue"):
 * the products a published site sells, for the product grid. Anonymous, on the
 * site's own host only (lib/platform/store-api.ts); the rules are
 * lib/platform/catalogue-rules.ts, the reads lib/platform/catalogue.ts (kept 60 s
 * per site).
 *
 *   ?category={id}&q=&page=1&page_size=12 (1 to 48; lib/platform/store-query.ts)
 *   → { data: [product], meta: { page, page_size, total } }, by name. A product:
 *     { id, sku, name, name_ar, description, description_ar,
 *       price: { amount, currency, converted, from }, unit: { name, symbol } | null,
 *       images: [{ document_id, url }] (the primary one), category: { id, name, name_ar } | null,
 *       variants: [{ id, sku, price | null, available, unavailable_reason, image, axes }],
 *       axes_summary: [{ id, code, name, name_ar, options }] }
 *
 * 400 { code: invalid_query, details } · 404 { code: store_not_found } (the
 * builder host, no site, or a store that does not sell) · 503 { code:
 * product_services_unavailable | org_setup_unavailable }.
 */
export async function GET(request: NextRequest) {
  try {
    const selling = await sellingSite(request);
    if (!selling) return storeNotFound();
    const parsed = parseProductsQuery(request.nextUrl.searchParams);
    if ('errors' in parsed) return noCache({ error: 'Invalid query', code: 'invalid_query', details: parsed.errors }, 400);
    const { products, total } = await listProducts(selling.site, parsed.query);
    return noCache({ data: products, meta: { page: parsed.query.page, page_size: parsed.query.pageSize, total } });
  } catch (error) {
    return storeFailure(error, 'GET /ycode/api/store/products');
  }
}
