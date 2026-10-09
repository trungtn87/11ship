import { randomBytes, timingSafeEqual } from 'node:crypto';
import { TechnicalError } from '../common/app-errors';
import { CryptoError } from '../crypto/crypto-error';
import { AdminTotpBinding, KeyVersion, ReplayEnvelope } from '../crypto/key-version';
import { Keyring } from '../crypto/keyring';
import { TOTP_SECRET_BYTES } from './admin-auth-constants';

export type RandomBytesFn = (size: number) => Buffer;

/**
 * Every cryptographic operation of the administration module. It is the ONLY place where a CryptoError (corrupt
 * ciphertext, a missing historical key, a failing random source) is turned into the generic 503, so the global
 * CryptoError -> 500 behaviour other modules rely on is untouched. Invalid input from a caller (a programming error)
 * is deliberately NOT mapped to 503. A key id stored with a credential is always resolved from the keyring history;
 * a missing key fails closed and never falls back to the current key.
 */
export class AdminCrypto {
  readonly #keyring: Keyring;
  readonly #random: RandomBytesFn;

  constructor(keyring: Keyring, random: RandomBytesFn = randomBytes) {
    this.#keyring = keyring;
    this.#random = random;
  }

  get activeKeyId(): string {
    return this.#keyring.activeKeyId;
  }

  /** CSPRNG bytes; a failing or short random source is "unavailable", never a weaker value. */
  randomBytes(size: number): Buffer {
    let bytes: Buffer;
    try {
      bytes = this.#random(size);
    } catch {
      throw unavailable();
    }
    if (!Buffer.isBuffer(bytes) || bytes.length !== size) {
      throw unavailable();
    }
    return bytes;
  }

  newTotpSecret(): Buffer {
    return this.randomBytes(TOTP_SECRET_BYTES);
  }

  #version(keyId: string): KeyVersion {
    const version = this.#keyring.version(keyId);
    if (version === undefined) {
      throw unavailable();
    }
    return version;
  }

  #guard<T>(work: () => T): T {
    try {
      return work();
    } catch (error) {
      if (error instanceof CryptoError) {
        throw unavailable();
      }
      throw error;
    }
  }

  /** Binding under the ACTIVE key, with the key id to store next to it. */
  newPasswordBinding(userId: string, passwordHash: string): { binding: string; keyId: string } {
    const version = this.#keyring.active();
    return { binding: this.#guard(() => version.adminPasswordBinding(userId, passwordHash)), keyId: version.id };
  }

  /** Recomputes the binding under the key it was stored with and compares in constant time. */
  passwordBindingMatches(input: { keyId: string; userId: string; passwordHash: string; stored: string }): boolean {
    const expected = this.#guard(() => this.#version(input.keyId).adminPasswordBinding(input.userId, input.passwordHash));
    return safeEqualText(expected, input.stored);
  }

  /** A fresh CSRF nonce, bound to the active key. */
  newCsrf(): { nonce: Buffer; keyId: string } {
    return { nonce: this.randomBytes(32), keyId: this.#keyring.activeKeyId };
  }

  csrfToken(input: { type: 'PREAUTH' | 'SESSION'; credentialId: string; nonce: Buffer; keyId: string }): string {
    return this.#guard(() => this.#version(input.keyId).adminCsrfToken(input.type, input.credentialId, input.nonce));
  }

  /** Constant-time check of the presented X-CSRF-Token against the token derived from the stored nonce and key. */
  csrfMatches(
    input: { type: 'PREAUTH' | 'SESSION'; credentialId: string; nonce: Buffer; keyId: string },
    presented: unknown,
  ): boolean {
    const expected = this.csrfToken(input);
    return typeof presented === 'string' && safeEqualText(expected, presented);
  }

  sealTotpSecret(binding: AdminTotpBinding, secret: Buffer): { keyId: string; envelope: ReplayEnvelope } {
    const version = this.#keyring.active();
    return { keyId: version.id, envelope: this.#guard(() => version.sealAdminTotpSecret(binding, secret)) };
  }

  openTotpSecret(keyId: string, binding: AdminTotpBinding, envelope: ReplayEnvelope): Buffer {
    return this.#guard(() => this.#version(keyId).openAdminTotpSecret(binding, envelope));
  }
}

function unavailable(): TechnicalError {
  return new TechnicalError('unavailable', 'Administration cryptography is unavailable');
}

/** Constant-time equality of two strings of any length (the length itself is not secret). */
function safeEqualText(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
