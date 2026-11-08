import type { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { listProducts } from '@/lib/platform/catalogue';
import { storeFailure } from '@/lib/platform/store-api';
import { openBuilderSite } from '@/lib/platform/store-elements/builder-site';

export const dynamic = 'force-dynamic';

/** Products a picker lists at once. */
const PICKER_PAGE_SIZE = 20;

/**
 * GET /ycode/api/platform/store-elements/products?q=&page=1 (part 2, session
 * W4): the products a product card's settings can pick, for the site the
 * builder has open, by name, 20 a page. They are the products the site sells
 * (the catalogue rules of lib/platform/catalogue-rules.ts), whether or not the
 * store is switched on yet. manage_content r (the proxy).
 *
 *   → { data: [{ id, sku, name, name_ar }], meta: { page, total } }
 *
 * 401 · 404 no site is open · 400 a page that is not a whole number from 1 ·
 * 503 { code } a service cannot be asked.
 */
export async function GET(request: NextRequest) {
  const open = await openBuilderSite();
  if ('error' in open) return noCache({ error: open.error }, open.status);

  const rawPage = request.nextUrl.searchParams.get('page') ?? '1';
  const page = /^\d{1,6}$/.test(rawPage) ? Number(rawPage) : 0;
  if (page < 1) return noCache({ error: 'page must be a whole number from 1' }, 400);
  const search = (request.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 200);

  try {
    const { products, total } = await listProducts(open.site, { search: search || null, page, pageSize: PICKER_PAGE_SIZE });
    return noCache({
      data: products.map(({ id, sku, name, name_ar }) => ({ id, sku, name, name_ar })),
      meta: { page, total },
    });
  } catch (error) {
    return storeFailure(error, 'GET /ycode/api/platform/store-elements/products');
  }
}
