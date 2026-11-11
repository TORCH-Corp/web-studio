/**
 * Part 3, session W8: the three conversion events, the daily totals and the 90-day clean-up
 * (PRD V1.0 "Visit counting" and "Conversions report").
 *
 * A selling site with a published home page and a product card on it. A visitor's page view, add to cart, order and
 * form submission reach the server the way the page and the buyer send them; every one of them carries the key the
 * visitor's page view has that day. The daily run (`pnpm visits:totals`, the command the server's own timer runs) then
 * turns finished days into totals: once per visitor and kind, twice over changes nothing, and detailed rows older than
 * 90 days are gone once their day is in the totals, which stay.
 */

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import knex, { type Knex } from 'knex';
import { chromium, expect, request, test, type APIRequestContext, type APIResponse, type Browser } from '@playwright/test';
import { HONEYPOT_FIELD_NAME } from '../lib/form-spam-settings';
import { visitDay } from '../lib/platform/visit-rules';
import { createSite, draftPages, openSite, publish, signIn, TEST_SITES_DOMAIN, type SiteRecord } from './helpers';
import { BRANCH, CATALOGUE_ORG, CATEGORY, ITEM } from './platform-fixtures';

test.describe.configure({ mode: 'serial' });

const run = promisify(execFile);

const RUN = Date.now().toString(36);
const SLUG = `events-${RUN}`;
const HOST = `${SLUG}.${TEST_SITES_DOMAIN}`;
const PORT = Number(process.env.E2E_PORT || 3102);
const PLATFORM = `http://127.0.0.1:${Number(process.env.E2E_PLATFORM_PORT || PORT + 3)}`;
const OWNER = { sub: 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9', email: 'owner-events@example.com', name: 'Events Owner', org: CATALOGUE_ORG };

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/** Sara comes from a search on her phone; Omar is on a desktop. nginx names the address in X-Real-IP. */
const SARA = { ip: '198.51.100.41', agent: IPHONE };
const OMAR = { ip: '198.51.100.42', agent: WINDOWS };

const DIGITS = String(Date.now()).slice(-7);
const PHONE = `0770 ${DIGITS.slice(0, 3)} ${DIGITS.slice(3)}`;

const DAY = 86_400_000;
const ago = (days: number): Date => new Date(Date.now() - days * DAY);

interface VisitRow {
  id: number;
  site_id: string;
  page_id: string | null;
  path: string | null;
  created_at: Date;
  visitor_key: string;
  source: string;
  device: string;
  kind: string;
}

interface SiteDay {
  day: string;
  visitors: number;
  cart_visitors: number;
  order_visitors: number;
  orders: number;
  form_visitors: number;
  forms: number;
}

interface PageDay {
  day: string;
  path: string;
  source: string;
  device: string;
  views: number;
  visitors: number;
}

interface Totals {
  skipped: boolean;
  siteDays: number;
  deleted: number;
}

type Identity = { ip: string; agent: string };

let baseURL: string;
let db: Knex;
let owner: APIRequestContext;
let anonymous: APIRequestContext;
let browser: Browser;
let site: SiteRecord;
let homeId: string;

const rows = () => db<VisitRow>('platform_visits').where({ site_id: site.id }).orderBy('id');
const kinds = async () => (await rows()).map((row) => row.kind);

/** What the page, or the buyer, sends to the site's own host: its own origin, nginx's header for the address, the browser's name. */
function send(who: Identity, path: string, body: unknown, options: { origin?: string } = {}): Promise<APIResponse> {
  return anonymous.post(path, {
    headers: {
      'content-type': 'application/json',
      'user-agent': who.agent,
      'x-real-ip': who.ip,
      'x-forwarded-host': HOST,
      origin: options.origin ?? `http://${HOST}`,
    },
    data: JSON.stringify(body),
  });
}

const view = (who: Identity, referrer = '') => send(who, '/studio/api/visits', { page_id: homeId, path: '/', referrer });
const addToCart = (who: Identity) => send(who, '/studio/api/visits', { kind: 'add_to_cart' });
const submitForm = (who: Identity, payload: Record<string, unknown>, options: { origin?: string } = {}) =>
  send(who, '/studio/api/form-submissions', { form_id: 'contact-form', payload }, options);

function checkoutBody(lines: Array<{ item_id: string; quantity: string }> = [{ item_id: ITEM.lamp, quantity: '1' }]) {
  return {
    checkout_id: randomUUID(),
    buyer: { name: 'Sara Ali', phone: PHONE, city: 'baghdad', address: 'Karrada, street 62, house 14' },
    lines,
    locale: 'en',
  };
}
const checkout = (who: Identity, body: unknown) => send(who, '/studio/api/store/checkout', body);

async function salesDelay(ms: number): Promise<void> {
  const context = await request.newContext();
  try {
    expect((await context.post(`${PLATFORM}/__sales/delay`, { data: { ms } })).status()).toBe(200);
  } finally {
    await context.dispose();
  }
}

async function servicesDown(services: string[]): Promise<void> {
  const context = await request.newContext();
  try {
    expect((await context.post(`${PLATFORM}/__down`, { data: { services } })).status()).toBe(200);
  } finally {
    await context.dispose();
  }
}

/** The daily run, as the server's timer and an operator run it: one command against the test database. */
async function dailyRun(): Promise<Totals> {
  const { stdout } = await run('pnpm', ['--silent', 'visits:totals'], {
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL_TEST! },
    timeout: 80_000,
  });
  return JSON.parse(stdout.trim().split('\n').at(-1)!) as Totals;
}

