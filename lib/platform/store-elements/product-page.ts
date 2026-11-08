/**
 * What the server reads for a product page and writes at publish (part 2,
 * session W5; PRD V1.1 "Store elements and sections").
 *
 * A request for `/{product page}/{itemId}` is answered by `fetchPageByPath`
 * (lib/page-fetcher.ts), which asks `readProductPage` for the item and injects
 * the answer as the page's data, next to the collection pages' items. The page
 * is cached per item with the tenant's tags for 60 seconds, the catalogue's own
 * time (owner, W5 grill-me, 8 Nov 2026): a product put on sale, repriced or
 * gone shows within a minute, and a 404 for an item that was not on sale does
 * not stay.
 *
 * The publish writes `store_pages` (where the page with each role lives, per
 * language) once, with `publishStorePages`; the page renderer hands it to the
 * elements, so no link is looked up per click or per view.
 */

import { getProduct } from '@/lib/platform/catalogue';
import { getAllLocales } from '@/lib/repositories/localeRepository';
import { getAllPageFolders } from '@/lib/repositories/pageFolderRepository';
import { getAllPages } from '@/lib/repositories/pageRepository';
import { getSettingByKey, setSetting } from '@/lib/repositories/settingsRepository';
import { getSite, resolveSiteId } from '@/lib/platform/site';
import { isStoreUnavailable } from '@/lib/platform/store-api';
import { storeOf } from '@/lib/platform/store-settings';
import {
  computeStorePagePaths,
  parseStorePagePaths,
  samePaths,
  storeKindOf,
  STORE_PAGES_SETTING,
  type ProductPageState,
  type StorePagePaths,
} from '@/lib/platform/store-elements/pages';
import type { Translation } from '@/types';

/**
 * The item a product page's address names, as the site's catalogue has it now. Null when the site's store does not
 * sell (the product page then answers the site's own not-found page, like the cart and checkout pages, PRD V1.1
 * "Store settings"). `itemId` is null for an address whose last segment is not an item id.
 */
export async function readProductPage(tenantId: string | undefined, itemId: string | null): Promise<ProductPageState | null> {
  const siteId = tenantId ?? (await resolveSiteId());
  if (!siteId) return null;
  const site = await getSite(siteId);
  if (!site || site.is_template) return null;
  if (!(await storeOf(site.id)).selling) return null;
  if (!itemId) return { kind: 'gone', item_id: null };
  try {
    const product = await getProduct(site, itemId);
    return product ? { kind: 'found', product } : { kind: 'gone', item_id: itemId };
  } catch (error) {
    // Only a service that cannot be asked is a state of the page; anything else is a bug and is not hidden.
    if (!isStoreUnavailable(error)) throw error;
    console.error(`[store] the catalogue could not be read for the product page of ${itemId}: ${(error as Error).message}`);
    return { kind: 'unknown', item_id: itemId };
  }
}

/** Where the pages with a store role live, as the last publish wrote it. */
export async function readStorePagePaths(): Promise<StorePagePaths> {
  return parseStorePagePaths(await getSettingByKey(STORE_PAGES_SETTING));
}

/**
 * Writes `store_pages` from the published pages: where the page with each role lives, in each published language.
 * Returns whether it changed. A change must render every page again, because every page with a store element
 * carries the old paths (the publish route turns it into a full invalidation).
 */
export async function publishStorePages(): Promise<boolean> {
  const [pages, folders, locales] = await Promise.all([
    getAllPages({ is_published: true }),
    getAllPageFolders({ is_published: true }),
    getAllLocales(true),
  ]);

  // The translated slugs are read only for a site that has a page with a role.
  const translations = new Map<string, Record<string, Translation>>();
  if (pages.some((page) => storeKindOf(page))) {
    // Imported here: lib/page-fetcher.ts imports this module's read, so a top-level import would be a cycle.
    const { loadTranslationsForLocale } = await import('@/lib/page-fetcher');
    for (const locale of locales) {
      if (!locale.is_default) translations.set(locale.code, (await loadTranslationsForLocale(locale.code, true)).translations);
    }
  }

  const paths = computeStorePagePaths({ pages, folders, locales, translationsFor: (code) => translations.get(code) });
  const stored = parseStorePagePaths(await getSettingByKey(STORE_PAGES_SETTING));
  if (samePaths(paths, stored)) return false;
  await setSetting(STORE_PAGES_SETTING, paths);
  return true;
}
