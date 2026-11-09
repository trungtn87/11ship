import { describe, expect, it } from '@jest/globals';
import {
  PUBLIC_TRACKING_LIMIT,
  PUBLIC_TRACKING_MAX_IDENTITIES,
  PUBLIC_TRACKING_PURGE_BATCH,
  PUBLIC_TRACKING_WINDOW_MS,
  PublicTrackingRateLimiter,
} from './public-tracking-rate-limiter';

function make(overrides: { max?: number; batch?: number } = {}): { limiter: PublicTrackingRateLimiter; clock: { t: number } } {
  const clock = { t: 1_000_000 };
  const limiter = new PublicTrackingRateLimiter(
    () => clock.t,
    PUBLIC_TRACKING_LIMIT,
    PUBLIC_TRACKING_WINDOW_MS,
    overrides.max ?? PUBLIC_TRACKING_MAX_IDENTITIES,
    overrides.batch ?? PUBLIC_TRACKING_PURGE_BATCH,
  );
  return { limiter, clock };
}

describe('PublicTrackingRateLimiter (P5-7b bounded store)', () => {
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

  it('when full of live buckets a new identity is still served and the oldest bucket makes room', () => {
    const { limiter } = make({ max: 3 });
    limiter.allow('a');
    limiter.allow('b');
    limiter.allow('c');
    expect(limiter.allow('d')).toBe(true); // served, not refused
    expect(limiter.size).toBe(3);
    // 'a' was evicted: it starts over (fail-open on quota only), 'b' and 'c' keep their counters.
    for (let i = 0; i < PUBLIC_TRACKING_LIMIT - 1; i += 1) limiter.allow('b');
    expect(limiter.allow('b')).toBe(false);
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
