/**
 * What the sitemap says about the store (part 2 release fixes, OPEN_QUESTIONS
 * 45). The page with the product role answers 404 at its own address (it needs
 * an item), so it is not listed; each product the store sells is, at the page's
 * address and the item's id, in every language, with the same hreflang cluster
 * every other page has.
 *
 * Kept free of Next and React imports so it runs under `node --test`.
 */

import { DEFAULT_PATH_KEY, canHaveStoreRole, storeKindOf } from '@/lib/platform/store-elements/pages';
import { expandToPerLocaleSitemapUrls, type SitemapUrl } from '@/lib/sitemap-utils';
import { buildAbsolutePageUrl } from '@/lib/url-utils';
import type { HreflangAlternate } from '@/lib/hreflang-utils';
import type { Locale, Page, SitemapChangeFrequency } from '@/types';

/** The pages the sitemap lists: every page but the one(s) with the product role, whose bare address is a 404. */
export function pagesForSitemap(pages: Page[]): Page[] {
  return pages.filter((page) => !(storeKindOf(page) === 'product' && canHaveStoreRole(page)));
}

/**
 * One entry per product and language. `paths` is the product page's path per
 * language as the publish stores it (`StorePagePaths.product`: the default
 * under `*`, another language under its code with the prefix in the path); a
 * language with none has the default path under its code, as every page of it
 * does. No paths, no product page, no entries.
 */
export function productSitemapUrls(input: {
  baseUrl: string;
  productIds: string[];
  paths: Record<string, string> | undefined;
  locales: Array<Pick<Locale, 'code' | 'is_default'>>;
  changefreq?: SitemapChangeFrequency;
}): SitemapUrl[] {
  const { baseUrl, productIds, paths, locales, changefreq } = input;
  const base = paths?.[DEFAULT_PATH_KEY];
  if (!base) return [];
  const defaultLocale = locales.find((locale) => locale.is_default);
  const others = locales.filter((locale) => !locale.is_default);

  const urls: SitemapUrl[] = [];
  for (const id of productIds) {
    const href = (path: string) => buildAbsolutePageUrl(baseUrl, `${path}/${id}`);
    const defaultUrl = href(base);
    // The same cluster as buildPageHreflangAlternates: the default language, the others, x-default; none for one language.
    const alternates: HreflangAlternate[] =
      locales.length <= 1
        ? []
        : [
          ...(defaultLocale ? [{ hreflang: defaultLocale.code, href: defaultUrl }] : []),
          ...others.map((locale) => ({ hreflang: locale.code, href: href(paths[locale.code] ?? `/${locale.code}${base}`) })),
          { hreflang: 'x-default', href: defaultUrl },
        ];
    urls.push(...expandToPerLocaleSitemapUrls(defaultUrl, undefined, changefreq, alternates));
  }
  return urls;
}
