import { randomBytes, randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { DatabaseConfig } from '../../../apps/backend/src/config/app-config';
import { AppError } from '../../../apps/backend/src/common/app-errors';
import { fixtureKeyring } from '../../../apps/backend/src/crypto/test-keys.fixture';
import { Keyring } from '../../../apps/backend/src/crypto/keyring';
import { IdempotencyCleanup } from '../../../apps/backend/src/idempotency/idempotency-cleanup';
import {
  DEFAULT_IDEMPOTENCY_CONFIG,
  IdempotencyConfig,
} from '../../../apps/backend/src/idempotency/idempotency-config';
import {
  IdempotencyExecutor,
  IdempotencyExecutorOptions,
  IdempotentRequest,
  IdempotentResult,
  ReplayAuthorizationHook,
  TransactionRunner,
} from '../../../apps/backend/src/idempotency/idempotency-executor';
import { idempotencyLockKey } from '../../../apps/backend/src/shared/lock-key';
import { poolClientSource } from '../../../apps/backend/src/transaction/pg-client-source';
import { TransactionContext } from '../../../apps/backend/src/transaction/transaction-context';
import { eventually } from './async-helpers';
import { loadIntegrationConfig } from './test-helpers';
import { managerFor, testPool } from './transaction-fixtures';

// Shared fixtures of the M00-C1A1 integration suites. Everything here talks to the REAL PostgreSQL
// test database. Rows of app.idempotency_records are isolated by a random scope_type per harness, and
// the business tables live in a random schema that is dropped afterwards.

export const SECRET_PASSWORD = 'SECRET_MARKER_PASSWORD_7e41';
export const SECRET_TOKEN = 'SECRET_MARKER_ACCESS_TOKEN_93ac';

export interface IdempotencyHarness {
  readonly pool: Pool;
  readonly schema: string;
  /** Random scope_type owned by this harness; cleanup deletes only rows with it. */
  readonly scopeType: string;
  readonly items: string;
  readonly grants: string;
  readonly manager: TransactionRunner;
  executor(options?: ExecutorOptions): IdempotencyExecutor;
  cleanup(): IdempotencyCleanup;
  close(): Promise<void>;
}

export interface ExecutorOptions extends IdempotencyExecutorOptions {
  readonly config?: Partial<IdempotencyConfig>;
  readonly keyring?: Keyring;
  readonly manager?: TransactionRunner;
}

export async function createHarness(
  poolOverrides: Partial<DatabaseConfig> = {},
): Promise<IdempotencyHarness> {
  const config = loadIntegrationConfig();
  const pool = testPool(config.database, { poolMax: 6, ...poolOverrides });
  const schema = `idem_${randomBytes(6).toString('hex')}`;
  const scopeType = `it_${randomBytes(6).toString('hex')}`;
  const items = `${schema}.items`;
  const grants = `${schema}.grants`;

  await pool.query(`CREATE SCHEMA ${schema}`);
  await pool.query(
    `CREATE TABLE ${items} (id bigserial PRIMARY KEY, label text NOT NULL, scope_id text NOT NULL)`,
  );
  // Authorization state a sensitive replay depends on (stand-in for a session / proof / user row).
  await pool.query(
    `CREATE TABLE ${grants} (grant_id text PRIMARY KEY, owner_id text NOT NULL, revoked boolean NOT NULL DEFAULT false)`,
  );

  const manager = managerFor(poolClientSource(pool));

  return {
    pool,
    schema,
    scopeType,
    items,
    grants,
    manager,
    executor(options: ExecutorOptions = {}): IdempotencyExecutor {
      const { config: overrides, keyring, manager: custom, ...rest } = options;
      return new IdempotencyExecutor(
        custom ?? manager,
        keyring ?? fixtureKeyring('k1'),
        { ...DEFAULT_IDEMPOTENCY_CONFIG, ...overrides },
        rest,
      );
    },
    cleanup(): IdempotencyCleanup {
      return new IdempotencyCleanup(manager);
    },
    async close(): Promise<void> {
      try {
        await pool.query('DELETE FROM app.idempotency_records WHERE scope_type = $1', [scopeType]);
        if (/^idem_[0-9a-f]{12}$/.test(schema)) {
          await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        }
      } finally {
        await pool.end();
      }
    },
  };
}

export function newKey(): string {
  return randomUUID();
}

export function newScopeId(): string {
  return `s-${randomBytes(6).toString('hex')}`;
}

export interface RequestInput {
  readonly harness: IdempotencyHarness;
  readonly scopeId: string;
  readonly key: string;
  readonly operationId?: string;
  readonly logicalRequest?: unknown;
  readonly replay?: IdempotentRequest['replay'];
  readonly ttl?: IdempotentRequest['ttl'];
}

export function requestOf(input: RequestInput): IdempotentRequest {
  return {
    scopeType: input.harness.scopeType,
    scopeId: input.scopeId,
    operationId: input.operationId ?? 'fixture.create.v1',
    idempotencyKey: input.key,
    logicalRequest: input.logicalRequest ?? { label: 'one', password: SECRET_PASSWORD },
    replay: input.replay ?? { kind: 'non-sensitive' },
    ...(input.ttl === undefined ? {} : { ttl: input.ttl }),
  };
}

/** Business effect of the fixture operation: one row in the harness items table. */
export async function insertItem(
  harness: IdempotencyHarness,
  context: TransactionContext,
  scopeId: string,
  label = 'one',
): Promise<number> {
  const result = await context.query<{ id: string }>(
    `INSERT INTO ${harness.items} (label, scope_id) VALUES ($1, $2) RETURNING id`,
    [label, scopeId],
  );
  return Number(result.rows[0]?.id);
}

/** The fixture business callback: one insert, one secret in the replayable response. */
export function createItemWork(harness: IdempotencyHarness, scopeId: string, calls: { n: number }) {
  return async (context: TransactionContext): Promise<IdempotentResult> => {
    calls.n += 1;
    const id = await insertItem(harness, context, scopeId);
    return {
      status: 201,
      replayGuard: { grant_id: scopeId },
      payload: { item_id: id, access_token: SECRET_TOKEN },
    };
  };
}

export async function countItems(harness: IdempotencyHarness, scopeId: string): Promise<number> {
  const result = await harness.pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${harness.items} WHERE scope_id = $1`,
    [scopeId],
  );
  return result.rows[0]?.n ?? -1;
}

export interface StoredRecord {
  record_id: string;
  crypto_key_id: string;
  request_fingerprint: string;
  response_status: number;
  replay_guard: Record<string, unknown>;
  replay_ciphertext: Buffer | null;
  replay_iv: Buffer | null;
  replay_tag: Buffer | null;
  created_at: Date;
  replay_expires_at: Date;
  dedupe_expires_at: Date;
}

export async function recordsOf(
  harness: IdempotencyHarness,
  scopeId: string,
  key?: string,
): Promise<StoredRecord[]> {
  const result = await harness.pool.query<StoredRecord>(
    `SELECT record_id, crypto_key_id, request_fingerprint, response_status, replay_guard,
            replay_ciphertext, replay_iv, replay_tag, created_at, replay_expires_at, dedupe_expires_at
       FROM app.idempotency_records
      WHERE scope_type = $1 AND scope_id = $2 AND ($3::text IS NULL OR idempotency_key = $3::text)
      ORDER BY created_at, record_id`,
    [harness.scopeType, scopeId, key ?? null],
  );
  return result.rows;
}

export async function onlyRecord(
  harness: IdempotencyHarness,
  scopeId: string,
  key: string,
): Promise<StoredRecord> {
  const rows = await recordsOf(harness, scopeId, key);
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new Error(`expected exactly one idempotency record, found ${rows.length}`);
  }
  return rows[0];
}

/** Whole table as text, to prove that no plaintext secret is stored anywhere. */
export async function wholeTableText(harness: IdempotencyHarness, scopeId: string): Promise<string> {
  const result = await harness.pool.query<{ dump: string }>(
    `SELECT t::text AS dump FROM app.idempotency_records t WHERE scope_type = $1 AND scope_id = $2`,
    [harness.scopeType, scopeId],
  );
  return result.rows.map((row) => row.dump).join('\n');
}

/** Clock of the database server, in epoch ms (the only clock the executor trusts). */
export async function dbNowMs(pool: Pool): Promise<number> {
  const result = await pool.query<{ ms: string }>(
    'SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS ms',
  );
  return Number(result.rows[0]?.ms);
}

/** Waits (bounded, on the SERVER clock) until `instant` is no longer in the future. */
export async function waitUntilDbClockReaches(pool: Pool, instant: Date): Promise<void> {
  await eventually(
    async () => (await dbNowMs(pool)) >= instant.getTime(),
    `database clock reaches ${instant.toISOString()}`,
    15_000,
    20,
  );
}

/**
 * Moves a record's three instants back in time together. This keeps every table CHECK valid and
 * makes a window "elapse" instantly without sleeping. It must NOT be used on a record whose replay
 * will still be decrypted: replay_expires_at is bound into the AAD.
 */
export async function ageRecord(
  harness: IdempotencyHarness,
  recordId: string,
  seconds: number,
): Promise<void> {
  const result = await harness.pool.query(
    `UPDATE app.idempotency_records
        SET created_at = created_at - make_interval(secs => $2::double precision),
            replay_expires_at = replay_expires_at - make_interval(secs => $2::double precision),
            dedupe_expires_at = dedupe_expires_at - make_interval(secs => $2::double precision)
      WHERE record_id = $1 AND scope_type = $3`,
    [recordId, seconds, harness.scopeType],
  );
  if (result.rowCount !== 1) {
    throw new Error('record to age was not found');
  }
}

export interface LockKeyPair {
  readonly first: number;
  readonly second: number;
}

export function lockPairOf(
  scopeType: string,
  scopeId: string,
  operationId: string,
  key: string,
): LockKeyPair {
  const [first, second] = idempotencyLockKey(scopeType, scopeId, operationId, key);
  return { first, second };
}

/** An independent connection with an open transaction, used to hold locks while a request waits. */
export class LockHolder {
  readonly #client: PoolClient;
  #open = true;

  private constructor(client: PoolClient) {
    this.#client = client;
  }

  static async begin(pool: Pool): Promise<LockHolder> {
    const client = await pool.connect();
    await client.query('BEGIN');
    return new LockHolder(client);
  }

  async advisory(pair: LockKeyPair): Promise<void> {
    await this.#client.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [pair.first, pair.second]);
  }

  async lockRecordRow(harness: IdempotencyHarness, scopeId: string, key: string): Promise<void> {
    const result = await this.#client.query(
      `SELECT 1 FROM app.idempotency_records
        WHERE scope_type = $1 AND scope_id = $2 AND idempotency_key = $3 FOR UPDATE`,
      [harness.scopeType, scopeId, key],
    );
    if (result.rowCount !== 1) {
      throw new Error('record to lock was not found');
    }
  }

  async query(text: string, values?: unknown[]): Promise<void> {
    await this.#client.query(text, values);
  }

  async commit(): Promise<void> {
    await this.#finish('COMMIT');
  }

  async rollback(): Promise<void> {
    await this.#finish('ROLLBACK');
  }

  async #finish(statement: 'COMMIT' | 'ROLLBACK'): Promise<void> {
    if (!this.#open) {
      return;
    }
    this.#open = false;
    try {
      await this.#client.query(statement);
    } finally {
      this.#client.release();
    }
  }
}

/**
 * Deterministic barrier on the SERVER: resolves once some backend is waiting for the advisory lock
 * of `pair` (pg_locks shows advisory waiters with objsubid = 2 and unsigned class/object ids).
 */
export async function waitForAdvisoryWaiter(pool: Pool, pair: LockKeyPair): Promise<void> {
  await eventually(
    async () => {
      const result = await pool.query(
        `SELECT 1 FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted AND objsubid = 2
            AND classid::bigint = $1::bigint AND objid::bigint = $2::bigint`,
        [pair.first >>> 0, pair.second >>> 0],
      );
      return (result.rowCount ?? 0) > 0;
    },
    'a backend is waiting for the advisory lock',
    15_000,
    10,
  );
}

/** Deterministic barrier: some backend of this database is blocked on a lock of the record table. */
export async function waitForRecordRowWaiter(pool: Pool): Promise<void> {
  await eventually(
    async () => {
      const result = await pool.query(
        `SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE '%app.idempotency_records%' AND pid <> pg_backend_pid()`,
      );
      return (result.rowCount ?? 0) > 0;
    },
    'a backend is waiting for a record row lock',
    15_000,
    10,
  );
}

/**
 * Deterministic barrier: a backend of this database is blocked on a lock while running a statement
 * that contains `fragment`.
 */
export async function waitForBlockedStatement(pool: Pool, fragment: string): Promise<void> {
  await eventually(
    async () => {
      const result = await pool.query(
        `SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND position($1 in query) > 0 AND pid <> pg_backend_pid()`,
        [fragment],
      );
      return (result.rowCount ?? 0) > 0;
    },
    `a statement containing "${fragment}" is blocked on a lock`,
    15_000,
    10,
  );
}

/**
 * Fixture replay-authorization hook (what Auth will implement later). It locks the grant row FOR
 * SHARE, reads its state AFTER the lock, and is read-only. Revoked/missing/not owned -> deny.
 * `onLocked` lets a test pause AFTER the lock is held and BEFORE the replay is decrypted.
 */
/** Denial raised by the FIXTURE hooks (the real Auth module will use its own error). */
export class ReplayDenied extends Error {
  constructor(reason: string) {
    super(`replay denied: ${reason}`);
    this.name = 'ReplayDenied';
  }
}

export function grantHook(
  harness: IdempotencyHarness,
  expectedOwner: string,
  onLocked?: () => Promise<void>,
): ReplayAuthorizationHook {
  return async (context, guard) => {
    const grantId = guard['grant_id'];
    if (typeof grantId !== 'string') {
      throw new ReplayDenied('guard has no grant');
    }
    const result = await context.query<{ owner_id: string; revoked: boolean }>(
      `SELECT owner_id, revoked FROM ${harness.grants} WHERE grant_id = $1 FOR SHARE`,
      [grantId],
    );
    const row = result.rows[0];
    if (row === undefined || row.revoked || row.owner_id !== expectedOwner) {
      throw new ReplayDenied('grant revoked, missing or not owned');
    }
    if (onLocked !== undefined) {
      await onLocked();
    }
    return true;
  };
}

export async function seedGrant(
  harness: IdempotencyHarness,
  grantId: string,
  ownerId: string,
): Promise<void> {
  await harness.pool.query(`INSERT INTO ${harness.grants} (grant_id, owner_id) VALUES ($1, $2)`, [
    grantId,
    ownerId,
  ]);
}

export async function errorOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('expected a failure');
}

export function appCodeOf(error: unknown): string {
  if (!(error instanceof AppError)) {
    throw new Error(`expected an AppError, got ${String(error)}`);
  }
  return error.code;
}
