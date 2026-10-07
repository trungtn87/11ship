import { describe, expect, it } from '@jest/globals';
import { CryptoError } from './crypto-error';
import { Keyring, parseKeyringConfig } from './keyring';
import {
  FIXTURE_K1_BASE64,
  FIXTURE_K2_BASE64,
  FIXTURE_KEYRING_ENV,
  FIXTURE_MASTER_K1,
  FIXTURE_MASTER_K2,
  fixtureKeyring,
} from './test-keys.fixture';

function reasonOf(build: () => unknown): string {
  try {
    build();
  } catch (error) {
    if (error instanceof CryptoError) {
      return error.reason;
    }
    throw error;
  }
  throw new Error('expected a CryptoError');
}

describe('Keyring', () => {
  it('exposes the active version and historical versions by id', () => {
    const keyring = fixtureKeyring('k2');
    expect(keyring.activeKeyId).toBe('k2');
    expect(keyring.active().id).toBe('k2');
    expect(keyring.version('k1')?.id).toBe('k1');
    expect(keyring.version('missing')).toBeUndefined();
    expect(keyring.has('k1')).toBe(true);
    expect(keyring.keyIds()).toEqual(['k1', 'k2']);
  });

  it('is immutable: frozen, and every lookup returns the same handle', () => {
    const keyring = fixtureKeyring();
    expect(Object.isFrozen(keyring)).toBe(true);
    expect(Object.isFrozen(keyring.active())).toBe(true);
    expect(keyring.version('k1')).toBe(keyring.version('k1'));
    expect(keyring.active()).toBe(keyring.version('k1'));
    expect(() => {
      (keyring as unknown as { activeKeyId: string }).activeKeyId = 'k2';
    }).toThrow(TypeError);
  });

  it('never exposes master or sub-key material', () => {
    const keyring = fixtureKeyring();
    const exposed = JSON.stringify([keyring, keyring.active(), Object.getOwnPropertyNames(keyring)]);
    expect(exposed).not.toContain(FIXTURE_K1_BASE64);
    expect(exposed).not.toContain(FIXTURE_MASTER_K1.toString('hex'));
    expect(Object.getOwnPropertyNames(keyring.active()).sort()).toEqual(['id']);
  });

  it('rejects an invalid construction with a fixed reason', () => {
    const k1 = { id: 'k1', master: FIXTURE_MASTER_K1 };
    expect(reasonOf(() => new Keyring([], 'k1'))).toBe('invalid_keyring');
    expect(reasonOf(() => new Keyring([k1, k1], 'k1'))).toBe('duplicate_key_id');
    expect(reasonOf(() => new Keyring([k1], 'k2'))).toBe('unknown_active_key');
    expect(reasonOf(() => new Keyring([{ id: 'k1', master: Buffer.alloc(31) }], 'k1'))).toBe(
      'invalid_key_material',
    );
    expect(reasonOf(() => new Keyring([{ id: 'k1', master: Buffer.alloc(33) }], 'k1'))).toBe(
      'invalid_key_material',
    );
    for (const id of ['', 'a b', 'ké', 'x'.repeat(65), 'a:b', 'a,b']) {
      expect(reasonOf(() => new Keyring([{ id, master: FIXTURE_MASTER_K1 }], id))).toBe(
        'invalid_key_id',
      );
    }
    const many = Array.from({ length: 17 }, (_, index) => ({
      id: `k${index}`,
      master: FIXTURE_MASTER_K1,
    }));
    expect(reasonOf(() => new Keyring(many, 'k0'))).toBe('invalid_keyring');
  });

  it('accepts a 64-character key id from the allowed alphabet', () => {
    const id = `${'A'.repeat(32)}${'z'.repeat(16)}${'_-0'.repeat(5)}9`;
    expect(id).toHaveLength(64);
    expect(new Keyring([{ id, master: FIXTURE_MASTER_K2 }], id).activeKeyId).toBe(id);
  });
});

describe('parseKeyringConfig', () => {
  it('parses canonical base64 keys and the active id', () => {
    const result = parseKeyringConfig(FIXTURE_KEYRING_ENV, 'k2');
    if (!result.ok) {
      throw new Error('expected a valid keyring');
    }
    expect(result.keyring.keyIds()).toEqual(['k1', 'k2']);
    expect(result.keyring.activeKeyId).toBe('k2');
  });

  const noncanonical = `${FIXTURE_K1_BASE64.slice(0, 42)}9=`;

  it.each<[string, string]>([
    ['empty keyring', ''],
    ['missing colon', FIXTURE_K1_BASE64],
    ['empty id', `:${FIXTURE_K1_BASE64}`],
    ['trailing comma', `${FIXTURE_KEYRING_ENV},`],
    ['whitespace', `k1: ${FIXTURE_K1_BASE64}`],
    ['not base64', `k1:${'!'.repeat(44)}`],
    ['unpadded base64', `k1:${FIXTURE_K1_BASE64.slice(0, 43)}`],
    ['31 bytes', `k1:${Buffer.alloc(31, 1).toString('base64')}`],
    ['33 bytes', `k1:${Buffer.alloc(33, 1).toString('base64')}`],
    ['url-safe alphabet', `k1:${FIXTURE_K1_BASE64.replace('+', '-')}x`],
    ['non-canonical trailing bits', `k1:${noncanonical}`],
    ['duplicate ids', `k1:${FIXTURE_K1_BASE64},k1:${FIXTURE_K2_BASE64}`],
    ['invalid id characters', `k 1:${FIXTURE_K1_BASE64}`],
  ])('rejects %s and names only CRYPTO_KEYRING', (_label, raw) => {
    expect(noncanonical).not.toBe(FIXTURE_K1_BASE64);
    const result = parseKeyringConfig(raw, 'k1');
    expect(result).toEqual({ ok: false, invalid: ['CRYPTO_KEYRING'] });
  });

  it('names only CRYPTO_ACTIVE_KEY_ID when the active id is not in the keyring', () => {
    expect(parseKeyringConfig(FIXTURE_KEYRING_ENV, 'k9')).toEqual({
      ok: false,
      invalid: ['CRYPTO_ACTIVE_KEY_ID'],
    });
    expect(parseKeyringConfig(FIXTURE_KEYRING_ENV, '')).toEqual({
      ok: false,
      invalid: ['CRYPTO_ACTIVE_KEY_ID'],
    });
  });

  it('rejects more than 16 keys', () => {
    const raw = Array.from({ length: 17 }, (_, index) => `k${index}:${FIXTURE_K1_BASE64}`).join(',');
    expect(parseKeyringConfig(raw, 'k0')).toEqual({ ok: false, invalid: ['CRYPTO_KEYRING'] });
  });

  it('never puts key material into a failure result', () => {
    const result = parseKeyringConfig(`k1:${FIXTURE_K1_BASE64},k1:${FIXTURE_K2_BASE64}`, 'k1');
    const text = JSON.stringify(result);
    expect(text).not.toContain(FIXTURE_K1_BASE64);
    expect(text).not.toContain(FIXTURE_K2_BASE64);
  });
});
