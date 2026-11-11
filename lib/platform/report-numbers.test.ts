import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ReportPeriod } from './report-period';
import {
  TOP_PAGES,
  averageOf,
  completeDays,
  conversionsOf,
  percentOf,
  sharesOf,
  siteNumbers,
  summaryOf,
  trafficOf,
  type ReportDay,
} from './report-numbers';

/**
 * The numbers of the three reports (part 3, session W9), from the days the totals and the detailed rows give:
 * shares that add up, the average over the period's days, the series with its empty days, the conversions of a
 * site that sells and of one that does not, and the summary's total and per-site numbers.
 */

const period = (from: string, to: string, days: number, key: ReportPeriod['key'] = 'custom'): ReportPeriod => ({ key, from, to, days });

const day = (date: string, numbers: { views?: number; visitors?: number; cart?: number; orders?: number; forms?: number; pages?: ReportDay['pages'] } = {}): ReportDay => ({
  day: date,
  views: (numbers.pages ?? []).reduce((sum, page) => sum + page.views, 0) || (numbers.views ?? 0),
  site: {
    visitors: numbers.visitors ?? 0,
    cartVisitors: numbers.cart ?? 0,
    orderVisitors: Math.min(numbers.orders ?? 0, 1),
    orders: numbers.orders ?? 0,
    formVisitors: Math.min(numbers.forms ?? 0, 1),
    forms: numbers.forms ?? 0,
  },
  pages: numbers.pages ?? [],
});

const page = (path: string, views: number, source: 'direct' | 'search' | 'social' | 'referral' = 'direct', device: 'phone' | 'desktop' | 'tablet' = 'desktop') => ({
  path,
  source,
  device,
  views,
  visitors: views,
});

/** The shares of a list, in tenths, so that no float sum is compared. */
const tenths = (shares: number[]) => shares.reduce((sum, share) => sum + Math.round(share * 10), 0);

test('shares are percentages with one decimal that add up to exactly 100', () => {
  // The largest remainders get the leftover tenths; a tie goes to the earlier one.
  assert.deepEqual(sharesOf([4, 4, 2, 1]), [36.4, 36.3, 18.2, 9.1]);
  assert.deepEqual(sharesOf([5, 4, 1, 1]), [45.4, 36.4, 9.1, 9.1]);
  assert.deepEqual(sharesOf([1, 1, 1]), [33.4, 33.3, 33.3]);
  assert.deepEqual(sharesOf([2, 1]), [66.7, 33.3]);
  assert.deepEqual(sharesOf([3, 1]), [75, 25]);
  assert.deepEqual(sharesOf([7]), [100]);
  assert.deepEqual(sharesOf([0, 5, 0]), [0, 100, 0]);
  // Nothing to share: no share, not a division by zero.
  assert.deepEqual(sharesOf([0, 0, 0]), [0, 0, 0]);
  assert.deepEqual(sharesOf([]), []);
});

test('shares add up for any counts, and keep the order of the counts', () => {
  let seed = 7;
  const next = (limit: number) => {
    seed = (seed * 48271) % 2147483647; // the MINSTD generator: the same counts on every run, and small enough to stay exact
    return seed % limit;
  };
  for (let round = 0; round < 500; round += 1) {
    const counts = Array.from({ length: 1 + next(9) }, () => next(5000));
    const shares = sharesOf(counts);
    if (counts.every((count) => count === 0)) {
      assert.deepEqual(shares, counts.map(() => 0));
      continue;
    }
    assert.equal(tenths(shares), 1000, `${counts.join(',')} -> ${shares.join(',')}`);
    const total = counts.reduce((sum, count) => sum + count, 0);
    counts.forEach((count, i) => {
      // Never more than a tenth away from the exact share, and zero stays zero.
      assert.ok(Math.abs(shares[i] - (count * 100) / total) < 0.1 + 1e-9, `${counts.join(',')}[${i}]`);
      if (count === 0) assert.equal(shares[i], 0);
    });
  }
});

test('a share of visitors is one decimal, never above 100, and nothing when there are no visitors', () => {
  assert.equal(percentOf(2, 8), 25);
  assert.equal(percentOf(3, 8), 37.5);
  assert.equal(percentOf(1, 3), 33.3);
  assert.equal(percentOf(2, 3), 66.7);
  assert.equal(percentOf(0, 8), 0);
  assert.equal(percentOf(8, 8), 100);
  // An order or a form can come from a visitor whose view was not counted, so a count may pass the visitors: clamped.
  assert.equal(percentOf(12, 8), 100);
  assert.equal(percentOf(3, 0), null);
  assert.equal(percentOf(0, 0), null);
});

test('the average over the period\'s days is one decimal, days with no visitor counted', () => {
  assert.equal(averageOf(8, 7), 1.1);
  assert.equal(averageOf(9, 30), 0.3);
  assert.equal(averageOf(1, 3), 0.3);
  assert.equal(averageOf(4, 7), 0.6);
  assert.equal(averageOf(650 * 7, 7), 650);
  assert.equal(averageOf(0, 7), 0);
  assert.equal(averageOf(5, 1), 5);
});

