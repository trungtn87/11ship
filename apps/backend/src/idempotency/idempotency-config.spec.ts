import { describe, expect, it } from '@jest/globals';
import {
  assertIdempotencyConfig,
  DEFAULT_IDEMPOTENCY_CONFIG,
  IdempotencyConfig,
  isValidTtl,
} from './idempotency-config';

describe('idempotency defaults (ADR-003 §5, §13.1, §13.4)', () => {
  it('uses 250 ms advisory wait, 500 ms business lock budget, 900 s replay and 604800 s dedupe', () => {
    expect(DEFAULT_IDEMPOTENCY_CONFIG).toEqual({
      advisoryWaitMs: 250,
      businessLockTimeoutMs: 500,
      replayTtlSeconds: 900,
      dedupeTtlSeconds: 604800,
    });
  });

  it('the defaults themselves satisfy the contract', () => {
    expect(() => assertIdempotencyConfig(DEFAULT_IDEMPOTENCY_CONFIG)).not.toThrow();
  });
});

describe('isValidTtl: 1 <= replay <= dedupe <= 604800', () => {
  const accepted: ReadonlyArray<readonly [number, number]> = [
    [1, 1],
    [1, 604800],
    [900, 604800],
    [604800, 604800],
    [60, 60],
  ];
  for (const [replay, dedupe] of accepted) {
    it(`accepts replay=${replay} dedupe=${dedupe}`, () => {
      expect(isValidTtl(replay, dedupe)).toBe(true);
    });
  }

  const refused: ReadonlyArray<readonly [number, number]> = [
    [0, 10],
    [-1, 10],
    [11, 10],
    [1, 604801],
    [604801, 604801],
    [1.5, 10],
    [10, 10.5],
    [Number.NaN, 10],
    [10, Number.POSITIVE_INFINITY],
  ];
  for (const [replay, dedupe] of refused) {
    it(`refuses replay=${replay} dedupe=${dedupe}`, () => {
      expect(isValidTtl(replay, dedupe)).toBe(false);
    });
  }
});

describe('assertIdempotencyConfig', () => {
  const base: IdempotencyConfig = DEFAULT_IDEMPOTENCY_CONFIG;

  const refused: ReadonlyArray<readonly [string, Partial<IdempotencyConfig>]> = [
    ['advisory wait 0', { advisoryWaitMs: 0 }],
    ['advisory wait above 5 s', { advisoryWaitMs: 5001 }],
    ['non-integer advisory wait', { advisoryWaitMs: 10.5 }],
    ['business budget 0 (PostgreSQL treats 0 as "no timeout")', { businessLockTimeoutMs: 0 }],
    ['business budget above 30 s', { businessLockTimeoutMs: 30001 }],
    ['replay above dedupe', { replayTtlSeconds: 1000, dedupeTtlSeconds: 999 }],
    ['dedupe above 7 days', { dedupeTtlSeconds: 604801 }],
    ['replay 0', { replayTtlSeconds: 0 }],
  ];
  for (const [label, override] of refused) {
    it(`refuses ${label}`, () => {
      expect(() => assertIdempotencyConfig({ ...base, ...override })).toThrow(RangeError);
    });
  }

  it('accepts the bounds', () => {
    expect(() =>
      assertIdempotencyConfig({
        advisoryWaitMs: 1,
        businessLockTimeoutMs: 1,
        replayTtlSeconds: 1,
        dedupeTtlSeconds: 1,
      }),
    ).not.toThrow();
    expect(() =>
      assertIdempotencyConfig({
        advisoryWaitMs: 5000,
        businessLockTimeoutMs: 30000,
        replayTtlSeconds: 604800,
        dedupeTtlSeconds: 604800,
      }),
    ).not.toThrow();
  });
});
