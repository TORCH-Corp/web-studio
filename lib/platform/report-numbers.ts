/**
 * The numbers of the three reports (part 3, session W9; PRD V1.0 "Traffic report", "Conversions report",
 * "Dashboard"): what the days of a period become.
 *
 * Pure: the days go in (`ReportDay`, one per date of the period: lib/platform/reports.ts reads them from the
 * totals and the detailed rows), the answers come out. Which number each field holds is the daily totals'
 * (lib/platform/visit-totals.ts): a visitor is someone whose view was counted, once a day; an add to cart counts its
 * visitor once; an order and a form submission count themselves, so a visitor who orders twice is two orders.
 *
 * - **Visitors per day** is the visitors of every day of the period added up and divided by the number of days,
 *   the days nobody visited included, to one decimal. The same person on two days is two visitors (PRD: a visitor is
 *   recognised within one day only), so there is no "visitors in the period" to give.
 * - **Shares** of a list that is a whole (the sources, the device types, the pages) are percentages with one decimal
 *   that add up to exactly 100.0: each share is rounded down to a tenth, and the tenths left over go to the largest
 *   remainders, the earlier one on a tie. A share of visitors (Conversions) stands alone and is rounded to a tenth,
 *   never above 100, and null when there are no visitors to share.
 * - **No data** is a period with nothing to show: no views for Traffic, no step with a count for Conversions, no
 *   view and no visitor in any site for the summary. The numbers are then zeros and empty lists, not an error.
 *
 * No country, no busiest day and no revenue: out of part 3 (plan decisions, handoff decision 3, PRD Out-of-Scope).
 *
 * Kept free of Next and database imports so it runs under `node --test`.
 */

import type { VisitDevice, VisitSource } from '@/lib/platform/visit-rules';
import type { PageTotal, SiteTotal } from '@/lib/platform/visit-totals';
import { daysOfPeriod, type ReportPeriod } from '@/lib/platform/report-period';

/** The pages the Traffic report lists: "Top 6 of 38" (handoff `traffic-en-light.html`). */
export const TOP_PAGES = 6;

/** The four sources in the order the report shows them, whatever their views. `referral` is "another site". */
export const SOURCES: readonly VisitSource[] = ['direct', 'search', 'social', 'referral'];

/** The three device types in the order the report shows them. */
export const DEVICES: readonly VisitDevice[] = ['phone', 'desktop', 'tablet'];

/** One day of one site: its numbers as the totals or the detailed rows give them. */
export interface ReportDay {
  day: string;
  /** Every counted view of the day. */
  views: number;
  site: SiteTotal;
  /** The day's views by page, source and device. Empty when only the day's numbers were read (the summary). */
  pages: PageTotal[];
}

const emptyDay = (day: string): ReportDay => ({
  day,
  views: 0,
  site: { visitors: 0, cartVisitors: 0, orderVisitors: 0, orders: 0, formVisitors: 0, forms: 0 },
  pages: [],
});

/**
 * One entry for every date of the period, oldest first: a day nobody visited is there with zeros, so a chart has its
 * whole axis. A day outside the period is a fault in the reading and throws.
 */
export function completeDays(period: ReportPeriod, known: readonly ReportDay[]): ReportDay[] {
  const byDay = new Map(known.map((entry) => [entry.day, entry]));
  const days = daysOfPeriod(period);
  const inPeriod = new Set(days);
  for (const entry of known) {
    if (!inPeriod.has(entry.day)) throw new Error(`The day ${entry.day} is outside the period ${period.from} to ${period.to}`);
  }
  return days.map((day) => byDay.get(day) ?? emptyDay(day));
}

/**
 * The shares of a list of counts, as percentages with one decimal that add up to exactly 100.0 (largest remainder in
 * tenths). All zeros share nothing: they are all zero.
 */
export function sharesOf(counts: readonly number[]): number[] {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total === 0) return counts.map(() => 0);
  // Integer arithmetic throughout: a count's tenths of a percent are `count * 1000 / total`, whole part and remainder.
  const parts = counts.map((count, index) => ({ index, tenths: Math.floor((count * 1000) / total), remainder: (count * 1000) % total }));
  let left = 1000 - parts.reduce((sum, part) => sum + part.tenths, 0);
  for (const part of [...parts].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
    if (left === 0) break;
    part.tenths += 1;
    left -= 1;
  }
  return parts.map((part) => part.tenths / 10);
}

/** A count as a share of the visitors: one decimal, at most 100, null when there are no visitors. */
export function percentOf(count: number, visitors: number): number | null {
  if (visitors <= 0) return null;
  return Math.min(100, Math.round((count * 1000) / visitors) / 10);
}

/** The visitor-days over the days of the period, to one decimal. */
export function averageOf(visitorDays: number, days: number): number {
  return Math.round((visitorDays * 10) / days) / 10;
}

const sum = <T>(items: readonly T[], pick: (item: T) => number): number => items.reduce((total, item) => total + pick(item), 0);

/** The Traffic report. */
export interface TrafficReport {
  no_data: boolean;
  views: number;
  visitors_per_day: number;
  series: Array<{ day: string; views: number; visitors: number }>;
  pages: { total: number; top: Array<{ path: string; name: string | null; views: number; share: number }> };
  sources: Array<{ source: VisitSource; views: number; share: number }>;
  devices: Array<{ device: VisitDevice; views: number; share: number }>;
}

/**
 * The Traffic report of a site's days (one per date of the period). `nameOf` gives a page's name from its path
 * (lib/platform/report-pages.ts). The pages are the most viewed, by views and then by path, each with its share of all
 * the views; `total` is the number of pages that were viewed at all.
 */
