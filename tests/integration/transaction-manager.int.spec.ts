import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { Pool } from 'pg';
import { AppError } from '../../apps/backend/src/common/app-errors';
import { poolClientSource } from '../../apps/backend/src/transaction/pg-client-source';
import { QueryRows, TransactionContext } from '../../apps/backend/src/transaction/transaction-context';
import { TransactionError } from '../../apps/backend/src/transaction/transaction-error';
import { TransactionManager } from '../../apps/backend/src/transaction/transaction-manager';
import { deferred, eventually, failureOf } from './support/async-helpers';
import {
  backendIsGone,
  expectPoolRecovered,
  faultySource,
  managerFor,
  testPool,
} from './support/transaction-fixtures';
import { loadIntegrationConfig, startApp } from './support/test-helpers';

// C01 and C21-A0 against a REAL PostgreSQL server. Only the few faults a healthy server cannot
// produce on demand (lost COMMIT acknowledgement, refused BEGIN, failing ROLLBACK) are injected, and
// only at the client boundary of the real pool; the tests say so explicitly. Everything else (rows,
// commit, rollback, deadlock, backend termination, idle-in-transaction timeout) is real.
describe('M00-C1A0 — TransactionManager on real PostgreSQL', () => {
  const config = loadIntegrationConfig();
  const schema = `tx_${randomBytes(6).toString('hex')}`;
  let pool: Pool;

  const items = `${schema}.items`;
  const deferredItems = `${schema}.deferred_items`;
  const locks = `${schema}.locks`;

  async function countItems(): Promise<number> {
    const result = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${items}`);
    return result.rows[0]?.n ?? -1;
  }

  async function itemIds(): Promise<number[]> {
    const result = await pool.query<{ id: number }>(`SELECT id FROM ${items} ORDER BY id`);
    return result.rows.map((row) => row.id);
  }

  async function backendPid(context: TransactionContext): Promise<number> {
    const result = await context.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    return result.rows[0]?.pid ?? -1;
  }

  beforeAll(async () => {
    pool = testPool(config.database);
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`CREATE TABLE ${items} (id integer PRIMARY KEY, note text NOT NULL)`);
    await pool.query(
      `CREATE TABLE ${deferredItems} (id integer, CONSTRAINT deferred_unique UNIQUE (id) DEFERRABLE INITIALLY DEFERRED)`,
    );
    await pool.query(`CREATE TABLE ${locks} (id integer PRIMARY KEY)`);
    await pool.query(`INSERT INTO ${locks} (id) VALUES (1), (2)`);
  });

  afterEach(async () => {
    await expectPoolRecovered(pool);
    await pool.query(`TRUNCATE ${items}, ${deferredItems}`);
  });

  afterAll(async () => {
    // Only the random schema created by this test is removed.
    if (/^tx_[0-9a-f]{12}$/.test(schema)) {
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    }
    await pool.end();
  });

  describe('C01 — one client, commit and rollback of everything', () => {
    it('runs every statement on ONE backend and commits all of them together', async () => {
      const manager = managerFor(poolClientSource(pool));

      const seen = await manager.withTransaction(async (context) => {
        const first = await backendPid(context);
        await context.query(`INSERT INTO ${items} (id, note) VALUES ($1, $2)`, [1, 'a']);
        await context.query(`INSERT INTO ${items} (id, note) VALUES ($1, $2)`, [2, 'b']);
        const second = await backendPid(context);
        const inside = await context.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM ${items}`,
        );
        // Another connection must not see uncommitted work.
        const outsideBeforeCommit = await countItems();
        const observer = await pool.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
        return {
          first,
          second,
          inside: inside.rows[0]?.n,
          outsideBeforeCommit,
          observerPid: observer.rows[0]?.pid,
        };
      });

      expect(seen.first).toBe(seen.second);
      expect(seen.observerPid).not.toBe(seen.first);
      expect(seen.inside).toBe(2);
      expect(seen.outsideBeforeCommit).toBe(0);
      expect(await itemIds()).toEqual([1, 2]);
    });

    it('rolls back everything when the callback throws, and rethrows its error unchanged', async () => {
      const manager = managerFor(poolClientSource(pool));
      const boom = new Error('business failure');

      const error = await failureOf(() =>
        manager.withTransaction(async (context) => {
          await context.query(`INSERT INTO ${items} (id, note) VALUES (1, 'a')`);
          await context.query(`INSERT INTO ${items} (id, note) VALUES (2, 'b')`);
          throw boom;
        }),
      );

      expect(error).toBe(boom);
      expect(await countItems()).toBe(0);
    });

    it('rolls back everything on a real server error (duplicate key) and keeps the server error', async () => {
      const manager = managerFor(poolClientSource(pool));

      const error = await failureOf(() =>
        manager.withTransaction(async (context) => {
          await context.query(`INSERT INTO ${items} (id, note) VALUES (1, 'first')`);
          await context.query(`INSERT INTO ${items} (id, note) VALUES (1, 'duplicate')`);
        }),
      );

      expect((error as { code?: string }).code).toBe('23505');
      expect(await countItems()).toBe(0);
    });

    it('does not report success when the callback swallowed an error that aborted the transaction', async () => {
      const manager = managerFor(poolClientSource(pool));

      const error = await failureOf(() =>
        manager.withTransaction(async (context) => {
          await context.query(`INSERT INTO ${items} (id, note) VALUES (1, 'kept?')`);
          await context
            .query(`INSERT INTO ${items} (id, note) VALUES (1, 'duplicate')`)
            .catch(() => undefined);
          return 'looks fine';
        }),
      );

      // PostgreSQL answers COMMIT of an aborted transaction with the ROLLBACK command tag.
      expect(error).toBeInstanceOf(TransactionError);
      expect((error as TransactionError).reason).toBe('COMMIT_REJECTED');
      expect(await countItems()).toBe(0);
    });

    it('releases the client cleanly after commit and after rollback', async () => {
      const manager = managerFor(poolClientSource(pool));

      await manager.withTransaction((context) => context.query('SELECT 1'));
      await failureOf(() =>
        manager.withTransaction(async (context) => {
          await context.query('SELECT 1');
          throw new Error('x');
        }),
      );

      expect(pool.totalCount - pool.idleCount).toBe(0);
      expect(pool.waitingCount).toBe(0);
    });

    it('lets a repository use the context it was handed, on the same backend, without a new transaction', async () => {
      const manager = managerFor(poolClientSource(pool));

      // A participant: it can only be given a context. It has no manager and no pool.
      async function insertItem(context: TransactionContext, id: number): Promise<number> {
        await context.query(`INSERT INTO ${items} (id, note) VALUES ($1, 'repo')`, [id]);
        return backendPid(context);
      }

      const pids = await manager.withTransaction(async (context) => [
        await backendPid(context),
        await insertItem(context, 1),
        await insertItem(context, 2),
      ]);

      expect(new Set(pids).size).toBe(1);
      expect(await itemIds()).toEqual([1, 2]);
    });

    it('refuses a nested transaction instead of silently opening an independent one', async () => {
      const manager = managerFor(poolClientSource(pool));

      const error = await failureOf(() =>
        manager.withTransaction(async (context) => {
          await context.query(`INSERT INTO ${items} (id, note) VALUES (1, 'outer')`);
          await manager.withTransaction(async (inner) => {
            await inner.query(`INSERT INTO ${items} (id, note) VALUES (2, 'inner')`);
          });
        }),
      );

      expect((error as TransactionError).reason).toBe('NESTED_TRANSACTION');
      expect(await countItems()).toBe(0);
    });

    it('refuses transaction-control statements from a participant and closes the context after the transaction', async () => {
      const manager = managerFor(poolClientSource(pool));

      const control = await failureOf(() =>
        manager.withTransaction(async (context) => {
          await context.query(`INSERT INTO ${items} (id, note) VALUES (1, 'a')`);
          await context.query('COMMIT');
        }),
      );
      expect((control as TransactionError).reason).toBe('CONTROL_STATEMENT');
      expect(await countItems()).toBe(0);

      let kept: TransactionContext | undefined;
      await manager.withTransaction((context) => {
        kept = context;
        return Promise.resolve();
      });
      expect(kept?.isActive).toBe(false);
      const closed = await failureOf(() => kept?.query('SELECT 1') ?? Promise.resolve());
      expect((closed as TransactionError).reason).toBe('CONTEXT_CLOSED');
    });

    it('refuses transaction control hidden behind comments or a second statement, and does not mistake quoted text for it (real server)', async () => {
      const manager = managerFor(poolClientSource(pool));

      for (const hidden of [
        'SELECT 1; /* note */ COMMIT',
        'SELECT 1; -- note ROLLBACK\nROLLBACK',
        '/* lead */ COMMIT',
      ]) {
        const refused = await failureOf(() =>
          manager.withTransaction(async (context) => {
            await context.query(`INSERT INTO ${items} (id, note) VALUES (1, 'must vanish')`);
            await context.query(hidden);
          }),
        );
        expect(['CONTROL_STATEMENT', 'INVALID_STATEMENT']).toContain((refused as TransactionError).reason);
        // Refused before PostgreSQL saw it: the INSERT before it was rolled back by the manager.
        expect(await countItems()).toBe(0);
      }

      const answers = await manager.withTransaction(async (context) => {
        await context.query(`INSERT INTO ${items} (id, note) VALUES (7, '; COMMIT')`);
        await context.query("SET LOCAL lock_timeout = '250ms'");
        const quoted = await context.query<{ txt: string }>("SELECT '; COMMIT' AS txt");
        const commented = await context.query<{ txt: string }>("SELECT '/* ROLLBACK */' AS txt");
        return [quoted.rows[0]?.txt, commented.rows[0]?.txt];
      });
      expect(answers).toEqual(['; COMMIT', '/* ROLLBACK */']);
      expect(await itemIds()).toEqual([7]);
    });

    it('is wired by the application module from the validated configuration', async () => {
      const running = await startApp(config);
      try {
        const manager = running.app.get(TransactionManager);
        const answer = await manager.withTransaction((context) =>
          context.query<{ ok: number }>('SELECT 1 AS ok'),
        );
        expect(answer.rows[0]?.ok).toBe(1);
      } finally {
        await running.app.close();
      }
    });
  });

  describe('C21-A0 — deadlines, faults and recovery', () => {
    it('enforces the total deadline for a slow callback: context closed, rolled back, late callback cannot mutate', async () => {
      const manager = managerFor(poolClientSource(pool), { timeoutMs: 300 });
      const gate = deferred();
      const late = deferred<unknown>();

      const error = await failureOf(() =>
        manager.withTransaction(async (context) => {
          await context.query(`INSERT INTO ${items} (id, note) VALUES (1, 'before deadline')`);
          await gate.promise; // slow callback, not a slow query
          late.resolve(
            await context.query(`INSERT INTO ${items} (id, note) VALUES (99, 'late')`).then(
              () => 'late statement executed',
              (rejected: unknown) => rejected,
            ),
          );
        }),
      );

      expect((error as TransactionError).reason).toBe('DEADLINE_EXCEEDED');
      expect(await itemIds()).toEqual([]);

      // Another transaction now owns that pooled connection; the old context must not reach it.
      const next = managerFor(poolClientSource(pool));
      await next.withTransaction(async (context) => {
        await context.query(`INSERT INTO ${items} (id, note) VALUES (2, 'next')`);
        gate.resolve();
        const outcome = await late.promise;
        expect(outcome).toBeInstanceOf(TransactionError);
        expect((outcome as TransactionError).reason).toBe('CONTEXT_CLOSED');
      });

      expect(await itemIds()).toEqual([2]);
    });

    it('enforces the deadline while a query is running: connection destroyed, statement stopped by the server', async () => {
      // Server statement timeout of 2 s bounds how long the abandoned statement can still run.
      const slowPool = testPool(config.database, { statementTimeoutMs: 2000, queryTimeoutMs: 6000 });
      try {
        const manager = managerFor(poolClientSource(slowPool), { timeoutMs: 300 });
        let pid = -1;
        const started = Date.now();

        const error = await failureOf(() =>
          manager.withTransaction(async (context) => {
            pid = await backendPid(context);
            await context.query('SELECT pg_sleep(30)');
          }),
        );

        expect((error as TransactionError).reason).toBe('DEADLINE_EXCEEDED');
        expect(Date.now() - started).toBeLessThan(2000);
        // The connection was destroyed, not returned to the pool.
        expect(slowPool.totalCount).toBe(0);
        expect(pid).toBeGreaterThan(0);
        // PostgreSQL ends the orphaned backend once its statement is cancelled by statement_timeout.
        await eventually(() => backendIsGone(pool, pid), 'abandoned backend is gone', 10_000);
        await expectPoolRecovered(slowPool);
      } finally {
        await slowPool.end();
      }
    });

    it('enforces the idle-in-transaction timeout: the server ends the session and the failure is CONNECTION_LOST', async () => {
      const manager = managerFor(poolClientSource(pool), {
        timeoutMs: 20_000,
        idleInTransactionTimeoutMs: 200,
      });

      const error = await failureOf(() =>
        manager.withTransaction(async (context) => {
          const pid = await backendPid(context);
          await context.query(`INSERT INTO ${items} (id, note) VALUES (1, 'idle')`);
          // Wait (bounded) for PostgreSQL itself to terminate the idle transaction.
          await eventually(() => backendIsGone(pool, pid), 'idle-in-transaction backend is gone');
          await context.query(`INSERT INTO ${items} (id, note) VALUES (2, 'after kill')`);
        }),
      );

      expect((error as TransactionError).reason).toBe('CONNECTION_LOST');
      expect(await countItems()).toBe(0);
      // The dead connection was not reused: a new transaction works.
      const manager2 = managerFor(poolClientSource(pool));
      await manager2.withTransaction((context) => context.query('SELECT 1'));
    });

    it('survives a backend that is terminated mid-transaction (real connection failure)', async () => {
      const manager = managerFor(poolClientSource(pool));

      const error = await failureOf(() =>
        manager.withTransaction(async (context) => {
          const pid = await backendPid(context);
          await context.query(`INSERT INTO ${items} (id, note) VALUES (1, 'doomed')`);
          const killed = await pool.query<{ ok: boolean }>(
            'SELECT pg_terminate_backend($1) AS ok',
            [pid],
          );
          expect(killed.rows[0]?.ok).toBe(true);
          await context.query(`INSERT INTO ${items} (id, note) VALUES (2, 'after kill')`);
        }),
      );

      expect((error as TransactionError).reason).toBe('CONNECTION_LOST');
      expect(await countItems()).toBe(0);
    });

    it('refuses to proceed when BEGIN fails (injected at the client boundary): destroyed, callback not run', async () => {
      const source = faultySource(pool, (text) =>
        text === 'BEGIN' ? Promise.reject(new Error('injected: BEGIN refused')) : undefined,
      );
      let ran = false;

      const error = await failureOf(() =>
        managerFor(source).withTransaction(() => {
          ran = true;
          return Promise.resolve();
        }),
      );

      expect((error as TransactionError).reason).toBe('BEGIN_FAILED');
      expect(ran).toBe(false);
      expect(source.released).toEqual([true]);
    });

    it('destroys the connection and keeps the original error when ROLLBACK fails (injected)', async () => {
      const source = faultySource(pool, (text) =>
        text === 'ROLLBACK' ? Promise.reject(new Error('injected: ROLLBACK failed')) : undefined,
      );
      let pid = -1;
      const boom = new Error('business failure');

      const error = await failureOf(() =>
        managerFor(source).withTransaction(async (context) => {
          pid = await backendPid(context);
          await context.query(`INSERT INTO ${items} (id, note) VALUES (1, 'x')`);
          throw boom;
        }),
      );

      expect(error).toBe(boom);
      expect(source.released).toEqual([true]);
      await eventually(() => backendIsGone(pool, pid), 'destroyed backend is gone');
      expect(await countItems()).toBe(0);
    });

    it('bounds a hung ROLLBACK by the same deadline: client destroyed, original error kept, the server ends the transaction (injected)', async () => {
      // Only ROLLBACK is intercepted and never answers; the INSERT and everything else is real PostgreSQL.
      const source = faultySource(pool, (text) =>
        text === 'ROLLBACK' ? new Promise<QueryRows>(() => undefined) : undefined,
      );
      let pid = -1;
      const boom = new Error('business failure');
      const started = Date.now();

      const error = await failureOf(() =>
        managerFor(source, { timeoutMs: 300 }).withTransaction(async (context) => {
          pid = await backendPid(context);
          await context.query(`INSERT INTO ${items} (id, note) VALUES (1, 'x')`);
          throw boom;
        }),
      );

      expect(error).toBe(boom);
      // The one 300 ms deadline bounds the rollback; an unbounded await would never return.
      expect(Date.now() - started).toBeLessThan(1500);
      expect(source.released).toEqual([true]);
      await eventually(() => backendIsGone(pool, pid), 'destroyed backend is gone');
      expect(await countItems()).toBe(0);
    });

    it('reports an UNKNOWN outcome, not a rollback, when the server COMMITTED but the acknowledgement was lost (injected)', async () => {
      const source = faultySource(pool, (text, real) =>
        text === 'COMMIT'
          ? real.query('COMMIT').then(() =>
              Promise.reject(Object.assign(new Error('injected: acknowledgement lost'), { code: 'ECONNRESET' })),
            )
          : undefined,
      );
      let calls = 0;

      const error = await failureOf(() =>
        managerFor(source).withTransaction(async (context) => {
          calls += 1;
          await context.query(`INSERT INTO ${items} (id, note) VALUES (1, 'committed anyway')`);
        }),
      );

      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('TRANSACTION_OUTCOME_UNKNOWN');
      expect((error as AppError).status).toBe(503);
      expect(calls).toBe(1); // never retried
      expect(source.acquired()).toBe(1);
      expect(source.released).toEqual([true]);
      // Proof from ANOTHER connection that the transaction really is committed.
      expect(await itemIds()).toEqual([1]);
    });

    it('reports the same UNKNOWN outcome when COMMIT never reached the server (injected), and nothing is committed', async () => {
      const source = faultySource(pool, (text) =>
        text === 'COMMIT'
          ? Promise.reject(Object.assign(new Error('injected: COMMIT lost'), { code: 'ECONNRESET' }))
          : undefined,
      );
      let pid = -1;
      let calls = 0;

      const error = await failureOf(() =>
        managerFor(source).withTransaction(async (context) => {
          calls += 1;
          pid = await backendPid(context);
          await context.query(`INSERT INTO ${items} (id, note) VALUES (1, 'never committed')`);
        }),
      );

      expect((error as AppError).code).toBe('TRANSACTION_OUTCOME_UNKNOWN');
      expect(calls).toBe(1);
      expect(source.released).toEqual([true]);
      await eventually(() => backendIsGone(pool, pid), 'destroyed backend is gone');
      expect(await countItems()).toBe(0);
    });

    it('counts the COMMIT round trip in the total deadline: held acknowledgement past the budget is UNKNOWN, never success (injected delay)', async () => {
      const release = deferred();
      let serverAnswered = false;
      const source = faultySource(pool, (text, real) =>
        text === 'COMMIT'
          ? real.query('COMMIT').then(async (answer) => {
              serverAnswered = true;
              await release.promise; // the acknowledgement is stuck on the network
              return answer;
            })
          : undefined,
      );
      let calls = 0;

      const error = await failureOf(() =>
        managerFor(source, { timeoutMs: 400 }).withTransaction(async (context) => {
          calls += 1;
          await context.query(`INSERT INTO ${items} (id, note) VALUES (1, 'committed, ack late')`);
        }),
      );

      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('TRANSACTION_OUTCOME_UNKNOWN');
      expect(calls).toBe(1);
      expect(source.acquired()).toBe(1);
      expect(source.released).toEqual([true]);
      expect(serverAnswered).toBe(true);
      // The server did commit; only another connection can tell. The caller was told "unknown".
      expect(await itemIds()).toEqual([1]);
      release.resolve();
    });

    it('distinguishes a COMMIT the server REJECTED (real deferred constraint) from an unknown outcome', async () => {
      const source = faultySource(pool, () => undefined);

      const error = await failureOf(() =>
        managerFor(source).withTransaction(async (context) => {
          await context.query(`INSERT INTO ${deferredItems} (id) VALUES (1)`);
          await context.query(`INSERT INTO ${deferredItems} (id) VALUES (1)`); // fails at COMMIT
        }),
      );

      expect(error).toBeInstanceOf(TransactionError);
      expect((error as TransactionError).reason).toBe('COMMIT_REJECTED');
      expect((error as TransactionError).sqlState).toBe('23505');
      const rows = await pool.query(`SELECT 1 FROM ${deferredItems}`);
      expect(rows.rowCount).toBe(0);
      // The server answered, so the connection is intact and was returned to the pool.
      expect(source.released).toEqual([false]);
    });

    it('surfaces a real deadlock as DEADLOCK_DETECTED and never runs either callback twice', async () => {
      const manager = managerFor(poolClientSource(pool));
      const aHoldsRow1 = deferred();
      const bHoldsRow2 = deferred();
      const aPid = deferred<number>();
      let callsA = 0;
      let callsB = 0;

      const txA = manager.withTransaction(async (context) => {
        callsA += 1;
        aPid.resolve(await backendPid(context));
        await context.query(`SELECT id FROM ${locks} WHERE id = 1 FOR UPDATE`);
        aHoldsRow1.resolve();
        await bHoldsRow2.promise;
        await context.query(`SELECT id FROM ${locks} WHERE id = 2 FOR UPDATE`); // waits for B
        return 'A';
      });

      const txB = manager.withTransaction(async (context) => {
        callsB += 1;
        await context.query(`SELECT id FROM ${locks} WHERE id = 2 FOR UPDATE`);
        bHoldsRow2.resolve();
        await aHoldsRow1.promise;
        // Request row 1 only once A is really blocked waiting for row 2.
        const pidOfA = await aPid.promise;
        await eventually(async () => {
          const waiting = await pool.query<{ wait_event_type: string | null }>(
            'SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1',
            [pidOfA],
          );
          return waiting.rows[0]?.wait_event_type === 'Lock';
        }, 'transaction A is blocked on a row lock');
        await context.query(`SELECT id FROM ${locks} WHERE id = 1 FOR UPDATE`); // closes the cycle
        return 'B';
      });

      const settled = await Promise.allSettled([txA, txB]);
      const rejected = settled.filter((result) => result.status === 'rejected');
      const fulfilled = settled.filter((result) => result.status === 'fulfilled');

      expect(rejected).toHaveLength(1);
      expect(fulfilled).toHaveLength(1);
      const failure = (rejected[0] as PromiseRejectedResult).reason as TransactionError;
      expect(failure).toBeInstanceOf(TransactionError);
      expect(failure.reason).toBe('DEADLOCK_DETECTED');
      expect(failure.sqlState).toBe('40P01');
      expect(callsA).toBe(1);
      expect(callsB).toBe(1);
    });

    it('reports ACQUIRE_FAILED within the connect timeout when the pool is exhausted, then recovers', async () => {
      const tiny = testPool(config.database, { poolMax: 1, connectTimeoutMs: 150 });
      try {
        const hog = await tiny.connect();
        const started = Date.now();
        const error = await failureOf(() =>
          managerFor(poolClientSource(tiny)).withTransaction((context) => context.query('SELECT 1')),
        );
        expect((error as TransactionError).reason).toBe('ACQUIRE_FAILED');
        expect(Date.now() - started).toBeLessThan(3000);
        hog.release();

        await managerFor(poolClientSource(tiny)).withTransaction((context) => context.query('SELECT 1'));
        await expectPoolRecovered(tiny);
      } finally {
        await tiny.end();
      }
    });

    it('recovers completely after a series of faults: nothing leaked, a normal transaction still commits', async () => {
      const manager = managerFor(poolClientSource(pool));
      for (let index = 0; index < 5; index += 1) {
        await failureOf(() =>
          manager.withTransaction(async (context) => {
            await context.query(`INSERT INTO ${items} (id, note) VALUES (1, 'x')`);
            throw new Error('fault');
          }),
        );
      }
      await manager.withTransaction((context) =>
        context.query(`INSERT INTO ${items} (id, note) VALUES (7, 'ok')`),
      );
      expect(await itemIds()).toEqual([7]);
    });
  });
});
