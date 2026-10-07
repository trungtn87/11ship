import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { AddressInfo } from 'node:net';
import { Pool, PoolClient } from 'pg';
import { AuditWriter } from '../../apps/backend/src/audit/audit-writer';
import { AuditAppender, StandaloneAuditRecorder } from '../../apps/backend/src/audit/standalone-audit-recorder';
import { configureApp } from '../../apps/backend/src/app.setup';
import { AppError } from '../../apps/backend/src/common/app-errors';
import { LoggingModule } from '../../apps/backend/src/logging/logging.module';
import { poolClientSource } from '../../apps/backend/src/transaction/pg-client-source';
import { eventually } from './support/async-helpers';
import { DenialHarnessModule } from './support/audit-denial-harness';
import {
  auditEntry,
  auditRowsOf,
  captureLogs,
  denial,
  newRequestId,
  SECRET_MARKER,
  ThrowingMarkerError,
} from './support/audit-outbox-fixtures';
import { countItems, createHarness, errorOf, IdempotencyHarness, LockHolder, newScopeId } from './support/idempotency-fixtures';
import { loadIntegrationConfig } from './support/test-helpers';
import { expectPoolRecovered, managerFor, testPool } from './support/transaction-fixtures';

// M00-C1B — C27: the standalone audit recorder on a REAL PostgreSQL. DENIED/FAILURE only, own short
// transaction under ONE 500 ms budget (acquire + BEGIN + INSERT + COMMIT), best effort, and never able to
// change what the caller does with the original denial.
//
// Time bounds below are deliberately wide on the upper side (CI machines stall) but each one is far below
// the pool's own 2 s acquire timeout, so a pass proves the 500 ms budget did the bounding, not the pool.
const BUDGET_MS = 500;
const UPPER_BOUND_MS = 1400;

interface LogLine {
  level: string;
  event: string;
  code?: string;
}

function parsed(lines: string[]): LogLine[] {
  return lines.map((line) => JSON.parse(line) as LogLine).filter((line) => line.event === 'audit_standalone_failed');
}

async function timed(run: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  await run();
  return performance.now() - started;
}

