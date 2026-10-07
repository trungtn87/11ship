import { randomUUID } from 'node:crypto';
import { AppError, TechnicalError } from '../common/app-errors';
import { CryptoError } from '../crypto/crypto-error';
import { fingerprintsEqual, KeyVersion } from '../crypto/key-version';
import { Keyring } from '../crypto/keyring';
import { REPLAY_FORMAT_VERSION } from '../crypto/replay-aad';
import { LOGICAL_REQUEST_POLICY, REPLAY_GUARD_POLICY, REPLAY_PAYLOAD_POLICY } from '../shared/json/json-policy';
import { JsonValue, validateJson } from '../shared/json/safe-json';
import { idempotencyLockKey, LockKey } from '../shared/lock-key';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import {
  assertIdempotencyConfig,
  IdempotencyConfig,
  IdempotencyTtl,
  isValidTtl,
} from './idempotency-config';
import { parseIdempotencyKey } from './idempotency-key';
import { IdempotencyRecord, IdempotencyTuple } from './idempotency-record';
import {
  deleteRecord,
  freshClockMs,
  insertRecord,
  selectRecordForUpdate,
} from './idempotency-repository';

export type JsonObject = { [key: string]: JsonValue };

/**
 * Hook of a SENSITIVE replay (ADR-003 section 4.3, 13.2). It receives the SAME TransactionContext as
 * the executor and the non-secret replay guard stored with the record. It must lock whatever rows decide
 * the authorization (a plain SELECT is not enough), read the state AFTER the lock, keep the locks until
 * the transaction ends and stay read-only. It allows the replay by resolving to exactly `true`; to deny
 * it throws the module's own error. Anything else is treated as a denial. The replay payload is not
 * decrypted until the hook has allowed it.
 */
export type ReplayAuthorizationHook = (
  context: TransactionContext,
  replayGuard: JsonObject,
) => Promise<true>;

export type ReplayPolicy =
  | { readonly kind: 'non-sensitive' }
  | { readonly kind: 'sensitive'; readonly authorize: ReplayAuthorizationHook };

export interface IdempotentRequest {
  /** Server-derived scope (never taken from the client). */
  readonly scopeType: string;
  readonly scopeId: string;
  /** Stable command name, not a free-form URL. */
  readonly operationId: string;
  /** The raw `Idempotency-Key` header value. Missing -> IDEMPOTENCY_KEY_REQUIRED; malformed -> INVALID. */
  readonly idempotencyKey: string | readonly string[] | undefined;
  /**
   * The logical request, declared explicitly by the operation adapter after validation/normalization.
   * Everything that influences a side effect or the response must be part of it. It may legitimately
   * contain a password or proof: it is only HMAC-fingerprinted, never stored or logged.
   */
  readonly logicalRequest: unknown;
  readonly replay: ReplayPolicy;
  /** Server-side per-operation TTL override (1 <= replay <= dedupe <= 604800 s). Defaults to config. */
  readonly ttl?: IdempotencyTtl;
}

/** What the business callback returns. */
export interface IdempotentResult {
  /** HTTP status. Only 2xx is ever persisted; anything else rolls the transaction back. */
  readonly status: number;
  /** Small non-secret identifiers for the replay authorization hook (key names are screened). */
  readonly replayGuard: JsonObject;
  /** The logical response. It may contain a secret (an access token): it is stored only encrypted. */
  readonly payload: JsonValue;
}

export interface IdempotentOutcome {
  readonly status: number;
  readonly payload: JsonValue;
  /** True when the result was decrypted from an earlier committed execution (callback not run). */
  readonly replayed: boolean;
  /** False only for a non-2xx callback result: rolled back, nothing persisted, key not consumed. */
  readonly persisted: boolean;
}

/**
 * The only thing the executor needs from the transaction layer. TransactionManager satisfies it; unit
 * tests supply a scripted stand-in. Participants (the business callback) never see it.
 */
export type TransactionRunner = Pick<TransactionManager, 'withTransaction'>;

export interface IdempotencyExecutorOptions {
  /**
   * Replaces the advisory-lock derivation. Production never sets it; tests use it to force two
   * different logical keys onto the same advisory pair and prove that only the exact UNIQUE key
   * decides correctness.
   */
  readonly lockKey?: (tuple: IdempotencyTuple) => LockKey;
}

