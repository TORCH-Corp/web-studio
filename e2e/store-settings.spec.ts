/**
 * Part 2, session W1 "done when": a site's store settings.
 *
 * GET and PATCH /ycode/api/platform/sites/{id}/store with the platform stub
 * (e2e/platform-stub.ts) standing in for Organization Setup's branches and
 * Product & Services' category tree: the defaults from the first read, the
 * branch and categories checked against the organization's own, selling only
 * with a branch, a currency change only with its fee, values that became
 * unavailable kept and marked, the services down, and a template that never
 * sells and whose store a copy does not inherit.
 */

import { expect, request, test, type APIRequestContext } from '@playwright/test';
import knex, { type Knex } from 'knex';
import { createSite, signIn, TEMPLATES_ORG, type SiteRecord } from './helpers';
import { BRANCH, CATEGORY, OTHER_STORE_ORG, STORE_ORG } from './platform-fixtures';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const USER = { sub: '35353535-3535-4535-8535-353535353535', email: 'owner-store@example.com', name: 'Store Owner', org: STORE_ORG };
const STRANGER = { sub: '36363636-3636-4636-8636-363636363636', email: 'owner-other@example.com', name: 'Other Owner', org: OTHER_STORE_ORG };
const TEMPLATE_AUTHOR = { sub: '37373737-3737-4737-8737-373737373737', email: 'templates@example.com', name: 'Template Author', org: TEMPLATES_ORG };
const PLATFORM = `http://127.0.0.1:${Number(process.env.E2E_PLATFORM_PORT || Number(process.env.E2E_PORT || 3102) + 3)}`;
const DELETED_CATEGORY = '27272727-0001-4727-8727-272727272727';

const TREE = [
  { id: CATEGORY.household, name: 'Household', name_ar: 'المنزل', item_count: 42, children: [] },
  {
    id: CATEGORY.kitchen, name: 'Kitchen', name_ar: 'المطبخ', item_count: 31,
    children: [
      { id: CATEGORY.cookware, name: 'Cookware', name_ar: 'أدوات الطبخ', item_count: 18, children: [] },
      { id: CATEGORY.tableware, name: 'Tableware', name_ar: 'أدوات المائدة', item_count: 13, children: [] },
    ],
  },
  { id: CATEGORY.electronics, name: 'Electronics', name_ar: null, item_count: 24, children: [] },
];
const BRANCHES = [
  { id: BRANCH.karrada, name: 'Baghdad — Karrada' },
  { id: BRANCH.basra, name: 'Basra warehouse' },
];

let baseURL: string;
let api: APIRequestContext;
let stranger: APIRequestContext;
let db: Knex;
let site: SiteRecord;
let second: SiteRecord;

const url = (id = site.id) => `/ycode/api/platform/sites/${id}/store`;
const read = async (id = site.id) => {
  const response = await api.get(url(id));
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).data;
};
const patch = (data: unknown, id = site.id, as = api) => as.patch(url(id), { data });
const storeRow = (id: string) => db('platform_site_store').where({ site_id: id }).first();

async function servicesDown(services: Array<'org-setup' | 'product-services'>): Promise<void> {
  const control = await request.newContext();
  try {
    expect((await control.post(`${PLATFORM}/__down`, { data: { services } })).status()).toBe(200);
  } finally {
    await control.dispose();
  }
}

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  db = knex({ client: 'pg', connection: process.env.DATABASE_URL_TEST });
  await servicesDown([]);
  api = await signIn(baseURL, USER);
  stranger = await signIn(baseURL, STRANGER);
  site = await createSite(api, { name: 'Al Noor Store', slug: `store-${RUN}`, languages: ['ar', 'en'], default_language: 'ar' });
  second = await createSite(api, { name: 'Second Store', slug: `store2-${RUN}`, languages: ['en'], default_language: 'en' });
});

test.afterAll(async () => {
  await servicesDown([]);
  await api?.dispose();
  await stranger?.dispose();
  await db?.destroy();
});

test('a new site has its store from the first read: not selling, IQD, no fee, the organization\'s branches and category tree', async () => {
  expect(await storeRow(site.id)).toBeUndefined();
  expect(await read()).toEqual({
    selling: false,
    currency: 'IQD',
    branch: null,
    branches: BRANCHES,
    branches_error: null,
    categories: [],
    category_tree: TREE,
    category_tree_error: null,
    delivery_fee: '0.00',
    payment_methods: ['cash_on_delivery'],
  });
  expect(await storeRow(site.id)).toMatchObject({ selling: false, currency: 'IQD', branch_id: null, category_ids: [], delivery_fee: '0.00', updated_by: null });
});

