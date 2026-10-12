import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from '@jest/globals';
import { parseCustomerProfileUpdateBody, rejectBodyAndQuery, rejectQuery } from './customer-profile-validation';

describe('parseCustomerProfileUpdateBody', () => {
  it('returns the normalized name and the expected version', () => {
    expect(parseCustomerProfileUpdateBody({ full_name: '  Nguyễn   Văn  An ', expected_version: 3 })).toEqual({
      fullName: 'Nguyễn Văn An',
      expectedVersion: 3,
    });
    expect(parseCustomerProfileUpdateBody({ expected_version: Number.MAX_SAFE_INTEGER, full_name: 'A' }).expectedVersion).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it('accepts exactly the two keys: a missing key, an extra key or an identity selector is a malformed body', () => {
    for (const body of [
      {},
      { full_name: 'An' },
      { expected_version: 1 },
      { full_name: 'An', expected_version: 1, user_id: '00000000-0000-4000-8000-000000000001' },
      { full_name: 'An', expected_version: 1, driver_id: 'x' },
      { full_name: 'An', expected_version: 1, version: 1 },
      [],
      null,
      'full_name',
    ]) {
      expect(() => parseCustomerProfileUpdateBody(body)).toThrow(BadRequestException);
    }
  });

  it('expected_version is a positive safe integer', () => {
    for (const version of [0, -1, 1.5, 2 ** 53, '1', null, true, {}, [1]]) {
      expect(() => parseCustomerProfileUpdateBody({ full_name: 'An', expected_version: version })).toThrow(BadRequestException);
    }
  });

  it('refuses a name the registration rules refuse (empty, zero width, control, over 120 code points)', () => {
    for (const name of ['', '   ', 'a​b', 'a\u0007', 'a'.repeat(121), 5, null]) {
      expect(() => parseCustomerProfileUpdateBody({ full_name: name, expected_version: 1 })).toThrow(BadRequestException);
    }
  });
});

describe('rejectQuery and rejectBodyAndQuery', () => {
  it('accepts an empty query and refuses any parameter, even a harmless-looking one', () => {
    expect(() => rejectQuery({})).not.toThrow();
    expect(() => rejectQuery(undefined)).not.toThrow();
    for (const query of [{ user_id: 'x' }, { driver_id: 'x' }, { a: '' }, 'user_id=x', null]) {
      expect(() => rejectQuery(query)).toThrow(BadRequestException);
    }
  });

  it('refuses a body on a GET by its framing headers, even an empty JSON object', () => {
    expect(() => rejectBodyAndQuery({ headers: {} }, {})).not.toThrow();
    expect(() => rejectBodyAndQuery({ headers: { 'content-length': '0' } }, {})).not.toThrow();
    expect(() => rejectBodyAndQuery({ headers: { 'content-length': '2' } }, {})).toThrow(BadRequestException);
    expect(() => rejectBodyAndQuery({ headers: { 'transfer-encoding': 'chunked' } }, {})).toThrow(BadRequestException);
    expect(() => rejectBodyAndQuery({ headers: {} }, { user_id: 'x' })).toThrow(BadRequestException);
  });
});
