// A small token bucket with an injectable clock. The test SMS listener uses it for the read quota (capacity 10, one
// token back per second = 60 requests per minute with a burst of 10) and, separately, to bound unauthenticated abuse.

export type BucketTake = { readonly ok: true } | { readonly ok: false; readonly retryAfterSeconds: number };

export class TokenBucket {
  readonly #capacity: number;
  readonly #refillPerSecond: number;
  readonly #now: () => number;
  #tokens: number;
  #lastMs: number;

  constructor(capacity: number, refillPerSecond: number, now: () => number = Date.now) {
    this.#capacity = capacity;
    this.#refillPerSecond = refillPerSecond;
    this.#now = now;
    this.#tokens = capacity;
    this.#lastMs = now();
  }

  take(): BucketTake {
    this.#refill();
    if (this.#tokens >= 1) {
      this.#tokens -= 1;
      return { ok: true };
    }
    const missing = 1 - this.#tokens;
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(missing / this.#refillPerSecond)) };
  }

  #refill(): void {
    const nowMs = this.#now();
    const elapsedSeconds = Math.max(0, nowMs - this.#lastMs) / 1000;
    this.#lastMs = Math.max(nowMs, this.#lastMs);
    this.#tokens = Math.min(this.#capacity, this.#tokens + elapsedSeconds * this.#refillPerSecond);
  }
}
