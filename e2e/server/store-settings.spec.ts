/**
 * Part 2, session W1's store settings, against the deployed service and the
 * real Organization Setup and Product & Services (session D1, server mode).
 *
 * GET and PATCH /ycode/api/platform/sites/{id}/store for a site of the test
 * organization: the defaults from the first read, the organization's own active
 * branches and category tree, a branch and categories saved with their names,
 * selling only with a branch, a currency change only with its fee, a branch or
 * category that is not the organization's live one refused. The permission
 * matrix, the second organization, the template and the services-down answers
 * need stubs and stay in the local e2e (e2e/store-settings.spec.ts).
 */

import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createSite, signInWithToken, type SiteRecord } from '../helpers';
import { accessToken, AUTH_URL, deleteSite, ensureStoreItem, STORE_ITEM } from './real-services';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);

interface TreeNode {
  id: string;
  name: string;
  name_ar: string | null;
  item_count: number | null;
  children: TreeNode[];
}
interface BranchRef {
  id: string;
  name: string;
}

let baseURL: string;
let token: string;
let api: APIRequestContext;
let site: SiteRecord;
let second: SiteRecord;
let branches: BranchRef[];
let archivedBranchId: string | undefined;

const url = (id = site.id) => `/ycode/api/platform/sites/${id}/store`;
const read = async (id = site.id) => {
  const response = await api.get(url(id));
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).data;
};
const patch = (data: unknown, id = site.id) => api.patch(url(id), { data });

function find(tree: TreeNode[], id: string): TreeNode | undefined {
  for (const node of tree) {
    if (node.id === id) return node;
    const inside = find(node.children ?? [], id);
    if (inside) return inside;
  }
  return undefined;
}

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  token = await accessToken();
  api = await signInWithToken(baseURL, token);
  await ensureStoreItem(token);

  // An archived branch of the test organization, from Organization Setup itself, when it has one.
  const auth = await request.newContext({ baseURL: AUTH_URL, extraHTTPHeaders: { authorization: `Bearer ${token}` } });
  try {
    const all = (await (await auth.get('/org-setup/branches')).json()) as Array<{ id: string; status: string }>;
    archivedBranchId = all.find((branch) => branch.status === 'archived')?.id;
  } finally {
    await auth.dispose();
  }
  site = await createSite(api, { name: `E2E store settings ${RUN}`, slug: `e2e-set-${RUN}`, languages: ['en'], default_language: 'en' });
  second = await createSite(api, { name: `E2E store settings B ${RUN}`, slug: `e2e-setb-${RUN}`, languages: ['en'], default_language: 'en' });
});

test.afterAll(async () => {
  await deleteSite(api, site);
  await deleteSite(api, second);
  await api?.dispose();
});

test('no session is 401, and a new site has its store from the first read: not selling, IQD, no fee, the real branches and category tree', async () => {
  const anonymous = await request.newContext({ baseURL });
  try {
    expect((await anonymous.get(url())).status()).toBe(401);
    expect((await anonymous.patch(url(), { data: { delivery_fee: 1 } })).status()).toBe(401);
  } finally {
    await anonymous.dispose();
  }

  const settings = await read();
  expect(settings).toMatchObject({
    selling: false,
    currency: 'IQD',
    branch: null,
    branches_error: null,
    categories: [],
    category_tree_error: null,
    delivery_fee: '0.00',
    payment_methods: ['cash_on_delivery'],
  });
  branches = settings.branches;
  expect(branches.length, 'the test organization has active branches').toBeGreaterThan(0);
  // Archived branches are not offered.
  if (archivedBranchId) expect(branches.map((b) => b.id)).not.toContain(archivedBranchId);
  // The fixture item's category is in the real tree, with the items under it counted.
  const category = find(settings.category_tree as TreeNode[], STORE_ITEM.categoryId);
  expect(category, 'the fixture item\'s category is in the tree').toBeTruthy();
  expect(category!.item_count).toBeGreaterThan(0);
});

