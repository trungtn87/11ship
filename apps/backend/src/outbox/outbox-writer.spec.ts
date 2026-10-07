import { describe, expect, it } from '@jest/globals';
import { TechnicalError } from '../common/app-errors';
import { codeOf } from '../shared/source-scan.fixture';
import { QueryRows, TransactionContext } from '../transaction/transaction-context';
import { OutboxEventError, OutboxEventInput } from './outbox-event';
import { OutboxWriter } from './outbox-writer';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface Call {
  readonly text: string;
  readonly values: readonly unknown[] | undefined;
}

function fakeContext(rowCount: number | null = 1, failure?: unknown): { context: TransactionContext; calls: Call[] } {
  const calls: Call[] = [];
  const context: TransactionContext = {
    isActive: true,
    query<R extends object = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryRows<R>> {
      calls.push({ text, values });
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      return Promise.resolve({ rows: [], rowCount } as QueryRows<R>);
    },
  };
  return { context, calls };
}

function event(overrides: Record<string, unknown> = {}): OutboxEventInput {
  return {
    eventType: 'order.created',
    eventSchemaVersion: 1,
    resourceType: 'order',
    resourceId: 'ord-1',
    resourceVersion: 4,
    payload: { b: 2, a: 1 },
    ...overrides,
  } as OutboxEventInput;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe('OutboxWriter.append — one INSERT in the caller transaction', () => {
  it('sends one statement, binds the envelope in order and returns the generated id', async () => {
    const { context, calls } = fakeContext();
    const id = await new OutboxWriter().append(context, event());

    expect(id).toMatch(UUID);
    expect(calls).toHaveLength(1);
    const call = calls[0] as Call;
    expect(call.text).toContain('INSERT INTO app.outbox_events');
    expect(call.values).toEqual([id, 'order.created', 1, 'order', 'ord-1', 4, '{"a":1,"b":2}']);
  });

  it('generates a fresh id per event and honours the id seam', async () => {
    const { context } = fakeContext();
    const writer = new OutboxWriter();
    expect(await writer.append(context, event())).not.toBe(await writer.append(context, event()));
    const seeded = new OutboxWriter({ idGenerator: () => '22222222-2222-4222-8222-222222222222' });
    expect(await seeded.append(context, event())).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('writes the initial delivery state as literals and takes both timestamps from ONE database clock sample', async () => {
    const { context, calls } = fakeContext();
    await new OutboxWriter().append(context, event());
    const text = (calls[0] as Call).text;
    expect(text).toContain("date_trunc('milliseconds', clock_timestamp())");
    expect(text.match(/clock_timestamp\(\)/g)).toHaveLength(1);
    expect(text.match(/clock\.sampled_at/g)).toHaveLength(2);
    expect(text).toContain("'PENDING', 0, clock.sampled_at, NULL, NULL, NULL, NULL");
    expect(((calls[0] as Call).values as unknown[]).some((value) => value instanceof Date)).toBe(false);
    expect(codeOf('outbox/outbox-writer.ts')).not.toMatch(/Date\.now|new Date|performance\.now|hrtime/);
  });
});

describe('OutboxWriter.append — failures', () => {
  it('validates before any statement', async () => {
    const { context, calls } = fakeContext();
    const error = await rejection(new OutboxWriter().append(context, event({ payload: { password: 'x' } })));
    expect(error).toBeInstanceOf(Error);
    expect(calls).toHaveLength(0);
  });

  it('refuses caller-supplied delivery state without any statement', async () => {
    for (const field of ['status', 'attemptCount', 'availableAt', 'lockedAt', 'lockToken', 'publishedAt', 'lastErrorCode', 'eventId', 'occurredAt']) {
      const { context, calls } = fakeContext();
      const error = await rejection(new OutboxWriter().append(context, event({ [field]: 'x' })));
      expect(error instanceof OutboxEventError).toBe(true);
      expect(calls).toHaveLength(0);
    }
  });

  it('propagates a database error unchanged', async () => {
    const dbError = Object.assign(new Error('boom'), { code: '23505' });
    const { context } = fakeContext(1, dbError);
    expect(await rejection(new OutboxWriter().append(context, event()))).toBe(dbError);
  });

  it('fails unless exactly one row was written', async () => {
    for (const rowCount of [0, 2, null]) {
      const { context } = fakeContext(rowCount);
      expect(await rejection(new OutboxWriter().append(context, event()))).toBeInstanceOf(TechnicalError);
    }
  });
});

describe('OutboxWriter — write path only', () => {
  it('has a single public method and no injectable dependency', () => {
    expect(OutboxWriter.length).toBe(0);
    expect(Object.getOwnPropertyNames(OutboxWriter.prototype).sort()).toEqual(['append', 'constructor']);
  });

  it('contains no transaction control and no dispatcher concern', () => {
    const code = codeOf('outbox/outbox-writer.ts') + codeOf('outbox/outbox-event.ts') + codeOf('outbox/outbox.module.ts');
    expect(code).not.toMatch(/from 'pg'|TransactionManager|withTransaction|PoolClient|\bBEGIN\b|\bCOMMIT\b|\bROLLBACK\b|SAVEPOINT/);
    expect(code).not.toMatch(/claim|acknowledge|\back\b|\bnack\b|lease|retry|backoff|reclaim|redrive|publisher|broker|redis|worker|dispatch|\bDEAD\b|PROCESSING|SKIP LOCKED/i);
  });
});
