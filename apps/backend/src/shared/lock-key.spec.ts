import { describe, expect, it } from '@jest/globals';
import { deriveLockKey, idempotencyLockKey } from './lock-key';

describe('advisory lock key derivation — known answers (C25)', () => {
  it('matches independently computed vectors for the idempotency tuple', () => {
    // sha256 of the canonical JSON array ["11ship.idempotency.lock.v1", ...], bytes 0..3 and 4..7
    // read as signed big-endian int32.
    expect(
      idempotencyLockKey('user', 'u-1', 'auth.register.v1', '11111111-2222-4333-8444-555555555555'),
    ).toEqual([1961934786, 190798094]);
    expect(
      idempotencyLockKey(
        'verification_proof',
        'p-1',
        'auth.register.v1',
        'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      ),
    ).toEqual([-385244099, 1973965183]);
    expect(idempotencyLockKey('scópe', '\u{1F600}', 'op', 'k')).toEqual([1714706475, -456687616]);
  });

  it('is deterministic and always yields two int32 integers', () => {
    const first = idempotencyLockKey('a', 'b', 'c', 'd');
    const second = idempotencyLockKey('a', 'b', 'c', 'd');
    expect(first).toEqual(second);
    for (let index = 0; index < 200; index += 1) {
      const [high, low] = idempotencyLockKey('s', String(index), 'op', `key-${index}`);
      for (const part of [high, low]) {
        expect(Number.isInteger(part)).toBe(true);
        expect(part).toBeGreaterThanOrEqual(-(2 ** 31));
        expect(part).toBeLessThanOrEqual(2 ** 31 - 1);
      }
    }
  });

  it('keeps tuple boundaries unambiguous and order-sensitive', () => {
    expect(idempotencyLockKey('a', 'bc', 'd', 'e')).not.toEqual(idempotencyLockKey('ab', 'c', 'd', 'e'));
    expect(idempotencyLockKey('a', 'b', 'c', 'd')).not.toEqual(idempotencyLockKey('b', 'a', 'c', 'd'));
    expect(idempotencyLockKey('a', 'b', 'c', 'd')).not.toEqual(idempotencyLockKey('a', 'b', 'c', 'D'));
  });

  it('separates domains', () => {
    expect(deriveLockKey('domain.one', ['x'])).not.toEqual(deriveLockKey('domain.two', ['x']));
  });

  it('rejects non-string parts', () => {
    expect(() => deriveLockKey('d', [1 as unknown as string])).toThrow(TypeError);
  });
});
