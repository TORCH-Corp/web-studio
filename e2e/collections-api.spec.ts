/**
 * Part 3, session W6: the Collections API for the app.
 *
 * GET /ycode/api/platform/sites/{id}/collections: the site's draft collections that are not deleted, each with
 * the number of its items that are not deleted, the date of its last change (the latest `updated_at` of the
 * collection and of its items, no person), and the builder's path for it; the answer says whether the user may
 * change collections (`webstudio.manage_content` u), so the app shows "Open in builder" or the read-only note.
 * `webstudio.manage_content` r is the proxy's check. Another site's collections are never listed, and a site of
 * another organization is not found.
 */

import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { createSite, openSite, signIn, type SiteRecord } from './helpers';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const ORG = '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a';
const OTHER_ORG = '3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b';
const OWNER = { sub: '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c', email: 'owner-collections-api@example.com', name: 'Owner Collections', org: ORG };
const STRANGER = { sub: '3d3d3d3d-3d3d-4d3d-8d3d-3d3d3d3d3d3d', email: 'stranger-collections-api@example.com', name: 'Stranger', org: OTHER_ORG };

interface Row {
  id: string;
  name: string;
  item_count: number;
  last_change: string;
  builder_path: string;
}
interface Listed {
  data: Row[];
  can_change: boolean;
}

let baseURL: string;
let owner: APIRequestContext;
let site: SiteRecord;
let other: SiteRecord;
const ids: Record<'blog' | 'team' | 'branches' | 'elsewhere' | 'gone', string> = { blog: '', team: '', branches: '', elsewhere: '', gone: '' };
const items: Record<'post1' | 'post2' | 'post3' | 'person', string> = { post1: '', post2: '', post3: '', person: '' };

const url = (id = site.id) => `/ycode/api/platform/sites/${id}/collections`;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function list(api: APIRequestContext = owner, id = site.id): Promise<Listed> {
  const response = await api.get(url(id));
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as Listed;
}
const rowOf = (listed: Listed, id: string): Row => {
  const row = listed.data.find((candidate) => candidate.id === id);
  expect(row, `collection ${id} in the list`).toBeDefined();
  return row!;
};

async function createCollection(name: string): Promise<string> {
  const response = await owner.post('/ycode/api/collections', { data: { name } });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).data.id as string;
}
async function createItem(collectionId: string): Promise<string> {
  const response = await owner.post(`/ycode/api/collections/${collectionId}/items`, { data: { values: {} } });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).data.id as string;
}

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  owner = await signIn(baseURL, OWNER);
  site = await createSite(owner, { name: 'Company', slug: `company-${RUN}`, languages: ['en'], default_language: 'en' });
  other = await createSite(owner, { name: 'Elsewhere', slug: `elsewhere-${RUN}`, languages: ['en'], default_language: 'en' });

  // The other site first: the builder writes to the site the cookie names.
  expect((await openSite(owner, other.id)).status()).toBe(303);
  ids.elsewhere = await createCollection('Press');
  await createItem(ids.elsewhere);

  expect((await openSite(owner, site.id)).status()).toBe(303);
  ids.blog = await createCollection('Blog');
  items.post1 = await createItem(ids.blog);
  items.post2 = await createItem(ids.blog);
  items.post3 = await createItem(ids.blog);
  ids.team = await createCollection('Team');
  items.person = await createItem(ids.team);
  ids.branches = await createCollection('Branches');
  ids.gone = await createCollection('Old news');
});

test.afterAll(async () => {
  for (const id of [site?.id, other?.id]) {
    if (id) await owner?.delete(`/ycode/api/platform/sites/${id}`);
  }
  await owner?.dispose();
});

test('lists the site\'s collections with the number of items, a last change and the builder path', async () => {
  const listed = await list();
  expect(listed.can_change).toBe(true);
  expect(listed.data.map((row) => row.name).sort()).toEqual(['Blog', 'Branches', 'Old news', 'Team']);

  const blog = rowOf(listed, ids.blog);
  const team = rowOf(listed, ids.team);
  const branches = rowOf(listed, ids.branches);
  expect(blog.item_count).toBe(3);
  expect(team.item_count).toBe(1);
  expect(branches.item_count).toBe(0);

  // The path opens that collection in the builder: the builder's own route, on the site the app opened.
  for (const [row, id] of [[blog, ids.blog], [team, ids.team], [branches, ids.branches]] as const) {
    expect(row.builder_path).toBe(`/ycode/collections/${id}`);
    expect(Number.isNaN(Date.parse(row.last_change)), `${row.name}: last_change is a date`).toBe(false);
  }

  // No person: the fork records none.
  expect(Object.keys(blog).sort()).toEqual(['builder_path', 'id', 'item_count', 'last_change', 'name']);
});

test('a deleted collection is not listed, and a deleted item is not counted', async () => {
  const response = await owner.delete(`/ycode/api/collections/${ids.gone}`);
  expect(response.ok(), await response.text()).toBe(true);
  expect((await list()).data.map((row) => row.id)).not.toContain(ids.gone);

  const extra = await createItem(ids.team);
  expect(rowOf(await list(), ids.team).item_count).toBe(2);
  const removed = await owner.delete(`/ycode/api/collections/${ids.team}/items/${extra}`);
  expect(removed.ok(), await removed.text()).toBe(true);
  expect(rowOf(await list(), ids.team).item_count).toBe(1);
});

