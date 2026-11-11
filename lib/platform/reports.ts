/**
 * The Reports API's reads (part 3, session W9; PRD V1.0 "Traffic report", "Conversions report", "Dashboard").
 *
 * Where a day's numbers come from. The daily run (lib/platform/visit-totals-run.ts) turns a finished day into rows of
 * `platform_visit_site_days` and `platform_visit_days`, an hour after the day ends, and deletes detailed rows after
 * 90 days. So for a site:
 *
 * - the days up to the site's **latest totalled day** are read from the totals: a period of a year needs no detail,
 *   which is gone after 90 days;
 * - the days after it are read from `platform_visits` and made into numbers with `totalsOfDay`, the function the
 *   run itself uses. That is today, which is never in the totals, and any finished day the run has not reached yet:
 *   the hour after midnight, or a run that failed. A day is never read from both, so nothing is counted twice, and
 *   a day nobody visited is empty either way.
 *
 * The days are the platform's (`visitDay`): the same a visitor's key, the totals and the run use. A site's rows are
 * found by its id; the visit tables are not tenant tables (database/migrations/20261111000001_torch_visits.ts), so
 * the caller has checked that the site is the session's organization's. The page names come from the site's own
 * pages (the draft rows, as `lib/platform/collections.ts` reads them).
 *
 * The numbers themselves, and which field holds what, are lib/platform/report-numbers.ts's.
 */

import type { Knex } from 'knex';
import { getKnexClient } from '@/lib/knex-client';
import { completeDays, conversionsOf, summaryOf, trafficOf, type ConversionsReport, type ReportDay, type SummaryReport, type TrafficReport } from '@/lib/platform/report-numbers';
import { pageNamer, type FolderRecord, type PageNamer, type PageRecord } from '@/lib/platform/report-pages';
import { addDays, type ReportPeriod } from '@/lib/platform/report-period';
import { listSites, type Site } from '@/lib/platform/site';
import { storeOf } from '@/lib/platform/store-settings';
import { VISIT_TIME_ZONE, visitDay, type VisitDevice, type VisitSource } from '@/lib/platform/visit-rules';
import { totalsOfDay, type PageTotal, type TotalsRow } from '@/lib/platform/visit-totals';

/** The platform's current day: what "today" means to a report. */
export const today = (now: Date = new Date()): string => visitDay(now);

/** A `date` column as `YYYY-MM-DD`, read by the database: a JS Date at local midnight would move a day in some time zones. */
const DAY_TEXT = "to_char(day, 'YYYY-MM-DD')";

interface SiteDayRow {
  day: string;
  visitors: number;
  cart_visitors: number;
  order_visitors: number;
  orders: number;
  form_visitors: number;
  forms: number;
}

interface PageDayRow {
  day: string;
  path: string;
  source: VisitSource;
  device: VisitDevice;
  views: number;
  visitors: number;
}

interface VisitRow {
  visitor_key: string;
  kind: string;
  path: string | null;
  source: VisitSource;
  device: VisitDevice;
  /** An ISO string: the app's knex client (knexfile.ts) parses timestamptz that way, not into a Date. */
  created_at: Date | string;
}

/** The latest finished day of the site that has its totals, or null when the daily run has totalled none yet. */
async function latestTotalledDay(knex: Knex, siteId: string): Promise<string | null> {
  const result = await knex.raw(`SELECT to_char(MAX(day), 'YYYY-MM-DD') AS day FROM platform_visit_site_days WHERE site_id = ?::uuid`, [siteId]);
  return (result as { rows: Array<{ day: string | null }> }).rows[0].day;
}

/** The days of `from` to `to` as the daily run stored them. With `pages`, the page rows too; without, only the day's views. */
async function totalledDays(knex: Knex, siteId: string, from: string, to: string, pages: boolean): Promise<ReportDay[]> {
  const siteRows = (
    (await knex.raw(
      `SELECT ${DAY_TEXT} AS day, visitors, cart_visitors, order_visitors, orders, form_visitors, forms
       FROM platform_visit_site_days
       WHERE site_id = ?::uuid AND day BETWEEN ?::date AND ?::date`,
      [siteId, from, to],
    )) as { rows: SiteDayRow[] }
  ).rows;

  const pageRows: PageDayRow[] = pages
    ? ((await knex.raw(
      `SELECT ${DAY_TEXT} AS day, path, source, device, views, visitors
       FROM platform_visit_days
       WHERE site_id = ?::uuid AND day BETWEEN ?::date AND ?::date`,
      [siteId, from, to],
    )) as { rows: PageDayRow[] }).rows
    : [];
  const viewsOfDay = new Map<string, number>();
  if (!pages) {
    const sums = (
      (await knex.raw(
        `SELECT ${DAY_TEXT} AS day, SUM(views)::int AS views
         FROM platform_visit_days
         WHERE site_id = ?::uuid AND day BETWEEN ?::date AND ?::date
         GROUP BY day`,
        [siteId, from, to],
      )) as { rows: Array<{ day: string; views: number }> }
    ).rows;
    for (const row of sums) viewsOfDay.set(row.day, row.views);
  }

  const byDay = new Map<string, ReportDay>();
  for (const row of siteRows) {
    byDay.set(row.day, {
      day: row.day,
      views: viewsOfDay.get(row.day) ?? 0,
      site: {
        visitors: row.visitors,
        cartVisitors: row.cart_visitors,
        orderVisitors: row.order_visitors,
        orders: row.orders,
        formVisitors: row.form_visitors,
        forms: row.forms,
      },
      pages: [],
    });
  }
  for (const row of pageRows) {
    const entry = byDay.get(row.day);
    if (!entry) throw new Error(`The totals of ${siteId} for ${row.day} have page rows and no site row`);
    const total: PageTotal = { path: row.path, source: row.source, device: row.device, views: row.views, visitors: row.visitors };
    entry.pages.push(total);
    entry.views += row.views;
  }
  for (const day of viewsOfDay.keys()) {
    if (!byDay.has(day)) throw new Error(`The totals of ${siteId} for ${day} have page rows and no site row`);
  }
  return [...byDay.values()];
}