test('a period has one day for every date in it: the days nobody visited are empty, not missing', () => {
  const days = completeDays(period('2026-11-05', '2026-11-08', 4), [day('2026-11-06', { views: 3, visitors: 2 }), day('2026-11-08', { views: 1, visitors: 1 })]);
  assert.deepEqual(days.map((entry) => [entry.day, entry.views, entry.site.visitors]), [
    ['2026-11-05', 0, 0],
    ['2026-11-06', 3, 2],
    ['2026-11-07', 0, 0],
    ['2026-11-08', 1, 1],
  ]);
  assert.deepEqual(days[0].pages, []);
  // A day outside the period is a fault in the reading, not data to drop.
  assert.throws(() => completeDays(period('2026-11-05', '2026-11-06', 2), [day('2026-11-09', { views: 1 })]), /2026-11-09/);
});

test('traffic: views, the average, the series, the pages by views then path, the sources and the devices', () => {
  const days = completeDays(period('2026-11-05', '2026-11-08', 4), [
    day('2026-11-06', { visitors: 2, pages: [page('/', 2, 'search', 'phone'), page('/about', 1, 'direct', 'desktop')] }),
    day('2026-11-07', { visitors: 3, pages: [page('/', 1, 'search', 'phone'), page('/products', 3, 'social', 'tablet')] }),
  ]);
  const names = (path: string) => ({ '/': 'Home', '/products': 'Products' })[path] ?? null;
  const report = trafficOf(days, names);

  assert.equal(report.no_data, false);
  assert.equal(report.views, 7);
  assert.equal(report.visitors_per_day, 1.3); // 5 visitor-days over 4 days
  assert.deepEqual(report.series, [
    { day: '2026-11-05', views: 0, visitors: 0 },
    { day: '2026-11-06', views: 3, visitors: 2 },
    { day: '2026-11-07', views: 4, visitors: 3 },
    { day: '2026-11-08', views: 0, visitors: 0 },
  ]);
  // '/' has 3 views, '/products' 3, '/about' 1: the tie is broken by path; a page with no name has none.
  assert.deepEqual(report.pages, {
    total: 3,
    top: [
      { path: '/', name: 'Home', views: 3, share: 42.9 },
      { path: '/products', name: 'Products', views: 3, share: 42.8 },
      { path: '/about', name: null, views: 1, share: 14.3 },
    ],
  });
  assert.deepEqual(report.sources, [
    { source: 'direct', views: 1, share: 14.3 },
    { source: 'search', views: 3, share: 42.9 },
    { source: 'social', views: 3, share: 42.8 },
    { source: 'referral', views: 0, share: 0 },
  ]);
  assert.deepEqual(report.devices, [
    { device: 'phone', views: 3, share: 42.9 },
    { device: 'desktop', views: 1, share: 14.3 },
    { device: 'tablet', views: 3, share: 42.8 },
  ]);
});

test('traffic: the list is the most viewed pages, the total is all of them, and the shares are of all views', () => {
  assert.equal(TOP_PAGES, 6);
  const pages = Array.from({ length: 9 }, (_, i) => page(`/page-${i + 1}`, 10 - i)); // 10, 9, ..., 2 views: 54 in all
  const report = trafficOf(completeDays(period('2026-11-05', '2026-11-05', 1), [day('2026-11-05', { visitors: 5, pages })]), () => null);
  assert.equal(report.pages.total, 9);
  assert.equal(report.pages.top.length, 6);
  assert.deepEqual(report.pages.top.map((row) => row.path), ['/page-1', '/page-2', '/page-3', '/page-4', '/page-5', '/page-6']);
  // 10 of 54 views is 18.5 %: the shares are of the whole, so the six do not add up to 100.
  assert.equal(report.pages.top[0].share, 18.5);
  assert.ok(tenths(report.pages.top.map((row) => row.share)) < 1000);
  assert.equal(report.views, 54);
});

test('traffic: a period with no view is empty numbers and no_data', () => {
  const report = trafficOf(completeDays(period('2026-11-05', '2026-11-07', 3), []), () => null);
  assert.equal(report.no_data, true);
  assert.equal(report.views, 0);
  assert.equal(report.visitors_per_day, 0);
  assert.equal(report.series.length, 3);
  assert.deepEqual(report.pages, { total: 0, top: [] });
  assert.deepEqual(report.sources.map((row) => [row.views, row.share]), [[0, 0], [0, 0], [0, 0], [0, 0]]);
  assert.deepEqual(report.devices.map((row) => [row.views, row.share]), [[0, 0], [0, 0], [0, 0]]);
});

