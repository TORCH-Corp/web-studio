/**
 * When the daily run happens (part 3, session W8).
 *
 * Once a day, at 01:00 in the platform's time zone (Baghdad, UTC+3 all year),
 * an hour after the day it totals has ended: a view that was being written as
 * the day turned is in the table long before the run reads it. `nextRunAt` is
 * pure; `startVisitTotalsSchedule` is the timer the service starts
 * (instrumentation.ts).
 */

import { VISIT_TIME_ZONE, visitDay } from '@/lib/platform/visit-rules';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** The hour of the platform's day the run starts at. */
export const RUN_HOUR = 1;

/**
 * The next run after `now`: the first 01:00 of the platform's day that is later
 * than `now`. Baghdad has no daylight saving time since 2008, so the platform's
 * midnight is a fixed offset from UTC; the offset is read from the zone, not
 * written here, and the unit test walks a year of moments to prove the run is
 * always ahead, within a day, and at the day's first hour.
 */
export function nextRunAt(now: Date): Date {
  // The platform's date of `now`, and the zone's offset at that moment, from the zone itself.
  const today = visitDay(now);
  const offset = offsetMs(now);
  const todayRun = Date.parse(`${today}T00:00:00Z`) - offset + RUN_HOUR * HOUR_MS;
  return new Date(todayRun > now.getTime() ? todayRun : todayRun + DAY_MS);
}

/** The zone's offset from UTC at a moment, in milliseconds (+3 hours for Baghdad). */
function offsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: VISIT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)!.value);
  const asUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

interface Schedule {
  timer: ReturnType<typeof setTimeout> | null;
}

const globalForSchedule = globalThis as unknown as { __webStudioVisitTotals?: Schedule };

/** The run the service makes: the daily run on its own connection (loaded when it is due, so a service that never reaches 01:00 never loads it). */
async function runDaily(): Promise<unknown> {
  const { runVisitTotalsOnce } = await import('@/lib/platform/visit-totals-run');
  return runVisitTotalsOnce();
}

/**
 * Start the daily run in this process: it runs at the next 01:00 and every day
 * after, and logs each run. A second call while one is going does nothing, and
 * several processes are safe: a run that finds another one going is skipped
 * (lib/platform/visit-totals-run.ts). A failed run is logged and tried again the
 * next day; the next run totals every day the failed one missed. `run` is for
 * tests. Returns what stops the schedule.
 */
export function startVisitTotalsSchedule(run: () => Promise<unknown> = runDaily): () => void {
  if (globalForSchedule.__webStudioVisitTotals) return () => {};
  const schedule: Schedule = { timer: null };
  globalForSchedule.__webStudioVisitTotals = schedule;

  const arm = (): Date => {
    const at = nextRunAt(new Date());
    // setTimeout holds at most 2^31 ms: a day is far under it.
    schedule.timer = setTimeout(async () => {
      try {
        console.log(`[visit totals] ${JSON.stringify(await run())}`);
      } catch (error) {
        console.error('[visit totals] the daily run failed; the next run totals the days it missed', error);
      }
      if (globalForSchedule.__webStudioVisitTotals === schedule) arm();
    }, at.getTime() - Date.now());
    // The timer never keeps the process alive on its own.
    schedule.timer.unref?.();
    return at;
  };
  // The first line of the daily run's log: it is the proof, on a server, that the schedule is armed and for when.
  console.log(`[visit totals] scheduled: the first run is at ${arm().toISOString()} (01:00 in Baghdad), then every day`);

  return () => {
    if (schedule.timer) clearTimeout(schedule.timer);
    if (globalForSchedule.__webStudioVisitTotals === schedule) delete globalForSchedule.__webStudioVisitTotals;
  };
}
