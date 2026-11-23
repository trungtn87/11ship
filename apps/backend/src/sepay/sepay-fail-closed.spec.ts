import { describe, expect, it } from '@jest/globals';
import { readSepayConfig } from './sepay-config';
import { ReconciliationCursor, SepayReconciliationCursorRepository } from './sepay-reconciliation-cursor-repository';
import { SEPAY_CURSOR_STALL_MS, SepayReconciliationService } from './sepay-reconciliation.service';
import { SepayPageRequest, SepayPageResult, SepayTransactionsClient } from './sepay-transactions-client';
import { API_KEY, buildService, CODE, freshStore, NOW, SECRET } from './sepay-test-harness';
import { SepayWebhookService } from './sepay-webhook.service';
import { createHmac } from 'node:crypto';

// Fail closed (Codex 2026-11-22, finding 3), the held-row recovery (finding 2) and the cursor stall (finding 4), proven on the in-memory fakes.
// The same behaviour on the real schema is in tests/integration/m04-sepay-auto-topup.int.spec.ts.

const UUID_1 = '0b6e8a2c-7f1d-4c3a-9e5b-000000000001';
const ON = { SEPAY_AUTO_TOPUP_ENABLED: 'true', SEPAY_WEBHOOK_SECRET: SECRET, SEPAY_API_KEY: API_KEY };

function body(): Buffer {
  return Buffer.from(
    JSON.stringify({
      id: 92704,
      gateway: 'MBBank',
      transactionDate: '2026-11-19 11:08:33',
      accountNumber: '0123456789',
      subAccount: '',
      code: CODE,
      content: `${CODE} chuyen tien`,
      transferType: 'in',
      description: '',
      transferAmount: 150000,
      accumulated: 0,
      referenceCode: 'FT24012345678',
    }),
    'utf8',
  );
}

function receive(service: SepayWebhookService, env: Record<string, string | undefined>) {
  const raw = body();
  const timestamp = String(NOW);
  return service.receive({
    rawBody: raw,
    timestampHeader: timestamp,
    signatureHeader: `sha256=${createHmac('sha256', SECRET).update(`${timestamp}.`).update(raw).digest('hex')}`,
    nowSeconds: NOW,
    env: env as NodeJS.ProcessEnv,
  });
}

describe('SePay configuration: automatic credit needs the switch AND both credentials', () => {
  it.each([
    ['switch on, secret and key', { SEPAY_AUTO_TOPUP_ENABLED: 'true', SEPAY_WEBHOOK_SECRET: 's', SEPAY_API_KEY: 'k' }, true],
    ['switch on, secret, no key', { SEPAY_AUTO_TOPUP_ENABLED: 'true', SEPAY_WEBHOOK_SECRET: 's' }, false],
    ['switch on, key, no secret', { SEPAY_AUTO_TOPUP_ENABLED: 'true', SEPAY_API_KEY: 'k' }, false],
    ['switch on, neither', { SEPAY_AUTO_TOPUP_ENABLED: 'true' }, false],
    ['switch on, blank key', { SEPAY_AUTO_TOPUP_ENABLED: 'true', SEPAY_WEBHOOK_SECRET: 's', SEPAY_API_KEY: '   ' }, false],
    ['switch "TRUE", both', { SEPAY_AUTO_TOPUP_ENABLED: 'TRUE', SEPAY_WEBHOOK_SECRET: 's', SEPAY_API_KEY: 'k' }, false],
    ['switch off, both', { SEPAY_WEBHOOK_SECRET: 's', SEPAY_API_KEY: 'k' }, false],
  ])('%s', (_name, env, ready) => {
    expect(readSepayConfig(env as NodeJS.ProcessEnv).autoCreditReady).toBe(ready);
  });

  it('names the reason a verified transfer is held: the switch when it is off, the credentials when it is on', () => {
    expect(readSepayConfig({ SEPAY_WEBHOOK_SECRET: 's' } as NodeJS.ProcessEnv).holdReason).toBe('AUTO_TOPUP_DISABLED');
    expect(readSepayConfig({ SEPAY_AUTO_TOPUP_ENABLED: 'true', SEPAY_WEBHOOK_SECRET: 's' } as NodeJS.ProcessEnv).holdReason).toBe('AUTO_TOPUP_NOT_CONFIGURED');
  });
});

describe('SePay webhook: a verified transfer with the switch on but no API key is kept as evidence and never credited', () => {
  it('stores RECEIVED / AUTO_TOPUP_NOT_CONFIGURED, answers 200, and credits nothing', async () => {
    const store = freshStore();
    const { service } = buildService(store);
    const result = await receive(service, { SEPAY_AUTO_TOPUP_ENABLED: 'true', SEPAY_WEBHOOK_SECRET: SECRET });
    expect(result).toEqual({ status: 200, body: { success: true } });
    expect(store.creditCalls).toHaveLength(0);
    expect(store.inbox.get(92704)).toEqual({ state: 'RECEIVED', reason: 'AUTO_TOPUP_NOT_CONFIGURED', topupRequestId: null });
  });

  it('without a webhook secret the request is refused (503) and nothing is stored', async () => {
    const store = freshStore();
    const { service, transactions } = buildService(store);
    const result = await receive(service, { SEPAY_AUTO_TOPUP_ENABLED: 'true', SEPAY_API_KEY: API_KEY });
    expect(result.status).toBe(503);
    expect(transactions.count).toBe(0);
    expect(store.inbox.size).toBe(0);
  });
});

