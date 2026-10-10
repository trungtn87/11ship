import { describe, expect, it } from '@jest/globals';
import { AppError } from '../common/app-errors';
import {
  declaredBodyTooLarge,
  isJsonContentType,
  parseEmptyBody,
  parseOtpCodeBody,
  parsePasswordBody,
  parseStartBody,
  parseTotpCodeBody,
  serializedBodyTooLarge,
} from './admin-activation-validation';

const TOKEN = 'A'.repeat(43);

function code(work: () => unknown): string | undefined {
  try {
    work();
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.code : 'OTHER';
  }
}

describe('activation body parsers (every failure is the same ADMIN_INPUT_INVALID)', () => {
  it('start: exactly {token} with a canonical 43-character token', () => {
    expect(parseStartBody({ token: TOKEN })).toBe(TOKEN);
    for (const bad of [{}, { token: TOKEN, extra: 1 }, { token: 'short' }, { token: `${TOKEN}=` }, { token: 5 }, null, [], 'x', { tokens: TOKEN }]) {
      expect(code(() => parseStartBody(bad))).toBe('ADMIN_INPUT_INVALID');
    }
    // a 43-char value whose trailing bits are not zero is not a canonical 32-byte token
    expect(code(() => parseStartBody({ token: `${'A'.repeat(42)}B` }))).toBe('ADMIN_INPUT_INVALID');
  });

  it('otp / totp code: exactly {code} of six ASCII digits, never trimmed', () => {
    expect(parseOtpCodeBody({ code: '012345' })).toBe('012345');
    expect(parseTotpCodeBody({ code: '999999' })).toBe('999999');
    for (const bad of [{ code: '12345' }, { code: '1234567' }, { code: ' 12345' }, { code: '12345a' }, { code: 123456 }, { code: '123456', x: 1 }, {}]) {
      expect(code(() => parseOtpCodeBody(bad))).toBe('ADMIN_INPUT_INVALID');
      expect(code(() => parseTotpCodeBody(bad))).toBe('ADMIN_INPUT_INVALID');
    }
  });

  it('password: exactly {password}, the existing registration policy, never echoed', () => {
    expect(parsePasswordBody({ password: 'correct horse battery' })).toBe('correct horse battery');
    for (const bad of [{ password: 'short' }, { password: 'x'.repeat(129) }, { password: 'a\ud800bcdefgh' }, { password: 5 }, {}, { password: 'long enough pw', extra: true }]) {
      expect(code(() => parsePasswordBody(bad))).toBe('ADMIN_INPUT_INVALID');
    }
  });

  it('empty bodies: only {}', () => {
    expect(code(() => parseEmptyBody({}))).toBeUndefined();
    for (const bad of [{ a: 1 }, null, [], 'x']) {
      expect(code(() => parseEmptyBody(bad))).toBe('ADMIN_INPUT_INVALID');
    }
  });
});

describe('transport helpers', () => {
  it('accepts application/json with optional parameters only', () => {
    expect(isJsonContentType('application/json')).toBe(true);
    expect(isJsonContentType('application/json; charset=utf-8')).toBe(true);
    for (const bad of [undefined, 'text/plain', 'application/jsonp', 'application/json-patch+json', ['application/json']]) {
      expect(isJsonContentType(bad)).toBe(false);
    }
  });

  it('caps the body at 4 KiB by declared length and by measured size', () => {
    expect(declaredBodyTooLarge('4096')).toBe(false);
    expect(declaredBodyTooLarge('4097')).toBe(true);
    expect(declaredBodyTooLarge('-1')).toBe(true);
    expect(declaredBodyTooLarge('abc')).toBe(true);
    expect(declaredBodyTooLarge(undefined)).toBe(false);
    expect(serializedBodyTooLarge({ a: 'x'.repeat(4000) })).toBe(false);
    expect(serializedBodyTooLarge({ a: 'x'.repeat(4100) })).toBe(true);
    expect(serializedBodyTooLarge(undefined)).toBe(false);
  });
});
