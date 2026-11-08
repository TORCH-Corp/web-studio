import assert from 'node:assert/strict';
import { test } from 'node:test';

import { limitKey, RecentCounter } from './checkout-limit';

const MINUTE = 60_000;

test('a key counts its hits since a time; other keys are apart', () => {
  const counter = new RecentCounter(10 * MINUTE);
  const a = limitKey('site-1', '10.0.0.1');
  const b = limitKey('site-2', '10.0.0.1');
  counter.add(a, 0);
  counter.add(a, 2 * MINUTE);
  counter.add(a, 4 * MINUTE);
  counter.add(b, 4 * MINUTE);
  assert.equal(counter.count(a, 0), 3);
  assert.equal(counter.count(a, MINUTE), 2);
  assert.equal(counter.count(a, 5 * MINUTE), 0);
  assert.equal(counter.count(b, 0), 1);
  assert.equal(counter.count(limitKey('site-1', '10.0.0.2'), 0), 0);
});

test('hits that have left the window are forgotten, and so is a key with none left', () => {
  const counter = new RecentCounter(10 * MINUTE);
  counter.add('old', 0);
  counter.add('kept', 5 * MINUTE);
  counter.add('kept', 12 * MINUTE);
  assert.equal(counter.size, 1);
  assert.equal(counter.count('old', 0), 0);
  assert.equal(counter.count('kept', 0), 2);
  counter.add('new', 16 * MINUTE);
  assert.equal(counter.count('kept', 0), 1);
});
