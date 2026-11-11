import assert from 'node:assert/strict';
import { test } from 'node:test';

import { VISIT_LIMIT_MAX, VISIT_LIMIT_WINDOW_MS, WindowCounter } from './visit-limit';

const MINUTE = 60_000;

test('a key is allowed its number of requests in a window, and no more', () => {
  const counter = new WindowCounter(10 * MINUTE, 3);
  assert.equal(counter.allow('site|ip', 0), true);
  assert.equal(counter.allow('site|ip', MINUTE), true);
  assert.equal(counter.allow('site|ip', 2 * MINUTE), true);
  assert.equal(counter.allow('site|ip', 3 * MINUTE), false);
  assert.equal(counter.allow('site|ip', 9 * MINUTE), false);
});

test('other keys are apart: another site, another address', () => {
  const counter = new WindowCounter(10 * MINUTE, 1);
  assert.equal(counter.allow('site-1|10.0.0.1', 0), true);
  assert.equal(counter.allow('site-1|10.0.0.1', 1), false);
  assert.equal(counter.allow('site-2|10.0.0.1', 1), true);
  assert.equal(counter.allow('site-1|10.0.0.2', 1), true);
});

test('a new window starts when the key\'s window has ended', () => {
  const counter = new WindowCounter(10 * MINUTE, 1);
  assert.equal(counter.allow('key', 0), true);
  assert.equal(counter.allow('key', 10 * MINUTE - 1), false);
  assert.equal(counter.allow('key', 10 * MINUTE), true);
  assert.equal(counter.allow('key', 10 * MINUTE + 1), false);
});

test('keys whose window has ended are dropped once many are held', () => {
  const counter = new WindowCounter(10 * MINUTE, 5);
  for (let i = 0; i < 5000; i++) counter.allow(`old-${i}`, 0);
  assert.equal(counter.size, 5000);
  counter.allow('new', 11 * MINUTE);
  assert.equal(counter.size, 1);
});

test('the route\'s limit is 600 requests in ten minutes', () => {
  assert.equal(VISIT_LIMIT_MAX, 600);
  assert.equal(VISIT_LIMIT_WINDOW_MS, 10 * MINUTE);
});