describe('M00-C1B C27 — standalone audit recorder', () => {
  let h: IdempotencyHarness; // admin pool for assertions + business tables
  const pools: Pool[] = [];
  const config = loadIntegrationConfig();

  function recorderOn(pool: Pool, logs: ReturnType<typeof captureLogs>, writer: AuditAppender = new AuditWriter()): StandaloneAuditRecorder {
    return new StandaloneAuditRecorder(poolClientSource(pool), writer, logs.logger);
  }

  function ownPool(poolMax: number, url?: string): Pool {
    const pool = testPool(url === undefined ? config.database : { ...config.database, url }, { poolMax, connectTimeoutMs: 2000 });
    pools.push(pool);
    return pool;
  }

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    for (const pool of pools) {
      await pool.end();
    }
    await h.close();
  });

  describe('what it writes', () => {
    it('writes a DENIED and a FAILURE row, each committed in its own transaction and visible to other connections', async () => {
      const logs = captureLogs();
      const recorder = recorderOn(ownPool(2), logs);
      const deniedId = newRequestId();
      const failedId = newRequestId();

      const elapsed = await timed(async () => {
        await recorder.recordBestEffort(denial(deniedId, { metadata: { note: 'no access' } }));
        await recorder.recordBestEffort(
          denial(failedId, { outcome: 'FAILURE', reasonCode: 'DEPENDENCY_DOWN', actorType: 'SYSTEM', actorId: null }),
        );
      });

      const denied = await auditRowsOf(h.pool, deniedId);
      expect(denied).toHaveLength(1);
      expect(denied[0]).toMatchObject({
        outcome: 'DENIED',
        reason_code: 'ACCESS_DENIED',
        actor_type: 'ANONYMOUS',
        actor_id: null,
        metadata: { note: 'no access' },
      });
      const failed = await auditRowsOf(h.pool, failedId);
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatchObject({ outcome: 'FAILURE', reason_code: 'DEPENDENCY_DOWN' });
      expect(parsed(logs.lines)).toHaveLength(0);
      expect(elapsed).toBeLessThan(UPPER_BOUND_MS);
    });

    it('never writes SUCCESS: the entry is refused without touching the pool, the caller sees nothing', async () => {
      const logs = captureLogs();
      const pool = ownPool(1);
      const recorder = recorderOn(pool, logs);
      const requestId = newRequestId();

      await recorder.recordBestEffort(auditEntry(requestId) as never); // outcome SUCCESS

      expect(await auditRowsOf(h.pool, requestId)).toHaveLength(0);
      expect(pool.totalCount).toBe(0); // no connection was ever opened for it
      expect(parsed(logs.lines).map((line) => line.code)).toEqual(['AUDIT_ENTRY_REJECTED']);
    });

    it('an unsafe entry is refused the same way and its content never reaches the log', async () => {
      const logs = captureLogs();
      const recorder = recorderOn(ownPool(1), logs);
      const requestId = newRequestId();
      await recorder.recordBestEffort(denial(requestId, { metadata: { password: SECRET_MARKER } }));
      expect(await auditRowsOf(h.pool, requestId)).toHaveLength(0);
      expect(parsed(logs.lines).map((line) => line.code)).toEqual(['AUDIT_ENTRY_REJECTED']);
      expect(logs.lines.join('\n')).not.toContain(SECRET_MARKER);
    });
  });

  describe('released before acquire: a single-connection pool is enough', () => {
    it('the business transaction rolls back and releases its connection, then the denial is recorded on the same pool', async () => {
      const logs = captureLogs();
      const pool = ownPool(1);
      const manager = managerFor(poolClientSource(pool));
      const recorder = recorderOn(pool, logs);
      const scopeId = newScopeId();
      const requestId = newRequestId();
      const original = new AppError('IDEMPOTENCY_KEY_REUSED');

      const caught = await errorOf(() =>
        manager.withTransaction(async (context) => {
          await context.query(`INSERT INTO ${h.items} (label, scope_id) VALUES ('x', $1)`, [scopeId]);
          throw original;
        }),
      );
      await recorder.recordBestEffort(denial(requestId));

      expect(caught).toBe(original); // identity, code and status are untouched
      expect(await countItems(h, scopeId)).toBe(0);
      expect(await auditRowsOf(h.pool, requestId)).toHaveLength(1);
      expect(parsed(logs.lines)).toHaveLength(0);
      await expectPoolRecovered(pool);
    });
  });

  describe('the 500 ms budget', () => {
    it('pool exhaustion: returns after about 500 ms, writes nothing and logs a fixed code', async () => {
      const logs = captureLogs();
      const pool = ownPool(1);
      const held = await pool.connect(); // the only connection is busy elsewhere
      const requestId = newRequestId();
      try {
        const elapsed = await timed(() => recorderOn(pool, logs).recordBestEffort(denial(requestId)));
        expect(elapsed).toBeGreaterThanOrEqual(BUDGET_MS - 60);
        expect(elapsed).toBeLessThan(UPPER_BOUND_MS);
      } finally {
        held.release();
      }
      expect(parsed(logs.lines).map((line) => line.code)).toEqual(['AUDIT_ACQUIRE_TIMEOUT']);
      await expectPoolRecovered(pool);
      expect(await auditRowsOf(h.pool, requestId)).toHaveLength(0);
    });

    it('late acquire: the connection that arrives after the budget is released at once and never used (no late write, no leak)', async () => {
      const logs = captureLogs();
      const pool = ownPool(1);
      const held = await pool.connect();
      const requestId = newRequestId();

      await recorderOn(pool, logs).recordBestEffort(denial(requestId)); // gives up at ~500 ms
      expect(pool.waitingCount).toBe(1); // pg cannot cancel the queued acquisition: it is still waiting
      held.release(); // ... and now it is fulfilled, late

      await eventually(
        () => Promise.resolve(pool.waitingCount === 0 && pool.totalCount - pool.idleCount === 0),
        'the late client was handed back to the pool',
      );
      // The pool is usable, nothing is checked out, and no row ever appears for the abandoned write.
      const probe = await pool.query<{ ok: number }>('SELECT 1 AS ok');
      expect(probe.rows[0]?.ok).toBe(1);
      expect(await auditRowsOf(h.pool, requestId)).toHaveLength(0);
      expect(parsed(logs.lines).map((line) => line.code)).toEqual(['AUDIT_ACQUIRE_TIMEOUT']);
    });

    it('a blocked INSERT is bounded by the SAME budget: AUDIT_WRITE_TIMEOUT, connection destroyed, no row', async () => {
      const logs = captureLogs();
      const pool = ownPool(2);
      const requestId = newRequestId();
      const blocker = await LockHolder.begin(h.pool);
      let elapsed: number;
      try {
        await blocker.query('LOCK TABLE app.audit_logs IN ACCESS EXCLUSIVE MODE');
        elapsed = await timed(() => recorderOn(pool, logs).recordBestEffort(denial(requestId)));
      } finally {
        await blocker.rollback();
      }
      expect(elapsed).toBeGreaterThanOrEqual(BUDGET_MS - 120);
      expect(elapsed).toBeLessThan(UPPER_BOUND_MS);
      expect(parsed(logs.lines).map((line) => line.code)).toEqual(['AUDIT_WRITE_TIMEOUT']);
      await expectPoolRecovered(pool);
      // The abandoned INSERT did not survive the lock being released.
      expect(await auditRowsOf(h.pool, requestId)).toHaveLength(0);
      await eventually(async () => {
        const waiting = await h.pool.query(
          `SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
        );
        return waiting.rowCount === 0;
      }, 'no backend is still waiting on the audit table');
    });

    it('acquire time counts against the same budget as BEGIN/INSERT/COMMIT (no second budget after a slow acquire)', async () => {
      const logs = captureLogs();
      const pool = ownPool(1);
      const held = await pool.connect();
      const requestId = newRequestId();
      // free the connection after ~350 ms: acquire succeeds with ~150 ms left; the write is fast enough to fit
      setTimeout(() => held.release(), 350);
      const elapsed = await timed(() => recorderOn(pool, logs).recordBestEffort(denial(requestId)));
      expect(elapsed).toBeLessThan(UPPER_BOUND_MS);
      const rows = await auditRowsOf(h.pool, requestId);
      // Either it fit in the remainder (row written, nothing logged) or it did not (no row, a timeout code):
      // never a write that outlives the single budget.
      if (rows.length === 1) {
        expect(parsed(logs.lines)).toHaveLength(0);
      } else {
        expect(['AUDIT_WRITE_TIMEOUT', 'AUDIT_ACQUIRE_TIMEOUT']).toContain(parsed(logs.lines)[0]?.code);
      }
      await expectPoolRecovered(pool);
    });
  });

  describe('best effort: every failure is swallowed after one fixed-literal log line', () => {
    it('a REAL INSERT failure (duplicate audit id) is swallowed', async () => {
      const logs = captureLogs();
      const fixedId = '88888888-8888-4888-8888-888888888888';
      const seeded = new AuditWriter({ idGenerator: () => fixedId });
      const recorder = recorderOn(ownPool(2), logs, seeded);
      const first = newRequestId();
      const second = newRequestId();

      await recorder.recordBestEffort(denial(first, { metadata: { m: SECRET_MARKER } })); // may already exist on a re-run
      await recorder.recordBestEffort(denial(second, { metadata: { m: SECRET_MARKER } })); // guaranteed collision

      expect(await auditRowsOf(h.pool, second)).toHaveLength(0);
      const codes = parsed(logs.lines).map((line) => line.code);
      expect(codes[codes.length - 1]).toBe('AUDIT_WRITE_FAILED');
      expect(logs.lines.join('\n')).not.toContain(SECRET_MARKER);
    });

    it('a database outage (nothing listens on the port) is swallowed quickly', async () => {
      const logs = captureLogs();
      const dead = new URL(config.database.url);
      dead.hostname = '127.0.0.1';
      dead.port = '1';
      const recorder = recorderOn(ownPool(1, dead.toString()), logs);
      const requestId = newRequestId();

      const elapsed = await timed(() => recorder.recordBestEffort(denial(requestId)));

      expect(elapsed).toBeLessThan(UPPER_BOUND_MS);
      expect(parsed(logs.lines).map((line) => line.code)).toEqual(['AUDIT_WRITE_FAILED']);
      const password = decodeURIComponent(dead.password);
      const joined = logs.lines.join('\n');
      expect(joined).not.toContain(dead.toString());
      if (password.length > 0) {
        expect(joined).not.toContain(password);
      }
    });

    it('an error whose message carries a secret never reaches the log: only a fixed code does', async () => {
      const logs = captureLogs();
      const failing: AuditAppender = { append: () => Promise.reject(new ThrowingMarkerError()) };
      await recorderOn(ownPool(1), logs, failing).recordBestEffort(denial(newRequestId()));

      expect(logs.lines).toHaveLength(1);
      const line = JSON.parse(logs.lines[0] as string) as Record<string, unknown>;
      expect(Object.keys(line).sort()).toEqual(['code', 'event', 'level', 'time']);
      expect(line['level']).toBe('warn');
      expect(line['event']).toBe('audit_standalone_failed');
      expect(line['code']).toBe('AUDIT_WRITE_FAILED');
      expect(logs.lines.join('\n')).not.toContain(SECRET_MARKER);
    });

    it('a logger that throws changes nothing: the call still resolves', async () => {
      const throwing = {
        log: (): void => {
          throw new ThrowingMarkerError();
        },
      };
      const pool = ownPool(1);
      const recorder = new StandaloneAuditRecorder(poolClientSource(pool), new AuditWriter(), throwing);
      await expect(recorder.recordBestEffort(auditEntry(newRequestId()) as never)).resolves.toBeUndefined(); // refused entry
      const failing: AuditAppender = { append: () => Promise.reject(new Error('boom')) };
      const failingRecorder = new StandaloneAuditRecorder(poolClientSource(pool), failing, throwing);
      await expect(failingRecorder.recordBestEffort(denial(newRequestId()))).resolves.toBeUndefined();
      await expectPoolRecovered(pool);
    });
  });

  describe('nested use is refused and leaks nothing', () => {
    it('calling it from inside a business callback cannot write, cannot leak a connection and does not disturb the outer commit', async () => {
      const logs = captureLogs();
      const pool = ownPool(3);
      const manager = managerFor(poolClientSource(pool));
      const recorder = recorderOn(pool, logs);
      const scopeId = newScopeId();
      const requestId = newRequestId();

      await manager.withTransaction(async (context) => {
        await context.query(`INSERT INTO ${h.items} (label, scope_id) VALUES ('x', $1)`, [scopeId]);
        await recorder.recordBestEffort(denial(requestId)); // misuse: still inside the business callback
      });

      expect(await countItems(h, scopeId)).toBe(1); // the outer transaction committed normally
      expect(await auditRowsOf(h.pool, requestId)).toHaveLength(0);
      expect(parsed(logs.lines).map((line) => line.code)).toEqual(['AUDIT_WRITE_FAILED']);
      await expectPoolRecovered(pool);
    });
  });

  describe('the original denial is never changed (real HTTP pipeline)', () => {
    let app: INestApplication;
    let baseUrl: string;
    const appLogs = captureLogs();
    let heldForever: PoolClient | undefined;

    interface Envelope {
      error: { code: string; request_id: string };
    }

    beforeAll(async () => {
      const businessPool = ownPool(2);
      const exhausted = ownPool(1);
      heldForever = await exhausted.connect(); // the recorder's pool is permanently busy
      const dead = new URL(config.database.url);
      dead.hostname = '127.0.0.1';
      dead.port = '1';
      const outage = ownPool(1, dead.toString());

      const moduleRef = await Test.createTestingModule({
        imports: [
          LoggingModule.forRoot(appLogs.logger),
          DenialHarnessModule.register({
            harness: h,
            manager: managerFor(poolClientSource(businessPool)),
            recorders: {
              healthy: recorderOn(businessPool, appLogs),
              exhausted: recorderOn(exhausted, appLogs),
              outage: recorderOn(outage, appLogs),
            },
          }),
        ],
      }).compile();
      app = moduleRef.createNestApplication({ logger: false });
      configureApp(app);
      await app.listen(0, '127.0.0.1');
      baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      await app.close();
      heldForever?.release(); // before the pools are ended, or ending the exhausted pool would wait for it
    });

    async function deny(profile: string): Promise<{ status: number; body: Envelope; scopeId: string }> {
      const scopeId = newScopeId();
      const response = await fetch(`${baseUrl}/v1/harness/denial/${profile}/${scopeId}`);
      return { status: response.status, body: (await response.json()) as Envelope, scopeId };
    }

    it('healthy audit: the client gets the original 409 and the DENIED row carries the same request id', async () => {
      const { status, body, scopeId } = await deny('healthy');
      expect(status).toBe(409);
      expect(body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(await countItems(h, scopeId)).toBe(0);
      const rows = await auditRowsOf(h.pool, body.error.request_id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ outcome: 'DENIED', action: 'fixture.deny.v1' });
    });

    it.each(['exhausted', 'outage'])('audit infrastructure down (%s): the client still gets the SAME original 409, nothing is written', async (profile) => {
      const { status, body, scopeId } = await deny(profile);
      expect(status).toBe(409);
      expect(body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(await countItems(h, scopeId)).toBe(0);
      expect(await auditRowsOf(h.pool, body.error.request_id)).toHaveLength(0);
    });
  });
});
