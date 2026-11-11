/**
 * Part 3, session W9: the Reports API for the app (PRD V1.0 "Traffic report", "Conversions report", "Dashboard").
 *
 * GET /ycode/api/platform/sites/{id}/reports/traffic
 * GET /ycode/api/platform/sites/{id}/reports/conversions
 * GET /ycode/api/platform/reports/summary
 *
 * All three need `webstudio.manage_reports` r and take a period: `?period=today|last_7_days|last_30_days`, or
 * `?from=YYYY-MM-DD&to=YYYY-MM-DD` (the platform's days, Baghdad time; at most 366 days).
 *
 * The fixture is detailed rows in `platform_visits`, the way the visit route and the events write them, for three
 * sites of one organization: a selling site (the Store), a site that does not sell (the Landing) and a draft that was
 * never published. The daily run (`pnpm visits:totals`, what the service's own timer runs) turns the finished days
 * into totals; the Store's detailed rows are then deleted, so a number of a finished day can only come from the totals,
 * and today's rows are never totalled, so today can only come from the detailed rows. The Landing keeps its detailed rows
 * of a totalled day, as production does for 90 days: the day is counted once. Its yesterday is written after the run: a
 * finished day the run has not reached yet is read from the detailed rows too.
 *
 * Every number the spec expects is written out by hand from the rows below, never derived by the code under test.
 */

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import knex, { type Knex } from 'knex';
import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { visitDay } from '../lib/platform/visit-rules';
import { createSite, draftPages, openSite, publish, signIn, type SiteRecord } from './helpers';

test.describe.configure({ mode: 'serial' });

const run = promisify(execFile);

const RUN = Date.now().toString(36);
const ORG = '5e5e5e5e-5e5e-4e5e-8e5e-5e5e5e5e5e5e';
const OTHER_ORG = '6f6f6f6f-6f6f-4f6f-8f6f-6f6f6f6f6f6f';
const OWNER = { sub: '5e5e5e5e-0000-4e5e-8e5e-000000000001', email: 'owner-reports-api@example.com', name: 'Reports Owner', org: ORG };
const STRANGER = { sub: '6f6f6f6f-0000-4f6f-8f6f-000000000001', email: 'stranger-reports-api@example.com', name: 'Reports Stranger', org: OTHER_ORG };

const DAY = 86_400_000;
/** The platform's day `n` days ago, `YYYY-MM-DD`. Baghdad has no daylight saving, so 24 hours is a day. */
const dayOf = (n: number): string => visitDay(new Date(Date.now() - n * DAY));
/** Midday of that day in Baghdad (UTC+3): the middle of the day, whatever time the spec runs at. */
const middayOf = (n: number): Date => new Date(`${dayOf(n)}T12:00:00+03:00`);
/** The days of the last `count` days, oldest first, today last. */
const lastDays = (count: number): string[] => Array.from({ length: count }, (_, i) => dayOf(count - 1 - i));

interface Period {
  key: string;
  from: string;
  to: string;
  days: number;
}
interface Traffic {
  period: Period;
  no_data: boolean;
  views: number;
  visitors_per_day: number;
  series: Array<{ day: string; views: number; visitors: number }>;
  pages: { total: number; top: Array<{ path: string; name: string | null; views: number; share: number }> };
  sources: Array<{ source: string; views: number; share: number }>;
  devices: Array<{ device: string; views: number; share: number }>;
}
interface Conversions {
  period: Period;
  no_data: boolean;
  sells: boolean;
  steps: Array<{ step: string; count: number; share: number | null }>;
}
interface Summary {
  period: Period;
  no_data: boolean;
  total: { views: number; visitors_per_day: number };
  sites: Array<{ id: string; name: string; status: string; views: number | null; visitors_per_day: number | null; views_by_day: Array<{ day: string; views: number }> | null }>;
}

let baseURL: string;
let db: Knex;
let owner: APIRequestContext;
let store: SiteRecord;
let landing: SiteRecord;
let draft: SiteRecord;
let strangerSite: SiteRecord;
const created: SiteRecord[] = [];

const OLD_PAGE = randomUUID(); // a page that has been deleted since its visits

