import { describe, expect, it } from '@jest/globals';
import { AppError } from '../common/app-errors';
import { DEFAULT_OUTBOX_CONFIG, OutboxConfig } from '../config/outbox-config';
import { codeOf } from '../shared/source-scan.fixture';
import { QueryRows, TransactionContext } from '../transaction/transaction-context';
import { backoffDelayMs } from './outbox-backoff';
import {
  OUTBOX_DEAD_SWEEP_LIMIT,
  OUTBOX_FAILURE_CODES,
  OutboxDispatchStore,
  OutboxFailureCode,
  OutboxLease,
  OutboxTransactionRunner,
} from './outbox-dispatch-store';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = '22222222-2222-4222-8222-222222222222';

interface Call {
  readonly text: string;
  readonly values: readonly unknown[] | undefined;
}

type Script = (call: Call, index: number) => unknown[] | Error;

/** A runner whose context answers from a script; it records the transactions and every statement. */
class FakeRunner implements OutboxTransactionRunner {
  transactions = 0;
  readonly calls: Call[] = [];
  failure: unknown;

  constructor(private readonly script: Script = () => []) {}

  async withTransaction<T>(work: (context: TransactionContext) => Promise<T>): Promise<T> {
    this.transactions += 1;
    const context: TransactionContext = {
      isActive: true,
      query: <R extends object = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryRows<R>> => {
        const call: Call = { text, values };
        this.calls.push(call);
        const answer = this.script(call, this.calls.length - 1);
        if (answer instanceof Error) {
          return Promise.reject(answer);
        }
        return Promise.resolve({ rows: answer as R[], rowCount: answer.length } as QueryRows<R>);
      },
    };
    const value = await work(context);
    if (this.failure !== undefined) {
      throw this.failure; // models a COMMIT whose outcome is unknown: the work ran, the caller gets an error
    }
    return value;
  }
}

function config(overrides: Partial<OutboxConfig> = {}): OutboxConfig {
  return { ...DEFAULT_OUTBOX_CONFIG, ...overrides };
}

