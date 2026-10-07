import { canonicalJson, validateJson } from '../shared/json/safe-json';
import {
  JsonPolicy,
  LOGICAL_REQUEST_POLICY,
  MAX_JSON_DEPTH,
  REPLAY_GUARD_POLICY,
} from '../shared/json/json-policy';
import { CryptoError } from './crypto-error';

export const REPLAY_FORMAT_VERSION = 1;
const FINGERPRINT_HEX = /^[0-9a-f]{64}$/;

// The guard is nested one level deeper inside the AAD array, so the AAD itself gets one extra level.
const AAD_POLICY: JsonPolicy = Object.freeze({
  ...LOGICAL_REQUEST_POLICY,
  name: 'replay-aad',
  maxDepth: MAX_JSON_DEPTH + 1,
});

export interface ReplayAadFields {
  readonly replayFormatVersion: number;
  readonly recordId: string;
  readonly scopeType: string;
  readonly scopeId: string;
  readonly operationId: string;
  readonly idempotencyKey: string;
  /** Lowercase hex HMAC-SHA-256 request fingerprint (64 characters). */
  readonly requestFingerprint: string;
  /** Non-secret identifiers only (policy: replay-guard, 4 KiB). */
  readonly replayGuard: unknown;
  /** 2xx only in M00-C1. */
  readonly responseStatus: number;
  /** Replay expiry as epoch milliseconds, read from PostgreSQL with millisecond precision. */
  readonly replayExpiresAtEpochMs: number;
}

/**
 * AAD for AES-256-GCM replay envelopes, ADR-003 §13.3: the UTF-8 Canonical JSON array
 * [format_version, record_id, scope_type, scope_id, operation_id, idempotency_key,
 *  request_fingerprint, crypto_key_id, replay_guard, response_status, replay_expiry_epoch_ms_string].
 * Canonical JSON arrays are unambiguous, so no field boundary can be shifted.
 */
export function buildReplayAad(cryptoKeyId: string, fields: ReplayAadFields): Buffer {
  const strings = [
    fields.recordId,
    fields.scopeType,
    fields.scopeId,
    fields.operationId,
    fields.idempotencyKey,
    fields.requestFingerprint,
    cryptoKeyId,
  ];
  if (
    fields.replayFormatVersion !== REPLAY_FORMAT_VERSION ||
    !strings.every((value) => typeof value === 'string') ||
    !FINGERPRINT_HEX.test(fields.requestFingerprint) ||
    !Number.isInteger(fields.responseStatus) ||
    fields.responseStatus < 200 ||
    fields.responseStatus > 299 ||
    !Number.isSafeInteger(fields.replayExpiresAtEpochMs) ||
    fields.replayExpiresAtEpochMs < 0
  ) {
    throw new CryptoError('invalid_input');
  }

  // Throws JsonValidationError for an oversized or secret-looking guard, before any crypto runs.
  validateJson(fields.replayGuard, REPLAY_GUARD_POLICY);

  return Buffer.from(
    canonicalJson(
      [
      REPLAY_FORMAT_VERSION,
      fields.recordId,
      fields.scopeType,
      fields.scopeId,
      fields.operationId,
      fields.idempotencyKey,
      fields.requestFingerprint,
      cryptoKeyId,
      fields.replayGuard,
      fields.responseStatus,
      String(fields.replayExpiresAtEpochMs),
      ],
      AAD_POLICY,
    ),
    'utf8',
  );
}
