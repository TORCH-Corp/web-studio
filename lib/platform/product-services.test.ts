import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getCategory, getCategoryTree, getVariantWorkspace, indexTree, listEcommerceItems, listItemImages, ProductServicesUnavailableError, rollUpTree, type CategoryNode } from './product-services';

const ENV = { PRODUCT_SERVICES_URL: 'http://product-services-service:6024/', PRODUCT_SERVICES_API_KEY: 'k' };
const ORG = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const answer = (status: number, body: unknown) => (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;

/** A node as GET /categories/tree answers it, with the fields Web Studio does not read. */
const node = (id: string, name: string, items: number, children: unknown[] = [], extra: Record<string, unknown> = {}) => ({
  id, name, name_ar: null, description: null, parent_id: null, archived: false, depth: 0, effective_item_level: 3,
  is_folder: children.length > 0, is_leaf: children.length === 0, items_count: items, children_count: children.length,
  created_by: null, updated_by: null, created_at: '2026-11-01T00:00:00.000Z', updated_at: '2026-11-01T00:00:00.000Z', children, ...extra,
});

const TREE = [
  node('household', 'Household', 42, [], { name_ar: 'المنزل' }),
  node('kitchen', 'Kitchen', 0, [node('cookware', 'Cookware', 18, [], { parent_id: 'kitchen' }), node('tableware', 'Tableware', 13, [], { parent_id: 'kitchen' })]),
];

test('the tree is read with the service key and the organization, and keeps names in both languages', async () => {
  let seen: { url: string; key: string | null; entity: string | null } | null = null;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    seen = { url, key: headers.get('x-service-api-key'), entity: headers.get('x-entity-id') };
    return new Response(JSON.stringify({ success: true, data: TREE }));
  }) as unknown as typeof fetch;
  const tree = await getCategoryTree(ORG, ENV, fetchImpl);
  assert.deepEqual(seen, { url: 'http://product-services-service:6024/categories/tree', key: 'k', entity: ORG });
  assert.equal(tree[0].name_ar, 'المنزل');
  assert.equal(tree[1].children.map((c) => c.id).join(), 'cookware,tableware');
});

test('a category\'s count covers everything under it, as the picker shows it', async () => {
  const store = rollUpTree(await getCategoryTree(ORG, ENV, answer(200, { success: true, data: TREE })));
  assert.deepEqual(store, [
    { id: 'household', name: 'Household', name_ar: 'المنزل', item_count: 42, children: [] },
    {
      id: 'kitchen', name: 'Kitchen', name_ar: null, item_count: 31,
      children: [
        { id: 'cookware', name: 'Cookware', name_ar: null, item_count: 18, children: [] },
        { id: 'tableware', name: 'Tableware', name_ar: null, item_count: 13, children: [] },
      ],
    },
  ]);
  const deep: CategoryNode[] = [{ id: 'a', name: 'A', name_ar: null, parent_id: null, archived: false, items_count: 1, children: [{ id: 'b', name: 'B', name_ar: null, parent_id: 'a', archived: false, items_count: 2, children: [{ id: 'c', name: 'C', name_ar: null, parent_id: 'b', archived: false, items_count: 4, children: [] }] }] }];
  const index = indexTree(rollUpTree(deep));
  assert.deepEqual([...index.keys()], ['a', 'b', 'c']);
  assert.equal(index.get('a')!.item_count, 7);
  assert.equal(index.get('b')!.item_count, 6);
});

test('one category by id, archived included; another organization\'s or a missing one is null', async () => {
  const archived = await getCategory(ORG, 'garden', ENV, answer(200, { success: true, data: node('garden', 'Garden', 9, [], { archived: true, name_ar: 'الحديقة' }) }));
  assert.deepEqual(archived, { id: 'garden', name: 'Garden', name_ar: 'الحديقة', archived: true, items_count: 9 });
  assert.equal(await getCategory(ORG, 'gone', ENV, answer(404, { statusCode: 404, error: 'Not Found' })), null);
});

