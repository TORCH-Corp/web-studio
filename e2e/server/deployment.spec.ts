/**
 * Session 11 "done when", against the deployed server (playwright.server.config.ts).
 *
 * The service answers on its host and on the sites domain, refuses the dev
 * login, signs a user in through the token flow (auth-service's access token to
 * the callback), lists TORCH's templates, creates a site, publishes it and
 * serves it on https://{slug}.{sites domain} in both languages, then deletes it.
 */

import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { createSite, draftPages, openSite, publish, setHeading, signInWithToken, type SiteRecord } from '../helpers';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const AUTH_URL = process.env.E2E_AUTH_URL || 'https://auth.torchcorp.com';
const SITES_DOMAIN = process.env.E2E_SITES_DOMAIN || 'sites.torchcorp.com';
const SLUG = `e2e-${RUN}`;
const HOST = `${SLUG}.${SITES_DOMAIN}`;

let baseURL: string;
let api: APIRequestContext;
let site: SiteRecord | undefined;

async function accessToken(): Promise<string> {
  const auth = await request.newContext({ baseURL: AUTH_URL });
  try {
    const response = await auth.post('/auth/login', { data: { email: process.env.E2E_BOS_EMAIL, password: process.env.E2E_BOS_PASSWORD } });
    expect(response.status(), 'auth-service login').toBe(200);
    return (await response.json()).accessToken as string;
  } finally {
    await auth.dispose();
  }
}

/** A published page, fetched over the public internet by its own host name, with no cookies. */
async function visit(host: string, path: string) {
  const anonymous = await request.newContext({ baseURL: `https://${host}` });
  try {
    const response = await anonymous.get(path, { maxRedirects: 0 });
    return { status: response.status(), html: await response.text() };
  } finally {
    await anonymous.dispose();
  }
}

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
});

test.afterAll(async () => {
  if (site && api) await api.delete(`/ycode/api/platform/sites/${site.id}`);
  await api?.dispose();
});

test('the service is healthy, the dev login is off, and nothing answers without a session', async () => {
  const anonymous = await request.newContext({ baseURL });
  try {
    const health = await anonymous.get('/ycode/api/health');
    expect(health.status()).toBe(200);
    expect((await health.json()).status).toBe('ok');

    const dev = await anonymous.post('/ycode/api/auth/dev-login', { data: { sub: 'x', email: 'x@example.com', org: 'x' } });
    expect(dev.status()).toBe(404);

    expect((await anonymous.get('/ycode/api/platform/sites')).status()).toBe(401);
  } finally {
    await anonymous.dispose();
  }
});

test('the sites domain answers: an unused address is 404 with no site in it', async () => {
  const unused = await visit(`nobody-${RUN}.${SITES_DOMAIN}`, '/');
  expect(unused.status).toBe(404);
  expect(unused.html).toContain('Page Not Found');
});

test('an access token from auth-service signs in, and TORCH\'s three templates are listed', async () => {
  api = await signInWithToken(baseURL, await accessToken());
  const session = await api.get('/ycode/api/auth/session', { headers: { accept: 'application/json' } });
  expect(session.status()).toBe(200);

  const response = await api.get('/ycode/api/platform/templates');
  expect(response.status(), await response.text()).toBe(200);
  const slugs = ((await response.json()).data as Array<{ slug: string }>).map((t) => t.slug);
  expect(slugs).toEqual(['company-site', 'landing-page', 'blank']);
});

test('a site is created, published and served on its own address in both languages', async () => {
  site = await createSite(api, { name: `E2E ${RUN}`, slug: SLUG, languages: ['en', 'ar'], default_language: 'en' });
  expect(site.hosts).toEqual([HOST]);

  expect((await openSite(api, site.id)).status()).toBe(303);
  const home = (await draftPages(api)).find((page) => page.is_index);
  expect(home).toBeTruthy();
  await setHeading(api, home!.id, `Served from ${RUN}`);
  await publish(api);

  const root = await visit(HOST, '/');
  expect(root.status).toBe(200);
  expect(root.html).toContain(`Served from ${RUN}`);
  expect(root.html).toMatch(/<html[^>]*\blang="en"/);

  const arabic = await visit(HOST, '/ar');
  expect(arabic.status).toBe(200);
  expect(arabic.html).toContain('dir="rtl"');
});

test('a deleted site stops answering', async () => {
  const deleted = await api.delete(`/ycode/api/platform/sites/${site!.id}`);
  expect(deleted.status(), await deleted.text()).toBe(200);
  site = undefined;
  expect((await visit(HOST, '/')).status).toBe(404);
});
