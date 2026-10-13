import { createHash } from 'node:crypto';

// Vocabulary of the native device binding (contract11 section 7/8/9).

export const CHALLENGE_TTL_SECONDS = 120;
export const REGISTRATION_GRANT_TTL_SECONDS = 120;
/**
 * Contract: 10 challenge requests per minute per key (AUTH). ENROLL and JOIN have no key yet, so they share one bucket per
 * (app, purpose) for the whole server: the contract's "network bucket", sized so that a handful of phones installing at once do
 * not starve each other (no address is stored, and none from a header is trusted).
 */
export const AUTH_CHALLENGES_PER_MINUTE = 10;
export const KEYLESS_CHALLENGES_PER_MINUTE = 120;

export const DEVICE_REPLACED_EVENT_TYPE = 'client.auth.device_replaced.v1';
export const DEVICE_REPLACED_EVENT_SCHEMA_VERSION = 1;

/** The apps whose ANDROID sessions are native and therefore need a device binding. */
export function isNativeSession(platform: string | undefined, app: string | undefined): boolean {
  return platform === 'ANDROID' && (app === 'FOOD' || app === 'SHIP');
}

/** The 32-byte digest stored in place of a nonce / token that is only compared. */
export function digestBytes(value: Buffer): Buffer {
  return createHash('sha256').update(value).digest();
}
