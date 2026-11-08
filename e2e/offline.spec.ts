/**
 * Session 3 "done when": the builder loads nothing from a public host and
 * shows only what part 1 ships.
 *
 * A real browser opens a site in the builder with every request to a host
 * other than the app's blocked: it adds a section, the builder saves, the
 * site publishes and answers on its host, and the AI agent, integrations,
 * static export and MCP screens open. No request may reach another host, none
 * may fail, and the page may log no error. Collections, Forms and the removed
 * screens are absent from the navigation and answer 404.
 *
 * Part 2, session 13: ycode's update check is gone. It went browser -> the app's
 * own /ycode/api/updates -> api.github.com, so the blocked-host guard above never
 * saw it: the builder may not call /ycode/api/updates at all, shows no "Update
 * available" and no Updates settings entry, and those routes answer 404.
 */

import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createSite, listSites, publishedSite, signIn, type SiteRecord } from './helpers';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const ORG = '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c';
const USER = { sub: '1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c1c', email: 'owner-c@example.com', name: 'Owner C', org: ORG };
const HOST = `offline-${RUN}.sites.test`;

/** The builder fetches this on start to restore a chat; a fresh chat has none, and the 404 is the answer (stores/useAiChatStore.ts). */
const EXPECTED_404 = /\/ycode\/api\/ai\/chats\/[0-9a-f-]{36}$/;

let baseURL: string;
let site: SiteRecord;
let context: BrowserContext;
let page: Page;
const reachedOtherHosts: string[] = [];
const failedRequests: string[] = [];
const errorResponses: string[] = [];
const pageErrors: string[] = [];
const requestedUrls: string[] = [];

test.beforeAll(async ({ browser, baseURL: configured }) => {
  baseURL = configured!;
  const api = await signIn(baseURL, USER);
  site = await createSite(api, { name: 'Offline', slug: `offline-${RUN}`, languages: ['en'], default_language: 'en', hosts: [HOST] });

  context = await browser.newContext({ storageState: await api.storageState(), viewport: { width: 1600, height: 1000 } });
  await api.dispose();

  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(baseURL).origin || ['data:', 'blob:', 'about:'].includes(url.protocol)) return route.continue();
    reachedOtherHosts.push(route.request().url());
    return route.abort();
  });

  page = await context.newPage();
  page.on('request', (request) => requestedUrls.push(request.url()));
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/status of 404/.test(message.text())) pageErrors.push(message.text());
  });
  // A request the router cancels while navigating is not a failure.
  page.on('requestfailed', (request) => {
    if (request.failure()?.errorText !== 'net::ERR_ABORTED') failedRequests.push(`${request.url()} ${request.failure()?.errorText}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && !EXPECTED_404.test(response.url())) errorResponses.push(`${response.status()} ${response.url()}`);
  });
});

test.afterAll(async () => {
  await context?.close();
});

test('the builder opens a site, adds a section, saves and publishes with every other host blocked', async () => {
  await page.goto(`/ycode/api/platform/sites/${site.id}/open`);
  await page.getByRole('button', { name: 'Add layout' }).click();
  await page.getByRole('tab', { name: 'Elements' }).click();
  await expect(page.getByRole('button', { name: 'Section', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Form', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Section', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('button', { name: 'Publish' }).last().click();
  await expect.poll(async () => (await listSites(await signIn(baseURL, USER))).find((s) => s.id === site.id)?.status, { timeout: 30_000 }).toBe('published');

  const published = await publishedSite(baseURL, HOST);
  const response = await published.get('/');
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain('<section');
  expect(html).not.toMatch(/jsdelivr|googleapis|gstatic|cdn\.tailwindcss|unpkg/);
  await published.dispose();
});

test('part 1 shows Design only: no CMS and no Forms in the header', async () => {
  await page.goto(`/ycode/api/platform/sites/${site.id}/open`);
  await expect(page.getByRole('button', { name: 'Design' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'CMS' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Forms' })).toHaveCount(0);
});

test('the header carries no update notice and the builder never asks about updates', async () => {
  await page.goto(`/ycode/api/platform/sites/${site.id}/open`);
  await expect(page.getByRole('button', { name: 'Design' })).toBeVisible();
  // The old check ran once the header mounted; give it the time it needed.
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Update available')).toHaveCount(0);
  expect(requestedUrls.filter((url) => url.includes('/ycode/api/updates'))).toEqual([]);
});

test('the AI agent, integrations, static export and MCP screens open without an error', async () => {
  for (const path of ['/ycode/settings/agent', '/ycode/integrations', '/ycode/integrations/mcp', '/ycode/integrations/apps', '/ycode/integrations/api', '/ycode/integrations/webhooks', '/ycode/settings/general']) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/Application error|Something went wrong/i), path).toHaveCount(0);
  }
});

test('Collections, Forms and the removed screens answer 404', async () => {
  for (const path of ['/ycode/collections', '/ycode/collections/abc', '/ycode/forms', '/ycode/settings/users', '/ycode/settings/updates', '/ycode/profile', '/ycode/accept-invite', '/ycode/welcome']) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
  }

  const settings = await page.goto('/ycode/settings/general');
  expect(settings?.status()).toBe(200);
  await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Updates' })).toHaveCount(0);
});

test('the update check and its screen are gone: the routes answer 404', async () => {
  for (const path of ['/ycode/settings/updates', '/ycode/api/updates/check', '/ycode/api/updates/releases']) {
    const response = await context.request.get(path);
    expect(response.status(), path).toBe(404);
  }
});

test('the icons come from the app and the font mirror refuses what is not a Google font', async () => {
  const icons = await context.request.get('/ycode/api/icons?search=arrow-down-box&style=line&limit=5');
  expect(icons.status()).toBe(200);
  const body = await icons.json();
  expect(body.total).toBeGreaterThan(0);
  expect(body.icons[0].svg).toMatch(/^<svg /);

  expect((await context.request.get('/ycode/api/fonts/mirror/s/../../etc/passwd')).status()).toBe(404);
  expect((await context.request.get('/ycode/api/fonts/mirror/s/inter/v1/x.exe')).status()).toBe(404);
  expect((await context.request.get('/ycode/api/fonts/mirror/css2?family=<script>')).status()).toBe(404);
});

test('nothing reached, failed or logged an error on the way', () => {
  expect(reachedOtherHosts).toEqual([]);
  expect(failedRequests).toEqual([]);
  expect(errorResponses.filter((entry) => !/\/ycode\/(collections|forms|settings\/users|settings\/updates|profile|accept-invite|welcome)/.test(entry))).toEqual([]);
  expect(pageErrors).toEqual([]);
});
