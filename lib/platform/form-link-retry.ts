/**
 * The retry run of the waiting form links (part 3, session W3; PRD V1.0
 * "Prospects": a submission is never lost when Contact Center is down).
 *
 * The service has no job queue, so the run is a timer in the server process,
 * started once from instrumentation.ts like the scope registration: every
 * tick it takes the waiting rows whose delay has passed
 * (lib/platform/form-links.ts) and asks Contact Center again. What waits is
 * in the database, not in the process: a restart loses nothing, and the first
 * tick after it carries on. Rows are taken with SKIP LOCKED, so a second
 * process of the service would share the work, not repeat it.
 *
 * WS_FORM_RETRY_TICK_SECONDS sets the tick (30 by default; the e2e run uses 1).
 * The delay between a row's attempts is not the tick: it doubles from one
 * minute to six hours (retryDelaySeconds).
 */

import { retryWaitingLinks } from '@/lib/platform/form-links';

const DEFAULT_TICK_SECONDS = 30;

const globalForRetry = globalThis as unknown as { __webStudioFormLinkRetry?: { running: boolean } };

/** The tick in seconds: a whole number from 1 to 3600, the default otherwise. */
export function retryTickSeconds(env: Record<string, string | undefined> = process.env): number {
  const value = Number(env.WS_FORM_RETRY_TICK_SECONDS);
  return Number.isInteger(value) && value >= 1 && value <= 3600 ? value : DEFAULT_TICK_SECONDS;
}

/**
 * Start the timer; a second call does nothing. A run that fails is logged and the next tick tries again. The start is
 * logged once, so a server's log shows that the retry is running and how often it looks. `retry` is for tests; the
 * result is what stops the timer.
 */
export function startFormLinkRetry(retry: typeof retryWaitingLinks = retryWaitingLinks): () => void {
  if (globalForRetry.__webStudioFormLinkRetry) return () => {};
  const state = { running: false };
  globalForRetry.__webStudioFormLinkRetry = state;

  const tick = async () => {
    // A run slower than the tick is not joined by a second one.
    if (state.running) return;
    state.running = true;
    try {
      const { taken, set } = await retry();
      if (taken > 0) console.info(`[form link] retry: ${set} of ${taken} waiting submissions reached Contact Center`);
    } catch (error) {
      console.error('[form link] the retry run failed; the next tick tries again', error);
    } finally {
      state.running = false;
    }
  };

  const seconds = retryTickSeconds();
  const timer = setInterval(() => void tick(), seconds * 1000);
  timer.unref?.();
  console.info(`[form link] retry started: waiting submissions are looked at every ${seconds} seconds`);

  return () => {
    clearInterval(timer);
    if (globalForRetry.__webStudioFormLinkRetry === state) delete globalForRetry.__webStudioFormLinkRetry;
  };
}
