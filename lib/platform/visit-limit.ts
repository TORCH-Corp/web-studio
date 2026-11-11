/**
 * The rate limit of the visit route (part 3, session W7).
 *
 * The form route allows a site's visitor ten submissions in ten minutes, a
 * number a person reading a site passes in a minute of pages, so the visit
 * route counts its own requests, per site and IP, in the same ten-minute
 * window: 600, one a second. Several people share one address behind a mobile
 * network or an office, so the number is far above one reader's; what it stops
 * is a program filling the table. Every request the route reads is counted,
 * whether or not it becomes a row.
 *
 * Kept in the process's memory for the window only, never stored or logged, as
 * the checkout's limit is (lib/platform/checkout-limit.ts); a restart forgets
 * the counts. On globalThis because Next bundles every route on its own.
 */

export const VISIT_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const VISIT_LIMIT_MAX = 600;

/** How many keys are held before the ones whose window has ended are dropped. */
const PRUNE_ABOVE = 5000;

/** Requests per key in a window that starts with the key's first request. */
export class WindowCounter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly windowMs: number,
    private readonly max: number,
  ) {}

  /** Count a request of `key` at `nowMs`; false when the key has used its window up. */
  allow(key: string, nowMs: number): boolean {
    const current = this.windows.get(key);
    if (!current || nowMs - current.start >= this.windowMs) {
      if (this.windows.size >= PRUNE_ABOVE) this.prune(nowMs);
      this.windows.set(key, { start: nowMs, count: 1 });
      return true;
    }
    if (current.count >= this.max) return false;
    current.count++;
    return true;
  }

  /** Keys held (for tests). */
  get size(): number {
    return this.windows.size;
  }

  private prune(nowMs: number): void {
    for (const [key, window] of this.windows) {
      if (nowMs - window.start >= this.windowMs) this.windows.delete(key);
    }
  }
}

const globalForLimit = globalThis as unknown as { __webStudioVisitLimit?: WindowCounter };

/** The process's counter. */
export function visitCounter(): WindowCounter {
  return (globalForLimit.__webStudioVisitLimit ??= new WindowCounter(VISIT_LIMIT_WINDOW_MS, VISIT_LIMIT_MAX));
}
