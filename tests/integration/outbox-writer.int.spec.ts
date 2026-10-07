import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { OutboxEventError } from '../../apps/backend/src/outbox/outbox-event';
import { OutboxWriter } from '../../apps/backend/src/outbox/outbox-writer';
import { JsonValidationError } from '../../apps/backend/src/shared/json/safe-json';
import { dbClockMs, newResourceId, outboxEvent, outboxRowsOf, SECRET_MARKER } from './support/audit-outbox-fixtures';
import { countItems, createHarness, errorOf, IdempotencyHarness, insertItem, newScopeId } from './support/idempotency-fixtures';
import { UUID_PATTERN } from './support/test-helpers';

// M00-C1B — C12: OutboxWriter inside the business transaction, on a REAL PostgreSQL. The event commits or
// rolls back with the mutation and always starts in the one initial delivery state.
describe('M00-C1B C12 — outbox writer, transaction-only', () => {
  let h: IdempotencyHarness;
  const writer = new OutboxWriter();

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.close();
  });

  it('commit: returns the event id; the row is PENDING with zero attempts and no lease, publication or error', async () => {
    const scopeId = newScopeId();
    const resourceId = newResourceId();
    const before = await dbClockMs(h.pool);

    const eventId = await h.manager.withTransaction(async (context) => {
      await insertItem(h, context, scopeId);
      return writer.append(context, outboxEvent(resourceId, { resourceVersion: 7, payload: { b: 2, a: { z: 1 } } }));
    });
    const after = await dbClockMs(h.pool);

    expect(eventId).toMatch(UUID_PATTERN);
    expect(await countItems(h, scopeId)).toBe(1);
    const rows = await outboxRowsOf(h.pool, resourceId);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({
      event_id: eventId,
      event_type: 'fixture.created',
      event_schema_version: 1,
      resource_type: 'fixture_item',
      resource_id: resourceId,
      resource_version: '7',
      payload: { a: { z: 1 }, b: 2 },
      status: 'PENDING',
      attempt_count: 0,
      locked_at: null,
      lock_token: null,
      published_at: null,
      last_error_code: null,
    });
    expect((row?.available_at as Date).getTime()).toBe((row?.occurred_at as Date).getTime());
    const occurred = (row?.occurred_at as Date).getTime();
    expect(occurred).toBeGreaterThanOrEqual(before - 1);
    expect(occurred).toBeLessThanOrEqual(after + 1);
  });

  it('rollback: a business failure after the append leaves no event and no business row', async () => {
    const scopeId = newScopeId();
    const resourceId = newResourceId();
    const error = await errorOf(() =>
      h.manager.withTransaction(async (context) => {
        await insertItem(h, context, scopeId);
        await writer.append(context, outboxEvent(resourceId));
        throw new Error('business failure after outbox');
      }),
    );
    expect((error as Error).message).toBe('business failure after outbox');
    expect(await countItems(h, scopeId)).toBe(0);
    expect(await outboxRowsOf(h.pool, resourceId)).toHaveLength(0);
  });

  it('an unsafe payload is rejected before any statement and rolls the mutation back', async () => {
    const scopeId = newScopeId();
    const resourceId = newResourceId();
    const error = await errorOf(() =>
      h.manager.withTransaction(async (context) => {
        await insertItem(h, context, scopeId);
        await writer.append(context, outboxEvent(resourceId, { payload: { nested: [{ password: SECRET_MARKER }] } }));
      }),
    );
    expect(error instanceof JsonValidationError).toBe(true);
    expect((error as Error).message).not.toContain(SECRET_MARKER);
    expect(await countItems(h, scopeId)).toBe(0);
    expect(await outboxRowsOf(h.pool, resourceId)).toHaveLength(0);
  });

  it('an oversized payload (over 64 KiB canonical) is rejected, never truncated, and rolls the mutation back', async () => {
    const scopeId = newScopeId();
    const resourceId = newResourceId();
    const error = await errorOf(() =>
      h.manager.withTransaction(async (context) => {
        await insertItem(h, context, scopeId);
        await writer.append(context, outboxEvent(resourceId, { payload: { blob: 'x'.repeat(64 * 1024) } }));
      }),
    );
    expect(error instanceof JsonValidationError).toBe(true);
    expect(await countItems(h, scopeId)).toBe(0);
    expect(await outboxRowsOf(h.pool, resourceId)).toHaveLength(0);
  });

  it('a payload just under the cap is stored whole', async () => {
    const resourceId = newResourceId();
    const blob = 'y'.repeat(60 * 1024);
    await h.manager.withTransaction((context) => writer.append(context, outboxEvent(resourceId, { payload: { blob } })));
    const rows = await outboxRowsOf(h.pool, resourceId);
    expect((rows[0]?.payload as { blob: string }).blob).toHaveLength(blob.length);
  });

  it('refuses delivery state supplied by the caller at runtime: no statement, no row, mutation rolled back', async () => {
    const fields: Array<[string, unknown]> = [
      ['status', 'PUBLISHED'],
      ['attemptCount', 3],
      ['availableAt', '2030-01-01T00:00:00Z'],
      ['lockedAt', '2030-01-01T00:00:00Z'],
      ['lockToken', '55555555-5555-4555-8555-555555555555'],
      ['publishedAt', '2030-01-01T00:00:00Z'],
      ['lastErrorCode', 'BOOM'],
      ['eventId', '66666666-6666-4666-8666-666666666666'],
      ['occurredAt', '2030-01-01T00:00:00Z'],
    ];
    for (const [name, value] of fields) {
      const scopeId = newScopeId();
      const resourceId = newResourceId();
      const error = await errorOf(() =>
        h.manager.withTransaction(async (context) => {
          await insertItem(h, context, scopeId);
          await writer.append(context, outboxEvent(resourceId, { [name]: value }));
        }),
      );
      expect(error instanceof OutboxEventError).toBe(true);
      expect((error as OutboxEventError).field).toBe('server_owned_field');
      expect(await countItems(h, scopeId)).toBe(0);
      expect(await outboxRowsOf(h.pool, resourceId)).toHaveLength(0);
    }
  });

  it('many events in one transaction: every one is PENDING and available_at equals occurred_at exactly', async () => {
    const resourceId = newResourceId();
    const ids = await h.manager.withTransaction(async (context) => {
      const created: string[] = [];
      for (let version = 1; version <= 60; version += 1) {
        created.push(await writer.append(context, outboxEvent(resourceId, { resourceVersion: version })));
      }
      return created;
    });
    expect(new Set(ids).size).toBe(60);
    const rows = await outboxRowsOf(h.pool, resourceId);
    expect(rows).toHaveLength(60);
    const skewed = await h.pool.query(
      `SELECT 1 FROM app.outbox_events
        WHERE resource_id = $1 AND (available_at <> occurred_at OR status <> 'PENDING' OR attempt_count <> 0
              OR locked_at IS NOT NULL OR lock_token IS NOT NULL OR published_at IS NOT NULL OR last_error_code IS NOT NULL)`,
      [resourceId],
    );
    expect(skewed.rowCount).toBe(0);
  });

  it('two events of different types for the same resource version are both stored (no unique on resource+version)', async () => {
    const resourceId = newResourceId();
    await h.manager.withTransaction(async (context) => {
      await writer.append(context, outboxEvent(resourceId, { eventType: 'fixture.created' }));
      await writer.append(context, outboxEvent(resourceId, { eventType: 'fixture.indexed' }));
    });
    const rows = await outboxRowsOf(h.pool, resourceId);
    expect(rows.map((row) => row.event_type).sort()).toEqual(['fixture.created', 'fixture.indexed']);
  });

  it('a REAL database failure (duplicate event id) propagates and rolls the business mutation back', async () => {
    const fixedId = '77777777-7777-4777-8777-777777777777';
    const seeded = new OutboxWriter({ idGenerator: () => fixedId });
    const existing = await h.pool.query('SELECT 1 FROM app.outbox_events WHERE event_id = $1', [fixedId]);
    if (existing.rowCount === 0) {
      await h.manager.withTransaction((context) => seeded.append(context, outboxEvent(newResourceId())));
    }
    const scopeId = newScopeId();
    const resourceId = newResourceId();
    const error = await errorOf(() =>
      h.manager.withTransaction(async (context) => {
        await insertItem(h, context, scopeId);
        await seeded.append(context, outboxEvent(resourceId));
      }),
    );
    expect((error as { code?: string }).code).toBe('23505');
    expect(await countItems(h, scopeId)).toBe(0);
    expect(await outboxRowsOf(h.pool, resourceId)).toHaveLength(0);
  });
});
