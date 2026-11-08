import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import type { StoreProduct, StoreVariant } from '@/lib/platform/catalogue-rules';
import { addProductToCart, addToCart, lineForProduct } from './add-to-cart';
import { connectCartStore, createCartStore, getCartStore, MAX_CART_LINES, type CartStorage } from './cart-store';
import type { CardData } from './card-data';

const storage = (): CartStorage => {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

const LAMP: StoreProduct = {
  id: 'lamp',
  sku: 'LMP-001',
  name: 'Desk lamp',
  name_ar: 'مصباح مكتب',
  description: null,
  description_ar: null,
  price: { amount: '25000', currency: 'IQD', converted: false, from: false },
  unit: { name: 'Piece', symbol: 'pcs' },
  images: [{ document_id: 'd-lamp', url: '/store-media/d-lamp?item=lamp' }],
  category: null,
  variants: [],
  axes_summary: [],
};

const VARIANT: StoreVariant = {
  id: 'shirt-m-white',
  sku: 'SHT-M-WHT',
  price: { amount: '30400', currency: 'IQD', converted: true },
  available: true,
  unavailable_reason: null,
  image: { document_id: 'd-white', url: '/store-media/d-white?item=shirt' },
  axes: [
    { specification_id: 'sz', option_id: 'm', name: 'Size', name_ar: 'المقاس', option: 'Medium', option_ar: 'وسط' },
    { specification_id: 'cl', option_id: 'w', name: 'Colour', name_ar: 'اللون', option: 'White', option_ar: null },
  ],
};

const SHIRT: StoreProduct = {
  ...LAMP,
  id: 'shirt',
  name: 'Linen shirt',
  name_ar: null,
  price: { amount: '30400', currency: 'IQD', converted: true, from: true },
  images: [{ document_id: 'd-shirt', url: '/store-media/d-shirt?item=shirt' }],
  variants: [VARIANT],
  axes_summary: [],
};

afterEach(() => connectCartStore(null));

test('a plain product is a line of its own id, with what the cart shows of it', () => {
  assert.deepEqual(lineForProduct(LAMP, null, 2), {
    item_id: 'lamp',
    product_id: 'lamp',
    quantity: 2,
    snapshot: {
      name: 'Desk lamp',
      name_ar: 'مصباح مكتب',
      axes: [],
      price: { amount: '25000', currency: 'IQD' },
      image: '/store-media/d-lamp?item=lamp',
      unit: { name: 'Piece', symbol: 'pcs' },
    },
  });
});

test('the picked variant is the line\'s item: its id, its price, its image and its options, under the product', () => {
  const line = lineForProduct(SHIRT, VARIANT, 1);
  assert.equal(line.item_id, 'shirt-m-white');
  assert.equal(line.product_id, 'shirt');
  assert.deepEqual(line.snapshot.price, { amount: '30400', currency: 'IQD' });
  assert.equal(line.snapshot.image, '/store-media/d-white?item=shirt');
  assert.deepEqual(line.snapshot.axes, [
    { name: 'Size', name_ar: 'المقاس', option: 'Medium', option_ar: 'وسط' },
    { name: 'Colour', name_ar: 'اللون', option: 'White', option_ar: null },
  ]);
});

test('a variant that cannot be bought is never put in the cart', () => {
  assert.throws(() => lineForProduct(SHIRT, { ...VARIANT, available: false, price: null }, 1), /cannot be bought/);
});

test('adding a card puts one of the product in the connected cart', () => {
  connectCartStore(createCartStore({ siteId: 's', storage: storage() }));
  const card: CardData = { id: 'lamp', name: 'Desk lamp', name_ar: null, price: { amount: '25000', currency: 'IQD' }, from: false, imageUrl: null, hasVariants: false, unit: null };
  assert.equal(addToCart(card), 'added');
  assert.deepEqual(getCartStore().lines().map((l) => [l.item_id, l.product_id, l.quantity]), [['lamp', 'lamp', 1]]);
});

test('a full cart is told to the buyer, not thrown at the page; any other failure is not hidden', () => {
  connectCartStore(createCartStore({ siteId: 's', storage: storage() }));
  for (let i = 0; i < MAX_CART_LINES; i++) addProductToCart({ ...LAMP, id: `item-${i}` }, null, 1);
  assert.equal(addProductToCart(LAMP, null, 1), 'full');
  connectCartStore(null);
  assert.throws(() => addProductToCart(LAMP, null, 1), /not connected/);
});
