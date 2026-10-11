import { describe, expect, it } from '@jest/globals';
import { base32Decode, base32Encode } from './base32';
import { buildOtpauthUri, hotp, isTotpCodeShape, matchTotp, stepAt } from './totp';

const SECRET = Buffer.from('12345678901234567890', 'ascii');

describe('HOTP (RFC 4226 appendix D)', () => {
  it.each([
    [0, '755224'],
    [1, '287082'],
    [2, '359152'],
    [3, '969429'],
    [4, '338314'],
    [5, '254676'],
    [6, '287922'],
    [7, '162583'],
    [8, '399871'],
    [9, '520489'],
  ])('counter %i -> %s', (counter, expected) => {
    expect(hotp(SECRET, counter)).toBe(expected);
  });

  it('rejects an invalid counter', () => {
    expect(() => hotp(SECRET, -1)).toThrow(RangeError);
    expect(() => hotp(SECRET, 1.5)).toThrow(RangeError);
  });
});

describe('TOTP (RFC 6238 SHA-1 vectors, last 6 of the 8-digit values)', () => {
  it.each([
    [59, '287082'],
    [1111111109, '081804'], // leading zero
    [1111111111, '050471'], // leading zero
    [1234567890, '005924'], // two leading zeros
    [2000000000, '279037'],
    [20000000000, '353130'],
  ])('time %i -> %s', (time, expected) => {
    expect(hotp(SECRET, stepAt(time))).toBe(expected);
    expect(matchTotp(SECRET, expected, time, null)).toBe(stepAt(time));
  });
});

describe('matchTotp window and replay', () => {
  const now = 1234567890;
  const current = hotp(SECRET, stepAt(now));
  const previous = hotp(SECRET, stepAt(now) - 1);
  const next = hotp(SECRET, stepAt(now) + 1);
  const older = hotp(SECRET, stepAt(now) - 2);

  it('accepts the current and the previous step only', () => {
    expect(matchTotp(SECRET, current, now, null)).toBe(stepAt(now));
    expect(matchTotp(SECRET, previous, now, null)).toBe(stepAt(now) - 1);
    expect(matchTotp(SECRET, next, now, null)).toBeUndefined();
    expect(matchTotp(SECRET, older, now, null)).toBeUndefined();
  });

  it('never accepts a step that is not greater than the last accepted one', () => {
    const step = stepAt(now);
    expect(matchTotp(SECRET, current, now, step)).toBeUndefined(); // replay
    expect(matchTotp(SECRET, previous, now, step)).toBeUndefined(); // going backwards
    expect(matchTotp(SECRET, current, now, step - 1)).toBe(step);
    expect(matchTotp(SECRET, previous, now, step - 2)).toBe(step - 1);
  });

  it('refuses malformed codes without trimming or repairing them', () => {
    for (const bad of [` ${current}`, `${current} `, current.slice(1), `${current}0`, 'abcdef', '', '００００００']) {
      expect(matchTotp(SECRET, bad, now, null)).toBeUndefined();
    }
    expect(isTotpCodeShape(current)).toBe(true);
    expect(isTotpCodeShape(123456)).toBe(false);
  });

  it('does not go below step zero', () => {
    expect(matchTotp(SECRET, hotp(SECRET, 0), 10, null)).toBe(0);
  });
});

describe('Base32', () => {
  it('encodes the RFC 4648 vectors without padding', () => {
    expect(base32Encode(Buffer.from(''))).toBe('');
    expect(base32Encode(Buffer.from('f'))).toBe('MY');
    expect(base32Encode(Buffer.from('fo'))).toBe('MZXQ');
    expect(base32Encode(Buffer.from('foo'))).toBe('MZXW6');
    expect(base32Encode(Buffer.from('foob'))).toBe('MZXW6YQ');
    expect(base32Encode(Buffer.from('fooba'))).toBe('MZXW6YTB');
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  });

  it('encodes the 20-byte secret as 32 characters and round-trips', () => {
    const text = base32Encode(SECRET);
    expect(text).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(text)?.equals(SECRET)).toBe(true);
  });

  it('refuses non-canonical text', () => {
    for (const bad of ['mzxw6', 'MZXW6===', 'MZXW 6', 'MZXW1', 'MZ', 'M']) {
      expect(base32Decode(bad)).toBeUndefined();
    }
  });
});

describe('otpauth URI', () => {
  it('carries issuer, label, secret and the fixed algorithm, digits and period', () => {
    const uri = buildOtpauthUri({ issuer: '11ship', label: '+84900000001', secretBase32: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' });
    expect(uri).toBe(
      'otpauth://totp/11ship:%2B84900000001?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=11ship&algorithm=SHA1&digits=6&period=30',
    );
  });
});
