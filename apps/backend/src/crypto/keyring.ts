import { randomBytes } from 'node:crypto';
import { CryptoError } from './crypto-error';
import { deriveSubkeys, MASTER_KEY_BYTES } from './kdf';
import { KeyVersion, RandomBytesFn } from './key-version';

// key_id: ASCII [A-Za-z0-9_-]{1,64}. A key id maps to ONE 32-byte master for the lifetime of the
// deployment: an id must never be re-assigned to different material (ADR-003 §13.3).
export const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_KEYRING_SIZE = 16;
// 32 bytes -> 43 base64 characters + one "=" pad. Anything else is not canonical.
const MASTER_BASE64 = /^[A-Za-z0-9+/]{43}=$/;

export interface KeyringEntry {
  readonly id: string;
  /** 32 random bytes. The Keyring derives its subkeys at construction and does not retain this. */
  readonly master: Buffer;
}

export interface KeyringOptions {
  /** Replaceable only so tests can inject a failing or fixed RNG. */
  readonly randomBytes?: RandomBytesFn;
}

/**
 * Immutable keyring for the lifetime of the process (no hot reload). Master keys are used only to
 * derive HKDF subkeys; afterwards only the subkeys, held in private fields of each KeyVersion, remain.
 * New records capture ONE KeyVersion (active()) for both HMAC and encryption; an existing record is
 * always handled with version(record.crypto_key_id), never with the current active key.
 */
export class Keyring {
  readonly activeKeyId: string;
  readonly #versions: ReadonlyMap<string, KeyVersion>;

  constructor(entries: readonly KeyringEntry[], activeKeyId: string, options: KeyringOptions = {}) {
    if (entries.length < 1 || entries.length > MAX_KEYRING_SIZE) {
      throw new CryptoError('invalid_keyring');
    }
    const random = options.randomBytes ?? randomBytes;
    const versions = new Map<string, KeyVersion>();
    for (const entry of entries) {
      if (typeof entry.id !== 'string' || !KEY_ID_PATTERN.test(entry.id)) {
        throw new CryptoError('invalid_key_id');
      }
      if (versions.has(entry.id)) {
        throw new CryptoError('duplicate_key_id');
      }
      if (!Buffer.isBuffer(entry.master) || entry.master.length !== MASTER_KEY_BYTES) {
        throw new CryptoError('invalid_key_material');
      }
      versions.set(entry.id, new KeyVersion(entry.id, deriveSubkeys(entry.master), random));
    }
    if (!versions.has(activeKeyId)) {
      throw new CryptoError('unknown_active_key');
    }
    this.activeKeyId = activeKeyId;
    this.#versions = versions;
    Object.freeze(this);
  }

  active(): KeyVersion {
    const version = this.#versions.get(this.activeKeyId);
    if (version === undefined) {
      throw new CryptoError('unknown_active_key');
    }
    return version;
  }

  /** The historical or current version for a stored crypto_key_id, or undefined if it was removed. */
  version(keyId: string): KeyVersion | undefined {
    return this.#versions.get(keyId);
  }

  has(keyId: string): boolean {
    return this.#versions.has(keyId);
  }

  keyIds(): readonly string[] {
    return [...this.#versions.keys()].sort();
  }
}

export type KeyringConfigIssue = 'CRYPTO_KEYRING' | 'CRYPTO_ACTIVE_KEY_ID';

export type KeyringConfigResult =
  | { readonly ok: true; readonly keyring: Keyring }
  | { readonly ok: false; readonly invalid: readonly KeyringConfigIssue[] };

/**
 * Parses CRYPTO_KEYRING ("id:base64,id:base64", canonical standard base64 of exactly 32 bytes) and
 * CRYPTO_ACTIVE_KEY_ID. On failure only the NAMES of the variables are returned, never any value.
 */
export function parseKeyringConfig(
  rawKeyring: string,
  activeKeyId: string,
  options: KeyringOptions = {},
): KeyringConfigResult {
  const entries: KeyringEntry[] = [];
  for (const item of rawKeyring.split(',')) {
    const separator = item.indexOf(':');
    if (separator < 1) {
      return { ok: false, invalid: ['CRYPTO_KEYRING'] };
    }
    const id = item.slice(0, separator);
    const encoded = item.slice(separator + 1);
    if (!MASTER_BASE64.test(encoded)) {
      return { ok: false, invalid: ['CRYPTO_KEYRING'] };
    }
    const master = Buffer.from(encoded, 'base64');
    // Re-encoding must give the same text: rejects non-canonical trailing bits.
    if (master.length !== MASTER_KEY_BYTES || master.toString('base64') !== encoded) {
      return { ok: false, invalid: ['CRYPTO_KEYRING'] };
    }
    entries.push({ id, master });
  }

  try {
    return { ok: true, keyring: new Keyring(entries, activeKeyId, options) };
  } catch (error) {
    if (error instanceof CryptoError && error.reason === 'unknown_active_key') {
      return { ok: false, invalid: ['CRYPTO_ACTIVE_KEY_ID'] };
    }
    return { ok: false, invalid: ['CRYPTO_KEYRING'] };
  }
}
