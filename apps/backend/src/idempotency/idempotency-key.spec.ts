import { describe, expect, it } from '@jest/globals';
import { normalizeIdempotencyKey } from './idempotency-key';

describe('normalizeIdempotencyKey', () => {
  it('accepts canonical UUID text and normalizes hex to lowercase', () => {
    expect(normalizeIdempotencyKey('550E8400-E29B-41D4-A716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000',
    );
  });

  it.each([undefined, null, ''])('requires a key for %p', (value) => {
    expect(() => normalizeIdempotencyKey(value)).toThrow(
      expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REQUIRED' }),
    );
  });

  it.each([
    '00000000-0000-0000-0000-000000000000',
    '550e8400e29b41d4a716446655440000',
    ' 550e8400-e29b-41d4-a716-446655440000',
    '550e8400-e29b-41d4-a716-44665544000z',
    123,
  ])('rejects invalid key %p', (value) => {
    expect(() => normalizeIdempotencyKey(value)).toThrow(
      expect.objectContaining({ code: 'INVALID_IDEMPOTENCY_KEY' }),
    );
  });
});
