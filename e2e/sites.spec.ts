/**
 * Session 1 "done when": the site is the tenant.
 *
 * One organization creates two sites and a second organization creates one;
 * each publishes and answers on its own host; site A's pages, assets and
 * locales do not appear in site B's API; the second organization gets 404
 * opening the first organization's site; a request with no session gets 401;
 * an unknown host gets 404.
 */

import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { cookieNamed, createSite, listSites, openSite, publish, publishedSite, signIn, type SiteRecord } from './helpers';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const ORG_A = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const ORG_B = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
const USER_A = { sub: '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', email: 'owner-a@example.com', name: 'Owner A', org: ORG_A };
const USER_B = { sub: '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b', email: 'owner-b@example.com', name: 'Owner B', org: ORG_B };
const HOST_A1 = `a1-${RUN}.sites.test`;
const HOST_A2 = `a2-${RUN}.sites.test`;
const HOST_B1 = `b1-${RUN}.sites.test`;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';

let baseURL: string;
let orgA: APIRequestContext;
let orgB: APIRequestContext;
let siteA1: SiteRecord;
let siteA2: SiteRecord;
let siteB1: SiteRecord;

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  orgA = await signIn(baseURL, USER_A);
  orgB = await signIn(baseURL, USER_B);
});

test.afterAll(async () => {
  await orgA?.dispose();
  await orgB?.dispose();
});

test('organization A creates two sites and organization B creates one', async () => {
  siteA1 = await createSite(orgA, { name: 'Al Noor', slug: `a1-${RUN}`, languages: ['ar', 'en'], default_language: 'ar', hosts: [HOST_A1] });
  siteA2 = await createSite(orgA, { name: 'Al Noor Landing', slug: `a2-${RUN}`, languages: ['en'], default_language: 'en', hosts: [HOST_A2] });
  siteB1 = await createSite(orgB, { name: 'Basra Tools', slug: `b1-${RUN}`, languages: ['en'], default_language: 'en', hosts: [HOST_B1], template_id: '3f0b2c7e-2d7a-4c3e-9a1e-7b1d2e3f4a5b' });

  expect(siteA1.organization_id).toBe(ORG_A);
  expect(siteA1.default_locale).toBe('ar');
  expect(siteA1.hosts).toEqual([HOST_A1]);
  expect(siteB1.organization_id).toBe(ORG_B);
});

test('a slug or a host already in use is refused, and a bad body is refused', async () => {
  const sameSlug = await orgB.post('/ycode/api/platform/sites', { data: { name: 'Copy', slug: `a1-${RUN}`, languages: ['en'], default_language: 'en' } });
  expect(sameSlug.status()).toBe(409);
  expect((await sameSlug.json()).field).toBe('slug');

  const sameHost = await orgB.post('/ycode/api/platform/sites', { data: { name: 'Copy', slug: `c1-${RUN}`, languages: ['en'], default_language: 'en', hosts: [HOST_A1] } });
  expect(sameHost.status()).toBe(409);
  expect((await sameHost.json()).field).toBe('hosts');

  const badBody = await orgA.post('/ycode/api/platform/sites', { data: { name: 'Bad', slug: 'Bad Slug', languages: ['en'], default_language: 'ar' } });
  expect(badBody.status()).toBe(400);
  expect((await badBody.json()).details).toEqual(expect.arrayContaining([expect.stringMatching(/^slug:/), expect.stringMatching(/^default_language:/)]));
});

test('All sites lists only the organization\'s own sites, as drafts', async () => {
  const sitesA = await listSites(orgA);
  expect(sitesA.map((site) => site.id)).toEqual([siteA1.id, siteA2.id]);
  expect(sitesA.map((site) => site.status)).toEqual(['draft', 'draft']);
  expect(sitesA[0].last_published_at).toBeNull();

  const sitesB = await listSites(orgB);
  expect(sitesB.map((site) => site.id)).toEqual([siteB1.id]);
});

test('opening a site sets the ws_site cookie and the builder works on that site', async () => {
  const opened = await openSite(orgA, siteA1.id);
  expect(opened.status()).toBe(303);
  expect(opened.headers()['location']).toBe('/ycode');
  const cookie = await cookieNamed(orgA, 'ws_site');
  expect(cookie?.httpOnly).toBe(true);

  const pages = await orgA.get('/ycode/api/pages');
  expect(pages.status()).toBe(200);
  const pageNames = ((await pages.json()).data as Array<{ name: string }>).map((page) => page.name);
  expect(pageNames).toContain('Homepage');

  const locales = await orgA.get('/ycode/api/locales');
  const localeRows = (await locales.json()).data as Array<{ code: string; is_default: boolean }>;
  expect(localeRows.map((locale) => locale.code).sort()).toEqual(['ar', 'en']);
  expect(localeRows.find((locale) => locale.is_default)?.code).toBe('ar');

  const page = await orgA.post('/ycode/api/pages', { data: { name: 'About A1', slug: 'about-a1' } });
  expect(page.status(), await page.text()).toBe(200);

  const asset = await orgA.post('/ycode/api/assets', { data: { filename: 'logo-a1.svg', content: SVG, source: 'file-manager' } });
  expect(asset.status(), await asset.text()).toBe(200);
});

