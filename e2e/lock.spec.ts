/**
 * Session 6 "done when": one editor at a time per site.
 *
 * User A opens a site and holds its lock. User B (same organization) opens it
 * and gets it read-only: the builder shows a banner with A's name and a
 * disabled Publish, and B's writes answer 423 naming A while B's reads work.
 * A closes the site (the builder's release) and B's next load gets the lock.
 * With A's heartbeat set 16 minutes back, B gets the lock. A opening the site
 * again while holding the lock is not blocked by himself. GET
 * /ycode/api/platform/sites/{id} reports the lock for the Tauri app's All sites.
 */

import { expect, test, type APIRequestContext, type BrowserContext } from '@playwright/test';
import knex from 'knex';
import { createSite, draftPages, openSite, signIn, type SiteRecord } from './helpers';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const ORG = '0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d';
const ALI = { sub: '1d1d1d1d-1d1d-4d1d-8d1d-1d1d1d1d1d1d', email: 'ali-lock@example.com', name: 'Ali Editor', org: ORG };
const BAYAN = { sub: '2d2d2d2d-2d2d-4d2d-8d2d-2d2d2d2d2d2d', email: 'bayan-lock@example.com', name: 'Bayan Editor', org: ORG };

let a: APIRequestContext;
let b: APIRequestContext;
let site: SiteRecord;
let pageId: string;

const db = () => knex({ client: 'pg', connection: process.env.DATABASE_URL_TEST });

/** The lock row, straight from the database. */
async function lockRow() {
  const conn = db();
  try {
    return await conn('platform_site_locks').where({ site_id: site.id }).first();
  } finally {
    await conn.destroy();
  }
}

async function backdateHeartbeat(minutes: number) {
  const conn = db();
  try {
    await conn.raw('UPDATE platform_site_locks SET heartbeat_at = now() - make_interval(mins => ?) WHERE site_id = ?', [minutes, site.id]);
  } finally {
    await conn.destroy();
  }
}

async function siteView(api: APIRequestContext) {
  const response = await api.get(`/ycode/api/platform/sites/${site.id}`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).data as { id: string; lock: null | { holder: string; user_id: string; since: string; held_by_you: boolean } };
}

const writePage = (api: APIRequestContext) => api.put(`/ycode/api/pages/${pageId}`, { data: { name: `Home ${RUN}` } });

test.beforeAll(async ({ baseURL }) => {
  a = await signIn(baseURL!, ALI);
  b = await signIn(baseURL!, BAYAN);
  site = await createSite(a, { name: `Lock ${RUN}`, slug: `lock-${RUN}`, languages: ['en'], default_language: 'en' });
});

test.afterAll(async () => {
  await a?.dispose();
  await b?.dispose();
});

test('nobody holds a site that nobody has opened', async () => {
  expect(await lockRow()).toBeUndefined();
  expect((await siteView(a)).lock).toBeNull();
});

test('A opens the site and holds the lock; A can write', async () => {
  expect((await openSite(a, site.id)).status()).toBe(303);
  const row = await lockRow();
  expect(row.user_id).toBe(ALI.sub);
  expect(row.user_name).toBe('Ali Editor');
  pageId = (await draftPages(a)).find((page) => page.is_index)!.id;
  expect((await writePage(a)).status()).toBe(200);
});

test('B opens the same site: it opens, but the lock stays A\'s', async () => {
  expect((await openSite(b, site.id)).status()).toBe(303);
  expect((await lockRow()).user_id).toBe(ALI.sub);
  const view = await siteView(b);
  expect(view.lock).toMatchObject({ holder: 'Ali Editor', user_id: ALI.sub, held_by_you: false });
  expect(new Date(view.lock!.since).getTime()).toBeGreaterThan(Date.now() - 60_000);
  expect((await siteView(a)).lock).toMatchObject({ holder: 'Ali Editor', held_by_you: true });
});

test('B\'s reads work and B\'s writes answer 423 naming A, on every kind of write route', async () => {
  const pages = await b.get('/ycode/api/pages');
  expect(pages.status()).toBe(200);
  expect((await b.get('/ycode/api/editor/init')).status()).toBe(200);

  const put = await writePage(b);
  expect(put.status()).toBe(423);
  expect(await put.json()).toMatchObject({ holder: 'Ali Editor', error: 'Ali Editor is editing this site' });

  expect((await b.put(`/ycode/api/layers?page_id=${pageId}`, { data: { layers: [] } })).status()).toBe(423);
  expect((await b.post('/ycode/api/pages', { data: { name: 'Nope', slug: 'nope' } })).status()).toBe(423);
  expect((await b.delete(`/ycode/api/pages/${pageId}`)).status()).toBe(423);
  expect((await b.post('/ycode/api/publish', { data: { publishAll: true } })).status()).toBe(423);
  expect((await b.put('/ycode/api/settings/site_name', { data: { value: 'B was here' } })).status()).toBe(423);

  // Nothing of B's reached the data, and B's refusals did not move A's lock.
  const page = (await draftPages(a)).find((p) => p.id === pageId) as unknown as { name: string };
  expect(page.name).toBe(`Home ${RUN}`);
  expect((await lockRow()).user_id).toBe(ALI.sub);
});

