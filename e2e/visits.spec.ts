/**
 * Part 3, session W7: visit counting (PRD V1.0 "Visit counting").
 *
 * A site with two published pages. A view reaches the server as one POST from
 * the page to its own host (`/studio/api/visits`); the spec sends it as the
 * page does, for two visitors (two addresses, two browsers), and reads
 * `platform_visits`: three views of two pages give three rows and two visitor
 * keys, with the source and the device type and nothing of the address, the
 * browser or the referrer. A bot, a prefetch, a signed-in editor and the
 * builder's preview give none. A real browser that opens the page at its own
 * host is counted once, contacts that host only and is given no cookie; with
 * scripts off it is served and not counted. A count that fails is not seen by
 * the page.
 */

import { chromium, expect, request, test, type APIRequestContext, type APIResponse, type Browser } from '@playwright/test';
import knex, { type Knex } from 'knex';
import { createSite, draftPages, openSite, publish, setHeading, signIn, TEST_SITES_DOMAIN, type SiteRecord } from './helpers';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const SLUG = `visits-${RUN}`;
const HOST = `${SLUG}.${TEST_SITES_DOMAIN}`;
const PORT = Number(process.env.E2E_PORT || 3102);
const ORIGIN = `http://${HOST}:${PORT}`;
const OWNER = { sub: 'b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7', email: 'owner-visits@example.com', name: 'Visits Owner', org: 'b8b8b8b8-b8b8-4b8b-8b8b-b8b8b8b8b8b8' };
const ROUTE = '/studio/api/visits';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

/** Two visitors: nginx names the address in X-Real-IP, the browser names itself. */
const SARA = { ip: '198.51.100.7', agent: IPHONE };
const OMAR = { ip: '198.51.100.8', agent: WINDOWS };

interface VisitRow {
  id: string;
  site_id: string;
  page_id: string;
  path: string;
  created_at: Date;
  visitor_key: string;
  source: string;
  device: string;
  kind: string;
}

let baseURL: string;
let db: Knex;
let owner: APIRequestContext;
let anonymous: APIRequestContext;
let browser: Browser;
let site: SiteRecord;
let homeId: string;
let aboutId: string;
let notFoundId: string;

const rows = () => db<VisitRow>('platform_visits').where({ site_id: site.id }).orderBy('id');
const count = async () => (await rows()).length;