test('no session is 401, another organization\'s site is 404, a Viewer reads and cannot change', async () => {
  const anonymous = await request.newContext({ baseURL });
  expect((await anonymous.get(url())).status()).toBe(401);
  expect((await anonymous.patch(url(), { data: { delivery_fee: 1 } })).status()).toBe(401);
  await anonymous.dispose();

  expect((await stranger.get(url())).status()).toBe(404);
  expect((await patch({ delivery_fee: 1 }, site.id, stranger)).status()).toBe(404);

  const viewer = await signIn(baseURL, { ...USER, perms: { 'webstudio.manage_sites': ['r'], 'webstudio.manage_content': ['r'] } });
  try {
    expect((await viewer.get(url())).status()).toBe(200);
    const refused = await patch({ delivery_fee: 1 }, site.id, viewer);
    expect(refused.status()).toBe(403);
    expect((await refused.json()).required).toBe('webstudio.manage_sites.u');
  } finally {
    await viewer.dispose();
  }
  expect((await read()).delivery_fee).toBe('0.00');
});

test('a bad body is refused with the fields named, and nothing changes', async () => {
  const response = await patch({ currency: 'EUR', delivery_fee: '12.345', branch_id: 'karrada', colour: 'red' });
  expect(response.status()).toBe(400);
  expect((await response.json()).details).toHaveLength(4);
  expect((await patch({ delivery_fee: -1 })).status()).toBe(400);
  expect((await patch('not an object')).status()).toBe(400);
  expect(await read()).toMatchObject({ currency: 'IQD', delivery_fee: '0.00', branch: null });
});

test('a branch, two categories and a fee are saved and answered with their names and counts', async () => {
  const response = await patch({ branch_id: BRANCH.karrada, category_ids: [CATEGORY.kitchen, CATEGORY.household], delivery_fee: 2500 });
  expect(response.status(), await response.text()).toBe(200);
  const saved = (await response.json()).data;
  expect(saved).toMatchObject({
    selling: false,
    branch: { id: BRANCH.karrada, name: 'Baghdad — Karrada', available: true },
    categories: [
      { id: CATEGORY.kitchen, name: 'Kitchen', name_ar: 'المطبخ', item_count: 31, available: true },
      { id: CATEGORY.household, name: 'Household', name_ar: 'المنزل', item_count: 42, available: true },
    ],
    delivery_fee: '2500.00',
  });
  expect(await read()).toEqual(saved);
  expect(await storeRow(site.id)).toMatchObject({ branch_id: BRANCH.karrada, category_ids: [CATEGORY.kitchen, CATEGORY.household], delivery_fee: '2500.00', updated_by: USER.sub });
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
  expect(await read()).toMatchObject({ selling: true, branch: { id: BRANCH.karrada } });
});

test('only the organization\'s active branches and live categories are accepted', async () => {
  for (const branchId of [BRANCH.otherOrg, BRANCH.erbilArchived, '15151515-0099-4515-8515-151515151515']) {
    const response = await patch({ branch_id: branchId });
    expect(response.status(), branchId).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'branch_unavailable', field: 'branch_id', branch_id: branchId });
  }
  const moved = await patch({ branch_id: BRANCH.basra });
  expect(moved.status(), await moved.text()).toBe(200);
  expect((await moved.json()).data.branch).toEqual({ id: BRANCH.basra, name: 'Basra warehouse', available: true });

  const categories = await patch({ category_ids: [CATEGORY.kitchen, CATEGORY.otherOrg, CATEGORY.gardenArchived] });
  expect(categories.status()).toBe(422);
  expect(await categories.json()).toMatchObject({ code: 'categories_unavailable', field: 'category_ids', category_ids: [CATEGORY.otherOrg, CATEGORY.gardenArchived] });

  // A sub-category is a category like any other; none chosen sells every eligible item.
  const child = await patch({ category_ids: [CATEGORY.cookware] });
  expect(child.status(), await child.text()).toBe(200);
  expect((await child.json()).data.categories).toEqual([{ id: CATEGORY.cookware, name: 'Cookware', name_ar: 'أدوات الطبخ', item_count: 18, available: true }]);
  const none = await patch({ category_ids: [] });
  expect((await none.json()).data.categories).toEqual([]);
  expect((await read()).branch.id).toBe(BRANCH.basra);
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

