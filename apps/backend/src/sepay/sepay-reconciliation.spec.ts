import { createHmac } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';
import { parseSepayApiTransaction } from './sepay-event';
import { ReconciliationCursor, SepayReconciliationCursorRepository } from './sepay-reconciliation-cursor-repository';
import { SepayReconciliationService } from './sepay-reconciliation.service';
import { SepayPageRequest, SepayPageResult, SepayTransactionsClient, parsePage, parseRetryAfter } from './sepay-transactions-client';
import { API_KEY, buildService, CODE, freshStore, NOW, SECRET, Store } from './sepay-test-harness';

// The reconciliation job is driven against the same in-memory store as the webhook (its settlement is the webhook's), a fake cursor row and a
// scripted fake of the transactions API. No test reaches SePay or the network.

const KEY = API_KEY;
const ENV_ON = { SEPAY_AUTO_TOPUP_ENABLED: 'true', SEPAY_API_KEY: KEY, SEPAY_WEBHOOK_SECRET: SECRET };
const UUID_1 = '0b6e8a2c-7f1d-4c3a-9e5b-000000000001';
const UUID_2 = '0b6e8a2c-7f1d-4c3a-9e5b-000000000002';
const UUID_3 = '0b6e8a2c-7f1d-4c3a-9e5b-000000000003';

function apiItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: UUID_1,
    transaction_date: '2026-11-19T11:08:33+07:00',
    account_number: '0123456789',
    va: '',
    transfer_type: 'in',
    amount_in: 150000,
    amount_out: 0,
    accumulated: 0,
    transaction_content: `${CODE} chuyen tien`,
    reference_number: 'FT24012345678',
    code: CODE,
    bank_brand_name: 'MBBank',
    bank_account_id: '33333333-3333-4333-8333-333333333333',
    va_id: null,
    webhook_success: 1,
    ...overrides,
  };
}

function page(rows: Record<string, unknown>[], hasMore: boolean): SepayPageResult {
  return { kind: 'PAGE', rows, hasMore };
}