/** Carries a non-2xx callback result out of the transaction so that it is rolled back. */
class NotPersistedResult extends Error {
  readonly outcome: IdempotentOutcome;

  constructor(outcome: IdempotentOutcome) {
    super('Non-2xx result is not persisted');
    this.name = 'NotPersistedResult';
    this.outcome = outcome;
  }
}

interface PreparedRequest {
  readonly tuple: IdempotencyTuple;
  readonly ttl: IdempotencyTtl;
}

const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;
const MAX_SCOPE_TYPE_LENGTH = 64;
const MAX_SCOPE_ID_LENGTH = 128;
const MAX_OPERATION_ID_LENGTH = 128;

function boundedText(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) {
    // A programming error of the adapter (these values are server-derived), never client input.
    throw new TypeError('invalid idempotency identity');
  }
  return value;
}

function isLockNotAvailable(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === '55P03'
  );
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Idempotency executor (ADR-003 sections 3, 4, 5, 13). It is a COORDINATOR: it owns the whole
 * transaction through TransactionManager and runs the business callback inside it.
 *
 * Protocol, in one transaction:
 *  1. derive the two-int32 advisory key of the exact tuple;
 *  2. lock_timeout := advisory wait; pg_advisory_xact_lock(int,int). Only 55P03 raised by THIS
 *     statement becomes IDEMPOTENCY_BUSY;
 *  3. lock_timeout := business lock budget, right after the lock is held;
 *  4. SELECT the exact record FOR UPDATE; take a fresh PostgreSQL clock_timestamp();
 *  5. dedupe expired -> delete it here and treat the request as a new window; otherwise a live record is
 *     handled with ITS OWN crypto_key_id: fingerprint, reuse/replay-expired checks, structure check,
 *     authorization hook, fresh time, then decrypt;
 *  6. no record -> capture ONE active key version, fingerprint, run the callback exactly once, and persist
 *     the encrypted result in the same transaction as the business mutation.
 * It never retries the callback. Correctness never depends on the advisory lock (a hash collision only
 * serializes unrelated keys): the exact UNIQUE tuple and the exact-row SELECT decide.
 */
export class IdempotencyExecutor {
  readonly #manager: TransactionRunner;
  readonly #keyring: Keyring;
  readonly #config: IdempotencyConfig;
  readonly #lockKey: (tuple: IdempotencyTuple) => LockKey;

  constructor(
    manager: TransactionRunner,
    keyring: Keyring,
    config: IdempotencyConfig,
    options: IdempotencyExecutorOptions = {},
  ) {
    assertIdempotencyConfig(config);
    this.#manager = manager;
    this.#keyring = keyring;
    this.#config = config;
    this.#lockKey =
      options.lockKey ??
      ((tuple) =>
        idempotencyLockKey(tuple.scopeType, tuple.scopeId, tuple.operationId, tuple.idempotencyKey));
  }

