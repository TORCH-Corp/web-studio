import assert from 'node:assert/strict';
import { test } from 'node:test';

import { countedCheckout, limitKey, RecentCounter } from './checkout-limit';

const MINUTE = 60_000;

test('a key counts its checkouts since a time; other keys are apart', () => {
  const counter = new RecentCounter(10 * MINUTE);
  const a = limitKey('site-1', '10.0.0.1');
  const b = limitKey('site-2', '10.0.0.1');
  counter.add(a, 'checkout-1', 0);
  counter.add(a, 'checkout-2', 2 * MINUTE);
  counter.add(a, 'checkout-3', 4 * MINUTE);
  counter.add(b, 'checkout-4', 4 * MINUTE);
  assert.equal(counter.count(a, 0), 3);
  assert.equal(counter.count(a, MINUTE), 2);
  assert.equal(counter.count(a, 5 * MINUTE), 0);
  assert.equal(counter.count(b, 0), 1);
  assert.equal(counter.count(limitKey('site-1', '10.0.0.2'), 0), 0);
});

test('checkouts that have left the window are forgotten, and so is a key with none left', () => {
  const counter = new RecentCounter(10 * MINUTE);
  counter.add('old', 'checkout-1', 0);
  counter.add('kept', 'checkout-2', 5 * MINUTE);
  counter.add('kept', 'checkout-3', 12 * MINUTE);
  assert.equal(counter.size, 1);
  assert.equal(counter.count('old', 0), 0);
  assert.equal(counter.count('kept', 0), 2);
  counter.add('new', 'checkout-4', 16 * MINUTE);
  assert.equal(counter.count('kept', 0), 1);
});

test('a checkout sent again is counted once, from the first time; with another phone it counts again', () => {
  const counter = new RecentCounter(10 * MINUTE);
  const key = limitKey('site-1', '10.0.0.1');
  const retried = countedCheckout('checkout-1', '9647701234567');
  counter.add(key, retried, 0);
  counter.add(key, retried, MINUTE);
  counter.add(key, retried, 3 * MINUTE);
  assert.equal(counter.count(key, 0), 1);
  // The window runs from the first count: a retry does not keep it alive.
  counter.add(key, countedCheckout('checkout-2', '9647701234567'), 11 * MINUTE);
  assert.equal(counter.count(key, 0), 1);
  // One checkout id with another number would make another person.
  counter.add(key, countedCheckout('checkout-2', '9647719876543'), 12 * MINUTE);
  assert.equal(counter.count(key, 0), 2);
  // Once the first count has left the window, the same checkout counts anew.
  counter.add(key, retried, 13 * MINUTE);
  assert.equal(counter.count(key, 0), 3);
});