/** A scripted client: each call takes the next answer; every request is recorded. A thrown Error is a transport failure. */
function scriptedClient(answers: (SepayPageResult | Error)[]): SepayTransactionsClient & { calls: SepayPageRequest[] } {
  const calls: SepayPageRequest[] = [];
  let next = 0;
  return {
    calls,
    async fetchPage(request: SepayPageRequest): Promise<SepayPageResult> {
      calls.push(request);
      const answer = answers[next];
      next += 1;
      if (answer === undefined) throw new Error('unscripted call');
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

interface CursorState {
  lastTransactionUuid: string | null;
  notBeforeMs: number | null;
  outcome: string | null;
}

function cursorRow(): SepayReconciliationCursorRepository & { row: CursorState } {
  const row: CursorState = { lastTransactionUuid: null, notBeforeMs: null, outcome: null };
  return {
    row,
    async read(): Promise<ReconciliationCursor> {
      return { lastTransactionUuid: row.lastTransactionUuid, notBeforeMs: row.notBeforeMs, advancedAtMs: NOW * 1000 };
    },
    async record(_c: unknown, input: { lastTransactionUuid: string | null; outcome: string; notBeforeMs: number | null }): Promise<void> {
      if (input.lastTransactionUuid !== null) row.lastTransactionUuid = input.lastTransactionUuid;
      row.outcome = input.outcome;
      row.notBeforeMs = input.notBeforeMs;
    },
  } as never;
}

function jobWith(store: Store, client: SepayTransactionsClient, cursor = cursorRow()) {
  const { settlement, service } = buildService(store);
  const job = new SepayReconciliationService(
    { withTransaction: async (work: (c: unknown) => Promise<unknown>) => work({}) } as never,
    cursor,
    settlement,
    client,
  );
  const options = { pageIntervalMs: 0, nowMs: () => NOW * 1000, sleep: async () => undefined };
  return { job, cursor, service, options };
}

describe('SePay reconciliation: the switch and the key', () => {
  it('does nothing and calls nobody while SEPAY_AUTO_TOPUP_ENABLED is not exactly "true"', async () => {
    const store = freshStore();
    const client = scriptedClient([]);
    const { job, options } = jobWith(store, client);
    const result = await job.runOnce({ SEPAY_API_KEY: KEY, SEPAY_WEBHOOK_SECRET: SECRET }, options);
    expect(result).toMatchObject({ outcome: 'DISABLED', read: 0 });
    expect(client.calls).toHaveLength(0);
    expect(store.creditCalls).toHaveLength(0);
  });

  it('refuses to call SePay when the API key is empty (fail closed)', async () => {
    const store = freshStore();
    const client = scriptedClient([]);
    const { job, options } = jobWith(store, client);
    const result = await job.runOnce({ SEPAY_AUTO_TOPUP_ENABLED: 'true', SEPAY_WEBHOOK_SECRET: SECRET }, options);
    expect(result.outcome).toBe('NOT_CONFIGURED');
    expect(client.calls).toHaveLength(0);
  });
});

describe('SePay reconciliation: crediting a transfer the webhook never delivered', () => {
  it('credits exactly once through the shared settlement and advances the cursor to the last transaction', async () => {
    const store = freshStore();
    const client = scriptedClient([page([apiItem()], false)]);
    const { job, cursor, options } = jobWith(store, client);
    const result = await job.runOnce(ENV_ON, options);
    expect(result).toMatchObject({ outcome: 'OK', read: 1 });
    expect(store.creditCalls).toHaveLength(1);
    expect(store.creditCalls[0]).toMatchObject({ settledBy: { kind: 'SEPAY_WEBHOOK' }, actualAmountVnd: 150000n, bankId: 'MB' });
    expect(store.inbox.get(UUID_1)).toEqual({ state: 'CREDITED', reason: null, topupRequestId: expect.any(String) });
    expect(cursor.row.lastTransactionUuid).toBe(UUID_1);
    expect(cursor.row.outcome).toBe('OK');
  });

  it('a transfer the webhook already credited is the same bank transfer: no second inbox row, no second credit', async () => {
    const store = freshStore();
    const { service } = buildService(store);
    const webhookBody = Buffer.from(
      JSON.stringify({ id: 92704, gateway: 'MBBank', transactionDate: '2026-11-19 11:08:33', accountNumber: '0123456789', subAccount: '', code: CODE, content: `${CODE} chuyen tien`, transferType: 'in', description: '', transferAmount: 150000, accumulated: 0, referenceCode: 'FT24012345678' }),
      'utf8',
    );
    const sig = createHmac('sha256', SECRET).update(`${NOW}.`).update(webhookBody).digest('hex');
    const first = await service.receive({ rawBody: webhookBody, timestampHeader: String(NOW), signatureHeader: `sha256=${sig}`, nowSeconds: NOW, env: ENV_ON as NodeJS.ProcessEnv });
    expect(first.status).toBe(200);
    expect(store.topups).toBe(1);

    const client = scriptedClient([page([apiItem()], false)]);
    const cursor = cursorRow();
    const { job, options } = jobWith(store, client, cursor);
    const result = await job.runOnce(ENV_ON, options);
    expect(result.outcome).toBe('OK');
    expect(store.topups).toBe(1);
    expect(store.creditCalls).toHaveLength(1);
    // Silent duplicate: the reconciliation read leaves no inbox row and no NEEDS_ADMIN item behind.
    expect(store.inbox.has(UUID_1)).toBe(false);
    expect(cursor.row.lastTransactionUuid).toBe(UUID_1);
  });

  it('a repeat read of the same transaction in a later run changes nothing', async () => {
    const store = freshStore();
    const client = scriptedClient([page([apiItem()], false), page([apiItem()], false)]);
    const cursor = cursorRow();
    const { job, options } = jobWith(store, client, cursor);
    await job.runOnce(ENV_ON, options);
    const again = await job.runOnce(ENV_ON, options);
    expect(again.outcome).toBe('OK');
    expect(store.topups).toBe(1);
    expect(store.creditCalls).toHaveLength(1);
  });

  it('holds an anomaly for an Administrator through the same rules (no code in the content: no credit)', async () => {
    const store = freshStore();
    const client = scriptedClient([page([apiItem({ code: null, transaction_content: 'chuyen tien' })], false)]);
    const { job, options } = jobWith(store, client);
    await job.runOnce(ENV_ON, options);
    expect(store.creditCalls).toHaveLength(0);
    expect(store.inbox.get(UUID_1)).toEqual({ state: 'NEEDS_ADMIN', reason: 'NO_CODE', topupRequestId: null });
  });
});

describe('SePay reconciliation: cursor, pages and back-off', () => {
  it('follows pages with the same since_id, then stores the id of the last transaction read', async () => {
    const store = freshStore();
    const client = scriptedClient([
      page([apiItem({ id: UUID_1, reference_number: 'FT1', transaction_date: '2026-11-19T10:00:00+07:00' })], true),
      page([apiItem({ id: UUID_2, reference_number: 'FT2', amount_in: 1, transaction_content: 'x', code: null })], false),
    ]);
    const cursor = cursorRow();
    cursor.row.lastTransactionUuid = UUID_3;
    const { job, options } = jobWith(store, client, cursor);
    const result = await job.runOnce(ENV_ON, options);
    expect(result).toMatchObject({ outcome: 'OK', read: 2 });
    expect(client.calls.map((c) => [c.page, c.sinceId])).toEqual([
      [1, UUID_3],
      [2, UUID_3],
    ]);
    expect(cursor.row.lastTransactionUuid).toBe(UUID_2);
  });

  it('429: makes no further call in the run, keeps the cursor, and backs off for Retry-After', async () => {
    const store = freshStore();
    const client = scriptedClient([{ kind: 'RATE_LIMITED', retryAfterSeconds: 120 }]);
    const cursor = cursorRow();
    const { job, options } = jobWith(store, client, cursor);
    const first = await job.runOnce(ENV_ON, options);
    expect(first.outcome).toBe('RATE_LIMITED');
    expect(client.calls).toHaveLength(1);
    expect(cursor.row.lastTransactionUuid).toBeNull();
    expect(cursor.row.notBeforeMs).toBe(NOW * 1000 + 120_000);

    const during = await job.runOnce(ENV_ON, { ...options, nowMs: () => NOW * 1000 + 60_000 });
    expect(during.outcome).toBe('BACKOFF');
    expect(client.calls).toHaveLength(1);
  });

  it('401: records the failure, keeps the cursor, and stops calling SePay for the rest of the process', async () => {
    const store = freshStore();
    const client = scriptedClient([{ kind: 'UNAUTHORIZED' }]);
    const cursor = cursorRow();
    const { job, options } = jobWith(store, client, cursor);
    expect((await job.runOnce(ENV_ON, options)).outcome).toBe('AUTH_FAILED');
    expect(cursor.row.outcome).toBe('AUTH_FAILED');
    expect(cursor.row.lastTransactionUuid).toBeNull();
    expect((await job.runOnce(ENV_ON, options)).outcome).toBe('AUTH_HALTED');
    expect(client.calls).toHaveLength(1);
  });

  it('a failure in the middle of a run keeps the cursor; the next run re-reads the window without a second credit', async () => {
    const store = freshStore();
    const client = scriptedClient([page([apiItem()], true), new Error('socket reset'), page([apiItem()], false), page([apiItem()], false)]);
    const cursor = cursorRow();
    const { job, options } = jobWith(store, client, cursor);
    const failed = await job.runOnce(ENV_ON, options);
    expect(failed.outcome).toBe('FAILED');
    expect(cursor.row.lastTransactionUuid).toBeNull();
    expect(store.topups).toBe(1);
    const retry = await job.runOnce(ENV_ON, options);
    expect(retry.outcome).toBe('OK');
    expect(store.topups).toBe(1);
    expect(store.creditCalls).toHaveLength(1);
    expect(cursor.row.lastTransactionUuid).toBe(UUID_1);
  });

  it('an item that is not exactly the documented shape stops the run and never moves the cursor', async () => {
    const store = freshStore();
    const client = scriptedClient([page([apiItem({ amount_in: '150000' })], false)]);
    const cursor = cursorRow();
    const { job, options } = jobWith(store, client, cursor);
    expect((await job.runOnce(ENV_ON, options)).outcome).toBe('PAYLOAD_INVALID');
    expect(cursor.row.lastTransactionUuid).toBeNull();
    expect(store.creditCalls).toHaveLength(0);
  });
});

describe('SePay transactions API: parsing (no network)', () => {
  it('maps a documented item to the same bank identity as the webhook of that transfer', () => {
    const event = parseSepayApiTransaction(apiItem());
    expect(event).toMatchObject({
      webhookEventId: null,
      sepayTransactionUuid: UUID_1,
      transactionDateText: '2026-11-19 11:08:33',
      transactionAtIso: '2026-11-19T11:08:33+07:00',
      transferAmountVnd: 150000,
      referenceCode: 'FT24012345678',
      transferType: 'in',
    });
  });

  it('refuses an outbound item, a missing zone, a bad UUID or a non-integer amount', () => {
    expect(parseSepayApiTransaction(apiItem({ transfer_type: 'out' }))).toBeUndefined();
    expect(parseSepayApiTransaction(apiItem({ transaction_date: '2026-11-19 11:08:33' }))).toBeUndefined();
    expect(parseSepayApiTransaction(apiItem({ id: 'not-a-uuid' }))).toBeUndefined();
    expect(parseSepayApiTransaction(apiItem({ amount_in: 150000.5 }))).toBeUndefined();
  });

  it('accepts only the documented page envelope', () => {
    expect(parsePage({ data: [], meta: { pagination: { has_more: false } } })).toEqual({ kind: 'PAGE', rows: [], hasMore: false });
    expect(() => parsePage({ transactions: [], meta: { pagination: { has_more: false } } })).toThrow('SEPAY_RESPONSE_INVALID');
    expect(() => parsePage({ data: [] })).toThrow('SEPAY_RESPONSE_INVALID');
  });

  it('bounds Retry-After and falls back to one interval when it is missing or unusable', () => {
    expect(parseRetryAfter('30')).toBe(30);
    expect(parseRetryAfter(null)).toBe(900);
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT')).toBe(900);
    expect(parseRetryAfter('0')).toBe(900);
    expect(parseRetryAfter('999999')).toBe(3600);
  });
});
