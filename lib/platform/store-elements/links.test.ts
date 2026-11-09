import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PANEL_PAGE_KINDS } from './pages';
import { createStoreLinks, localePrefix, pageLocaleOf, productsHref } from './links';

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

test('until a page has the cart role the cart links to "#", so it goes nowhere instead of to a page that is not there', () => {
  assert.equal(createStoreLinks(null, {}).cart(), '#');
  assert.equal(createStoreLinks({ code: 'ar', is_default: false }, { product: PATHS.product }).cart(), '#');
});

test('View all of a section goes to the products page, with the language\'s prefix', () => {
  assert.equal(productsHref(null), '/products');
  assert.equal(productsHref({ code: 'en', is_default: false }), '/en/products');
  assert.equal(createStoreLinks({ code: 'en', is_default: false }, PATHS).products(), '/en/products');
  assert.equal(localePrefix({ code: 'ar', is_default: true }), '');
});

test('the checkout links to the page with the checkout role, in the page\'s language, and to "#" until a page has it', () => {
  const paths = { ...PATHS, checkout: { '*': '/checkout', ar: '/ar/إتمام-الطلب' } };
  assert.equal(createStoreLinks(null, paths).checkout(), '/checkout');
  assert.equal(createStoreLinks({ code: 'ar', is_default: false }, paths).checkout(), '/ar/إتمام-الطلب');
  assert.equal(createStoreLinks(null, PATHS).checkout(), '#');
});

test('a placed order links to the confirmation page with the checkout id in ?order=, and to nothing when no page has the role', () => {
  const paths = { confirmation: { '*': '/thanks', ar: '/ar/شكرا' } };
  const id = '0b3f6f0e-2a53-4b8a-8f3a-6a0d5d1f5a11';
  assert.equal(createStoreLinks(null, paths).confirmation(id), `/thanks?order=${id}`);
  assert.equal(createStoreLinks({ code: 'ar', is_default: false }, paths).confirmation(id), `/ar/شكرا?order=${id}`);
  assert.equal(createStoreLinks(null, PATHS).confirmation(id), null, 'the checkout then shows the order itself');
});

test('the page settings panel offers all four roles', () => {
  assert.deepEqual([...PANEL_PAGE_KINDS], ['product', 'cart', 'checkout', 'confirmation']);
});

test('a category links to the products page with ?category={id}, with the language\'s prefix, the id escaped (OPEN_QUESTIONS 9 and 55)', () => {
  const id = '25252525-0001-4525-8525-252525252525';
  assert.equal(createStoreLinks(null, {}).category(id), `/products?category=${id}`);
  assert.equal(createStoreLinks({ code: 'ar', is_default: true }, PATHS).category(id), `/products?category=${id}`);
  assert.equal(createStoreLinks({ code: 'en', is_default: false }, PATHS).category(id), `/en/products?category=${id}`);
  assert.equal(createStoreLinks(null, {}).category('a b&c'), '/products?category=a%20b%26c');
});

test('a page with no locale of its own is in the site\'s default language: an Arabic-first site\'s root is Arabic, and links carry no prefix', () => {
  const ar = { code: 'ar', is_default: true };
  const en = { code: 'en', is_default: false };
  assert.equal(pageLocaleOf(null, [en, ar]), ar);
  assert.equal(pageLocaleOf(undefined, [en, ar]), ar);
  assert.equal(pageLocaleOf(en, [en, ar]), en, 'a page under a language\'s prefix keeps its own');
  assert.equal(pageLocaleOf(null, []), null);
  assert.equal(pageLocaleOf(null, undefined), null);
  assert.equal(createStoreLinks(pageLocaleOf(null, [en, ar]), PATHS).product('abc'), '/shop/product/abc');
  assert.equal(createStoreLinks(pageLocaleOf(en, [en, ar]), {}).category('c1'), '/en/products?category=c1');
});
