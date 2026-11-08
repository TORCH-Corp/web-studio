import assert from 'node:assert/strict';
import { test } from 'node:test';

import { storeElementHtml } from './html';

const GRID = { name: 'productGrid', settings: { store: { productGrid: { pageSize: 4 } } } };
const CARD = (product: unknown) => ({ name: 'productCard', settings: { store: { productCard: { product } } } });
const ID = '25252525-0001-4525-8525-252525252525';

test('the grid\'s shell is its wrapper with the layer\'s attributes, the stylesheet and font, and a skeleton the size of a page, at most eight', () => {
  const html = storeElementHtml({ layer: GRID, attrs: ['data-layer-id="g1"', 'class="w-full mt-4"'] });
  assert.match(html, /^<div class="w-full mt-4 ws-store" data-layer-id="g1"|^<div data-layer-id="g1" class="w-full mt-4 ws-store"/);
  assert.ok(html.includes('data-ws-store="productGrid"') && html.includes('dir="ltr"') && html.includes('lang="en"'));
  assert.ok(html.includes('<link rel="stylesheet" href="/ycode/api/store/font">'));
  assert.ok(html.includes('<style>') && html.includes('.ws-store{'));
  assert.equal(html.split('class="ws-sk ws-sk-media"').length - 1, 4);
  assert.ok(html.includes('role="status">Loading products…'));
  assert.equal(storeElementHtml({ layer: { name: 'productGrid' }, attrs: [] }).split('class="ws-sk ws-sk-media"').length - 1, 8);
  assert.ok(!html.includes('Google') && !html.includes('googleapis'), 'no font from a public CDN');
});

test('an Arabic page gets an Arabic, right to left shell', () => {
  const html = storeElementHtml({ layer: GRID, attrs: [], locale: { code: 'ar', is_default: true } });
  assert.ok(html.includes('dir="rtl"') && html.includes('lang="ar"') && html.includes('جارٍ تحميل المنتجات…'));
  assert.ok(html.startsWith('<div class="ws-store"'), 'a layer with no class still gets the store class');
});

test('a lone card is a skeleton card when a product is chosen and nothing when none is', () => {
  assert.equal(storeElementHtml({ layer: CARD(null), attrs: [] }), '');
  assert.equal(storeElementHtml({ layer: { name: 'productCard' }, attrs: [] }), '');
  const html = storeElementHtml({ layer: CARD({ id: ID, name: 'Lamp' }), attrs: ['class="x"'] });
  assert.equal(html.split('class="ws-sk ws-sk-media"').length - 1, 1);
});

test('the cart indicator is the empty cart linking to the cart page, under the language\'s prefix', () => {
  const html = storeElementHtml({ layer: { name: 'cartIndicator' }, attrs: [], locale: { code: 'en', is_default: false } });
  assert.ok(html.includes('href="/en/cart"') && html.includes('aria-label="Cart is empty"') && !html.includes('<span class="ws-badge"'));
});

test('an attribute value is escaped and a layer that is not a store element is not drawn', () => {
  const html = storeElementHtml({ layer: { name: 'cartIndicator' }, attrs: ['class="a&quot;b"'] });
  assert.ok(html.includes('class="a&quot;b ws-store"'));
  assert.equal(storeElementHtml({ layer: { name: 'button' }, attrs: [] }), '');
});

test('a static export has no platform to fetch a font from, so its shell links none', () => {
  const html = storeElementHtml({ layer: GRID, attrs: [], staticExport: true });
  assert.ok(!html.includes('<link') && !html.includes('/ycode/api/store/font'));
  assert.ok(html.includes('<style>') && html.includes('data-ws-store="productGrid"'));
});
