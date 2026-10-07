import { CryptoError } from '../crypto/crypto-error';

/** The exact logical identity of an idempotency record (ADR-003 section 3.1). */
export interface IdempotencyTuple {
  readonly scopeType: string;
  readonly scopeId: string;
  readonly operationId: string;
  /** Canonical lowercase UUID. */
  readonly idempotencyKey: string;
}

/** One row of app.idempotency_records as the executor sees it. Expiry instants are epoch milliseconds. */
export interface IdempotencyRecord extends IdempotencyTuple {
  readonly recordId: string;
  readonly requestFingerprint: string;
  readonly cryptoKeyId: string;
  readonly responseStatus: number;
  readonly replayFormatVersion: number;
  readonly replayGuard: unknown;
  readonly replayCiphertext: Buffer | null;
  readonly replayIv: Buffer | null;
  readonly replayTag: Buffer | null;
  readonly createdAtMs: number;
  readonly replayExpiresAtMs: number;
  readonly dedupeExpiresAtMs: number;
}

function text(value: unknown): string {
  if (typeof value !== 'string') {
    throw new CryptoError('invalid_envelope');
  }
  return value;
}

function integer(value: unknown): number {
  // pg returns smallint as a number and bigint as a decimal string.
  const parsed = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed)) {
    throw new CryptoError('invalid_envelope');
  }
  return parsed;
}

function bytes(value: unknown): Buffer | null {
  if (value === null) {
    return null;
  }
  if (!Buffer.isBuffer(value)) {
    throw new CryptoError('invalid_envelope');
  }
  return value;
}

/**
 * Converts a raw driver row into an IdempotencyRecord. Any value of an unexpected type means the row
 * is not what this code wrote, so it fails closed with a fixed reason (never the value itself).
 */
export function parseRecordRow(raw: Record<string, unknown>): IdempotencyRecord {
  return {
    recordId: text(raw.record_id),
    scopeType: text(raw.scope_type),
    scopeId: text(raw.scope_id),
    operationId: text(raw.operation_id),
    idempotencyKey: text(raw.idempotency_key),
    requestFingerprint: text(raw.request_fingerprint),
    cryptoKeyId: text(raw.crypto_key_id),
    responseStatus: integer(raw.response_status),
    replayFormatVersion: integer(raw.replay_format_version),
    replayGuard: raw.replay_guard,
    replayCiphertext: bytes(raw.replay_ciphertext),
    replayIv: bytes(raw.replay_iv),
    replayTag: bytes(raw.replay_tag),
    createdAtMs: integer(raw.created_at_ms),
    replayExpiresAtMs: integer(raw.replay_expires_at_ms),
    dedupeExpiresAtMs: integer(raw.dedupe_expires_at_ms),
  };
}
