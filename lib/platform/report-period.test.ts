import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAX_PERIOD_DAYS, addDays, daysOfPeriod, parseReportPeriod } from './report-period';

/**
 * The period of a report (part 3, session W9; PRD V1.0 "Traffic report"): today, the last 7 days, the last 30 days,
 * or a range of days of the platform's time, at most a year. The days are `YYYY-MM-DD` text: a period is a list of
 * days, never a moment, so a time zone cannot move it.
 */

const TODAY = '2026-11-11';
const parse = (query: string) => parseReportPeriod(new URLSearchParams(query), TODAY);
const refused = (query: string): string => {
  const result = parse(query);
  assert.equal(result.ok, false, `${query} should be refused`);
  return result.ok ? '' : result.message;
};

test('today is one day; the last 7 and 30 days end today and count it', () => {
  assert.deepEqual(parse('period=today'), { ok: true, period: { key: 'today', from: '2026-11-11', to: '2026-11-11', days: 1 } });
  assert.deepEqual(parse('period=last_7_days'), { ok: true, period: { key: 'last_7_days', from: '2026-11-05', to: '2026-11-11', days: 7 } });
  assert.deepEqual(parse('period=last_30_days'), { ok: true, period: { key: 'last_30_days', from: '2026-10-13', to: '2026-11-11', days: 30 } });
});

test('a range is its own days, both ends counted, and may be one day', () => {
  assert.deepEqual(parse('from=2026-10-01&to=2026-10-31'), { ok: true, period: { key: 'custom', from: '2026-10-01', to: '2026-10-31', days: 31 } });
  assert.deepEqual(parse('from=2026-11-11&to=2026-11-11'), { ok: true, period: { key: 'custom', from: '2026-11-11', to: '2026-11-11', days: 1 } });
  // February of a leap year has its 29th.
  assert.deepEqual(parse('from=2024-02-28&to=2024-03-01'), { ok: true, period: { key: 'custom', from: '2024-02-28', to: '2024-03-01', days: 3 } });
});

test('the longest range is 366 days, ending today or before', () => {
  assert.equal(MAX_PERIOD_DAYS, 366);
  const longest = parse('from=2025-11-11&to=2026-11-11');
  assert.deepEqual(longest, { ok: true, period: { key: 'custom', from: '2025-11-11', to: '2026-11-11', days: 366 } });
  assert.match(refused('from=2025-11-10&to=2026-11-11'), /366 days/);
  assert.match(refused('from=2020-01-01&to=2026-11-11'), /366 days/);
});

test('one of the three periods or a from and a to: nothing else, and nothing left out', () => {
  assert.match(refused(''), /period/);
  assert.match(refused('period=yesterday'), /period/);
  assert.match(refused('period=custom'), /from/);
  assert.match(refused('period='), /period/);
  assert.match(refused('from=2026-11-01'), /to/);
  assert.match(refused('to=2026-11-01'), /from/);
  assert.match(refused('period=today&from=2026-11-01&to=2026-11-02'), /not both/);
  assert.match(refused('period=today&to=2026-11-02'), /not both/);
});

test('a day is a real day written YYYY-MM-DD', () => {
  for (const day of ['2026-13-01', '2026-00-10', '2026-02-30', '2025-02-29', '2026-11-31', '26-11-01', '11/05/2026', '2026-1-5', '2026-11-05T10:00', '', ' 2026-11-05']) {
    assert.match(refused(`from=${encodeURIComponent(day)}&to=2026-11-11`), /from/, `from=${day}`);
    assert.match(refused(`from=2026-11-01&to=${encodeURIComponent(day)}`), /to/, `to=${day}`);
  }
  assert.equal(parse('from=2024-02-29&to=2024-02-29').ok, true);
});

test('the end is not after today and not before the start', () => {
  assert.match(refused('from=2026-11-11&to=2026-11-12'), /after today/);
  assert.match(refused('from=2026-11-12&to=2026-11-12'), /after today/);
  assert.match(refused('from=2026-11-05&to=2026-11-04'), /before/);
});

test('addDays crosses months, years and leap days', () => {
  assert.equal(addDays('2026-11-11', -6), '2026-11-05');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2024-03-01', -1), '2024-02-29');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2026-11-11', 0), '2026-11-11');
});

test('the days of a period, oldest first, today last', () => {
  const result = parse('period=last_7_days');
  assert.ok(result.ok);
  assert.deepEqual(daysOfPeriod(result.period), ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11']);
  const year = parse('from=2025-11-11&to=2026-11-11');
  assert.ok(year.ok);
  const days = daysOfPeriod(year.period);
  assert.equal(days.length, 366);
  assert.equal(new Set(days).size, 366);
  assert.equal(days[0], '2025-11-11');
  assert.equal(days[365], '2026-11-11');
});
