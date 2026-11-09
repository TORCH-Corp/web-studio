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

test('a lone card is a skeleton card, with a product chosen or with none: an unpicked card shows one of the store\'s first products (OPEN_QUESTIONS 58)', () => {
  for (const layer of [CARD({ id: ID, name: 'Lamp' }), CARD(null), { name: 'productCard' }]) {
    const html = storeElementHtml({ layer, attrs: ['class="x"'] });
    assert.ok(html.includes('data-ws-store="productCard"'));
    assert.equal(html.split('class="ws-sk ws-sk-media"').length - 1, 1);
  }
});

test('a grid that shows its count keeps the count\'s line, empty, above the skeleton; one that does not has no such line (OPEN_QUESTIONS 57)', () => {
  const counted = storeElementHtml({ layer: { name: 'productGrid', settings: { store: { productGrid: { showCount: true } } } }, attrs: [] });
  assert.ok(counted.includes('<div class="ws-grid-root"><p class="ws-muted ws-count" aria-hidden="true">&nbsp;</p>'));
  assert.ok(!storeElementHtml({ layer: GRID, attrs: [] }).includes('class="ws-muted ws-count"'));
});

test('the category cards are a skeleton of three cards, in the page\'s language (OPEN_QUESTIONS 55)', () => {
  const html = storeElementHtml({ layer: { name: 'categoryCards' }, attrs: ['class="w-full"'] });
  assert.ok(html.includes('data-ws-store="categoryCards"') && html.includes('class="ws-cats"') && html.includes('aria-busy="true"'));
  assert.ok(html.includes('role="status">Loading the categories…'));
  assert.equal(html.split('class="ws-sk ws-sk-media ws-ph-cat"').length - 1, 3);
  const arabic = storeElementHtml({ layer: { name: 'categoryCards' }, attrs: [], locale: { code: 'ar', is_default: true } });
  assert.ok(arabic.includes('dir="rtl"') && arabic.includes('جارٍ تحميل الأقسام…'));
});

test('the cart indicator is the empty cart; the shell knows no store pages, so it links nowhere', () => {
  const html = storeElementHtml({ layer: { name: 'cartIndicator' }, attrs: [], locale: { code: 'en', is_default: false } });
  assert.ok(html.includes('href="#"') && html.includes('aria-label="Cart is empty"') && !html.includes('<span class="ws-badge"'));
});

test('the product page element is a skeleton of the page: gallery, name, price, options and button, in the page\'s language', () => {
  const html = storeElementHtml({ layer: { name: 'productDetail' }, attrs: ['class="w-full"'] });
  assert.ok(html.includes('data-ws-store="productDetail"') && html.includes('class="ws-pd"') && html.includes('aria-busy="true"'));
  // The breadcrumb's place is kept above the product, so nothing moves when the product arrives.
  assert.ok(html.includes('<div class="ws-crumbs" aria-hidden="true"><div class="ws-sk ws-sk-line ws-sk-crumbs"></div></div><div class="ws-pd"'));
  assert.ok(html.includes('role="status">Loading the product…'));
  assert.equal(html.split('class="ws-sk ws-sk-thumb"').length - 1, 4);
  assert.ok(html.includes('class="ws-sk ws-sk-chip"') && html.includes('class="ws-sk ws-sk-btn"'));
  const arabic = storeElementHtml({ layer: { name: 'productDetail' }, attrs: [], locale: { code: 'ar', is_default: true } });
  assert.ok(arabic.includes('dir="rtl"') && arabic.includes('جارٍ تحميل المنتج…'));
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

test('the cart, checkout and confirmation elements are skeletons of their pages, in the page\'s language', () => {
  const cart = storeElementHtml({ layer: { name: 'cart' }, attrs: ['class="w-full"'] });
  assert.ok(cart.includes('data-ws-store="cart"') && cart.includes('class="ws-cart-page"') && cart.includes('aria-busy="true"'));
  assert.ok(cart.includes('role="status">Loading your cart…') && cart.includes('>Shopping cart<'));
  assert.equal(cart.split('class="ws-sk-row"').length - 1, 3);

  const checkout = storeElementHtml({ layer: { name: 'checkout' }, attrs: [] });
  assert.ok(checkout.includes('data-ws-store="checkout"') && checkout.includes('class="ws-checkout-page"') && checkout.includes('role="status">Loading the checkout…'));
  assert.equal(checkout.split('class="ws-sk ws-sk-block"').length - 1, 4);

  const confirmation = storeElementHtml({ layer: { name: 'orderConfirmation' }, attrs: [], locale: { code: 'ar', is_default: true } });
  assert.ok(confirmation.includes('data-ws-store="orderConfirmation"') && confirmation.includes('dir="rtl"') && confirmation.includes('جارٍ تحميل طلبك…'));
  assert.ok(!cart.includes('Google') && !checkout.includes('googleapis'));
});
