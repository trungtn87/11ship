import { describe, expect, it } from '@jest/globals';
import { codeOf } from '../shared/source-scan.fixture';
import { backoffDelayMs } from './outbox-backoff';

describe('backoffDelayMs — min(cap, base * 2^(attempt_count - 1)), no jitter', () => {
  it('doubles from the base with the default 1000 ms / 60000 ms', () => {
    const delays = [1, 2, 3, 4, 5, 6, 7, 8].map((attempt) => backoffDelayMs(attempt, 1000, 60_000));
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000]);
  });

  it('is capped exactly at the cap, also when the cap is not a power-of-two multiple of the base', () => {
    expect(
      [1, 2, 3, 4, 5].map((attempt) => backoffDelayMs(attempt, 1000, 3000)),
    ).toEqual([1000, 2000, 3000, 3000, 3000]);
    expect(backoffDelayMs(3, 1000, 4000)).toBe(4000);
    expect(backoffDelayMs(3, 1000, 3999)).toBe(3999);
  });

  it('holds for the whole configurable range and never exceeds the cap', () => {
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const delay = backoffDelayMs(attempt, 100, 300_000);
      expect(delay).toBe(Math.min(300_000, 100 * 2 ** (attempt - 1)));
      expect(delay).toBeLessThanOrEqual(300_000);
    }
    expect(backoffDelayMs(20, 300_000, 300_000)).toBe(300_000);
  });

  it('is deterministic: the same input always gives the same delay', () => {
    const first = backoffDelayMs(4, 1000, 60_000);
    for (let i = 0; i < 50; i += 1) {
      expect(backoffDelayMs(4, 1000, 60_000)).toBe(first);
    }
  });

  it('rejects an attempt number or bound that is not a positive integer', () => {
    for (const attempt of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => backoffDelayMs(attempt, 1000, 60_000)).toThrow(RangeError);
    }
    for (const bad of [0, -5, 1.5, Number.NaN]) {
      expect(() => backoffDelayMs(1, bad, 60_000)).toThrow(RangeError);
      expect(() => backoffDelayMs(1, 1000, bad)).toThrow(RangeError);
    }
  });

  it('has no randomness and no clock', () => {
    expect(codeOf('outbox/outbox-backoff.ts')).not.toMatch(/Math\.random|randomInt|randomBytes|Date\.now|new Date|performance/);
  });
});
