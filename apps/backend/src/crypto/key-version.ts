import { createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from 'node:crypto';
import { LOGICAL_REQUEST_POLICY, REPLAY_PAYLOAD_POLICY } from '../shared/json/json-policy';
import { JsonValue, validateJson } from '../shared/json/safe-json';
import { CryptoError } from './crypto-error';
import { DerivedSubkeys } from './kdf';
import { buildReplayAad, ReplayAadFields } from './replay-aad';

export type RandomBytesFn = (size: number) => Buffer;

export const IV_BYTES = 12;
export const TAG_BYTES = 16;
const FINGERPRINT_HEX = /^[0-9a-f]{64}$/;

export interface ReplayEnvelope {
  readonly iv: Buffer;
  readonly tag: Buffer;
  readonly ciphertext: Buffer;
}

/** Constant-time comparison of two lowercase-hex fingerprints (fixed-length decoded bytes). */
export function fingerprintsEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  if (!FINGERPRINT_HEX.test(a) || !FINGERPRINT_HEX.test(b)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/**
 * One key version: HMAC subkey + AES-256-GCM subkey, both kept in private fields. Instances are
 * created only by Keyring. Output of decrypt is returned only after GCM verification succeeded.
 * No method logs anything, and every failure is a CryptoError with a fixed reason (fail closed).
 */
export class KeyVersion {
  readonly id: string;
  readonly #hmacKey: Buffer;
  readonly #encryptionKey: Buffer;
  readonly #random: RandomBytesFn;

  constructor(id: string, subkeys: DerivedSubkeys, random: RandomBytesFn) {
    this.id = id;
    this.#hmacKey = subkeys.requestHmac;
    this.#encryptionKey = subkeys.replayEncryption;
    this.#random = random;
    Object.freeze(this);
  }

  /**
   * HMAC-SHA-256 over the Canonical JSON v1 of the logical request, lowercase hex. The logical
   * request may legitimately contain a password or proof, so key names are not scanned here.
   */
  fingerprint(logicalRequest: unknown): string {
    const { canonical } = validateJson(logicalRequest, LOGICAL_REQUEST_POLICY);
    return createHmac('sha256', this.#hmacKey).update(canonical, 'utf8').digest('hex');
  }

  encryptReplay(fields: ReplayAadFields, payload: unknown): ReplayEnvelope {
    const aad = buildReplayAad(this.id, fields);
    const plaintext = Buffer.from(validateJson(payload, REPLAY_PAYLOAD_POLICY).canonical, 'utf8');

    // A fresh random IV for every encryption, including a re-encryption after a rolled-back attempt.
    let iv: Buffer;
    try {
      iv = this.#random(IV_BYTES);
    } catch {
      throw new CryptoError('rng_failure');
    }
    if (!Buffer.isBuffer(iv) || iv.length !== IV_BYTES) {
      throw new CryptoError('rng_failure');
    }

    try {
      const cipher = createCipheriv('aes-256-gcm', this.#encryptionKey, iv, {
        authTagLength: TAG_BYTES,
      });
      cipher.setAAD(aad);
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();
      if (tag.length !== TAG_BYTES) {
        throw new CryptoError('invalid_envelope');
      }
      return { iv: Buffer.from(iv), tag, ciphertext };
    } catch (error) {
      if (error instanceof CryptoError) {
        throw error;
      }
      throw new CryptoError('invalid_input');
    }
  }

  decryptReplay(fields: ReplayAadFields, envelope: ReplayEnvelope): JsonValue {
    const { iv, tag, ciphertext } = envelope;
    if (
      !Buffer.isBuffer(iv) ||
      iv.length !== IV_BYTES ||
      !Buffer.isBuffer(tag) ||
      tag.length !== TAG_BYTES ||
      !Buffer.isBuffer(ciphertext) ||
      ciphertext.length > REPLAY_PAYLOAD_POLICY.maxBytes
    ) {
      throw new CryptoError('invalid_envelope');
    }
    const aad = buildReplayAad(this.id, fields);

    let plaintext: Buffer;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.#encryptionKey, iv, {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      const chunk = decipher.update(ciphertext);
      // final() verifies the tag. Nothing derived from `chunk` is used before it returns.
      plaintext = Buffer.concat([chunk, decipher.final()]);
    } catch {
      throw new CryptoError('authentication_failed');
    }

    try {
      return JSON.parse(plaintext.toString('utf8')) as JsonValue;
    } catch {
      throw new CryptoError('invalid_envelope');
    }
  }
}