/** A `date` column as `YYYY-MM-DD`, read by the database: a JS Date at local midnight would move a day in some time zones. */
const SITE_DAY_COLUMNS = ['visitors', 'cart_visitors', 'order_visitors', 'orders', 'form_visitors', 'forms'] as const;
const siteDays = async (): Promise<SiteDay[]> =>
  (await db('platform_visit_site_days')
    .where({ site_id: site.id })
    .orderBy('day')
    .select(db.raw("to_char(day, 'YYYY-MM-DD') AS day"), ...SITE_DAY_COLUMNS)) as SiteDay[];
const pageDays = async (): Promise<PageDay[]> =>
  (await db('platform_visit_days')
    .where({ site_id: site.id })
    .orderBy(['day', 'path', 'source', 'device'])
    .select(db.raw("to_char(day, 'YYYY-MM-DD') AS day"), 'path', 'source', 'device', 'views', 'visitors')) as PageDay[];

async function insertVisit(row: { at: Date; key: string; kind?: string; path?: string | null; source?: string; device?: string }): Promise<void> {
  const kind = row.kind ?? 'view';
  await db('platform_visits').insert({
    site_id: site.id,
    page_id: kind === 'view' ? homeId : null,
    path: kind === 'view' ? (row.path ?? '/') : null,
    created_at: row.at,
    visitor_key: row.key,
    source: row.source ?? 'direct',
    device: row.device ?? 'desktop',
    kind,
  });
}

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  db = knex({ client: 'pg', connection: process.env.DATABASE_URL_TEST });
  browser = await chromium.launch({ args: [`--host-resolver-rules=MAP *.${TEST_SITES_DOMAIN} 127.0.0.1`] });
  anonymous = await request.newContext({ baseURL });
  await servicesDown([]);
  owner = await signIn(baseURL, OWNER);
  site = await createSite(owner, { name: 'Events Store', slug: SLUG, languages: ['en'], default_language: 'en' });
  expect(site.hosts[0]).toBe(HOST);
  expect((await openSite(owner, site.id)).status()).toBe(303);
  // The checkout's and the form's rate limit are not what this spec is about.
  const spam = await owner.put('/ycode/api/settings/form_spam_protection', {
    data: { value: { enabled: true, rateLimitEnabled: true, rateLimitMaxSubmissions: 1000, allowExternalSubmissions: false } },
  });
  expect(spam.status(), await spam.text()).toBe(200);
  const store = await owner.patch(`/ycode/api/platform/sites/${site.id}/store`, {
    data: { branch_id: BRANCH.catalogue, category_ids: [CATEGORY.clothing, CATEGORY.home], delivery_fee: 2500, selling: true },
  });
  expect(store.status(), await store.text()).toBe(200);

  homeId = (await draftPages(owner)).find((page) => page.is_index && page.error_page === null)!.id;
  const layers = [
    {
      id: 'body',
      name: 'body',
      classes: '',
      children: [
        { id: 'card', name: 'productCard', classes: 'w-full', settings: { tag: 'div', store: { productCard: { product: { id: ITEM.lamp, name: 'Desk lamp', name_ar: 'مصباح مكتب' } } } }, children: [] },
      ],
    },
  ];
  const put = await owner.put(`/ycode/api/layers?page_id=${homeId}`, { data: { layers } });
  expect(put.status(), await put.text()).toBe(200);
  await publish(owner);
});

