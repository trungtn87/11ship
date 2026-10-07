import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { IdempotencyRecord, IdempotencyTuple, parseRecordRow } from './idempotency-record';

// All SQL of app.idempotency_records lives here. Every function takes the TransactionContext of the
// coordinating transaction and never opens a connection or a transaction of its own.

// Expiry instants are read as epoch MILLISECONDS (floor of an exact numeric), which is the form bound
// into the AAD. The table CHECKs that every instant is millisecond-aligned, so this is lossless.
const RECORD_COLUMNS = `
  record_id, scope_type, scope_id, operation_id, idempotency_key, request_fingerprint, crypto_key_id,
  response_status, replay_format_version, replay_guard, replay_ciphertext, replay_iv, replay_tag,
  floor(extract(epoch FROM created_at) * 1000)::bigint AS created_at_ms,
  floor(extract(epoch FROM replay_expires_at) * 1000)::bigint AS replay_expires_at_ms,
  floor(extract(epoch FROM dedupe_expires_at) * 1000)::bigint AS dedupe_expires_at_ms`;

/**
 * Locks and returns the record of this exact tuple, if any. FOR UPDATE conflicts with cleanup and
 * with any other writer of the row. A lock timeout here is raised as the raw driver error (SQLSTATE
 * 55P03) and is deliberately NOT turned into IDEMPOTENCY_BUSY: only the advisory acquisition is.
 */
export async function selectRecordForUpdate(
  context: TransactionContext,
  tuple: IdempotencyTuple,
): Promise<IdempotencyRecord | undefined> {
  const result = await context.query(
    `SELECT ${RECORD_COLUMNS}
       FROM app.idempotency_records
      WHERE scope_type = $1 AND scope_id = $2 AND operation_id = $3 AND idempotency_key = $4
        FOR UPDATE`,
    [tuple.scopeType, tuple.scopeId, tuple.operationId, tuple.idempotencyKey],
  );
  if (result.rows.length > 1) {
    // Impossible with the UNIQUE constraint; refuse to guess between two rows.
    throw new TechnicalError('internal', 'Idempotency lookup returned more than one record');
  }
  const row = result.rows[0];
  return row === undefined ? undefined : parseRecordRow(row);
}

export async function deleteRecord(context: TransactionContext, recordId: string): Promise<void> {
  const result = await context.query('DELETE FROM app.idempotency_records WHERE record_id = $1', [
    recordId,
  ]);
  if (result.rowCount !== 1) {
    throw new TechnicalError('internal', 'Expired idempotency record could not be removed');
  }
}

export interface NewIdempotencyRecord extends IdempotencyTuple {
  readonly recordId: string;
  readonly requestFingerprint: string;
  readonly cryptoKeyId: string;
  readonly responseStatus: number;
  readonly replayFormatVersion: number;
  /** Canonical JSON text of the replay guard. */
  readonly replayGuardJson: string;
  readonly replayCiphertext: Buffer;
  readonly replayIv: Buffer;
  readonly replayTag: Buffer;
  readonly createdAtMs: number;
  readonly replayExpiresAtMs: number;
  readonly dedupeExpiresAtMs: number;
}

export async function insertRecord(
  context: TransactionContext,
  record: NewIdempotencyRecord,
): Promise<void> {
  // Instants are written from exact epoch milliseconds (no floating-point rounding of a timestamp).
  await context.query(
    `INSERT INTO app.idempotency_records (
       record_id, scope_type, scope_id, operation_id, idempotency_key, request_fingerprint,
       crypto_key_id, response_status, replay_format_version, replay_guard,
       replay_ciphertext, replay_iv, replay_tag, created_at, replay_expires_at, dedupe_expires_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13,
       timestamptz 'epoch' + ($14::bigint * interval '1 millisecond'),
       timestamptz 'epoch' + ($15::bigint * interval '1 millisecond'),
       timestamptz 'epoch' + ($16::bigint * interval '1 millisecond')
     )`,
    [
      record.recordId,
      record.scopeType,
      record.scopeId,
      record.operationId,
      record.idempotencyKey,
      record.requestFingerprint,
      record.cryptoKeyId,
      record.responseStatus,
      record.replayFormatVersion,
      record.replayGuardJson,
      record.replayCiphertext,
      record.replayIv,
      record.replayTag,
      String(record.createdAtMs),
      String(record.replayExpiresAtMs),
      String(record.dedupeExpiresAtMs),
    ],
  );
}

/**
 * Fresh PostgreSQL wall clock in epoch milliseconds. clock_timestamp() moves during the
 * transaction, unlike now()/CURRENT_TIMESTAMP (frozen at BEGIN), so it stays correct after a lock
 * wait. Every instant compared with it is millisecond-aligned, so "expires_at <= fresh" on the
 * floored value is exactly "expires_at <= fresh" on the real clock; equality counts as expired.
 */
export async function freshClockMs(context: TransactionContext): Promise<number> {
  const result = await context.query<{ now_ms: string | number }>(
    'SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms',
  );
  const raw = result.rows[0]?.now_ms;
  const value = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TechnicalError('internal', 'Database clock returned an unexpected value');
  }
  return value;
}
