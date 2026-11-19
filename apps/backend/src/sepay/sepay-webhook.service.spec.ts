import { createHmac } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';
import { AppError, TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { SepayWebhookService } from './sepay-webhook.service';

// The webhook service is driven against an in-memory store that behaves like the tables it stands for: a request is PENDING until it is
// resolved, a bank record is unique per (bank, account, canonical id), an inbox event is unique per webhook id. The real SQL and its
// constraints are proven by the integration spec on a real schema; this spec proves the decisions and the order of the calls.

const SECRET = 'test-only-secret-not-a-real-key';
const NOW = 1_800_000_000;
const CODE = 'NAPA1B2C3D4E5';
const REQUEST_ID = 'a1b2c3d4-e5f6-4789-8abc-0123456789ab';
const WALLET_ID = '11111111-1111-4111-8111-111111111111';
const DRIVER_ID = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';

interface Store {
  requestState: 'PENDING' | 'CONFIRMED';
  requestVersion: number;
  requestAmount: bigint;
  driverStatus: string;
  accountCanReceive: boolean;
  accountExists: boolean;
  bankRecords: Set<string>;
  inbox: Map<number, { state: string; reason: string | null; topupRequestId: string | null }>;
  topups: number;
  resolvedBy: unknown[];
  auditRows: number;
  outboxRows: number;
  creditCalls: unknown[];
  creditError?: unknown;
}

function freshStore(overrides: Partial<Store> = {}): Store {
  return {
    requestState: 'PENDING',
    requestVersion: 1,
    requestAmount: 150000n,
    driverStatus: 'ACTIVE',
    accountCanReceive: true,
    accountExists: true,
    bankRecords: new Set(),
    inbox: new Map(),
    topups: 0,
    resolvedBy: [],
    auditRows: 0,
    outboxRows: 0,
    creditCalls: [],
    ...overrides,
  };
}

function buildService(store: Store): { service: SepayWebhookService; transactions: { count: number } } {
  const transactions = { count: 0 };
  const context = {} as TransactionContext;
  const service = new SepayWebhookService(
    {
      withTransaction: async (work: (c: TransactionContext) => Promise<unknown>) => {
        transactions.count += 1;
        // A real transaction: a throw from inside the work rolls every change of this call back, so the store is restored from a snapshot.
        const snapshot = {
          inbox: new Map(store.inbox),
          bankRecords: new Set(store.bankRecords),
          topups: store.topups,
          requestState: store.requestState,
          requestVersion: store.requestVersion,
          resolvedBy: [...store.resolvedBy],
          auditRows: store.auditRows,
          outboxRows: store.outboxRows,
        };
        try {
          return await work(context);
        } catch (error) {
          Object.assign(store, snapshot);
          throw error;
        }
      },
    } as never,
    {
      insertReceived: async (_c: unknown, event: { webhookEventId: number }) => {
        if (store.inbox.has(event.webhookEventId)) return false;
        store.inbox.set(event.webhookEventId, { state: 'RECEIVED', reason: null, topupRequestId: null });
        return true;
      },
      finish: async (_c: unknown, id: number, state: string, reason: string | null, topupRequestId: string | null) => {
        store.inbox.set(id, { state, reason, topupRequestId });
      },
    } as never,
    {
      findReceivingAccount: async () => (store.accountExists ? { systemAccountId: ACCOUNT_ID, canReceive: store.accountCanReceive } : undefined),
      findRequestByCode: async (_c: unknown, code: string) => (code === CODE ? { requestId: REQUEST_ID, walletId: WALLET_ID, driverId: DRIVER_ID } : undefined),
      bankRecordExists: async (_c: unknown, _bank: string, _account: string, canonical: string) => store.bankRecords.has(canonical),
    } as never,
    { lockById: async () => ({ driverId: DRIVER_ID, status: store.driverStatus }) } as never,
    {
      lockWalletOf: async () => true,
      creditTopup: async (_c: unknown, input: { settledBy: unknown; canonicalTransactionId: string; actualAmountVnd: bigint }) => {
        store.creditCalls.push(input);
        if (store.creditError !== undefined) throw store.creditError;
        if (store.bankRecords.has(input.canonicalTransactionId)) throw new AppError('BANK_TRANSACTION_ALREADY_RECORDED');
        store.bankRecords.add(input.canonicalTransactionId);
        store.topups += 1;
        return { topupId: 't', sequenceNo: 1, balanceAfterVnd: input.actualAmountVnd };
      },
    } as never,
    {
      lockById: async () => ({ requestId: REQUEST_ID, walletId: WALLET_ID, driverId: DRIVER_ID, state: store.requestState, version: store.requestVersion, amountRequestedVnd: store.requestAmount }),
      resolve: async (_c: unknown, _id: string, expected: number, state: string, settler: unknown) => {
        if (store.requestState !== 'PENDING' || store.requestVersion !== expected) return undefined;
        store.requestState = state as 'CONFIRMED';
        store.requestVersion += 1;
        store.resolvedBy.push(settler);
        return { state, version: store.requestVersion };
      },
    } as never,
    { append: async () => { store.auditRows += 1; } } as never,
    { append: async () => { store.outboxRows += 1; } } as never,
  );
  return { service, transactions };
}

function body(overrides: Record<string, unknown> = {}): Buffer {
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
      ...overrides,
    }),
    'utf8',
  );
}

