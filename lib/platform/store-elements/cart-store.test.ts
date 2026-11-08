import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { cartCount, CartStoreNotConnectedError, connectCartStore, getCartStore, subscribeToCart, unconnectedCartStore, type CartLineInput, type CartStore } from './cart-store';

const LINE: CartLineInput = { item_id: 'lamp', quantity: 1, snapshot: { name: 'Lamp', name_ar: null, price: { amount: '9000', currency: 'IQD' }, image: null } };

/** A cart that counts what it is given, as W5's will, so the elements can be tested against the interface. */
function fakeCart(): CartStore & { lines: CartLineInput[] } {
  const listeners = new Set<() => void>();
  const lines: CartLineInput[] = [];
  return {
    lines,
    count: () => lines.reduce((sum, line) => sum + line.quantity, 0),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    add: (line) => {
      lines.push(line);
      for (const listener of [...listeners]) listener();
    },
  };
}

afterEach(() => connectCartStore(null));

test('with no cart connected the count is 0 and adding to it fails loudly instead of being dropped', () => {
  assert.equal(getCartStore(), unconnectedCartStore);
  assert.equal(cartCount(), 0);
  assert.throws(() => getCartStore().add(LINE), CartStoreNotConnectedError);
});

test('a connected cart is the one read and added to, and a subscriber hears each add', () => {
  const cart = fakeCart();
  connectCartStore(cart);
  let heard = 0;
  const stop = subscribeToCart(() => heard++);
  getCartStore().add(LINE);
  getCartStore().add({ ...LINE, quantity: 2 });
  assert.equal(cartCount(), 3);
  assert.equal(heard, 2);
  stop();
  getCartStore().add(LINE);
  assert.equal(heard, 2, 'a stopped subscriber hears nothing more');
});

test('an element subscribed before the cart was connected follows it, and is told at once', () => {
  let heard = 0;
  const stop = subscribeToCart(() => heard++);
  const cart = fakeCart();
  connectCartStore(cart);
  assert.equal(heard, 1, 'told of the connection');
  getCartStore().add(LINE);
  assert.equal(heard, 2, 'and of the changes of the new cart');
  connectCartStore(null);
  assert.equal(heard, 3, 'and of its going');
  cart.add(LINE);
  assert.equal(heard, 3, 'a cart that is no longer connected is no longer heard');
  stop();
});
