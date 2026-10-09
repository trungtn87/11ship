import { describe, expect, it } from '@jest/globals';
import { CryptoError } from './crypto-error';
import { fixtureKeyring } from './test-keys.fixture';

const USER = '123e4567-e89b-42d3-a456-426614174000';
const FACTOR = '223e4567-e89b-42d3-a456-426614174000';
const BINDING = { userId: USER, factorId: FACTOR, factorVersion: 1 };
const NONCE = Buffer.alloc(32, 7);

describe('administration password binding', () => {
  const key = fixtureKeyring('k1').active();

  it('is a stable lowercase-hex digest that changes with the user or the password hash', () => {
    const a = key.adminPasswordBinding(USER, '$argon2id$one');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(key.adminPasswordBinding(USER, '$argon2id$one')).toBe(a);
    expect(key.adminPasswordBinding(USER, '$argon2id$two')).not.toBe(a);
    expect(key.adminPasswordBinding(FACTOR, '$argon2id$one')).not.toBe(a);
  });

  it('differs per key version and never contains the password hash', () => {
    const k2 = fixtureKeyring('k2').active();
    expect(k2.adminPasswordBinding(USER, '$argon2id$one')).not.toBe(key.adminPasswordBinding(USER, '$argon2id$one'));
    expect(key.adminPasswordBinding(USER, '$argon2id$one')).not.toContain('argon2id');
  });
});

describe('administration CSRF token', () => {
  const key = fixtureKeyring('k1').active();

  it('is deterministic base64url of 32 bytes and bound to type, credential and nonce', () => {
    const token = key.adminCsrfToken('SESSION', FACTOR, NONCE);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(key.adminCsrfToken('SESSION', FACTOR, NONCE)).toBe(token);
    expect(key.adminCsrfToken('PREAUTH', FACTOR, NONCE)).not.toBe(token);
    expect(key.adminCsrfToken('SESSION', USER, NONCE)).not.toBe(token);
    expect(key.adminCsrfToken('SESSION', FACTOR, Buffer.alloc(32, 8))).not.toBe(token);
  });

  it('is not the password-binding derivation and differs per key version', () => {
    expect(key.adminCsrfToken('SESSION', FACTOR, NONCE)).not.toBe(fixtureKeyring('k2').active().adminCsrfToken('SESSION', FACTOR, NONCE));
  });

  it('refuses a malformed nonce or type with a CryptoError', () => {
    expect(() => key.adminCsrfToken('SESSION', FACTOR, Buffer.alloc(31))).toThrow(CryptoError);
    expect(() => key.adminCsrfToken('OTHER' as 'SESSION', FACTOR, NONCE)).toThrow(CryptoError);
  });
});

describe('administration TOTP secret sealing', () => {
  const secret = Buffer.from('12345678901234567890');

  it('round-trips, never leaves the secret in the ciphertext and uses a fresh IV', () => {
    const key = fixtureKeyring('k1').active();
    const one = key.sealAdminTotpSecret(BINDING, secret);
    const two = key.sealAdminTotpSecret(BINDING, secret);
    expect(key.openAdminTotpSecret(BINDING, one).equals(secret)).toBe(true);
    expect(one.ciphertext.includes(secret)).toBe(false);
    expect(one.iv.equals(two.iv)).toBe(false);
  });

  it.each([
    ['user', { ...BINDING, userId: FACTOR }],
    ['factor id', { ...BINDING, factorId: USER }],
    ['factor version', { ...BINDING, factorVersion: 2 }],
  ])('fails closed when the %s differs (associated data)', (_name, other) => {
    const key = fixtureKeyring('k1').active();
    const sealed = key.sealAdminTotpSecret(BINDING, secret);
    expect(() => key.openAdminTotpSecret(other, sealed)).toThrow(CryptoError);
  });

  it('fails closed on a corrupt ciphertext, tag or iv, and under a different key version', () => {
    const key = fixtureKeyring('k1').active();
    const sealed = key.sealAdminTotpSecret(BINDING, secret);
    const flip = (buffer: Buffer): Buffer => {
      const copy = Buffer.from(buffer);
      copy[0] = (copy[0] as number) ^ 1;
      return copy;
    };
    expect(() => key.openAdminTotpSecret(BINDING, { ...sealed, ciphertext: flip(sealed.ciphertext) })).toThrow(CryptoError);
    expect(() => key.openAdminTotpSecret(BINDING, { ...sealed, tag: flip(sealed.tag) })).toThrow(CryptoError);
    expect(() => key.openAdminTotpSecret(BINDING, { ...sealed, iv: flip(sealed.iv) })).toThrow(CryptoError);
    expect(() => key.openAdminTotpSecret(BINDING, { ...sealed, iv: Buffer.alloc(8) })).toThrow(CryptoError);
    expect(() => fixtureKeyring('k2').active().openAdminTotpSecret(BINDING, sealed)).toThrow(CryptoError);
  });

  it('turns an RNG failure into a CryptoError', () => {
    const key = fixtureKeyring('k1', {
      randomBytes: () => {
        throw new Error('rng down');
      },
    }).active();
    expect(() => key.sealAdminTotpSecret(BINDING, secret)).toThrow(CryptoError);
  });
});
