/**
 * Where the store elements link (part 2: the conventional paths in session W4,
 * the page-role lookup in W5).
 *
 * A card opens the page with the `product` role, and the cart indicator and the
 * "added" notice lead to the page with the `cart` role, the cart's Checkout
 * button to the page with the `checkout` role, and a placed order to the page
 * with the `confirmation` role (lib/platform/store-elements/pages.ts; the
 * paths are what the publish wrote). With no page that has the product role
 * a card falls back to the conventional `/product/{id}` (owner, W5 grill-me,
 * 8 Nov 2026); the cart and the checkout have no convention to fall back to,
 * and link to "#" until a page has the role; the confirmation has none either,
 * and the checkout then shows the order itself (W6).
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

/**
 * The language a published page is in, for its store elements. The renderer names a page's locale only when the
 * page is under a language's prefix: a page in the site's default language has none, and is in the default one
 * (an Arabic-first site's root is Arabic). Null when the site has no locales to tell.
 */
export function pageLocaleOf<L extends LinkLocale>(current: L | null | undefined, available: readonly L[] | null | undefined): L | null {
  return current ?? available?.find((locale) => locale.is_default) ?? null;
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
  checkout(): string;
  /** The confirmation page of a checkout (`…?order={checkout id}`); null when no page has the confirmation role. */
  confirmation(checkoutId: string): string | null;
  products(): string;
  /** The products page listing one category (`…?category={id}`, which the product grid reads): a category card, the breadcrumb's category. */
  category(categoryId: string): string;
}

export function createStoreLinks(locale: LinkLocale | null | undefined, paths: StorePagePaths): StoreLinks {
  return {
    product: (productId) => `${pathFor(paths, 'product', locale) ?? `${localePrefix(locale)}/product`}/${encodeURIComponent(productId)}`,
    cart: () => pathFor(paths, 'cart', locale) ?? '#',
    checkout: () => pathFor(paths, 'checkout', locale) ?? '#',
    confirmation: (checkoutId) => {
      const path = pathFor(paths, 'confirmation', locale);
      return path === null ? null : `${path}?order=${encodeURIComponent(checkoutId)}`;
    },
    products: () => productsHref(locale),
    category: (categoryId) => `${productsHref(locale)}?category=${encodeURIComponent(categoryId)}`,
  };
}