/** A view as the published page sends it: to its own host, from its own origin. */
function view(
  visitor: { ip: string; agent: string },
  body: unknown,
  options: { headers?: Record<string, string>; api?: APIRequestContext; host?: string | null; origin?: string } = {},
): Promise<APIResponse> {
  const host = options.host === undefined ? HOST : options.host;
  return (options.api ?? anonymous).post(ROUTE, {
    headers: {
      'content-type': 'application/json',
      'user-agent': visitor.agent,
      'x-real-ip': visitor.ip,
      origin: options.origin ?? `http://${host ?? '127.0.0.1'}`,
      ...(host ? { 'x-forwarded-host': host } : {}),
      ...options.headers,
    },
    data: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  db = knex({ client: 'pg', connection: process.env.DATABASE_URL_TEST });
  // The site at its own host name, as a visitor's browser reaches it.
  browser = await chromium.launch({ args: [`--host-resolver-rules=MAP *.${TEST_SITES_DOMAIN} 127.0.0.1`] });
  anonymous = await request.newContext({ baseURL });
  owner = await signIn(baseURL, OWNER);
  site = await createSite(owner, { name: 'Visits', slug: SLUG, languages: ['en'], default_language: 'en' });
  expect(site.hosts[0]).toBe(HOST);
  expect((await openSite(owner, site.id)).status()).toBe(303);

  const pages = await draftPages(owner);
  homeId = pages.find((page) => page.is_index && page.error_page === null)!.id;
  notFoundId = pages.find((page) => page.error_page === 404)!.id;
  await setHeading(owner, homeId, 'Welcome to Visits');
  const created = await owner.post('/ycode/api/pages', { data: { name: 'About', slug: 'about' } });
  expect(created.ok(), await created.text()).toBe(true);
  aboutId = (await created.json()).data.id as string;
  await setHeading(owner, aboutId, 'About Visits');
  await publish(owner);
});

test.afterAll(async () => {
  if (site) await owner.delete(`/ycode/api/platform/sites/${site.id}`);
  await owner?.dispose();
  await anonymous?.dispose();
  await browser?.close();
  await db?.destroy();
});

test('three views of two pages from two visitors give three rows and two visitor keys', async () => {
  expect(await count()).toBe(0);

  // Sara comes from a search on her phone and reads two pages; Omar types the address on his desktop.
  expect((await view(SARA, { page_id: homeId, path: '/', referrer: 'www.google.com' })).status()).toBe(204);
  expect((await view(SARA, { page_id: aboutId, path: '/about', referrer: HOST })).status()).toBe(204);
  expect((await view(OMAR, { page_id: homeId, path: '/', referrer: '' })).status()).toBe(204);

  const stored = await rows();
  expect(stored.map((row) => [row.page_id, row.path, row.source, row.device, row.kind])).toEqual([
    [homeId, '/', 'search', 'phone', 'view'],
    // Reached from the site's own page: the view keeps the source Sara arrived with.
    [aboutId, '/about', 'search', 'phone', 'view'],
    [homeId, '/', 'direct', 'desktop', 'view'],
  ]);
  expect(new Set(stored.map((row) => row.visitor_key)).size).toBe(2);
  expect(stored[0].visitor_key).toBe(stored[1].visitor_key);
  expect(stored[0].visitor_key).toMatch(/^[0-9a-f]{64}$/);
  for (const row of stored) expect(Date.now() - new Date(row.created_at).getTime()).toBeLessThan(60_000);
});

test('the tables hold no address, no browser, no referrer, no name and no country', async () => {
  const columns = async (table: string) =>
    (await db('information_schema.columns').where({ table_schema: 'public', table_name: table }).orderBy('ordinal_position').select('column_name')).map((c) => c.column_name);
  expect(await columns('platform_visits')).toEqual(['id', 'site_id', 'page_id', 'path', 'created_at', 'visitor_key', 'source', 'device', 'kind']);
  expect(await columns('platform_visit_days')).toEqual(['site_id', 'day', 'path', 'source', 'device', 'views', 'visitors']);

  const text = JSON.stringify(await rows());
  for (const secret of [SARA.ip, OMAR.ip, 'iPhone', 'Windows', 'Mozilla', 'google']) expect(text, secret).not.toContain(secret);
});

test('a bot, a prefetch and a signed-in editor are answered and not counted', async () => {
  const before = await count();
  const body = { page_id: homeId, path: '/', referrer: '' };

  expect((await view({ ip: '198.51.100.20', agent: GOOGLEBOT }, body)).status()).toBe(204);
  expect((await view({ ip: '198.51.100.21', agent: 'curl/8.5.0' }, body)).status()).toBe(204);
  expect((await view({ ip: '198.51.100.22', agent: WINDOWS }, body, { headers: { 'sec-purpose': 'prefetch;prerender' } })).status()).toBe(204);
  // The editor's session reaches the route (one address serves every host in this run): his own look at the site is not a visit.
  expect((await view({ ip: '198.51.100.23', agent: WINDOWS }, body, { api: owner })).status()).toBe(204);
  expect(await count()).toBe(before);

  // The same request without what made it uncounted is a view: the four above were refused for that alone.
  expect((await view({ ip: '198.51.100.23', agent: WINDOWS }, body)).status()).toBe(204);
  expect(await count()).toBe(before + 1);
});

test('a page that is not a published page of the site is not counted: an unknown id, an error page, another site\'s page', async () => {
  const before = await count();
  const visitor = { ip: '198.51.100.30', agent: WINDOWS };
  expect((await view(visitor, { page_id: '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a', path: '/', referrer: '' })).status()).toBe(204);
  expect((await view(visitor, { page_id: notFoundId, path: '/nothing-here', referrer: '' })).status()).toBe(204);

  const other = await createSite(owner, { name: 'Visits Other', slug: `visits-other-${RUN}`, languages: ['en'], default_language: 'en' });
  try {
    // This site's page, reported on the other site's host.
    expect((await view(visitor, { page_id: homeId, path: '/', referrer: '' }, { host: other.hosts[0] })).status()).toBe(204);
    expect(await db('platform_visits').where({ site_id: other.id })).toEqual([]);
  } finally {
    await owner.delete(`/ycode/api/platform/sites/${other.id}`);
  }
  expect(await count()).toBe(before);
});

test('the route answers on a site\'s own host only, to its own pages, and reads a small body', async () => {
  const before = await count();
  const body = { page_id: homeId, path: '/', referrer: '' };

  // The builder's host names no site.
  const onBuilder = await view(OMAR, body, { host: null });
  expect(onBuilder.status()).toBe(404);
  expect((await onBuilder.json()).code).toBe('site_not_found');
  expect((await view(OMAR, body, { host: null, api: owner })).status()).toBe(404);
  expect((await view(OMAR, body, { host: `nobody-${RUN}.${TEST_SITES_DOMAIN}` })).status()).toBe(404);
  // The old name of the tree answers as the public one does.
  expect((await anonymous.post('/ycode/api/visits', { headers: { 'content-type': 'application/json', 'user-agent': WINDOWS, origin: 'http://127.0.0.1' }, data: JSON.stringify(body) })).status()).toBe(404);

  // Another site's page cannot send a view here.
  const crossOrigin = await view(OMAR, body, { origin: 'https://elsewhere.example' });
  expect(crossOrigin.status()).toBe(403);
  expect((await crossOrigin.json()).code).toBe('cross_origin');

  const tooLarge = await view(OMAR, { ...body, padding: 'x'.repeat(3000) });
  expect(tooLarge.status()).toBe(413);
  expect((await tooLarge.json()).code).toBe('too_large');

  for (const invalid of ['not json', { path: '/' }, { page_id: 'nope', path: '/' }, { page_id: homeId, path: 'about' }, { page_id: homeId, path: '/', referrer: 'https://www.google.com/search?q=private' }]) {
    const response = await view(OMAR, invalid);
    expect(response.status(), JSON.stringify(invalid)).toBe(400);
    expect((await response.json()).code).toBe('invalid_body');
  }

  expect(await count()).toBe(before);
});

test('a real browser at the site\'s own host is counted once per page, contacts that host only and is given no cookie and no storage', async () => {
  const before = await count();
  const context = await browser.newContext({ baseURL: ORIGIN, userAgent: WINDOWS });
  const hosts = new Set<string>();
  const beacons: string[] = [];
  context.on('request', (req) => {
    const url = new URL(req.url());
    if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) hosts.add(url.host);
    if (url.pathname === ROUTE) beacons.push(req.postData() ?? '');
  });
  try {
    const page = await context.newPage();
    const answered = page.waitForResponse((response) => new URL(response.url()).pathname === ROUTE);
    // The visitor arrives from a search result.
    await page.goto('/', { referer: 'https://www.google.com/search?q=a+private+question' });
    await expect(page.getByRole('heading', { name: 'Welcome to Visits' })).toBeVisible();
    expect((await answered).status()).toBe(204);
    await expect.poll(count).toBe(before + 1);

    // And moves on inside the site, as a link on the page does (a published link is a plain <a>: a full load).
    const next = page.waitForResponse((response) => new URL(response.url()).pathname === ROUTE);
    await page.evaluate(() => window.location.assign('/about?from=home#top'));
    await expect(page.getByRole('heading', { name: 'About Visits' })).toBeVisible();
    expect((await next).status()).toBe(204);
    await expect.poll(count).toBe(before + 2);
    await page.waitForLoadState('networkidle');

    expect(beacons.map((body) => JSON.parse(body))).toEqual([
      // Only the referrer's host leaves the browser.
      { page_id: homeId, path: '/', referrer: 'www.google.com' },
      { page_id: aboutId, path: '/about', referrer: HOST },
    ]);
    const stored = (await rows()).slice(-2);
    expect(stored.map((row) => [row.page_id, row.path, row.source, row.device])).toEqual([
      [homeId, '/', 'search', 'desktop'],
      [aboutId, '/about', 'search', 'desktop'],
    ]);
    expect(stored[0].visitor_key).toBe(stored[1].visitor_key);

    expect(await context.cookies()).toEqual([]);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  } finally {
    await context.close();
  }
  expect([...hosts], 'hosts the published page contacted').toEqual([`${HOST}:${PORT}`]);
});

