import { createHmac, randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Pool, PoolClient } from 'pg';
import { AppError } from '../../apps/backend/src/common/app-errors';
import { AuditWriter } from '../../apps/backend/src/audit/audit-writer';
import { DriverRepository } from '../../apps/backend/src/driver/driver-repository';
import { OutboxWriter } from '../../apps/backend/src/outbox/outbox-writer';
import { readSepayConfig } from '../../apps/backend/src/sepay/sepay-config';
import { parseSepayApiTransaction } from '../../apps/backend/src/sepay/sepay-event';
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

// M04 SePay, the race that matters (Lead item 2): ONE bank transfer reaches the system three ways at the same moment, each on its OWN database
// connection and its own transaction, with SEPAY_AUTO_TOPUP_ENABLED on and both credentials set:
//   A. the SePay webhook (transaction event, id 1),
//   B. the reconciliation read (the same transfer from the transactions API, a different id, the job's per-event settlement),
//   C. the Administrator's manual confirmation (the same bank reference, the same amount, the request locked and checked as the admin path does).
// Unlike the rolled-back suites, this one COMMITS its fixtures, so the rows are real and other suites could see them. Cleanup is explicit: every
// committed row of this run is removed at the end, with the guard triggers of exactly those tables lifted in one transaction (as the shared purge does).
// Invariants checked after each round, whatever the interleaving: exactly one topup and one ledger credit; the balance rises once; one bank record;
// one inbox row for the transfer, CREDITED or LINKED to the same request; no deadlock; no orphan row.

const SECRET = 'race-not-a-real-secret';
const API_KEY = 'race-not-a-real-api-key';
const ENV = { SEPAY_WEBHOOK_SECRET: SECRET, SEPAY_API_KEY: API_KEY, SEPAY_AUTO_TOPUP_ENABLED: 'true' } as NodeJS.ProcessEnv;
const BANK_ID = 'MB';
const AMOUNT = 150000;
const ROUNDS = 3;