  async execute(
    request: IdempotentRequest,
    work: (context: TransactionContext) => Promise<IdempotentResult>,
  ): Promise<IdempotentOutcome> {
    // Everything that can be refused without a database is refused before a connection is taken.
    const prepared = this.#prepare(request);
    try {
      return await this.#manager.withTransaction((context) =>
        this.#run(context, prepared, request, work),
      );
    } catch (error) {
      if (error instanceof NotPersistedResult) {
        // The transaction was rolled back by the manager; hand the callback's own result back.
        return error.outcome;
      }
      throw error;
    }
  }

  #prepare(request: IdempotentRequest): PreparedRequest {
    const idempotencyKey = parseIdempotencyKey(request.idempotencyKey);
    const tuple: IdempotencyTuple = {
      scopeType: boundedText(request.scopeType, MAX_SCOPE_TYPE_LENGTH),
      scopeId: boundedText(request.scopeId, MAX_SCOPE_ID_LENGTH),
      operationId: boundedText(request.operationId, MAX_OPERATION_ID_LENGTH),
      idempotencyKey,
    };
    if (request.replay.kind === 'sensitive' && typeof request.replay.authorize !== 'function') {
      throw new TypeError('a sensitive replay requires an authorization hook');
    }
    const ttl = request.ttl ?? {
      replaySeconds: this.#config.replayTtlSeconds,
      dedupeSeconds: this.#config.dedupeTtlSeconds,
    };
    if (!isValidTtl(ttl.replaySeconds, ttl.dedupeSeconds)) {
      throw new RangeError('invalid idempotency TTL');
    }
    // Rejects an undefined/non-finite/cyclic/oversized logical request before BEGIN.
    validateJson(request.logicalRequest, LOGICAL_REQUEST_POLICY);
    return { tuple, ttl };
  }

  async #run(
    context: TransactionContext,
    prepared: PreparedRequest,
    request: IdempotentRequest,
    work: (context: TransactionContext) => Promise<IdempotentResult>,
  ): Promise<IdempotentOutcome> {
    await this.#acquireAdvisoryLock(context, prepared.tuple);

    const existing = await selectRecordForUpdate(context, prepared.tuple);
    // Fresh clock AFTER the locks: the lock wait may have lasted past an expiry. Never now().
    const nowMs = await freshClockMs(context);

    if (existing === undefined) {
      return this.#executeNew(context, prepared, request, work);
    }
    if (existing.dedupeExpiresAtMs <= nowMs) {
      // Cleanup has not run yet. The expired row is removed under the lock we hold and the request
      // opens a new idempotency window. Done BEFORE any historical-key lookup (ADR-003 13.4).
      await deleteRecord(context, existing.recordId);
      return this.#executeNew(context, prepared, request, work);
    }
    return this.#replay(context, request, existing, nowMs);
  }

  async #acquireAdvisoryLock(context: TransactionContext, tuple: IdempotencyTuple): Promise<void> {
    const [first, second] = this.#lockKey(tuple);
    for (const part of [first, second]) {
      if (!Number.isInteger(part) || part < INT32_MIN || part > INT32_MAX) {
        throw new TypeError('invalid advisory lock key');
      }
    }

    // SET LOCAL semantics (is_local = true): the value dies with the transaction.
    await context.query("SELECT set_config('lock_timeout', $1, true)", [
      `${this.#config.advisoryWaitMs}ms`,
    ]);
    try {
      await context.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [first, second]);
    } catch (error) {
      // ONLY a lock timeout of this very statement means "another request holds this key". A lock
      // timeout later (business or exact-row lock), a statement timeout or an outage is not BUSY.
      if (isLockNotAvailable(error)) {
        throw new AppError('IDEMPOTENCY_BUSY');
      }
      throw error;
    }
    // The advisory budget must not leak into business locks: restore the business budget now.
    await context.query("SELECT set_config('lock_timeout', $1, true)", [
      `${this.#config.businessLockTimeoutMs}ms`,
    ]);
  }

  async #replay(
    context: TransactionContext,
    request: IdempotentRequest,
    record: IdempotencyRecord,
    nowMs: number,
  ): Promise<IdempotentOutcome> {
    // A live record is always handled with the key version it was created with, never the active one.
    const version = this.#keyring.version(record.cryptoKeyId);
    if (version === undefined) {
      // Fail closed. The callback is not run again and the record is not touched.
      throw new AppError('IDEMPOTENCY_KEY_UNAVAILABLE');
    }

    const incoming = version.fingerprint(request.logicalRequest);
    if (!fingerprintsEqual(record.requestFingerprint, incoming)) {
      throw new AppError('IDEMPOTENCY_KEY_REUSED');
    }

    // The tombstone stays; the secret is not served after the replay window.
    if (record.replayExpiresAtMs <= nowMs) {
      throw new AppError('IDEMPOTENCY_REPLAY_EXPIRED');
    }

    // Structure of a record that must still be replayable. Corruption fails closed: no callback and no
    // new execution (the key stays consumed).
    if (
      record.replayFormatVersion !== REPLAY_FORMAT_VERSION ||
      record.replayCiphertext === null ||
      record.replayIv === null ||
      record.replayTag === null ||
      !isPlainObject(record.replayGuard)
    ) {
      throw new CryptoError('invalid_envelope');
    }

    if (request.replay.kind === 'sensitive') {
      // The fingerprint matched; now the CURRENT authorization is checked, with the same context so
      // the rows it locks stay locked until this transaction ends. Nothing is decrypted before this.
      const decision = await request.replay.authorize(context, record.replayGuard);
      if (decision !== true) {
        throw new TechnicalError('internal', 'Replay authorization did not allow the replay');
      }
    }

    // Last fresh time, immediately before decrypting: expiry (equality counts as expired) is decided
    // after any lock wait the hook had.
    const finalMs = await freshClockMs(context);
    if (record.replayExpiresAtMs <= finalMs) {
      throw new AppError('IDEMPOTENCY_REPLAY_EXPIRED');
    }

    const payload = this.#decrypt(version, record);
    return { status: record.responseStatus, payload, replayed: true, persisted: true };
  }

  #decrypt(version: KeyVersion, record: IdempotencyRecord): JsonValue {
    if (record.replayCiphertext === null || record.replayIv === null || record.replayTag === null) {
      throw new CryptoError('invalid_envelope');
    }
    // Any failure (tag, IV, ciphertext, guard, status, expiry or identity mismatch) is a CryptoError:
    // the record is not deleted and the callback is not run.
    return version.decryptReplay(
      {
        replayFormatVersion: record.replayFormatVersion,
        recordId: record.recordId,
        scopeType: record.scopeType,
        scopeId: record.scopeId,
        operationId: record.operationId,
        idempotencyKey: record.idempotencyKey,
        requestFingerprint: record.requestFingerprint,
        replayGuard: record.replayGuard,
        responseStatus: record.responseStatus,
        replayExpiresAtEpochMs: record.replayExpiresAtMs,
      },
      { iv: record.replayIv, tag: record.replayTag, ciphertext: record.replayCiphertext },
    );
  }

  async #executeNew(
    context: TransactionContext,
    prepared: PreparedRequest,
    request: IdempotentRequest,
    work: (context: TransactionContext) => Promise<IdempotentResult>,
  ): Promise<IdempotentOutcome> {
    // ONE key version for both the HMAC and the encryption of this record.
    const version = this.#keyring.active();
    const fingerprint = version.fingerprint(request.logicalRequest);

    // The business callback runs exactly once; this class never calls it again.
    const result = await work(context);

    if (!Number.isInteger(result.status)) {
      throw new TypeError('invalid callback status');
    }
    if (result.status < 200 || result.status > 299) {
      // Only a committed 2xx success is persisted. A failure result must not leave business effects
      // behind, so it is thrown out of the transaction (rolled back) and handed back by execute().
      throw new NotPersistedResult({
        status: result.status,
        payload: result.payload,
        replayed: false,
        persisted: false,
      });
    }
    if (!isPlainObject(result.replayGuard)) {
      throw new TypeError('invalid replay guard');
    }

    // Validated BEFORE persisting: an oversized (64 KiB) or malformed replay payload, or a
    // secret-looking guard key, rejects the whole transaction instead of storing something unusable.
    const guard = validateJson(result.replayGuard, REPLAY_GUARD_POLICY);
    const payloadJson = validateJson(result.payload, REPLAY_PAYLOAD_POLICY).canonical;
    const payload = JSON.parse(payloadJson) as JsonValue;

    // TTLs run from the moment the record is completed, close to commit.
    const createdAtMs = await freshClockMs(context);
    const replayExpiresAtMs = createdAtMs + prepared.ttl.replaySeconds * 1000;
    const dedupeExpiresAtMs = createdAtMs + prepared.ttl.dedupeSeconds * 1000;
    const recordId = randomUUID();

    const envelope = version.encryptReplay(
      {
        replayFormatVersion: REPLAY_FORMAT_VERSION,
        recordId,
        scopeType: prepared.tuple.scopeType,
        scopeId: prepared.tuple.scopeId,
        operationId: prepared.tuple.operationId,
        idempotencyKey: prepared.tuple.idempotencyKey,
        requestFingerprint: fingerprint,
        replayGuard: JSON.parse(guard.canonical) as JsonObject,
        responseStatus: result.status,
        replayExpiresAtEpochMs: replayExpiresAtMs,
      },
      payload,
    );

    await insertRecord(context, {
      ...prepared.tuple,
      recordId,
      requestFingerprint: fingerprint,
      cryptoKeyId: version.id,
      responseStatus: result.status,
      replayFormatVersion: REPLAY_FORMAT_VERSION,
      replayGuardJson: guard.canonical,
      replayCiphertext: envelope.ciphertext,
      replayIv: envelope.iv,
      replayTag: envelope.tag,
      createdAtMs,
      replayExpiresAtMs,
      dedupeExpiresAtMs,
    });

    return { status: result.status, payload, replayed: false, persisted: true };
  }
}
