import { randomUUID } from 'node:crypto';
import { AppError, TechnicalError } from '../common/app-errors';
import { isSqlState } from '../common/safe-error';
import { fingerprintsEqual } from '../crypto/key-version';
import { Keyring } from '../crypto/keyring';
import { REPLAY_FORMAT_VERSION } from '../crypto/replay-aad';
import { REPLAY_GUARD_POLICY, REPLAY_PAYLOAD_POLICY } from '../shared/json/json-policy';
import { JsonValue, validateJson } from '../shared/json/safe-json';
import { idempotencyLockKey, LockKey } from '../shared/lock-key';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import {
  IdempotencyExecuteRequest,
  IdempotencyOptions,
  IdempotencyOutcome,
  IdempotencyWorkResult,
} from './idempotency.types';
import { normalizeIdempotencyKey } from './idempotency-key';
import { IdempotencyOperationRegistry } from './idempotency-operation-registry';

const SCOPE_TYPE_MAX = 64;
const SCOPE_ID_MAX = 256;
const OPERATION_ID_MAX = 128;
const KEY_ID_MAX = 64;
const FINGERPRINT_HEX = /^[0-9a-f]{64}$/;

type LockKeyFn = (
  scopeType: string,
  scopeId: string,
  operationId: string,
  idempotencyKey: string,
) => LockKey;

interface RecordRow {
  record_id: string;
  scope_type: string;
  scope_id: string;
  operation_id: string;
  idempotency_key: string;
  request_fingerprint: string;
  crypto_key_id: string;
  response_status: number;
  replay_format_version: number;
  replay_guard: JsonValue;
  replay_ciphertext: Buffer | null;
  replay_iv: Buffer | null;
  replay_tag: Buffer | null;
  replay_expires_at_epoch_ms: string;
  dedupe_expires_at_epoch_ms: string;
}

interface ClockRow {
  epoch_ms: string;
}

function safeEpochMs(raw: string): number {
  if (!/^\d{1,16}$/.test(raw)) {
    throw new TechnicalError('internal', 'Invalid database clock value');
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TechnicalError('internal', 'Invalid database clock value');
  }
  return value;
}

function validateIdentityPart(value: string, max: number): void {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) {
    throw new TechnicalError('internal', 'Invalid idempotency identity');
  }
}

function sqlState(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return isSqlState(code) ? code : undefined;
}

function canonicalJsonValue(value: unknown, guard: boolean): JsonValue {
  const validated = validateJson(value, guard ? REPLAY_GUARD_POLICY : REPLAY_PAYLOAD_POLICY);
  return JSON.parse(validated.canonical) as JsonValue;
}

/**
 * M00-C1A1 idempotency coordinator. It owns the outer transaction and lock protocol; business code
 * receives only TransactionContext. No request body or plaintext replay secret is persisted.
 */
export class IdempotencyExecutor {
  readonly #transactions: TransactionManager;
  readonly #keyring: Keyring;
  readonly #options: IdempotencyOptions;
  readonly #lockKey: LockKeyFn;
  readonly #operationRegistry: IdempotencyOperationRegistry;

  constructor(
    transactions: TransactionManager,
    keyring: Keyring,
    options: IdempotencyOptions,
    operationRegistry: IdempotencyOperationRegistry = new IdempotencyOperationRegistry(),
    lockKey: LockKeyFn = idempotencyLockKey,
  ) {
    if (
      !Number.isSafeInteger(options.advisoryWaitMs) ||
      options.advisoryWaitMs < 1 ||
      options.advisoryWaitMs > 5000 ||
      !Number.isSafeInteger(options.businessLockTimeoutMs) ||
      options.businessLockTimeoutMs < 1 ||
      options.businessLockTimeoutMs > 30000 ||
      !Number.isSafeInteger(options.replayTtlSeconds) ||
      !Number.isSafeInteger(options.dedupeTtlSeconds) ||
      options.replayTtlSeconds < 1 ||
      options.replayTtlSeconds > options.dedupeTtlSeconds ||
      options.dedupeTtlSeconds > 604800
    ) {
      throw new RangeError('invalid idempotency options');
    }
    this.#transactions = transactions;
    this.#keyring = keyring;
    this.#options = Object.freeze({ ...options });
    this.#lockKey = lockKey;
    this.#operationRegistry = operationRegistry;
  }

