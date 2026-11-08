import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { StoreProduct, StoreVariant } from '@/lib/platform/catalogue-rules';
import { lineForProduct } from './add-to-cart';
import { refreshCart, refreshLine, type ProductRead } from './cart-refresh';
import { createCartStore, type CartStorage } from './cart-store';

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

const WHITE: StoreVariant = {
  id: 'shirt-m-white',
  sku: 'SHT-M-WHT',
  price: { amount: '30400', currency: 'IQD', converted: true },
  available: true,
  unavailable_reason: null,
  image: null,
  axes: [{ specification_id: 'cl', option_id: 'w', name: 'Colour', name_ar: 'اللون', option: 'White', option_ar: 'أبيض' }],
};

const SHIRT: StoreProduct = { ...LAMP, id: 'shirt', name: 'Linen shirt', name_ar: null, price: { ...LAMP.price, amount: '30400', from: true }, images: [], variants: [WHITE] };

const lampLine = () => ({ ...lineForProduct(LAMP, null, 2) });
const shirtLine = () => ({ ...lineForProduct(SHIRT, WHITE, 1) });

test('a line that shows what the catalogue says is the same, even after a trip through the storage', () => {
  const store = storage();
  createCartStore({ siteId: 's', storage: store }).add(lineForProduct(LAMP, null, 2));
  createCartStore({ siteId: 's', storage: store }).add(lineForProduct(SHIRT, WHITE, 1));
  const cart = createCartStore({ siteId: 's', storage: store });
  assert.deepEqual(cart.lines().map((line) => refreshLine(line, line.product_id === 'lamp' ? LAMP : SHIRT).kind), ['same', 'same']);
});

test('a changed price is an update that says what the buyer saw, and the new snapshot carries the new price', () => {
  const dearer = { ...LAMP, price: { ...LAMP.price, amount: '27500' } };
  const result = refreshLine(lampLine(), dearer);
  assert.equal(result.kind, 'updated');
  if (result.kind !== 'updated') return;
  assert.deepEqual(result.was, { amount: '25000', currency: 'IQD' });
  assert.equal(result.snapshot.price.amount, '27500');
});

test('an amount that is the same number is not a change, whatever its trailing zeros', () => {
  const same = { ...LAMP, price: { ...LAMP.price, amount: '25000.00' } };
  const result = refreshLine(lampLine(), same);
  assert.equal(result.kind, 'updated');
  if (result.kind === 'updated') assert.equal(result.was, null, 'the snapshot is rewritten, the buyer is told nothing');
});

test('a price in another currency is a changed price (the site changed its currency)', () => {
  const dollars = { ...LAMP, price: { ...LAMP.price, amount: '16.45', currency: 'USD' as const, converted: true } };
  const result = refreshLine(lampLine(), dollars);
  assert.equal(result.kind, 'updated');
  if (result.kind === 'updated') assert.deepEqual(result.was, { amount: '25000', currency: 'IQD' });
});

test('a change of name, picture or unit is kept without telling the buyer anything', () => {
  const renamed = { ...LAMP, name: 'Desk lamp, brass', unit: { name: 'Box', symbol: 'box' } };
  const result = refreshLine(lampLine(), renamed);
  assert.equal(result.kind, 'updated');
  if (result.kind !== 'updated') return;
  assert.equal(result.was, null);
  assert.equal(result.snapshot.name, 'Desk lamp, brass');
  assert.deepEqual(result.snapshot.unit, { name: 'Box', symbol: 'box' });
});

test('a variant is held against its own price, and its axes come from the catalogue', () => {
  const repriced = { ...SHIRT, variants: [{ ...WHITE, price: { amount: '32000', currency: 'IQD' as const, converted: false } }] };
  const result = refreshLine(shirtLine(), repriced);
  assert.equal(result.kind, 'updated');
  if (result.kind !== 'updated') return;
  assert.deepEqual(result.was, { amount: '30400', currency: 'IQD' });
  assert.equal(result.snapshot.price.amount, '32000');
  assert.deepEqual(result.snapshot.axes, [{ name: 'Colour', name_ar: 'اللون', option: 'White', option_ar: 'أبيض' }]);
});