test('B\'s builder shows A\'s name in a banner and a disabled Publish; the canvas stays browsable', async ({ browser }) => {
  const context: BrowserContext = await browser.newContext({ storageState: await b.storageState(), viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  try {
    await page.goto(`/ycode/api/platform/sites/${site.id}/open`);
    await expect(page.getByRole('alert').filter({ hasText: 'is editing this site' })).toContainText('Ali Editor is editing this site');
    await expect(page.getByRole('button', { name: 'Publish' })).toBeDisabled();
    await expect(page.getByText('Read-only', { exact: true })).toBeVisible();
    // Still browsable: the sidebar's Pages tab opens and lists the site's page.
    await page.getByRole('tab', { name: 'Pages' }).click();
    await expect(page.getByRole('button', { name: `Home ${RUN}` })).toBeVisible();
    // The builder's heartbeat did not take the lock from A.
    expect((await lockRow()).user_id).toBe(ALI.sub);
  } finally {
    await context.close();
  }
});

test('A\'s builder shows no banner and an enabled Publish, and closing the page lets go of the lock', async ({ browser }) => {
  const context = await browser.newContext({ storageState: await a.storageState(), viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  try {
    await page.goto(`/ycode/api/platform/sites/${site.id}/open`);
    await expect(page.getByRole('button', { name: 'Publish' })).toBeEnabled();
    await expect(page.getByRole('alert').filter({ hasText: 'is editing this site' })).toHaveCount(0);
    expect((await lockRow()).user_id).toBe(ALI.sub);
    await page.close(); // pagehide: the builder releases with a keepalive request
    await expect.poll(async () => (await lockRow())?.user_id ?? null, { timeout: 10_000 }).toBeNull();
  } finally {
    await context.close();
  }
});

test('A opening the site again while holding the lock is not blocked by himself', async () => {
  expect((await openSite(a, site.id)).status()).toBe(303); // A's browser may have released it on close
  const before = await lockRow();
  expect((await openSite(a, site.id)).status()).toBe(303);
  const after = await lockRow();
  expect(after.user_id).toBe(ALI.sub);
  expect(new Date(after.acquired_at).getTime()).toBe(new Date(before.acquired_at).getTime()); // still the same hold
  expect(new Date(after.heartbeat_at).getTime()).toBeGreaterThanOrEqual(new Date(before.heartbeat_at).getTime());
  expect((await writePage(a)).status()).toBe(200);
});

test('B cannot release A\'s lock; A closing the site releases it and B\'s next load gets it', async () => {
  const foreign = await b.delete('/ycode/api/platform/site-lock');
  expect(foreign.status()).toBe(200);
  expect((await foreign.json()).data.released).toBe(false);
  expect((await lockRow()).user_id).toBe(ALI.sub);

  const released = await a.delete('/ycode/api/platform/site-lock');
  expect(released.status()).toBe(200);
  expect((await released.json()).data.released).toBe(true);
  expect(await lockRow()).toBeUndefined();
  expect((await siteView(b)).lock).toBeNull();

  expect((await openSite(b, site.id)).status()).toBe(303);
  expect((await lockRow()).user_id).toBe(BAYAN.sub);
  expect((await writePage(b)).status()).toBe(200);
  expect((await writePage(a)).status()).toBe(423); // and now A is the one who looks
});

test('the builder\'s heartbeat refreshes the lock and reports who holds it', async () => {
  const mine = await b.post('/ycode/api/platform/site-lock');
  expect(mine.status()).toBe(200);
  expect((await mine.json()).data).toMatchObject({ held: true, holder: { name: 'Bayan Editor', user_id: BAYAN.sub } });

  const theirs = await a.post('/ycode/api/platform/site-lock');
  expect(theirs.status()).toBe(200);
  expect((await theirs.json()).data).toMatchObject({ held: false, holder: { name: 'Bayan Editor' } });
  expect((await lockRow()).user_id).toBe(BAYAN.sub);
});

test('with the holder\'s heartbeat 16 minutes old, the lock is free: the next to ask gets it', async () => {
  await backdateHeartbeat(16);
  expect((await siteView(a)).lock).toBeNull(); // a lapsed lock is not reported
  expect((await openSite(a, site.id)).status()).toBe(303);
  const row = await lockRow();
  expect(row.user_id).toBe(ALI.sub);
  expect((await writePage(a)).status()).toBe(200);
  expect((await writePage(b)).status()).toBe(423);
});

test('with the holder\'s heartbeat 14 minutes old, the lock is still theirs', async () => {
  await backdateHeartbeat(14);
  expect((await b.post('/ycode/api/platform/site-lock').then((r) => r.json())).data.held).toBe(false);
  expect((await writePage(b)).status()).toBe(423);
});

test('a write from a user whose lock lapsed, when nobody took it, takes it again', async () => {
  await backdateHeartbeat(20);
  expect((await writePage(a)).status()).toBe(200);
  const row = await lockRow();
  expect(row.user_id).toBe(ALI.sub);
  expect(Date.now() - new Date(row.heartbeat_at).getTime()).toBeLessThan(60_000);
});

test('signing out lets go of the lock', async () => {
  expect((await a.post('/ycode/api/auth/logout')).status()).toBe(200);
  expect(await lockRow()).toBeUndefined();
});

test('a site of another organization is neither visible nor lockable', async ({ baseURL }) => {
  const outsider = await signIn(baseURL!, { sub: '3d3d3d3d-3d3d-4d3d-8d3d-3d3d3d3d3d3d', email: 'out@example.com', name: 'Outsider', org: '0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e' });
  try {
    expect((await outsider.get(`/ycode/api/platform/sites/${site.id}`)).status()).toBe(404);
    expect((await openSite(outsider, site.id)).status()).toBe(404);
    expect((await outsider.post('/ycode/api/platform/site-lock')).status()).toBe(404); // no site open
  } finally {
    await outsider.dispose();
  }
});