test('a bad body is refused with the fields named, and nothing changes', async () => {
  const response = await patch({ currency: 'EUR', delivery_fee: '12.345', branch_id: 'headquarters', colour: 'red' });
  expect(response.status()).toBe(400);
  expect((await response.json()).details).toHaveLength(4);
  expect((await patch({ delivery_fee: -1 })).status()).toBe(400);
  expect((await patch('not an object')).status()).toBe(400);
  expect(await read()).toMatchObject({ currency: 'IQD', delivery_fee: '0.00', branch: null });
});

test('a branch, a category and a fee are saved and answered with their names and counts', async () => {
  const branch = branches[0];
  const response = await patch({ branch_id: branch.id, category_ids: [STORE_ITEM.categoryId], delivery_fee: 2500 });
  expect(response.status(), await response.text()).toBe(200);
  const saved = (await response.json()).data;
  expect(saved).toMatchObject({
    selling: false,
    branch: { id: branch.id, name: branch.name, available: true },
    categories: [{ id: STORE_ITEM.categoryId, available: true }],
    delivery_fee: '2500.00',
  });
  expect(saved.categories[0].name).toBeTruthy();
  expect(saved.categories[0].item_count).toBeGreaterThan(0);
  expect(await read()).toEqual(saved);
  // The other site of the organization is untouched.
  expect(await read(second.id)).toMatchObject({ branch: null, categories: [], delivery_fee: '0.00' });
});

test('selling cannot be switched on without a branch, nor the branch cleared while selling', async () => {
  const refused = await patch({ selling: true }, second.id);
  expect(refused.status()).toBe(422);
  expect(await refused.json()).toMatchObject({ code: 'branch_required', field: 'branch_id' });
  expect((await read(second.id)).selling).toBe(false);

  const on = await patch({ selling: true });
  expect(on.status(), await on.text()).toBe(200);
  expect((await on.json()).data.selling).toBe(true);

  const cleared = await patch({ branch_id: null });
  expect(cleared.status()).toBe(422);
  expect((await cleared.json()).code).toBe('branch_required');
  expect(await read()).toMatchObject({ selling: true, branch: { id: branches[0].id } });
});

test('only the organization\'s active branches and live categories are accepted', async () => {
  const unknown = randomUUID();
  for (const branchId of [unknown, ...(archivedBranchId ? [archivedBranchId] : [])]) {
    const response = await patch({ branch_id: branchId });
    expect(response.status(), branchId).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'branch_unavailable', field: 'branch_id', branch_id: branchId });
  }
  const categories = await patch({ category_ids: [STORE_ITEM.categoryId, unknown] });
  expect(categories.status()).toBe(422);
  expect(await categories.json()).toMatchObject({ code: 'categories_unavailable', field: 'category_ids', category_ids: [unknown] });

  // None chosen sells every eligible item.
  const none = await patch({ category_ids: [] });
  expect(none.status(), await none.text()).toBe(200);
  expect((await none.json()).data.categories).toEqual([]);
  expect((await read()).branch.id).toBe(branches[0].id);
});

test('a currency change names the fee in the same request', async () => {
  const alone = await patch({ currency: 'USD' });
  expect(alone.status()).toBe(422);
  expect(await alone.json()).toMatchObject({ code: 'fee_required', field: 'delivery_fee' });
  expect(await read()).toMatchObject({ currency: 'IQD', delivery_fee: '2500.00' });

  const usd = await patch({ currency: 'USD', delivery_fee: '3.5' });
  expect(usd.status(), await usd.text()).toBe(200);
  expect((await usd.json()).data).toMatchObject({ currency: 'USD', delivery_fee: '3.50' });

  const back = await patch({ currency: 'IQD', delivery_fee: 2500 });
  expect((await back.json()).data).toMatchObject({ currency: 'IQD', delivery_fee: '2500.00' });
});