describe('M04 SePay: webhook + reconciliation + Administrator on one transfer, three connections, committed', () => {
  let pool: Pool;
  let phone: Phone;
  let userId: string;
  let driverId: string;
  let walletId: string;
  let accountId: string;
  let accountNumber: string;
  const wallets = new WalletService(new WalletRepository(), new DriverRepository());
  const requests = new TopupRequestRepository();
  const posting = new TopupPostingService(new TopupSettlementRepository());
  const drivers = new DriverRepository();
  const requestIds: string[] = [];
  const references: string[] = [];
  const inboxEventIds: number[] = [];

  const ctxOf = (connection: PoolClient): TransactionContext => ({ query: (sql: string, params?: unknown[]) => connection.query(sql, params as unknown[]) }) as unknown as TransactionContext;
  const autoCtx = (): TransactionContext => ({ query: (sql: string, params?: unknown[]) => pool.query(sql, params as unknown[]) }) as unknown as TransactionContext;

  const settlement = (): SepaySettlementService =>
    new SepaySettlementService(new SepaySettlementRepository(), new TopupAutoLookupRepository(), drivers, posting, requests, new AuditWriter(), new OutboxWriter());

  /** Runs one unit of work in its own transaction on its own connection. A refusal is returned, never thrown: the other sides must still finish. */
  async function inOwnTransaction<T>(work: (context: TransactionContext) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      try {
        const value = await work(ctxOf(connection));
        await connection.query('COMMIT');
        return { ok: true, value };
      } catch (error) {
        await connection.query('ROLLBACK');
        return { ok: false, error };
      }
    } finally {
      connection.release();
    }
  }

  function signed(raw: Buffer): { rawBody: Buffer; timestampHeader: string; signatureHeader: string; nowSeconds: number; env: NodeJS.ProcessEnv } {
    const timestamp = String(Math.floor(Date.now() / 1000));
    return { rawBody: raw, timestampHeader: timestamp, signatureHeader: `sha256=${createHmac('sha256', SECRET).update(`${timestamp}.`).update(raw).digest('hex')}`, nowSeconds: Number(timestamp), env: ENV };
  }

  beforeAll(async () => {
    pool = testPool(loadIntegrationConfig().database, { poolMax: 6 });
    phone = randomPhone();
    userId = randomUUID();
    await pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', now(), 'PHONE_VERIFIED', 'ACTIVE', 1, now(), now())`,
      [userId, phone.normalized],
    );
    driverId = await createDriverFor(pool, userId, { status: 'ACTIVE' });
    walletId = (await wallets.ensureZeroWallet(autoCtx(), driverId)).wallet.walletId;
    accountId = randomUUID();
    accountNumber = String(randomInt(1_000_000_000, 9_999_999_999));
    await pool.query(
      `INSERT INTO app.system_owned_bank_accounts (system_account_id, bank_id, account_number, account_holder, can_receive, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, 'TEST ACCOUNT HOLDER', false, 1, now(), now())`,
      [accountId, BANK_ID, accountNumber],
    );
    await pool.query('UPDATE app.system_owned_bank_accounts SET can_receive = true, version = 2, updated_at = now() WHERE system_account_id = $1::uuid', [accountId]);
  });

  afterAll(async () => {
    try {
      // Inbox rows are evidence that the application never deletes; this test lifts their guard for its own rows only, then removes them.
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN');
        await connection.query('ALTER TABLE app.sepay_transfer_inbox DISABLE TRIGGER USER');
        await connection.query('DELETE FROM app.sepay_transfer_inbox WHERE account_number = $1', [accountNumber]);
        await connection.query('ALTER TABLE app.sepay_transfer_inbox ENABLE TRIGGER USER');
        await connection.query('COMMIT');
      } catch (error) {
        await connection.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        connection.release();
      }
      // Topups, bank records, ledger, requests and the wallet of this driver (the shared purge lifts exactly those guards).
      await purgePhone(pool, phone.normalized);
      // Audit and outbox rows of this run's requests; then the receiving account (its bank records are gone with the topups above).
      const connection2 = await pool.connect();
      try {
        await connection2.query('BEGIN');
        for (const table of ['audit_logs', 'outbox_events', 'system_owned_bank_accounts']) {
          await connection2.query(`ALTER TABLE app.${table} DISABLE TRIGGER USER`);
        }
        await connection2.query('DELETE FROM app.audit_logs WHERE resource_id::text = ANY($1::text[])', [requestIds]);
        await connection2.query('DELETE FROM app.outbox_events WHERE resource_id::text = ANY($1::text[])', [requestIds]);
        await connection2.query('DELETE FROM app.system_owned_bank_accounts WHERE system_account_id = $1::uuid', [accountId]);
        for (const table of ['audit_logs', 'outbox_events', 'system_owned_bank_accounts']) {
          await connection2.query(`ALTER TABLE app.${table} ENABLE TRIGGER USER`);
        }
        await connection2.query('COMMIT');
      } catch (error) {
        await connection2.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        connection2.release();
      }
      // Nothing of this run may remain: the request, the bank record, the topup and the inbox rows are checked to be gone.
      const left = await pool.query<{ n: number }>(
        `SELECT (SELECT count(*) FROM app.wallet_topup_requests WHERE request_id = ANY($1::uuid[]))::int
              + (SELECT count(*) FROM app.wallet_bank_transactions WHERE system_owned_account_id = $2::uuid)::int
              + (SELECT count(*) FROM app.sepay_transfer_inbox WHERE account_number = $3)::int AS n`,
        [requestIds, accountId, accountNumber],
      );
      expect(left.rows[0]).toEqual({ n: 0 });
    } finally {
      await pool.end();
    }
  });

  async function oneRound(index: number): Promise<void> {
    const requestId = randomUUID();
    await requests.insertPending(autoCtx(), { requestId, walletId, driverId, amountVnd: BigInt(AMOUNT), createdByUserId: userId });
    requestIds.push(requestId);
    const code = topupTransferCodeOf(requestId);
    const reference = `FTRACE${randomUUID().slice(0, 8).toUpperCase()}${index}`;
    references.push(reference);
    const transactionDate = `2026-11-22 09:${String(10 + index).padStart(2, '0')}:00`;
    const eventId = randomInt(4_300_000_000 + index * 1_000_000, 4_300_000_000 + index * 1_000_000 + 900_000);
    inboxEventIds.push(eventId);
    const raw = Buffer.from(
      JSON.stringify({ id: eventId, gateway: 'MBBank', transactionDate, accountNumber, subAccount: '', code, content: `${code} chuyen tien`, transferType: 'in', description: '', transferAmount: AMOUNT, accumulated: 0, referenceCode: reference }),
      'utf8',
    );
    const apiRow = parseSepayApiTransaction({
      id: randomUUID(), transaction_date: `${transactionDate.replace(' ', 'T')}+07:00`, account_number: accountNumber, va: '', transfer_type: 'in', amount_in: AMOUNT, amount_out: 0,
      accumulated: 0, transaction_content: `${code} chuyen tien`, reference_number: reference, code, bank_brand_name: 'MBBank', bank_account_id: accountId, va_id: null, webhook_success: 1,
    });
    if (apiRow === undefined) throw new Error('fixture is not a valid transactions-API row');
    const config = readSepayConfig(ENV);
    const balanceBefore = Number((await pool.query<{ b: string }>('SELECT balance_vnd::text AS b FROM app.driver_wallets WHERE wallet_id = $1::uuid', [walletId])).rows[0]!.b);

    // The three sides start together; each commits (or refuses) on its own connection.
    const [webhook, reconciliation, admin] = await Promise.all([
      inOwnTransaction((context) => new SepayWebhookService({ withTransaction: (work: (c: TransactionContext) => Promise<unknown>) => work(context) } as never, settlement()).receive(signed(raw))),
      inOwnTransaction((context) => settlement().settle(context, apiRow, config)),
      inOwnTransaction(async (context) => {
        // The admin path's order: the Shipper root, the wallet, the request; the request state is read under its lock.
        const driver = await drivers.lockById(context, driverId);
        if (driver === undefined) throw new AppError('DRIVER_NOT_FOUND');
        if (!(await posting.lockWalletOf(context, walletId, driverId))) throw new AppError('TOPUP_REQUEST_NOT_FOUND');
        const current = await requests.lockById(context, requestId);
        if (current === undefined || current.state !== 'PENDING') throw new AppError('TOPUP_REQUEST_STATE_CONFLICT');
        await posting.creditTopup(context, { walletId, driverId, requestId, bankId: BANK_ID, systemAccountId: accountId, canonicalTransactionId: reference, actualAmountVnd: BigInt(AMOUNT), receivedAtIso: `2026-11-22T09:${String(10 + index).padStart(2, '0')}:00+07:00`, settledBy: { kind: 'ADMIN', userId } });
        await requests.resolve(context, requestId, current.version, 'CONFIRMED', { kind: 'ADMIN', userId });
        return true;
      }),
    ]);

    // Webhook and reconciliation are automatic: they must succeed, never deadlock, never fail on the race itself.
    expect(webhook.ok).toBe(true);
    expect(reconciliation.ok).toBe(true);
    // The administrator may lose the race; its refusal is one of the documented codes (a deadlock or any other error is a failure).
    if (!admin.ok) {
      expect(admin.error).toBeInstanceOf(AppError);
      expect(['BANK_TRANSACTION_ALREADY_RECORDED', 'TOPUP_REQUEST_STATE_CONFLICT']).toContain((admin.error as AppError).code);
    }

    // Exactly one credit, whoever won.
    const topups = (await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM app.wallet_topups WHERE request_id = $1::uuid', [requestId])).rows[0]!;
    expect(topups.n).toBe(1);
    const bankRecords = (await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM app.wallet_bank_transactions WHERE canonical_transaction_id = $1 AND system_owned_account_id = $2::uuid', [reference, accountId])).rows[0]!;
    expect(bankRecords.n).toBe(1);
    const ledger = (await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM app.wallet_ledger_entries l JOIN app.wallet_topups t ON t.topup_id = l.topup_id WHERE t.request_id = $1::uuid AND l.entry_kind = 'TOPUP'", [requestId])).rows[0]!;
    expect(ledger.n).toBe(1);
    const balanceAfter = Number((await pool.query<{ b: string }>('SELECT balance_vnd::text AS b FROM app.driver_wallets WHERE wallet_id = $1::uuid', [walletId])).rows[0]!.b);
    expect(balanceAfter - balanceBefore).toBe(AMOUNT);
    // The request is CONFIRMED exactly once and the evidence of the transfer is one row, CREDITED or LINKED, both to this request.
    expect((await pool.query<{ state: string }>('SELECT state FROM app.wallet_topup_requests WHERE request_id = $1::uuid', [requestId])).rows[0]).toEqual({ state: 'CONFIRMED' });
    const evidence = (await pool.query<{ n: number; state: string; topup_request_id: string | null }>(
      'SELECT count(*)::int AS n, min(state) AS state, min(topup_request_id::text) AS topup_request_id FROM app.sepay_transfer_inbox WHERE reference_code = $1 AND account_number = $2',
      [reference, accountNumber],
    )).rows[0]!;
    expect(evidence.n).toBe(1);
    expect(['CREDITED', 'LINKED']).toContain(evidence.state);
    expect(evidence.topup_request_id).toBe(requestId);
    // Which side won, for the record of this run (diagnostic only).
    console.log(`race round ${index}: evidence=${evidence.state} admin=${admin.ok ? "credited" : (admin.error as AppError).code} webhook=${webhook.ok ? "ok" : "failed"} reconciliation=${reconciliation.ok ? "ok" : "failed"}`);
    // No orphan: every bank record of this transfer points at a topup of the same request.
    const orphans = (await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM app.wallet_bank_transactions b WHERE b.canonical_transaction_id = $1 AND NOT EXISTS (SELECT 1 FROM app.wallet_topups t WHERE t.bank_record_id = b.bank_record_id)', [reference])).rows[0]!;
    expect(orphans.n).toBe(0);
  }

  it(`${ROUNDS} rounds of the three-way race: one credit per transfer, no deadlock, no orphan`, async () => {
    for (let index = 0; index < ROUNDS; index += 1) {
      await oneRound(index);
    }
    // The wallet balance equals the sum of its ledger (the database invariant), after every round.
    const invariant = (await pool.query<{ ok: boolean }>('SELECT (SELECT balance_vnd FROM app.driver_wallets WHERE wallet_id = $1::uuid) = (SELECT coalesce(sum(delta_vnd), 0) FROM app.wallet_ledger_entries WHERE wallet_id = $1::uuid) AS ok', [walletId])).rows[0];
    expect(invariant).toEqual({ ok: true });
  }, 120000);
});
