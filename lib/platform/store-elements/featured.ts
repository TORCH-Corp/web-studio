/**
 * What a product card shows when its owner picked no product (part 2, session
 * 25; OPEN_QUESTIONS 58): one of the store's first products, so "Featured
 * products" (four cards) is full on a shop made from a template before anyone
 * picks. A picked card still shows its pick.
 *
 * The unpicked cards of a page share the store's first products in the
 * grid's order (by name): the first unpicked card shows the first, the second
 * the second, and so on, leaving out the products the page's picked cards
 * show, so a product is not in a row twice. A card past the end of what the
 * store sells shows nothing. The cards find their place in the page itself
 * (the wrappers `PublishedStoreElement` marks), and ask for the products once
 * between them.
 *
 * The pure parts are kept free of the browser so they run under `node --test`.
 */

import type { StoreProduct } from '@/lib/platform/catalogue-rules';
import { fetchProducts, type StoreResult } from '@/lib/platform/store-elements/store-client';
import { MAX_PAGE_SIZE } from '@/lib/platform/store-query';

/** The wrapper of a product card with no product picked, and of one with a pick (the product's id). */
export const UNPICKED_ATTRIBUTE = 'data-ws-unpicked';
export const PICKED_ATTRIBUTE = 'data-ws-picked';

/** A product card's wrapper in a published page. */
export const CARD_SELECTOR = '[data-ws-store="productCard"]';

export interface FeaturedPlace {
  /** This card's place among the page's unpicked cards, from 0. */
  place: number;
  /** How many unpicked cards the page has. */
  unpicked: number;
  /** The products the page's picked cards show. */
  picked: string[];
}

/** Where an unpicked card stands among the product cards of its page; null when the wrapper is not one of them. */
export function featuredPlace(page: ParentNode, wrapper: Element): FeaturedPlace | null {
  const unpicked = Array.from(page.querySelectorAll(`${CARD_SELECTOR}[${UNPICKED_ATTRIBUTE}]`));
  const place = unpicked.indexOf(wrapper);
  if (place === -1) return null;
  const picked = Array.from(page.querySelectorAll(`${CARD_SELECTOR}[${PICKED_ATTRIBUTE}]`))
    .map((card) => card.getAttribute(PICKED_ATTRIBUTE))
    .filter((id): id is string => !!id);
  return { place, unpicked: unpicked.length, picked };
}

/** How many products the unpicked cards ask for: one each, and one more for each picked product they may have to leave out. */
export function featuredPageSize(unpicked: number, picked: number): number {
  return Math.min(MAX_PAGE_SIZE, Math.max(1, unpicked + picked));
}

/** The product for the unpicked card at `place`: the store's products in their order, without the picked ones. Null past the end. */
export function featuredFor<P extends Pick<StoreProduct, 'id'>>(products: P[], picked: string[], place: number): P | null {
  const taken = new Set(picked);
  return products.filter((product) => !taken.has(product.id))[place] ?? null;
}

type FirstProducts = StoreResult<{ data: StoreProduct[]; meta: { page: number; page_size: number; total: number } }>;

const asked = new Map<number, Promise<FirstProducts>>();

/**
 * The store's first `pageSize` products, asked for once per page however many cards want them. A read that failed
 * is forgotten, so "Try again" asks again.
 */
export function firstProducts(pageSize: number): Promise<FirstProducts> {
  let request = asked.get(pageSize);
  if (!request) {
    request = fetchProducts({ page: 1, pageSize });
    asked.set(pageSize, request);
    request.catch(() => asked.delete(pageSize));
  }
  return request;
}