function scripted(answers: SepayPageResult[]): SepayTransactionsClient & { calls: SepayPageRequest[] } {
  const calls: SepayPageRequest[] = [];
  let next = 0;
  return {
    calls,
    async fetchPage(request: SepayPageRequest): Promise<SepayPageResult> {
      calls.push(request);
      const answer = answers[next];
      next += 1;
      if (answer === undefined) throw new Error('unscripted call');
      return answer;
    },
  };
}

function cursorAt(lastTransactionUuid: string | null, advancedAtMs: number): SepayReconciliationCursorRepository & { row: { lastTransactionUuid: string | null; outcome: string | null } } {
  const row: { lastTransactionUuid: string | null; outcome: string | null } = { lastTransactionUuid, outcome: null };
  return {
    row,
    async read(): Promise<ReconciliationCursor> {
      return { lastTransactionUuid: row.lastTransactionUuid, notBeforeMs: null, advancedAtMs };
    },
    async record(_c: unknown, input: { lastTransactionUuid: string | null; outcome: string }): Promise<void> {
      if (input.lastTransactionUuid !== null) row.lastTransactionUuid = input.lastTransactionUuid;
      row.outcome = input.outcome;
    },
  } as never;
}

function jobWith(store: ReturnType<typeof freshStore>, client: SepayTransactionsClient, cursor: ReturnType<typeof cursorAt>) {
  const { settlement } = buildService(store);
  return new SepayReconciliationService({ withTransaction: async (work: (c: unknown) => Promise<unknown>) => work({}) } as never, cursor, settlement, client);
}

describe('SePay reconciliation: fail closed on credentials, held rows, and a cursor that no longer moves', () => {
  it('with an API key but no webhook secret the job makes no call to SePay and credits nothing', async () => {
    const store = freshStore();
    const client = scripted([]);
    const job = jobWith(store, client, cursorAt(null, NOW * 1000));
    const result = await job.runOnce({ SEPAY_AUTO_TOPUP_ENABLED: 'true', SEPAY_API_KEY: API_KEY }, { nowMs: () => NOW * 1000, sleep: async () => undefined });
    expect(result.outcome).toBe('NOT_CONFIGURED');
    expect(client.calls).toHaveLength(0);
    expect(store.creditCalls).toHaveLength(0);
  });

  it('settles a transfer held while the switch was off, once the switch is on, and then leaves it alone', async () => {
    const store = freshStore();
    const { service } = buildService(store);
    await receive(service, { SEPAY_WEBHOOK_SECRET: SECRET });
    expect(store.inbox.get(92704)?.reason).toBe('AUTO_TOPUP_DISABLED');
    const client = scripted([{ kind: 'PAGE', rows: [], hasMore: false }, { kind: 'PAGE', rows: [], hasMore: false }]);
    const cursor = cursorAt(null, NOW * 1000);
    const job = jobWith(store, client, cursor);
    const first = await job.runOnce(ON, { nowMs: () => NOW * 1000, sleep: async () => undefined });
    expect(first).toEqual({ outcome: 'OK', read: 0, recovered: 1 });
    expect(store.creditCalls).toHaveLength(1);
    expect(store.inbox.get(92704)).toEqual({ state: 'CREDITED', reason: null, topupRequestId: expect.any(String) });
    const second = await job.runOnce(ON, { nowMs: () => NOW * 1000, sleep: async () => undefined });
    expect(second.recovered).toBe(0);
    expect(store.creditCalls).toHaveLength(1);
  });

  it('an empty window from a cursor that has not moved for the stall limit is CURSOR_STALLED: logged, the cursor is kept, OK is not written', async () => {
    const store = freshStore();
    const cursor = cursorAt(UUID_1, NOW * 1000);
    const client = scripted([{ kind: 'PAGE', rows: [], hasMore: false }]);
    const job = jobWith(store, client, cursor);
    const result = await job.runOnce(ON, { nowMs: () => NOW * 1000 + SEPAY_CURSOR_STALL_MS, sleep: async () => undefined });
    expect(result.outcome).toBe('CURSOR_STALLED');
    expect(cursor.row.lastTransactionUuid).toBe(UUID_1);
    expect(cursor.row.outcome).toBe('CURSOR_STALLED');
  });

  it('an empty window inside the limit is a quiet period: OK, and the cursor is kept', async () => {
    const store = freshStore();
    const cursor = cursorAt(UUID_1, NOW * 1000);
    const client = scripted([{ kind: 'PAGE', rows: [], hasMore: false }]);
    const job = jobWith(store, client, cursor);
    const result = await job.runOnce(ON, { nowMs: () => NOW * 1000 + SEPAY_CURSOR_STALL_MS - 1, sleep: async () => undefined });
    expect(result.outcome).toBe('OK');
    expect(cursor.row.lastTransactionUuid).toBe(UUID_1);
  });
});