  execute(
    request: IdempotencyExecuteRequest,
    work: (context: TransactionContext) => Promise<IdempotencyWorkResult>,
  ): Promise<IdempotencyOutcome> {
    validateIdentityPart(request.scopeType, SCOPE_TYPE_MAX);
    validateIdentityPart(request.scopeId, SCOPE_ID_MAX);
    validateIdentityPart(request.operationId, OPERATION_ID_MAX);
    const key = normalizeIdempotencyKey(request.idempotencyKey);
    if (request.sensitiveReplay === true && request.replayAuthorization === undefined) {
      throw new TechnicalError('internal', 'Sensitive replay requires authorization hook');
    }

    return this.#transactions.withTransaction(async (context) => {
      await this.#acquireKeyLock(context, request.scopeType, request.scopeId, request.operationId, key);

      let existing = await this.#selectExact(context, request.scopeType, request.scopeId, request.operationId, key);
      if (existing !== undefined) {
        const now = await this.#clock(context);
        if (safeEpochMs(existing.dedupe_expires_at_epoch_ms) <= now) {
          await context.query('DELETE FROM app.idempotency_records WHERE record_id = $1::uuid', [
            existing.record_id,
          ]);
          existing = undefined;
        }
      }

      if (existing !== undefined) {
        return this.#replayExisting(context, request, key, existing);
      }

      const version = this.#keyring.active();
      const fingerprint = version.fingerprint(request.logicalRequest);
      const produced = await work(context);
      if (
        !Number.isInteger(produced.responseStatus) ||
        produced.responseStatus < 200 ||
        produced.responseStatus > 299
      ) {
        throw new TechnicalError('internal', 'Idempotency records require a 2xx success');
      }

      const replayGuard = canonicalJsonValue(produced.replayGuard, true);
      const responseBody = canonicalJsonValue(produced.responseBody, false);
      const completedAtMs = await this.#clock(context);
      const ttl = this.#operationRegistry.resolve(request.operationId, {
        replayTtlSeconds: this.#options.replayTtlSeconds,
        dedupeTtlSeconds: this.#options.dedupeTtlSeconds,
      });
      const replayExpiresAtMs = completedAtMs + ttl.replayTtlSeconds * 1000;
      const dedupeExpiresAtMs = completedAtMs + ttl.dedupeTtlSeconds * 1000;
      const recordId = randomUUID();

      const fields = {
        replayFormatVersion: REPLAY_FORMAT_VERSION,
        recordId,
        scopeType: request.scopeType,
        scopeId: request.scopeId,
        operationId: request.operationId,
        idempotencyKey: key,
        requestFingerprint: fingerprint,
        replayGuard,
        responseStatus: produced.responseStatus,
        replayExpiresAtEpochMs: replayExpiresAtMs,
      } as const;
      const envelope = version.encryptReplay(fields, responseBody);

      await context.query(
        `INSERT INTO app.idempotency_records (
          record_id, scope_type, scope_id, operation_id, idempotency_key,
          request_fingerprint, crypto_key_id, response_status, replay_format_version,
          replay_guard, replay_ciphertext, replay_iv, replay_tag,
          created_at, replay_expires_at, dedupe_expires_at
        ) VALUES (
          $1::uuid, $2, $3, $4, $5::uuid,
          $6, $7, $8, $9,
          $10::jsonb, $11::bytea, $12::bytea, $13::bytea,
          TIMESTAMPTZ 'epoch' + $14::bigint * INTERVAL '1 millisecond',
          TIMESTAMPTZ 'epoch' + $15::bigint * INTERVAL '1 millisecond',
          TIMESTAMPTZ 'epoch' + $16::bigint * INTERVAL '1 millisecond'
        )`,
        [
          recordId,
          request.scopeType,
          request.scopeId,
          request.operationId,
          key,
          fingerprint,
          version.id,
          produced.responseStatus,
          REPLAY_FORMAT_VERSION,
          JSON.stringify(replayGuard),
          envelope.ciphertext,
          envelope.iv,
          envelope.tag,
          completedAtMs,
          replayExpiresAtMs,
          dedupeExpiresAtMs,
        ],
      );

      return {
        responseStatus: produced.responseStatus,
        responseBody,
        replayed: false,
      };
    });
  }

  async #replayExisting(
    context: TransactionContext,
    request: IdempotencyExecuteRequest,
    key: string,
    record: RecordRow,
  ): Promise<IdempotencyOutcome> {
    const version = this.#keyring.version(record.crypto_key_id);
    if (version === undefined) {
      throw new AppError('IDEMPOTENCY_KEY_UNAVAILABLE');
    }
    if (
      record.replay_format_version !== REPLAY_FORMAT_VERSION ||
      record.crypto_key_id.length < 1 ||
      record.crypto_key_id.length > KEY_ID_MAX ||
      !FINGERPRINT_HEX.test(record.request_fingerprint)
    ) {
      throw new TechnicalError('internal', 'Invalid idempotency record');
    }

    const incoming = version.fingerprint(request.logicalRequest);
    if (!fingerprintsEqual(incoming, record.request_fingerprint)) {
      throw new AppError('IDEMPOTENCY_KEY_REUSED');
    }

    let now = await this.#clock(context);
    const replayExpiry = safeEpochMs(record.replay_expires_at_epoch_ms);
    if (replayExpiry <= now) {
      throw new AppError('IDEMPOTENCY_REPLAY_EXPIRED');
    }
    if (
      record.replay_ciphertext === null ||
      record.replay_iv === null ||
      record.replay_tag === null
    ) {
      throw new TechnicalError('internal', 'Replay payload missing before expiry');
    }

    if (request.replayAuthorization !== undefined) {
      await request.replayAuthorization(context, record.replay_guard);
    }

    // Authorization may have waited on business row locks. Re-check with fresh DB time immediately
    // before decrypt; equality is expired.
    now = await this.#clock(context);
    if (replayExpiry <= now) {
      throw new AppError('IDEMPOTENCY_REPLAY_EXPIRED');
    }

    const fields = {
      replayFormatVersion: record.replay_format_version,
      recordId: record.record_id,
      scopeType: record.scope_type,
      scopeId: record.scope_id,
      operationId: record.operation_id,
      idempotencyKey: key,
      requestFingerprint: record.request_fingerprint,
      replayGuard: record.replay_guard,
      responseStatus: record.response_status,
      replayExpiresAtEpochMs: replayExpiry,
    } as const;

    const body = version.decryptReplay(fields, {
      ciphertext: record.replay_ciphertext,
      iv: record.replay_iv,
      tag: record.replay_tag,
    });
    return { responseStatus: record.response_status, responseBody: body, replayed: true };
  }

  async #acquireKeyLock(
    context: TransactionContext,
    scopeType: string,
    scopeId: string,
    operationId: string,
    key: string,
  ): Promise<void> {
    const [a, b] = this.#lockKey(scopeType, scopeId, operationId, key);
    await context.query("SELECT set_config('lock_timeout', $1, true)", [
      `${this.#options.advisoryWaitMs}ms`,
    ]);
    try {
      await context.query('SELECT pg_advisory_xact_lock($1::integer, $2::integer)', [a, b]);
    } catch (error) {
      if (sqlState(error) === '55P03') {
        throw new AppError('IDEMPOTENCY_BUSY');
      }
      throw error;
    }
    await context.query("SELECT set_config('lock_timeout', $1, true)", [
      `${this.#options.businessLockTimeoutMs}ms`,
    ]);
  }

  async #selectExact(
    context: TransactionContext,
    scopeType: string,
    scopeId: string,
    operationId: string,
    key: string,
  ): Promise<RecordRow | undefined> {
    const result = await context.query<RecordRow>(
      `SELECT
        record_id::text,
        scope_type,
        scope_id,
        operation_id,
        idempotency_key::text,
        request_fingerprint,
        crypto_key_id,
        response_status,
        replay_format_version,
        replay_guard,
        replay_ciphertext,
        replay_iv,
        replay_tag,
        floor(extract(epoch FROM replay_expires_at) * 1000)::bigint::text AS replay_expires_at_epoch_ms,
        floor(extract(epoch FROM dedupe_expires_at) * 1000)::bigint::text AS dedupe_expires_at_epoch_ms
      FROM app.idempotency_records
      WHERE scope_type = $1
        AND scope_id = $2
        AND operation_id = $3
        AND idempotency_key = $4::uuid
      FOR UPDATE`,
      [scopeType, scopeId, operationId, key],
    );
    return result.rows[0];
  }

  async #clock(context: TransactionContext): Promise<number> {
    const result = await context.query<ClockRow>(
      'SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint::text AS epoch_ms',
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new TechnicalError('internal', 'Database clock unavailable');
    }
    return safeEpochMs(row.epoch_ms);
  }
}