test('a branch or category that became unavailable stays, marked; a save checks only what it changes', async () => {
  // Archived or deleted in their services after they were chosen.
  await db('platform_site_store').where({ site_id: second.id }).update({ branch_id: BRANCH.erbilArchived, category_ids: [CATEGORY.kitchen, CATEGORY.gardenArchived, DELETED_CATEGORY] });
  const before = await read(second.id);
  expect(before.branch).toEqual({ id: BRANCH.erbilArchived, name: 'Erbil branch', available: false });
  expect(before.categories).toEqual([
    { id: CATEGORY.kitchen, name: 'Kitchen', name_ar: 'المطبخ', item_count: 31, available: true },
    { id: CATEGORY.gardenArchived, name: 'Garden', name_ar: 'الحديقة', item_count: null, available: false },
    { id: DELETED_CATEGORY, name: null, name_ar: null, item_count: null, available: false },
  ]);

  // The screen sends the whole form back with a new fee: saved, the unavailable values kept.
  const fee = await patch({ selling: false, currency: 'IQD', branch_id: BRANCH.erbilArchived, category_ids: [CATEGORY.kitchen, CATEGORY.gardenArchived, DELETED_CATEGORY], delivery_fee: 1000 }, second.id);
  expect(fee.status(), await fee.text()).toBe(200);
  expect((await fee.json()).data).toMatchObject({ delivery_fee: '1000.00', branch: { id: BRANCH.erbilArchived, available: false } });
  expect((await read(second.id)).categories).toHaveLength(3);

  // Switching selling on checks the stored branch.
  const on = await patch({ selling: true }, second.id);
  expect(on.status()).toBe(422);
  expect(await on.json()).toMatchObject({ code: 'branch_unavailable', branch_id: BRANCH.erbilArchived });
  const onWithBranch = await patch({ selling: true, branch_id: BRANCH.karrada }, second.id);
  expect(onWithBranch.status(), await onWithBranch.text()).toBe(200);
  expect((await onWithBranch.json()).data).toMatchObject({ selling: true, branch: { id: BRANCH.karrada, available: true } });
});

test('with the services down the read still answers with the stored values, and a change they must check is 503', async () => {
  await servicesDown(['org-setup', 'product-services']);
  try {
    const settings = await read();
    expect(settings).toMatchObject({
      selling: true,
      currency: 'IQD',
      branch: { id: BRANCH.basra, name: null, available: null },
      branches: null,
      category_tree: null,
      delivery_fee: '2500.00',
    });
    expect(settings.branches_error).toMatch(/Organization Setup answered 503/);
    expect(settings.category_tree_error).toMatch(/Product & Services answered 503/);

    const branch = await patch({ branch_id: BRANCH.karrada });
    expect(branch.status()).toBe(503);
    expect(await branch.json()).toMatchObject({ code: 'org_setup_unavailable', field: 'branch_id' });
    const categories = await patch({ category_ids: [CATEGORY.electronics] });
    expect(categories.status()).toBe(503);
    expect(await categories.json()).toMatchObject({ code: 'product_services_unavailable', field: 'category_ids' });

    // Nothing to check: saved.
    const fee = await patch({ delivery_fee: 3000 });
    expect(fee.status(), await fee.text()).toBe(200);
    expect((await fee.json()).data.delivery_fee).toBe('3000.00');
  } finally {
    await servicesDown([]);
  }
  expect(await read()).toMatchObject({ branch: { id: BRANCH.basra, name: 'Basra warehouse', available: true }, categories: [], delivery_fee: '3000.00' });
});

test('a template never sells, and a site copied from it starts with the defaults', async () => {
  const author = await signIn(baseURL, TEMPLATE_AUTHOR);
  let template: SiteRecord | undefined;
  try {
    template = await createSite(author, { name: 'Store template', slug: `store-tpl-${RUN}`, languages: ['en'], default_language: 'en', is_template: true });
    expect((await author.get(url(template.id))).status()).toBe(200);
    for (const body of [{ delivery_fee: 1 }, { selling: true, branch_id: BRANCH.karrada }]) {
      const refused = await patch(body, template.id, author);
      expect(refused.status()).toBe(403);
      expect((await refused.json()).code).toBe('template');
    }

    // Whatever the template's row holds is not copied.
    await db('platform_site_store').where({ site_id: template.id }).update({ delivery_fee: 999, category_ids: [CATEGORY.household] });
    const copy = await createSite(api, { name: 'From the template', slug: `store-copy-${RUN}`, languages: ['en'], default_language: 'en', template_id: template.id });
    expect(await storeRow(copy.id)).toBeUndefined();
    expect(await read(copy.id)).toMatchObject({ selling: false, currency: 'IQD', branch: null, categories: [], delivery_fee: '0.00' });
  } finally {
    // TORCH's template list is templates.spec.ts' to check: leave only the seeded three in it.
    if (template) expect((await author.delete(`/ycode/api/platform/sites/${template.id}`)).ok()).toBe(true);
    await author.dispose();
  }
});
