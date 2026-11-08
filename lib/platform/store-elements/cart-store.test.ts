import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  cartCount,
  CartFullError,
  CartStoreNotConnectedError,
  connectCartStore,
  createCartStore,
  getCartStore,
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  subscribeToCart,
  unconnectedCartStore,
  type CartLineInput,
  type CartStorage,
} from './cart-store';

const SITE = 'a0a0a0a0-0000-4000-8000-000000000001';
const KEY = `ws-cart:${SITE}`;

const line = (item_id: string, over: Partial<CartLineInput> = {}): CartLineInput => ({
  item_id,
  product_id: over.product_id ?? item_id,
  quantity: 1,
  snapshot: { name: `Item ${item_id}`, name_ar: null, axes: [], price: { amount: '9000', currency: 'IQD' }, image: null, unit: null },
  ...over,
});

const VARIANT_AXES = [
  { name: 'Colour', name_ar: 'اللون', option: 'Black', option_ar: 'أسود' },
  { name: 'Size', name_ar: 'المقاس', option: 'M', option_ar: 'وسط' },
];

/** A browser's localStorage, in memory; the same object stands for "the browser" across reloads. */
function memoryStorage(initial: Record<string, string> = {}): CartStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

afterEach(() => connectCartStore(null));

test('adding puts a line in the cart, counts its quantity, and keeps it under the site\'s own key', () => {
  const storage = memoryStorage();
  const cart = createCartStore({ siteId: SITE, storage });
  assert.equal(cart.count(), 0);
  cart.add(line('lamp', { quantity: 2 }));
  assert.equal(cart.count(), 2);
  assert.deepEqual(cart.lines().map((l) => [l.item_id, l.quantity]), [['lamp', 2]]);
  assert.ok(storage.data.has(KEY), 'ws-cart:{siteId}');
  assert.equal(storage.data.size, 1);
});

test('the cart survives a reload: a new store over the same storage has the same lines', () => {
  const storage = memoryStorage();
  const first = createCartStore({ siteId: SITE, storage });
  first.add(line('shirt-m-black', { product_id: 'shirt', snapshot: { ...line('x').snapshot, axes: VARIANT_AXES } }));
  first.add(line('lamp', { quantity: 3 }));
  const second = createCartStore({ siteId: SITE, storage });
  assert.equal(second.count(), 4);
  assert.deepEqual(second.lines().map((l) => l.item_id), ['shirt-m-black', 'lamp']);
  assert.equal(second.lines()[0].product_id, 'shirt');
  assert.deepEqual(second.lines()[0].snapshot.axes, VARIANT_AXES);
});

test('two sites on one browser keep two carts', () => {
  const storage = memoryStorage();
  createCartStore({ siteId: SITE, storage }).add(line('lamp'));
  const other = createCartStore({ siteId: 'b1b1b1b1-0000-4000-8000-000000000002', storage });
  assert.equal(other.count(), 0);
  assert.equal(storage.data.size, 1);
});

test('adding the same item again merges into its line and takes the newest snapshot; another variant of the product is its own line', () => {
  const cart = createCartStore({ siteId: SITE, storage: memoryStorage() });
  cart.add(line('shirt-m-black', { product_id: 'shirt' }));
  cart.add(line('shirt-l-black', { product_id: 'shirt' }));
  cart.add(line('shirt-m-black', { product_id: 'shirt', quantity: 2, snapshot: { ...line('x').snapshot, price: { amount: '9500', currency: 'IQD' } } }));
  assert.deepEqual(cart.lines().map((l) => [l.item_id, l.quantity]), [['shirt-m-black', 3], ['shirt-l-black', 1]]);
  assert.equal(cart.lines()[0].snapshot.price.amount, '9500');
  assert.equal(cart.count(), 4);
});

