import { createHmac, randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Pool, PoolClient } from 'pg';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AuditWriter } from '../../apps/backend/src/audit/audit-writer';
import { DriverRepository } from '../../apps/backend/src/driver/driver-repository';
import { OutboxWriter } from '../../apps/backend/src/outbox/outbox-writer';
import { readSepayConfig } from '../../apps/backend/src/sepay/sepay-config';
import { SepaySettlementRepository } from '../../apps/backend/src/sepay/sepay-settlement-repository';
import { SepaySettlementService } from '../../apps/backend/src/sepay/sepay-settlement-service';
import { SepayWebhookService } from '../../apps/backend/src/sepay/sepay-webhook.service';
import { TransactionContext } from '../../apps/backend/src/transaction/transaction-context';
import { TOPUP_EXPIRY_AFTER_MINUTES, TopupExpiryJob } from '../../apps/backend/src/wallet-topup/topup-expiry';
import { topupTransferCodeOf } from '../../apps/backend/src/wallet-topup/topup-transfer-code';
import { TopupAutoLookupRepository } from '../../apps/backend/src/wallet/topup-auto-lookup-repository';
import { TopupPostingService } from '../../apps/backend/src/wallet/topup-posting-service';
import { TopupRequestRepository } from '../../apps/backend/src/wallet/topup-request-repository';
import { TopupSettlementRepository } from '../../apps/backend/src/wallet/topup-settlement-repository';
import { WalletRepository } from '../../apps/backend/src/wallet/wallet-repository';
import { WalletService } from '../../apps/backend/src/wallet/wallet-service';
import { createDriverFor, purgePhone, randomPhone, Phone } from './support/auth-fixtures';
import { loadIntegrationConfig } from './support/test-helpers';
import { testPool } from './support/transaction-fixtures';

// M04 SePay automatic top-up, step 1, on a REAL PostgreSQL schema (all migrations, including 1798156800000_sepay-auto-topup-inbox).
// EVERY scenario runs in ONE database transaction on one connection that is ROLLED BACK at the end, so no row is committed and nothing
// needs cleaning up. Deferred constraint triggers (topup / request invariants, foreign keys) are forced to run before the rollback with
// SET CONSTRAINTS ALL IMMEDIATE, so the database proves its own rules for each scenario. The service under test is the real one with the
// real repositories; only the transaction source is the single rolled-back transaction.

const SECRET = 'integration-only-sepay-secret';
// Automatic credit needs BOTH credentials (fail closed): the API key is part of the ON configuration, not optional.
const API_KEY = 'integration-only-sepay-api-key';
const ENV = { SEPAY_WEBHOOK_SECRET: SECRET, SEPAY_API_KEY: API_KEY, SEPAY_AUTO_TOPUP_ENABLED: 'true' } as NodeJS.ProcessEnv;
const BANK_ID = 'MB';

