/**
 * Small in-memory TTL cache with FIFO (insertion-order) eviction beyond
 * `maxEntries`. Expiry is checked lazily on `get()` only — there is no
 * background timer/interval, so it never keeps the stdio process alive.
 *
 * Insertion-ordered `Map` gives FIFO for free: re-assigning an *existing* key
 * keeps its original position, so eviction always removes the entry that was
 * first inserted (not the least-recently-used one).
 */
export class TtlCache<V> {
  private readonly store = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Returns the cached value, or `undefined` on a miss (never stored, or
   * expired). A cached `undefined`-vs-`V` distinction is up to the caller —
   * this cache stores whatever `V` is, including `null`, and only ever
   * returns `undefined` to signal "not in cache".
   */
  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (this.now() >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key: string, value: V): void {
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });

    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) break;
      this.store.delete(oldestKey);
    }
  }
}
