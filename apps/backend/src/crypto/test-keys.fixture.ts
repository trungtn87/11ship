// Test-only, obviously non-secret key material. This file is excluded from the production build
// (tsconfig.build.json) and must never be used outside tests.
import { Keyring, KeyringOptions } from './keyring';

export const FIXTURE_MASTER_K1 = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
export const FIXTURE_MASTER_K2 = Buffer.from(Array.from({ length: 32 }, (_, index) => 255 - index));

export const FIXTURE_K1_BASE64 = FIXTURE_MASTER_K1.toString('base64');
export const FIXTURE_K2_BASE64 = FIXTURE_MASTER_K2.toString('base64');

/** CRYPTO_KEYRING value for the two fixture keys. */
export const FIXTURE_KEYRING_ENV = `k1:${FIXTURE_K1_BASE64},k2:${FIXTURE_K2_BASE64}`;

export function fixtureKeyring(activeKeyId = 'k1', options: KeyringOptions = {}): Keyring {
  return new Keyring(
    [
      { id: 'k1', master: FIXTURE_MASTER_K1 },
      { id: 'k2', master: FIXTURE_MASTER_K2 },
    ],
    activeKeyId,
    options,
  );
}