test('Product & Services that cannot be asked is an error that says why, never an empty tree', async () => {
  await assert.rejects(getCategoryTree(ORG, {}, answer(200, { success: true, data: [] })), (e: Error) => e instanceof ProductServicesUnavailableError && /not set/.test(e.message));
  await assert.rejects(getCategoryTree(ORG, ENV, answer(401, { message: 'Invalid service API key' })), /answered 401/);
  await assert.rejects(getCategoryTree(ORG, ENV, answer(404, {})), /answered 404/, 'a missing tree route is not "no categories"');
  await assert.rejects(getCategoryTree(ORG, ENV, answer(200, [])), /unexpected body/);
  await assert.rejects(getCategoryTree(ORG, ENV, answer(200, { success: true, data: {} })), /not a list/);
  await assert.rejects(getCategoryTree(ORG, ENV, answer(200, { success: true, data: [{ id: 'x', name: 'X' }] })), /items_count/);
  await assert.rejects(getCategoryTree(ORG, ENV, answer(200, { success: true, data: [node('x', 'X', 1, [], { children: 'none' })] })), /children/);
  await assert.rejects(getCategory(ORG, 'x', ENV, answer(500, 'boom')), /answered 500/);
  const down = (async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
  await assert.rejects(getCategoryTree(ORG, ENV, down), (e: Error) => e instanceof ProductServicesUnavailableError && /not reachable/.test(e.message));
});

/** A row as GET /items answers it, with internal fields Web Studio must not carry. */
const itemRow = (id: string, extra: Record<string, unknown> = {}) => ({
  id, type: 'PRODUCT_STOCKABLE', name: `Item ${id}`, name_ar: null, sku: `SKU-${id}`, item_code: null, description: null, description_ar: null,
  status: 'ACTIVE', base_uom_id: 'uom-1', base_price: 25000, initial_cost: 9000, currency: 'iqd', category_id: 'c1', parent_item_id: null,
  brand_id: null, primary_image_id: null, primary_image_url: null, has_variants: false, variant_count: 0, created_by: 'u', updated_by: 'u', ...extra,
});

test('the ECOMMERCE items are every ACTIVE row, page by page, with no internal field', async () => {
  const urls: string[] = [];
  const rows = Array.from({ length: 205 }, (_, i) => itemRow(`i${i}`));
  const fetchImpl = (async (url: string) => {
    urls.push(url);
    const query = new URL(url).searchParams;
    const offset = Number(query.get('offset'));
    const limit = Number(query.get('limit'));
    return new Response(JSON.stringify({ success: true, data: rows.slice(offset, offset + limit), meta: { total: rows.length, limit, offset } }));
  }) as unknown as typeof fetch;
  const items = await listEcommerceItems(ORG, ENV, fetchImpl);
  assert.equal(items.length, 205);
  assert.deepEqual(urls, [
    'http://product-services-service:6024/items?channel=ecommerce&status=ACTIVE&limit=200&offset=0',
    'http://product-services-service:6024/items?channel=ecommerce&status=ACTIVE&limit=200&offset=200',
  ]);
  assert.deepEqual(items[0], {
    id: 'i0', sku: 'SKU-i0', name: 'Item i0', name_ar: null, description: null, description_ar: null, status: 'ACTIVE',
    base_price: '25000', currency: 'IQD', category_id: 'c1', parent_item_id: null, has_variants: false, base_uom_id: 'uom-1',
    primary_image_document_id: null,
  });
  assert.equal('initial_cost' in items[0], false);
});

test('an item\'s image is the document id inside its primary_image_url; a price may be null, never negative', async () => {
  const doc = 'c00cac12-a315-45dd-81ba-0d9f8193ac93';
  const page = (data: unknown[]) => answer(200, { success: true, data, meta: { total: data.length, limit: 200, offset: 0 } });
  const [item] = await listEcommerceItems(ORG, ENV, page([itemRow('a', { primary_image_url: `/items/a/documents/${doc}/content`, base_price: null, has_variants: true })]));
  assert.equal(item.primary_image_document_id, doc);
  assert.equal(item.base_price, null);
  assert.equal(item.has_variants, true);
  await assert.rejects(listEcommerceItems(ORG, ENV, page([itemRow('a', { base_price: -1 })])), ProductServicesUnavailableError);
  await assert.rejects(listEcommerceItems(ORG, ENV, page([itemRow('a', { sku: undefined })])), /no sku/);
  await assert.rejects(listEcommerceItems(ORG, ENV, answer(200, { success: true, data: [] })), /total/);
  await assert.rejects(listEcommerceItems(ORG, ENV, answer(200, { success: true, data: [], meta: { total: 3, limit: 200, offset: 0 } })), /empty page/);
});

test('a workspace gives the axes in both languages and each variant with its own axes; Arabic absent before P1 reads as null', async () => {
  const axis = { specification_id: 's1', specification_name: 'Size', specification_name_ar: 'المقاس', option_id: 'o1', option_code: 'M', option_label: 'Medium', option_label_ar: 'وسط' };
  const before = { specification_id: 's1', specification_name: 'Size', option_id: 'o1', option_code: 'M', option_label: 'Medium' };
  const body = (variantAxis: unknown) => ({
    success: true,
    data: {
      parent: itemRow('p', { has_variants: true, base_price: 0 }),
      axes_summary: [{ specification_id: 's1', specification_code: 'SZ', specification_name: 'Size', specification_name_ar: 'المقاس', options: [{ id: 'o1', code: 'M', label: 'Medium', label_ar: 'وسط' }] }],
      variant_count: 1,
      variants: [{ ...itemRow('v1', { parent_item_id: 'p' }), primary_barcode: null, axes: [variantAxis] }],
    },
  });
  const workspace = (await getVariantWorkspace(ORG, 'p', ENV, answer(200, body(axis))))!;
  assert.deepEqual(workspace.axes_summary[0].options, [{ id: 'o1', code: 'M', label: 'Medium', label_ar: 'وسط' }]);
  assert.deepEqual(workspace.variants[0].axes, [{ specification_id: 's1', specification_name: 'Size', specification_name_ar: 'المقاس', option_id: 'o1', option_label: 'Medium', option_label_ar: 'وسط' }]);
  assert.equal(workspace.variants[0].parent_item_id, 'p');
  const old = (await getVariantWorkspace(ORG, 'p', ENV, answer(200, body(before))))!;
  assert.equal(old.variants[0].axes[0].option_label_ar, null);
  assert.equal(await getVariantWorkspace(ORG, 'gone', ENV, answer(404, { statusCode: 404 })), null);
});

test('an item\'s images are its product_image documents, the primary first, then in their order', async () => {
  const doc = (id: string, primary: boolean, order: number) => ({ id, document_id: id, link_type: 'product_image', content_type: 'image/jpeg', is_primary: primary, order_index: order, url: `/items/a/documents/${id}/content` });
  const images = await listItemImages(ORG, 'a', ENV, answer(200, { success: true, data: { product_image: [doc('d3', false, 2), doc('d1', false, 1), doc('d2', true, 5)], specification: [doc('spec', false, 0)] } }));
  assert.deepEqual(images!.map((i) => i.document_id), ['d2', 'd1', 'd3']);
  assert.deepEqual(await listItemImages(ORG, 'a', ENV, answer(200, { success: true, data: { specification: [] } })), []);
  assert.equal(await listItemImages(ORG, 'gone', ENV, answer(404, {})), null);
});
