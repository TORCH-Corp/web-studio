import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isStoreElement, readProductCardSettings, readProductDetailSettings, readProductGridSettings, clampPageSize, cleanCategoryIds, PRODUCT_GRID_DEFAULTS } from './settings';

const A = '25252525-0001-4525-8525-252525252525';
const B = '25252525-0002-4525-8525-252525252525';
const grid = (productGrid: unknown) => ({ settings: { store: { productGrid } } }) as never;
const card = (productCard: unknown) => ({ settings: { store: { productCard } } }) as never;
const detail = (productDetail: unknown) => ({ settings: { store: { productDetail } } }) as never;

test('a grid with no settings is the defaults: twelve a page, search and category filter on, the URL category honoured', () => {
  assert.deepEqual(readProductGridSettings(undefined), PRODUCT_GRID_DEFAULTS);
  assert.deepEqual(readProductGridSettings({ settings: {} }), {
    categories: [],
    pageSize: 12,
    showSearch: true,
    showCategoryFilter: true,
    honourUrlCategory: true,
  });
});

test('a grid keeps what the builder set and turns off what was turned off', () => {
  assert.deepEqual(readProductGridSettings(grid({ categories: [A, B.toUpperCase(), A], pageSize: 24, showSearch: false, showCategoryFilter: false, honourUrlCategory: false })), {
    categories: [A, B],
    pageSize: 24,
    showSearch: false,
    showCategoryFilter: false,
    honourUrlCategory: false,
  });
});

test('the page size is a whole number from 1 to 48, whatever was saved', () => {
  assert.equal(clampPageSize(12), 12);
  assert.equal(clampPageSize(48), 48);
  assert.equal(clampPageSize(49), 48);
  assert.equal(clampPageSize(1000), 48);
  assert.equal(clampPageSize(0), 1);
  assert.equal(clampPageSize(-5), 1);
  assert.equal(clampPageSize(7.6), 8);
  for (const bad of ['12', null, undefined, NaN, Infinity, {}]) assert.equal(clampPageSize(bad), 12);
  assert.equal(readProductGridSettings(grid({ pageSize: 99 })).pageSize, 48);
  assert.equal(readProductGridSettings(grid({ pageSize: 'many' })).pageSize, 12);
});

test('categories are valid ids only, once each, at most 24', () => {
  assert.deepEqual(cleanCategoryIds([A, 'shirts', 3, null, B, A]), [A, B]);
  assert.deepEqual(cleanCategoryIds('not a list'), []);
  const many = Array.from({ length: 30 }, (_, i) => `25252525-00${String(i).padStart(2, '0')}-4525-8525-252525252525`);
  assert.equal(cleanCategoryIds(many).length, 24);
});

test('a flag that is not a boolean falls back to its default', () => {
  const read = readProductGridSettings(grid({ showSearch: 'no', showCategoryFilter: 0, honourUrlCategory: null }));
  assert.deepEqual([read.showSearch, read.showCategoryFilter, read.honourUrlCategory], [true, true, true]);
});

test('a card shows the chosen product, or nothing when none, or one that is not an id', () => {
  assert.deepEqual(readProductCardSettings(undefined), { product: null });
  assert.deepEqual(readProductCardSettings(card({ product: null })), { product: null });
  assert.deepEqual(readProductCardSettings(card({ product: { id: 'lamp', name: 'Lamp' } })), { product: null });
  assert.deepEqual(readProductCardSettings(card({ product: { id: A.toUpperCase(), name: 'Lamp', name_ar: 'مصباح' } })), {
    product: { id: A, name: 'Lamp', name_ar: 'مصباح' },
  });
  assert.deepEqual(readProductCardSettings(card({ product: { id: A } })), { product: { id: A, name: '', name_ar: null } });
});

test('the product page element shows the chosen product only where no URL names one, and reads it as a card does', () => {
  assert.deepEqual(readProductDetailSettings(undefined), { product: null });
  assert.deepEqual(readProductDetailSettings(detail({ product: { id: A.toUpperCase(), name: 'Lamp', name_ar: null } })), { product: { id: A, name: 'Lamp', name_ar: null } });
  assert.deepEqual(readProductDetailSettings(detail({ product: { id: 'lamp' } })), { product: null });
  assert.deepEqual(readProductDetailSettings(card({ product: { id: A } })), { product: null }, 'a card\'s choice is not the page element\'s');
});

test('the four store elements are known by name, nothing else is', () => {
  for (const name of ['productGrid', 'productCard', 'productDetail', 'cartIndicator']) assert.equal(isStoreElement(name), true);
  for (const name of ['button', 'htmlEmbed', 'product', '', undefined, null]) assert.equal(isStoreElement(name), false);
});

test('the cart, checkout and order confirmation are store elements, so every render path draws them', () => {
  for (const name of ['cart', 'checkout', 'orderConfirmation']) assert.equal(isStoreElement(name), true, name);
  assert.equal(isStoreElement('form'), false);
});
