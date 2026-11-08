/**
 * The checkout's rate limit (part 2, session W3; owner, 8 Nov 2026,
 * OPEN_QUESTIONS 28).
 *
 * The form route's limit counts an IP's rows in `form_submissions`; a checkout
 * writes none, so the checkout counts its own: per site and IP, each new
 * checkout that reaches Contact Center (its body valid and its lines on sale;
 * each would create a person and an order). A repeat of a stored checkout, a
 * refused body and a spam hit are not counted. Nor is a retry: the same
 * checkout id with the same phone, sent again after Sales failed or refused an
 * item, finds the same person and makes at most the one order, so it is
 * counted once (the page keeps its checkout id until it succeeds, and the
 * design's "Try again" sends it again). A checkout id sent with another phone
 * would make another person, so it counts again. The count is read by
 * `screenFormSubmission`, with the site's own form-spam settings (window,
 * limit, on or off), so the two routes are configured in one place.
 *
 * Kept in the process's memory for the window only, never stored or logged; a
 * restart forgets the counts (one process serves the platform). On globalThis
 * because Next bundles every route on its own.
 */

/** Per key, each checkout counted and when it was first counted; a checkout counted before the window is forgotten. */
export class RecentCounter {
  private readonly hits = new Map<string, Map<string, number>>();

  constructor(private readonly windowMs: number) {}

  /** Checkouts of `key` first counted at or after `sinceMs`. */
  count(key: string, sinceMs: number): number {
    const times = this.hits.get(key);
    if (!times) return 0;
    let n = 0;
    for (const time of times.values()) if (time >= sinceMs) n++;
    return n;
  }

  /** Count checkout `id` for `key` at `nowMs`, unless it is counted already; forgets what has left the window, for every key. */
  add(key: string, id: string, nowMs: number): void {
    this.prune(nowMs);
    const times = this.hits.get(key) ?? new Map<string, number>();
    if (!times.has(id)) times.set(id, nowMs);
    this.hits.set(key, times);
  }

  /** Keys held (for tests). */
  get size(): number {
    return this.hits.size;
  }

  private prune(nowMs: number): void {
    const oldest = nowMs - this.windowMs;
    for (const [key, times] of this.hits) {
      for (const [id, time] of times) if (time < oldest) times.delete(id);
      if (times.size === 0) this.hits.delete(key);
    }
  }
}

/** The key of a site and an IP. */
export const limitKey = (siteId: string, ip: string) => `${siteId}|${ip}`;

/** What one checkout is counted as: its id and the buyer's phone in canonical form (a retry sends both again). */
export const countedCheckout = (checkoutId: string, phoneCanonical: string) => `${checkoutId}|${phoneCanonical}`;

const globalForLimit = globalThis as unknown as { __webStudioCheckoutLimit?: RecentCounter };

/** The process's counter; `windowMs` is taken by the first call (the form-spam window, fixed in code). */
export function checkoutCounter(windowMs: number): RecentCounter {
  return (globalForLimit.__webStudioCheckoutLimit ??= new RecentCounter(windowMs));
}
