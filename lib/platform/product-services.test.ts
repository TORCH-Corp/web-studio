import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getCategory, getCategoryTree, indexTree, ProductServicesUnavailableError, rollUpTree, type CategoryNode } from './product-services';

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
