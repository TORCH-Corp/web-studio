import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TtlCache } from './ttl-cache';

test('an entry lives for the time given, then is read again', () => {
  let now = 1_000;
  const cache = new TtlCache<string>(30_000, () => now);
  assert.equal(cache.get('site'), undefined);
  cache.set('site', 'IQD');
  now += 29_999;
  assert.equal(cache.get('site'), 'IQD');
  now += 1;
  assert.equal(cache.get('site'), undefined, 'thirty seconds old is stale');
});

test('forgetting an entry drops it at once and only it', () => {
  const cache = new TtlCache<number>(30_000, () => 0);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.forget('a');
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.get('b'), 2);
  cache.set('a', 3);
  assert.equal(cache.get('a'), 3);
});
