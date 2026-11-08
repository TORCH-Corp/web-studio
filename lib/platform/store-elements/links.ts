/**
 * Where the store elements link (part 2: the conventional paths in session W4,
 * the page-role lookup in W5).
 *
 * A card opens the page with the `product` role, and the cart indicator and the
 * "added" notice lead to the page with the `cart` role (lib/platform/store-elements/pages.ts;
 * the paths are what the publish wrote). With no page that has the product role
 * a card falls back to the conventional `/product/{id}` (owner, W5 grill-me,
 * 8 Nov 2026); the cart has no convention to fall back to, and links to "#"
 * until a page has the cart role (W6 offers it).
 *
 * A page in a language that is not the site's default lives under that
 * language's code, and so do the store links of the pages in it.
 *
 * Kept free of Next and React imports so it runs under `node --test`.
 */

import { pathFor, type StorePagePaths } from '@/lib/platform/store-elements/pages';

export interface LinkLocale {
  code: string;
  is_default?: boolean;
}

/** `/ar` for a non-default locale, `` for the default one or none. */
export function localePrefix(locale: LinkLocale | null | undefined): string {
  return locale && !locale.is_default && locale.code ? `/${locale.code}` : '';
}

/** Where "View all" of a section goes: the products page. */
export function productsHref(locale?: LinkLocale | null): string {
  return `${localePrefix(locale)}/products`;
}

/** The links one store element writes, for its page's language and the site's store pages. */
export interface StoreLinks {
  product(productId: string): string;
  cart(): string;
  products(): string;
}

export function createStoreLinks(locale: LinkLocale | null | undefined, paths: StorePagePaths): StoreLinks {
  return {
    product: (productId) => `${pathFor(paths, 'product', locale) ?? `${localePrefix(locale)}/product`}/${encodeURIComponent(productId)}`,
    cart: () => pathFor(paths, 'cart', locale) ?? '#',
    products: () => productsHref(locale),
  };
}
