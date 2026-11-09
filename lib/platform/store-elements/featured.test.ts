import assert from 'node:assert/strict';
import { test } from 'node:test';

import { featuredFor, featuredPageSize } from './featured';

const products = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));

test('the unpicked cards of a page show the store\'s first products in their order, one each (OPEN_QUESTIONS 58)', () => {
  assert.deepEqual([0, 1, 2, 3].map((place) => featuredFor(products, [], place)?.id), ['a', 'b', 'c', 'd']);
});

test('a picked card still wins: the unpicked cards leave its product out, so no product is in the row twice', () => {
  // The owner picked "b" for one card; the three unpicked cards show a, c and d.
  assert.deepEqual([0, 1, 2].map((place) => featuredFor(products, ['b'], place)?.id), ['a', 'c', 'd']);
  // A pick the store does not list (gone, or outside the first products) takes nothing away.
  assert.deepEqual([0, 1].map((place) => featuredFor(products, ['zzz'], place)?.id), ['a', 'b']);
});

test('a card past the end of what the store sells shows nothing', () => {
  assert.equal(featuredFor(products.slice(0, 2), [], 2), null);
  assert.equal(featuredFor([], [], 0), null);
  assert.equal(featuredFor(products.slice(0, 2), ['a', 'b'], 0), null);
});

test('the cards ask for one product each and one more for each picked product, within the products route\'s page limit', () => {
  assert.equal(featuredPageSize(4, 0), 4);
  assert.equal(featuredPageSize(3, 1), 4);
  assert.equal(featuredPageSize(0, 0), 1);
  assert.equal(featuredPageSize(60, 3), 48);
});