test('conversions of a site that sells: four steps, a number and a share of visitors each, in the order of the funnel', () => {
  const days = completeDays(period('2026-11-05', '2026-11-06', 2), [day('2026-11-05', { visitors: 5, cart: 2, orders: 2, forms: 1 }), day('2026-11-06', { visitors: 3, cart: 0, orders: 1, forms: 2 })]);
  assert.deepEqual(conversionsOf(days, true), {
    no_data: false,
    sells: true,
    steps: [
      { step: 'visitors', count: 8, share: 100 },
      { step: 'cart', count: 2, share: 25 },
      { step: 'orders', count: 3, share: 37.5 },
      { step: 'forms', count: 3, share: 37.5 },
    ],
  });
});

test('conversions of a site that does not sell: no cart and no order step, even if it holds some, and the answer says so', () => {
  const days = completeDays(period('2026-11-05', '2026-11-05', 1), [day('2026-11-05', { visitors: 4, cart: 1, orders: 0, forms: 2 })]);
  assert.deepEqual(conversionsOf(days, false), {
    no_data: false,
    sells: false,
    steps: [
      { step: 'visitors', count: 4, share: 100 },
      { step: 'forms', count: 2, share: 50 },
    ],
  });
  // What it holds that is not shown does not make a period with no shown number "data".
  const onlyCart = completeDays(period('2026-11-05', '2026-11-05', 1), [day('2026-11-05', { cart: 3 })]);
  assert.equal(conversionsOf(onlyCart, false).no_data, true);
  assert.equal(conversionsOf(onlyCart, true).no_data, false);
});

test('conversions: no visitors is no_data with no share, and a count over the visitors is clamped to 100', () => {
  const none = conversionsOf(completeDays(period('2026-11-05', '2026-11-06', 2), []), true);
  assert.equal(none.no_data, true);
  assert.deepEqual(none.steps, [
    { step: 'visitors', count: 0, share: null },
    { step: 'cart', count: 0, share: null },
    { step: 'orders', count: 0, share: null },
    { step: 'forms', count: 0, share: null },
  ]);
  // An order whose visitor's view was never counted: the order is real, there is no visitor to share it with.
  const orphan = conversionsOf(completeDays(period('2026-11-05', '2026-11-05', 1), [day('2026-11-05', { visitors: 0, orders: 1 })]), true);
  assert.equal(orphan.no_data, false);
  assert.deepEqual(orphan.steps[2], { step: 'orders', count: 1, share: null });
  const crowded = conversionsOf(completeDays(period('2026-11-05', '2026-11-05', 1), [day('2026-11-05', { visitors: 1, orders: 4 })]), true);
  assert.deepEqual(crowded.steps[2], { step: 'orders', count: 4, share: 100 });
});

test('the numbers of one site for the summary: views, the average visitors and the views of each day', () => {
  const days = completeDays(period('2026-11-05', '2026-11-08', 4), [day('2026-11-06', { views: 3, visitors: 2 }), day('2026-11-08', { views: 5, visitors: 3 })]);
  assert.deepEqual(siteNumbers(days), {
    views: 8,
    visitorDays: 5,
    visitorsPerDay: 1.3,
    viewsByDay: [
      { day: '2026-11-05', views: 0 },
      { day: '2026-11-06', views: 3 },
      { day: '2026-11-07', views: 0 },
      { day: '2026-11-08', views: 5 },
    ],
  });
});

test('the summary: the total of the sites that have numbers, a draft with none, no_data when nothing was seen', () => {
  const p = period('2026-11-05', '2026-11-11', 7, 'last_7_days');
  const store = completeDays(p, [day('2026-11-08', { views: 11, visitors: 8 })]);
  const landing = completeDays(p, [day('2026-11-09', { views: 4, visitors: 4 })]);
  const report = summaryOf(p, [
    { id: 's1', name: 'Store', status: 'published', days: store },
    { id: 's2', name: 'Landing', status: 'published', days: landing },
    { id: 's3', name: 'Draft', status: 'draft', days: null },
  ]);
  assert.equal(report.no_data, false);
  assert.deepEqual(report.total, { views: 15, visitors_per_day: 1.7 }); // 12 visitor-days over 7 days
  assert.deepEqual(report.sites.map((site) => [site.id, site.status, site.views, site.visitors_per_day]), [
    ['s1', 'published', 11, 1.1],
    ['s2', 'published', 4, 0.6],
    ['s3', 'draft', null, null],
  ]);
  assert.equal(report.sites[0].views_by_day?.length, 7);
  assert.equal(report.sites[2].views_by_day, null);
  assert.deepEqual(Object.keys(report.sites[0]).sort(), ['id', 'name', 'status', 'views', 'views_by_day', 'visitors_per_day']);

  const quiet = summaryOf(p, [{ id: 's1', name: 'Store', status: 'published', days: completeDays(p, []) }, { id: 's3', name: 'Draft', status: 'draft', days: null }]);
  assert.equal(quiet.no_data, true);
  assert.deepEqual(quiet.total, { views: 0, visitors_per_day: 0 });
  assert.equal(quiet.sites[0].views, 0);
  assert.equal(summaryOf(p, []).no_data, true);
});
