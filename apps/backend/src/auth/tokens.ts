import { createHash, randomBytes } from 'node:crypto';
import { TOKEN_BYTES, TOKEN_LENGTH } from './auth-constants';

// Opaque random tokens (ADR-002): 32 bytes from the CSPRNG, canonical base64url without padding (43
// characters). The database stores only the SHA-256 digest (lowercase hex, 64 characters) of the token TEXT;
// the plaintext is returned to the client exactly once and never stored or logged. A fast hash is correct
// here because a token is high-entropy random data; it is never used for a password or an OTP.

export type RandomBytesFn = (size: number) => Buffer;

export interface NewToken {
  /** Plaintext, for the client. */
  readonly token: string;
  /** SHA-256 hex of the token, for the database. */
  readonly digest: string;
}

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function generateToken(random: RandomBytesFn = randomBytes): NewToken {
  const bytes = random(TOKEN_BYTES);
  if (!Buffer.isBuffer(bytes) || bytes.length !== TOKEN_BYTES) {
    // A failing or short RNG must never produce a weaker token.
    throw new RangeError('random source returned an unexpected size');
  }
  const token = bytes.toString('base64url');
  return { token, digest: digestToken(token) };
}

/** SHA-256 of the token text as lowercase hex. */
export function digestToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * The token itself when it is a canonical 32-byte base64url value, otherwise undefined. Canonical means that
 * it decodes to exactly 32 bytes and re-encodes to the very same text, so a token with non-zero trailing
 * bits, padding, whitespace or a different alphabet is refused instead of being quietly accepted.
 */
export function parseCanonicalToken(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length !== TOKEN_LENGTH || !TOKEN_SHAPE.test(value)) {
    return undefined;
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== TOKEN_BYTES || decoded.toString('base64url') !== value) {
    return undefined;
  }
  return value;
}