const trafficUrl = (id: string, query: string) => `/ycode/api/platform/sites/${id}/reports/traffic?${query}`;
const conversionsUrl = (id: string, query: string) => `/ycode/api/platform/sites/${id}/reports/conversions?${query}`;
const summaryUrl = (query: string) => `/ycode/api/platform/reports/summary?${query}`;

async function read<T>(api: APIRequestContext, url: string): Promise<T> {
  const response = await api.get(url);
  expect(response.status(), `${url}: ${await response.text()}`).toBe(200);
  return ((await response.json()) as { data: T }).data;
}
const traffic = (query: string, id = store.id, api = owner) => read<Traffic>(api, trafficUrl(id, query));
const conversions = (query: string, id = store.id, api = owner) => read<Conversions>(api, conversionsUrl(id, query));
const summary = (query: string, api = owner) => read<Summary>(api, summaryUrl(query));

/** The shares of a list add up to exactly 100.0, in tenths so that no float sum is compared. */
const tenths = (shares: number[]) => shares.reduce((sum, share) => sum + Math.round(share * 10), 0);

interface Row {
  site: SiteRecord;
  ago: number;
  key: string;
  kind?: 'view' | 'add_to_cart' | 'order' | 'form';
  path?: string;
  source?: 'direct' | 'search' | 'social' | 'referral';
  device?: 'phone' | 'desktop' | 'tablet';
}

/** The ids of each site's pages by path, for the rows' `page_id`. */
const pageIds: Record<string, Record<string, string>> = {};

/** Write rows as the visit route and the events write them: a view has a page, an event has none. */
async function insert(rows: Row[]): Promise<void> {
  await db('platform_visits').insert(
    rows.map((row) => {
      const kind = row.kind ?? 'view';
      const path = row.path ?? '/';
      return {
        site_id: row.site.id,
        page_id: kind === 'view' ? (pageIds[row.site.id][path] ?? OLD_PAGE) : null,
        path: kind === 'view' ? path : null,
        created_at: middayOf(row.ago),
        visitor_key: `${row.site.slug}-${row.ago}-${row.key}`, // a key is one visitor's, for one site and one day
        source: row.source ?? 'direct',
        device: row.device ?? 'desktop',
        kind,
      };
    }),
  );
}

/** The daily run, as the server's timer and an operator run it. */
async function dailyRun(): Promise<{ skipped: boolean; siteDays: number; deleted: number }> {
  const { stdout } = await run('pnpm', ['--silent', 'visits:totals'], { env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL_TEST! }, timeout: 80_000 });
  return JSON.parse(stdout.trim().split('\n').at(-1)!);
}

