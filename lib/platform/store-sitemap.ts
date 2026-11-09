/**
 * The store's part of a site's sitemap.xml (part 2 release fixes,
 * OPEN_QUESTIONS 45): one entry per product the site sells, at the product
 * page's address and the item's id, in every language. The rules are
 * lib/platform/store-elements/product-sitemap.ts; this reads what they need.
 *
 * A site whose store does not sell, or that has no page with the product role,
 * or whose product page is `noindex`, lists no products. The catalogue is the
 * one every page reads (kept 60 seconds per site); when it cannot be read this
 * throws the service's own error, and the route answers 503 rather than a
 * sitemap that quietly lacks the products.
 */

import { siteCatalogue } from '@/lib/platform/catalogue';
import { getSite } from '@/lib/platform/site';
import { computeStorePagePaths, pageForRole } from '@/lib/platform/store-elements/pages';
import { productSitemapUrls } from '@/lib/platform/store-elements/product-sitemap';
import { storeOf } from '@/lib/platform/store-settings';
import type { SitemapUrl } from '@/lib/sitemap-utils';
import type { Locale, Page, PageFolder, SitemapChangeFrequency, Translation } from '@/types';

export async function storeSitemapUrls(input: {
  siteId: string;
  baseUrl: string;
  /** The published, live pages, the product page among them. */
  pages: Page[];
  folders: PageFolder[];
  locales: Locale[];
  /** The slug translations of each non-default locale, by the locale's id. */
  translationsByLocale: Map<string, Record<string, Translation>>;
  changefreq?: SitemapChangeFrequency;
}): Promise<SitemapUrl[]> {
  const { siteId, baseUrl, pages, folders, locales, translationsByLocale, changefreq } = input;
  const productPage = pageForRole(pages, 'product');
  if (!productPage || productPage.settings?.seo?.noindex) return [];

  const site = await getSite(siteId);
  if (!site || site.is_template || !(await storeOf(site.id)).selling) return [];

  const paths = computeStorePagePaths({
    pages,
    folders,
    locales,
    translationsFor: (code) => {
      const locale = locales.find((candidate) => candidate.code === code);
      return locale ? translationsByLocale.get(locale.id) : undefined;
    },
  });
  const catalogue = await siteCatalogue(site);
  return productSitemapUrls({ baseUrl, productIds: catalogue.products.map((product) => product.id), paths: paths.product, locales, changefreq });
}
