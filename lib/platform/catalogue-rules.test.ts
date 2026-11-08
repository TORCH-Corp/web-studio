import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildCatalogue,
  candidatesOf,
  categorySummaries,
  needsRate,
  pageOf,
  priceFor,
  showsImage,
  withImages,
  type CatalogueInput,
} from './catalogue-rules';
import type { CatalogueItem, CatalogueVariant, CategoryNode, VariantWorkspace } from './product-services';

const category = (id: string, name: string, children: CategoryNode[] = [], name_ar: string | null = null): CategoryNode => ({
  id, name, name_ar, parent_id: null, archived: false, items_count: 0, children,
});

/** Clothing > Shirts, Home, Garden (outside the site's categories). */
const TREE = [category('clothing', 'Clothing', [category('shirts', 'Shirts', [], 'قمصان')], 'ملابس'), category('home', 'Home', [], 'المنزل'), category('garden', 'Garden')];

const item = (id: string, extra: Partial<CatalogueItem> = {}): CatalogueItem => ({
  id, sku: `SKU-${id}`, name: id, name_ar: null, description: null, description_ar: null, status: 'ACTIVE', base_price: '25000',
  currency: 'IQD', category_id: 'home', parent_item_id: null, has_variants: false, base_uom_id: 'pcs', primary_image_document_id: null, ...extra,
});

const variant = (id: string, size: string, extra: Partial<CatalogueVariant> = {}): CatalogueVariant => ({
  ...item(id, { parent_item_id: 'shirt', category_id: 'shirts', ...extra }),
  axes: [{ specification_id: 'size', specification_name: 'Size', specification_name_ar: 'المقاس', option_id: `size-${size}`, option_label: size, option_label_ar: null }],
});

const SHIRT = item('shirt', { name: 'Linen shirt', name_ar: 'قميص كتان', has_variants: true, base_price: '0', category_id: 'shirts', primary_image_document_id: 'img-shirt' });
const WORKSPACE: VariantWorkspace = {
  axes_summary: [{ specification_id: 'size', specification_code: 'SZ', specification_name: 'Size', specification_name_ar: 'المقاس', options: [{ id: 'size-M', code: 'M', label: 'M', label_ar: null }] }],
  variants: [
    variant('shirt-m', 'M', { status: 'DISCONTINUED', base_price: '30000' }),
    variant('shirt-l', 'L', { base_price: null }),
    variant('shirt-s-blue', 'S', { base_price: '20', currency: 'USD', primary_image_document_id: 'img-blue' }),
    variant('shirt-s-white', 'S', { base_price: '35000' }),
  ],
};

const input = (overrides: Partial<CatalogueInput> = {}): CatalogueInput => ({
  items: [
    item('lamp', { name: 'Desk lamp', name_ar: 'مصباح مكتب', primary_image_document_id: 'img-lamp' }),
    item('sample', { name: 'Free sample', base_price: '0' }),
    item('nothing', { name: 'Unpriced', base_price: null }),
    SHIRT,
    item('shirt-s-blue', { parent_item_id: 'shirt', category_id: 'shirts', base_price: '20', currency: 'USD' }), // a child that still has its own channel row
    item('hose', { name: 'Garden hose', category_id: 'garden' }),
    item('loose', { name: 'No category', category_id: null }),
    item('euro', { name: 'Euro item', currency: 'EUR' }),
  ],
  workspaces: new Map([['shirt', WORKSPACE]]),
  tree: TREE,
  store: { currency: 'IQD', category_ids: ['clothing', 'home'] },
  rate: '1520',
  units: new Map([['pcs', { id: 'pcs', symbol: 'pcs', name: 'Piece' }]]),
  ...overrides,
});

test('a price exists only for an ACTIVE item with a base price above 0, in the site\'s currency or converted at the day\'s rate', () => {
  assert.deepEqual(priceFor({ status: 'ACTIVE', base_price: '25000', currency: 'IQD' }, 'IQD', null), { price: { amount: '25000', currency: 'IQD', converted: false } });
  assert.deepEqual(priceFor({ status: 'ACTIVE', base_price: '20', currency: 'USD' }, 'IQD', '1520'), { price: { amount: '30400', currency: 'IQD', converted: true } });
  assert.deepEqual(priceFor({ status: 'ACTIVE', base_price: '25000', currency: 'IQD' }, 'USD', '1520'), { price: { amount: '16.45', currency: 'USD', converted: true } });
  assert.deepEqual(priceFor({ status: 'ACTIVE', base_price: '20', currency: 'USD' }, 'IQD', null), { reason: 'no_rate' });
  assert.deepEqual(priceFor({ status: 'ACTIVE', base_price: '20', currency: 'EUR' }, 'IQD', '1520'), { reason: 'no_rate' });
  assert.deepEqual(priceFor({ status: 'ACTIVE', base_price: '0', currency: 'IQD' }, 'IQD', null), { reason: 'no_price' });
  assert.deepEqual(priceFor({ status: 'ACTIVE', base_price: null, currency: 'IQD' }, 'IQD', null), { reason: 'no_price' });
  assert.deepEqual(priceFor({ status: 'DISCONTINUED', base_price: '30000', currency: 'IQD' }, 'IQD', null), { reason: 'inactive' });
  assert.deepEqual(priceFor({ status: 'INACTIVE', base_price: null, currency: 'IQD' }, 'IQD', null), { reason: 'inactive' });
});