async function namePages(api: APIRequestContext, home: string, others: Array<{ name: string; slug: string }>): Promise<Record<string, string>> {
  const pages = await draftPages(api);
  const index = pages.find((page) => page.is_index && page.error_page === null)!;
  const renamed = await api.put(`/ycode/api/pages/${index.id}`, { data: { name: home } });
  expect(renamed.ok(), await renamed.text()).toBe(true);
  const ids: Record<string, string> = { '/': index.id };
  for (const page of others) {
    const response = await api.post('/ycode/api/pages', { data: { name: page.name, slug: page.slug } });
    expect(response.ok(), await response.text()).toBe(true);
    ids[`/${page.slug}`] = (await response.json()).data.id as string;
  }
  return ids;
}

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  db = knex({ client: 'pg', connection: process.env.DATABASE_URL_TEST });
  owner = await signIn(baseURL, OWNER);
  const newSite = (name: string, slug: string) => createSite(owner, { name, slug: `${slug}-${RUN}`, languages: ['en'], default_language: 'en' });
  store = await newSite('Reports Store', 'rstore');
  landing = await newSite('Reports Landing', 'rlanding');
  draft = await newSite('Reports Draft', 'rdraft');
  created.push(store, landing, draft);

  // The Store sells; the settings route needs the stand-in branch, so the row is written as the settings route writes it.
  await db('platform_site_store').insert({ site_id: store.id, selling: true, branch_id: randomUUID() });

  // Pages with names, published: the report names a page by its path.
  expect((await openSite(owner, store.id)).status()).toBe(303);
  pageIds[store.id] = await namePages(owner, 'Home', [{ name: 'Products', slug: 'products' }, { name: 'About us', slug: 'about' }]);
  await publish(owner);
  expect((await openSite(owner, landing.id)).status()).toBe(303);
  pageIds[landing.id] = await namePages(owner, 'Landing home', [{ name: 'Contact', slug: 'contact' }]);
  await publish(owner);
  // The draft is never published.

  const s = store;
  const l = landing;
  await insert(
    [
      // 35 days ago: outside the last 30 days, inside a custom range.
      { site: s, ago: 35, key: 'e1' },
      // 20 days ago: inside the last 30 days, outside the last 7.
      { site: s, ago: 20, key: 'd1', path: '/about' },
      // 3 days ago: Anna (search, phone) reads two pages and adds to the cart; Adam (direct, desktop) reads the home page.
      { site: s, ago: 3, key: 'a1', path: '/', source: 'search', device: 'phone' },
      { site: s, ago: 3, key: 'a1', path: '/products', source: 'search', device: 'phone' },
      { site: s, ago: 3, key: 'a1', kind: 'add_to_cart', source: 'search', device: 'phone' },
      { site: s, ago: 3, key: 'a2', path: '/' },
      // 2 days ago: Bana reads three pages (one twice) and places two orders; Bassam (social, tablet) reads one page; Basil
      // reads a page that has been deleted since.
      { site: s, ago: 2, key: 'b1', path: '/', device: 'phone' },
      { site: s, ago: 2, key: 'b1', path: '/about', device: 'phone' },
      { site: s, ago: 2, key: 'b1', path: '/about', device: 'phone' },
      { site: s, ago: 2, key: 'b1', kind: 'order', device: 'phone' },
      { site: s, ago: 2, key: 'b1', kind: 'order', device: 'phone' },
      { site: s, ago: 2, key: 'b2', path: '/products', source: 'social', device: 'tablet' },
      { site: s, ago: 2, key: 'b3', path: '/old-offer', source: 'referral' },
      // Yesterday: nobody. Today: Carla (direct, desktop) writes twice; Cyrus (search, phone) adds to the cart and orders; Cara reads.
      { site: s, ago: 0, key: 'c1', path: '/' },
      { site: s, ago: 0, key: 'c1', kind: 'form' },
      { site: s, ago: 0, key: 'c1', kind: 'form' },
      { site: s, ago: 0, key: 'c2', path: '/products', source: 'search', device: 'phone' },
      { site: s, ago: 0, key: 'c2', kind: 'add_to_cart', source: 'search', device: 'phone' },
      { site: s, ago: 0, key: 'c2', kind: 'order', source: 'search', device: 'phone' },
      { site: s, ago: 0, key: 'c3', path: '/products', source: 'search', device: 'phone' },
      // The Landing, 3 days ago: one visitor reads the home page and writes.
      { site: l, ago: 3, key: 'l1', path: '/' },
      { site: l, ago: 3, key: 'l1', kind: 'form' },
    ],
  );

  // The run totals every finished day. The Store's detailed rows of those days are then deleted, so that a finished day of
  // the Store can only be read from the totals; the Landing's are kept, as the run keeps them for 90 days, so that a day
  // that is in the totals and still in the detailed rows has to be counted once.
  const totals = await dailyRun();
  expect(totals.skipped).toBe(false);
  expect(totals.siteDays).toBeGreaterThanOrEqual(5); // store: 35, 20, 3 and 2 days ago; landing: 3 days ago
  const startOfToday = new Date(`${dayOf(0)}T00:00:00+03:00`);
  // 13 rows of the Store (1 + 1 + 4 + 7).
  expect(await db('platform_visits').where({ site_id: store.id }).where('created_at', '<', startOfToday).del()).toBe(13);
  expect(await db('platform_visits').where({ site_id: landing.id }).count({ rows: '*' })).toEqual([{ rows: '2' }]);

  // The Landing's yesterday and today are written after the run: yesterday is a finished day with no totals yet.
  await insert(
    [
      { site: l, ago: 1, key: 'l2', path: '/', source: 'search', device: 'phone' },
      { site: l, ago: 1, key: 'l2', kind: 'add_to_cart', source: 'search', device: 'phone' }, // a site that does not sell can hold one
      { site: l, ago: 1, key: 'l3', path: '/contact', source: 'social', device: 'phone' },
      { site: l, ago: 1, key: 'l3', kind: 'form', source: 'social', device: 'phone' },
      { site: l, ago: 0, key: 'l4', path: '/', device: 'phone' },
    ],
  );

  const stranger = await signIn(baseURL, STRANGER);
  strangerSite = await createSite(stranger, { name: 'Elsewhere', slug: `relsewhere-${RUN}`, languages: ['en'], default_language: 'en' });
  await stranger.dispose();
});

