/**
 * A map whose entries are forgotten after a fixed time, for lookups a request
 * repeats many times (part 2, session W1: a site's store on the published
 * pages). An entry can also be forgotten at once, when the value changes.
 *
 * One process holds one copy; another process keeps a stale entry for at most
 * `ttlMs`. Kept free of Next imports so it runs under `node --test`.
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; at: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() - entry.at >= this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    this.entries.set(key, { value, at: this.now() });
  }

  forget(key: string): void {
    this.entries.delete(key);
  }
}
