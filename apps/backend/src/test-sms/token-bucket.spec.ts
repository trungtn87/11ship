import { describe, expect, it } from '@jest/globals';
import { TokenBucket } from './token-bucket';

describe('TokenBucket (capacity 10, refill 1 per second = 60/min with a burst of 10)', () => {
  it('allows the burst of 10 and then answers 429 data with a typed Retry-After', () => {
    let now = 1_000_000;
    const bucket = new TokenBucket(10, 1, () => now);
    for (let index = 0; index < 10; index += 1) {
      expect(bucket.take()).toEqual({ ok: true });
    }
    expect(bucket.take()).toEqual({ ok: false, retryAfterSeconds: 1 });
    now += 999;
    expect(bucket.take().ok).toBe(false);
    now += 1;
    expect(bucket.take()).toEqual({ ok: true });
    expect(bucket.take().ok).toBe(false);
  });

  it('never refills above the capacity', () => {
    let now = 0;
    const bucket = new TokenBucket(10, 1, () => now);
    now += 3_600_000;
    for (let index = 0; index < 10; index += 1) {
      expect(bucket.take().ok).toBe(true);
    }
    expect(bucket.take().ok).toBe(false);
  });

  it('sustains 60 requests per minute and no more', () => {
    let now = 0;
    const bucket = new TokenBucket(10, 1, () => now);
    let allowed = 0;
    for (let second = 0; second < 60; second += 1) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        if (bucket.take().ok) {
          allowed += 1;
        }
      }
      now += 1000;
    }
    // 10 from the initial burst + 1 per second afterwards (59 refills at the last attempt).
    expect(allowed).toBeLessThanOrEqual(70);
    expect(allowed).toBeGreaterThanOrEqual(60);
  });

  it('survives a clock that steps backwards without handing out extra tokens', () => {
    let now = 10_000;
    const bucket = new TokenBucket(2, 1, () => now);
    expect(bucket.take().ok).toBe(true);
    expect(bucket.take().ok).toBe(true);
    now -= 5000;
    expect(bucket.take().ok).toBe(false);
  });
});
