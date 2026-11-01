/**
 * Session 5 "done when": publishing per site.
 *
 * Two sites of one organization publish; each answers on its default address
 * (`{slug}.sites.test` here) with its own content and nowhere else. An edit
 * that is not published is invisible on the host until the next publish. Each
 * language is served at its locale path with the right dir, and a language the
 * site lacks is 404. A host no site uses is 404 and shows no site. A site's own
 * missing page shows that site's 404 page. A host added to the site answers
 * after the next publish.
 */

import { expect, test, type APIRequestContext } from '@playwright/test';
import knex from 'knex';
import { createSite, draftPages, openSite, publish, publishedSite, setHeading, signIn, TEST_SITES_DOMAIN, type SiteRecord } from './helpers';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const ORG = '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c';
const USER = { sub: '1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c1c', email: 'owner-c@example.com', name: 'Owner C', org: ORG };
const SLUG_ONE = `one-${RUN}`;
const SLUG_TWO = `two-${RUN}`;
const HOST_ONE = `${SLUG_ONE}.${TEST_SITES_DOMAIN}`;
const HOST_TWO = `${SLUG_TWO}.${TEST_SITES_DOMAIN}`;
const EXTRA_HOST = `www-${RUN}.example.test`;

let baseURL: string;
let api: APIRequestContext;
let siteOne: SiteRecord;
let siteTwo: SiteRecord;

async function pageIds(): Promise<{ home: string; notFound: string }> {
  const pages = await draftPages(api);
  const home = pages.find((page) => page.is_index);
  const notFound = pages.find((page) => page.error_page === 404);
  expect(home && notFound).toBeTruthy();
  return { home: home!.id, notFound: notFound!.id };
}

/** GET a path on a host, fresh each time (anonymous, no cookies). */
async function visit(host: string, path: string) {
  const site = await publishedSite(baseURL, host);
  try {
    const response = await site.get(path);
    return { status: response.status(), html: await response.text() };
  } finally {
    await site.dispose();
  }
}

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  api = await signIn(baseURL, USER);
});

test.afterAll(async () => {
  await api?.dispose();
});

test('a new site answers on {slug}.{sites domain} without any host being given', async () => {
  siteOne = await createSite(api, { name: 'Site One', slug: SLUG_ONE, languages: ['en', 'ar'], default_language: 'en' });
  siteTwo = await createSite(api, { name: 'Site Two', slug: SLUG_TWO, languages: ['en'], default_language: 'en' });
  expect(siteOne.hosts).toEqual([HOST_ONE]);
  expect(siteTwo.hosts).toEqual([HOST_TWO]);

  const squat = await api.post('/ycode/api/platform/sites', {
    data: { name: 'Squat', slug: `squat-${RUN}`, languages: ['en'], default_language: 'en', hosts: [HOST_ONE] },
  });
  expect(squat.status()).toBe(409);
  const otherAddress = await api.post('/ycode/api/platform/sites', {
    data: { name: 'Squat', slug: `squat-${RUN}`, languages: ['en'], default_language: 'en', hosts: [`someone-else-${RUN}.${TEST_SITES_DOMAIN}`] },
  });
  expect(otherAddress.status()).toBe(409);
  const bareDomain = await api.post('/ycode/api/platform/sites', {
    data: { name: 'Squat', slug: `squat-${RUN}`, languages: ['en'], default_language: 'en', hosts: [TEST_SITES_DOMAIN] },
  });
  expect(bareDomain.status()).toBe(409);
});

test('two sites of one organization publish and each answers with its own content', async () => {
  for (const [site, text] of [[siteOne, 'Hello from one'], [siteTwo, 'Hello from two']] as const) {
    expect((await openSite(api, site.id)).status()).toBe(303);
    const { home } = await pageIds();
    await setHeading(api, home, text);
    await publish(api);
  }

  const one = await visit(HOST_ONE, '/');
  expect(one.status).toBe(200);
  expect(one.html).toContain('Hello from one');
  expect(one.html).not.toContain('Hello from two');

  const two = await visit(HOST_TWO, '/');
  expect(two.status).toBe(200);
  expect(two.html).toContain('Hello from two');
  expect(two.html).not.toContain('Hello from one');
});

test('an unpublished edit is invisible on the host until the next publish', async () => {
  await openSite(api, siteOne.id);
  const { home } = await pageIds();
  await setHeading(api, home, 'Draft only one');

  const before = await visit(HOST_ONE, '/');
  expect(before.html).toContain('Hello from one');
  expect(before.html).not.toContain('Draft only one');

  await publish(api);
  const after = await visit(HOST_ONE, '/');
  expect(after.html).toContain('Draft only one');
  expect(after.html).not.toContain('Hello from one');

  // Site one's publish did not touch site two.
  expect((await visit(HOST_TWO, '/')).html).toContain('Hello from two');
});

test('each language is served at its locale path with the right dir; the default at the root', async () => {
  await openSite(api, siteOne.id);
  await publish(api);

  const root = await visit(HOST_ONE, '/');
  expect(root.html).toMatch(/<html[^>]*\blang="en"/);
  expect(root.html).not.toContain('dir="rtl"');

  const arabic = await visit(HOST_ONE, '/ar');
  expect(arabic.status).toBe(200);
  expect(arabic.html).toMatch(/<html[^>]*\blang="ar"/);
  expect(arabic.html).toContain('dir="rtl"');

  const missing = await visit(HOST_TWO, '/ar');
  expect(missing.status).toBe(404);
});

test('a host no site uses is 404 and shows no site', async () => {
  for (const path of ['/', '/ar', '/robots.txt', '/sitemap.xml']) {
    const response = await visit(`nobody-${RUN}.${TEST_SITES_DOMAIN}`, path);
    expect(response.status, path).toBe(404);
    expect(response.html).not.toContain('Hello from');
    expect(response.html).not.toContain('Draft only');
  }
  const home = await visit(`nobody-${RUN}.${TEST_SITES_DOMAIN}`, '/');
  expect(home.html).toContain('Page Not Found');
  expect(home.html).not.toContain('Go Home'); // no link into a site
});

test('a site\'s missing page returns that site\'s own 404 page', async () => {
  for (const [site, text] of [[siteOne, 'Lost in one'], [siteTwo, 'Lost in two']] as const) {
    await openSite(api, site.id);
    const { notFound } = await pageIds();
    await setHeading(api, notFound, text);
    await publish(api);
  }

  const one = await visit(HOST_ONE, '/no-such-page');
  expect(one.status).toBe(404);
  expect(one.html).toContain('Lost in one');
  expect(one.html).not.toContain('Lost in two');

  const two = await visit(HOST_TWO, '/no-such-page');
  expect(two.status).toBe(404);
  expect(two.html).toContain('Lost in two');
  expect(two.html).not.toContain('Lost in one');
});

test('a second host added to a site answers after the next publish', async () => {
  expect((await visit(EXTRA_HOST, '/')).status).toBe(404); // the miss is remembered for a while

  const db = knex({ client: 'pg', connection: process.env.DATABASE_URL_TEST });
  try {
    await db.raw('UPDATE platform_sites SET hosts = hosts || ?::text WHERE id = ?', [EXTRA_HOST, siteOne.id]);
  } finally {
    await db.destroy();
  }

  await openSite(api, siteOne.id);
  await publish(api);

  const added = await visit(EXTRA_HOST, '/');
  expect(added.status).toBe(200);
  expect(added.html).toContain('Draft only one');
  expect((await visit(HOST_ONE, '/')).status).toBe(200);
});