test.afterAll(async () => {
  await servicesDown([]);
  await salesDelay(0);
  if (site) await owner.delete(`/ycode/api/platform/sites/${site.id}`);
  await owner?.dispose();
  await anonymous?.dispose();
  await browser?.close();
  await db?.destroy();
});

test('a visitor who views, adds to the cart twice and orders gives one cart visitor and one order, all under the key of his view', async () => {
  expect(await rows()).toEqual([]);
  expect((await view(SARA, 'www.google.com')).status()).toBe(204);
  expect((await addToCart(SARA)).status()).toBe(204);
  expect((await addToCart(SARA)).status()).toBe(204);
  const placed = await checkout(SARA, checkoutBody());
  expect(placed.status(), await placed.text()).toBe(201);

  const stored = await rows();
  // The cart is one row for the day: a visitor counts once per kind, however many times he adds.
  expect(stored.map((row) => row.kind)).toEqual(['view', 'add_to_cart', 'order']);
  expect(new Set(stored.map((row) => row.visitor_key)).size).toBe(1);
  expect(stored[0].visitor_key).toMatch(/^[0-9a-f]{64}$/);
  // The events come from the visitor's own day: his source and his device, and no page.
  expect(stored.map((row) => [row.source, row.device])).toEqual([['search', 'phone'], ['search', 'phone'], ['search', 'phone']]);
  expect(stored.slice(1).map((row) => [row.page_id, row.path])).toEqual([[null, null], [null, null]]);
});

test('an order is written once per Sales order: a refused item, Sales down and a replay write none; a second order is a second; a double click is one', async () => {
  const before = await kinds();

  // The chair is not on sale: 422, nothing created.
  expect((await checkout(SARA, checkoutBody([{ item_id: ITEM.chair, quantity: '1' }]))).status()).toBe(422);
  expect(await kinds()).toEqual(before);

  // Sales cannot be asked: 503, nothing created; once it can, the same checkout is the order and is written.
  const body = checkoutBody();
  await servicesDown(['sales']);
  try {
    expect((await checkout(SARA, body)).status()).toBe(503);
  } finally {
    await servicesDown([]);
  }
  expect(await kinds()).toEqual(before);
  expect((await checkout(SARA, body)).status()).toBe(201);
  expect(await kinds()).toEqual([...before, 'order']);

  // The same checkout again is answered by its order and writes nothing; a body with a different checkout id is another order.
  expect((await checkout(SARA, body)).status()).toBe(200);
  expect(await kinds()).toEqual([...before, 'order']);
  expect((await checkout(SARA, checkoutBody())).status()).toBe(201);
  expect(await kinds()).toEqual([...before, 'order', 'order']);
  expect(new Set((await rows()).map((row) => row.visitor_key)).size).toBe(1);

  // A double click: two posts of one checkout while Sales is still answering share one order, so they are one order event.
  const afterTwo = await kinds();
  const double = checkoutBody();
  await salesDelay(400);
  try {
    const answers = await Promise.all([checkout(SARA, double), checkout(SARA, double)]);
    for (const answer of answers) expect([200, 201], await answer.text()).toContain(answer.status());
  } finally {
    await salesDelay(0);
  }
  expect(await kinds()).toEqual([...afterTwo, 'order']);
});

test('a form submission gives one form event under the key of the visitor\'s view; spam, a refused post and a bad body give none', async () => {
  const before = await kinds();
  const sent = await submitForm(SARA, { name: 'Sara', email: 'sara@example.com', message: 'Do you deliver to Basra?' });
  expect(sent.status(), await sent.text()).toBe(201);
  const stored = await rows();
  expect(stored.map((row) => row.kind)).toEqual([...before, 'form']);
  expect(new Set(stored.map((row) => row.visitor_key)).size).toBe(1);
  expect(stored.at(-1)).toMatchObject({ source: 'search', device: 'phone', page_id: null, path: null });

  // A bot that fills the honeypot is answered like a success and filed as spam: not a conversion.
  const spam = await submitForm(OMAR, { name: 'Bot', message: 'buy now', [HONEYPOT_FIELD_NAME]: 'gotcha' });
  expect(spam.status(), await spam.text()).toBe(201);
  expect((await submitForm(OMAR, { name: 'Elsewhere' }, { origin: 'http://elsewhere.example' })).status()).toBe(403);
  expect((await send(OMAR, '/studio/api/form-submissions', { payload: {} })).status()).toBe(400);
  expect(await kinds()).toEqual([...before, 'form']);

  // A second message from the same visitor is a second submission, as the orders are.
  expect((await submitForm(SARA, { name: 'Sara', message: 'And Najaf?' })).status()).toBe(201);
  expect(await kinds()).toEqual([...before, 'form', 'form']);
});

