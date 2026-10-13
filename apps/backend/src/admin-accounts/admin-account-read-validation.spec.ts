import { describe, expect, it } from '@jest/globals';
import { AppError } from '../common/app-errors';
import {
  decodeCursor,
  encodeCursor,
  escapeLike,
  FOLD_FROM,
  FOLD_TO,
  foldSearchText,
  parseAdministratorListQuery,
  parseNoQuery,
  parseUserId,
  parseUserListQuery,
  phoneSearchDigits,
} from './admin-account-read-validation';

const ID = '123e4567-e89b-42d3-a456-426614174000';

function invalid(run: () => unknown): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('ADMIN_INPUT_INVALID');
    return;
  }
  throw new Error('expected ADMIN_INPUT_INVALID');
}

describe('account read queries', () => {
  it('users: defaults, bounds and exact keys', () => {
    expect(parseUserListQuery({})).toEqual({ q: null, role: null, status: null, limit: 20, cursor: null });
    expect(parseUserListQuery(undefined).limit).toBe(20);
    expect(parseUserListQuery({ role: 'SHOP_OWNER', status: 'DISABLED', limit: '50', q: '  Nguyễn  ' })).toMatchObject({
      role: 'SHOP_OWNER',
      status: 'DISABLED',
      limit: 50,
      q: 'Nguyễn',
    });
    for (const query of [
      { limit: '0' },
      { limit: '51' },
      { limit: '05' },
      { limit: ' 5' },
      { role: 'SHOP' },
      { role: 'ADMIN' },
      { status: 'LOCKED' },
      { page: '1' },
      { q: ['a', 'b'] },
      { q: { a: '1' } },
      { cursor: 'abc' },
    ]) {
      invalid(() => parseUserListQuery(query));
    }
  });

  it('search: trimmed, empty means none, at most 120 code points, no control characters', () => {
    expect(parseUserListQuery({ q: '   ' }).q).toBeNull();
    expect(parseUserListQuery({ q: 'a'.repeat(120) }).q).toHaveLength(120);
    invalid(() => parseUserListQuery({ q: 'a'.repeat(121) }));
    expect(parseUserListQuery({ q: '😀'.repeat(120) }).q).not.toBeNull();
    invalid(() => parseUserListQuery({ q: '😀'.repeat(121) }));
    invalid(() => parseUserListQuery({ q: 'a\u0000b' }));
    invalid(() => parseUserListQuery({ q: 'a\nb' }));
  });

  it('administrators: only q, status, limit, cursor', () => {
    expect(parseAdministratorListQuery({ status: 'ACTIVE' })).toEqual({ q: null, status: 'ACTIVE', limit: 20, cursor: null });
    invalid(() => parseAdministratorListQuery({ role: 'DRIVER' }));
    invalid(() => parseAdministratorListQuery({ status: 'PENDING' }));
  });

  it('no-query routes and the id', () => {
    parseNoQuery(undefined);
    parseNoQuery({});
    invalid(() => parseNoQuery({ x: '1' }));
    expect(parseUserId(ID)).toBe(ID);
    invalid(() => parseUserId(ID.toUpperCase()));
    invalid(() => parseUserId('not-a-uuid'));
  });

  it('cursor: only the canonical server form round-trips', () => {
    const cursor = { createdAtUs: '2026-10-13T01:02:03.123456Z', userId: ID, keyId: 'k1', binding: 'a'.repeat(64) };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(parseUserListQuery({ cursor: encodeCursor(cursor) }).cursor).toEqual(cursor);
    const forge = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
    invalid(() => decodeCursor(forge(['2026-10-13T01:02:03.123Z', ID, 'k1', 'a'.repeat(64)])));
    invalid(() => decodeCursor(forge(['2026-10-13T01:02:03.123456Z', ID.toUpperCase(), 'k1', 'a'.repeat(64)])));
    invalid(() => decodeCursor(forge(['2026-10-13T01:02:03.123456Z', ID, 'k1', 'A'.repeat(64)])));
    invalid(() => decodeCursor(forge(['2026-10-13T01:02:03.123456Z', ID, 'k1'])));
    invalid(() => decodeCursor('+0912345678'));
    invalid(() => decodeCursor('a'.repeat(601)));
  });
});

describe('Vietnamese-insensitive search', () => {
  it('translate() tables have equal length and fold both cases to ASCII', () => {
    expect(FOLD_FROM).toHaveLength(FOLD_TO.length);
    expect(FOLD_TO).toMatch(/^[a-z]+$/);
    expect(foldSearchText('Nguyễn Văn Đạt')).toBe('nguyen van dat');
    expect(foldSearchText('ĐẶNG THỊ Ánh')).toBe('dang thi anh');
    // A decomposed query (letter + combining mark) meets the same stored text.
    expect(foldSearchText('Nguyễn')).toBe('nguyen');
  });

  it('LIKE wildcards are literal', () => {
    expect(escapeLike('50%_off!')).toBe('50!%!_off!!');
    expect(escapeLike('abc')).toBe('abc');
  });

  it('phone-looking searches become the digits after "+"', () => {
    expect(phoneSearchDigits('0912 345 678')).toBe('84912345678');
    expect(phoneSearchDigits('+84912345678')).toBe('84912345678');
    expect(phoneSearchDigits('678')).toBe('678');
    expect(phoneSearchDigits('09')).toBeNull();
    expect(phoneSearchDigits('Nguyễn')).toBeNull();
    expect(phoneSearchDigits('09a12')).toBeNull();
  });
});
