/**
 * The daily run (part 3, session W8; PRD V1.0 "Visit counting"): finished days
 * become totals, and detail older than 90 days goes.
 *
 * One transaction, so the totals and the clean-up are all or nothing:
 *
 * 1. Every finished day (before today, in the platform's day: `visitDay`) of
 *    every site that has detailed rows and no row in `platform_visit_site_days`
 *    is totalled: the day's rows are read, `totalsOfDay` (lib/platform/visit-totals.ts)
 *    makes the numbers, and one site row and the page rows are written. A day
 *    that has its site row is never totalled again, so the run can be repeated,
 *    or overlap with another, without counting twice (the inserts also ignore a
 *    conflict, and an advisory lock makes a second run at the same moment skip).
 * 2. Rows of `platform_visits` older than 90 days (`RETENTION_DAYS`) are
 *    deleted, but only those whose day has its site row: a day the run could not
 *    total is not lost. The totals are never deleted.
 *
 * A day is totalled once, the first run after it ends, from the rows then in the
 * table. A row written for a finished day after that is not in the totals: the
 * scheduled run is at 01:00, an hour after the day ends, and a view or event is
 * written within a second of the request that makes it.
 *
 * Run by the service's own timer (lib/platform/visit-totals-schedule.ts) and by
 * `pnpm visits:totals`, which prints the result as one line of JSON.
 */

import type { Knex } from 'knex';
import { getKnexClient } from '@/lib/knex-client';
import { RETENTION_DAYS, totalsOfDay, type TotalsRow } from '@/lib/platform/visit-totals';
import { VISIT_TIME_ZONE, visitDay } from '@/lib/platform/visit-rules';

/** What a run did. `siteDays` counts the (site, day) pairs totalled by this run; `deleted` the detailed rows removed. */
export interface TotalsRun {
  /** True when another run held the lock: nothing was done. */
  skipped: boolean;
  siteDays: number;
  deleted: number;
}

/** The advisory lock of the run (a fixed number of this service's own). */
const LOCK_KEY = 7_302_026_111;

/** Rows of `platform_visit_days` per insert, well under PostgreSQL's 65,535 parameters. */
const PAGE_ROWS_PER_INSERT = 1000;

const DAY_MS = 86_400_000;

interface PendingDay {
  site_id: string;
  day: string;
}

/** The days to total: finished, with detailed rows, and not yet in `platform_visit_site_days`. Oldest first. */
async function pendingDays(trx: Knex.Transaction, today: string): Promise<PendingDay[]> {
  const result = await trx.raw(
    `SELECT v.site_id, to_char(v.day, 'YYYY-MM-DD') AS day
     FROM (
       SELECT DISTINCT site_id, (created_at AT TIME ZONE ?)::date AS day
       FROM platform_visits
       WHERE created_at < (?::date::timestamp AT TIME ZONE ?)
     ) v
     WHERE NOT EXISTS (SELECT 1 FROM platform_visit_site_days d WHERE d.site_id = v.site_id AND d.day = v.day)
     ORDER BY v.day, v.site_id`,
    [VISIT_TIME_ZONE, today, VISIT_TIME_ZONE],
  );
  return (result as { rows: PendingDay[] }).rows;
}

/** One site's detailed rows of one day, as the totals read them. */
async function rowsOfDay(trx: Knex.Transaction, siteId: string, day: string): Promise<TotalsRow[]> {
  const result = await trx.raw(
    `SELECT visitor_key, kind, path, source, device
     FROM platform_visits
     WHERE site_id = ?::uuid
       AND created_at >= (?::date::timestamp AT TIME ZONE ?)
       AND created_at < ((?::date + 1)::timestamp AT TIME ZONE ?)`,
    [siteId, day, VISIT_TIME_ZONE, day, VISIT_TIME_ZONE],
  );
  return (result as { rows: Array<{ visitor_key: string; kind: string; path: string | null; source: TotalsRow['source']; device: TotalsRow['device'] }> }).rows.map(
    (row) => ({ visitorKey: row.visitor_key, kind: row.kind, path: row.path, source: row.source, device: row.device }),
  );
}

/** Total one site's day: its site row, and its page rows. */
async function totalDay(trx: Knex.Transaction, siteId: string, day: string): Promise<void> {
  const { site, pages } = totalsOfDay(await rowsOfDay(trx, siteId, day));
  await trx('platform_visit_site_days')
    .insert({
      site_id: siteId,
      day,
      visitors: site.visitors,
      cart_visitors: site.cartVisitors,
      order_visitors: site.orderVisitors,
      orders: site.orders,
      form_visitors: site.formVisitors,
      forms: site.forms,
    })
    .onConflict(['site_id', 'day'])
    .ignore();
  for (let from = 0; from < pages.length; from += PAGE_ROWS_PER_INSERT) {
    await trx('platform_visit_days')
      .insert(pages.slice(from, from + PAGE_ROWS_PER_INSERT).map((page) => ({ site_id: siteId, day, ...page })))
      .onConflict(['site_id', 'day', 'path', 'source', 'device'])
      .ignore();
  }
}

/** Delete the detailed rows older than 90 days whose day is in the totals. Returns how many. */
async function deleteOldDetail(trx: Knex.Transaction, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
  const result = await trx.raw(
    `DELETE FROM platform_visits v
     WHERE v.created_at < ?::timestamptz
       AND EXISTS (
         SELECT 1 FROM platform_visit_site_days d
         WHERE d.site_id = v.site_id AND d.day = (v.created_at AT TIME ZONE ?)::date
       )`,
    [cutoff, VISIT_TIME_ZONE],
  );
  return (result as { rowCount: number }).rowCount;
}

/** The daily run on a connection. `now` is for tests. */
export async function runVisitTotals(knex: Knex, now: Date = new Date()): Promise<TotalsRun> {
  return knex.transaction(async (trx) => {
    const lock = await trx.raw('SELECT pg_try_advisory_xact_lock(?) AS locked', [LOCK_KEY]);
    if (!(lock as { rows: Array<{ locked: boolean }> }).rows[0].locked) return { skipped: true, siteDays: 0, deleted: 0 };

    const pending = await pendingDays(trx, visitDay(now));
    for (const { site_id: siteId, day } of pending) await totalDay(trx, siteId, day);
    const deleted = await deleteOldDetail(trx, now);
    return { skipped: false, siteDays: pending.length, deleted };
  });
}

/** The daily run on the service's own connection. */
export async function runVisitTotalsOnce(now: Date = new Date()): Promise<TotalsRun> {
  return runVisitTotals(await getKnexClient(), now);
}