test('only an add to cart can be reported by a browser: an order or a form event in the body is refused', async () => {
  const before = await kinds();
  for (const kind of ['order', 'form', 'purchase']) {
    const answer = await send(OMAR, '/studio/api/visits', { kind });
    expect(answer.status(), kind).toBe(400);
    expect((await answer.json()).code).toBe('invalid_body');
  }
  // A bot's add to cart is not a visitor's.
  expect((await send({ ip: OMAR.ip, agent: 'curl/8.5.0' }, '/studio/api/visits', { kind: 'add_to_cart' })).status()).toBe(204);
  // On the builder's host there is no site to count for.
  const builder = await anonymous.post('/studio/api/visits', { headers: { 'content-type': 'application/json', 'user-agent': OMAR.agent, 'x-real-ip': OMAR.ip, origin: 'http://127.0.0.1' }, data: JSON.stringify({ kind: 'add_to_cart' }) });
  expect(builder.status()).toBe(404);
  expect(await kinds()).toEqual(before);
});

test('the product card\'s Add to cart in a real browser reports one cart visitor, however many times it is pressed', async () => {
  const context = await browser.newContext({ userAgent: WINDOWS });
  try {
    const page = await context.newPage();
    await page.goto(`http://${HOST}:${PORT}/`);
    const card = page.locator('[data-ws-store="productCard"]');
    await expect(card.locator('.ws-card-name')).toHaveText('Desk lamp');
    // Its own page view first, then the add to cart under the same key: this browser is the only desktop visitor so far.
    await expect.poll(async () => (await rows().where({ device: 'desktop', kind: 'view' })).length).toBe(1);
    await card.getByRole('button', { name: 'Add to cart' }).click();
    await card.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.locator('[data-ws-store="cartIndicator"] .ws-badge, .ws-badge').first()).toBeAttached().catch(() => undefined);
    await expect.poll(async () => (await rows().where({ device: 'desktop', kind: 'add_to_cart' })).length).toBe(1);

    const [viewed] = await rows().where({ device: 'desktop', kind: 'view' });
    const [added] = await rows().where({ device: 'desktop', kind: 'add_to_cart' });
    expect(added.visitor_key).toBe(viewed.visitor_key);
    expect(added.visitor_key).not.toBe((await rows().where({ device: 'phone' }).first())!.visitor_key);
    expect([added.source, added.page_id, added.path]).toEqual(['direct', null, null]);
    // A third press a moment later is still the same visitor's day.
    await card.getByRole('button', { name: 'Add to cart' }).click();
    await page.waitForTimeout(500);
    expect((await rows().where({ device: 'desktop', kind: 'add_to_cart' })).length).toBe(1);
  } finally {
    await context.close();
  }
});

test('the new table holds numbers only: no address, no browser, no referrer, no name and no country', async () => {
  const columns = async (table: string) =>
    (await db('information_schema.columns').where({ table_schema: 'public', table_name: table }).orderBy('ordinal_position').select('column_name')).map((c) => c.column_name);
  expect(await columns('platform_visit_site_days')).toEqual(['site_id', 'day', 'visitors', 'cart_visitors', 'order_visitors', 'orders', 'form_visitors', 'forms']);
  // The detailed rows and the per-page totals are as session W7 made them.
  expect(await columns('platform_visits')).toEqual(['id', 'site_id', 'page_id', 'path', 'created_at', 'visitor_key', 'source', 'device', 'kind']);
  expect(await columns('platform_visit_days')).toEqual(['site_id', 'day', 'path', 'source', 'device', 'views', 'visitors']);
});

