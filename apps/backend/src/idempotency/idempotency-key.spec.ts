import { describe, expect, it } from '@jest/globals';
import { AppError } from '../common/app-errors';
import { NIL_UUID, parseIdempotencyKey } from './idempotency-key';

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) {
      return error.code;
    }
    throw error;
  }
  throw new Error('expected an AppError');
}

const CANONICAL = '3f2b8c1e-9d4a-4b6f-8a21-5c7e0d9f1a34';

describe('parseIdempotencyKey (ADR-003 §3.1)', () => {
  it('accepts a canonical lowercase UUID and returns it unchanged', () => {
    expect(parseIdempotencyKey(CANONICAL)).toBe(CANONICAL);
  });

  it('normalizes the hex digits to lowercase', () => {
    expect(parseIdempotencyKey(CANONICAL.toUpperCase())).toBe(CANONICAL);
    expect(parseIdempotencyKey('3F2B8c1E-9D4a-4B6f-8A21-5C7e0D9f1A34')).toBe(CANONICAL);
  });

  it('does not require a particular UUID version or variant (v4 is only a recommendation)', () => {
    expect(parseIdempotencyKey('00000000-0000-1000-8000-000000000001')).toBe(
      '00000000-0000-1000-8000-000000000001',
    );
    expect(parseIdempotencyKey('ffffffff-ffff-ffff-ffff-ffffffffffff')).toBe(
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
    );
  });

  it('answers IDEMPOTENCY_KEY_REQUIRED when the header is missing', () => {
    expect(codeOf(() => parseIdempotencyKey(undefined))).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(codeOf(() => parseIdempotencyKey(null))).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(codeOf(() => parseIdempotencyKey([]))).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('rejects the nil UUID', () => {
    expect(codeOf(() => parseIdempotencyKey(NIL_UUID))).toBe('INVALID_IDEMPOTENCY_KEY');
    expect(NIL_UUID).toBe('00000000-0000-0000-0000-000000000000');
  });

  const malformed: ReadonlyArray<readonly [string, string]> = [
    ['empty string', ''],
    ['not a uuid', 'not-a-uuid'],
    ['no hyphens (32 hex)', CANONICAL.replace(/-/g, '')],
    ['braces', `{${CANONICAL}}`],
    ['urn prefix', `urn:uuid:${CANONICAL}`],
    ['leading space', ` ${CANONICAL}`],
    ['trailing space', `${CANONICAL} `],
    ['trailing newline', `${CANONICAL}\n`],
    ['too short', CANONICAL.slice(0, 35)],
    ['too long', `${CANONICAL}0`],
    ['non-hex digit', CANONICAL.replace('3f2b', '3g2b')],
    ['misplaced hyphen', '3f2b8c1e9-d4a-4b6f-8a21-5c7e0d9f1a34'],
    ['non-ASCII digit', `${CANONICAL.slice(0, 35)}٣`],
  ];
  for (const [label, value] of malformed) {
    it(`rejects ${label} as INVALID_IDEMPOTENCY_KEY`, () => {
      expect(codeOf(() => parseIdempotencyKey(value))).toBe('INVALID_IDEMPOTENCY_KEY');
    });
  }

  it('rejects a header sent more than once rather than choosing one', () => {
    expect(codeOf(() => parseIdempotencyKey([CANONICAL, CANONICAL]))).toBe(
      'INVALID_IDEMPOTENCY_KEY',
    );
  });

  it('accepts a single-element header array', () => {
    expect(parseIdempotencyKey([CANONICAL.toUpperCase()])).toBe(CANONICAL);
  });

  it('never echoes the offending value in the error', () => {
    const secret = 'SECRET_MARKER_KEY_91ac';
    try {
      parseIdempotencyKey(secret);
    } catch (error) {
      expect(error instanceof AppError).toBe(true);
      expect(String((error as Error).message)).not.toContain(secret);
      return;
    }
    throw new Error('expected an error');
  });
});
