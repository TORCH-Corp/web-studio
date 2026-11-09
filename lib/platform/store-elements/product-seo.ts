/**
 * What a product page says about itself in the document head (part 2 release
 * fixes, OPEN_QUESTIONS 45). The page's own SEO fields are one static title and
 * description for every product; where a page leaves one empty, the product the
 * address names fills it: "{product name} · {site name}" and the product's
 * description, its first 160 characters, in the page's language. A field the
 * page does fill stays the page's, and the site's defaults come after the
 * product (lib/generate-page-metadata.ts).
 *
 * Kept free of Next and React imports so it runs under `node --test`.
 */

import type { StoreProduct } from '@/lib/platform/catalogue-rules';
import { nameFor } from '@/lib/platform/store-elements/card-data';
import type { StoreLang } from '@/lib/platform/store-elements/strings';

/** The longest description a result shows, about: the first 160 characters of the product's. */
export const DESCRIPTION_MAX = 160;

/** "{product name} · {site name}"; the name alone when the site has none. */
export function productTitle(name: string, siteName: string | null | undefined): string {
  const site = siteName?.trim();
  return site ? `${name} · ${site}` : name;
}

/** The first 160 characters of a description on one line (line breaks and runs of spaces become one space); null when there is none. */
export function productDescription(text: string | null | undefined): string | null {
  const oneLine = text?.replace(/\s+/g, ' ').trim();
  if (!oneLine) return null;
  // Characters, not UTF-16 units, so an emoji is never cut in half.
  return Array.from(oneLine).slice(0, DESCRIPTION_MAX).join('').trimEnd() || null;
}

export interface ProductSeo {
  title: string;
  /** Null when the product has no description: the page's and the site's own text then apply. */
  description: string | null;
}

export function productSeo(input: {
  product: Pick<StoreProduct, 'name' | 'name_ar' | 'description' | 'description_ar'>;
  lang: StoreLang;
  siteName: string | null | undefined;
}): ProductSeo {
  const { product, lang, siteName } = input;
  return {
    title: productTitle(nameFor(product, lang), siteName),
    description: productDescription(lang === 'ar' && product.description_ar ? product.description_ar : product.description),
  };
}

/**
 * The canonical path of a product page: the page's own path with the item's id
 * as its last segment, in the language the request is in (the address a search
 * engine should keep: the id in lower case, no trailing slash, no query).
 */
export function productCanonicalPath(slugPath: string, itemId: string): string {
  const segments = slugPath.split('/').filter((segment) => segment !== '');
  segments[Math.max(segments.length - 1, 0)] = itemId;
  return `/${segments.join('/')}`;
}
