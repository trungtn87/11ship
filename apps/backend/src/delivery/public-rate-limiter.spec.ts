import { describe, expect, it } from '@jest/globals';
import {
  PUBLIC_TRACKING_LIMIT,
  PUBLIC_TRACKING_MAX_IDENTITIES,
  PUBLIC_TRACKING_OVERFLOW_FACTOR,
  PUBLIC_TRACKING_PURGE_BATCH,
  PUBLIC_TRACKING_WINDOW_MS,
  PublicRateLimiter,
} from './public-rate-limiter';

function make(overrides: { max?: number; batch?: number } = {}): { limiter: PublicRateLimiter; clock: { t: number } } {
  const clock = { t: 1_000_000 };
  const limiter = new PublicRateLimiter(
    () => clock.t,
    PUBLIC_TRACKING_LIMIT,
    PUBLIC_TRACKING_WINDOW_MS,
    overrides.max ?? PUBLIC_TRACKING_MAX_IDENTITIES,
    overrides.batch ?? PUBLIC_TRACKING_PURGE_BATCH,
  );
  return { limiter, clock };
}

describe('PublicRateLimiter Retry-After (whole seconds until the window ends)', () => {
  it('(c) reports the seconds left in the window of the refusing identity, rounded up, and at least 1', () => {
    const { limiter, clock } = make();
    for (let i = 0; i < PUBLIC_TRACKING_LIMIT; i += 1) limiter.take('a');
    expect(limiter.take('a')).toEqual({ allowed: false, retryAfterSeconds: 60 });
    clock.t += 59_500;
    expect(limiter.take('a')).toEqual({ allowed: false, retryAfterSeconds: 1 }); // 500 ms left rounds up to 1 s
    clock.t += 500; // exactly at the window edge: still refused when now == resetAt
    expect(limiter.take('a')).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it('(c) an overflow refusal carries the seconds left in the shared overflow window', () => {
    const { limiter, clock } = make({ max: 1 });
    limiter.allow('resident');
    for (let i = 0; i < PUBLIC_TRACKING_LIMIT * PUBLIC_TRACKING_OVERFLOW_FACTOR; i += 1) limiter.take(`new-${i}`);
    expect(limiter.take('new-refused')).toEqual({ allowed: false, retryAfterSeconds: 60 });
    clock.t += 20_000;
    expect(limiter.take('another-new')).toEqual({ allowed: false, retryAfterSeconds: 40 });
    clock.t += 40_000 + 1; // 'resident' expired, so the freed slot gives the next new identity its own bucket: served
    expect(limiter.take('after-window')).toEqual({ allowed: true, retryAfterSeconds: 1 });
  });
});

describe('PublicRateLimiter (P5-7b bounded store)', () => {
  it('still allows 60 requests per minute per identity and refuses the 61st', () => {
    const { limiter } = make();
    for (let i = 0; i < PUBLIC_TRACKING_LIMIT; i += 1) {
      expect(limiter.allow('203.0.113.1')).toBe(true);
    }
    expect(limiter.allow('203.0.113.1')).toBe(false);
    expect(limiter.allow('203.0.113.2')).toBe(true);
  });

  it('a new window restores the quota', () => {
    const { limiter, clock } = make();
    for (let i = 0; i <= PUBLIC_TRACKING_LIMIT; i += 1) limiter.allow('a');
    expect(limiter.allow('a')).toBe(false);
    clock.t += PUBLIC_TRACKING_WINDOW_MS + 1;
    expect(limiter.allow('a')).toBe(true);
  });

  it('never holds more than the hard cap, even beyond 1000 and beyond the cap, all live', () => {
    const { limiter } = make({ max: 5_000 });
    for (let i = 0; i < 1_001; i += 1) limiter.allow(`ip-${i}`);
    expect(limiter.size).toBe(1_001); // the old 1000 threshold is no longer a cliff
    for (let i = 1_001; i < 20_000; i += 1) {
      limiter.allow(`ip-${i}`);
      expect(limiter.size).toBeLessThanOrEqual(5_000);
    }
    expect(limiter.size).toBe(5_000);
  });

  it('the shipped cap is a fixed constant of 10 000', () => {
    expect(PUBLIC_TRACKING_MAX_IDENTITIES).toBe(10_000);
  });

  it('(a) full table of 10 000 live identities: new identities share ONE overflow bucket of 10 x limit, then are refused', () => {
    const { limiter } = make();
    for (let i = 0; i < PUBLIC_TRACKING_MAX_IDENTITIES; i += 1) expect(limiter.allow(`ip-${i}`)).toBe(true);
    expect(limiter.size).toBe(PUBLIC_TRACKING_MAX_IDENTITIES);
    const overflow = PUBLIC_TRACKING_LIMIT * 10;
    for (let i = 0; i < overflow; i += 1) expect(limiter.allow(`new-${i}`)).toBe(true);
    expect(limiter.allow('new-after-overflow')).toBe(false); // overflow bucket spent, not served without limit
    expect(limiter.allow(`new-${overflow + 1}`)).toBe(false); // any further new identity shares the same spent bucket
    expect(limiter.size).toBe(PUBLIC_TRACKING_MAX_IDENTITIES); // overflow identities take no table slot
  });

  it('(b) identities already in the table keep their own bucket while the overflow bucket is spent', () => {
    const { limiter } = make({ max: 3 });
    limiter.allow('a');
    limiter.allow('b');
    limiter.allow('c');
    for (let i = 0; i < PUBLIC_TRACKING_LIMIT * 10; i += 1) limiter.allow(`new-${i}`);
    expect(limiter.allow('new-x')).toBe(false);
    // 'a', 'b', 'c' were never evicted and still get their full own quota.
    for (let i = 0; i < PUBLIC_TRACKING_LIMIT - 1; i += 1) expect(limiter.allow('b')).toBe(true);
    expect(limiter.allow('b')).toBe(false);
    expect(limiter.allow('a')).toBe(true);
  });

  it('a new identity gets its own bucket again once an expired entry frees a slot', () => {
    const { limiter, clock } = make({ max: 2 });
    limiter.allow('old'); // window ends at t0 + 60 s
    clock.t += PUBLIC_TRACKING_WINDOW_MS / 2;
    limiter.allow('live'); // window ends at t0 + 90 s
    clock.t += PUBLIC_TRACKING_WINDOW_MS / 2 + 1; // 'old' expired, 'live' still in its window
    expect(limiter.allow('fresh')).toBe(true); // took the freed slot
    expect(limiter.size).toBe(2);
  });

  it('a single heavy source cannot push anyone out: it only ever occupies one slot', () => {
    const { limiter } = make({ max: 3 });
    limiter.allow('victim');
    for (let i = 0; i < 10_000; i += 1) limiter.allow('attacker');
    expect(limiter.size).toBe(2);
    for (let i = 0; i < PUBLIC_TRACKING_LIMIT - 1; i += 1) limiter.allow('victim');
    expect(limiter.allow('victim')).toBe(false); // victim's counter survived
  });

  it('expiry frees room: expired buckets are discarded before any live one is evicted', () => {
    const { limiter, clock } = make({ max: 3 });
    limiter.allow('old1');
    limiter.allow('old2');
    clock.t += PUBLIC_TRACKING_WINDOW_MS / 2;
    limiter.allow('live');
    clock.t += PUBLIC_TRACKING_WINDOW_MS / 2 + 1; // old1/old2 expired, live not
    for (let i = 0; i < PUBLIC_TRACKING_LIMIT - 1; i += 1) limiter.allow('live');
    expect(limiter.allow('new')).toBe(true);
    expect(limiter.size).toBe(2); // live + new; both expired buckets gone
    expect(limiter.allow('live')).toBe(false); // live was not evicted, its counter is intact
  });

  it('an identity whose window ended is re-inserted at the tail so head order stays expiry order', () => {
    const { limiter, clock } = make({ max: 2 });
    limiter.allow('a');
    clock.t += PUBLIC_TRACKING_WINDOW_MS / 2;
    limiter.allow('b');
    clock.t += PUBLIC_TRACKING_WINDOW_MS / 2 + 1; // a expired, b live
    limiter.allow('a'); // fresh window for a, now the newest
    limiter.allow('c'); // full of live buckets (b, a): the oldest live one is b
    for (let i = 0; i < PUBLIC_TRACKING_LIMIT - 1; i += 1) limiter.allow('a');
    expect(limiter.allow('a')).toBe(false); // a kept its counter; b was the one evicted
  });

  it('work per request is bounded: a mass of expired buckets is drained a few per call, never scanned whole', () => {
    const batch = 8;
    const { limiter, clock } = make({ batch });
    for (let i = 0; i < 5_000; i += 1) limiter.allow(`ip-${i}`);
    clock.t += PUBLIC_TRACKING_WINDOW_MS + 1; // all 5000 expired
    limiter.allow('fresh');
    // One call removed at most `batch` entries (plus the one it inserted); the old code removed all 5000 in a single request.
    expect(limiter.size).toBe(5_000 - batch + 1);
    // Steady state: the backlog drains at `batch` per call, so it is gone after ceil(5000/batch) calls.
    for (let i = 0; i < Math.ceil(5_000 / batch); i += 1) limiter.allow('fresh');
    expect(limiter.size).toBe(1);
  });
});
