import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';
import { digestToken, generateToken, parseCanonicalToken } from './tokens';

describe('generateToken', () => {
  it('returns 32 random bytes as 43 base64url characters and the SHA-256 hex of the TEXT', () => {
    const { token, digest } = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(digest).toBe(createHash('sha256').update(token, 'utf8').digest('hex'));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain(token);
  });

  it('uses the injected random source and refuses a short one', () => {
    const fixed = Buffer.alloc(32, 1);
    expect(generateToken(() => fixed).token).toBe(fixed.toString('base64url'));
    expect(() => generateToken(() => Buffer.alloc(31))).toThrow(RangeError);
    expect(() => generateToken(() => Buffer.alloc(0))).toThrow(RangeError);
  });

  it('produces distinct tokens', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateToken().token));
    expect(seen.size).toBe(200);
  });
});

describe('parseCanonicalToken', () => {
  it('accepts a canonical token', () => {
    const { token } = generateToken();
    expect(parseCanonicalToken(token)).toBe(token);
  });

  it('refuses every non-canonical shape', () => {
    const { token } = generateToken();
    // The last of 43 characters carries 2 data bits and 4 unused bits; 'B' has non-zero unused bits.
    const nonCanonicalTail = `${token.slice(0, 42)}B`;
    const bad = [
      '',
      token.slice(1),
      `${token}A`,
      `${token}=`,
      ` ${token}`,
      `${token} `,
      token.replace(/./, '+'),
      token.replace(/./, '/'),
      token.replace(/./, '!'),
      randomBytes(32).toString('base64'),
      randomBytes(31).toString('base64url'),
      randomBytes(33).toString('base64url'),
    ];
    for (const value of bad) {
      expect([value, parseCanonicalToken(value)]).toEqual([value, undefined]);
    }
    // A 43-character string whose last character carries non-zero unused bits is not what we issue.
    expect(parseCanonicalToken(nonCanonicalTail)).toBeUndefined();
    for (const value of [undefined, null, 1, {}, []]) {
      expect(parseCanonicalToken(value)).toBeUndefined();
    }
  });
});

describe('digestToken', () => {
  it('is deterministic SHA-256 hex', () => {
    expect(digestToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
