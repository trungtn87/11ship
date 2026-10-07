import { Pool } from 'pg';
import { DEFAULT_OUTBOX_CONFIG, OutboxConfig } from '../../../apps/backend/src/config/outbox-config';
import { JsonLogger } from '../../../apps/backend/src/logging/json-logger';
import {
  ClaimedOutboxEvent,
  OutboxDispatchStore,
  OutboxDispatchStorePort,
  OutboxLease,
  OutboxTransactionRunner,
} from '../../../apps/backend/src/outbox/outbox-dispatch-store';
import { FakeOutboxPublisher } from '../../../apps/backend/src/outbox/fake-outbox-publisher.fixture';
import { OutboxDispatcher } from '../../../apps/backend/src/outbox/outbox-dispatcher';
import { OutboxPublisher } from '../../../apps/backend/src/outbox/outbox-publisher';
import { OutboxWriter } from '../../../apps/backend/src/outbox/outbox-writer';
import { poolClientSource } from '../../../apps/backend/src/transaction/pg-client-source';
import { TransactionContext } from '../../../apps/backend/src/transaction/transaction-context';
import { TransactionManager } from '../../../apps/backend/src/transaction/transaction-manager';
import { Deferred, deferred, eventually } from './async-helpers';
import { outboxEvent, OutboxRow } from './audit-outbox-fixtures';
import { loadIntegrationConfig } from './test-helpers';
import { backendIsGone, faultySource, managerFor, testPool } from './transaction-fixtures';

// Shared fixtures of the M00-C1C integration suites (real PostgreSQL). The dispatcher claims from the whole of
// app.outbox_events, so a suite cannot isolate itself by resource id the way the C1B suites do. Instead each
// test starts from an EMPTY outbox table: the integration run is serial (--runInBand) and the target is a
// disposable, guarded test database, so clearing the table cannot disturb another suite.

export const SECRET_MARKER = 'SECRET_MARKER_C1C_7d20';

export function testOutboxConfig(overrides: Partial<OutboxConfig> = {}): OutboxConfig {
  return { ...DEFAULT_OUTBOX_CONFIG, publishTimeoutMs: 200, ...overrides };
}

export interface DispatchHarness {
  readonly pool: Pool;
  readonly manager: TransactionManager;
  /** A store over the real transaction manager. */
  store(config?: Partial<OutboxConfig>, runner?: OutboxTransactionRunner): OutboxDispatchStore;
  dispatcher(options: {
    readonly publisher: OutboxPublisher;
    readonly config?: Partial<OutboxConfig>;
    readonly store?: OutboxDispatchStorePort;
    readonly logger?: JsonLogger;
  }): OutboxDispatcher;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createDispatchHarness(): Promise<DispatchHarness> {
  const config = loadIntegrationConfig();
  const pool = testPool(config.database, { poolMax: 8 });
  const manager = managerFor(poolClientSource(pool));
  const reset = async (): Promise<void> => {
    await pool.query('DELETE FROM app.outbox_events');
  };
  await reset();

  return {
    pool,
    manager,
    store(overrides: Partial<OutboxConfig> = {}, runner?: OutboxTransactionRunner): OutboxDispatchStore {
      return new OutboxDispatchStore(runner ?? manager, testOutboxConfig(overrides));
    },
    dispatcher(options): OutboxDispatcher {
      const cfg = testOutboxConfig(options.config);
      return new OutboxDispatcher(options.store ?? new OutboxDispatchStore(manager, cfg), options.publisher, cfg, {
        ...(options.logger === undefined ? {} : { logger: options.logger }),
      });
    },
    reset,
    async close(): Promise<void> {
      try {
        await reset();
      } finally {
        await pool.end();
      }
    },
  };
}

/** Inserts `count` PENDING events through the real writer, in one business transaction. */
export async function seedEvents(h: DispatchHarness, count: number, tag = 'ev'): Promise<string[]> {
  const writer = new OutboxWriter();
  return h.manager.withTransaction(async (context: TransactionContext) => {
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      ids.push(
        await writer.append(context, outboxEvent(`${tag}-${i}`, { payload: { n: i, note: 'safe-payload' } })),
      );
    }
    return ids;
  });
}