describe('M04 SePay automatic top-up step 1 - inbox, matching, credit once (real schema, rolled back)', () => {
  let pool: Pool;
  let client: PoolClient;
  let phone: Phone;
  let userId: string;
  let driverId: string;
  let walletId: string;
  let service: SepayWebhookService;
  const wallets = new WalletService(new WalletRepository(), new DriverRepository());
  const requests = new TopupRequestRepository();

  const posting = new TopupPostingService(new TopupSettlementRepository());

  function settlementOver(): SepaySettlementService {
    return new SepaySettlementService(
      new SepaySettlementRepository(),
      new TopupAutoLookupRepository(),
      new DriverRepository(),
      posting,
      requests,
      new AuditWriter(),
      new OutboxWriter(),
    );
  }

  function serviceOver(connection: PoolClient): SepayWebhookService {
    const context = { query: (sql: string, params?: unknown[]) => connection.query(sql, params as unknown[]) } as unknown as TransactionContext;
    const transactions = { withTransaction: (work: (c: TransactionContext) => Promise<unknown>) => work(context) };
    return new SepayWebhookService(transactions as never, settlementOver());
  }

  /** The inbox row id of a webhook event (the key the recovery claims by). */
  async function inboxIdOf(eventId: number): Promise<string> {
    return (await client.query<{ inbox_id: string }>('SELECT inbox_id::text AS inbox_id FROM app.sepay_transfer_inbox WHERE webhook_event_id = $1::bigint', [eventId])).rows[0]!.inbox_id;
  }

  /** Signs a raw body with the given environment's secret, as SePay would (the same secret the environment holds). */
  function signedWith(raw: Buffer, env: NodeJS.ProcessEnv): ReturnType<typeof signedRequest> {
    return { ...signedRequest(raw), env };
  }

  /** Wallet-scoped topup count (the table is shared by the whole suite, so every count names its own wallet). */
  async function topupCount(): Promise<number> {
    return (await client.query<{ n: number }>('SELECT count(*)::int AS n FROM app.wallet_topups WHERE wallet_id = $1::uuid', [walletId])).rows[0]!.n;
  }

  function ctx(): TransactionContext {
    return { query: (sql: string, params?: unknown[]) => client.query(sql, params as unknown[]) } as unknown as TransactionContext;
  }

  function signedRequest(raw: Buffer): { rawBody: Buffer; timestampHeader: string; signatureHeader: string; nowSeconds: number; env: NodeJS.ProcessEnv } {
    const timestamp = String(Math.floor(Date.now() / 1000));
    return {
      rawBody: raw,
      timestampHeader: timestamp,
      signatureHeader: `sha256=${createHmac('sha256', SECRET).update(`${timestamp}.`).update(raw).digest('hex')}`,
      nowSeconds: Number(timestamp),
      env: ENV,
    };
  }

  function webhook(overrides: Record<string, unknown>): Buffer {
    return Buffer.from(
      JSON.stringify({
        id: randomInt(1_000_000_000, 2_000_000_000),
        gateway: 'MBBank',
        transactionDate: '2026-11-19 11:08:33',
        accountNumber: accountNumber,
        subAccount: '',
        code: null,
        content: '',
        transferType: 'in',
        description: '',
        transferAmount: 150000,
        accumulated: 0,
        referenceCode: `FT${randomUUID().slice(0, 8).toUpperCase()}`,
        ...overrides,
      }),
      'utf8',
    );
  }

  let accountNumber: string;

  /** A PENDING request for this driver, with a fresh id, and the code the Shipper would copy. */
  async function pendingRequest(amountVnd: bigint): Promise<{ requestId: string; code: string }> {
    const requestId = randomUUID();
    await requests.insertPending(ctx(), { requestId, walletId, driverId, amountVnd, createdByUserId: userId });
    return { requestId, code: topupTransferCodeOf(requestId) };
  }

  /** The MB receiving account, switched on the way SYSTEM does it (insert off, then version 2 on). */
  async function receivingAccount(): Promise<string> {
    const accountId = randomUUID();
    accountNumber = String(randomInt(1_000_000_000, 9_999_999_999));
    await client.query(
      `INSERT INTO app.system_owned_bank_accounts (system_account_id, bank_id, account_number, account_holder, can_receive, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, 'TEST ACCOUNT HOLDER', false, 1, now(), now())`,
      [accountId, BANK_ID, accountNumber],
    );
    await client.query(`UPDATE app.system_owned_bank_accounts SET can_receive = true, version = 2, updated_at = now() WHERE system_account_id = $1::uuid`, [accountId]);
    return accountId;
  }

  async function balanceOf(): Promise<string> {
    return (await client.query<{ balance: string }>('SELECT balance_vnd::text AS balance FROM app.driver_wallets WHERE wallet_id = $1::uuid', [walletId])).rows[0]!.balance;
  }

  async function inboxOf(eventId: number): Promise<{ state: string; reason_code: string | null; topup_request_id: string | null }> {
    return (await client.query('SELECT state, reason_code, topup_request_id::text AS topup_request_id FROM app.sepay_transfer_inbox WHERE webhook_event_id = $1::bigint', [eventId])).rows[0]!;
  }

  beforeAll(async () => {
    pool = testPool(loadIntegrationConfig().database, { poolMax: 4 });
    phone = randomPhone();
    userId = randomUUID();
    await pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', now(), 'PHONE_VERIFIED', 'ACTIVE', 1, now(), now())`,
      [userId, phone.normalized],
    );
    // The scenario is an ACTIVE Shipper; the fixture default is PENDING, which the automatic credit correctly refuses.
    driverId = await createDriverFor(pool, userId, { status: 'ACTIVE' });
  });

  afterAll(async () => {
    try {
      await purgePhone(pool, phone.normalized);
    } finally {
      await pool.end();
    }
  });

  // Each scenario: a fresh transaction, a fresh wallet state, always rolled back.
  async function scenario(run: (c: PoolClient) => Promise<void>): Promise<void> {
    client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { wallet } = await wallets.ensureZeroWallet(ctx(), driverId);
      walletId = wallet.walletId;
      service = serviceOver(client);
      await run(client);
      // Force every deferred invariant (topup/request/ledger triggers and constraints) to be checked now, before the rollback.
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }

  it('credits exactly once: a signed, matching transfer posts a SePay-settled topup, a ledger credit and the balance, with the request CONFIRMED', async () => {
    await scenario(async (c) => {
      await receivingAccount();
      const { requestId, code } = await pendingRequest(150000n);
      const raw = webhook({ code, content: `${code} chuyen tien`, transferAmount: 150000 });
      const eventId = JSON.parse(raw.toString('utf8')).id as number;
      const result = await service.receive(signedRequest(raw));
      expect(result).toEqual({ status: 200, body: { success: true } });

      const request = (await c.query('SELECT state, resolved_by_user_id, resolved_by_system FROM app.wallet_topup_requests WHERE request_id = $1::uuid', [requestId])).rows[0];
      expect(request).toEqual({ state: 'CONFIRMED', resolved_by_user_id: null, resolved_by_system: 'SEPAY_WEBHOOK' });
      const topups = (await c.query('SELECT confirmed_by_user_id, confirmed_by_system, actual_amount_vnd::text AS amount FROM app.wallet_topups WHERE request_id = $1::uuid', [requestId])).rows;
      expect(topups).toEqual([{ confirmed_by_user_id: null, confirmed_by_system: 'SEPAY_WEBHOOK', amount: '150000' }]);
      const credits = (await c.query("SELECT count(*)::int AS n FROM app.wallet_ledger_entries WHERE wallet_id = $1::uuid AND entry_kind = 'TOPUP'", [walletId])).rows[0];
      expect(credits).toEqual({ n: 1 });
      expect(await balanceOf()).toBe('150000');
      expect(await inboxOf(eventId)).toEqual({ state: 'CREDITED', reason_code: null, topup_request_id: requestId });
    });
  });

  it('a repeated delivery of the same webhook id credits nothing more', async () => {
    await scenario(async () => {
      await receivingAccount();
      const { code } = await pendingRequest(150000n);
      const raw = webhook({ code, content: code, transferAmount: 150000 });
      await service.receive(signedRequest(raw));
      expect(await service.receive(signedRequest(raw))).toEqual({ status: 200, body: { success: true } });
      expect(await balanceOf()).toBe('150000');
    });
  });

  it('a different webhook id for the same transfer is held, and the balance does not move twice', async () => {
    await scenario(async (c) => {
      await receivingAccount();
      const { code } = await pendingRequest(150000n);
      const first = webhook({ code, content: code, transferAmount: 150000, referenceCode: 'FTSAME0001' });
      const second = webhook({ code, content: code, transferAmount: 150000, referenceCode: 'FTSAME0001' });
      await service.receive(signedRequest(first));
      await service.receive(signedRequest(second));
      expect(await balanceOf()).toBe('150000');
      const firstId = JSON.parse(first.toString('utf8')).id as number;
      const secondId = JSON.parse(second.toString('utf8')).id as number;
      // One bank transfer = one bank identity (account, reference, amount, time). The first event is the record; the second is a duplicate
      // of it and writes no inbox row (the unique key sepay_transfer_inbox_bank_uq makes its insert a no-op). Nothing is credited twice.
      expect(await inboxOf(firstId)).toMatchObject({ state: 'CREDITED', reason_code: null });
      expect(await inboxOf(secondId)).toBeUndefined();
      expect((await c.query("SELECT count(*)::int AS n FROM app.sepay_transfer_inbox WHERE reference_code = 'FTSAME0001'")).rows[0]).toEqual({ n: 1 });
      expect((await c.query('SELECT count(*)::int AS n FROM app.wallet_topups')).rows[0]).toEqual({ n: 1 });
    });
  });

  it.each([
    ['a wrong amount', { transferAmount: 150001 }, 'AMOUNT_MISMATCH'],
    ['a missing code', { code: null, content: 'chuyen tien' }, 'NO_CODE'],
    ['a code that matches no request', { code: 'NAPFFFFFFFFFF', content: 'NAPFFFFFFFFFF' }, 'NO_REQUEST_FOR_CODE'],
    ['an empty bank reference', { referenceCode: '' }, 'NO_REFERENCE'],
  ])('holds %s for an Administrator and credits nothing', async (_name, override, reason) => {
    await scenario(async (c) => {
      await receivingAccount();
      const { code } = await pendingRequest(150000n);
      const raw = webhook({ code, content: code, transferAmount: 150000, ...override });
      const eventId = JSON.parse(raw.toString('utf8')).id as number;
      expect((await service.receive(signedRequest(raw))).status).toBe(200);
      expect(await inboxOf(eventId)).toEqual({ state: 'NEEDS_ADMIN', reason_code: reason, topup_request_id: null });
      expect((await c.query('SELECT count(*)::int AS n FROM app.wallet_topups')).rows[0]).toEqual({ n: 0 });
      expect(await balanceOf()).toBe('0');
    });
  });

  it('with the switch off the event is recorded as RECEIVED and nothing is credited', async () => {
    await scenario(async (c) => {
      await receivingAccount();
      const { code } = await pendingRequest(150000n);
      const raw = webhook({ code, content: code, transferAmount: 150000 });
      const eventId = JSON.parse(raw.toString('utf8')).id as number;
      const off = { SEPAY_WEBHOOK_SECRET: SECRET } as NodeJS.ProcessEnv;
      const timestamp = String(Math.floor(Date.now() / 1000));
      const result = await service.receive({ rawBody: raw, timestampHeader: timestamp, signatureHeader: `sha256=${createHmac('sha256', SECRET).update(`${timestamp}.`).update(raw).digest('hex')}`, nowSeconds: Number(timestamp), env: off });
      expect(result.status).toBe(200);
      expect(await inboxOf(eventId)).toEqual({ state: 'RECEIVED', reason_code: 'AUTO_TOPUP_DISABLED', topup_request_id: null });
      expect((await c.query('SELECT count(*)::int AS n FROM app.wallet_topups')).rows[0]).toEqual({ n: 0 });
    });
  });

  it('a transfer to an account that is not a receiving account is held, not credited', async () => {
    await scenario(async () => {
      const { code } = await pendingRequest(150000n);
      accountNumber = '9999999999';
      const raw = webhook({ code, content: code, transferAmount: 150000, accountNumber: '9999999999' });
      const eventId = JSON.parse(raw.toString('utf8')).id as number;
      await service.receive(signedRequest(raw));
      expect((await inboxOf(eventId)).reason_code).toBe('ACCOUNT_NOT_RECEIVING');
      expect(await balanceOf()).toBe('0');
    });
  });

  it('the database refuses a second request that would share a transfer code with an existing one', async () => {
    await scenario(async (c) => {
      const first = randomUUID();
      const code = topupTransferCodeOf(first);
      await requests.insertPending(ctx(), { requestId: first, walletId, driverId, amountVnd: 150000n, createdByUserId: userId });
      const clash = `${first.slice(0, 8)}-${first.slice(9, 13)}-4000-8000-000000000001`;
      expect(topupTransferCodeOf(clash)).toBe(code);
      await c.query('SAVEPOINT clash');
      await expect(requests.insertPending(ctx(), { requestId: clash, walletId, driverId, amountVnd: 150000n, createdByUserId: userId })).rejects.toMatchObject({ code: '23505' });
      await c.query('ROLLBACK TO SAVEPOINT clash');
      expect(await requests.transferCodeTaken(ctx(), code)).toBe(true);
    });
  });

  it('the inbox refuses a second row for the same webhook id, rewriting an identity, deleting a row, and leaving a final state', async () => {
    await scenario(async (c) => {
      const id = randomInt(3_000_000_000, 3_900_000_000);
      await c.query(
        `INSERT INTO app.sepay_transfer_inbox (inbox_id, webhook_event_id, gateway, account_number, transfer_type, transfer_amount_vnd, transaction_at, code, content, reference_code, state, received_at)
         VALUES ($1::uuid, $2::bigint, 'MBBank', '1234567890', 'in', 1000, now(), NULL, 'x', 'R1', 'RECEIVED', now())`,
        [randomUUID(), id],
      );
      await c.query('SAVEPOINT dup');
      await expect(c.query(
        `INSERT INTO app.sepay_transfer_inbox (inbox_id, webhook_event_id, gateway, account_number, transfer_type, transfer_amount_vnd, transaction_at, code, content, reference_code, state, received_at)
         VALUES ($1::uuid, $2::bigint, 'MBBank', '1234567890', 'in', 1000, now(), NULL, 'x', 'R1', 'RECEIVED', now())`,
        [randomUUID(), id],
      )).rejects.toMatchObject({ code: '23505' });
      await c.query('ROLLBACK TO SAVEPOINT dup');
      await c.query('SAVEPOINT amt');
      await expect(c.query('UPDATE app.sepay_transfer_inbox SET transfer_amount_vnd = 2000 WHERE webhook_event_id = $1::bigint', [id])).rejects.toThrow(/IDENTITY_IMMUTABLE/);
      await c.query('ROLLBACK TO SAVEPOINT amt');
      await c.query('SAVEPOINT del');
      await expect(c.query('DELETE FROM app.sepay_transfer_inbox WHERE webhook_event_id = $1::bigint', [id])).rejects.toThrow(/EVIDENCE|restrict/i);
      await c.query('ROLLBACK TO SAVEPOINT del');
      await c.query("UPDATE app.sepay_transfer_inbox SET state = 'IGNORED', reason_code = 'OUTBOUND_TRANSFER', processed_at = now() WHERE webhook_event_id = $1::bigint", [id]);
      await c.query('SAVEPOINT final');
      await expect(c.query("UPDATE app.sepay_transfer_inbox SET state = 'RECEIVED', processed_at = NULL WHERE webhook_event_id = $1::bigint", [id])).rejects.toThrow(/STATE_FINAL|CHECK|check/i);
      await c.query('ROLLBACK TO SAVEPOINT final');
    });
  });

  // M04 step 2b (Owner 2026-11-20): the Shipper's report. It keeps the request PENDING and its version, so the settlement still credits it.
  it('a reported request stays PENDING at the same version; a second report is refused by the database', async () => {
    await scenario(async (c) => {
      await receivingAccount();
      const { requestId } = await pendingRequest(150000n);
      const first = await requests.reportPending(ctx(), requestId);
      expect(first).toMatchObject({ state: 'PENDING', version: 1 });
      expect(first?.reportedAtMs).not.toBeNull();
      expect(await requests.reportPending(ctx(), requestId)).toBeUndefined();
      await c.query('SAVEPOINT again');
      await expect(c.query('UPDATE app.wallet_topup_requests SET reported_at = now() WHERE request_id = $1::uuid', [requestId])).rejects.toThrow(/REPORT_REFUSED/);
      await c.query('ROLLBACK TO SAVEPOINT again');
    });
  });

  it('a request reported by the Shipper is still credited by the bank transfer, and keeps its report time', async () => {
    await scenario(async (c) => {
      await receivingAccount();
      const { requestId, code } = await pendingRequest(150000n);
      expect((await requests.reportPending(ctx(), requestId))?.state).toBe('PENDING');
      const raw = webhook({ code, content: `${code} chuyen tien`, transferAmount: 150000 });
      expect(await service.receive(signedRequest(raw))).toEqual({ status: 200, body: { success: true } });
      const request = (await c.query('SELECT state, reported_at IS NOT NULL AS reported FROM app.wallet_topup_requests WHERE request_id = $1::uuid', [requestId])).rows[0];
      expect(request).toEqual({ state: 'CONFIRMED', reported: true });
      expect(await balanceOf()).toBe('150000');
    });
  });

  it('a request decided by the credit cannot be reported: the database refuses the report, and the report reads as a conflict', async () => {
    await scenario(async (c) => {
      await receivingAccount();
      const { requestId, code } = await pendingRequest(150000n);
      await service.receive(signedRequest(webhook({ code, content: `${code} chuyen tien`, transferAmount: 150000 })));
      await c.query('SAVEPOINT late');
      await expect(c.query('UPDATE app.wallet_topup_requests SET reported_at = now() WHERE request_id = $1::uuid', [requestId])).rejects.toThrow(/REPORT_REFUSED/);
      await c.query('ROLLBACK TO SAVEPOINT late');
      expect(await requests.reportPending(ctx(), requestId)).toBeUndefined();
    });
  });

  it('the Administrator queue lists a held transfer; dismissal closes it once, keeps the reason it had, and the row is never deleted', async () => {
    await scenario(async (c) => {
      await receivingAccount();
      const { code } = await pendingRequest(150000n);
      const raw = webhook({ code, content: code, transferAmount: 150001, referenceCode: 'FTQUEUEITEM1' });
      const eventId = JSON.parse(raw.toString('utf8')).id as number;
      await service.receive(signedRequest(raw));
      expect(await inboxOf(eventId)).toEqual({ state: 'NEEDS_ADMIN', reason_code: 'AMOUNT_MISMATCH', topup_request_id: null });
      const repository = new SepaySettlementRepository();
      const queued = await repository.listNeedsAdmin(ctx(), 500);
      const item = queued.find((row) => row.referenceCode === 'FTQUEUEITEM1');
      expect(item).toMatchObject({ reason: 'AMOUNT_MISMATCH', transferAmountVnd: 150001, accountLast4: accountNumber.slice(-4) });
      const inboxId = await inboxIdOf(eventId);
      expect(await repository.dismissNeedsAdmin(ctx(), inboxId, 'NOT_A_TOPUP')).toEqual({ previousReason: 'AMOUNT_MISMATCH' });
      expect(await repository.dismissNeedsAdmin(ctx(), inboxId, 'NOT_A_TOPUP')).toBeUndefined();
      expect(await inboxOf(eventId)).toEqual({ state: 'IGNORED', reason_code: 'NOT_A_TOPUP', topup_request_id: null });
      expect((await repository.listNeedsAdmin(ctx(), 500)).some((row) => row.referenceCode === 'FTQUEUEITEM1')).toBe(false);
      await c.query('SAVEPOINT no_delete');
      await expect(c.query('DELETE FROM app.sepay_transfer_inbox WHERE inbox_id = $1::uuid', [inboxId])).rejects.toThrow(/EVIDENCE|restrict/i);
      await c.query('ROLLBACK TO SAVEPOINT no_delete');
    });
  });

  // ---- Same bank transfer, two sources (Codex 2026-11-22, finding 1): one bank identity = the bank reference ----

  it('an Administrator confirmed the bank reference first; the SePay transfer of the same reference is LINKED to that request and is not credited again', async () => {
    await scenario(async (c) => {
      const accountId = await receivingAccount();
      const { requestId, code } = await pendingRequest(150000n);
      await posting.creditTopup(ctx(), {
        walletId, driverId, requestId, bankId: BANK_ID, systemAccountId: accountId, canonicalTransactionId: 'FTADMINFIRST',
        actualAmountVnd: 150000n, receivedAtIso: '2026-11-19T11:08:33+07:00', settledBy: { kind: 'ADMIN', userId },
      });
      await requests.resolve(ctx(), requestId, 1, 'CONFIRMED', { kind: 'ADMIN', userId });
      const raw = webhook({ code, content: code, transferAmount: 150000, referenceCode: 'FTADMINFIRST' });
      const eventId = JSON.parse(raw.toString('utf8')).id as number;
      expect((await service.receive(signedRequest(raw))).status).toBe(200);
      expect(await inboxOf(eventId)).toEqual({ state: 'LINKED', reason_code: 'ALREADY_RECORDED', topup_request_id: requestId });
      expect(await balanceOf()).toBe('150000');
      expect(await topupCount()).toBe(1);
      const bank = (await c.query("SELECT count(*)::int AS n FROM app.wallet_bank_transactions WHERE canonical_transaction_id = 'FTADMINFIRST'")).rows[0];
      expect(bank).toEqual({ n: 1 });
    });
  });

  it('the SePay transfer was credited first; the Administrator cannot confirm the same bank reference again, on this or another request', async () => {
    await scenario(async () => {
      const accountId = await receivingAccount();
      const first = await pendingRequest(150000n);
      const raw = webhook({ code: first.code, content: first.code, transferAmount: 150000, referenceCode: 'FTSEPAYFIRST' });
      expect((await service.receive(signedRequest(raw))).status).toBe(200);
      const second = await pendingRequest(150000n);
      await expect(
        posting.creditTopup(ctx(), {
          walletId, driverId, requestId: second.requestId, bankId: BANK_ID, systemAccountId: accountId, canonicalTransactionId: 'FTSEPAYFIRST',
          actualAmountVnd: 150000n, receivedAtIso: '2026-11-19T11:08:33+07:00', settledBy: { kind: 'ADMIN', userId },
        }),
      ).rejects.toMatchObject({ code: 'BANK_TRANSACTION_ALREADY_RECORDED' });
      expect(await balanceOf()).toBe('150000');
      expect(await topupCount()).toBe(1);
    });
  });

  it('two different top-up requests cannot both take one bank transfer: the second SePay event is linked to the request that holds it', async () => {
    await scenario(async () => {
      await receivingAccount();
      const first = await pendingRequest(150000n);
      const second = await pendingRequest(150000n);
      const reference = 'FTTWOREQUESTS';
      const credited = webhook({ code: first.code, content: first.code, transferAmount: 150000, referenceCode: reference });
      await service.receive(signedRequest(credited));
      // The same bank reference, arriving later with a different SePay id and time: a new evidence row, but the same bank transfer.
      const replay = webhook({ code: second.code, content: second.code, transferAmount: 150000, referenceCode: reference, transactionDate: '2026-11-19 11:09:00' });
      const replayId = JSON.parse(replay.toString('utf8')).id as number;
      await service.receive(signedRequest(replay));
      expect(await inboxOf(replayId)).toEqual({ state: 'LINKED', reason_code: 'ALREADY_RECORDED', topup_request_id: first.requestId });
      expect(await balanceOf()).toBe('150000');
      expect(await topupCount()).toBe(1);
    });
  });

  // ---- The switch and the credentials (Codex 2026-11-22, findings 2 and 3) ----

  it('held while the switch was off; once the switch and both credentials are on, the recovery settles it exactly once and a repeat changes nothing', async () => {
    await scenario(async (c) => {
      await receivingAccount();
      const { requestId, code } = await pendingRequest(150000n);
      const raw = webhook({ code, content: code, transferAmount: 150000 });
      const eventId = JSON.parse(raw.toString('utf8')).id as number;
      const offEnv = { SEPAY_WEBHOOK_SECRET: SECRET } as NodeJS.ProcessEnv;
      expect((await service.receive(signedWith(raw, offEnv))).status).toBe(200);
      expect(await inboxOf(eventId)).toEqual({ state: 'RECEIVED', reason_code: 'AUTO_TOPUP_DISABLED', topup_request_id: null });
      expect(await balanceOf()).toBe('0');

      const settlement = settlementOver();
      const config = readSepayConfig(ENV);
      const inboxId = await inboxIdOf(eventId);
      expect(await settlement.recoverableIds(ctx(), 50)).toContain(inboxId);
      expect(await settlement.recoverOne(ctx(), inboxId, config)).toBe(true);
      expect(await inboxOf(eventId)).toEqual({ state: 'CREDITED', reason_code: null, topup_request_id: requestId });
      expect(await settlement.recoverOne(ctx(), inboxId, config)).toBe(false);
      expect(await service.receive(signedRequest(raw))).toEqual({ status: 200, body: { success: true } });
      expect(await balanceOf()).toBe('150000');
      expect(await topupCount()).toBe(1);
      expect((await c.query("SELECT count(*)::int AS n FROM app.sepay_transfer_inbox WHERE reference_code = $1", [JSON.parse(raw.toString('utf8')).referenceCode as string])).rows[0]).toEqual({ n: 1 });
    });
  });

  it('a verified webhook with the switch on but no API key is kept as evidence (AUTO_TOPUP_NOT_CONFIGURED) and credits nothing, until the key is configured', async () => {
    await scenario(async () => {
      await receivingAccount();
      const { requestId, code } = await pendingRequest(150000n);
      const raw = webhook({ code, content: code, transferAmount: 150000 });
      const eventId = JSON.parse(raw.toString('utf8')).id as number;
      const noKey = { SEPAY_WEBHOOK_SECRET: SECRET, SEPAY_AUTO_TOPUP_ENABLED: 'true' } as NodeJS.ProcessEnv;
      expect((await service.receive(signedWith(raw, noKey))).status).toBe(200);
      expect(await inboxOf(eventId)).toEqual({ state: 'RECEIVED', reason_code: 'AUTO_TOPUP_NOT_CONFIGURED', topup_request_id: null });
      expect(await balanceOf()).toBe('0');
      const settlement = settlementOver();
      expect(await settlement.recoverOne(ctx(), await inboxIdOf(eventId), readSepayConfig(noKey))).toBe(false);
      expect(await settlement.recoverOne(ctx(), await inboxIdOf(eventId), readSepayConfig(ENV))).toBe(true);
      expect(await inboxOf(eventId)).toEqual({ state: 'CREDITED', reason_code: null, topup_request_id: requestId });
      expect(await balanceOf()).toBe('150000');
    });
  });

  it('evidence held while the switch was off is linked when the Administrator confirms the same reference and amount by hand; the recovery then leaves it alone', async () => {
    await scenario(async (c) => {
      const accountId = await receivingAccount();
      const { code } = await pendingRequest(150000n);
      const raw = webhook({ code, content: code, transferAmount: 150000, referenceCode: 'FTHELDBYOFF' });
      const eventId = JSON.parse(raw.toString('utf8')).id as number;
      await service.receive(signedWith(raw, { SEPAY_WEBHOOK_SECRET: SECRET } as NodeJS.ProcessEnv));
      expect((await inboxOf(eventId)).state).toBe('RECEIVED');
      // The Administrator confirms the statement line of the same reference (for this request), exactly as the top-up screen does.
      const confirmed = await pendingRequest(150000n);
      await posting.creditTopup(ctx(), { walletId, driverId, requestId: confirmed.requestId, bankId: BANK_ID, systemAccountId: accountId, canonicalTransactionId: 'FTHELDBYOFF', actualAmountVnd: 150000n, receivedAtIso: '2026-11-19T11:08:33+07:00', settledBy: { kind: 'ADMIN', userId } });
      await requests.resolve(ctx(), confirmed.requestId, 1, 'CONFIRMED', { kind: 'ADMIN', userId });
      const linked = await new SepaySettlementRepository().linkManualConfirmation(ctx(), { accountNumber, referenceCode: 'FTHELDBYOFF', amountVnd: 150000n, requestId: confirmed.requestId });
      expect(linked).toBe(1);
      expect(await inboxOf(eventId)).toEqual({ state: 'LINKED', reason_code: 'ADMIN_CONFIRMED', topup_request_id: confirmed.requestId });
      expect(await settlementOver().recoverOne(ctx(), await inboxIdOf(eventId), readSepayConfig(ENV))).toBe(false);
      expect(await balanceOf()).toBe('150000');
      expect((await c.query('SELECT count(*)::int AS n FROM app.wallet_topups WHERE wallet_id = $1::uuid', [walletId])).rows[0]).toEqual({ n: 1 });
    });
  });

  // ---- The same settlement under the runtime privileges of ship11_app (Codex 2026-11-22, finding 5, limit documented in the PR) ----

  it('the credit runs under the runtime matrix of ops/selfhosted/02-runtime-grants.sql, and that matrix is really in force', async () => {
    await scenario(async (c) => {
      await applyRuntimeGrants(c, RUNTIME_TABLES);
      // The matrix is in force: a row lock on an append-only table (audit_logs: SELECT, INSERT only) is refused; the owner would take it without the matrix.
      await c.query('SAVEPOINT no_lock');
      await expect(c.query('SELECT 1 FROM app.audit_logs FOR UPDATE')).rejects.toThrow(/permission denied/i);
      await c.query('ROLLBACK TO SAVEPOINT no_lock');

      await receivingAccount();
      const { requestId, code } = await pendingRequest(150000n);
      const raw = webhook({ code, content: code, transferAmount: 150000 });
      const eventId = JSON.parse(raw.toString('utf8')).id as number;
      expect((await service.receive(signedRequest(raw))).status).toBe(200);
      expect(await inboxOf(eventId)).toEqual({ state: 'CREDITED', reason_code: null, topup_request_id: requestId });
      expect(await balanceOf()).toBe('150000');

    });
  });

  // ---- Owner 2026-11-27: a request never reported within 24 hours is ended by the system (migration 1798329600000_topup-request-expiry) ----

  /** A PENDING request created `ageMinutes` ago (the clock is the database's), optionally reported by the Shipper. */
  async function agedRequest(ageMinutes: number, reported: boolean): Promise<{ requestId: string; code: string }> {
    const requestId = randomUUID();
    await client.query(
      `INSERT INTO app.wallet_topup_requests (request_id, wallet_id, driver_id, amount_requested_vnd, state, created_by_user_id, version, created_at, updated_at)
       SELECT $1::uuid, $2::uuid, $3::uuid, 150000, 'PENDING', $4::uuid, 1, t, t
         FROM (SELECT date_trunc('milliseconds', clock_timestamp()) - make_interval(mins => $5::int) AS t) AS clock`,
      [requestId, walletId, driverId, userId, ageMinutes],
    );
    if (reported) {
      expect((await requests.reportPending(ctx(), requestId))?.state).toBe('PENDING');
    }
    return { requestId, code: topupTransferCodeOf(requestId) };
  }

  const stateOf = async (requestId: string): Promise<Record<string, unknown>> =>
    (await client.query('SELECT state, version::int AS version, resolved_by_user_id, resolved_by_system FROM app.wallet_topup_requests WHERE request_id = $1::uuid', [requestId])).rows[0] as Record<string, unknown>;

  it('expiry ends only a PENDING request never reported and older than 24 hours: once, by the system, and a second run changes nothing', async () => {
    await scenario(async () => {
      const day = TOPUP_EXPIRY_AFTER_MINUTES;
      expect(day).toBe(24 * 60);
      const old = await agedRequest(day + 60, false);
      const young = await agedRequest(day - 60, false);
      const reported = await agedRequest(day + 60, true);
      const ended = await requests.expireUnreported(ctx(), day, 200);
      expect(ended.map((row) => row.requestId)).toEqual([old.requestId]);
      expect(await stateOf(old.requestId)).toEqual({ state: 'CANCELLED', version: 2, resolved_by_user_id: null, resolved_by_system: 'TOPUP_EXPIRY' });
      expect((await stateOf(young.requestId)).state).toBe('PENDING');
      expect((await stateOf(reported.requestId)).state).toBe('PENDING');
      expect(await requests.expireUnreported(ctx(), day, 200)).toEqual([]);
      expect(await balanceOf()).toBe('0');
    });
  });

  it('the job writes one audit line and one event per ended request, and none on a second run', async () => {
    await scenario(async (c) => {
      const old = await agedRequest(TOPUP_EXPIRY_AFTER_MINUTES + 60, false);
      const transactions = { withTransaction: (work: (context: TransactionContext) => Promise<unknown>) => work(ctx()) };
      const job = new TopupExpiryJob(transactions as never, requests, new AuditWriter(), new OutboxWriter());
      expect(await job.runOnce()).toBeGreaterThanOrEqual(1);
      expect(await job.runOnce()).toBe(0);
      const audits = (await c.query("SELECT count(*)::int AS n FROM app.audit_logs WHERE resource_id = $1 AND action = 'wallet.topup_request.expired.v1'", [old.requestId])).rows[0];
      expect(audits).toEqual({ n: 1 });
      const events = (await c.query("SELECT count(*)::int AS n FROM app.outbox_events WHERE resource_id = $1 AND event_type = 'wallet.topup_request.changed.v1'", [old.requestId])).rows[0];
      expect(events).toEqual({ n: 1 });
    });
  });

  it('a transfer that arrives after the request expired is held for an Administrator (REQUEST_NOT_PENDING) and credits nothing', async () => {
    await scenario(async () => {
      await receivingAccount();
      const old = await agedRequest(TOPUP_EXPIRY_AFTER_MINUTES + 60, false);
      await requests.expireUnreported(ctx(), TOPUP_EXPIRY_AFTER_MINUTES, 200);
      const raw = webhook({ code: old.code, content: `${old.code} chuyen tien`, transferAmount: 150000 });
      const eventId = JSON.parse(raw.toString('utf8')).id as number;
      expect(await service.receive(signedRequest(raw))).toEqual({ status: 200, body: { success: true } });
      expect(await inboxOf(eventId)).toEqual({ state: 'NEEDS_ADMIN', reason_code: 'REQUEST_NOT_PENDING', topup_request_id: null });
      expect(await balanceOf()).toBe('0');
      expect(await topupCount()).toBe(0);
    });
  });

  it('the database refuses TOPUP_EXPIRY on a request that is not CANCELLED or that was reported', async () => {
    await scenario(async (c) => {
      const pending = await agedRequest(10, false);
      await c.query('SAVEPOINT not_ended');
      await expect(c.query("UPDATE app.wallet_topup_requests SET resolved_by_system = 'TOPUP_EXPIRY' WHERE request_id = $1::uuid", [pending.requestId])).rejects.toThrow();
      await c.query('ROLLBACK TO SAVEPOINT not_ended');
      const reported = await agedRequest(10, true);
      await c.query('SAVEPOINT reported_cancel');
      await expect(
        c.query(
          `UPDATE app.wallet_topup_requests SET state = 'CANCELLED', resolved_by_system = 'TOPUP_EXPIRY', resolved_at = now(), updated_at = now(), version = version + 1 WHERE request_id = $1::uuid`,
          [reported.requestId],
        ),
      ).rejects.toThrow(/wallet_topup_requests_expiry_ck/);
      await c.query('ROLLBACK TO SAVEPOINT reported_cancel');
    });
  });
});

