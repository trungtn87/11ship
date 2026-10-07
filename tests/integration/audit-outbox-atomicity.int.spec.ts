import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { AuditWriter } from '../../apps/backend/src/audit/audit-writer';
import { OutboxWriter } from '../../apps/backend/src/outbox/outbox-writer';
import { IdempotentResult } from '../../apps/backend/src/idempotency/idempotency-executor';
import { TransactionContext } from '../../apps/backend/src/transaction/transaction-context';
import { auditEntry, auditRowsOf, newRequestId, newResourceId, outboxEvent, outboxRowsOf } from './support/audit-outbox-fixtures';
import {
  countItems,
  createHarness,
  errorOf,
  IdempotencyHarness,
  insertItem,
  newKey,
  newScopeId,
  recordsOf,
  requestOf,
} from './support/idempotency-fixtures';

// M00-C1B — C28: the four effects of one idempotent business operation — the business row, the audit row,
// the outbox event and the idempotency record — are ONE atomic unit, using the REAL TransactionManager,
// IdempotencyExecutor, AuditWriter and OutboxWriter on a REAL PostgreSQL.
//
// Fault matrix (each row: which participant fails, and how):
//   audit writer    : writer-level (unsafe metadata)            | real PostgreSQL (duplicate audit_id, 23505)
//   outbox writer   : writer-level (unsafe payload)             | real PostgreSQL (duplicate event_id, 23505)
//   idempotency     : real PostgreSQL (a test-installed trigger raises XX001 on the record INSERT)
//   business step   : the callback throws after all three participants succeeded
// Expected for every fault: 0 business rows, 0 audit rows, 0 outbox events, 0 idempotency records.
describe('M00-C1B C28 — audit + outbox + idempotency + business: all or nothing', () => {
  let h: IdempotencyHarness;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.close();
  });

  interface Effects {
    readonly items: number;
    readonly audit: number;
    readonly outbox: number;
    readonly idempotency: number;
  }

  interface Scenario {
    readonly scopeId: string;
    readonly key: string;
    readonly requestId: string;
    readonly resourceId: string;
    readonly calls: { n: number };
  }

  function scenario(): Scenario {
    return { scopeId: newScopeId(), key: newKey(), requestId: newRequestId(), resourceId: newResourceId(), calls: { n: 0 } };
  }

  async function effectsOf(s: Scenario): Promise<Effects> {
    return {
      items: await countItems(h, s.scopeId),
      audit: (await auditRowsOf(h.pool, s.requestId)).length,
      outbox: (await outboxRowsOf(h.pool, s.resourceId)).length,
      idempotency: (await recordsOf(h, s.scopeId, s.key)).length,
    };
  }

  const NOTHING: Effects = { items: 0, audit: 0, outbox: 0, idempotency: 0 };
  const EVERYTHING: Effects = { items: 1, audit: 1, outbox: 1, idempotency: 1 };

  interface Participants {
    readonly audit?: AuditWriter;
    readonly outbox?: OutboxWriter;
    readonly auditOverrides?: Record<string, unknown>;
    readonly eventOverrides?: Record<string, unknown>;
    readonly failAfterAll?: boolean;
  }

  function operation(s: Scenario, p: Participants = {}) {
    const audit = p.audit ?? new AuditWriter();
    const outbox = p.outbox ?? new OutboxWriter();
    return async (context: TransactionContext): Promise<IdempotentResult> => {
      s.calls.n += 1;
      const itemId = await insertItem(h, context, s.scopeId);
      await audit.append(context, auditEntry(s.requestId, p.auditOverrides));
      await outbox.append(context, outboxEvent(s.resourceId, p.eventOverrides));
      if (p.failAfterAll === true) {
        throw new Error('business failure after audit and outbox');
      }
      return { status: 201, replayGuard: { grant_id: s.scopeId }, payload: { item_id: itemId } };
    };
  }

  function run(s: Scenario, p: Participants = {}) {
    return h.executor().execute(requestOf({ harness: h, scopeId: s.scopeId, key: s.key }), operation(s, p));
  }

  it('success: all four effects are committed together', async () => {
    const s = scenario();
    const outcome = await run(s);
    expect(outcome.replayed).toBe(false);
    expect(outcome.persisted).toBe(true);
    expect(await effectsOf(s)).toEqual(EVERYTHING);
  });

  describe('every fault rolls all four effects back', () => {
    it('audit writer, writer-level fault (unsafe metadata)', async () => {
      const s = scenario();
      const error = await errorOf(() => run(s, { auditOverrides: { metadata: { access_token: 'x' } } }));
      expect(error).toBeInstanceOf(Error);
      expect(await effectsOf(s)).toEqual(NOTHING);
    });

    it('outbox writer, writer-level fault (unsafe payload) — the audit row written just before is rolled back too', async () => {
      const s = scenario();
      const error = await errorOf(() => run(s, { eventOverrides: { payload: { password: 'x' } } }));
      expect(error).toBeInstanceOf(Error);
      expect(await effectsOf(s)).toEqual(NOTHING);
    });

    it('audit writer, real PostgreSQL fault (duplicate audit_id, 23505)', async () => {
      const fixedId = '99999999-9999-4999-8999-999999999999';
      const seeded = new AuditWriter({ idGenerator: () => fixedId });
      const existing = await h.pool.query('SELECT 1 FROM app.audit_logs WHERE audit_id = $1', [fixedId]);
      if (existing.rowCount === 0) {
        await h.manager.withTransaction((context) => seeded.append(context, auditEntry(newRequestId())));
      }
      const s = scenario();
      const error = await errorOf(() => run(s, { audit: seeded }));
      expect((error as { code?: string }).code).toBe('23505');
      expect(await effectsOf(s)).toEqual(NOTHING);
    });

    it('outbox writer, real PostgreSQL fault (duplicate event_id, 23505) — audit and business rows rolled back too', async () => {
      const fixedId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const seeded = new OutboxWriter({ idGenerator: () => fixedId });
      const existing = await h.pool.query('SELECT 1 FROM app.outbox_events WHERE event_id = $1', [fixedId]);
      if (existing.rowCount === 0) {
        await h.manager.withTransaction((context) => seeded.append(context, outboxEvent(newResourceId())));
      }
      const s = scenario();
      const error = await errorOf(() => run(s, { outbox: seeded }));
      expect((error as { code?: string }).code).toBe('23505');
      expect(await effectsOf(s)).toEqual(NOTHING);
    });

    it('idempotency record persist, real PostgreSQL fault (trigger raises XX001) — the three effects before it are rolled back', async () => {
      const suffix = randomBytes(5).toString('hex');
      const fn = `app.c1b_fault_${suffix}`;
      const trigger = `c1b_fault_${suffix}`;
      // Test-installed fault, scoped to THIS harness's random scope_type, removed in `finally`.
      await h.pool.query(
        `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected persist failure' USING ERRCODE = 'XX001'; END; $$`,
      );
      await h.pool.query(
        `CREATE TRIGGER ${trigger} BEFORE INSERT ON app.idempotency_records FOR EACH ROW WHEN (NEW.scope_type = '${h.scopeType}') EXECUTE FUNCTION ${fn}()`,
      );
      try {
        const s = scenario();
        const error = await errorOf(() => run(s));
        expect(error).toBeInstanceOf(Error);
        expect(s.calls.n).toBe(1); // the callback ran: its effects existed inside the transaction and were undone
        expect(await effectsOf(s)).toEqual(NOTHING);
      } finally {
        await h.pool.query(`DROP TRIGGER ${trigger} ON app.idempotency_records`);
        await h.pool.query(`DROP FUNCTION ${fn}()`);
      }
    });

    it('a business failure after audit and outbox both succeeded', async () => {
      const s = scenario();
      const error = await errorOf(() => run(s, { failAfterAll: true }));
      expect((error as Error).message).toBe('business failure after audit and outbox');
      expect(await effectsOf(s)).toEqual(NOTHING);
    });
  });

  describe('after a rollback the operation is not poisoned', () => {
    it('the same key retried after a rolled-back attempt runs normally and commits all four effects', async () => {
      const s = scenario();
      await errorOf(() => run(s, { eventOverrides: { payload: { password: 'x' } } }));
      expect(await effectsOf(s)).toEqual(NOTHING);

      const retry = await run(s);
      expect(retry.replayed).toBe(false);
      expect(s.calls.n).toBe(2);
      expect(await effectsOf(s)).toEqual(EVERYTHING);
    });
  });

  describe('replay', () => {
    it('the same key replays the stored result: the callback does not run again and no second audit row or event appears', async () => {
      const s = scenario();
      const first = await run(s);
      const second = await run(s);

      expect(first.replayed).toBe(false);
      expect(second.replayed).toBe(true);
      expect(second.payload).toEqual(first.payload);
      expect(s.calls.n).toBe(1);
      expect(await effectsOf(s)).toEqual(EVERYTHING);
    });
  });
});