export async function rowOf(h: DispatchHarness, eventId: string): Promise<OutboxRow> {
  const result = await h.pool.query<OutboxRow>(
    `SELECT event_id, event_type, event_schema_version, resource_type, resource_id, resource_version,
            occurred_at, payload, status, attempt_count, available_at, locked_at, lock_token,
            published_at, last_error_code
       FROM app.outbox_events WHERE event_id = $1`,
    [eventId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('outbox row not found');
  }
  return row;
}

export async function statusCounts(h: DispatchHarness): Promise<Record<string, number>> {
  const result = await h.pool.query<{ status: string; n: number }>(
    'SELECT status, count(*)::int AS n FROM app.outbox_events GROUP BY status',
  );
  return Object.fromEntries(result.rows.map((row) => [row.status, row.n]));
}

/** The immutable business envelope of a row, as one comparable value (times as epoch milliseconds). */
export async function envelopeOf(h: DispatchHarness, eventId: string): Promise<string> {
  const result = await h.pool.query<{ envelope: string }>(
    `SELECT json_build_array(event_id, event_type, event_schema_version, resource_type, resource_id,
                             resource_version, floor(extract(epoch FROM occurred_at) * 1000)::bigint, payload)::text AS envelope
       FROM app.outbox_events WHERE event_id = $1`,
    [eventId],
  );
  return result.rows[0]?.envelope ?? '';
}

/**
 * Makes a lease stale by moving the row's whole timeline back one hour (occurred_at, available_at and locked_at
 * together, so the table's time-order CHECK still holds). The decision "stale" is still taken by PostgreSQL's
 * clock in the claim statement; this only changes what the stored timestamps say.
 */
export async function ageLease(h: DispatchHarness, eventId: string): Promise<void> {
  const result = await h.pool.query(
    `UPDATE app.outbox_events
        SET occurred_at = occurred_at - interval '1 hour',
            available_at = available_at - interval '1 hour',
            locked_at = locked_at - interval '1 hour'
      WHERE event_id = $1 AND status = 'PROCESSING'`,
    [eventId],
  );
  if (result.rowCount !== 1) {
    throw new Error('expected one PROCESSING row to age');
  }
}

/** Makes a PENDING event due now (available_at = occurred_at is in the past by definition). */
export async function makeDue(h: DispatchHarness, eventId: string): Promise<void> {
  const result = await h.pool.query(
    "UPDATE app.outbox_events SET available_at = occurred_at WHERE event_id = $1 AND status = 'PENDING'",
    [eventId],
  );
  if (result.rowCount !== 1) {
    throw new Error('expected one PENDING row to make due');
  }
}

/** Test setup only: forces a PROCESSING row with a given attempt_count (a claim that "happened earlier"). */
export async function forceProcessing(h: DispatchHarness, eventId: string, attemptCount: number): Promise<void> {
  await h.pool.query(
    `UPDATE app.outbox_events
        SET status = 'PROCESSING', attempt_count = $2, locked_at = occurred_at, lock_token = gen_random_uuid()
      WHERE event_id = $1`,
    [eventId, attemptCount],
  );
}

/** Test setup only: a PENDING row whose attempts are already used up. */
export async function forcePendingAttempts(h: DispatchHarness, eventId: string, attemptCount: number): Promise<void> {
  await h.pool.query('UPDATE app.outbox_events SET attempt_count = $2 WHERE event_id = $1', [eventId, attemptCount]);
}

/**
 * Wraps a runner so that ONE chosen transaction can be held open after its work ran (row locks held, nothing
 * committed) until the test releases it. This orders two dispatchers by test-controlled barriers, not by timing.
 */
export class GatedRunner implements OutboxTransactionRunner {
  #armed: { reached: Deferred; release: Deferred } | undefined;
  transactions = 0;

  constructor(private readonly inner: OutboxTransactionRunner) {}

  /** The next withTransaction pauses after its work. `reached` settles then; `release()` lets it commit. */
  arm(): { reached: Promise<void>; release: () => void } {
    const armed = { reached: deferred<void>(), release: deferred<void>() };
    this.#armed = armed;
    return { reached: armed.reached.promise, release: () => armed.release.resolve() };
  }

  withTransaction<T>(work: (context: TransactionContext) => Promise<T>): Promise<T> {
    this.transactions += 1;
    const armed = this.#armed;
    this.#armed = undefined;
    if (armed === undefined) {
      return this.inner.withTransaction(work);
    }
    return this.inner.withTransaction(async (context) => {
      const value = await work(context);
      armed.reached.resolve();
      await armed.release.promise;
      return value;
    });
  }
}

/** Counts transactions that reach the database (the "did the dispatcher even ask?" probe). */
export class CountingRunner implements OutboxTransactionRunner {
  transactions = 0;

  constructor(private readonly inner: OutboxTransactionRunner) {}

  withTransaction<T>(work: (context: TransactionContext) => Promise<T>): Promise<T> {
    this.transactions += 1;
    return this.inner.withTransaction(work);
  }
}

export type CommitFault = 'ack-lost-after-commit' | 'never-reached';

/**
 * A runner over the REAL pool whose COMMIT acknowledgement is lost. 'ack-lost-after-commit': PostgreSQL commits
 * and only the answer is lost. 'never-reached': the COMMIT never gets to the server, which rolls the session
 * back. Both reach the caller as TRANSACTION_OUTCOME_UNKNOWN; the caller cannot tell them apart, only the
 * database can. Statements before COMMIT are real.
 */
export function lossyCommitRunner(h: DispatchHarness, fault: CommitFault): OutboxTransactionRunner {
  return managerFor(
    faultySource(h.pool, (text, real) => {
      if (text !== 'COMMIT') {
        return undefined;
      }
      const lost = (): Promise<never> =>
        Promise.reject(Object.assign(new Error('injected: COMMIT acknowledgement lost'), { code: 'ECONNRESET' }));
      return fault === 'ack-lost-after-commit' ? real.query('COMMIT').then(lost) : lost();
    }),
  );
}

/**
 * A runner that really loses the server session before COMMIT: after the work ran it terminates its own
 * PostgreSQL backend (from another connection) and waits until it is gone. Nothing of that transaction can have
 * been committed.
 */
export function crashBeforeCommitRunner(h: DispatchHarness): OutboxTransactionRunner {
  return {
    withTransaction: <T>(work: (context: TransactionContext) => Promise<T>): Promise<T> =>
      h.manager.withTransaction(async (context) => {
        const value = await work(context);
        const pid = (await context.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;
        if (pid === undefined) {
          throw new Error('no backend pid');
        }
        await h.pool.query('SELECT pg_terminate_backend($1)', [pid]);
        await eventually(() => backendIsGone(h.pool, pid), 'transaction backend terminated');
        return value;
      }),
  };
}

/** Combines a store per operation, so a fault can be injected into ack or fail only. */
export function composeStore(parts: {
  readonly claim: OutboxDispatchStorePort;
  readonly ack: OutboxDispatchStorePort;
  readonly fail: OutboxDispatchStorePort;
}): OutboxDispatchStorePort {
  return {
    claim: (limit) => parts.claim.claim(limit),
    ack: (lease) => parts.ack.ack(lease),
    fail: (lease, code) => parts.fail.fail(lease, code),
  };
}

/** Process "dies" at the moment the transition would run: the database is never touched. */
export const CRASH_MARKER = 'SIMULATED_PROCESS_CRASH';
export function crashingStore(real: OutboxDispatchStorePort, crashOn: 'ack' | 'fail'): OutboxDispatchStorePort {
  const crash = (): Promise<never> => Promise.reject(new Error(CRASH_MARKER));
  return {
    claim: (limit) => real.claim(limit),
    ack: (lease) => (crashOn === 'ack' ? crash() : real.ack(lease)),
    fail: (lease, code) => (crashOn === 'fail' ? crash() : real.fail(lease, code)),
  };
}

export function leaseOf(event: ClaimedOutboxEvent): OutboxLease {
  return { eventId: event.eventId, lockToken: event.lockToken, attemptCount: event.attemptCount };
}

/** The first element, or a clear failure: keeps tests free of non-null assertions. */
export function first<T>(items: readonly T[]): T {
  const item = items[0];
  if (item === undefined) {
    throw new Error('expected at least one element');
  }
  return item;
}

export function only<T>(items: readonly T[]): T {
  if (items.length !== 1) {
    throw new Error(`expected exactly one element, got ${items.length}`);
  }
  return first(items);
}

/** Waits (bounded) for EXTERNAL progress: the dispatcher calling its publisher after its claim committed. */
export async function waitForCalls(publisher: FakeOutboxPublisher, count: number, timeoutMs = 8000): Promise<void> {
  const started = Date.now();
  while (publisher.calls.length < count) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`publisher was not called ${count} times within ${timeoutMs} ms`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

/** Every column of every outbox row as one text, for "this marker is nowhere in the table" assertions. */
export async function wholeOutboxText(h: DispatchHarness): Promise<string> {
  const result = await h.pool.query<{ t: string }>(
    'SELECT coalesce(string_agg(row_to_json(e)::text, E\'\\n\'), \'\') AS t FROM app.outbox_events e',
  );
  return result.rows[0]?.t ?? '';
}