test('a product the catalogue no longer has, a variant gone, without a price or that cannot be bought is unavailable', () => {
  assert.deepEqual(refreshLine(lampLine(), null), { kind: 'unavailable' });
  assert.deepEqual(refreshLine(shirtLine(), { ...SHIRT, variants: [] }), { kind: 'unavailable' }, 'the variant is no longer a variant of it');
  assert.deepEqual(refreshLine(shirtLine(), { ...SHIRT, variants: [{ ...WHITE, available: false, unavailable_reason: 'inactive' }] }), { kind: 'unavailable' });
  assert.deepEqual(refreshLine(shirtLine(), { ...SHIRT, variants: [{ ...WHITE, price: null }] }), { kind: 'unavailable' });
});

test('a line that names a product which has variants since is unavailable: a parent is never sold', () => {
  assert.deepEqual(refreshLine(lampLine(), { ...LAMP, variants: [{ ...WHITE, id: 'lamp-black' }] }), { kind: 'unavailable' });
});

function cartWith(...lines: ReturnType<typeof lampLine>[]) {
  const cart = createCartStore({ siteId: 's', storage: storage() });
  for (const line of lines) cart.add(line);
  return cart;
}

test('refreshCart reads each product once, updates the snapshots and reports what it found', async () => {
  const cart = cartWith(lampLine(), shirtLine());
  cart.add(lineForProduct(SHIRT, { ...WHITE, id: 'shirt-m-blue' }, 1));
  const asked: string[] = [];
  const read = async (id: string): Promise<ProductRead> => {
    asked.push(id);
    if (id === 'lamp') return { kind: 'found', product: { ...LAMP, price: { ...LAMP.price, amount: '27500' } } };
    // The blue shirt is gone from the product; the white one is the same.
    return { kind: 'found', product: SHIRT };
  };
  const result = await refreshCart(cart, read);
  assert.deepEqual(asked.sort(), ['lamp', 'shirt'], 'the shirt is read once for its two lines');
  assert.deepEqual([...result.changed], [['lamp', { amount: '25000', currency: 'IQD' }]]);
  assert.deepEqual([...result.unavailable], ['shirt-m-blue']);
  assert.equal(result.failed, false);
  assert.equal(cart.lines()[0].snapshot.price.amount, '27500', 'the cart keeps the new price');
  assert.equal(cart.lines()[0].quantity, 2);
});

test('a product that is gone makes its lines unavailable; one that could not be read leaves its lines alone and says so', async () => {
  const cart = cartWith(lampLine(), shirtLine());
  const result = await refreshCart(cart, async (id) => (id === 'lamp' ? { kind: 'gone' } : { kind: 'failed' }));
  assert.deepEqual([...result.unavailable], ['lamp']);
  assert.equal(result.failed, true);
  assert.deepEqual([...result.changed], []);
  assert.equal(cart.lines().length, 2, 'refreshing never removes a line: that is the buyer\'s');
});

test('a line added or removed while the products were being read is held against what the cart has now', async () => {
  const cart = cartWith(lampLine(), shirtLine());
  const result = await refreshCart(cart, async (id) => {
    if (id === 'lamp') cart.remove('shirt-m-white');
    return id === 'lamp' ? { kind: 'found', product: { ...LAMP, price: { ...LAMP.price, amount: '1000' } } } : { kind: 'found', product: SHIRT };
  });
  assert.deepEqual(cart.lines().map((line) => line.item_id), ['lamp']);
  assert.deepEqual([...result.changed.keys()], ['lamp']);
});

test('an empty cart reads nothing', async () => {
  const cart = cartWith();
  const result = await refreshCart(cart, async () => {
    throw new Error('nothing should be read');
  });
  assert.deepEqual([...result.changed], []);
  assert.equal(result.failed, false);
});