function signed(raw: Buffer, timestamp = String(NOW), secret = SECRET): { timestampHeader: string; signatureHeader: string } {
  return { timestampHeader: timestamp, signatureHeader: `sha256=${createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex')}` };
}

function receive(service: SepayWebhookService, raw: Buffer, env: Record<string, string | undefined> = { SEPAY_WEBHOOK_SECRET: SECRET, SEPAY_AUTO_TOPUP_ENABLED: 'true' }, headers = signed(raw), now = NOW) {
  return service.receive({ rawBody: raw, timestampHeader: headers.timestampHeader, signatureHeader: headers.signatureHeader, nowSeconds: now, env: env as NodeJS.ProcessEnv });
}

describe('SePay webhook service: the automatic credit decision', () => {
  it('credits exactly once: a valid, signed, matching transfer posts through the posting path as a SePay settlement', async () => {
    const store = freshStore();
    const { service } = buildService(store);
    const result = await receive(service, body());
    expect(result).toEqual({ status: 200, body: { success: true } });
    expect(store.creditCalls).toHaveLength(1);
    expect(store.creditCalls[0]).toMatchObject({ settledBy: { kind: 'SEPAY_WEBHOOK' }, actualAmountVnd: 150000n, bankId: 'MB' });
    expect(store.resolvedBy).toEqual([{ kind: 'SEPAY_WEBHOOK' }]);
    expect(store.requestState).toBe('CONFIRMED');
    expect(store.auditRows).toBe(1);
    expect(store.outboxRows).toBe(1);
    expect(store.inbox.get(92704)).toEqual({ state: 'CREDITED', reason: null, topupRequestId: REQUEST_ID });
  });

  it('a repeated delivery of the same webhook id (SePay retries) answers success and credits nothing more', async () => {
    const store = freshStore();
    const { service } = buildService(store);
    await receive(service, body());
    const again = await receive(service, body());
    expect(again).toEqual({ status: 200, body: { success: true } });
    expect(store.creditCalls).toHaveLength(1);
    expect(store.topups).toBe(1);
  });

  it('a DIFFERENT webhook id for the same bank transaction cannot credit twice (the request is no longer pending)', async () => {
    const store = freshStore();
    const { service } = buildService(store);
    await receive(service, body({ id: 1001 }));
    await receive(service, body({ id: 1002 }));
    expect(store.topups).toBe(1);
    expect(store.inbox.get(1002)).toEqual({ state: 'NEEDS_ADMIN', reason: 'REQUEST_NOT_PENDING', topupRequestId: null });
  });

  it('a second request sharing the bank transaction identity is held as a duplicate, never credited', async () => {
    const store = freshStore({ bankRecords: new Set(['SEPAY:FT24012345678:150000:2026-11-19 11:08:33']) });
    const { service } = buildService(store);
    await receive(service, body());
    expect(store.creditCalls).toHaveLength(0);
    expect(store.inbox.get(92704)).toEqual({ state: 'NEEDS_ADMIN', reason: 'BANK_TRANSACTION_ALREADY_RECORDED', topupRequestId: null });
  });

  it('with the switch off, the event is recorded as RECEIVED and nothing is credited', async () => {
    const store = freshStore();
    const { service } = buildService(store);
    const result = await receive(service, body(), { SEPAY_WEBHOOK_SECRET: SECRET });
    expect(result.status).toBe(200);
    expect(store.creditCalls).toHaveLength(0);
    expect(store.inbox.get(92704)).toEqual({ state: 'RECEIVED', reason: 'AUTO_TOPUP_DISABLED', topupRequestId: null });
  });

  it('the switch is on only for exactly "true"', async () => {
    const store = freshStore();
    const { service } = buildService(store);
    await receive(service, body(), { SEPAY_WEBHOOK_SECRET: SECRET, SEPAY_AUTO_TOPUP_ENABLED: 'TRUE' });
    expect(store.creditCalls).toHaveLength(0);
  });

  it.each([
    ['a wrong amount', { transferAmount: 150001 }, 'AMOUNT_MISMATCH'],
    ['a missing code', { code: null, content: 'chuyen tien' }, 'NO_CODE'],
    ['an empty code', { code: '', content: 'chuyen tien' }, 'NO_CODE'],
    ['a wrong code', { code: 'NAPFFFFFFFFFF', content: 'NAPFFFFFFFFFF' }, 'NO_REQUEST_FOR_CODE'],
    ['an empty reference', { referenceCode: '' }, 'NO_REFERENCE'],
  ])('holds %s for an Administrator and credits nothing', async (_name, override, reason) => {
    const store = freshStore();
    const { service } = buildService(store);
    const result = await receive(service, body(override));
    expect(result.status).toBe(200);
    expect(store.creditCalls).toHaveLength(0);
    expect(store.requestState).toBe('PENDING');
    expect(store.inbox.get(92704)).toEqual({ state: 'NEEDS_ADMIN', reason, topupRequestId: null });
  });

  it('holds money to an unknown or non-receiving account', async () => {
    const unknown = freshStore({ accountExists: false });
    await receive(buildService(unknown).service, body());
    expect(unknown.inbox.get(92704)?.reason).toBe('ACCOUNT_NOT_RECEIVING');
    const closed = freshStore({ accountCanReceive: false });
    await receive(buildService(closed).service, body());
    expect(closed.creditCalls).toHaveLength(0);
    expect(closed.inbox.get(92704)?.reason).toBe('ACCOUNT_NOT_RECEIVING');
  });

  it('holds money for a driver who is not ACTIVE (closing or closed profiles are an Administrator decision)', async () => {
    const store = freshStore({ driverStatus: 'CLOSING' });
    await receive(buildService(store).service, body());
    expect(store.creditCalls).toHaveLength(0);
    expect(store.inbox.get(92704)?.reason).toBe('DRIVER_NOT_ACTIVE');
  });

  it('holds a late payment: a request that is already CONFIRMED, CANCELLED or REJECTED is never credited again', async () => {
    const store = freshStore({ requestState: 'CONFIRMED' });
    await receive(buildService(store).service, body());
    expect(store.creditCalls).toHaveLength(0);
    expect(store.inbox.get(92704)?.reason).toBe('REQUEST_NOT_PENDING');
  });

  it('holds outbound money as ignored and never looks at a request', async () => {
    const store = freshStore();
    await receive(buildService(store).service, body({ transferType: 'out' }));
    expect(store.creditCalls).toHaveLength(0);
    expect(store.inbox.get(92704)).toEqual({ state: 'IGNORED', reason: 'OUTBOUND_TRANSFER', topupRequestId: null });
  });

  it('turns a refusal the posting path raises before writing into an Administrator item, not a failed webhook', async () => {
    const store = freshStore({ creditError: new AppError('TOPUP_WALLET_LIMIT_EXCEEDED') });
    const result = await receive(buildService(store).service, body());
    expect(result.status).toBe(200);
    expect(store.requestState).toBe('PENDING');
    expect(store.inbox.get(92704)).toEqual({ state: 'NEEDS_ADMIN', reason: 'TOPUP_WALLET_LIMIT_EXCEEDED', topupRequestId: null });
  });

  it('lets a technical failure roll the whole event back, so SePay retries it (no half-recorded credit)', async () => {
    const store = freshStore({ creditError: new TechnicalError('internal', 'database went away') });
    const { service, transactions } = buildService(store);
    await expect(receive(service, body())).rejects.toThrow('database went away');
    expect(transactions.count).toBe(1);
    expect(store.requestState).toBe('PENDING');
  });
});

