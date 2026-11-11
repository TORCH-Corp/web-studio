/**
 * Part 3, session W2 "done when": Collections on the port, for every site and with no flag.
 *
 * A user creates a collection with fields in the builder, adds two items, binds a list to it on a page and gives the
 * collection an item page; the site publishes in English and Arabic, and a visitor reads both items on the list page and
 * each on its own page, in both languages. A second site has none of it: its own collections list is empty, a page there
 * that points at the first site's collection draws nothing, and the first site's collection is not reachable from it. One
 * editor at a time holds the site: a second user reads the collections and cannot change them, and a user who may only
 * read content cannot create one.
 */

import { chromium, expect, request, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { createSite, draftPages, openSite, publish, signIn, TEST_SITES_DOMAIN, type SiteRecord } from './helpers';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const PORT = Number(process.env.E2E_PORT || 3102);
const ORG = '7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a';
const OWNER = { sub: '7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b', email: 'owner-collections@example.com', name: 'Owner Collections', org: ORG };
/** May change content, but the site is held by the owner. */
const SECOND = { sub: '7c7c7c7c-7c7c-4c7c-8c7c-7c7c7c7c7c7c', email: 'second-collections@example.com', name: 'Second Editor', org: ORG };
/** May open the site and only read its content. */
const VIEWER = { sub: '7d7d7d7d-7d7d-4d7d-8d7d-7d7d7d7d7d7d', email: 'viewer-collections@example.com', name: 'Viewer', org: ORG, perms: { 'webstudio.manage_sites': ['r'], 'webstudio.manage_content': ['r'] } };

const PEOPLE = [
  { name: 'Sara Ali', slug: 'sara-ali', role: 'Designer', city: 'Baghdad', ar: { name: 'سارة علي', role: 'مصممة', city: 'بغداد' } },
  { name: 'Omar Hassan', slug: 'omar-hassan', role: 'Engineer', city: 'Basra', ar: { name: 'عمر حسن', role: 'مهندس', city: 'البصرة' } },
];

interface Field { id: string; key: string | null; name: string; type: string }
interface Item { id: string; values: Record<string, string> }
interface Layer { id: string; name: string; children?: Layer[]; variables?: Record<string, unknown> }

let baseURL: string;
let owner: APIRequestContext;
let otherOwner: APIRequestContext;
let siteA: SiteRecord;
let siteB: SiteRecord;
let browser: Browser;
let storageA: Awaited<ReturnType<APIRequestContext['storageState']>>;
let collectionId: string;

const hostOf = (site: SiteRecord) => site.hosts[0];

async function collectionsOf(api: APIRequestContext) {
  const response = await api.get('/ycode/api/collections');
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).data as Array<{ id: string; name: string }>;
}
async function fieldsOf(api: APIRequestContext, id: string): Promise<Field[]> {
  const response = await api.get(`/ycode/api/collections/${id}/fields`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).data as Field[];
}
async function itemsOf(api: APIRequestContext, id: string): Promise<Item[]> {
  const response = await api.get(`/ycode/api/collections/${id}/items?limit=50`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).data.items as Item[];
}
async function homeLayers(api: APIRequestContext): Promise<{ id: string; layers: Layer[] }> {
  const home = (await draftPages(api)).find((page) => page.is_index)!;
  const response = await api.get(`/ycode/api/layers?page_id=${home.id}`);
  expect(response.status(), await response.text()).toBe(200);
  return { id: home.id, layers: (await response.json()).data.layers as Layer[] };
}

/** The HTML a visitor gets for a path on a site, by host, and its status. */
async function published(site: SiteRecord, path: string): Promise<{ status: number; html: string }> {
  const visitor = await request.newContext({ baseURL, extraHTTPHeaders: { 'x-forwarded-host': hostOf(site) } });
  try {
    const response = await visitor.get(path, { maxRedirects: 0 });
    return { status: response.status(), html: await response.text() };
  } finally {
    await visitor.dispose();
  }
}
const bodyOf = (html: string) => html.slice(html.indexOf('<body'));

/** Type into the item sheet and press Create. The sheet fills the slug from the name a moment after it is typed. */
async function createItem(page: Page, person: typeof PEOPLE[number]): Promise<void> {
  await page.getByPlaceholder('Enter name...').fill(person.name);
  await expect(page.getByPlaceholder('Enter slug...')).toHaveValue(person.slug);
  await page.getByPlaceholder('Enter role...').fill(person.role);
  await page.getByPlaceholder('Enter city...').fill(person.city);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
}

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  owner = await signIn(baseURL, OWNER);
  otherOwner = await signIn(baseURL, OWNER);
  siteA = await createSite(owner, { name: 'Collections A', slug: `coll-a-${RUN}`, languages: ['en', 'ar'], default_language: 'en' });
  siteB = await createSite(otherOwner, { name: 'Collections B', slug: `coll-b-${RUN}`, languages: ['en', 'ar'], default_language: 'en' });
  expect((await openSite(owner, siteA.id)).status()).toBe(303);
  expect((await openSite(otherOwner, siteB.id)).status()).toBe(303);
  storageA = await owner.storageState();
  browser = await chromium.launch({ args: [`--host-resolver-rules=MAP *.${TEST_SITES_DOMAIN} 127.0.0.1`] });
});

