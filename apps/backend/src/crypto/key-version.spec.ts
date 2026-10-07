import { describe, expect, it } from '@jest/globals';
import { JsonValidationError } from '../shared/json/safe-json';
import { CryptoError } from './crypto-error';
import { fingerprintsEqual, IV_BYTES, ReplayEnvelope, TAG_BYTES } from './key-version';
import { Keyring } from './keyring';
import { buildReplayAad, ReplayAadFields } from './replay-aad';
import { fixtureKeyring, FIXTURE_MASTER_K1 } from './test-keys.fixture';

const LOGICAL_REQUEST = {
  phone: '+84901234567',
  password: ' pass word ',
  device: { id: 'd-1' },
};
const LOGICAL_REQUEST_FINGERPRINT =
  'd6923820270d242cab1bfd445f5d699016ce862d0394f208e0ae6a61fe9bcb74';

const FIXED_IV = Buffer.from(Array.from({ length: IV_BYTES }, (_, index) => 0xa0 + index));
const PAYLOAD = { access_token: 'tok-SECRET', user: { id: 'u-1' } };

function fields(overrides: Partial<ReplayAadFields> = {}): ReplayAadFields {
  return {
    replayFormatVersion: 1,
    recordId: '00000000-0000-4000-8000-000000000001',
    scopeType: 'user',
    scopeId: 'u-1',
    operationId: 'auth.register.v1',
    idempotencyKey: '11111111-2222-4333-8444-555555555555',
    requestFingerprint: LOGICAL_REQUEST_FINGERPRINT,
    replayGuard: { proof_id: 'p-1', user_id: 'u-1', session_id: 's-1' },
    responseStatus: 201,
    replayExpiresAtEpochMs: 1791244800123,
    ...overrides,
  };
}

function cryptoReason(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof CryptoError) {
      return error.reason;
    }
    throw error;
  }
  throw new Error('expected a CryptoError');
}

function flip(buffer: Buffer, index = 0): Buffer {
  const copy = Buffer.from(buffer);
  copy[index] = (copy[index] ?? 0) ^ 0x01;
  return copy;
}

describe('request fingerprint — HMAC-SHA-256 (C25, C07 basics)', () => {
  const k1 = fixtureKeyring('k1').active();

  it('matches an independently computed known answer', () => {
    expect(k1.fingerprint(LOGICAL_REQUEST)).toBe(LOGICAL_REQUEST_FINGERPRINT);
  });

  it('is stable, key-order independent and lowercase hex of 64 characters', () => {
    const reordered = { device: { id: 'd-1' }, password: ' pass word ', phone: '+84901234567' };
    expect(k1.fingerprint(reordered)).toBe(LOGICAL_REQUEST_FINGERPRINT);
    expect(LOGICAL_REQUEST_FINGERPRINT).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when the logical request changes and does not trim or Unicode-normalize', () => {
    const changed = { ...LOGICAL_REQUEST, password: 'pass word' };
    expect(k1.fingerprint(changed)).not.toBe(LOGICAL_REQUEST_FINGERPRINT);
    expect(k1.fingerprint({ p: 'é' })).not.toBe(k1.fingerprint({ p: 'é' }));
    expect(k1.fingerprint({ p: 'a' })).not.toBe(k1.fingerprint({ p: 'a ' }));
  });

  it('differs per key version and is not a plain SHA-256', () => {
    const k2 = fixtureKeyring('k2').active();
    expect(k2.fingerprint(LOGICAL_REQUEST)).not.toBe(k1.fingerprint(LOGICAL_REQUEST));
  });

  it('accepts password-like keys (they are the point of an HMAC fingerprint) but rejects non-JSON', () => {
    expect(() => k1.fingerprint({ password: 'x', verification_token: 'y' })).not.toThrow();
    expect(() => k1.fingerprint({ a: undefined })).toThrow(JsonValidationError);
    expect(() => k1.fingerprint(undefined)).toThrow(JsonValidationError);
  });

  it('compares fingerprints in constant time over fixed-length decoded bytes', () => {
    expect(fingerprintsEqual(LOGICAL_REQUEST_FINGERPRINT, LOGICAL_REQUEST_FINGERPRINT)).toBe(true);
    const other = `${LOGICAL_REQUEST_FINGERPRINT.slice(0, 63)}5`;
    expect(fingerprintsEqual(LOGICAL_REQUEST_FINGERPRINT, other)).toBe(false);
    expect(fingerprintsEqual(LOGICAL_REQUEST_FINGERPRINT, LOGICAL_REQUEST_FINGERPRINT.toUpperCase())).toBe(
      false,
    );
    expect(fingerprintsEqual(LOGICAL_REQUEST_FINGERPRINT, LOGICAL_REQUEST_FINGERPRINT.slice(2))).toBe(
      false,
    );
    expect(fingerprintsEqual('', '')).toBe(false);
    expect(fingerprintsEqual(1 as unknown as string, LOGICAL_REQUEST_FINGERPRINT)).toBe(false);
  });
});

