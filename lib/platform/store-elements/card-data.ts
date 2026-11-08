/**
 * What a product card shows, from a product of the store API
 * (`GET /ycode/api/store/products`) or from the canvas's sample data: the name
 * in the page's language, the price, whether it is a "from" price, the image,
 * and whether the product has variants (then the card opens the product page
 * instead of adding to the cart).
 *
 * Kept free of Next and React imports so it runs under `node --test`.
 */

import type { StoreProduct } from '@/lib/platform/catalogue-rules';
import type { StoreLang } from '@/lib/platform/store-elements/strings';

export interface CardData {
  id: string;
  name: string;
  name_ar: string | null;
  price: { amount: string; currency: 'IQD' | 'USD' };
  /** A product with variants: the lowest available variant price, shown "from". */
  from: boolean;
  imageUrl: string | null;
  hasVariants: boolean;
  /** The unit a plain product's line is sold in (a card without variants adds it to the cart). */
  unit: { name: string; symbol: string } | null;
}

export type ProductForCard = Pick<StoreProduct, 'id' | 'name' | 'name_ar' | 'price' | 'unit' | 'images' | 'variants'>;

export function cardOf(product: ProductForCard): CardData {
  return {
    id: product.id,
    name: product.name,
    name_ar: product.name_ar,
    price: { amount: product.price.amount, currency: product.price.currency },
    from: product.price.from,
    imageUrl: product.images[0]?.url ?? null,
    hasVariants: product.variants.length > 0,
    unit: product.unit ? { name: product.unit.name, symbol: product.unit.symbol } : null,
  };
}

/** The name in the page's language: Arabic when the page is Arabic and the item has an Arabic name. */
export function nameFor(card: Pick<CardData, 'name' | 'name_ar'>, lang: StoreLang): string {
  return lang === 'ar' && card.name_ar ? card.name_ar : card.name;
}