test('a line never holds more than the largest quantity, and a quantity is a whole number of at least one', () => {
  const cart = createCartStore({ siteId: SITE, storage: memoryStorage() });
  cart.add(line('lamp', { quantity: MAX_LINE_QUANTITY }));
  cart.add(line('lamp', { quantity: 5 }));
  assert.equal(cart.lines()[0].quantity, MAX_LINE_QUANTITY);
  assert.throws(() => cart.add(line('hose', { quantity: 0 })), /quantity/);
  assert.throws(() => cart.add(line('hose', { quantity: 1.5 })), /quantity/);
  assert.equal(cart.lines().length, 1);
});

test('setting a quantity changes the line, pulled into 1 to the largest; an unknown item or a non-number changes nothing', () => {
  const cart = createCartStore({ siteId: SITE, storage: memoryStorage() });
  cart.add(line('lamp'));
  cart.setQuantity('lamp', 4);
  assert.equal(cart.count(), 4);
  cart.setQuantity('lamp', 0);
  assert.equal(cart.count(), 1, 'a stepper cannot take a line below one; removing is its own action');
  cart.setQuantity('lamp', 100000);
  assert.equal(cart.count(), MAX_LINE_QUANTITY);
  cart.setQuantity('lamp', Number.NaN);
  assert.equal(cart.count(), MAX_LINE_QUANTITY);
  cart.setQuantity('nothing', 3);
  assert.equal(cart.lines().length, 1);
});

test('removing takes a line out, clearing empties the cart, and both are kept', () => {
  const storage = memoryStorage();
  const cart = createCartStore({ siteId: SITE, storage });
  cart.add(line('lamp'));
  cart.add(line('hose', { quantity: 2 }));
  cart.remove('lamp');
  assert.deepEqual(createCartStore({ siteId: SITE, storage }).lines().map((l) => l.item_id), ['hose']);
  cart.clear();
  assert.equal(cart.count(), 0);
  assert.equal(createCartStore({ siteId: SITE, storage }).count(), 0);
  assert.equal(storage.data.has(KEY), false, 'an empty cart leaves nothing behind');
});

test('totals are exact: the lines times their quantities, the count of pieces and of lines', () => {
  const cart = createCartStore({ siteId: SITE, storage: memoryStorage() });
  assert.deepEqual(cart.totals(), { count: 0, lines: 0, subtotal: null, mixedCurrency: false });
  cart.add(line('lamp', { quantity: 3, snapshot: { ...line('x').snapshot, price: { amount: '25000', currency: 'IQD' } } }));
  cart.add(line('hose', { quantity: 2, snapshot: { ...line('x').snapshot, price: { amount: '15000', currency: 'IQD' } } }));
  assert.deepEqual(cart.totals(), { count: 5, lines: 2, subtotal: { amount: '105000', currency: 'IQD' }, mixedCurrency: false });
});

test('a cart holding two currencies (the site changed its currency) says so instead of adding them', () => {
  const cart = createCartStore({ siteId: SITE, storage: memoryStorage() });
  cart.add(line('lamp', { snapshot: { ...line('x').snapshot, price: { amount: '25000', currency: 'IQD' } } }));
  cart.add(line('hose', { snapshot: { ...line('x').snapshot, price: { amount: '10.00', currency: 'USD' } } }));
  const totals = cart.totals();
  assert.equal(totals.mixedCurrency, true);
  assert.equal(totals.subtotal, null);
  assert.equal(totals.count, 2);
});

test('the cart holds as many lines as a checkout takes; the next new item is refused, a line already in it is not', () => {
  const cart = createCartStore({ siteId: SITE, storage: memoryStorage() });
  for (let i = 0; i < MAX_CART_LINES; i++) cart.add(line(`item-${i}`));
  assert.throws(() => cart.add(line('one-more')), CartFullError);
  assert.equal(cart.lines().length, MAX_CART_LINES);
  cart.add(line('item-0'));
  assert.equal(cart.lines()[0].quantity, 2);
});

test('whoever subscribes hears each change once, and nothing for a call that changed nothing', () => {
  const cart = createCartStore({ siteId: SITE, storage: memoryStorage() });
  let heard = 0;
  const stop = cart.subscribe(() => heard++);
  cart.add(line('lamp'));
  cart.setQuantity('lamp', 3);
  cart.setQuantity('lamp', 3);
  cart.remove('nothing');
  cart.remove('lamp');
  cart.clear();
  assert.equal(heard, 3, 'add, set to 3, remove lamp');
  stop();
  cart.add(line('lamp'));
  assert.equal(heard, 3);
});

