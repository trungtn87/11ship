import { describe, expect, it } from '@jest/globals';
import { safeErrorClass, safeErrorCode } from './safe-error';

describe('safeErrorCode', () => {
  it('returns short allow-listed driver and system codes', () => {
    expect(safeErrorCode(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe(
      'ECONNREFUSED',
    );
    expect(safeErrorCode({ code: '57P01' })).toBe('57P01');
  });

  it('names TLS verification failures by their fixed identifier and nothing else (M00-D1)', () => {
    for (const code of [
      'SELF_SIGNED_CERT_IN_CHAIN',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'CERT_HAS_EXPIRED',
      'ERR_TLS_CERT_ALTNAME_INVALID',
    ]) {
      expect(safeErrorCode(Object.assign(new Error('Hostname/IP does not match'), { code }))).toBe(code);
    }
    // A look-alike that is not on the list stays hidden.
    expect(safeErrorCode({ code: 'ERR_TLS_CERT_SECRET_MARKER' })).toBe('UNKNOWN');
  });

  it('accepts only real SQLSTATE classes, system codes and registry codes', () => {
    expect(safeErrorCode({ code: '40001' })).toBe('40001');
    expect(safeErrorCode({ code: 'IDEMPOTENCY_BUSY' })).toBe('IDEMPOTENCY_BUSY');
    // Right shape, but not a class PostgreSQL defines.
    expect(safeErrorCode({ code: 'ZZ999' })).toBe('UNKNOWN');
    // Looks like a code but is not on any allow-list.
    expect(safeErrorCode({ code: 'SECRET_MARKER_CODE' })).toBe('UNKNOWN');
    expect(safeErrorCode({ code: 'ECUSTOM' })).toBe('UNKNOWN');
  });

  it('refuses codes that look like free text and anything that is not an object', () => {
    expect(safeErrorCode({ code: 'password=SECRET' })).toBe('UNKNOWN');
    expect(safeErrorCode({ code: 'x'.repeat(33) })).toBe('UNKNOWN');
    expect(safeErrorCode({ code: 123 })).toBe('UNKNOWN');
    expect(safeErrorCode(new Error('no code'))).toBe('UNKNOWN');
    expect(safeErrorCode('string')).toBe('UNKNOWN');
    expect(safeErrorCode(null)).toBe('UNKNOWN');
  });
});

describe('safeErrorClass', () => {
  it('returns the constructor name for allow-listed Error classes only', () => {
    class CustomFailure extends Error {}
    expect(safeErrorClass(new Error('x'))).toBe('Error');
    expect(safeErrorClass(new TypeError('x'))).toBe('TypeError');
    expect(safeErrorClass(new CustomFailure('x'))).toBe('UnknownError');
    expect(safeErrorClass('SECRET')).toBe('UnknownError');
    expect(safeErrorClass({ constructor: { name: 'Fake' } })).toBe('UnknownError');
  });
});