test.afterAll(async () => {
  await browser?.close();
  for (const [api, site] of [[owner, siteA], [otherOwner, siteB]] as const) {
    if (site) await api.delete(`/ycode/api/platform/sites/${site.id}`);
    await api?.dispose();
  }
});

test('a user creates a collection with two fields and adds two items in the builder', async ({ browser: builderBrowser }) => {
  const context = await builderBrowser.newContext({ baseURL, storageState: storageA, viewport: { width: 1600, height: 1000 } });
  const failed: string[] = [];
  try {
    const page = await context.newPage();
    page.on('response', (response) => {
      // The AI chat the builder asks for on start is a known 404 (offline.spec.ts).
      if (response.status() >= 400 && !/\/ycode\/api\/ai\/chats\//.test(response.url())) failed.push(`${response.status()} ${response.url()}`);
    });
    await page.goto(`/ycode/api/platform/sites/${siteA.id}/open`);
    await expect(page.getByRole('button', { name: 'CMS', exact: true })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'CMS', exact: true }).click();
    await expect(page).toHaveURL(/\/ycode\/collections$/);
    await expect(page.getByText('No collections yet.')).toBeVisible();

    await page.locator('header, div').filter({ hasText: /^Collections$/ }).locator('button').first().click();
    await page.getByRole('menuitem', { name: 'New collection' }).click();
    await expect(page.getByRole('button', { name: 'Add field' })).toBeVisible();

    for (const name of ['Role', 'City']) {
      await page.getByRole('button', { name: 'Add field' }).click();
      await page.getByPlaceholder('Field name').fill(name);
      await page.getByRole('button', { name: 'Create field' }).click();
      await expect(page.getByRole('columnheader', { name })).toBeVisible();
    }

    // The collection is saved by now; the sheet below is the one the New Item button opens.
    await expect.poll(async () => (await collectionsOf(owner)).length, { timeout: 15_000 }).toBe(1);
    collectionId = (await collectionsOf(owner))[0].id;
    await page.getByRole('button', { name: 'New Item' }).click();
    for (const person of PEOPLE) await createItem(page, person);
    // The item row is made first and its values after it: wait for the values, with the page still open, never for the row alone.
    const fields = await fieldsOf(owner, collectionId);
    expect(fields.filter((field) => ['Name', 'Slug', 'Role', 'City'].includes(field.name)).map((field) => field.name).sort()).toEqual(['City', 'Name', 'Role', 'Slug']);
    const valueOf = (item: Item, name: string) => item.values[fields.find((field) => field.name === name)!.id];
    await expect.poll(async () => (await itemsOf(owner, collectionId)).map((item) => [valueOf(item, 'Name'), valueOf(item, 'Slug'), valueOf(item, 'Role'), valueOf(item, 'City')]).sort(), { timeout: 15_000 }).toEqual(
      PEOPLE.map((person) => [person.name, person.slug, person.role, person.city]).sort()
    );
    expect(failed, 'no request of the Collections screen failed').toEqual([]);
  } finally {
    await context.close();
  }
});

