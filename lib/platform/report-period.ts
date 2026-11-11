/**
 * The period of a report (part 3, session W9; PRD V1.0 "Traffic report", "Conversions report", "Dashboard").
 *
 * A report takes one of three named periods, today, the last 7 days or the last 30 days, or a range of days,
 * `from` and `to`, both counted. A day is `YYYY-MM-DD` text in the platform's time (`visitDay`,
 * lib/platform/visit-rules.ts): a period is a list of days, never a pair of moments, so no time zone can move it.
 * The last 7 days end today and count it, so a report opened on the 10th reads the 4th to the 10th.
 *
 * Kept free of Next and database imports so it runs under `node --test`.
 */

export type PeriodKey = 'today' | 'last_7_days' | 'last_30_days' | 'custom';

/** A period as the reports answer it, so that the app shows the days it read. `days` counts both ends. */
export interface ReportPeriod {
  key: PeriodKey;
  from: string;
  to: string;
  days: number;
}

export type PeriodResult = { ok: true; period: ReportPeriod } | { ok: false; message: string };

/** The longest range: a year, a leap year's 366 days. */
export const MAX_PERIOD_DAYS = 366;

const NAMED: Record<string, { key: PeriodKey; days: number }> = {
  today: { key: 'today', days: 1 },
  last_7_days: { key: 'last_7_days', days: 7 },
  last_30_days: { key: 'last_30_days', days: 30 },
};

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** The day `count` days after (or before, when negative) `day`. Calendar arithmetic in UTC, which has no daylight saving. */
export function addDays(day: string, count: number): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + count)).toISOString().slice(0, 10);
}

/** Whether `value` is a real day written `YYYY-MM-DD`: no 30 February, no month 13, no spaces, no time. */
function isDay(value: string): boolean {
  const match = DAY_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const real = new Date(Date.UTC(year, month - 1, date));
  return real.getUTCFullYear() === year && real.getUTCMonth() === month - 1 && real.getUTCDate() === date;
}

const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;

/**
 * The period a request names, `today` being the platform's current day. A named period, or both `from` and `to`:
 * never neither, never both kinds. A range is real days, `from` not after `to`, `to` not after today, and at most
 * `MAX_PERIOD_DAYS` days. The message says what to change; the route answers 400 with it.
 */
export function parseReportPeriod(query: URLSearchParams, today: string): PeriodResult {
  const name = query.get('period');
  const from = query.get('from');
  const to = query.get('to');

  if (name !== null) {
    if (from !== null || to !== null) return { ok: false, message: 'Give a period, or from and to, not both' };
    const named = NAMED[name];
    if (!named) return { ok: false, message: `Unknown period "${name}": use today, last_7_days or last_30_days, or give both from and to` };
    return { ok: true, period: { key: named.key, from: addDays(today, 1 - named.days), to: today, days: named.days } };
  }

  if (from === null && to === null) return { ok: false, message: 'Give a period (today, last_7_days or last_30_days) or both from and to' };
  if (from === null || to === null) return { ok: false, message: 'Give both from and to' };
  if (!isDay(from)) return { ok: false, message: 'from is not a day written YYYY-MM-DD' };
  if (!isDay(to)) return { ok: false, message: 'to is not a day written YYYY-MM-DD' };
  if (to > today) return { ok: false, message: `to is after today (${today})` };
  if (to < from) return { ok: false, message: 'to is before from' };
  const days = daysBetween(from, to);
  if (days > MAX_PERIOD_DAYS) return { ok: false, message: `A range is at most ${MAX_PERIOD_DAYS} days` };
  return { ok: true, period: { key: 'custom', from, to, days } };
}

/** Every day of the period, oldest first, today (or the last day) last. */
export function daysOfPeriod(period: ReportPeriod): string[] {
  return Array.from({ length: period.days }, (_, i) => addDays(period.from, i));
}