test('site A\'s pages, assets and locales do not appear in site B\'s API', async () => {
  expect((await openSite(orgB, siteB1.id)).status()).toBe(303);

  const pages = (await (await orgB.get('/ycode/api/pages')).json()).data as Array<{ slug: string }>;
  expect(pages.map((page) => page.slug)).not.toContain('about-a1');

  const assets = (await (await orgB.get('/ycode/api/assets')).json()).data as Array<{ filename: string }>;
  expect(assets).toEqual([]);

  const locales = (await (await orgB.get('/ycode/api/locales')).json()).data as Array<{ code: string }>;
  expect(locales.map((locale) => locale.code)).toEqual(['en']);
});

test('each site publishes and answers on its own host', async () => {
  await publish(orgA); // site A1 (the cookie of this context)
  expect((await openSite(orgA, siteA2.id)).status()).toBe(303);
  await publish(orgA); // site A2
  await publish(orgB); // site B1

  const a1 = await publishedSite(baseURL, HOST_A1);
  const a2 = await publishedSite(baseURL, HOST_A2);
  const b1 = await publishedSite(baseURL, HOST_B1);
  try {
    const homeA1 = await a1.get('/');
    expect(homeA1.status()).toBe(200);
    expect(await homeA1.text()).toContain('dir="rtl"'); // Arabic is A1's default language

    const aboutA1 = await a1.get('/about-a1');
    expect(aboutA1.status()).toBe(200);

    const homeA2 = await a2.get('/');
    expect(homeA2.status()).toBe(200);
    expect(await homeA2.text()).not.toContain('dir="rtl"');

    expect((await b1.get('/')).status()).toBe(200);
    expect((await b1.get('/about-a1')).status()).toBe(404);
    expect((await a2.get('/about-a1')).status()).toBe(404);
  } finally {
    await Promise.all([a1.dispose(), a2.dispose(), b1.dispose()]);
  }

  const sitesA = await listSites(orgA);
  expect(sitesA.map((site) => site.status)).toEqual(['published', 'published']);
  expect(sitesA[0].last_published_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

test('the second organization gets 404 opening or deleting the first organization\'s site', async () => {
  expect((await openSite(orgB, siteA1.id)).status()).toBe(404);
  expect((await orgB.delete(`/ycode/api/platform/sites/${siteA1.id}`)).status()).toBe(404);
  expect((await openSite(orgB, 'not-a-uuid')).status()).toBe(404);
  expect((await listSites(orgA)).map((site) => site.id)).toContain(siteA1.id);
});

test('a ws_site cookie taken from another organization is refused with 404', async () => {
  const sessionB = await cookieNamed(orgB, 'bos_session');
  const siteCookieA = await cookieNamed(orgA, 'ws_site');
  expect(sessionB && siteCookieA).toBeTruthy();

  const forged = await request.newContext({ baseURL, storageState: { cookies: [sessionB!, siteCookieA!], origins: [] } });
  try {
    const pages = await forged.get('/ycode/api/pages');
    expect(pages.status()).toBe(404);
    expect(pages.headers()['set-cookie']).toMatch(/ws_site=;/);
    // The sites API needs no site and still answers, so the user can open one of their own.
    expect((await forged.get('/ycode/api/platform/sites')).status()).toBe(200);
  } finally {
    await forged.dispose();
  }
});

test('a request with no session gets 401', async () => {
  const anonymous = await request.newContext({ baseURL });
  try {
    expect((await anonymous.get('/ycode/api/platform/sites')).status()).toBe(401);
    expect((await anonymous.post('/ycode/api/platform/sites', { data: { name: 'X', slug: 'x', languages: ['en'], default_language: 'en' } })).status()).toBe(401);
    expect((await anonymous.get('/ycode/api/pages')).status()).toBe(401);
    expect((await anonymous.get(`/ycode/api/platform/sites/${siteA1.id}/open`, { maxRedirects: 0 })).status()).toBe(401);
  } finally {
    await anonymous.dispose();
  }
});

test('an unknown host gets 404', async () => {
  const nobody = await publishedSite(baseURL, `nobody-${RUN}.sites.test`);
  try {
    expect((await nobody.get('/')).status()).toBe(404);
    expect((await nobody.get('/about-a1')).status()).toBe(404);
  } finally {
    await nobody.dispose();
  }
});

test('a deleted site leaves All sites and its host stops resolving', async () => {
  const deleted = await orgA.delete(`/ycode/api/platform/sites/${siteA2.id}`);
  expect(deleted.status(), await deleted.text()).toBe(200);
  expect(deleted.headers()['set-cookie']).toMatch(/ws_site=;/); // A2 was the open site

  expect((await listSites(orgA)).map((site) => site.id)).toEqual([siteA1.id]);

  const a2 = await publishedSite(baseURL, HOST_A2);
  try {
    expect((await a2.get('/')).status()).toBe(404);
  } finally {
    await a2.dispose();
  }

  expect((await orgA.delete(`/ycode/api/platform/sites/${siteA2.id}`)).status()).toBe(404);
});