describe('replay AAD — known answer (C25)', () => {
  it('is the canonical JSON array required by ADR-003 §13.3', () => {
    expect(buildReplayAad('k1', fields()).toString('utf8')).toBe(
      `[1,"00000000-0000-4000-8000-000000000001","user","u-1","auth.register.v1","11111111-2222-4333-8444-555555555555","${LOGICAL_REQUEST_FINGERPRINT}","k1",{"proof_id":"p-1","session_id":"s-1","user_id":"u-1"},201,"1791244800123"]`,
    );
  });

  it('keeps a depth-8 guard valid inside the array', () => {
    let guard: unknown = 'leaf';
    for (let level = 0; level < 8; level += 1) {
      guard = { n: guard };
    }
    expect(() => buildReplayAad('k1', fields({ replayGuard: guard }))).not.toThrow();
    expect(() => buildReplayAad('k1', fields({ replayGuard: { n: guard } }))).toThrow(
      JsonValidationError,
    );
  });

  it.each<[string, Partial<ReplayAadFields>]>([
    ['unknown format version', { replayFormatVersion: 2 }],
    ['status below 200', { responseStatus: 199 }],
    ['status above 299', { responseStatus: 300 }],
    ['fractional status', { responseStatus: 200.5 }],
    ['uppercase fingerprint', { requestFingerprint: LOGICAL_REQUEST_FINGERPRINT.toUpperCase() }],
    ['short fingerprint', { requestFingerprint: 'abc' }],
    ['negative expiry', { replayExpiresAtEpochMs: -1 }],
    ['fractional expiry', { replayExpiresAtEpochMs: 1.5 }],
    ['non-string field', { scopeId: 7 as unknown as string }],
  ])('refuses %s', (_label, overrides) => {
    expect(cryptoReason(() => buildReplayAad('k1', fields(overrides)))).toBe('invalid_input');
  });

  it('refuses a secret-looking or oversized replay guard before any crypto runs', () => {
    expect(() => buildReplayAad('k1', fields({ replayGuard: { access_token: 'x' } }))).toThrow(
      JsonValidationError,
    );
    expect(() => buildReplayAad('k1', fields({ replayGuard: { a: 'x'.repeat(4096) } }))).toThrow(
      JsonValidationError,
    );
  });
});