test('editing an item moves its collection\'s last change and no other\'s', async () => {
  const before = await list();
  await pause(50);

  const edited = await owner.put(`/ycode/api/collections/${ids.blog}/items/${items.post2}`, { data: { values: {} } });
  expect(edited.ok(), await edited.text()).toBe(true);

  const after = await list();
  expect(Date.parse(rowOf(after, ids.blog).last_change)).toBeGreaterThan(Date.parse(rowOf(before, ids.blog).last_change));
  expect(rowOf(after, ids.team).last_change).toBe(rowOf(before, ids.team).last_change);
  expect(rowOf(after, ids.branches).last_change).toBe(rowOf(before, ids.branches).last_change);
  expect(rowOf(after, ids.blog).item_count).toBe(3);
});

test('adding an item and deleting one move the last change; renaming the collection does too', async () => {
  let last = Date.parse(rowOf(await list(), ids.team).last_change);
  await pause(50);

  const added = await createItem(ids.team);
  const afterAdd = Date.parse(rowOf(await list(), ids.team).last_change);
  expect(afterAdd).toBeGreaterThan(last);
  last = afterAdd;
  await pause(50);

  const removed = await owner.delete(`/ycode/api/collections/${ids.team}/items/${added}`);
  expect(removed.ok(), await removed.text()).toBe(true);
  const afterDelete = await list();
  expect(rowOf(afterDelete, ids.team).item_count).toBe(1);
  expect(Date.parse(rowOf(afterDelete, ids.team).last_change)).toBeGreaterThan(last);
  last = Date.parse(rowOf(afterDelete, ids.team).last_change);
  await pause(50);

  // The collection's own date counts too: a rename is a change even when no item moved.
  const renamed = await owner.put(`/ycode/api/collections/${ids.team}`, { data: { name: 'People' } });
  expect(renamed.ok(), await renamed.text()).toBe(true);
  const afterRename = await list();
  expect(rowOf(afterRename, ids.team).name).toBe('People');
  expect(Date.parse(rowOf(afterRename, ids.team).last_change)).toBeGreaterThan(last);
});

test('another site\'s collections are not listed, and each site lists its own', async () => {
  const listed = await list();
  expect(listed.data.map((row) => row.id)).not.toContain(ids.elsewhere);
  expect(listed.data.map((row) => row.name)).not.toContain('Press');

  const elsewhere = await list(owner, other.id);
  expect(elsewhere.data.map((row) => row.name)).toEqual(['Press']);
  expect(elsewhere.data[0]).toMatchObject({ id: ids.elsewhere, item_count: 1, builder_path: `/ycode/collections/${ids.elsewhere}` });
});

test('a Viewer reads the list and is told it may not change collections', async () => {
  const viewer = await signIn(baseURL, { ...OWNER, sub: '3e3e3e3e-3e3e-4e3e-8e3e-3e3e3e3e3e3e', email: 'viewer-collections-api@example.com', perms: { 'webstudio.manage_content': ['r'] } });
  try {
    const listed = await list(viewer);
    expect(listed.can_change).toBe(false);
    expect(listed.data.map((row) => row.name).sort()).toEqual(['Blog', 'Branches', 'People']);
    expect(rowOf(listed, ids.blog).item_count).toBe(3);
  } finally {
    await viewer.dispose();
  }
});

test('whether a user may change collections is the u flag, not create or read', async () => {
  const member = await signIn(baseURL, { ...OWNER, sub: '3f3f3f3f-3f3f-4f3f-8f3f-3f3f3f3f3f3f', email: 'member-collections-api@example.com', perms: { 'webstudio.manage_content': ['c', 'r', 'u'] } });
  const createOnly = await signIn(baseURL, { ...OWNER, sub: '40404040-4040-4040-8040-404040404040', email: 'create-collections-api@example.com', perms: { 'webstudio.manage_content': ['c', 'r'] } });
  try {
    expect((await list(member)).can_change).toBe(true);
    expect((await list(createOnly)).can_change).toBe(false);
  } finally {
    await member.dispose();
    await createOnly.dispose();
  }
});

test('no session is 401, no content permission is 403, a site of another organization or an unknown id is 404', async () => {
  const anonymous = await request.newContext({ baseURL });
  expect((await anonymous.get(url())).status()).toBe(401);
  await anonymous.dispose();

  // Holding the sites and the forms leaves is not holding the content leaf.
  const noContent = await signIn(baseURL, { ...OWNER, sub: '41414141-4141-4141-8141-414141414141', email: 'nocontent-collections-api@example.com', perms: { 'webstudio.manage_sites': ['r', 'u'], 'webstudio.manage_forms': ['r'] } });
  const refused = await noContent.get(url());
  expect(refused.status()).toBe(403);
  expect(await refused.json()).toMatchObject({ required: 'webstudio.manage_content.r' });
  await noContent.dispose();

  const stranger = await signIn(baseURL, STRANGER);
  expect((await stranger.get(url())).status()).toBe(404);
  await stranger.dispose();

  expect((await owner.get(url('not-an-id'))).status()).toBe(404);
  expect((await owner.get(url('7d7d7d7d-7d7d-4d7d-8d7d-7d7d7d7d7d7d'))).status()).toBe(404);
});