test('what the storage holds that is not a cart is an empty cart, and a line that is not a line is dropped', () => {
  const garbage = createCartStore({ siteId: SITE, storage: memoryStorage({ [KEY]: '{not json' }) });
  assert.equal(garbage.count(), 0);
  const wrongVersion = createCartStore({ siteId: SITE, storage: memoryStorage({ [KEY]: JSON.stringify({ version: 99, lines: [line('lamp')] }) }) });
  assert.equal(wrongVersion.count(), 0);
  const mixed = createCartStore({
    siteId: SITE,
    storage: memoryStorage({
      [KEY]: JSON.stringify({
        version: 1,
        lines: [line('lamp'), { item_id: 'no snapshot', quantity: 1 }, line('hose', { quantity: -2 }), line('chair', { quantity: 2 }), 'text', null],
      }),
    }),
  });
  assert.deepEqual(mixed.lines().map((l) => l.item_id), ['lamp', 'chair']);
});

test('a browser that will not store (private mode, no room) still has a working cart for the visit, and says why once', () => {
  const failures: unknown[] = [];
  const storage: CartStorage = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {},
  };
  const cart = createCartStore({ siteId: SITE, storage, onStorageError: (error) => failures.push(error) });
  cart.add(line('lamp'));
  cart.add(line('hose'));
  assert.equal(cart.count(), 2);
  assert.equal(failures.length, 1, 'once, not on every change');
});

test('reload reads the storage again and tells its subscribers only when another tab changed the cart', () => {
  const storage = memoryStorage();
  const here = createCartStore({ siteId: SITE, storage });
  const there = createCartStore({ siteId: SITE, storage });
  let heard = 0;
  here.subscribe(() => heard++);
  here.reload();
  assert.equal(heard, 0, 'nothing changed');
  there.add(line('lamp', { quantity: 2 }));
  here.reload();
  assert.equal(here.count(), 2);
  assert.equal(heard, 1);
});

test('with no cart connected the count is 0 and every change fails loudly instead of being dropped', () => {
  assert.equal(getCartStore(), unconnectedCartStore);
  assert.equal(cartCount(), 0);
  assert.deepEqual(getCartStore().lines(), []);
  assert.throws(() => getCartStore().add(line('lamp')), CartStoreNotConnectedError);
  assert.throws(() => getCartStore().setQuantity('lamp', 2), CartStoreNotConnectedError);
  assert.throws(() => getCartStore().remove('lamp'), CartStoreNotConnectedError);
  assert.throws(() => getCartStore().clear(), CartStoreNotConnectedError);
});

test('a connected cart is the one read and added to, and a subscriber hears each add', () => {
  connectCartStore(createCartStore({ siteId: SITE, storage: memoryStorage() }));
  let heard = 0;
  const stop = subscribeToCart(() => heard++);
  getCartStore().add(line('lamp'));
  getCartStore().add(line('hose', { quantity: 2 }));
  assert.equal(cartCount(), 3);
  assert.equal(heard, 2);
  stop();
  getCartStore().add(line('chair'));
  assert.equal(heard, 2, 'a stopped subscriber hears nothing more');
});

test('an element subscribed before the cart was connected follows it, and is told at once', () => {
  let heard = 0;
  const stop = subscribeToCart(() => heard++);
  const cart = createCartStore({ siteId: SITE, storage: memoryStorage() });
  connectCartStore(cart);
  assert.equal(heard, 1, 'told of the connection');
  getCartStore().add(line('lamp'));
  assert.equal(heard, 2, 'and of the changes of the new cart');
  connectCartStore(null);
  assert.equal(heard, 3, 'and of its going');
  cart.add(line('hose'));
  assert.equal(heard, 3, 'a cart that is no longer connected is no longer heard');
  stop();
});
