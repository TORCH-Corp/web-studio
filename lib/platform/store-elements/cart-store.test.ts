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
  newCheckoutId,
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
  assert.throws(() => getCartStore().checkoutId(), CartStoreNotConnectedError);
  assert.throws(() => getCartStore().refresh('lamp', line('lamp').snapshot), CartStoreNotConnectedError);
});

test('the unconnected cart answers the same empty list every time, so a reader that compares lists by identity sees no change', () => {
  assert.equal(unconnectedCartStore.lines(), unconnectedCartStore.lines());
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

// ---------------------------------------------------------------------------
// The checkout id (session W6): one per cart, kept until the cart is over
// ---------------------------------------------------------------------------

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('a checkout id is a version 4 UUID made from random bytes, so it needs no secure context', () => {
  const ids = new Set(Array.from({ length: 20 }, () => newCheckoutId()));
  assert.equal(ids.size, 20);
  for (const id of ids) assert.match(id, UUID_V4);
});

test('the checkout id is made once per cart: the same on every ask, and kept in the storage with the lines', () => {
  const storage = memoryStorage();
  let made = 0;
  const cart = createCartStore({ siteId: SITE, storage, newCheckoutId: () => `00000000-0000-4000-8000-00000000000${++made}` });
  cart.add(line('lamp'));
  assert.equal(JSON.parse(storage.data.get(KEY)!).checkout_id, undefined, 'none until the checkout asks');
  const id = cart.checkoutId();
  assert.equal(id, '00000000-0000-4000-8000-000000000001');
  assert.equal(cart.checkoutId(), id);
  assert.equal(made, 1);
  assert.equal(JSON.parse(storage.data.get(KEY)!).checkout_id, id);
});

test('a reload keeps the cart and its checkout id; changing the lines does not change the id', () => {
  const storage = memoryStorage();
  const first = createCartStore({ siteId: SITE, storage });
  first.add(line('lamp'));
  const id = first.checkoutId();
  const second = createCartStore({ siteId: SITE, storage });
  assert.equal(second.checkoutId(), id, 'a reload on the checkout page sends the same checkout');
  second.add(line('hose'));
  second.setQuantity('lamp', 4);
  second.remove('hose');
  assert.equal(second.checkoutId(), id, 'the cart is the same cart while it has lines');
});

test('a cart that is cleared or whose last line is removed is over: the next one has a new checkout id', () => {
  const storage = memoryStorage();
  const cart = createCartStore({ siteId: SITE, storage });
  cart.add(line('lamp'));
  const first = cart.checkoutId();
  cart.clear();
  assert.equal(storage.data.size, 0, 'nothing is left of it in the storage');
  cart.add(line('lamp'));
  const second = cart.checkoutId();
  assert.notEqual(second, first);
  cart.remove('lamp');
  cart.add(line('lamp'));
  assert.notEqual(cart.checkoutId(), second);
});

test('an empty cart has no checkout to ask for', () => {
  assert.throws(() => createCartStore({ siteId: SITE, storage: memoryStorage() }).checkoutId(), /empty cart/);
});

test('a cart saved before the checkout existed has none until it is asked for; one that is not a UUID is not kept', () => {
  const old = JSON.stringify({ version: 1, lines: [line('lamp')] });
  const cart = createCartStore({ siteId: SITE, storage: memoryStorage({ [KEY]: old }) });
  assert.match(cart.checkoutId(), UUID_V4);
  const bad = JSON.stringify({ version: 1, lines: [line('lamp')], checkout_id: 'not-an-id' });
  assert.match(createCartStore({ siteId: SITE, storage: memoryStorage({ [KEY]: bad }) }).checkoutId(), UUID_V4);
});

test('another tab that makes or clears the checkout is followed by reload()', () => {
  const storage = memoryStorage();
  const here = createCartStore({ siteId: SITE, storage });
  here.add(line('lamp'));
  const there = createCartStore({ siteId: SITE, storage });
  const id = there.checkoutId();
  let heard = 0;
  here.subscribe(() => heard++);
  here.reload();
  assert.equal(heard, 1, 'the id arriving is a change');
  assert.equal(here.checkoutId(), id);
  here.reload();
  assert.equal(heard, 1, 'and reading the same again is not');
  there.clear();
  here.reload();
  assert.equal(here.count(), 0);
});

// ---------------------------------------------------------------------------
// Refreshing a line from the catalogue
// ---------------------------------------------------------------------------

test('refresh replaces what a line shows and keeps its quantity, its place and its checkout', () => {
  const storage = memoryStorage();
  const cart = createCartStore({ siteId: SITE, storage });
  cart.add(line('lamp', { quantity: 3 }));
  cart.add(line('hose'));
  const id = cart.checkoutId();
  const before = cart.lines();
  cart.refresh('lamp', { ...line('lamp').snapshot, name: 'Desk lamp', price: { amount: '12000', currency: 'IQD' } });
  assert.deepEqual(cart.lines().map((l) => [l.item_id, l.quantity, l.snapshot.price.amount]), [['lamp', 3, '12000'], ['hose', 1, '9000']]);
  assert.equal(cart.lines()[0].snapshot.name, 'Desk lamp');
  assert.notEqual(cart.lines(), before);
  assert.equal(cart.checkoutId(), id);
  assert.equal(cart.totals().subtotal?.amount, '45000', '3 × 12,000 + 9,000');
  assert.equal(JSON.parse(storage.data.get(KEY)!).lines[0].snapshot.price.amount, '12000', 'and it is kept for the next visit');
});

test('refresh with what the line already shows changes nothing and tells nobody', () => {
  const cart = createCartStore({ siteId: SITE, storage: memoryStorage() });
  cart.add(line('lamp'));
  let heard = 0;
  cart.subscribe(() => heard++);
  const before = cart.lines();
  cart.refresh('lamp', line('lamp').snapshot);
  cart.refresh('gone', line('gone').snapshot);
  assert.equal(heard, 0);
  assert.equal(cart.lines(), before);
});
