import { createHmac, randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Pool, PoolClient } from 'pg';
import { AuditWriter } from '../../apps/backend/src/audit/audit-writer';
import { DriverRepository } from '../../apps/backend/src/driver/driver-repository';
import { OutboxWriter } from '../../apps/backend/src/outbox/outbox-writer';
import { SepaySettlementRepository } from '../../apps/backend/src/sepay/sepay-settlement-repository';
import { SepaySettlementService } from '../../apps/backend/src/sepay/sepay-settlement-service';
import { SepayWebhookService } from '../../apps/backend/src/sepay/sepay-webhook.service';
import { TransactionContext } from '../../apps/backend/src/transaction/transaction-context';
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

// M04 SePay automatic top-up, step 1, on a REAL PostgreSQL schema (all migrations, including 1798070400000_sepay-auto-topup-inbox).
// EVERY scenario runs in ONE database transaction on one connection that is ROLLED BACK at the end, so no row is committed and nothing
// needs cleaning up. Deferred constraint triggers (topup / request invariants, foreign keys) are forced to run before the rollback with
// SET CONSTRAINTS ALL IMMEDIATE, so the database proves its own rules for each scenario. The service under test is the real one with the
// real repositories; only the transaction source is the single rolled-back transaction.

const SECRET = 'integration-only-sepay-secret';
const ENV = { SEPAY_WEBHOOK_SECRET: SECRET, SEPAY_AUTO_TOPUP_ENABLED: 'true' } as NodeJS.ProcessEnv;
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

  function serviceOver(connection: PoolClient): SepayWebhookService {
    const context = { query: (sql: string, params?: unknown[]) => connection.query(sql, params as unknown[]) } as unknown as TransactionContext;
    const transactions = { withTransaction: (work: (c: TransactionContext) => Promise<unknown>) => work(context) };
    const settlement = new SepaySettlementService(
      new SepaySettlementRepository(),
      new TopupAutoLookupRepository(),
      new DriverRepository(),
      new TopupPostingService(new TopupSettlementRepository()),
      requests,
      new AuditWriter(),
      new OutboxWriter(),
    );
    return new SepayWebhookService(transactions as never, settlement);
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
      const secondId = JSON.parse(second.toString('utf8')).id as number;
      expect((await inboxOf(secondId)).reason_code).toBe('REQUEST_NOT_PENDING');
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
});
