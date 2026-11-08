import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PANEL_PAGE_KINDS } from './pages';
import { createStoreLinks, localePrefix, productsHref } from './links';

const PATHS = { product: { '*': '/shop/product', ar: '/ar/متجر/منتج' }, cart: { '*': '/cart', ar: '/ar/السلة' } };

test('a product links to the page with the product role and the item\'s id, in the page\'s language', () => {
  assert.equal(createStoreLinks(null, PATHS).product('abc'), '/shop/product/abc');
  assert.equal(createStoreLinks({ code: 'en', is_default: true }, PATHS).product('abc'), '/shop/product/abc');
  assert.equal(createStoreLinks({ code: 'ar', is_default: false }, PATHS).product('abc'), '/ar/متجر/منتج/abc');
});

test('with no page that has the product role a product links to /product/{id}, with the language\'s prefix', () => {
  assert.equal(createStoreLinks(null, {}).product('abc'), '/product/abc');
  assert.equal(createStoreLinks({ code: 'ar', is_default: true }, {}).product('abc'), '/product/abc');
  assert.equal(createStoreLinks({ code: 'en', is_default: false }, {}).product('abc'), '/en/product/abc');
});

test('an item id is escaped into the path', () => {
  assert.equal(createStoreLinks(null, PATHS).product('a/b c'), '/shop/product/a%2Fb%20c');
  assert.equal(createStoreLinks(null, {}).product('a/b c'), '/product/a%2Fb%20c');
});

test('the cart links to the page with the cart role, in the page\'s language', () => {
  assert.equal(createStoreLinks(null, PATHS).cart(), '/cart');
  assert.equal(createStoreLinks({ code: 'ar', is_default: false }, PATHS).cart(), '/ar/السلة');
});

test('until a page can have the cart role the cart links to "#", so it goes nowhere instead of to a page that is not there', () => {
  assert.equal(createStoreLinks(null, {}).cart(), '#');
  assert.equal(createStoreLinks({ code: 'ar', is_default: false }, { product: PATHS.product }).cart(), '#');
});

test('View all of a section goes to the products page, with the language\'s prefix', () => {
  assert.equal(productsHref(null), '/products');
  assert.equal(productsHref({ code: 'en', is_default: false }), '/en/products');
  assert.equal(createStoreLinks({ code: 'en', is_default: false }, PATHS).products(), '/en/products');
  assert.equal(localePrefix({ code: 'ar', is_default: true }), '');
});

// W6 gives the cart, checkout and confirmation pages their roles in the page settings panel. The lookup above
// already links to a cart page once one has the role; this is the check that the panel offers it, so the
// indicator's "#" is replaced the day W6 lands. It is expected to fail until then (a todo does not fail the run).
test('the page settings panel offers the cart role', { todo: 'W6 adds the cart, checkout and confirmation roles to the panel' }, () => {
  assert.ok(PANEL_PAGE_KINDS.includes('cart'));
});