/** The detailed rows of `from` to `to` (both counted), made into the numbers of each day that has any. */
async function detailedDays(knex: Knex, siteId: string, from: string, to: string): Promise<ReportDay[]> {
  const rows = (
    (await knex.raw(
      `SELECT visitor_key, kind, path, source, device, created_at
       FROM platform_visits
       WHERE site_id = ?::uuid
         AND created_at >= (?::date::timestamp AT TIME ZONE ?)
         AND created_at < ((?::date + 1)::timestamp AT TIME ZONE ?)`,
      [siteId, from, VISIT_TIME_ZONE, to, VISIT_TIME_ZONE],
    )) as { rows: VisitRow[] }
  ).rows;

  const byDay = new Map<string, TotalsRow[]>();
  for (const row of rows) {
    const day = visitDay(new Date(row.created_at));
    const list = byDay.get(day) ?? [];
    list.push({ visitorKey: row.visitor_key, kind: row.kind, path: row.path, source: row.source, device: row.device });
    byDay.set(day, list);
  }
  return [...byDay].map(([day, dayRows]) => {
    const { pages, site } = totalsOfDay(dayRows);
    return { day, views: pages.reduce((sum, page) => sum + page.views, 0), site, pages };
  });
}

/**
 * One entry for every day of the period for one site, each from the totals or from the detailed rows as the top of
 * this file says. `pages` asks for the day's views by page, source and device (Traffic); without it only the day's
 * numbers are read (Conversions and the summary).
 */
export async function loadSiteDays(siteId: string, period: ReportPeriod, pages: boolean): Promise<ReportDay[]> {
  const knex = await getKnexClient();
  const latest = await latestTotalledDay(knex, siteId);
  const known: ReportDay[] = [];
  if (latest !== null && period.from <= latest) {
    known.push(...(await totalledDays(knex, siteId, period.from, latest < period.to ? latest : period.to, pages)));
  }
  const detailFrom = latest !== null && latest >= period.from ? addDays(latest, 1) : period.from;
  if (detailFrom <= period.to) known.push(...(await detailedDays(knex, siteId, detailFrom, period.to)));
  return completeDays(period, known);
}

/** The namer of a site's pages: the draft pages and folders that are not deleted, and the site's language codes. */
async function namerOfSite(knex: Knex, siteId: string): Promise<PageNamer> {
  const [pages, folders, locales] = await Promise.all([
    knex('pages')
      .where({ tenant_id: siteId, is_published: false })
      .whereNull('deleted_at')
      .whereNull('error_page')
      .select('id', 'name', 'slug', 'is_index', 'is_dynamic', 'page_folder_id') as Promise<PageRecord[]>,
    knex('page_folders').where({ tenant_id: siteId, is_published: false }).whereNull('deleted_at').select('id', 'slug', 'page_folder_id') as Promise<FolderRecord[]>,
    knex('locales').where({ tenant_id: siteId, is_published: false }).whereNull('deleted_at').select('code') as Promise<Array<{ code: string }>>,
  ]);
  return pageNamer(pages, folders, locales.map((locale) => locale.code));
}

/** The Traffic report of a site of the session's organization. */
export async function trafficReport(site: Site, period: ReportPeriod): Promise<{ period: ReportPeriod } & TrafficReport> {
  const knex = await getKnexClient();
  const [days, nameOf] = await Promise.all([loadSiteDays(site.id, period, true), namerOfSite(knex, site.id)]);
  return { period, ...trafficOf(days, nameOf) };
}

/** The Conversions report of a site of the session's organization. Whether it sells is its store's `selling`. */
export async function conversionsReport(site: Site, period: ReportPeriod): Promise<{ period: ReportPeriod } & ConversionsReport> {
  const [days, store] = await Promise.all([loadSiteDays(site.id, period, false), storeOf(site.id)]);
  return { period, ...conversionsOf(days, store.selling) };
}

/** The visit summary of an organization's sites: a site that was never published has no numbers and is not read. */
export async function summaryReport(organizationId: string, period: ReportPeriod): Promise<{ period: ReportPeriod } & SummaryReport> {
  const sites = await listSites(organizationId);
  const inputs = await Promise.all(
    sites.map(async (site) => ({
      id: site.id,
      name: site.name,
      status: site.status,
      days: site.status === 'published' ? await loadSiteDays(site.id, period, false) : null,
    })),
  );
  return { period, ...summaryOf(period, inputs) };
}