test.afterAll(async () => {
  const ids = [...created.map((site) => site.id), strangerSite?.id].filter(Boolean);
  if (db && ids.length > 0) {
    for (const table of ['platform_visits', 'platform_visit_days', 'platform_visit_site_days']) await db(table).whereIn('site_id', ids).del();
    await db('platform_site_store').whereIn('site_id', ids).del();
  }
  for (const site of created) await owner?.delete(`/ycode/api/platform/sites/${site.id}`);
  if (strangerSite) {
    const stranger = await signIn(baseURL, STRANGER);
    await stranger.delete(`/ycode/api/platform/sites/${strangerSite.id}`);
    await stranger.dispose();
  }
  await owner?.dispose();
  await db?.destroy();
});

test('traffic, last 7 days: views, visitors per day, the series, the pages with their names, the sources and the devices', async () => {
  const report = await traffic('period=last_7_days');
  expect(report.period).toEqual({ key: 'last_7_days', from: dayOf(6), to: dayOf(0), days: 7 });
  expect(report.no_data).toBe(false);
  expect(report.views).toBe(11);
  // 8 visitor-days (2 + 3 + 0 + 3) over the period's 7 days, whether or not a day had visitors: 8 / 7 = 1.14, one decimal.
  expect(report.visitors_per_day).toBe(1.1);

  // One entry per day, today last; a day with no visit is there with zeros (yesterday). Three days come from the totals
  // (their detailed rows are gone) and today from the detailed rows.
  expect(report.series).toEqual(
    lastDays(7).map((day, i) => ({ day, views: [0, 0, 0, 3, 5, 0, 3][i], visitors: [0, 0, 0, 2, 3, 0, 3][i] })),
  );

  // The most viewed pages, by views then path; the page's name where the page still exists; the share of all views.
  expect(report.pages.total).toBe(4);
  expect(report.pages.top).toEqual([
    { path: '/', name: 'Home', views: 4, share: 36.4 },
    { path: '/products', name: 'Products', views: 4, share: 36.3 },
    { path: '/about', name: 'About us', views: 2, share: 18.2 },
    { path: '/old-offer', name: null, views: 1, share: 9.1 },
  ]);

  // All four sources, always in this order, and all three device types.
  expect(report.sources).toEqual([
    { source: 'direct', views: 5, share: 45.4 },
    { source: 'search', views: 4, share: 36.4 },
    { source: 'social', views: 1, share: 9.1 },
    { source: 'referral', views: 1, share: 9.1 },
  ]);
  expect(report.devices).toEqual([
    { device: 'phone', views: 7, share: 63.6 },
    { device: 'desktop', views: 3, share: 27.3 },
    { device: 'tablet', views: 1, share: 9.1 },
  ]);
});

test('the shares add up to 100: pages, sources and device types, over each period', async () => {
  for (const query of ['period=today', 'period=last_7_days', 'period=last_30_days', `from=${dayOf(36)}&to=${dayOf(0)}`]) {
    const report = await traffic(query);
    expect(report.views, query).toBeGreaterThan(0);
    expect(tenths(report.sources.map((row) => row.share)), `${query}: sources`).toBe(1000);
    expect(tenths(report.devices.map((row) => row.share)), `${query}: devices`).toBe(1000);
    expect(tenths(report.pages.top.map((row) => row.share)), `${query}: pages (all of them are in the list)`).toBe(1000);
    // The sources, the devices and the pages each hold every view once.
    expect(report.sources.reduce((sum, row) => sum + row.views, 0), query).toBe(report.views);
    expect(report.devices.reduce((sum, row) => sum + row.views, 0), query).toBe(report.views);
    expect(report.pages.top.reduce((sum, row) => sum + row.views, 0), query).toBe(report.views);
    expect(report.series.reduce((sum, row) => sum + row.views, 0), query).toBe(report.views);
  }
});