test('the grid holds plain items and parents in the site\'s categories (and under them), never a child, an unpriced item or one outside', () => {
  const catalogue = buildCatalogue(input());
  assert.deepEqual(catalogue.products.map((p) => p.id), ['lamp', 'shirt']);
  // With no category chosen every eligible item sells, one with no category included.
  const all = buildCatalogue(input({ store: { currency: 'IQD', category_ids: [] } }));
  assert.deepEqual(all.products.map((p) => p.id), ['lamp', 'hose', 'shirt', 'loose']);
  // A chosen subcategory alone covers only itself.
  assert.deepEqual(candidatesOf(input().items, TREE, ['shirts']).map((i) => i.id), ['shirt']);
});

test('a product with variants is priced "from" its lowest available variant, converted where it must be', () => {
  const shirt = buildCatalogue(input()).byId.get('shirt')!;
  assert.deepEqual(shirt.price, { amount: '30400', currency: 'IQD', converted: true, from: true });
  assert.deepEqual(
    shirt.variants.map((v) => [v.id, v.available, v.unavailable_reason, v.price?.amount ?? null]),
    [['shirt-m', false, 'inactive', null], ['shirt-l', false, 'no_price', null], ['shirt-s-blue', true, null, '30400'], ['shirt-s-white', true, null, '35000']],
  );
  assert.deepEqual(shirt.variants[0].axes, [{ specification_id: 'size', option_id: 'size-M', name: 'Size', name_ar: 'المقاس', option: 'M', option_ar: null }]);
  assert.deepEqual(shirt.axes_summary, [{ id: 'size', code: 'SZ', name: 'Size', name_ar: 'المقاس', options: [{ id: 'size-M', code: 'M', label: 'M', label_ar: null }] }]);
  assert.equal(buildCatalogue(input()).byId.get('lamp')!.price.from, false);
});

test('with no rate for the day the variant priced in the other currency becomes unavailable and the "from" price moves', () => {
  const shirt = buildCatalogue(input({ rate: null })).byId.get('shirt')!;
  assert.deepEqual(shirt.price, { amount: '35000', currency: 'IQD', converted: false, from: true });
  assert.deepEqual(shirt.variants.find((v) => v.id === 'shirt-s-blue'), {
    id: 'shirt-s-blue', sku: 'SKU-shirt-s-blue', price: null, available: false, unavailable_reason: 'no_rate',
    image: { document_id: 'img-blue', url: '/store-media/img-blue?item=shirt' },
    axes: [{ specification_id: 'size', option_id: 'size-S', name: 'Size', name_ar: 'المقاس', option: 'S', option_ar: null }],
  });
});

test('a product with variants none of which can be sold is not on sale; one whose workspace is gone neither', () => {
  const noneSellable: VariantWorkspace = { ...WORKSPACE, variants: WORKSPACE.variants.filter((v) => v.id !== 'shirt-s-white') };
  assert.equal(buildCatalogue(input({ rate: null, workspaces: new Map([['shirt', noneSellable]]) })).byId.has('shirt'), false);
  assert.equal(buildCatalogue(input({ workspaces: new Map([['shirt', null]]) })).byId.has('shirt'), false);
  assert.equal(buildCatalogue(input({ workspaces: new Map() })).byId.has('shirt'), false);
});

test('a variant shows its own image, else the product\'s; the unit and the category are named', () => {
  const catalogue = buildCatalogue(input());
  const shirt = catalogue.byId.get('shirt')!;
  assert.deepEqual(shirt.variants.map((v) => v.image?.document_id), ['img-shirt', 'img-shirt', 'img-blue', 'img-shirt']);
  assert.deepEqual(shirt.images, [{ document_id: 'img-shirt', url: '/store-media/img-shirt?item=shirt' }]);
  assert.deepEqual(shirt.unit, { name: 'Piece', symbol: 'pcs' });
  assert.deepEqual(shirt.category, { id: 'shirts', name: 'Shirts', name_ar: 'قمصان' });
  const noUnit = buildCatalogue(input({ units: new Map() })).byId.get('lamp')!;
  assert.equal(noUnit.unit, null);
  assert.deepEqual(noUnit.images, [{ document_id: 'img-lamp', url: '/store-media/img-lamp?item=lamp' }]);
});