export function trafficOf(days: readonly ReportDay[], nameOf: (path: string) => string | null): TrafficReport {
  const views = sum(days, (entry) => entry.views);
  const byPath = new Map<string, number>();
  const bySource = new Map<VisitSource, number>();
  const byDevice = new Map<VisitDevice, number>();
  for (const entry of days) {
    for (const row of entry.pages) {
      byPath.set(row.path, (byPath.get(row.path) ?? 0) + row.views);
      bySource.set(row.source, (bySource.get(row.source) ?? 0) + row.views);
      byDevice.set(row.device, (byDevice.get(row.device) ?? 0) + row.views);
    }
  }

  const pages = [...byPath].filter(([, count]) => count > 0).sort(([pathA, a], [pathB, b]) => b - a || (pathA < pathB ? -1 : pathA > pathB ? 1 : 0));
  const pageShares = sharesOf(pages.map(([, count]) => count));
  const sourceViews = SOURCES.map((source) => bySource.get(source) ?? 0);
  const sourceShares = sharesOf(sourceViews);
  const deviceViews = DEVICES.map((device) => byDevice.get(device) ?? 0);
  const deviceShares = sharesOf(deviceViews);

  return {
    no_data: views === 0,
    views,
    visitors_per_day: averageOf(sum(days, (entry) => entry.site.visitors), days.length),
    series: days.map((entry) => ({ day: entry.day, views: entry.views, visitors: entry.site.visitors })),
    pages: {
      total: pages.length,
      top: pages.slice(0, TOP_PAGES).map(([path, count], i) => ({ path, name: nameOf(path), views: count, share: pageShares[i] })),
    },
    sources: SOURCES.map((source, i) => ({ source, views: sourceViews[i], share: sourceShares[i] })),
    devices: DEVICES.map((device, i) => ({ device, views: deviceViews[i], share: deviceShares[i] })),
  };
}

export type ConversionStep = 'visitors' | 'cart' | 'orders' | 'forms';

/** The Conversions report: the steps of the funnel in order; a site that does not sell has no `cart` and no `orders`. */
export interface ConversionsReport {
  no_data: boolean;
  sells: boolean;
  steps: Array<{ step: ConversionStep; count: number; share: number | null }>;
}

/**
 * The Conversions report of a site's days. The steps: visitors; visitors who added to the cart (each once a day);
 * orders placed; form submissions (every form on the site); each with its share of the visitors. A site that does
 * not sell is left with visitors and forms, whatever it holds of the other two.
 */
export function conversionsOf(days: readonly ReportDay[], sells: boolean): ConversionsReport {
  const visitors = sum(days, (entry) => entry.site.visitors);
  const counts: Record<ConversionStep, number> = {
    visitors,
    cart: sum(days, (entry) => entry.site.cartVisitors),
    orders: sum(days, (entry) => entry.site.orders),
    forms: sum(days, (entry) => entry.site.forms),
  };
  const shown: ConversionStep[] = sells ? ['visitors', 'cart', 'orders', 'forms'] : ['visitors', 'forms'];
  const steps = shown.map((step) => ({ step, count: counts[step], share: percentOf(counts[step], visitors) }));
  return { no_data: steps.every((entry) => entry.count === 0), sells, steps };
}

/** What the summary and the Dashboard's small chart need of one site. */
export interface SiteNumbers {
  views: number;
  /** The visitors of every day added up, for the total over several sites. */
  visitorDays: number;
  visitorsPerDay: number;
  viewsByDay: Array<{ day: string; views: number }>;
}

export function siteNumbers(days: readonly ReportDay[]): SiteNumbers {
  const visitorDays = sum(days, (entry) => entry.site.visitors);
  return {
    views: sum(days, (entry) => entry.views),
    visitorDays,
    visitorsPerDay: averageOf(visitorDays, days.length),
    viewsByDay: days.map((entry) => ({ day: entry.day, views: entry.views })),
  };
}

/** A site's line of the summary. A site that was never published has no numbers: `null`, not zero. */
export interface SummarySite {
  id: string;
  name: string;
  status: 'draft' | 'published';
  views: number | null;
  visitors_per_day: number | null;
  views_by_day: Array<{ day: string; views: number }> | null;
}

export interface SummaryReport {
  no_data: boolean;
  total: { views: number; visitors_per_day: number };
  sites: SummarySite[];
}

export interface SummaryInput {
  id: string;
  name: string;
  status: 'draft' | 'published';
  /** The site's days; null for a site that was never published. */
  days: readonly ReportDay[] | null;
}

/**
 * The organization's visit summary, in the order of its sites. The total is the sum over the sites that have numbers:
 * views, and the visitors of all of them per day.
 */
export function summaryOf(period: ReportPeriod, sites: readonly SummaryInput[]): SummaryReport {
  const lines = sites.map((site) => ({ site, numbers: site.days ? siteNumbers(site.days) : null }));
  const views = sum(lines, (line) => line.numbers?.views ?? 0);
  const visitorDays = sum(lines, (line) => line.numbers?.visitorDays ?? 0);
  return {
    no_data: views === 0 && visitorDays === 0,
    total: { views, visitors_per_day: averageOf(visitorDays, period.days) },
    sites: lines.map(({ site, numbers }) => ({
      id: site.id,
      name: site.name,
      status: site.status,
      views: numbers?.views ?? null,
      visitors_per_day: numbers?.visitorsPerDay ?? null,
      views_by_day: numbers?.viewsByDay ?? null,
    })),
  };
}
