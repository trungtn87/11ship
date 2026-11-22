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

// M04 SePay (Codex 2026-11-22 review, Lead item 1): the Administrator confirmed a bank reference and committed; the SePay webhook for the SAME
// transfer arrives later. It must be LINKED to the request that already holds the transfer, never NEEDS_ADMIN. Each scenario runs in one
// rolled-back transaction. This file uses only the APIs that exist before this change, so it also runs against the previous head to show RED.

const SECRET = 'linked-evidence-not-a-real-secret';
const API_KEY = 'linked-evidence-api-key';
const ENV = { SEPAY_WEBHOOK_SECRET: SECRET, SEPAY_API_KEY: API_KEY, SEPAY_AUTO_TOPUP_ENABLED: 'true' } as NodeJS.ProcessEnv;
const BANK_ID = 'MB';

describe('M04 SePay: a transfer already confirmed by an Administrator is LINKED, not queued', () => {
  let pool: Pool;
  let client: PoolClient;
  let phone: Phone;
  let userId: string;
  let driverId: string;
  let walletId: string;
  let accountNumber: string;
  const wallets = new WalletService(new WalletRepository(), new DriverRepository());
  const requests = new TopupRequestRepository();
  const posting = new TopupPostingService(new TopupSettlementRepository());

  const ctx = (): TransactionContext => ({ query: (sql: string, params?: unknown[]) => client.query(sql, params as unknown[]) }) as unknown as TransactionContext;

  function webhookService(): SepayWebhookService {
    const settlement = new SepaySettlementService(
      new SepaySettlementRepository(),
      new TopupAutoLookupRepository(),
      new DriverRepository(),
      posting,
      requests,
      new AuditWriter(),
      new OutboxWriter(),
    );
    return new SepayWebhookService({ withTransaction: (work: (c: TransactionContext) => Promise<unknown>) => work(ctx()) } as never, settlement);
  }

  function signed(raw: Buffer): { rawBody: Buffer; timestampHeader: string; signatureHeader: string; nowSeconds: number; env: NodeJS.ProcessEnv } {
    const timestamp = String(Math.floor(Date.now() / 1000));
    return {
      rawBody: raw,
      timestampHeader: timestamp,
      signatureHeader: `sha256=${createHmac('sha256', SECRET).update(`${timestamp}.`).update(raw).digest('hex')}`,
      nowSeconds: Number(timestamp),
      env: ENV,
    };
  }

  beforeAll(async () => {
    pool = testPool(loadIntegrationConfig().database, { poolMax: 2 });
    phone = randomPhone();
    userId = randomUUID();
    await pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', now(), 'PHONE_VERIFIED', 'ACTIVE', 1, now(), now())`,
      [userId, phone.normalized],
    );
    driverId = await createDriverFor(pool, userId, { status: 'ACTIVE' });
  });

  afterAll(async () => {
    try {
      await purgePhone(pool, phone.normalized);
    } finally {
      await pool.end();
    }
  });

  async function scenario(run: () => Promise<void>): Promise<void> {
    client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { wallet } = await wallets.ensureZeroWallet(ctx(), driverId);
      walletId = wallet.walletId;
      await run();
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }

  it('the Administrator committed the bank reference first; the webhook for the same transfer is LINKED to that request (not NEEDS_ADMIN)', async () => {
    await scenario(async () => {
      const accountId = randomUUID();
      accountNumber = String(randomInt(1_000_000_000, 9_999_999_999));
      await client.query(
        `INSERT INTO app.system_owned_bank_accounts (system_account_id, bank_id, account_number, account_holder, can_receive, version, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, 'TEST ACCOUNT HOLDER', false, 1, now(), now())`,
        [accountId, BANK_ID, accountNumber],
      );
      await client.query('UPDATE app.system_owned_bank_accounts SET can_receive = true, version = 2, updated_at = now() WHERE system_account_id = $1::uuid', [accountId]);
      const requestId = randomUUID();
      await requests.insertPending(ctx(), { requestId, walletId, driverId, amountVnd: 150000n, createdByUserId: userId });
      const code = topupTransferCodeOf(requestId);
      const reference = `FTLINKED${randomUUID().slice(0, 8).toUpperCase()}`;

      // The Administrator's confirmation, as the top-up screen commits it: bank record, topup, ledger, balance, request CONFIRMED.
      await posting.creditTopup(ctx(), {
        walletId, driverId, requestId, bankId: BANK_ID, systemAccountId: accountId, canonicalTransactionId: reference,
        actualAmountVnd: 150000n, receivedAtIso: '2026-11-22T09:00:00+07:00', settledBy: { kind: 'ADMIN', userId },
      });
      await requests.resolve(ctx(), requestId, 1, 'CONFIRMED', { kind: 'ADMIN', userId });

      const id = randomInt(4_200_000_000, 4_300_000_000);
      const raw = Buffer.from(
        JSON.stringify({
          id, gateway: 'MBBank', transactionDate: '2026-11-22 09:00:00', accountNumber, subAccount: '', code, content: `${code} chuyen tien`,
          transferType: 'in', description: '', transferAmount: 150000, accumulated: 0, referenceCode: reference,
        }),
        'utf8',
      );
      expect(await webhookService().receive(signed(raw))).toEqual({ status: 200, body: { success: true } });

      const inbox = (await client.query<{ state: string; reason_code: string | null; topup_request_id: string | null }>(
        'SELECT state, reason_code, topup_request_id::text AS topup_request_id FROM app.sepay_transfer_inbox WHERE webhook_event_id = $1::bigint',
        [id],
      )).rows[0];
      expect(inbox).toEqual({ state: 'LINKED', reason_code: 'ALREADY_RECORDED', topup_request_id: requestId });
      const topups = (await client.query('SELECT count(*)::int AS n FROM app.wallet_topups WHERE wallet_id = $1::uuid', [walletId])).rows[0];
      expect(topups).toEqual({ n: 1 });
      expect((await client.query<{ balance: string }>('SELECT balance_vnd::text AS balance FROM app.driver_wallets WHERE wallet_id = $1::uuid', [walletId])).rows[0]).toEqual({ balance: '150000' });
    });
  });
});