test('the daily run totals every finished day once, twice over changes nothing, and 90 days on the detail goes and the total stays', async () => {
  // Everything above was made today. Move it to two days ago, so that it is a finished day.
  await db('platform_visits').where({ site_id: site.id }).update({ created_at: db.raw("created_at - interval '2 days'") });
  const twoDaysAgo = visitDay(ago(2));
  expect(new Set((await rows()).map((row) => visitDay(new Date(row.created_at))))).toEqual(new Set([twoDaysAgo]));

  const old91 = visitDay(ago(91));
  const old89 = visitDay(ago(89));
  const old120 = visitDay(ago(120));
  const edge = visitDay(ago(5));
  const afterEdge = visitDay(ago(4));
  // 91 days ago: a view and an order of one visitor. 89 days ago: one view. 120 days ago: a backlog no run has seen.
  await insertVisit({ at: ago(91), key: 'old-visitor-91', source: 'search', device: 'phone' });
  await insertVisit({ at: ago(91), key: 'old-visitor-91', kind: 'order', source: 'search', device: 'phone' });
  await insertVisit({ at: ago(89), key: 'old-visitor-89', path: '/about' });
  await insertVisit({ at: ago(120), key: 'old-visitor-120', path: '/about' });
  // The platform's day ends at midnight in Baghdad: the last second of one day and the first of the next are two days.
  await insertVisit({ at: new Date(`${edge}T23:59:59+03:00`), key: 'edge-before' });
  await insertVisit({ at: new Date(`${afterEdge}T00:00:01+03:00`), key: 'edge-after' });
  // Today is not finished: its rows are neither totalled nor deleted.
  await insertVisit({ at: new Date(), key: 'today-visitor' });

  const first = await dailyRun();
  expect(first.skipped).toBe(false);
  // This site's finished days: 120, 91, 89, 5 and 4 days ago, and the two days ago of the first tests (other specs' sites hold only today).
  expect(first.siteDays).toBeGreaterThanOrEqual(6);
  // The 91-day view and order and the 120-day view; nothing newer.
  expect(first.deleted).toBe(3);

  const totals = await siteDays();
  const byDay = new Map(totals.map(({ day: when, ...rest }) => [when, rest] as const));
  const none = { cart_visitors: 0, order_visitors: 0, orders: 0, form_visitors: 0, forms: 0 };
  expect(byDay.get(old91)).toEqual({ visitors: 1, ...none, order_visitors: 1, orders: 1 });
  expect(byDay.get(old120)).toEqual({ visitors: 1, ...none });
  expect(byDay.get(old89)).toEqual({ visitors: 1, ...none });
  expect(byDay.get(edge)).toEqual({ visitors: 1, ...none });
  expect(byDay.get(afterEdge)).toEqual({ visitors: 1, ...none });
  // Sara viewed, added to the cart twice, placed four orders (the double click is one) and sent two forms; the browser viewed and added to the cart.
  expect(byDay.get(twoDaysAgo)).toEqual({ visitors: 2, cart_visitors: 2, order_visitors: 1, orders: 4, form_visitors: 1, forms: 2 });
  expect(byDay.has(visitDay(new Date()))).toBe(false);

  const pages = (await pageDays()).filter((row) => row.day === twoDaysAgo);
  expect(pages.map(({ path, source, device, views, visitors }) => ({ path, source, device, views, visitors }))).toEqual([
    { path: '/', source: 'direct', device: 'desktop', views: 1, visitors: 1 },
    { path: '/', source: 'search', device: 'phone', views: 1, visitors: 1 },
  ]);
  expect((await pageDays()).find((row) => row.day === old91)).toMatchObject({ path: '/', source: 'search', device: 'phone', views: 1, visitors: 1 });

  // The detail older than 90 days is gone, and its totals are there; the rest of the detail is not touched.
  const left = await rows();
  expect(left.filter((row) => new Date(row.created_at).getTime() < ago(90).getTime())).toEqual([]);
  expect(left.map((row) => row.visitor_key)).toEqual(expect.arrayContaining(['old-visitor-89', 'edge-before', 'edge-after', 'today-visitor']));
  expect(left.map((row) => row.visitor_key)).not.toContain('old-visitor-91');
  expect(left.map((row) => row.visitor_key)).not.toContain('old-visitor-120');

  // The second run finds nothing to total and nothing to delete, and every number stays what it was.
  const snapshot = { site: await siteDays(), pages: await pageDays(), detail: left };
  const second = await dailyRun();
  expect(second).toEqual({ skipped: false, siteDays: 0, deleted: 0 });
  expect({ site: await siteDays(), pages: await pageDays(), detail: await rows() }).toEqual(snapshot);
});
