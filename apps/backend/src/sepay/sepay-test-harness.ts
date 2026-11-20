import { AppError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { SepaySettlementService } from './sepay-settlement-service';
import { SepayWebhookService } from './sepay-webhook.service';

// Shared in-memory store and fakes for the SePay specs. They behave like the tables they stand for: the request is PENDING until resolved,
// a bank record is unique per (bank, account, canonical id), and every inbox key (webhook id, transactions-API UUID, bank identity) is unique.
// The real SQL and its constraints are proven by the integration spec on a real schema; the unit specs prove the decisions and call order.

export const SECRET = 'test-only-secret-not-a-real-key';
export const NOW = 1_800_000_000;
export const CODE = 'NAPA1B2C3D4E5';
export const REQUEST_ID = 'a1b2c3d4-e5f6-4789-8abc-0123456789ab';
export const WALLET_ID = '11111111-1111-4111-8111-111111111111';
export const DRIVER_ID = '22222222-2222-4222-8222-222222222222';
export const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';

export interface Store {
  requestState: 'PENDING' | 'CONFIRMED';
  requestVersion: number;
  requestAmount: bigint;
  driverStatus: string;
  accountCanReceive: boolean;
  accountExists: boolean;
  bankRecords: Set<string>;
  inbox: Map<number | string, { state: string; reason: string | null; topupRequestId: string | null }>;
  inboxBankKeys: Set<string>;
  topups: number;
  resolvedBy: unknown[];
  auditRows: number;
  outboxRows: number;
  creditCalls: unknown[];
  creditError?: unknown;
}

export function freshStore(overrides: Partial<Store> = {}): Store {
  return {
    requestState: 'PENDING',
    requestVersion: 1,
    requestAmount: 150000n,
    driverStatus: 'ACTIVE',
    accountCanReceive: true,
    accountExists: true,
    bankRecords: new Set(),
    inbox: new Map(),
    inboxBankKeys: new Set(),
    topups: 0,
    resolvedBy: [],
    auditRows: 0,
    outboxRows: 0,
    creditCalls: [],
    ...overrides,
  };
}

export function buildService(store: Store): { service: SepayWebhookService; transactions: { count: number }; settlement: SepaySettlementService } {
  const transactions = { count: 0 };
  const context = {} as TransactionContext;
  // The inbox behaves like its table: unique on the webhook id, on the transactions-API UUID and on the bank identity (account, reference,
  // amount, time; an empty reference is no key). A conflict is a duplicate: nothing is written.
  const keyOfInboxId = new Map<string, number | string>();
  const inbox = {
    insertReceived: async (_c: unknown, event: { webhookEventId: number | null; sepayTransactionUuid: string | null; accountNumber: string; referenceCode: string; transferAmountVnd: number; transactionAtIso: string }, inboxId: string) => {
      const natural: number | string | undefined = event.webhookEventId ?? event.sepayTransactionUuid ?? undefined;
      const bankKey = event.referenceCode === '' ? undefined : `${event.accountNumber}|${event.referenceCode}|${event.transferAmountVnd}|${event.transactionAtIso}`;
      if (natural === undefined) throw new Error('an event always carries one identifier');
      if (store.inbox.has(natural) || (bankKey !== undefined && store.inboxBankKeys.has(bankKey))) return false;
      store.inbox.set(natural, { state: 'RECEIVED', reason: null, topupRequestId: null });
      if (bankKey !== undefined) store.inboxBankKeys.add(bankKey);
      keyOfInboxId.set(inboxId, natural);
      return true;
    },
    finish: async (_c: unknown, inboxId: string, state: string, reason: string | null, topupRequestId: string | null) => {
      const key = keyOfInboxId.get(inboxId);
      if (key === undefined) throw new Error('unknown inbox row');
      store.inbox.set(key, { state, reason, topupRequestId });
    },
  };
  const settlement = new SepaySettlementService(
    inbox as never,
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
  const service = new SepayWebhookService(
    {
      withTransaction: async (work: (c: TransactionContext) => Promise<unknown>) => {
        transactions.count += 1;
        // A real transaction: a throw from inside the work rolls every change of this call back, so the store is restored from a snapshot.
        const snapshot = {
          inbox: new Map(store.inbox),
          inboxBankKeys: new Set(store.inboxBankKeys),
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
    settlement,
  );
  return { service, transactions, settlement };
}

