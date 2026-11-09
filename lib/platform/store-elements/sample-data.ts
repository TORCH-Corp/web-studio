/**
 * The sample data the builder canvas draws for the store elements: the eight
 * products, the three categories and the cart count of handoff/store (sample
 * data, "illustrative, never a requirement"). The canvas never calls the store
 * API (PRD V1.1: "In the canvas every store element renders with sample data").
 *
 * Kept free of Next and React imports so it runs under `node --test`.
 */

import type { StoreProduct, StoreVariant } from '@/lib/platform/catalogue-rules';
import type { Confirmation } from '@/lib/platform/checkout-rules';
import type { CardData } from '@/lib/platform/store-elements/card-data';
import type { CartLine } from '@/lib/platform/store-elements/cart-store';
import type { StoreTerms } from '@/lib/platform/store-elements/order-summary';
import { multiplyAmount } from '@/lib/platform/store-money';

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

/** The count a grid shows in the canvas: the handoff's "8 products". */
export const SAMPLE_PRODUCT_COUNT = SAMPLES.length;

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
    unit: null,
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

// ---------------------------------------------------------------------------
// The product page's sample (handoff browse-product-default: the cotton T-shirt
// whose Grey and XL cannot be bought, Black and M chosen).
// ---------------------------------------------------------------------------

const SAMPLE_COLOURS = [
  { id: 'black', code: 'BLK', label: 'Black', label_ar: 'أسود', available: true },
  { id: 'white', code: 'WHT', label: 'White', label_ar: 'أبيض', available: true },
  { id: 'navy', code: 'NVY', label: 'Navy', label_ar: 'كحلي', available: true },
  { id: 'grey', code: 'GRY', label: 'Grey', label_ar: 'رمادي', available: false },
];
const SAMPLE_SIZES = [
  { id: 's', label: 'S', available: true },
  { id: 'm', label: 'M', available: true },
  { id: 'l', label: 'L', available: true },
  { id: 'xl', label: 'XL', available: false },
];

const SAMPLE_PRICE = { amount: '25000', currency: 'IQD' as const, converted: false };

/** The options the canvas shows as chosen: Black and M. */
export const SAMPLE_SELECTION: Record<string, string> = { 'sample-colour': 'black', 'sample-size': 'm' };

/**
 * The product the canvas draws on a product page element. It has no picture to fetch: the canvas never calls
 * the store (PRD V1.1), so its images carry no url and the element draws the placeholder tiles.
 */
export function sampleProduct(): StoreProduct {
  const variants = SAMPLE_COLOURS.flatMap((colour) =>
    SAMPLE_SIZES.map((size): StoreVariant => {
      const available = colour.available && size.available;
      return {
        id: `sample-${colour.id}-${size.id}`,
        sku: `TS-001-${colour.code}-${size.label}`,
        price: available ? SAMPLE_PRICE : null,
        available,
        unavailable_reason: available ? null : 'inactive',
        image: null,
        axes: [
          { specification_id: 'sample-colour', option_id: colour.id, name: 'Colour', name_ar: 'اللون', option: colour.label, option_ar: colour.label_ar },
          { specification_id: 'sample-size', option_id: size.id, name: 'Size', name_ar: 'المقاس', option: size.label, option_ar: size.label },
        ],
      };
    }),
  );
  return {
    id: 'sample-1',
    sku: 'TS-001',
    name: 'Cotton T-shirt',
    name_ar: 'قميص قطني',
    description: 'A pure cotton T-shirt with a relaxed fit for everyday wear. Machine wash cold, iron on low heat.',
    description_ar: 'قميص من القطن الخالص بقصّة مريحة، مناسب للاستخدام اليومي. يُغسل في الغسالة بماء بارد ويُكوى على حرارة منخفضة.',
    price: { ...SAMPLE_PRICE, from: true },
    unit: { name: 'Piece', symbol: 'pcs' },
    images: [1, 2, 3, 4].map((n) => ({ document_id: `sample-image-${n}`, url: '' })),
    // The handoff's breadcrumb: Products, Men, Cotton T-shirt.
    category: SAMPLE_CATEGORIES[0],
    variants,
    axes_summary: [
      { id: 'sample-colour', code: 'CLR', name: 'Colour', name_ar: 'اللون', options: SAMPLE_COLOURS.map((c) => ({ id: c.id, code: c.id, label: c.label, label_ar: c.label_ar })) },
      { id: 'sample-size', code: 'SZ', name: 'Size', name_ar: 'المقاس', options: SAMPLE_SIZES.map((s) => ({ id: s.id, code: s.id, label: s.label, label_ar: s.label })) },
    ],
  };
}

// ---------------------------------------------------------------------------
// The cart, checkout and confirmation samples (handoff checkout-cart-default,
// checkout-form-default, checkout-confirmation-default: a cart of 4 items, 110,000
// IQD of them, 5,000 IQD of delivery, 115,000 IQD in all, order SO-2026-0142).
// ---------------------------------------------------------------------------

const TSHIRT_AXES = [
  { name: 'Colour', name_ar: 'اللون', option: 'Black', option_ar: 'أسود' },
  { name: 'Size', name_ar: 'المقاس', option: 'M', option_ar: 'M' },
];
const HOODIE_AXES = [
  { name: 'Colour', name_ar: 'اللون', option: 'Grey', option_ar: 'رمادي' },
  { name: 'Size', name_ar: 'المقاس', option: 'L', option_ar: 'L' },
];

/** The lines the canvas draws in a cart and a checkout: no picture, the placeholder tiles. */
export const SAMPLE_CART_LINES: readonly CartLine[] = [
  { item_id: 'sample-1-black-m', product_id: 'sample-1', quantity: 2, snapshot: { name: 'Cotton T-shirt', name_ar: 'قميص قطني', axes: TSHIRT_AXES, price: { amount: '25000', currency: 'IQD' }, image: null, unit: null } },
  { item_id: 'sample-2-grey-l', product_id: 'sample-2', quantity: 1, snapshot: { name: 'Wool hoodie', name_ar: 'هودي صوف', axes: HOODIE_AXES, price: { amount: '45000', currency: 'IQD' }, image: null, unit: null } },
  { item_id: 'sample-3', product_id: 'sample-3', quantity: 1, snapshot: { name: 'Canvas tote bag', name_ar: 'حقيبة قماش', axes: [], price: { amount: '15000', currency: 'IQD' }, image: null, unit: null } },
];

/** What the store's settings say, in the canvas. */
export const SAMPLE_TERMS: StoreTerms = { currency: 'IQD', delivery_fee: '5000.00' };

/** The order the canvas draws on a confirmation element: the cart above, as Sales would send it back. */
export function sampleOrder(): Confirmation {
  return {
    checkout_id: '00000000-0000-4000-8000-000000000142',
    code: 'SO-2026-0142',
    currency: 'IQD',
    lines: SAMPLE_CART_LINES.map((line) => ({
      item_id: line.item_id,
      sku: line.item_id.toUpperCase(),
      name: line.snapshot.name,
      name_ar: line.snapshot.name_ar,
      // The cart's snapshot already names the product, not the variant: nothing to separate.
      product_name: null,
      product_name_ar: null,
      axes: line.snapshot.axes,
      unit: { code: 'UOM-000001', name: 'Piece' },
      quantity: String(line.quantity),
      unit_price: line.snapshot.price.amount,
      line_total: multiplyAmount(line.snapshot.price.amount, line.quantity),
    })),
    subtotal: '110000',
    delivery_fee: '5000.00',
    total: '115000.00',
    payment_method: 'cash_on_delivery',
    phone: '0770 123 4567',
  };
}