test('a list is bound to the collection on the home page, and each item has its own page', async ({ browser: builderBrowser }) => {
  const context = await builderBrowser.newContext({ baseURL, storageState: storageA, viewport: { width: 1600, height: 1000 } });
  try {
    const page = await context.newPage();
    await page.goto(`/ycode/api/platform/sites/${siteA.id}/open`);
    await expect(page.getByRole('button', { name: 'Design', exact: true })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Add layout' }).click();
    await page.getByRole('tab', { name: 'Elements' }).click();
    await page.getByRole('button', { name: 'Collection', exact: true }).click();

    // The list element reads its items from the collection chosen in its settings.
    await page.getByRole('tab', { name: 'Settings' }).click();
    await page.getByRole('combobox').filter({ hasText: 'Select...' }).click();
    await page.getByRole('option', { name: 'Collection', exact: true }).click();
    await expect(page.getByText('No collection selected')).toHaveCount(0);

    // A heading inside it, whose text is the item's name and role.
    await page.getByRole('tabpanel', { name: 'Layers' }).getByRole('banner').getByRole('button').click();
    await page.getByRole('tab', { name: 'Elements' }).click();
    await page.getByRole('button', { name: 'Heading', exact: true }).click();
    // The content of the heading is a rich text box in the right sidebar (the canvas is a frame of its own).
    const content = page.locator('[contenteditable="true"]').first();
    await content.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.getByRole('button', { name: 'Insert Variable' }).click();
    await page.getByText('Name', { exact: true }).last().click();
    await page.keyboard.type(' / ');
    await page.getByRole('button', { name: 'Insert Variable' }).click();
    await page.getByText('Role', { exact: true }).last().click();
    await expect.poll(async () => (JSON.stringify((await homeLayers(owner)).layers).match(/"type":"dynamicVariable"/g) ?? []).length, { timeout: 30_000 }).toBe(2);
  } finally {
    await context.close();
  }

  // What the builder saved: one list bound to the collection, one heading bound to two of its fields.
  const home = await homeLayers(owner);
  const bound = JSON.stringify(home.layers);
  expect(bound).toContain(`"collection":{"id":"${collectionId}"`);
  expect(bound.match(/"type":"dynamicVariable"/g)).toHaveLength(2);
  expect(bound).not.toContain('"text":"Heading"');

  // The item page: a dynamic page on the collection's slug, with the name and the role bound to the page's item.
  const fields = await fieldsOf(owner, collectionId);
  const field = (name: string) => fields.find((candidate) => candidate.name === name)!;
  /** How the localization screen keys a field: by its key, or by its id when it has none (a field the user added). */
  const translationKey = (target: Field) => (target.key ? `field:key:${target.key}` : `field:id:${target.id}`);
  const variable = (target: Field) => ({ type: 'dynamicVariable', attrs: { label: target.name, variable: { type: 'field', data: { source: 'page', field_id: target.id, field_type: 'text', relationships: [] } } } });
  const line = (id: string, tag: string, name: string) => ({
    id, name: tag === 'h1' ? 'heading' : 'text', settings: { tag }, classes: '', children: [],
    variables: { text: { type: 'dynamic_rich_text', data: { content: { type: 'doc', content: [{ type: 'paragraph', content: [variable(field(name))] }] } } } },
  });
  const created = await owner.post('/ycode/api/pages', {
    data: { name: 'Member', slug: '*', is_dynamic: true, is_published: false, is_publishable: true, settings: { cms: { collection_id: collectionId, slug_field_id: field('Slug').id } } },
  });
  expect(created.status(), await created.text()).toBe(200);
  const memberPage = (await created.json()).data.id as string;
  const saved = await owner.put(`/ycode/api/layers?page_id=${memberPage}`, {
    data: { layers: [{ id: 'body', name: 'body', classes: '', children: [line('member-name', 'h1', 'Name'), line('member-role', 'p', 'Role'), line('member-city', 'p', 'City')] }] },
  });
  expect(saved.status(), await saved.text()).toBe(200);

  // Arabic: the items' own words, as the localization screen stores them for a collection's items.
  const locales = (await (await owner.get('/ycode/api/locales')).json()).data as Array<{ id: string; code: string }>;
  const arabic = locales.find((locale) => locale.code === 'ar')!;
  const items = await itemsOf(owner, collectionId);
  for (const person of PEOPLE) {
    const item = items.find((candidate) => candidate.values[field('Slug').id] === person.slug)!;
    for (const [name, value] of [['Name', person.ar.name], ['Role', person.ar.role], ['City', person.ar.city]] as const) {
      const response = await owner.post('/ycode/api/translations', {
        data: { locale_id: arabic.id, source_type: 'cms', source_id: item.id, content_key: translationKey(field(name)), content_type: 'text', content_value: value, is_completed: true },
      });
      expect(response.status(), await response.text()).toBe(201);
    }
  }
  await publish(owner);
});

test('a visitor reads both items on the list page and each on its own page, in English and in Arabic', async () => {
  const list = await published(siteA, '/');
  expect(list.status).toBe(200);
  const english = bodyOf(list.html);
  for (const person of PEOPLE) {
    expect(english).toContain(person.name);
    expect(english).toContain(person.role);
  }
  expect(list.html).toMatch(/<html[^>]*lang="en"/);

  const arabicList = await published(siteA, '/ar');
  expect(arabicList.status).toBe(200);
  const arabic = bodyOf(arabicList.html);
  for (const person of PEOPLE) {
    expect(arabic).toContain(person.ar.name);
    expect(arabic).toContain(person.ar.role);
    expect(arabic).not.toContain(person.name);
  }
  expect(arabicList.html).toMatch(/<html[^>]*lang="ar"[^>]*dir="rtl"|<html[^>]*dir="rtl"[^>]*lang="ar"/);

  for (const person of PEOPLE) {
    const page = await published(siteA, `/${person.slug}`);
    expect(page.status, person.slug).toBe(200);
    const body = bodyOf(page.html);
    expect(body).toContain(person.name);
    expect(body).toContain(person.role);
    expect(body).toContain(person.city);
    // The other person is not on this person's page.
    for (const other of PEOPLE.filter((candidate) => candidate !== person)) expect(body).not.toContain(other.name);

    const inArabic = await published(siteA, `/ar/${person.slug}`);
    expect(inArabic.status, `ar ${person.slug}`).toBe(200);
    const arabicBody = bodyOf(inArabic.html);
    expect(arabicBody).toContain(person.ar.name);
    expect(arabicBody).toContain(person.ar.role);
    expect(arabicBody).toContain(person.ar.city);
    expect(arabicBody).not.toContain(person.name);
    expect(inArabic.html).toMatch(/dir="rtl"/);
  }
  // An address that is no item's slug is the site's own 404.
  expect((await published(siteA, '/nobody')).status).toBe(404);

  // In a browser the list shows two rows, in the page's language.
  const context = await browser.newContext({ baseURL: `http://${hostOf(siteA)}:${PORT}` });
  try {
    const page = await context.newPage();
    // Both rows, whatever order the list gives them (the items share one manual position).
    const rows = async (path: string) => {
      await page.goto(path);
      await expect(page.locator('h2')).toHaveCount(2);
      return (await page.locator('h2').allTextContents()).map((text) => text.trim()).sort();
    };
    expect(await rows('/ar')).toEqual(PEOPLE.map((person) => `${person.ar.name} / ${person.ar.role}`).sort());
    expect(await rows('/')).toEqual(PEOPLE.map((person) => `${person.name} / ${person.role}`).sort());
  } finally {
    await context.close();
  }
});

test('the second site has none of it', async () => {
  expect(await collectionsOf(otherOwner)).toEqual([]);
  // The first site's collection and its items are not reachable with the second site's session.
  for (const path of [`/ycode/api/collections/${collectionId}`, `/ycode/api/collections/${collectionId}/fields`, `/ycode/api/collections/${collectionId}/items`]) {
    const response = await otherOwner.get(path);
    const body = await response.text();
    expect(body, `${path}: ${response.status()}`).not.toMatch(/Role|Sara|Omar/);
  }

  // A page there that names the first site's collection draws nothing, and has no item page.
  const home = await homeLayers(owner);
  const homeB = await homeLayers(otherOwner);
  const saved = await otherOwner.put(`/ycode/api/layers?page_id=${homeB.id}`, { data: { layers: home.layers } });
  expect(saved.status(), await saved.text()).toBe(200);
  await publish(otherOwner);
  const list = await published(siteB, '/');
  const arabicList = await published(siteB, '/ar');
  expect([list.status, arabicList.status]).toEqual([200, 200]);
  for (const person of PEOPLE) {
    expect(bodyOf(list.html)).not.toContain(person.name);
    expect(bodyOf(arabicList.html)).not.toContain(person.ar.name);
    expect((await published(siteB, `/${person.slug}`)).status).toBe(404);
  }
  // And the first site is unchanged by it.
  expect(await itemsOf(owner, collectionId)).toHaveLength(2);
});

test('one editor holds the site: a second user reads its collections and cannot change them, and a reader cannot create one', async () => {
  const second = await signIn(baseURL, SECOND);
  const viewer = await signIn(baseURL, VIEWER);
  try {
    // The owner has the editor lock (the builder took it); the second user opens the site read-only.
    expect((await openSite(second, siteA.id)).status()).toBe(303);
    const read = await second.get('/ycode/api/collections');
    expect(read.status(), await read.text()).toBe(200);
    expect((await read.json()).data).toHaveLength(1);

    const refused = await second.post('/ycode/api/collections', { data: { name: 'Blocked' } });
    expect(refused.status(), await refused.text()).toBe(423);
    expect(await refused.json()).toMatchObject({ holder: expect.anything() });
    const refusedItem = await second.post(`/ycode/api/collections/${collectionId}/items`, { data: { values: {} } });
    expect(refusedItem.status()).toBe(423);
    expect(await collectionsOf(owner)).toHaveLength(1);
    expect(await itemsOf(owner, collectionId)).toHaveLength(2);

    // A user with read only on content sees the collections and may not create one (403, before the lock).
    expect((await openSite(viewer, siteA.id)).status()).toBe(303);
    expect((await viewer.get('/ycode/api/collections')).status()).toBe(200);
    expect((await viewer.post('/ycode/api/collections', { data: { name: 'Nope' } })).status()).toBe(403);
    expect((await viewer.delete(`/ycode/api/collections/${collectionId}`)).status()).toBe(403);
  } finally {
    await second.dispose();
    await viewer.dispose();
  }
});