describe('SePay webhook service: refusals before any database work', () => {
  it('refuses a bad signature with 401 and opens no transaction', async () => {
    const store = freshStore();
    const { service, transactions } = buildService(store);
    const raw = body();
    const result = await receive(service, raw, undefined, { timestampHeader: String(NOW), signatureHeader: 'sha256=' + '0'.repeat(64) });
    expect(result).toEqual({ status: 401, body: { success: false, error: 'SIGNATURE_INVALID' } });
    expect(transactions.count).toBe(0);
    expect(store.creditCalls).toHaveLength(0);
  });

  it('refuses a body changed after signing with 401', async () => {
    const store = freshStore();
    const { service, transactions } = buildService(store);
    const headers = signed(body());
    const result = await receive(service, body({ transferAmount: 999999 }), undefined, headers);
    expect(result.status).toBe(401);
    expect(transactions.count).toBe(0);
  });

  it('refuses a correctly signed but expired request with 400', async () => {
    const store = freshStore();
    const { service, transactions } = buildService(store);
    const old = String(NOW - 301);
    const result = await receive(service, body(), undefined, signed(body(), old));
    expect(result).toEqual({ status: 400, body: { success: false, error: 'TIMESTAMP_OUT_OF_WINDOW' } });
    expect(transactions.count).toBe(0);
  });

  it('fails closed with 503 when no secret is configured, even for a validly signed request', async () => {
    const store = freshStore();
    const { service, transactions } = buildService(store);
    const result = await receive(service, body(), { SEPAY_AUTO_TOPUP_ENABLED: 'true' }, signed(body(), String(NOW), SECRET));
    expect(result.status).toBe(503);
    expect(transactions.count).toBe(0);
  });

  it('fails closed with 503 when the transfer prefix is not NAP', async () => {
    const store = freshStore();
    const { service } = buildService(store);
    const result = await receive(service, body(), { SEPAY_WEBHOOK_SECRET: SECRET, SEPAY_TRANSFER_PREFIX: 'ABC', SEPAY_AUTO_TOPUP_ENABLED: 'true' });
    expect(result.status).toBe(503);
  });

  it('refuses an invalid JSON body and an incomplete payload with 400 after the signature passed', async () => {
    const store = freshStore();
    const { service } = buildService(store);
    const notJson = Buffer.from('{not json', 'utf8');
    expect((await receive(service, notJson)).status).toBe(400);
    const incomplete = body();
    const incompleteObject = JSON.parse(incomplete.toString('utf8')) as Record<string, unknown>;
    delete incompleteObject.referenceCode;
    const raw = Buffer.from(JSON.stringify(incompleteObject), 'utf8');
    expect(await receive(service, raw)).toEqual({ status: 400, body: { success: false, error: 'PAYLOAD_INVALID' } });
    expect(store.creditCalls).toHaveLength(0);
  });
});
