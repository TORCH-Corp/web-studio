import { noCache } from '@/lib/api-response';
import { listCategories } from '@/lib/platform/catalogue';
import { storeFailure } from '@/lib/platform/store-api';
import { openBuilderSite } from '@/lib/platform/store-elements/builder-site';

export const dynamic = 'force-dynamic';

/**
 * GET /ycode/api/platform/store-elements/categories (part 2, session W4): the
 * categories a product grid's settings can list, for the site the builder has
 * open: the site's store categories (or the top level when it chose none), each
 * with what it sells in it. Whether the store is switched on does not matter
 * here: a site is built before it sells. manage_content r (the proxy).
 *
 *   → { data: [{ id, name, name_ar, item_count }] }
 *
 * 401 · 404 no site is open · 503 { code } a service cannot be asked.
 */
export async function GET() {
  const open = await openBuilderSite();
  if ('error' in open) return noCache({ error: open.error }, open.status);
  try {
    const categories = await listCategories(open.site);
    return noCache({ data: categories.map(({ id, name, name_ar, item_count }) => ({ id, name, name_ar, item_count })) });
  } catch (error) {
    return storeFailure(error, 'GET /ycode/api/platform/store-elements/categories');
  }
}