test('the rate is needed only when something is priced in the other currency of the two', () => {
  assert.equal(needsRate([{ currency: 'IQD' }], 'IQD'), false);
  assert.equal(needsRate([{ currency: 'IQD' }, { currency: 'USD' }], 'IQD'), true);
  assert.equal(needsRate([{ currency: 'EUR' }], 'IQD'), false);
  assert.equal(needsRate([{ currency: 'IQD' }], 'USD'), true);
});

test('a page filters by category (and under it) and by name in either language, then slices', () => {
  const catalogue = buildCatalogue(input({ store: { currency: 'IQD', category_ids: [] } }));
  assert.deepEqual(pageOf(catalogue, { category: 'clothing', page: 1, pageSize: 12 }).products.map((p) => p.id), ['shirt']);
  assert.deepEqual(pageOf(catalogue, { category: 'garden', page: 1, pageSize: 12 }).products.map((p) => p.id), ['hose']);
  assert.deepEqual(pageOf(catalogue, { category: 'nowhere', page: 1, pageSize: 12 }), { products: [], total: 0 });
  assert.deepEqual(pageOf(catalogue, { search: 'LAMP', page: 1, pageSize: 12 }).products.map((p) => p.id), ['lamp']);
  assert.deepEqual(pageOf(catalogue, { search: ' قميص ', page: 1, pageSize: 12 }).products.map((p) => p.id), ['shirt']);
  const second = pageOf(catalogue, { page: 2, pageSize: 3 });
  assert.deepEqual([second.products.map((p) => p.id), second.total], [['loose'], 4]);
  assert.deepEqual(pageOf(catalogue, { page: 9, pageSize: 3 }).products, []);
});

test('the shop home lists the chosen live categories with what the site sells in each and its first image, or the top level when none is chosen', () => {
  const chosen = buildCatalogue(input({ store: { currency: 'IQD', category_ids: ['home', 'clothing', 'archived-one'] } }));
  assert.deepEqual(categorySummaries(chosen), [
    { id: 'home', name: 'Home', name_ar: 'المنزل', item_count: 1, first_product_image: '/store-media/img-lamp?item=lamp' },
    { id: 'clothing', name: 'Clothing', name_ar: 'ملابس', item_count: 1, first_product_image: '/store-media/img-shirt?item=shirt' },
  ]);
  const all = buildCatalogue(input({ store: { currency: 'IQD', category_ids: [] } }));
  assert.deepEqual(categorySummaries(all).map((c) => [c.id, c.item_count, c.first_product_image]), [
    ['clothing', 1, '/store-media/img-shirt?item=shirt'],
    ['home', 1, '/store-media/img-lamp?item=lamp'],
    ['garden', 1, null],
  ]);
});

test('the product route shows every image, primary first; an image belongs to the product only if it shows it', () => {
  const shirt = buildCatalogue(input()).byId.get('shirt')!;
  const gallery = [
    { document_id: 'img-back', is_primary: false, order_index: 1 },
    { document_id: 'img-side', is_primary: false, order_index: 2 },
  ];
  assert.deepEqual(withImages(shirt, gallery).images.map((i) => i.document_id), ['img-shirt', 'img-back', 'img-side']);
  assert.equal(showsImage(shirt, 'img-shirt', null), true);
  assert.equal(showsImage(shirt, 'img-blue', null), true);
  assert.equal(showsImage(shirt, 'img-back', null), false);
  assert.equal(showsImage(shirt, 'img-back', gallery), true);
  assert.equal(showsImage(shirt, 'img-lamp', gallery), false);
});

test('a page filters by several categories at once: any of them, and under each', () => {
  const catalogue = buildCatalogue(input({ store: { currency: 'IQD', category_ids: [] } }));
  const ids = (categories: string[]) => pageOf(catalogue, { categories, page: 1, pageSize: 12 }).products.map((p) => p.id).sort();
  assert.deepEqual(ids(['clothing', 'garden']), ['hose', 'shirt']);
  assert.deepEqual(ids(['garden']), ['hose']);
  assert.deepEqual(ids(['nowhere']), []);
  // A single category still wins when both are given; an empty list filters nothing.
  assert.deepEqual(pageOf(catalogue, { category: 'garden', categories: ['clothing'], page: 1, pageSize: 12 }).products.map((p) => p.id), ['hose']);
  assert.equal(pageOf(catalogue, { categories: [], page: 1, pageSize: 12 }).total, pageOf(catalogue, { page: 1, pageSize: 12 }).total);
});