// The runtime matrix (ops/selfhosted/02-runtime-grants.sql) for the tables of the top-up settlement. CI has no ship11_app login, so the owner
// (ship11_test) takes exactly these privileges for the duration of a rolled-back transaction. Limit: this is a privilege simulation, not SET ROLE.
const RUNTIME_TABLES = [
  'drivers', 'driver_wallets', 'wallet_ledger_entries', 'system_owned_bank_accounts', 'wallet_topup_requests', 'wallet_bank_transactions',
  'wallet_topups', 'sepay_transfer_inbox', 'sepay_reconciliation_cursor', 'outbox_events', 'audit_logs',
];

/**
 * Tables that a foreign key references. PostgreSQL runs the check of a referencing row as the owner of the REFERENCED table, and that check takes a
 * FOR KEY SHARE lock, which needs UPDATE. In production the owner is the migrator, not the runtime role. Here the owner is the same test role, so
 * UPDATE is given back to it on these tables only (a simulation artifact, documented in the PR). Every other table keeps the exact matrix.
 */
const FK_REFERENCED = ['drivers', 'driver_wallets', 'system_owned_bank_accounts', 'wallet_bank_transactions', 'wallet_topup_requests', 'wallet_topups'];

async function applyRuntimeGrants(client: PoolClient, tables: readonly string[]): Promise<void> {
  const file = readFileSync(path.resolve(__dirname, '..', '..', '..', 'ops', 'selfhosted', '02-runtime-grants.sql'), 'utf8');
  for (const line of file.split('\n')) {
    const match = /^GRANT (.+) ON app\.(\w+) TO ship11_app;$/.exec(line.trim());
    if (match === null || !tables.includes(match[2]!)) continue;
    await client.query(`REVOKE ALL ON app.${match[2]} FROM ship11_test`);
    await client.query(`GRANT ${match[1]} ON app.${match[2]} TO ship11_test`);
  }
  for (const table of tables.filter((name) => FK_REFERENCED.includes(name))) {
    await client.query(`GRANT UPDATE ON app.${table} TO ship11_test`);
  }
}
