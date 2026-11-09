/**
 * What the category cards show (part 2, session 25; OPEN_QUESTIONS 8, 9 and
 * 55): one card per category of the shop home's list
 * (`GET /ycode/api/store/categories`: the site's chosen categories, or the top
 * level of the tree when it chose none), with the picture of the category's
 * first product that has one.
 *
 * A category the site sells nothing in has no card: the card would open the
 * products page on its empty state. The product grid's chips still list it.
 *
 * Kept free of Next and React imports so it runs under `node --test`.
 */

import type { StoreCategorySummary } from '@/lib/platform/catalogue-rules';

export interface CategoryCardData {
  id: string;
  name: string;
  name_ar: string | null;
  /** Null draws the placeholder tile. */
  imageUrl: string | null;
}

export function categoryCardsOf(categories: StoreCategorySummary[]): CategoryCardData[] {
  return categories
    .filter((category) => category.item_count > 0)
    .map((category) => ({ id: category.id, name: category.name, name_ar: category.name_ar, imageUrl: category.first_product_image }));
}
