/** Requests allowed per identity in one window. */
export const PUBLIC_TRACKING_LIMIT = 60;
export const PUBLIC_TRACKING_WINDOW_MS = 60_000;
/** Hard ceiling on tracked identities; the Map never holds more, whatever the traffic. */
export const PUBLIC_TRACKING_MAX_IDENTITIES = 10_000;
/** Most entries one call may discard. Each call adds at most one entry, so a small constant keeps up and bounds the work. */
export const PUBLIC_TRACKING_PURGE_BATCH = 8;

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window counter per identity (in memory, per process), bounded in size and in work per call.
 *
 * Every bucket lives exactly one window from its creation, and a bucket whose window ended is deleted and re-inserted, so Map insertion
 * order is also expiry order: the head is always the next bucket to expire. That gives O(1) work per call:
 *  - expired buckets are discarded from the head, at most PUBLIC_TRACKING_PURGE_BATCH per call, stopping at the first live one;
 *  - when the Map is full of LIVE buckets and a new identity arrives, the oldest live bucket (the head, closest to expiring anyway) is
 *    evicted to make room. The new identity is always served: valid customers are never refused because the table is full.
 *    Cost of that choice: the evicted identity's counter restarts, so under a flood of more than MAX distinct sources within one window
 *    a heavy source can get extra requests. That fails open on the quota only; it cannot lock anyone out, and one source can only
 *    ever occupy one slot, so evicting others needs more than MAX distinct addresses.
 */
export class PublicTrackingRateLimiter {
  readonly #buckets = new Map<string, Bucket>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly limit: number = PUBLIC_TRACKING_LIMIT,
    private readonly windowMs: number = PUBLIC_TRACKING_WINDOW_MS,
    private readonly maxIdentities: number = PUBLIC_TRACKING_MAX_IDENTITIES,
    private readonly purgeBatch: number = PUBLIC_TRACKING_PURGE_BATCH,
  ) {}

  /** Number of tracked identities (for tests and metrics). */
  get size(): number {
    return this.#buckets.size;
  }

  /** Counts one request; returns false when the identity is over its limit in the current window. */
  allow(identity: string): boolean {
    const now = this.now();
    this.#purgeExpired(now);

    const bucket = this.#buckets.get(identity);
    if (bucket !== undefined && now <= bucket.resetAt) {
      bucket.count += 1;
      return bucket.count <= this.limit;
    }

    // New identity, or its window ended: a fresh bucket goes to the tail so insertion order stays expiry order.
    if (bucket !== undefined) {
      this.#buckets.delete(identity);
    } else if (this.#buckets.size >= this.maxIdentities) {
      this.#evictOldest();
    }
    this.#buckets.set(identity, { count: 1, resetAt: now + this.windowMs });
    return true;
  }

  #purgeExpired(now: number): void {
    let budget = this.purgeBatch;
    for (const [key, bucket] of this.#buckets) {
      if (budget === 0 || now <= bucket.resetAt) {
        return;
      }
      this.#buckets.delete(key);
      budget -= 1;
    }
  }

  #evictOldest(): void {
    const oldest = this.#buckets.keys().next();
    if (oldest.done !== true) {
      this.#buckets.delete(oldest.value);
    }
  }
}
