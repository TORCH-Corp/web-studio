/**
 * The sample data the builder canvas draws for the store elements: the eight
 * products, the three categories and the cart count of handoff/store (sample
 * data, "illustrative, never a requirement"). The canvas never calls the store
 * API (PRD V1.1: "In the canvas every store element renders with sample data").
 *
 * Kept free of Next and React imports so it runs under `node --test`.
 */

import type { CardData } from '@/lib/platform/store-elements/card-data';

interface Sample {
  id: string;
  en: string;
  ar: string;
  amount: string;
  from: boolean;
}

/** `hasVariants` follows `from`: a product with variants is shown "from" its lowest price and opens its page. */
const SAMPLES: Sample[] = [
  { id: 'sample-1', en: 'Cotton T-shirt', ar: 'قميص قطني', amount: '25000', from: true },
  { id: 'sample-2', en: 'Wool hoodie', ar: 'هودي صوف', amount: '45000', from: true },
  { id: 'sample-3', en: 'Canvas tote bag', ar: 'حقيبة قماش', amount: '15000', from: false },
  { id: 'sample-4', en: 'Wool scarf', ar: 'شال صوف', amount: '18000', from: true },
  { id: 'sample-5', en: 'Cotton cap', ar: 'قبعة قطنية', amount: '12000', from: false },
  { id: 'sample-6', en: 'Long-sleeve linen shirt', ar: 'قميص كتان بأكمام طويلة', amount: '35000', from: true },
  { id: 'sample-7', en: 'Cotton socks, 3 pairs', ar: 'جوارب قطنية، 3 أزواج', amount: '9000', from: false },
  { id: 'sample-8', en: 'Leather wallet', ar: 'محفظة جلد', amount: '20000', from: false },
];

export const SAMPLE_CATEGORIES = [
  { id: 'sample-men', name: 'Men', name_ar: 'رجالي' },
  { id: 'sample-women', name: 'Women', name_ar: 'نسائي' },
  { id: 'sample-accessories', name: 'Accessories', name_ar: 'إكسسوارات' },
];

/** The cart indicator's count in the canvas (the handoff's "items" state). */
export const SAMPLE_CART_COUNT = 4;

function toCard(sample: Sample): CardData {
  return {
    id: sample.id,
    name: sample.en,
    name_ar: sample.ar,
    price: { amount: sample.amount, currency: 'IQD' },
    from: sample.from,
    imageUrl: null,
    hasVariants: sample.from,
  };
}

/** The sample cards a grid of `pageSize` shows: the handoff's eight at most. */
export function sampleCards(pageSize: number): CardData[] {
  return SAMPLES.slice(0, Math.max(1, Math.min(pageSize, SAMPLES.length))).map(toCard);
}

/** The sample card a lone product card shows: by default a plain product, with its "Add to cart" button. */
export function sampleCard(index = 2): CardData {
  return toCard(SAMPLES[index % SAMPLES.length]);
}
