import { describe, expect, it } from '@jest/globals';
import { IdempotencyOperationRegistry } from './idempotency-operation-registry';

describe('IdempotencyOperationRegistry', () => {
  const fallback = { replayTtlSeconds: 900, dedupeTtlSeconds: 604800 };

  it('uses immutable server-owned override by operation id', () => {
    const registry = new IdempotencyOperationRegistry([
      { operationId: 'fixture.short.v1', replayTtlSeconds: 5, dedupeTtlSeconds: 60 },
    ]);
    expect(registry.resolve('fixture.short.v1', fallback)).toEqual({
      replayTtlSeconds: 5,
      dedupeTtlSeconds: 60,
    });
    expect(registry.resolve('fixture.default.v1', fallback)).toBe(fallback);
  });

  it.each([
    [{ operationId: '', replayTtlSeconds: 1, dedupeTtlSeconds: 1 }],
    [{ operationId: 'x', replayTtlSeconds: 0, dedupeTtlSeconds: 1 }],
    [{ operationId: 'x', replayTtlSeconds: 2, dedupeTtlSeconds: 1 }],
    [{ operationId: 'x', replayTtlSeconds: 1, dedupeTtlSeconds: 604801 }],
  ])('rejects invalid policy %p', (entry) => {
    expect(() => new IdempotencyOperationRegistry(entry)).toThrow(RangeError);
  });

  it('rejects duplicate operation ids', () => {
    expect(
      () =>
        new IdempotencyOperationRegistry([
          { operationId: 'fixture.v1', replayTtlSeconds: 1, dedupeTtlSeconds: 2 },
          { operationId: 'fixture.v1', replayTtlSeconds: 2, dedupeTtlSeconds: 3 },
        ]),
    ).toThrow(RangeError);
  });
});
