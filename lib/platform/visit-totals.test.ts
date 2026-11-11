import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RETENTION_DAYS, totalsOfDay, type TotalsRow } from './visit-totals';

/**
 * The daily totals (part 3, session W8; PRD V1.0 "Visit counting",
 * "Conversions report"): what one site's rows of one day become.
 *
 * Three days of one site, written the way the routes write them: a visitor's
 * key is the same on all his rows of a day and another the next day, a view has
 * a page, an event has none.
 */

const view = (visitorKey: string, path: string, source: TotalsRow['source'] = 'direct', device: TotalsRow['device'] = 'desktop'): TotalsRow => ({
  visitorKey,
  kind: 'view',
  path,
  source,
  device,
});
const event = (visitorKey: string, kind: string, source: TotalsRow['source'] = 'direct', device: TotalsRow['device'] = 'desktop'): TotalsRow => ({
  visitorKey,
  kind,
  path: null,
  source,
  device,
});

/** Monday: Sara (search, phone) reads two pages, adds to the cart twice and orders; Omar (direct, desktop) reads one page and writes twice. */
const DAY_ONE: TotalsRow[] = [
  view('sara-1', '/', 'search', 'phone'),
  view('sara-1', '/about', 'search', 'phone'),
  event('sara-1', 'add_to_cart', 'search', 'phone'),
  event('sara-1', 'add_to_cart', 'search', 'phone'),
  event('sara-1', 'order', 'search', 'phone'),
  view('omar-1', '/'),
  event('omar-1', 'form'),
  event('omar-1', 'form'),
];

/** Tuesday: Omar reads the home page three times; Lina reads it once; Hadi only orders, twice (his view was never counted). */
const DAY_TWO: TotalsRow[] = [
  view('omar-2', '/'),
  view('omar-2', '/'),
  view('omar-2', '/'),
  view('lina-2', '/', 'social', 'tablet'),
  event('hadi-2', 'order'),
  event('hadi-2', 'order'),
];

/** Wednesday: two readers, two cart visitors (one of them never viewed), a kind the totals do not know. */
const DAY_THREE: TotalsRow[] = [
  view('sara-3', '/shop', 'referral', 'phone'),
  view('sara-3', '/', 'referral', 'phone'),
  view('omar-3', '/shop'),
  event('sara-3', 'add_to_cart', 'referral', 'phone'),
  event('rana-3', 'add_to_cart'),
  event('omar-3', 'wishlist'),
];

const ZERO = { visitors: 0, cartVisitors: 0, orderVisitors: 0, orders: 0, formVisitors: 0, forms: 0 };

test('Monday: a visitor counts once per kind, however many times he adds to the cart; orders and forms also keep their number', () => {
  const day = totalsOfDay(DAY_ONE);
  assert.deepEqual(day.site, { visitors: 2, cartVisitors: 1, orderVisitors: 1, orders: 1, formVisitors: 1, forms: 2 });
  // The page rows: a view is a view of a page, from one source on one device.
  assert.deepEqual(day.pages, [
    { path: '/', source: 'direct', device: 'desktop', views: 1, visitors: 1 },
    { path: '/', source: 'search', device: 'phone', views: 1, visitors: 1 },
    { path: '/about', source: 'search', device: 'phone', views: 1, visitors: 1 },
  ]);
});

test('Tuesday: views are every view, visitors each visitor once; an order with no view is an order and not a visitor', () => {
  const day = totalsOfDay(DAY_TWO);
  assert.deepEqual(day.site, { visitors: 2, cartVisitors: 0, orderVisitors: 1, orders: 2, formVisitors: 0, forms: 0 });
  assert.deepEqual(day.pages, [
    { path: '/', source: 'direct', device: 'desktop', views: 3, visitors: 1 },
    { path: '/', source: 'social', device: 'tablet', views: 1, visitors: 1 },
  ]);
});

test('Wednesday: a visitor of two pages is one visitor of the day and one of each page; a kind the totals do not know is not counted', () => {
  const day = totalsOfDay(DAY_THREE);
  // Sara read two pages: two page rows of one visitor each, one visitor of the site. Rana added to the cart without a counted view.
  assert.deepEqual(day.site, { ...ZERO, visitors: 2, cartVisitors: 2 });
  assert.deepEqual(day.pages, [
    { path: '/', source: 'referral', device: 'phone', views: 1, visitors: 1 },
    { path: '/shop', source: 'direct', device: 'desktop', views: 1, visitors: 1 },
    { path: '/shop', source: 'referral', device: 'phone', views: 1, visitors: 1 },
  ]);
});

test('the same rows in any order give the same totals', () => {
  for (const rows of [DAY_ONE, DAY_TWO, DAY_THREE]) {
    assert.deepEqual(totalsOfDay([...rows].reverse()), totalsOfDay(rows));
  }
});

test('a visitor who read the same page from two sources in a day is a visitor of each row', () => {
  const day = totalsOfDay([view('sara-1', '/', 'search', 'phone'), view('sara-1', '/', 'direct', 'phone')]);
  assert.deepEqual(day.pages, [
    { path: '/', source: 'direct', device: 'phone', views: 1, visitors: 1 },
    { path: '/', source: 'search', device: 'phone', views: 1, visitors: 1 },
  ]);
  // One person, so one visitor of the day.
  assert.equal(day.site.visitors, 1);
});

test('a day with no row has no page and no number', () => {
  assert.deepEqual(totalsOfDay([]), { pages: [], site: ZERO });
});

test('a view with no page is a fault in the table, not a view', () => {
  assert.throws(() => totalsOfDay([{ visitorKey: 'sara-1', kind: 'view', path: null, source: 'direct', device: 'phone' }]), /no path/);
});

test('the three days together hold what each held', () => {
  const all = [DAY_ONE, DAY_TWO, DAY_THREE].map(totalsOfDay);
  const sum = (key: keyof typeof ZERO) => all.reduce((total, day) => total + day.site[key], 0);
  // A visitor of three days is three visitors: the same person on another day counts as a new visitor (PRD).
  assert.deepEqual(
    { visitors: sum('visitors'), cart: sum('cartVisitors'), orders: sum('orders'), forms: sum('forms') },
    { visitors: 6, cart: 3, orders: 3, forms: 2 },
  );
  // Views: 3 on Monday (Sara two, Omar one), 4 on Tuesday (Omar three, Lina one), 3 on Wednesday (Sara two, Omar one).
  assert.equal(all.reduce((total, day) => total + day.pages.reduce((views, page) => views + page.views, 0), 0), 10);
});

test('detailed rows are kept 90 days', () => {
  assert.equal(RETENTION_DAYS, 90);
});