describe('AES-256-GCM replay envelope (C25)', () => {
  const fixedRandom = () => Buffer.from(FIXED_IV);
  const keyring = fixtureKeyring('k1', { randomBytes: fixedRandom });

  it('produces the independently computed ciphertext and tag for a fixed IV', () => {
    const envelope = keyring.active().encryptReplay(fields(), PAYLOAD);
    expect(envelope.iv.toString('hex')).toBe(FIXED_IV.toString('hex'));
    expect(envelope.ciphertext.toString('hex')).toBe(
      'af9f5d9d3fc73dca92856ce2ad86f80f4ee3d982f5c5c3cc45a53195e66467d778941ee2e0c11a00443746f54fd7ba926b',
    );
    expect(envelope.tag.toString('hex')).toBe('35bbd7547a2e9d44c48932e1f7207b91');
    expect(envelope.tag).toHaveLength(TAG_BYTES);
  });

  it('round-trips the original logical payload', () => {
    const real = fixtureKeyring('k1').active();
    const envelope = real.encryptReplay(fields(), PAYLOAD);
    expect(real.decryptReplay(fields(), envelope)).toEqual(PAYLOAD);
    expect(envelope.ciphertext.toString('utf8')).not.toContain('tok-SECRET');
    expect(envelope.ciphertext.toString('latin1')).not.toContain('tok-SECRET');
  });

  it('uses a fresh random IV for every encryption, even for identical input', () => {
    const real = fixtureKeyring('k1').active();
    const seen = new Set<string>();
    for (let index = 0; index < 50; index += 1) {
      const envelope = real.encryptReplay(fields(), PAYLOAD);
      expect(envelope.iv).toHaveLength(IV_BYTES);
      seen.add(envelope.iv.toString('hex'));
    }
    expect(seen.size).toBe(50);
  });

  it('asks the RNG for exactly 12 bytes each time', () => {
    const requested: number[] = [];
    const spying = fixtureKeyring('k1', {
      randomBytes: (size) => {
        requested.push(size);
        return Buffer.alloc(size, 7);
      },
    });
    spying.active().encryptReplay(fields(), PAYLOAD);
    spying.active().encryptReplay(fields(), PAYLOAD);
    expect(requested).toEqual([12, 12]);
  });

  it('fails closed when the RNG throws or returns the wrong length', () => {
    const failing = fixtureKeyring('k1', {
      randomBytes: () => {
        throw new Error('entropy source unavailable');
      },
    });
    expect(cryptoReason(() => failing.active().encryptReplay(fields(), PAYLOAD))).toBe('rng_failure');

    for (const size of [0, 11, 13, 16]) {
      const wrong = fixtureKeyring('k1', { randomBytes: () => Buffer.alloc(size) });
      expect(cryptoReason(() => wrong.active().encryptReplay(fields(), PAYLOAD))).toBe('rng_failure');
    }
    const notABuffer = fixtureKeyring('k1', {
      randomBytes: () => 'abcdefghijkl' as unknown as Buffer,
    });
    expect(cryptoReason(() => notABuffer.active().encryptReplay(fields(), PAYLOAD))).toBe(
      'rng_failure',
    );
  });

  it('rejects a payload over 64 KiB or non-JSON before encrypting', () => {
    const real = fixtureKeyring('k1').active();
    expect(() => real.encryptReplay(fields(), { a: 'x'.repeat(64 * 1024) })).toThrow(
      JsonValidationError,
    );
    expect(() => real.encryptReplay(fields(), { a: undefined })).toThrow(JsonValidationError);
  });

  describe('tampering fails closed', () => {
    const real = fixtureKeyring('k1').active();
    const envelope = real.encryptReplay(fields(), PAYLOAD);

    it('rejects a changed ciphertext, tag or IV', () => {
      for (const tampered of [
        { ...envelope, ciphertext: flip(envelope.ciphertext) },
        { ...envelope, ciphertext: flip(envelope.ciphertext, envelope.ciphertext.length - 1) },
        { ...envelope, tag: flip(envelope.tag) },
        { ...envelope, iv: flip(envelope.iv) },
      ]) {
        expect(cryptoReason(() => real.decryptReplay(fields(), tampered))).toBe(
          'authentication_failed',
        );
      }
    });

    it.each<[string, Partial<ReplayAadFields>]>([
      ['record id', { recordId: '00000000-0000-4000-8000-000000000002' }],
      ['scope type', { scopeType: 'admin' }],
      ['scope id', { scopeId: 'u-2' }],
      ['operation id', { operationId: 'auth.login.v1' }],
      ['idempotency key', { idempotencyKey: '11111111-2222-4333-8444-555555555556' }],
      ['request fingerprint', { requestFingerprint: 'f'.repeat(64) }],
      ['replay guard', { replayGuard: { proof_id: 'p-1', user_id: 'u-2', session_id: 's-1' } }],
      ['response status', { responseStatus: 200 }],
      ['replay expiry', { replayExpiresAtEpochMs: 1791244800124 }],
    ])('rejects a changed AAD field: %s', (_label, overrides) => {
      expect(cryptoReason(() => real.decryptReplay(fields(overrides), envelope))).toBe(
        'authentication_failed',
      );
    });

    it('rejects decryption under another key version (key id is part of the AAD and the key)', () => {
      const other = fixtureKeyring('k2').active();
      expect(cryptoReason(() => other.decryptReplay(fields(), envelope))).toBe('authentication_failed');
    });

    it('never returns plaintext when authentication fails', () => {
      let result: unknown = 'not-called';
      try {
        result = real.decryptReplay(fields(), { ...envelope, tag: flip(envelope.tag) });
      } catch {
        result = 'threw';
      }
      expect(result).toBe('threw');
    });
  });

  describe('malformed envelopes fail closed', () => {
    const real = fixtureKeyring('k1').active();
    const envelope: ReplayEnvelope = real.encryptReplay(fields(), PAYLOAD);

    it.each<[string, Partial<Record<keyof ReplayEnvelope, unknown>>]>([
      ['IV of 11 bytes', { iv: Buffer.alloc(11) }],
      ['IV of 13 bytes', { iv: Buffer.alloc(13) }],
      ['empty IV', { iv: Buffer.alloc(0) }],
      ['tag of 15 bytes', { tag: Buffer.alloc(15) }],
      ['tag of 17 bytes', { tag: Buffer.alloc(17) }],
      ['IV that is not a Buffer', { iv: 'a'.repeat(12) }],
      ['tag that is not a Buffer', { tag: null }],
      ['ciphertext that is not a Buffer', { ciphertext: [1, 2, 3] }],
      ['oversized ciphertext', { ciphertext: Buffer.alloc(64 * 1024 + 1) }],
    ])('rejects %s', (_label, overrides) => {
      const malformed = { ...envelope, ...overrides } as unknown as ReplayEnvelope;
      expect(cryptoReason(() => real.decryptReplay(fields(), malformed))).toBe('invalid_envelope');
    });

    it('rejects an unknown replay format version', () => {
      expect(cryptoReason(() => real.decryptReplay(fields({ replayFormatVersion: 2 }), envelope))).toBe(
        'invalid_input',
      );
    });

    it('rejects an empty ciphertext because the tag no longer matches', () => {
      expect(
        cryptoReason(() => real.decryptReplay(fields(), { ...envelope, ciphertext: Buffer.alloc(0) })),
      ).toBe('authentication_failed');
    });
  });
});

