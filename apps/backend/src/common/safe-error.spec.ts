import { describe, expect, it } from '@jest/globals';
import { safeErrorClass, safeErrorCode } from './safe-error';

describe('safeErrorCode', () => {
  it('returns short allow-listed driver and system codes', () => {
    expect(safeErrorCode(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe(
      'ECONNREFUSED',
    );
    expect(safeErrorCode({ code: '57P01' })).toBe('57P01');
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
  it('returns the constructor name for Error instances only', () => {
    class CustomFailure extends Error {}
    expect(safeErrorClass(new Error('x'))).toBe('Error');
    expect(safeErrorClass(new CustomFailure('x'))).toBe('CustomFailure');
    expect(safeErrorClass('SECRET')).toBe('UnknownError');
    expect(safeErrorClass({ constructor: { name: 'Fake' } })).toBe('UnknownError');
  });
});