test('with scripts off the page is served and not counted', async () => {
  const before = await count();
  const context = await browser.newContext({ baseURL: ORIGIN, userAgent: WINDOWS, javaScriptEnabled: false });
  const beacons: string[] = [];
  context.on('request', (req) => {
    if (new URL(req.url()).pathname === ROUTE) beacons.push(req.url());
  });
  try {
    const page = await context.newPage();
    const response = await page.goto('/');
    expect(response!.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Welcome to Visits' })).toBeVisible();
    await page.waitForLoadState('networkidle');
  } finally {
    await context.close();
  }
  expect(beacons).toEqual([]);
  expect(await count()).toBe(before);
});

test('the builder\'s preview and an error page send no view', async () => {
  const before = await count();
  const beacons: string[] = [];
  const watch = (url: string) => {
    if (new URL(url).pathname === ROUTE) beacons.push(url);
  };

  // The editor's preview of the draft, in a browser that would be counted on a published page.
  const editing = await browser.newContext({ baseURL, storageState: await owner.storageState(), userAgent: WINDOWS });
  editing.on('request', (req) => watch(req.url()));
  try {
    const page = await editing.newPage();
    await page.goto('/ycode/preview');
    await expect(page.getByRole('heading', { name: 'Welcome to Visits' })).toBeVisible();
    await page.goto('/ycode/preview/about');
    await expect(page.getByRole('heading', { name: 'About Visits' })).toBeVisible();
    await page.waitForLoadState('networkidle');
  } finally {
    await editing.close();
  }

  // A visitor who asks for a page the site does not have.
  const visiting = await browser.newContext({ baseURL: ORIGIN, userAgent: WINDOWS });
  visiting.on('request', (req) => watch(req.url()));
  try {
    const page = await visiting.newPage();
    const response = await page.goto('/nothing-here');
    expect(response!.status()).toBe(404);
    await page.waitForLoadState('networkidle');
  } finally {
    await visiting.close();
  }

  expect(beacons).toEqual([]);
  expect(await count()).toBe(before);
});

test('a count that fails is logged and never seen by the page', async () => {
  const before = await count();
  const visitor = { ip: '198.51.100.40', agent: WINDOWS };
  const body = { page_id: homeId, path: '/', referrer: '' };
  await db.raw('ALTER TABLE platform_visits RENAME TO platform_visits_away');
  try {
    expect((await view(visitor, body)).status()).toBe(204);
    const page = await anonymous.get('/', { headers: { 'x-forwarded-host': HOST } });
    expect(page.status()).toBe(200);
    expect(await page.text()).toContain('Welcome to Visits');
  } finally {
    await db.raw('ALTER TABLE platform_visits_away RENAME TO platform_visits');
  }
  expect(await count()).toBe(before);
  // The table is back: the next view is counted.
  expect((await view(visitor, body)).status()).toBe(204);
  expect(await count()).toBe(before + 1);
});

test('one address is allowed 600 requests in ten minutes per site, then answered 429', async () => {
  const before = await count();
  // A bot's requests count towards the limit and store nothing.
  const flood = { ip: '198.51.100.99', agent: GOOGLEBOT };
  const body = { page_id: homeId, path: '/', referrer: '' };
  const statuses: number[] = [];
  for (let sent = 0; sent < 600; sent += 50) {
    statuses.push(...(await Promise.all(Array.from({ length: 50 }, async () => (await view(flood, body)).status()))));
  }
  expect(statuses.filter((status) => status === 204)).toHaveLength(600);

  const refused = await view(flood, body);
  expect(refused.status()).toBe(429);
  expect((await refused.json()).code).toBe('rate_limited');
  // A person at the same address is refused too, and a person at another address is not.
  expect((await view({ ip: flood.ip, agent: WINDOWS }, body)).status()).toBe(429);
  expect(await count()).toBe(before);
  expect((await view({ ip: '198.51.100.98', agent: WINDOWS }, body)).status()).toBe(204);
  expect(await count()).toBe(before + 1);
});