test('traffic, today: the detailed rows of today, one day, and nothing of the days before', async () => {
  const report = await traffic('period=today');
  expect(report.period).toEqual({ key: 'today', from: dayOf(0), to: dayOf(0), days: 1 });
  expect(report.views).toBe(3);
  expect(report.visitors_per_day).toBe(3);
  expect(report.series).toEqual([{ day: dayOf(0), views: 3, visitors: 3 }]);
  expect(report.pages.top).toEqual([
    { path: '/products', name: 'Products', views: 2, share: 66.7 },
    { path: '/', name: 'Home', views: 1, share: 33.3 },
  ]);
  expect(report.sources).toEqual([
    { source: 'direct', views: 1, share: 33.3 },
    { source: 'search', views: 2, share: 66.7 },
    { source: 'social', views: 0, share: 0 },
    { source: 'referral', views: 0, share: 0 },
  ]);
});

test('traffic, last 30 days and a custom range: the period\'s days decide, from the first to the last', async () => {
  const month = await traffic('period=last_30_days');
  expect(month.period).toEqual({ key: 'last_30_days', from: dayOf(29), to: dayOf(0), days: 30 });
  expect(month.views).toBe(12); // the 20 days ago view is in, the 35 days ago view is not
  expect(month.visitors_per_day).toBe(0.3); // 9 visitor-days over 30 days
  expect(month.series).toHaveLength(30);
  expect(month.series[0].day).toBe(dayOf(29));
  expect(month.series[9]).toEqual({ day: dayOf(20), views: 1, visitors: 1 });
  expect(month.pages.top.find((row) => row.path === '/about')).toMatchObject({ views: 3, name: 'About us' });

  const range = await traffic(`from=${dayOf(36)}&to=${dayOf(34)}`);
  expect(range.period).toEqual({ key: 'custom', from: dayOf(36), to: dayOf(34), days: 3 });
  expect(range.views).toBe(1);
  expect(range.visitors_per_day).toBe(0.3); // 1 visitor-day over 3 days
  expect(range.series).toEqual([
    { day: dayOf(36), views: 0, visitors: 0 },
    { day: dayOf(35), views: 1, visitors: 1 },
    { day: dayOf(34), views: 0, visitors: 0 },
  ]);

  const oneDay = await traffic(`from=${dayOf(3)}&to=${dayOf(3)}`);
  expect(oneDay.period.days).toBe(1);
  expect(oneDay.views).toBe(3);
  expect(oneDay.visitors_per_day).toBe(2);
});

test('a site that has no countries: the answer carries none, and none of the visitors\' own data', async () => {
  const response = await owner.get(trafficUrl(store.id, 'period=last_7_days'));
  const text = await response.text();
  expect(Object.keys(JSON.parse(text).data).sort()).toEqual(['devices', 'no_data', 'pages', 'period', 'series', 'sources', 'views', 'visitors_per_day']);
  expect(text).not.toMatch(/countr|visitor_key|revenue|busiest/i);
});

test('conversions of a selling site: visitors, cart, orders and forms, each a number and a share of visitors', async () => {
  const report = await conversions('period=last_7_days');
  expect(report.period).toEqual({ key: 'last_7_days', from: dayOf(6), to: dayOf(0), days: 7 });
  expect(report.no_data).toBe(false);
  expect(report.sells).toBe(true);
  // 8 visitors (a visitor is counted once a day); 2 added to the cart (once each however often), 3 orders (Bana placed two:
  // an order is a real order), 2 forms (Carla sent two).
  expect(report.steps).toEqual([
    { step: 'visitors', count: 8, share: 100 },
    { step: 'cart', count: 2, share: 25 },
    { step: 'orders', count: 3, share: 37.5 },
    { step: 'forms', count: 2, share: 25 },
  ]);

  const today = await conversions('period=today');
  expect(today.steps).toEqual([
    { step: 'visitors', count: 3, share: 100 },
    { step: 'cart', count: 1, share: 33.3 },
    { step: 'orders', count: 1, share: 33.3 },
    { step: 'forms', count: 2, share: 66.7 },
  ]);
});

