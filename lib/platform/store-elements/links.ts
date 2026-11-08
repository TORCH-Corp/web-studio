/**
 * Where the store elements link (part 2, session W4).
 *
 * Until the pages carry store roles (W5: product, W6: cart and checkout) the
 * links are the conventional paths the templates use (owner, W4 grill-me,
 * 8 Nov 2026): a product at `/product/{id}`, the cart at `/cart`. W5 and W6
 * replace this module's bodies with the lookup of "the page with role X",
 * resolved when the site is published; the elements only call these functions.
 * A page in a language that is not the site's default lives under that
 * language's code, and so do its store links.
 *
 * Kept free of Next and React imports so it runs under `node --test`.
 */

export interface LinkLocale {
  code: string;
  is_default?: boolean;
}

/** `/ar` for a non-default locale, `` for the default one or none. */
export function localePrefix(locale: LinkLocale | null | undefined): string {
  return locale && !locale.is_default && locale.code ? `/${locale.code}` : '';
}

export function productHref(productId: string, locale?: LinkLocale | null): string {
  return `${localePrefix(locale)}/product/${encodeURIComponent(productId)}`;
}

export function cartHref(locale?: LinkLocale | null): string {
  return `${localePrefix(locale)}/cart`;
}

/** Where "View all" of a section goes: the products page. */
export function productsHref(locale?: LinkLocale | null): string {
  return `${localePrefix(locale)}/products`;
}