function lease(overrides: Partial<OutboxLease> = {}): OutboxLease {
  return { eventId: EVENT_ID, lockToken: TOKEN, attemptCount: 1, ...overrides };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

function claimRow(n: number): Record<string, unknown> {
  return {
    event_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    event_type: 'order.created',
    event_schema_version: 2,
    resource_type: 'order',
    resource_id: `ord-${n}`,
    resource_version: '7', // bigint comes back from pg as a string
    occurred_at: new Date('2026-10-07T01:02:03.456Z'),
    payload: { a: n },
    attempt_count: 3,
    lock_token: `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`,
  };
}

describe('OutboxDispatchStore.claim', () => {
  it('opens ONE short transaction: dead sweep first, then the claim, with the config bounds as parameters', async () => {
    const runner = new FakeRunner((_call, index) => (index === 1 ? [claimRow(1), claimRow(2)] : [{ event_id: 'x' }]));
    const store = new OutboxDispatchStore(runner, config({ maxAttempts: 4, leaseMs: 12_345 }));

    const result = await store.claim(2);

    expect(runner.transactions).toBe(1);
    expect(runner.calls).toHaveLength(2);
    expect(runner.calls[0]?.values).toEqual([4, 12_345, OUTBOX_DEAD_SWEEP_LIMIT]);
    expect(runner.calls[1]?.values).toEqual([4, 12_345, 2]);
    expect(runner.calls[0]?.text).toContain("SET status = 'DEAD'");
    expect(runner.calls[1]?.text).toContain("SET status = 'PROCESSING'");
    expect(result.deadCount).toBe(1);
    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toEqual({
      eventId: '00000000-0000-4000-8000-000000000001',
      eventType: 'order.created',
      eventSchemaVersion: 2,
      resourceType: 'order',
      resourceId: 'ord-1',
      resourceVersion: 7,
      occurredAt: '2026-10-07T01:02:03.456Z',
      payload: { a: 1 },
      attemptCount: 3,
      lockToken: '33333333-3333-4333-8333-000000000001',
    });
  });

  it('claims nothing, and does not even open a transaction, for a limit of 0', async () => {
    const runner = new FakeRunner();
    const result = await new OutboxDispatchStore(runner, config()).claim(0);
    expect(result).toEqual({ events: [], deadCount: 0 });
    expect(runner.transactions).toBe(0);
  });

  it('refuses a limit above the batch size or one that is not an integer, before any transaction', async () => {
    const runner = new FakeRunner();
    const store = new OutboxDispatchStore(runner, config({ batchSize: 10 }));
    for (const bad of [11, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(await rejection(store.claim(bad))).toBeInstanceOf(RangeError);
    }
    expect(runner.transactions).toBe(0);
  });

  it('returns NO events when the transaction ends with an error, including an unknown COMMIT', async () => {
    const runner = new FakeRunner((_call, index) => (index === 1 ? [claimRow(1)] : []));
    runner.failure = new AppError('TRANSACTION_OUTCOME_UNKNOWN');
    const error = await rejection(new OutboxDispatchStore(runner, config()).claim(1));
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('TRANSACTION_OUTCOME_UNKNOWN');
    // The statements ran (that is what a committed-but-unacknowledged claim looks like), yet the caller
    // received no event: nothing can be published from that batch.
    expect(runner.calls).toHaveLength(2);
  });

  it('refuses an invalid config at construction', () => {
    expect(() => new OutboxDispatchStore(new FakeRunner(), config({ leaseMs: 5000 }))).toThrow(RangeError);
  });
});

describe('OutboxDispatchStore.ack', () => {
  it('is one conditional statement bound to (event id, token); a matched row means applied', async () => {
    const runner = new FakeRunner(() => [{ event_id: EVENT_ID }]);
    const applied = await new OutboxDispatchStore(runner, config()).ack(lease());
    expect(applied).toBe(true);
    expect(runner.transactions).toBe(1);
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]?.values).toEqual([EVENT_ID, TOKEN]);
    expect(runner.calls[0]?.text).toMatch(/WHERE event_id = \$1::uuid AND status = 'PROCESSING' AND lock_token = \$2::uuid/);
  });

  it('is a quiet no-op (false, no error) when nothing matches', async () => {
    const runner = new FakeRunner(() => []);
    expect(await new OutboxDispatchStore(runner, config()).ack(lease())).toBe(false);
  });

  it('never reaches the database with a malformed id or token', async () => {
    const runner = new FakeRunner(() => [{ event_id: EVENT_ID }]);
    const store = new OutboxDispatchStore(runner, config());
    expect(await store.ack(lease({ lockToken: 'not-a-uuid' }))).toBe(false);
    expect(await store.ack(lease({ eventId: "x'; DROP TABLE app.outbox_events;--" }))).toBe(false);
    expect(runner.transactions).toBe(0);
  });

  it('propagates a transaction error (an unknown ack COMMIT is the caller\'s to handle)', async () => {
    const runner = new FakeRunner(() => [{ event_id: EVENT_ID }]);
    runner.failure = new AppError('TRANSACTION_OUTCOME_UNKNOWN');
    expect(await rejection(new OutboxDispatchStore(runner, config()).ack(lease()))).toBeInstanceOf(AppError);
  });
});

