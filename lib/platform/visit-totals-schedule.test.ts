import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import { nextRunAt, startVisitTotalsSchedule } from './visit-totals-schedule';
import { visitDay } from './visit-rules';

const HOUR = 3_600_000;

test('the daily run is at 01:00 in Baghdad, which is 22:00 UTC the evening before', () => {
  // 13:00 in Baghdad on the 11th: the run is at 01:00 on the 12th.
  assert.equal(nextRunAt(new Date('2026-11-11T10:00:00Z')).toISOString(), '2026-11-11T22:00:00.000Z');
  // Just before it, the same run; at it, and after it, the next day's.
  assert.equal(nextRunAt(new Date('2026-11-11T21:59:59.999Z')).toISOString(), '2026-11-11T22:00:00.000Z');
  assert.equal(nextRunAt(new Date('2026-11-11T22:00:00Z')).toISOString(), '2026-11-12T22:00:00.000Z');
  assert.equal(nextRunAt(new Date('2026-11-11T23:30:00Z')).toISOString(), '2026-11-12T22:00:00.000Z');
});

test('the run is always ahead, within a day, and at the first hour of a platform day', () => {
  for (let at = Date.parse('2026-01-01T00:00:00Z'); at < Date.parse('2027-01-01T00:00:00Z'); at += 7 * HOUR + 1_234_567) {
    const now = new Date(at);
    const next = nextRunAt(now);
    assert.ok(next.getTime() > now.getTime(), now.toISOString());
    assert.ok(next.getTime() - now.getTime() <= 24 * HOUR, now.toISOString());
    // 01:00 is the hour after the day's own start: an hour earlier is still that day, an hour and a minute earlier is the day before.
    assert.equal(visitDay(new Date(next.getTime() - HOUR)), visitDay(next), now.toISOString());
    assert.notEqual(visitDay(new Date(next.getTime() - HOUR - 60_000)), visitDay(next), now.toISOString());
  }
});

/** Let the awaits of a timer's callback finish (the clock is mocked, the microtask queue is not). */
const settle = async () => {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
};

test('the schedule runs once at each 01:00 and arms the next, and stops when told to', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-11-11T10:00:00Z') });
  const log = mock.method(console, 'log', () => {});
  let runs = 0;
  const stop = startVisitTotalsSchedule(async () => ({ skipped: false, siteDays: ++runs, deleted: 0 }));
  try {
    // The start is logged once, with the moment of the first run: a server's log shows that the schedule is armed.
    assert.deepEqual(log.mock.calls.map((call) => call.arguments[0]), ['[visit totals] scheduled: the first run is at 2026-11-11T22:00:00.000Z (01:00 in Baghdad), then every day']);
    // A second start while one is going does nothing: one timer, so one run a day.
    startVisitTotalsSchedule(async () => ({ runs: 'second' }))();
    mock.timers.tick(12 * HOUR - 1);
    await settle();
    assert.equal(runs, 0);
    mock.timers.tick(1); // 22:00 UTC, 01:00 on the 12th in Baghdad
    await settle();
    assert.equal(runs, 1);
    mock.timers.tick(24 * HOUR - 1);
    await settle();
    assert.equal(runs, 1);
    mock.timers.tick(1);
    await settle();
    assert.equal(runs, 2);
    stop();
    mock.timers.tick(48 * HOUR);
    await settle();
    assert.equal(runs, 2);
  } finally {
    stop();
    mock.restoreAll();
    mock.timers.reset();
  }
});

test('a run that fails is logged and the next day is still armed', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-11-11T21:00:00Z') });
  const logged = mock.method(console, 'error', () => {});
  mock.method(console, 'log', () => {});
  let runs = 0;
  const stop = startVisitTotalsSchedule(async () => {
    runs += 1;
    if (runs === 1) throw new Error('the database is down');
    return { skipped: false, siteDays: 2, deleted: 0 };
  });
  try {
    mock.timers.tick(HOUR);
    await settle();
    assert.equal(runs, 1);
    assert.equal(logged.mock.callCount(), 1);
    mock.timers.tick(24 * HOUR);
    await settle();
    assert.equal(runs, 2);
    assert.equal(logged.mock.callCount(), 1);
  } finally {
    stop();
    mock.restoreAll();
    mock.timers.reset();
  }
});
