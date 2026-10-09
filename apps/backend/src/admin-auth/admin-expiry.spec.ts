import { describe, expect, it } from '@jest/globals';
import { isExpiredAt } from './admin-expiry';

describe('isExpiredAt', () => {
  it('is false strictly before the expiry instant', () => {
    expect(isExpiredAt(1_000, 999)).toBe(false);
    expect(isExpiredAt(1_000, 0)).toBe(false);
  });

  it('is true at the expiry instant (equality counts as expired) and after it', () => {
    expect(isExpiredAt(1_000, 1_000)).toBe(true);
    expect(isExpiredAt(1_000, 1_001)).toBe(true);
    expect(isExpiredAt(1_000, Number.MAX_SAFE_INTEGER)).toBe(true);
  });
});