test('conversions of a site that does not sell: no cart and no order step, and the answer says so', async () => {
  const report = await conversions('period=last_7_days', landing.id);
  expect(report.sells).toBe(false);
  // The Landing's add to cart (it can hold one) is not shown. Yesterday is a finished day the run has not totalled: it
  // is read from the detailed rows. 4 visitors (1 + 0 + 2 + 1 over the days), 2 forms (3 days ago, yesterday).
  expect(report.steps).toEqual([
    { step: 'visitors', count: 4, share: 100 },
    { step: 'forms', count: 2, share: 50 },
  ]);
  expect(report.no_data).toBe(false);
});

test('a finished day the daily run has not totalled yet is read from the detailed rows, and the days before it from the totals', async () => {
  const report = await traffic('period=last_7_days', landing.id);
  expect(report.views).toBe(4);
  expect(report.visitors_per_day).toBe(0.6); // 4 visitor-days over 7 days
  expect(report.series.map((row) => row.views)).toEqual([0, 0, 0, 1, 0, 2, 1]);
  expect(report.pages.top).toEqual([
    { path: '/', name: 'Landing home', views: 3, share: 75 },
    { path: '/contact', name: 'Contact', views: 1, share: 25 },
  ]);
  expect(report.sources.map((row) => [row.source, row.views])).toEqual([['direct', 2], ['search', 1], ['social', 1], ['referral', 0]]);
});

test('a period with no visit answers with empty numbers and no_data, not an error', async () => {
  const query = `from=${dayOf(60)}&to=${dayOf(50)}`;
  const empty = await traffic(query);
  expect(empty.no_data).toBe(true);
  expect(empty.views).toBe(0);
  expect(empty.visitors_per_day).toBe(0);
  expect(empty.series).toHaveLength(11);
  expect(empty.series.every((row) => row.views === 0 && row.visitors === 0)).toBe(true);
  expect(empty.pages).toEqual({ total: 0, top: [] });
  expect(empty.sources.map((row) => [row.views, row.share])).toEqual([[0, 0], [0, 0], [0, 0], [0, 0]]);
  expect(empty.devices.map((row) => [row.views, row.share])).toEqual([[0, 0], [0, 0], [0, 0]]);

  const none = await conversions(query);
  expect(none.no_data).toBe(true);
  expect(none.sells).toBe(true);
  expect(none.steps).toEqual([
    { step: 'visitors', count: 0, share: null },
    { step: 'cart', count: 0, share: null },
    { step: 'orders', count: 0, share: null },
    { step: 'forms', count: 0, share: null },
  ]);

  // A site that exists and has never been visited reads the same way.
  const never = await traffic('period=last_7_days', draft.id);
  expect(never.no_data).toBe(true);
  expect(never.views).toBe(0);
});

test('the summary: the organization\'s sites, views and visitors per day in total and per site, views per day for the small chart', async () => {
  const report = await summary('period=last_7_days');
  expect(report.period).toEqual({ key: 'last_7_days', from: dayOf(6), to: dayOf(0), days: 7 });
  expect(report.no_data).toBe(false);
  // Only this organization's sites, oldest first (the order of All sites).
  expect(report.sites.map((site) => site.id)).toEqual([store.id, landing.id, draft.id]);
  expect(report.sites[0]).toEqual({
    id: store.id,
    name: 'Reports Store',
    status: 'published',
    views: 11,
    visitors_per_day: 1.1,
    views_by_day: lastDays(7).map((day, i) => ({ day, views: [0, 0, 0, 3, 5, 0, 3][i] })),
  });
  expect(report.sites[1]).toEqual({
    id: landing.id,
    name: 'Reports Landing',
    status: 'published',
    views: 4,
    visitors_per_day: 0.6,
    views_by_day: lastDays(7).map((day, i) => ({ day, views: [0, 0, 0, 1, 0, 2, 1][i] })),
  });
  // 11 + 4 views; (8 + 4) visitor-days over 7 days = 1.7 a day.
  expect(report.total).toEqual({ views: 15, visitors_per_day: 1.7 });
});

