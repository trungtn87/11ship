/** Requests allowed per identity in one window. */
export const PUBLIC_TRACKING_LIMIT = 60;
export const PUBLIC_TRACKING_WINDOW_MS = 60_000;
/** Hard ceiling on tracked identities; the Map never holds more, whatever the traffic. */
export const PUBLIC_TRACKING_MAX_IDENTITIES = 10_000;
/** Most entries one call may discard. Each call adds at most one entry, so a small constant keeps up and bounds the work. */
export const PUBLIC_TRACKING_PURGE_BATCH = 8;
/**
 * When the table is full of live identities, every NEW identity shares one overflow bucket whose limit is this many times the
 * per-identity limit, in the same window. Identities already in the table are not affected.
 */
export const PUBLIC_TRACKING_OVERFLOW_FACTOR = 10;

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateDecision {
  allowed: boolean;
  /** Whole seconds (>= 1) until the bucket that refused the request resets; 1 when allowed. */
  retryAfterSeconds: number;
}

const ALLOWED: RateDecision = { allowed: true, retryAfterSeconds: 1 };

function secondsUntil(resetAt: number, now: number): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}

/**
 * Fixed-window counter per identity (in memory, per process), bounded in size and in work per call.
 *
 * One convention everywhere (own buckets, overflow, head drop, purge, Retry-After): a window is half-open, [start, resetAt). A bucket is
 * live while now < resetAt and has expired from now >= resetAt, so a client that waits the Retry-After seconds is never refused again by the same window.
 *
 * Every bucket lives exactly one window from its creation, and a bucket whose window ended is deleted and re-inserted, so Map insertion
 * order is also expiry order: the head is always the next bucket to expire. That gives O(1) work per call:
 *  - expired buckets are discarded from the head, at most PUBLIC_TRACKING_PURGE_BATCH per call, stopping at the first live one;
 *  - when the Map is full and its head has already expired, the head is dropped to make room for the new identity;
 *  - when the Map is full of LIVE buckets, a new identity is NOT given a slot and NOT served without limit: it is counted in one shared
 *    overflow bucket (limit PUBLIC_TRACKING_OVERFLOW_FACTOR x the per-identity limit, same window). Once that is spent, every new
 *    identity is refused with Retry-After until the overflow window ends. A flood of distinct sources therefore cannot bypass the quota,
 *    and the table never grows past its cap. Identities already in the table keep their own counters.
 */
export class PublicRateLimiter {
  readonly #buckets = new Map<string, Bucket>();
  #overflow: Bucket | undefined;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly limit: number = PUBLIC_TRACKING_LIMIT,
    private readonly windowMs: number = PUBLIC_TRACKING_WINDOW_MS,
    private readonly maxIdentities: number = PUBLIC_TRACKING_MAX_IDENTITIES,
    private readonly purgeBatch: number = PUBLIC_TRACKING_PURGE_BATCH,
  ) {}

  /** Number of tracked identities with their own bucket (for tests and metrics). */
  get size(): number {
    return this.#buckets.size;
  }

  /** Counts one request; returns false when the identity is over its limit in the current window. */
  allow(identity: string): boolean {
    return this.take(identity).allowed;
  }

  /** Counts one request and reports the decision together with the Retry-After seconds of a refusal. */
  take(identity: string): RateDecision {
    const now = this.now();
    this.#purgeExpired(now);

    const bucket = this.#buckets.get(identity);
    if (bucket !== undefined && now < bucket.resetAt) {
      bucket.count += 1;
      return bucket.count <= this.limit ? ALLOWED : { allowed: false, retryAfterSeconds: secondsUntil(bucket.resetAt, now) };
    }

    if (bucket !== undefined) {
      // Window ended: the identity starts over, at the tail, so insertion order stays expiry order.
      this.#buckets.delete(identity);
    } else if (this.#buckets.size >= this.maxIdentities && !this.#dropExpiredHead(now)) {
      return this.#takeOverflow(now);
    }
    this.#buckets.set(identity, { count: 1, resetAt: now + this.windowMs });
    return ALLOWED;
  }

  #takeOverflow(now: number): RateDecision {
    let overflow = this.#overflow;
    if (overflow === undefined || now >= overflow.resetAt) {
      overflow = { count: 0, resetAt: now + this.windowMs };
      this.#overflow = overflow;
    }
    overflow.count += 1;
    if (overflow.count <= this.limit * PUBLIC_TRACKING_OVERFLOW_FACTOR) {
      return ALLOWED;
    }
    return { allowed: false, retryAfterSeconds: secondsUntil(overflow.resetAt, now) };
  }

  #dropExpiredHead(now: number): boolean {
    const head = this.#buckets.entries().next();
    if (head.done === true || now < head.value[1].resetAt) {
      return false;
    }
    this.#buckets.delete(head.value[0]);
    return true;
  }

  #purgeExpired(now: number): void {
    let budget = this.purgeBatch;
    for (const [key, bucket] of this.#buckets) {
      if (budget === 0 || now < bucket.resetAt) {
        return;
      }
      this.#buckets.delete(key);
      budget -= 1;
    }
  }
}
