import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { AuditWriter } from '../../apps/backend/src/audit/audit-writer';
import { AuditEntryError } from '../../apps/backend/src/audit/audit-entry';
import { JsonValidationError } from '../../apps/backend/src/shared/json/safe-json';
import {
  auditCount,
  auditEntry,
  auditRowsOf,
  dbClockMs,
  newRequestId,
  SECRET_MARKER,
} from './support/audit-outbox-fixtures';
import { countItems, createHarness, errorOf, IdempotencyHarness, insertItem, newScopeId } from './support/idempotency-fixtures';

// M00-C1B — C11: AuditWriter inside the business transaction, on a REAL PostgreSQL. A SUCCESS row exists
// exactly when the business mutation committed; any audit failure (validation or database) takes the
// mutation down with it; and the table cannot be changed afterwards.
describe('M00-C1B C11 — audit writer, transaction-only', () => {
  let h: IdempotencyHarness;
  const writer = new AuditWriter();

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.close();
  });

  it('commit: the SUCCESS row and the business row exist together, with a database timestamp and canonical metadata', async () => {
    const scopeId = newScopeId();
    const requestId = newRequestId();
    const before = await dbClockMs(h.pool);

    await h.manager.withTransaction(async (context) => {
      await insertItem(h, context, scopeId);
      await writer.append(context, auditEntry(requestId, { metadata: { b: 2, a: { z: 1, y: [1, 2] } } }));
    });
    const after = await dbClockMs(h.pool);

    expect(await countItems(h, scopeId)).toBe(1);
    const rows = await auditRowsOf(h.pool, requestId);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({
      request_id: requestId,
      actor_type: 'USER',
      actor_id: 'u-1',
      action: 'fixture.create.v1',
      resource_type: 'fixture_item',
      resource_id: 'item-1',
      resource_version: '1',
      outcome: 'SUCCESS',
      reason_code: null,
      metadata: { a: { y: [1, 2], z: 1 }, b: 2 },
    });
    const occurred = (row?.occurred_at as Date).getTime();
    expect(occurred).toBeGreaterThanOrEqual(before - 1);
    expect(occurred).toBeLessThanOrEqual(after + 1);
  });

  it('rollback: a business failure after the audit append leaves no audit row and no business row', async () => {
    const scopeId = newScopeId();
    const requestId = newRequestId();
    const error = await errorOf(() =>
      h.manager.withTransaction(async (context) => {
        await insertItem(h, context, scopeId);
        await writer.append(context, auditEntry(requestId));
        throw new Error('business failure after audit');
      }),
    );
    expect((error as Error).message).toBe('business failure after audit');
    expect(await countItems(h, scopeId)).toBe(0);
    expect(await auditRowsOf(h.pool, requestId)).toHaveLength(0);
  });

  it('unsafe metadata is rejected before any statement and takes the business mutation down with it', async () => {
    const scopeId = newScopeId();
    const requestId = newRequestId();
    const error = await errorOf(() =>
      h.manager.withTransaction(async (context) => {
        await insertItem(h, context, scopeId);
        await writer.append(context, auditEntry(requestId, { metadata: { access_token: SECRET_MARKER } }));
      }),
    );
    expect(error instanceof JsonValidationError).toBe(true);
    expect((error as Error).message).not.toContain(SECRET_MARKER);
    expect(await countItems(h, scopeId)).toBe(0);
    expect(await auditRowsOf(h.pool, requestId)).toHaveLength(0);
  });

  it('oversized metadata (over the 8 KiB canonical cap) is rejected, never truncated, and rolls the mutation back', async () => {
    const scopeId = newScopeId();
    const requestId = newRequestId();
    const error = await errorOf(() =>
      h.manager.withTransaction(async (context) => {
        await insertItem(h, context, scopeId);
        await writer.append(context, auditEntry(requestId, { metadata: { note: 'x'.repeat(8 * 1024) } }));
      }),
    );
    expect(error instanceof JsonValidationError).toBe(true);
    expect(await countItems(h, scopeId)).toBe(0);
    expect(await auditRowsOf(h.pool, requestId)).toHaveLength(0);
  });

  it('an invalid entry (DENIED without a reason code) is refused before any statement and rolls the mutation back', async () => {
    const scopeId = newScopeId();
    const requestId = newRequestId();
    const error = await errorOf(() =>
      h.manager.withTransaction(async (context) => {
        await insertItem(h, context, scopeId);
        await writer.append(context, auditEntry(requestId, { outcome: 'DENIED' })); // reason code missing
      }),
    );
    expect(error instanceof AuditEntryError).toBe(true);
    expect(await countItems(h, scopeId)).toBe(0);
    expect(await auditRowsOf(h.pool, requestId)).toHaveLength(0);
  });

  it('a REAL database failure (duplicate audit id) propagates and rolls the business mutation back', async () => {
    const fixedId = '44444444-4444-4444-8444-444444444444';
    const first = newRequestId();
    const second = newRequestId();
    const scopeId = newScopeId();
    const seeded = new AuditWriter({ idGenerator: () => fixedId });

    // The id may already exist if this spec was re-run against the same database: that is the collision.
    const existing = await h.pool.query('SELECT 1 FROM app.audit_logs WHERE audit_id = $1', [fixedId]);
    if (existing.rowCount === 0) {
      await h.manager.withTransaction((context) => seeded.append(context, auditEntry(first)));
    }

    const error = await errorOf(() =>
      h.manager.withTransaction(async (context) => {
        await insertItem(h, context, scopeId);
        await seeded.append(context, auditEntry(second));
      }),
    );
    expect((error as { code?: string }).code).toBe('23505');
    expect(await countItems(h, scopeId)).toBe(0);
    expect(await auditRowsOf(h.pool, second)).toHaveLength(0);
  });

  it('the writer takes the participant context only: it cannot run outside a transaction', async () => {
    const closed = await h.manager.withTransaction((context) => Promise.resolve(context));
    const error = await errorOf(() => writer.append(closed, auditEntry(newRequestId())));
    expect(error).toBeInstanceOf(Error);
  });

  describe('append-only, enforced by the database', () => {
    const requestId = newRequestId();

    beforeAll(async () => {
      await h.manager.withTransaction((context) => writer.append(context, auditEntry(requestId, { metadata: { keep: 'me' } })));
    });

    async function expectRestricted(statement: string): Promise<void> {
      const before = await auditCount(h.pool);
      const error = await errorOf(() => h.pool.query(statement));
      expect((error as { code?: string }).code).toBe('23001');
      expect(await auditCount(h.pool)).toBe(before);
    }

    it.each([
      ['UPDATE of the committed row', `UPDATE app.audit_logs SET outcome = 'FAILURE', reason_code = 'X' WHERE request_id = '${'$REQ'}'`],
      ['UPDATE of every row', "UPDATE app.audit_logs SET metadata = '{}'"],
      ['UPDATE matching zero rows', "UPDATE app.audit_logs SET metadata = '{}' WHERE false"],
      ['DELETE of the committed row', `DELETE FROM app.audit_logs WHERE request_id = '${'$REQ'}'`],
      ['DELETE of every row', 'DELETE FROM app.audit_logs'],
      ['DELETE matching zero rows', 'DELETE FROM app.audit_logs WHERE false'],
      ['TRUNCATE', 'TRUNCATE app.audit_logs'],
      ['TRUNCATE together with another table', 'TRUNCATE app.audit_logs, app.outbox_events'],
    ])('rejects %s with SQLSTATE 23001 and leaves the table intact', async (_label, template) => {
      await expectRestricted(template.replace('$REQ', requestId));
      const rows = await auditRowsOf(h.pool, requestId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ outcome: 'SUCCESS', reason_code: null, metadata: { keep: 'me' } });
    });

    it('rejects a mutation attempted inside a transaction, which then cannot commit it', async () => {
      const error = await errorOf(() =>
        h.manager.withTransaction(async (context) => {
          await context.query(`DELETE FROM app.audit_logs WHERE request_id = '${requestId}'`);
        }),
      );
      expect((error as { code?: string }).code).toBe('23001');
      expect(await auditRowsOf(h.pool, requestId)).toHaveLength(1);
    });
  });
});
