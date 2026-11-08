/**
 * The checkout's rate limit (part 2, session W3; owner, 8 Nov 2026,
 * OPEN_QUESTIONS 28).
 *
 * The form route's limit counts an IP's rows in `form_submissions`; a checkout
 * writes none, so the checkout counts its own: per site and IP, each new
 * checkout that reaches Contact Center (its body valid and its lines on sale;
 * each would create a person and an order). A repeat of a stored checkout, a
 * refused body and a spam hit are not counted. The count is read by
 * `screenFormSubmission`, with the site's own form-spam settings (window,
 * limit, on or off), so the two routes are configured in one place.
 *
 * Kept in the process's memory: nothing about the buyer is stored, and a
 * restart forgets the counts (one process serves the platform). On globalThis
 * because Next bundles every route on its own.
 */

/** Timestamps per key, oldest first; a key whose newest is older than the longest window is dropped. */
export class RecentCounter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly windowMs: number) {}

  /** Hits of `key` at or after `sinceMs`. */
  count(key: string, sinceMs: number): number {
    const times = this.hits.get(key);
    if (!times) return 0;
    let n = 0;
    for (let i = times.length - 1; i >= 0 && times[i] >= sinceMs; i--) n++;
    return n;
  }

  /** One hit of `key` at `nowMs`; forgets what has left the window, for every key. */
  add(key: string, nowMs: number): void {
    this.prune(nowMs);
    const times = this.hits.get(key) ?? [];
    times.push(nowMs);
    this.hits.set(key, times);
  }

  /** Keys held (for tests). */
  get size(): number {
    return this.hits.size;
  }

  private prune(nowMs: number): void {
    const oldest = nowMs - this.windowMs;
    for (const [key, times] of this.hits) {
      const keep = times.filter((time) => time >= oldest);
      if (keep.length) this.hits.set(key, keep);
      else this.hits.delete(key);
    }
  }
}

/** The key of a site and an IP. */
export const limitKey = (siteId: string, ip: string) => `${siteId}|${ip}`;

const globalForLimit = globalThis as unknown as { __webStudioCheckoutLimit?: RecentCounter };

/** The process's counter; `windowMs` is taken by the first call (the form-spam window, fixed in code). */
export function checkoutCounter(windowMs: number): RecentCounter {
  return (globalForLimit.__webStudioCheckoutLimit ??= new RecentCounter(windowMs));
}
