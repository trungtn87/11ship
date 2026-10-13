import { createHash, createPublicKey, KeyObject, verify as cryptoVerify } from 'node:crypto';

// Canonical messages and encodings of the native device protocol (contract11 sections 7 and 8). Every message is a list of
// UTF-8 lines joined by "\n" (no trailing newline). A SHA-256 inside a message is written as 64 lowercase hex digits. Signatures
// are ECDSA P-256 over SHA-256, DER encoded, transported as base64url without padding. The server never rebuilds a body or a URL:
// it hashes the exact bytes that arrived.

export const REGISTER_KEY_PREFIX = '11SHIP-REGISTER-KEY-V1';
export const JOIN_KEY_PREFIX = '11SHIP-JOIN-KEY-V1';
export const AUTH_PREFIX = '11SHIP-AUTH-V1';
export const REQUEST_PREFIX = '11SHIP-REQUEST-V1';

const BASE64URL = /^[A-Za-z0-9_-]+$/;

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function toBase64Url(data: Buffer): string {
  return data.toString('base64url');
}

/** Strict base64url (no padding, canonical): the decoded bytes re-encode to the same text. */
export function fromBase64Url(text: unknown, maxBytes: number): Buffer | undefined {
  if (typeof text !== 'string' || text.length === 0 || !BASE64URL.test(text) || text.length > Math.ceil((maxBytes * 4) / 3) + 2) {
    return undefined;
  }
  const bytes = Buffer.from(text, 'base64url');
  return bytes.length > 0 && bytes.length <= maxBytes && bytes.toString('base64url') === text ? bytes : undefined;
}

/** Strict standard base64 (certificate chain / SPKI fields of the registration body). */
export function fromBase64(text: unknown, maxBytes: number): Buffer | undefined {
  if (typeof text !== 'string' || text.length === 0 || text.length > Math.ceil((maxBytes * 4) / 3) + 4) {
    return undefined;
  }
  const bytes = Buffer.from(text, 'base64');
  return bytes.length > 0 && bytes.length <= maxBytes && bytes.toString('base64') === text ? bytes : undefined;
}

function lines(parts: readonly string[]): Buffer {
  return Buffer.from(parts.join('\n'), 'utf8');
}

export interface KeyMessageInput {
  readonly environment: string;
  readonly challengeId: string;
  /** base64url of the 32 challenge bytes. */
  readonly nonce: string;
  readonly app: string;
  readonly spkiSha256Hex: string;
  readonly bindingId: string | null;
  readonly authorizerKeyId: string | null;
}

export function registerKeyMessage(
  input: KeyMessageInput,
  prefix: typeof REGISTER_KEY_PREFIX | typeof JOIN_KEY_PREFIX = REGISTER_KEY_PREFIX,
): Buffer {
  return lines([
    prefix,
    input.environment,
    input.challengeId,
    input.nonce,
    input.app,
    input.spkiSha256Hex,
    input.bindingId ?? '',
    input.authorizerKeyId ?? '',
  ]);
}

export interface AuthMessageInput {
  readonly environment: string;
  readonly method: string;
  readonly path: string;
  readonly bodySha256Hex: string;
  readonly idempotencyKeySha256Hex: string;
  readonly registrationTokenSha256Hex: string;
  /** Unix seconds and base64url nonce of this very request: every login / register attempt, first or replay, is fresh. */
  readonly time: string;
  readonly nonce: string;
}

export function authMessage(input: AuthMessageInput): Buffer {
  return lines([
    AUTH_PREFIX,
    input.environment,
    input.method,
    input.path,
    input.bodySha256Hex,
    input.idempotencyKeySha256Hex,
    input.registrationTokenSha256Hex,
    input.time,
    input.nonce,
  ]);
}

export interface RequestMessageInput {
  readonly environment: string;
  readonly keyId: string;
  readonly time: string;
  readonly nonce: string;
  readonly method: string;
  readonly url: string;
  readonly bodySha256Hex: string;
  readonly bearerSha256Hex: string;
  readonly idempotencyKey: string;
}

export function requestMessage(input: RequestMessageInput): Buffer {
  return lines([
    REQUEST_PREFIX,
    input.environment,
    input.keyId,
    input.time,
    input.nonce,
    input.method,
    input.url,
    input.bodySha256Hex,
    input.bearerSha256Hex,
    input.idempotencyKey,
  ]);
}

export function publicKeyFromSpki(spki: Buffer): KeyObject | undefined {
  try {
    const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
    return key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1' ? key : undefined;
  } catch {
    return undefined;
  }
}

/** ECDSA SHA-256, DER signature. Never throws: any malformed input is simply "not valid". */
export function verifySignature(publicKey: KeyObject, message: Buffer, signature: Buffer): boolean {
  try {
    return cryptoVerify('sha256', message, { key: publicKey, dsaEncoding: 'der' }, signature);
  } catch {
    return false;
  }
}
