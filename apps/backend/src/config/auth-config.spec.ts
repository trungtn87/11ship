import { createHmac, randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import { describe, expect, it } from '@jest/globals';
import { formatInvalidConfigMessage, loadConfig } from './app-config';
import { AUTH_OTP_HMAC_SECRET_BYTES, OtpHmacKey, parseOtpHmacSecret } from './auth-config';

const SECRET_BYTES = Buffer.alloc(32, 9);
const SECRET = SECRET_BYTES.toString('base64');
const DB = 'postgres://ship11_test:SECRET_MARKER_AUTH_CFG_41@127.0.0.1:5433/ship11_test';
const base = { APP_ENV: 'test', DATABASE_URL: DB };

function invalidOf(env: Record<string, string | undefined>): readonly string[] {
  const result = loadConfig(env);
  if (result.ok) {
    throw new Error('expected the configuration to be rejected');
  }
  return result.invalid;
}

function authOf(env: Record<string, string | undefined>) {
  const result = loadConfig(env);
  if (!result.ok) {
    throw new Error('expected the configuration to be accepted');
  }
  return result.config.auth;
}

describe('parseOtpHmacSecret', () => {
  it('accepts canonical base64 of exactly 32 bytes', () => {
    expect(parseOtpHmacSecret(SECRET)).toBeInstanceOf(OtpHmacKey);
    expect(AUTH_OTP_HMAC_SECRET_BYTES).toBe(32);
    expect(parseOtpHmacSecret(randomBytes(32).toString('base64'))).toBeDefined();
  });

  it('refuses every other length, alphabet, padding and non-canonical form', () => {
    const bad = [
      '',
      ' ',
      randomBytes(31).toString('base64'),
      randomBytes(33).toString('base64'),
      randomBytes(16).toString('base64'),
      randomBytes(64).toString('base64'),
      SECRET.slice(0, -1), // padding removed
      `${SECRET} `, // trailing space
      ` ${SECRET}`,
      SECRET.replace(/[A-Za-z0-9+/]/, '!'),
      SECRET_BYTES.toString('base64url'), // url alphabet / no padding
      `${SECRET.slice(0, 42)}B=`, // non-zero trailing bits (not canonical)
      'not base64 at all',
    ];
    for (const value of bad) {
      expect([value, parseOtpHmacSecret(value)]).toEqual([value, undefined]);
    }
    expect(parseOtpHmacSecret(undefined as unknown as string)).toBeUndefined();
  });
});

describe('OtpHmacKey', () => {
  it('computes HMAC-SHA-256 over the UTF-8 message as lowercase hex', () => {
    const key = new OtpHmacKey(SECRET_BYTES);
    expect(key.hmacSha256Hex('hello')).toBe(createHmac('sha256', SECRET_BYTES).update('hello', 'utf8').digest('hex'));
    expect(key.hmacSha256Hex('hello')).toMatch(/^[0-9a-f]{64}$/);
    expect(key.hmacSha256Hex('hello')).not.toBe(key.hmacSha256Hex('hellp'));
  });

  it('copies the key bytes: later mutation of the input cannot change it', () => {
    const bytes = Buffer.from(SECRET_BYTES);
    const key = new OtpHmacKey(bytes);
    const before = key.hmacSha256Hex('x');
    bytes.fill(0);
    expect(key.hmacSha256Hex('x')).toBe(before);
  });

  it('refuses a key that is not exactly 32 bytes', () => {
    expect(() => new OtpHmacKey(Buffer.alloc(31))).toThrow(RangeError);
    expect(() => new OtpHmacKey(Buffer.alloc(33))).toThrow(RangeError);
  });

  it('never reveals the key through JSON, String, template, inspect or Object.keys', () => {
    const key = new OtpHmacKey(SECRET_BYTES);
    const holder = { auth: { key } };
    const outputs = [
      JSON.stringify(holder),
      String(key),
      `${key}`,
      inspect(holder, { depth: 5, showHidden: true }),
      Object.keys(key).join(','),
      Object.getOwnPropertyNames(key).join(','),
    ].join('\n');
    expect(outputs).not.toContain(SECRET);
    expect(outputs).not.toContain(SECRET_BYTES.toString('hex'));
    expect(outputs).toContain('REDACTED');
  });
});

describe('loadConfig — Auth settings (task section 6)', () => {
  it('has no auth section without a secret, and the defaults when it is provided', () => {
    expect(authOf(base)).toBeUndefined();
    const auth = authOf({ ...base, AUTH_OTP_HMAC_SECRET: SECRET });
    expect(auth).toMatchObject({
      otpTtlSeconds: 300,
      otpResendSeconds: 60,
      otpMaxAttempts: 3,
      proofTtlSeconds: 600,
      sessionTtlSeconds: 604_800,
    });
    expect(auth?.otpHmacKey).toBeInstanceOf(OtpHmacKey);
  });

  it('accepts the exact bounds', () => {
    const auth = authOf({
      ...base,
      AUTH_OTP_HMAC_SECRET: SECRET,
      AUTH_OTP_TTL_SECONDS: '30',
      AUTH_OTP_RESEND_SECONDS: '300',
      AUTH_OTP_MAX_ATTEMPTS: '10',
      AUTH_PROOF_TTL_SECONDS: '1800',
      AUTH_SESSION_TTL_SECONDS: '300',
    });
    expect(auth).toMatchObject({
      otpTtlSeconds: 30,
      otpResendSeconds: 300,
      otpMaxAttempts: 10,
      proofTtlSeconds: 1800,
      sessionTtlSeconds: 300,
    });
    const upper = authOf({
      ...base,
      AUTH_OTP_HMAC_SECRET: SECRET,
      AUTH_OTP_TTL_SECONDS: '600',
      AUTH_OTP_RESEND_SECONDS: '1',
      AUTH_OTP_MAX_ATTEMPTS: '1',
      AUTH_PROOF_TTL_SECONDS: '60',
      AUTH_SESSION_TTL_SECONDS: '2592000',
    });
    expect(upper).toMatchObject({
      otpTtlSeconds: 600,
      otpResendSeconds: 1,
      otpMaxAttempts: 1,
      proofTtlSeconds: 60,
      sessionTtlSeconds: 2_592_000,
    });
  });

  const outOfBounds: ReadonlyArray<readonly [string, string[]]> = [
    ['AUTH_OTP_TTL_SECONDS', ['29', '601', '0', '-1', '1.5', 'abc', '']],
    ['AUTH_OTP_RESEND_SECONDS', ['0', '301', '-5', '1e2']],
    ['AUTH_OTP_MAX_ATTEMPTS', ['0', '11', '2.5']],
    ['AUTH_PROOF_TTL_SECONDS', ['59', '1801', 'x']],
    ['AUTH_SESSION_TTL_SECONDS', ['299', '2592001', '07x']],
  ];
  for (const [name, values] of outOfBounds) {
    it(`rejects ${name} outside its bounds, naming only the variable`, () => {
      for (const value of values) {
        const invalid = invalidOf({ ...base, AUTH_OTP_HMAC_SECRET: SECRET, [name]: value });
        expect([name, value, invalid]).toEqual([name, value, [name]]);
        expect(formatInvalidConfigMessage(invalid)).not.toContain(value === '' ? '\u0000' : value);
      }
    });
  }

  it('rejects a bad secret naming only AUTH_OTP_HMAC_SECRET and never echoing it', () => {
    for (const secret of ['', 'short', randomBytes(31).toString('base64'), randomBytes(33).toString('base64')]) {
      const invalid = invalidOf({ ...base, AUTH_OTP_HMAC_SECRET: secret });
      expect(invalid).toEqual(['AUTH_OTP_HMAC_SECRET']);
      expect(formatInvalidConfigMessage(invalid)).not.toContain(secret === '' ? '\u0000' : secret);
    }
  });

  it('reports every bad Auth variable at once, by name', () => {
    const invalid = invalidOf({
      ...base,
      AUTH_OTP_HMAC_SECRET: 'bad',
      AUTH_OTP_TTL_SECONDS: '1',
      AUTH_SESSION_TTL_SECONDS: '1',
    });
    expect([...invalid].sort()).toEqual(['AUTH_OTP_HMAC_SECRET', 'AUTH_OTP_TTL_SECONDS', 'AUTH_SESSION_TTL_SECONDS']);
  });

  it('validates the numeric Auth variables even when no secret is set (a typo is never silently ignored)', () => {
    expect(invalidOf({ ...base, AUTH_OTP_MAX_ATTEMPTS: '99' })).toEqual(['AUTH_OTP_MAX_ATTEMPTS']);
  });

  it('exposes no Argon2 variable: the parameters are constants, not configuration', () => {
    const auth = authOf({
      ...base,
      AUTH_OTP_HMAC_SECRET: SECRET,
      AUTH_ARGON2_MEMORY_COST: '8',
      ARGON2_MEMORY_COST: '8',
    });
    expect(Object.keys(auth ?? {}).join(',')).not.toMatch(/argon|memory|parallel/i);
  });
});