test('a draft site that was never published has no numbers in the summary', async () => {
  const report = await summary('period=last_7_days');
  const site = report.sites.find((candidate) => candidate.id === draft.id)!;
  expect(site).toEqual({ id: draft.id, name: 'Reports Draft', status: 'draft', views: null, visitors_per_day: null, views_by_day: null });
  expect(report.total.views).toBe(15); // it adds nothing
});

test('the summary over today and over a custom range; an organization with no site has no data', async () => {
  const today = await summary('period=today');
  expect(today.total).toEqual({ views: 4, visitors_per_day: 4 }); // Store 3 + Landing 1, one visitor each
  expect(today.sites.map((site) => site.views)).toEqual([3, 1, null]);

  const range = await summary(`from=${dayOf(36)}&to=${dayOf(34)}`);
  expect(range.total).toEqual({ views: 1, visitors_per_day: 0.3 });
  expect(range.sites.map((site) => site.views)).toEqual([1, 0, null]);

  const quiet = await summary(`from=${dayOf(60)}&to=${dayOf(50)}`);
  expect(quiet.no_data).toBe(true);
  expect(quiet.total).toEqual({ views: 0, visitors_per_day: 0 });
  expect(quiet.sites.map((site) => site.views)).toEqual([0, 0, null]);

  // Another organization sees its own sites only: one, with no visit.
  const stranger = await signIn(baseURL, STRANGER);
  try {
    const theirs = await summary('period=last_7_days', stranger);
    expect(theirs.sites.map((site) => site.id)).toEqual([strangerSite.id]);
    expect(theirs.no_data).toBe(true);
    expect(theirs.total).toEqual({ views: 0, visitors_per_day: 0 });
  } finally {
    await stranger.dispose();
  }
  // And one with no site at all.
  const lonely = await signIn(baseURL, { ...STRANGER, sub: '6f6f6f6f-0000-4f6f-8f6f-000000000002', email: 'lonely-reports-api@example.com', org: '6f6f6f6f-6f6f-4f6f-8f6f-00000000000f' });
  try {
    const none = await summary('period=last_7_days', lonely);
    expect(none.sites).toEqual([]);
    expect(none.no_data).toBe(true);
  } finally {
    await lonely.dispose();
  }
});

test('the period is checked: one of the three, or a from and a to; real days, in order, not in the future, at most a year', async () => {
  const refused = async (url: string, why: string) => {
    const response = await owner.get(url);
    expect(response.status(), `${why}: ${url}`).toBe(400);
    expect(await response.json(), why).toMatchObject({ code: 'invalid_period' });
  };
  for (const build of [(query: string) => trafficUrl(store.id, query), (query: string) => conversionsUrl(store.id, query), summaryUrl]) {
    await refused(build(''), 'no period');
    await refused(build('period=yesterday'), 'unknown period');
    await refused(build('period=custom'), 'custom needs its days');
    await refused(build(`from=${dayOf(3)}`), 'from without to');
    await refused(build(`to=${dayOf(3)}`), 'to without from');
    await refused(build(`period=today&from=${dayOf(3)}&to=${dayOf(1)}`), 'a period and a range');
    await refused(build('from=2026-13-01&to=2026-13-02'), 'not a month');
    await refused(build('from=2026-02-30&to=2026-03-02'), 'not a day');
    await refused(build('from=11/05/2026&to=11/07/2026'), 'not an ISO date');
    await refused(build(`from=${dayOf(1)}&to=${dayOf(3)}`), 'from after to');
    await refused(build(`from=${dayOf(0)}&to=${new Date(Date.now() + 2 * DAY).toISOString().slice(0, 10)}`), 'to in the future');
    await refused(build(`from=${dayOf(366)}&to=${dayOf(0)}`), 'a range of 367 days');
  }

  // 366 days is the longest: a leap year's worth, read from the totals alone.
  const year = await traffic(`from=${dayOf(365)}&to=${dayOf(0)}`);
  expect(year.period.days).toBe(366);
  expect(year.series).toHaveLength(366);
  expect(year.views).toBe(12 + 1); // the last 30 days' 12 views and the 35 days ago one
});