describe('key rotation across separate keyring instances (C25)', () => {
  it('decrypts and fingerprints an old record with its own key after the active key moved', () => {
    const writer = fixtureKeyring('k1'); // process that wrote the record
    const oldVersion = writer.active();
    const fingerprint = oldVersion.fingerprint(LOGICAL_REQUEST);
    const envelope = oldVersion.encryptReplay(fields({ requestFingerprint: fingerprint }), PAYLOAD);

    const reader = fixtureKeyring('k2'); // after rotation: k2 is active, k1 is historical
    expect(reader.activeKeyId).toBe('k2');
    const historical = reader.version('k1');
    expect(historical).toBeDefined();
    expect(historical?.fingerprint(LOGICAL_REQUEST)).toBe(fingerprint);
    expect(historical?.decryptReplay(fields({ requestFingerprint: fingerprint }), envelope)).toEqual(
      PAYLOAD,
    );

    // The active key is NOT the right one for the old record.
    expect(reader.active().fingerprint(LOGICAL_REQUEST)).not.toBe(fingerprint);
  });

  it('new records use the new active key and carry its id in the AAD', () => {
    const reader = fixtureKeyring('k2');
    const active = reader.active();
    expect(active.id).toBe('k2');
    const envelope = active.encryptReplay(fields(), PAYLOAD);
    expect(reader.version('k2')?.decryptReplay(fields(), envelope)).toEqual(PAYLOAD);
    expect(buildReplayAad('k2', fields()).toString('utf8')).toContain('"k2"');
  });

  it('reports a removed historical key as absent instead of falling back to another key', () => {
    const onlyNew = new Keyring(
      [{ id: 'k2', master: Buffer.from(Array.from({ length: 32 }, (_, index) => 255 - index)) }],
      'k2',
    );
    expect(onlyNew.version('k1')).toBeUndefined();
    expect(FIXTURE_MASTER_K1).toHaveLength(32);
  });
});
