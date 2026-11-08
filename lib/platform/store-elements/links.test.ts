import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cartHref, localePrefix, productHref, productsHref } from './links';

test('the default language links to the plain paths', () => {
  assert.equal(productHref('abc'), '/product/abc');
  assert.equal(cartHref(), '/cart');
  assert.equal(productsHref(null), '/products');
  assert.equal(productHref('abc', { code: 'ar', is_default: true }), '/product/abc');
});

test('another language keeps its code in front, as the site\'s own pages do', () => {
  assert.equal(localePrefix({ code: 'en', is_default: false }), '/en');
  assert.equal(productHref('abc', { code: 'en', is_default: false }), '/en/product/abc');
  assert.equal(cartHref({ code: 'en', is_default: false }), '/en/cart');
});

test('an item id is escaped into the path', () => {
  assert.equal(productHref('a/b c'), '/product/a%2Fb%20c');
});