test('a Viewer reads all three reports, with the same numbers as the Manager', async () => {
  const viewer = await signIn(baseURL, { ...OWNER, sub: '5e5e5e5e-0000-4e5e-8e5e-000000000002', email: 'viewer-reports-api@example.com', perms: { 'webstudio.manage_reports': ['r'] } });
  try {
    expect((await traffic('period=last_7_days', store.id, viewer)).views).toBe(11);
    expect((await conversions('period=last_7_days', store.id, viewer)).steps[0]).toEqual({ step: 'visitors', count: 8, share: 100 });
    expect((await summary('period=last_7_days', viewer)).total.views).toBe(15);
  } finally {
    await viewer.dispose();
  }
});

test('no session is 401; without manage_reports r it is 403, whatever else the user holds', async () => {
  const anonymous = await request.newContext({ baseURL });
  for (const url of [trafficUrl(store.id, 'period=today'), conversionsUrl(store.id, 'period=today'), summaryUrl('period=today')]) {
    expect((await anonymous.get(url)).status(), url).toBe(401);
  }
  await anonymous.dispose();

  const everythingButReports = {
    'webstudio.manage_sites': ['c', 'r', 'u', 'd', 'x'],
    'webstudio.manage_content': ['c', 'r', 'u', 'd', 'x', 'export', 'use_ai'],
    'webstudio.manage_forms': ['c', 'r', 'u', 'd', 'x'],
    'webstudio.manage_orders': ['c', 'r', 'u', 'd', 'x'],
  };
  const noReports = await signIn(baseURL, { ...OWNER, sub: '5e5e5e5e-0000-4e5e-8e5e-000000000003', email: 'noreports-reports-api@example.com', perms: everythingButReports });
  // The leaf with the wrong flag is no better: reports are read with r only here, and a user holding the leaf with no r is refused.
  const noRead = await signIn(baseURL, { ...OWNER, sub: '5e5e5e5e-0000-4e5e-8e5e-000000000004', email: 'noread-reports-api@example.com', perms: { 'webstudio.manage_reports': ['c', 'u', 'd'] } });
  try {
    for (const url of [trafficUrl(store.id, 'period=today'), conversionsUrl(store.id, 'period=today'), summaryUrl('period=today')]) {
      for (const user of [noReports, noRead]) {
        const response = await user.get(url);
        expect(response.status(), url).toBe(403);
        expect(await response.json()).toMatchObject({ required: 'webstudio.manage_reports.r' });
      }
    }
  } finally {
    await noReports.dispose();
    await noRead.dispose();
  }
});

test('a site of another organization, an unknown site and an id that is no id answer 404', async () => {
  const stranger = await signIn(baseURL, STRANGER);
  try {
    // The stranger holds every flag, and still reads nothing of ours; their own site reads fine.
    expect((await stranger.get(trafficUrl(store.id, 'period=last_7_days'))).status()).toBe(404);
    expect((await stranger.get(conversionsUrl(store.id, 'period=last_7_days'))).status()).toBe(404);
    expect((await traffic('period=last_7_days', strangerSite.id, stranger)).no_data).toBe(true);
    // And ours do not read theirs.
    expect((await owner.get(trafficUrl(strangerSite.id, 'period=last_7_days'))).status()).toBe(404);
    expect((await owner.get(conversionsUrl(strangerSite.id, 'period=last_7_days'))).status()).toBe(404);
  } finally {
    await stranger.dispose();
  }
  for (const id of ['7d7d7d7d-7d7d-4d7d-8d7d-7d7d7d7d7d7d', 'not-an-id']) {
    expect((await owner.get(trafficUrl(id, 'period=today'))).status(), id).toBe(404);
    expect((await owner.get(conversionsUrl(id, 'period=today'))).status(), id).toBe(404);
  }
  // The site is found before its period is read: a stranger is told 404, not 400.
  const stranger2 = await signIn(baseURL, STRANGER);
  expect((await stranger2.get(trafficUrl(store.id, ''))).status()).toBe(404);
  await stranger2.dispose();
});