describe('OutboxDispatchStore.fail', () => {
  it('binds (event id, token, max attempts, backoff, fixed code) and maps the resulting status', async () => {
    const cfg = config({ maxAttempts: 7, backoffBaseMs: 1000, backoffCapMs: 60_000 });
    for (const [status, expected] of [
      ['PENDING', 'RETRY_SCHEDULED'],
      ['DEAD', 'DEAD'],
    ] as const) {
      const runner = new FakeRunner(() => [{ status }]);
      const outcome = await new OutboxDispatchStore(runner, cfg).fail(lease({ attemptCount: 3 }), 'PUBLISH_TIMEOUT');
      expect(outcome).toBe(expected);
      expect(runner.calls).toHaveLength(1);
      expect(runner.calls[0]?.values).toEqual([EVENT_ID, TOKEN, 7, 4000, 'PUBLISH_TIMEOUT']);
    }
  });

  it('is NOOP when nothing matches the fence', async () => {
    const runner = new FakeRunner(() => []);
    expect(await new OutboxDispatchStore(runner, config()).fail(lease(), 'PUBLISH_FAILED')).toBe('NOOP');
  });

  it('uses exactly min(cap, base * 2^(attempt_count - 1)) for every attempt', async () => {
    const cfg = config({ backoffBaseMs: 500, backoffCapMs: 3000 });
    const seen: unknown[] = [];
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const runner = new FakeRunner(() => [{ status: 'PENDING' }]);
      await new OutboxDispatchStore(runner, cfg).fail(lease({ attemptCount: attempt }), 'PUBLISH_FAILED');
      seen.push(runner.calls[0]?.values?.[3]);
      expect(runner.calls[0]?.values?.[3]).toBe(backoffDelayMs(attempt, 500, 3000));
    }
    expect(seen).toEqual([500, 1000, 2000, 3000, 3000, 3000, 3000, 3000]);
  });

  it('accepts only the two fixed codes: anything else is refused before the database', async () => {
    expect([...OUTBOX_FAILURE_CODES]).toEqual(['PUBLISH_FAILED', 'PUBLISH_TIMEOUT']);
    const runner = new FakeRunner(() => [{ status: 'PENDING' }]);
    const store = new OutboxDispatchStore(runner, config());
    for (const bad of ['ECONNRESET', 'Error: boom', '', 'publish_failed', 'PUBLISH_FAILED ']) {
      expect(await rejection(store.fail(lease(), bad as OutboxFailureCode))).toBeInstanceOf(RangeError);
    }
    expect(runner.transactions).toBe(0);
  });

  it('never reaches the database with a malformed id or token', async () => {
    const runner = new FakeRunner(() => [{ status: 'PENDING' }]);
    const store = new OutboxDispatchStore(runner, config());
    expect(await store.fail(lease({ lockToken: 'nope' }), 'PUBLISH_FAILED')).toBe('NOOP');
    expect(runner.transactions).toBe(0);
  });
});

describe('OutboxDispatchStore — what the SQL is allowed to do (static)', () => {
  const code = codeOf('outbox/outbox-dispatch-store.ts');

  it('uses the PostgreSQL clock for every persisted time decision and no application clock', () => {
    expect(code).not.toMatch(/Date\.now|new Date|performance\.now|hrtime|Math\.random|randomUUID/);
    expect(code).toContain("date_trunc('milliseconds', clock_timestamp())");
    expect(code).not.toMatch(/CURRENT_TIMESTAMP|\bnow\(\)/);
  });

  it('claims with FOR UPDATE SKIP LOCKED in both the dead sweep and the claim, and mints tokens in the database', () => {
    expect((code.match(/FOR UPDATE OF e SKIP LOCKED/g) ?? []).length).toBe(2);
    expect(code).toContain('gen_random_uuid()');
  });

  it('fences ack and fail on event_id AND status PROCESSING AND lock_token', () => {
    const fence = /WHERE\s+(e\.)?event_id = \$1::uuid AND (e\.)?status = 'PROCESSING' AND (e\.)?lock_token = \$2::uuid/g;
    expect((code.match(fence) ?? []).length).toBe(2);
  });

  it('only ever writes delivery columns: no SET clause names an envelope column', () => {
    const envelope = ['event_id', 'event_type', 'event_schema_version', 'resource_type', 'resource_id', 'resource_version', 'occurred_at', 'payload'];
    const setClauses = [...code.matchAll(/\bSET\b([\s\S]*?)\b(?:FROM|WHERE)\b/g)].map((m) => m[1] ?? '');
    expect(setClauses.length).toBe(4);
    for (const clause of setClauses) {
      for (const column of envelope) {
        expect(clause).not.toMatch(new RegExp(`\\b${column}\\b`));
      }
    }
    // And the statements are updates only: no INSERT, DELETE or TRUNCATE.
    expect(code).not.toMatch(/\bINSERT\b|\bDELETE\b|\bTRUNCATE\b|\bDROP\b/);
  });

  it('never writes raw error text: the only value bound into last_error_code is the fixed code parameter', () => {
    expect(code).toContain('last_error_code = $5::varchar');
    expect(code.match(/last_error_code/g)?.length).toBe(1);
  });

  it('opens transactions only through the narrow runner and never touches pg directly', () => {
    expect(code).not.toMatch(/from 'pg'|new Pool|pool\.query|BEGIN|COMMIT|ROLLBACK/);
  });
});
