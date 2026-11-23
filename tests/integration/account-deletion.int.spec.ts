import { m14RouteAnswer } from './support/m14-fake-route';
import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';
import { AddressInfo } from 'node:net';
// The real module object (not a namespace copy), so the Argon2 operations can be counted.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import argon2 = require('argon2');
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { PoolClient } from 'pg';
import { AccountDeletionService } from '../../apps/backend/src/account-deletion/account-deletion-service';
import { OTP_QUOTA_PURPOSES } from '../../apps/backend/src/auth/auth-constants';
import type { OtpDelivery } from '../../apps/backend/src/auth/otp-provider';
import { AccountDeletionSweeper } from '../../apps/backend/src/account-deletion/account-deletion-sweeper';
import { AccountDeletionLimiter } from '../../apps/backend/src/account-deletion/account-deletion-limiter';
import { DEFAULT_ACCOUNT_DELETION_CONFIG } from '../../apps/backend/src/config/account-deletion-config';
import { M14_ROUTING } from '../../apps/backend/src/delivery/m14-route-client';
import { TransactionManager } from '../../apps/backend/src/transaction/transaction-manager';
import { ApiResponse, AuthApp, countRows, dataOf, errorCode, obtainProof, PASSWORD, rowLockWaitersRunning, startAuthApp } from './support/auth-fixtures';
import { insertDeliveryRow } from './support/delivery-fixtures';
import {
  cleanupOrders,
  codeOf,
  Customer,
  Dish,
  Json,
  newCustomer,
  newDish,
  newShipper,
  openAllWeek,
  PRIVACY,
  Shipper,
  TERMS,
  WEB_FOOD,
  WEB_SHIP,
} from './support/m10-fixtures';
import { createShopOwner, ShopOwner } from './support/shop-management-fixtures';

// P5-6a (Owner decision OD-26) on the REAL Nest pipeline and a REAL PostgreSQL (TEST database only): the owner's public account deletion
// (POST /v1/account-deletion/confirm and the page /delete-account), its separate quota, the generic authentication error, the pending state
// (every entry that starts NEW work refuses, the running work is finished), the sweeper that finishes a pending request exactly once, and the
// races between the confirmation and the work it must not lose.

const PUBLIC_ORIGIN = 'https://delete.example.test';

describe('P5-6a public account deletion', () => {
  let app: AuthApp;
  let router: http.Server;
  let shop: ShopOwner;
  let dish: Dish;
  let addedPolicy = false;
  let policyVersion = 1;
  const drivers: string[] = [];
  const extraShops: string[] = [];
  const extraUsers: string[] = [];
  const extraCustomers: string[] = [];

  beforeAll(async () => {
    router = http.createServer((request, response) => {
      request.resume();
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(m14RouteAnswer(2.5, 420)));
    });
    await new Promise<void>((resolve) => router.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(router.address() as AddressInfo).port}`;
    app = await startAuthApp(
      {},
      {
        relaxTimeouts: true,
        configOverride: {
          clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY },
          accountRecoveryMode: 'SMS_OTP',
          // The address budget is lifted for the many requests of this suite (all from one loopback address); the phone budget is the default 5/15 min.
          accountDeletion: { ...DEFAULT_ACCOUNT_DELETION_CONFIG, publicOrigin: PUBLIC_ORIGIN, ip: { limit: 10_000, windowSeconds: 600 } },
        },
        overrides: [{ provide: M14_ROUTING, useValue: { origin, timeoutMs: 3000 } }],
      },
    );
    shop = await createShopOwner(app);
    await openAllWeek(app, shop.shopId);
    dish = await newDish(app, shop.token, 'Phở bò', 45_000);
    const existing = await app.pool.query('SELECT 1 FROM app.shipping_fee_policy_versions LIMIT 1');
    if ((existing.rowCount ?? 0) === 0) {
      await app.pool.query(
        `INSERT INTO app.shipping_fee_policy_versions (version_id, version_no, schema_version, tiers, applied_by, applied_at) VALUES ($1::uuid, 1, 2, $2::jsonb, $3::uuid, now())`,
        [randomUUID(), JSON.stringify([{ from_m: 0, to_m: 3000, fee_vnd: 10000 }, { from_m: 3000, to_m: 6000, fee_vnd: 15000 }, { from_m: 6000, to_m: 10000, fee_vnd: 20000 }]), shop.userId],
      );
      addedPolicy = true;
    }
    const activePolicy = await app.pool.query<{ version_no: string }>('SELECT version_no::text AS version_no FROM app.shipping_fee_policy_versions ORDER BY version_no DESC LIMIT 1');
    policyVersion = Number(activePolicy.rows[0]?.version_no ?? 1);
  }, 300_000);

  /**
   * The WITHDRAWALS the OD-31 tests committed (events, the hold, the withdrawal itself) are append-only history: removed here with the guards of exactly
   * those tables lifted for one transaction, before the generic cleanup, so no other suite finds them (M04 asserts an empty hold table).
   */
  // Complaints, their messages and pictures, and reviews with their replies reference orders and shops; they are never deleted by the product, so
  // this suite's own rows are removed here (the table triggers are off for this cleanup only), before the orders are removed.
  async function purgeCommunityRecords(userIds: readonly string[]): Promise<void> {
    const client = await app.pool.connect();
    // Round 3: the reconsiderations (of the complaints) and the moderations (of the reviews) reference their parents, so they go first.
    const tables = ['complaint_attachments', 'complaint_messages', 'complaint_reconsiderations', 'complaints', 'review_moderations', 'review_reply_history', 'review_replies', 'reviews'];
    try {
      await client.query('BEGIN');
      for (const table of tables) await client.query(`ALTER TABLE app.${table} DISABLE TRIGGER USER`);
      const complaints = 'SELECT complaint_id FROM app.complaints WHERE submitter_user_id = ANY($1::uuid[])';
      const reviews = 'SELECT review_id FROM app.reviews WHERE reviewer_user_id = ANY($1::uuid[])';
      await client.query(`DELETE FROM app.complaint_attachments WHERE uploader_user_id = ANY($1::uuid[]) OR complaint_id IN (${complaints})`, [userIds]);
      await client.query(`DELETE FROM app.complaint_messages WHERE complaint_id IN (${complaints})`, [userIds]);
      await client.query(`DELETE FROM app.complaint_reconsiderations WHERE complaint_id IN (${complaints}) OR requested_by = ANY($1::uuid[])`, [userIds]);
      await client.query(`DELETE FROM app.complaints WHERE submitter_user_id = ANY($1::uuid[])`, [userIds]);
      await client.query(`DELETE FROM app.review_moderations WHERE review_id IN (${reviews})`, [userIds]);
      await client.query(`DELETE FROM app.review_reply_history WHERE review_id IN (${reviews})`, [userIds]);
      await client.query(`DELETE FROM app.review_replies WHERE review_id IN (${reviews})`, [userIds]);
      await client.query(`DELETE FROM app.reviews WHERE reviewer_user_id = ANY($1::uuid[])`, [userIds]);
      for (const table of tables) await client.query(`ALTER TABLE app.${table} ENABLE TRIGGER USER`);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async function purgeWithdrawalsOf(driverIds: readonly string[]): Promise<void> {
    if (driverIds.length === 0) return;
    const client = await app.pool.connect();
    try {
      await client.query('BEGIN');
      const tables = ['wallet_withdrawal_events', 'wallet_withdrawals', 'wallet_ledger_entries', 'wallet_bank_transactions'];
      for (const table of tables) await client.query(`ALTER TABLE app.${table} DISABLE TRIGGER USER`);
      await client.query('ALTER TABLE app.wallet_holds DISABLE TRIGGER wallet_holds_no_delete');
      const owned = 'SELECT withdrawal_id FROM app.wallet_withdrawals WHERE wallet_id IN (SELECT wallet_id FROM app.driver_wallets WHERE driver_id = ANY($1::uuid[]))';
      await client.query(`DELETE FROM app.wallet_withdrawal_events WHERE withdrawal_id IN (${owned})`, [driverIds]);
      await client.query(`DELETE FROM app.wallet_bank_transactions WHERE withdrawal_id IN (${owned})`, [driverIds]);
      await client.query(`DELETE FROM app.wallet_ledger_entries WHERE withdrawal_id IN (${owned})`, [driverIds]);
      await client.query(`DELETE FROM app.wallet_holds WHERE withdrawal_id IN (${owned})`, [driverIds]);
      await client.query('DELETE FROM app.wallet_withdrawals WHERE wallet_id IN (SELECT wallet_id FROM app.driver_wallets WHERE driver_id = ANY($1::uuid[]))', [driverIds]);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      await client.query('ALTER TABLE app.wallet_holds ENABLE TRIGGER wallet_holds_no_delete');
      for (const table of tables) await client.query(`ALTER TABLE app.${table} ENABLE TRIGGER USER`);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  afterAll(async () => {
    // The first cleanup error is kept: closing the application must not replace it.
    let cleanupError: unknown;
    try {
      await purgeWithdrawalsOf(drivers);
      await app.pool.query('DELETE FROM app.account_deletion_requests WHERE user_id = ANY($1::uuid[]) OR user_id IN (SELECT user_id FROM app.users WHERE anonymized_at IS NOT NULL)', [[...extraCustomers, ...extraUsers]]);
      await purgeCommunityRecords([shop.userId, ...extraUsers, ...extraCustomers]);
      // Every customer that ordered at this suite's shops (some were not tracked above): their orders go with the shops.
      const orderers = (await app.pool.query<{ customer_user_id: string }>('SELECT DISTINCT customer_user_id FROM app.orders WHERE shop_id = ANY($1::uuid[])', [[shop.shopId, ...extraShops]])).rows.map((row) => row.customer_user_id);
      await cleanupOrders(app, {
        shopIds: [shop.shopId, ...extraShops],
        customerIds: [...new Set([...extraCustomers, ...orderers])],
        drivers,
        userIds: [shop.userId, ...extraUsers, ...extraCustomers],
        policyAdded: addedPolicy,
      });
    } catch (error) {
      cleanupError = error;
    }
    try {
      await app.close();
      await new Promise<void>((resolve) => router.close(() => resolve()));
    } finally {
      if (cleanupError !== undefined) {
        throw cleanupError;
      }
    }
  });

  beforeEach(async () => {
    await app.pool.query('DELETE FROM app.account_delete_limits');
  });

  // ---- helpers ---------------------------------------------------------------------------------------------------------------------

  const confirm = (phone: { local: string }, password: string = PASSWORD, key: string | null = randomUUID(), headers: Record<string, string> = {}): Promise<ApiResponse> =>
    app.call('POST', '/account-deletion/confirm', { headers: { ...(key === null ? {} : { 'idempotency-key': key }), ...headers }, body: { phone: phone.local, password } });
  const login = (phone: { local: string }, password: string = PASSWORD): Promise<ApiResponse> =>
    app.call('POST', '/client-auth/login', { headers: { 'idempotency-key': randomUUID() }, body: { phone: phone.local, password, device: { device_id: 'web-food-0010', platform: 'WEB', app: 'FOOD' } } });
  const me = (token: string): Promise<ApiResponse> => app.call('GET', '/client-auth/me', { bearer: token });
  const resultOf = (response: ApiResponse): unknown => response.body.data?.result;
  /**
   * The owner's erasure from the signed-in app (Owner order 2026-11-23): sign in, a one-time code to the phone, the code confirmed, then the
   * erasure job. Answers DELETED once the account is anonymized, otherwise what the step answered.
   */
  const ageChallenges = (normalizedPhone: string): Promise<unknown> =>
    withoutTriggers(['phone_verifications'], (q) =>
      q.query("UPDATE app.phone_verifications SET created_at = created_at - interval '1 hour', expires_at = expires_at - interval '1 hour' WHERE phone_normalized = $1", [normalizedPhone]),
    );
  const erase = async (phone: { local: string; normalized?: string }, acceptForfeit = true): Promise<unknown> => {
    const normalized = phone.normalized ?? `+84${phone.local.slice(1)}`;
    await ageChallenges(normalized);
    const signedIn = await login({ local: phone.local });
    const token = String(signedIn.body.data?.access_token);
    const precheck = await app.call('GET', '/account/deletion/precheck', { bearer: token });
    const consent = { accept_forfeit: acceptForfeit, forfeit_vnd: String(precheck.body.data?.forfeit_vnd ?? '0') };
    const code = await app.call('POST', '/account/deletion/code', { bearer: token, body: consent });
    if (code.status !== 200) return codeOf(code) ?? code.status;
    const otp = app.provider.lastOtpFor(normalized);
    const verificationId = String(code.body.data?.verification_id);
    const done = await app.call('POST', '/account/deletion/confirm', { bearer: token, body: { verification_id: verificationId, otp, ...consent } });
    if (done.status !== 200) return codeOf(done) ?? done.status;
    await sweeper().sweep();
    const request = (await app.pool.query<{ user_id: string }>('SELECT user_id FROM app.account_deletion_requests WHERE verification_id = $1::uuid', [verificationId])).rows[0];
    if (request === undefined) return 'NO_REQUEST';
    const gone = (await app.pool.query<{ gone: boolean }>('SELECT anonymized_at IS NOT NULL AS gone FROM app.users WHERE user_id = $1::uuid', [request.user_id])).rows[0];
    return gone?.gone === true ? 'DELETED' : 'NOT_ERASED';
  };
  const refused = (response: ApiResponse): { status: number; code: string | undefined } => ({ status: response.status, code: codeOf(response) });
  const customer = async (): Promise<Customer> => {
    const created = await newCustomer(app);
    extraCustomers.push(created.userId);
    return created;
  };
  const userRow = async (id: string): Promise<{ status: string; version: string; lock_reason: string | null; pending: boolean } | undefined> =>
    (
      await app.pool.query<{ status: string; version: string; lock_reason: string | null; pending: boolean }>(
        'SELECT status, version::text, lock_reason, (delete_requested_at IS NOT NULL) AS pending FROM app.users WHERE user_id = $1::uuid',
        [id],
      )
    ).rows[0];
  const audits = (action: string, userId: string): Promise<number> => countRows(app.pool, 'SELECT 1 FROM app.audit_logs WHERE action = $1 AND resource_id = $2', [action, userId]);
  const liveSessions = (userId: string): Promise<number> => countRows(app.pool, 'SELECT 1 FROM app.sessions WHERE user_id = $1::uuid AND revoked_at IS NULL', [userId]);
  const attemptsTotal = async (): Promise<number> => Number((await app.pool.query<{ n: string }>('SELECT COALESCE(sum(attempts), 0)::text AS n FROM app.account_delete_limits')).rows[0]?.n ?? 0);
  const markPending = (userId: string): Promise<unknown> =>
    app.pool.query(`UPDATE app.users SET delete_requested_at = clock_timestamp(), version = version + 1 WHERE user_id = $1::uuid AND status = 'ACTIVE'`, [userId]);
  const sweeper = (): AccountDeletionSweeper => app.running.app.get(AccountDeletionSweeper);

  async function withoutTriggers<T>(tables: readonly string[], run: (q: { query(sql: string, values?: unknown[]): Promise<unknown> }) => Promise<T>): Promise<T> {
    const client = await app.pool.connect();
    try {
      await client.query('BEGIN');
      for (const table of tables) await client.query(`ALTER TABLE app.${table} DISABLE TRIGGER USER`);
      const result = await run(client);
      for (const table of tables) await client.query(`ALTER TABLE app.${table} ENABLE TRIGGER USER`);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  /** A made-up order row (the repository's usual fixture for rows owned by another module). */
  async function insertOrder(customerId: string, shopId: string, status: 'PENDING_CONFIRMATION' | 'PREPARING' | 'COMPLETED'): Promise<string> {
    const orderId = randomUUID();
    // One dish line of 50.000 VND, so the order's amounts equal its lines (the order-invariant trigger checks it whenever the order is written again).
    await withoutTriggers(['orders', 'order_items'], async (q) => {
      await q.query(
        `INSERT INTO app.orders (order_id, code, client_ref, customer_user_id, shop_id, status, shop_name, shop_phone, shop_address_text, recipient_name, recipient_phone, address_text,
           items_original_total_vnd, items_total_vnd, confirmed_at, ended_at, end_actor, created_at, updated_at)
         VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5::uuid, $6::varchar, 'Quán thử', '0900000000', 'Số 1', 'Người nhận', '0912345678', 'Số 2', 50000, 50000,
           CASE WHEN $6::varchar IN ('PREPARING','COMPLETED') THEN now() END, CASE WHEN $6::varchar = 'COMPLETED' THEN now() END, CASE WHEN $6::varchar = 'COMPLETED' THEN 'SHOP' END, now(), now())`,
        [orderId, `#D${orderId.slice(0, 6)}`, randomUUID(), customerId, shopId, status],
      );
      await q.query(
        `INSERT INTO app.order_items (line_id, order_id, line_no, menu_item_id, name, orig_unit_price_vnd, orig_quantity, unit_price_vnd, quantity, created_at)
         VALUES (gen_random_uuid(), $1::uuid, 1, $2::uuid, $3, 50000, 1, 50000, 1, now())`,
        [orderId, dish.itemId, dish.name],
      );
    });
    return orderId;
  }
  // An order that is no longer in progress. CANCELLED_BY_SHOP needs no delivery (a COMPLETED order needs exactly one completed delivery, which
  // these fixtures do not create), so the order-invariant trigger accepts it when the anonymization touches the row.
  const finishOrder = (orderId: string): Promise<unknown> =>
    withoutTriggers(['orders'], (q) =>
      q.query(
        `UPDATE app.orders SET status = 'CANCELLED_BY_SHOP', confirmed_at = COALESCE(confirmed_at, now()), ended_at = now(), end_actor = 'SHOP', end_reason = 'Đơn thử nghiệm kết thúc', version = version + 1 WHERE order_id = $1::uuid`,
        [orderId],
      ),
    );
  const anonymized = async (userId: string): Promise<boolean> =>
    (await countRows(app.pool, 'SELECT 1 FROM app.users WHERE user_id = $1::uuid AND anonymized_at IS NOT NULL', [userId])) === 1;
  /**
   * The wallet is EMPTIED at the database level, the way the money leaves it when the shipper's balance is paid out. The payout itself (bank record,
   * processing owner, paid evidence) is covered by m04-withdrawals and is not modelled here: an open request is closed as CANCELLED_BY_SHIPPER, its
   * hold settled, and balance and held amount are set to zero. Only the gate of the account lifecycle is under test.
   */
  async function emptyWallet(driverId: string): Promise<void> {
    // The database state must stay consistent (the withdrawal and wallet invariants run whenever a withdrawal row is written again): an open
    // request closed as CANCELLED_BY_SHIPPER releases its hold (no debit), and the balance leaves the wallet through ONE ledger debit of the
    // same amount, so balance = ledger sum and the last balance = 0.
    await withoutTriggers(['wallet_withdrawals', 'wallet_holds', 'driver_wallets', 'wallet_ledger_entries'], async (q) => {
      await q.query(
        `UPDATE app.wallet_holds SET status = 'RELEASED', resolved_at = now()
          WHERE status = 'ACTIVE' AND withdrawal_id IN (SELECT withdrawal_id FROM app.wallet_withdrawals WHERE driver_id = $1::uuid)`,
        [driverId],
      );
      await q.query(
        `UPDATE app.wallet_withdrawals SET state = 'CANCELLED', outcome = 'CANCELLED_BY_SHIPPER', resolved_at = now(), version = version + 1,
                resolved_by_user_id = (SELECT user_id FROM app.drivers WHERE driver_id = $1::uuid)
          WHERE driver_id = $1::uuid AND state IN ('PENDING', 'PROCESSING', 'RECONCILIATION')`,
        [driverId],
      );
      await q.query(
        `INSERT INTO app.wallet_ledger_entries (entry_id, wallet_id, sequence_no, entry_kind, delta_vnd, balance_after_vnd, created_at)
         SELECT gen_random_uuid(), w.wallet_id, COALESCE((SELECT max(l.sequence_no) FROM app.wallet_ledger_entries l WHERE l.wallet_id = w.wallet_id), 0) + 1,
                'ADJUSTMENT_DEBIT', -w.balance_vnd, 0, now()
           FROM app.driver_wallets w WHERE w.driver_id = $1::uuid AND w.balance_vnd > 0`,
        [driverId],
      );
      // The deferred foreign-key checks of the inserted row run now, so the table can be re-enabled in this transaction.
      await q.query('SET CONSTRAINTS ALL IMMEDIATE');
      await q.query('UPDATE app.driver_wallets SET balance_vnd = 0, held_vnd = 0 WHERE driver_id = $1::uuid', [driverId]);
    });
  }

  const ADDRESS = { address_text: '12 Phố Huế, Hai Bà Trưng, Hà Nội', lat: 21.0, lng: 105.82 };
  const checkoutBody = (shopId: string = shop.shopId, d: Dish = dish): Json => ({
    client_ref: randomUUID(),
    shop_id: shopId,
    lines: [{ item_id: d.itemId, quantity: 1, unit_price_vnd: d.price }],
    items_total_vnd: d.price,
    recipient_name: 'Người nhận',
    recipient_phone: '0912345678',
    address: ADDRESS,
    expected_quote: { status: 'PRICED', distance_m: 2500, fee_vnd: 10_000, reason: null, policy_version: policyVersion, snapshot: '21,105.8>21,105.82' },
  });
  const placeOrder = (c: Customer, body: Json = checkoutBody()): Promise<ApiResponse> =>
    app.call('POST', '/customers/me/orders', { bearer: c.token, headers: { 'idempotency-key': randomUUID() }, body });

  // ---- the separate quota, the generic error ------------------------------------------------------------------------------------

  it('a wrong password only spends the deletion budget: the sixth attempt is 429, the account is untouched and login (its own budget) still works', async () => {
    const c = await customer();
    const loginBudgetBefore = await countRows(app.pool, 'SELECT 1 FROM app.client_login_limits');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(refused(await confirm(c.phone, 'Wrong-Password-1'))).toEqual({ status: 401, code: 'INVALID_CREDENTIALS' });
    }
    // The budget of the phone is spent: even the CORRECT password is refused now, with the quota error (and nothing is deleted).
    expect(refused(await confirm(c.phone, PASSWORD))).toEqual({ status: 429, code: 'ACCOUNT_DELETE_RATE_LIMITED' });
    expect(await userRow(c.userId)).toMatchObject({ status: 'ACTIVE', lock_reason: null, pending: false });
    expect(await liveSessions(c.userId)).toBeGreaterThan(0);
    // Not a single row of the login quota was written by the deletion attempts, and the login still answers.
    expect(await countRows(app.pool, 'SELECT 1 FROM app.client_login_limits')).toBe(loginBudgetBefore);
    expect((await login(c.phone)).status).toBe(200);
  });

  it('the deletion quota and the login quota are separate tables and separate key spaces: login attempts never spend the deletion budget', async () => {
    const c = await customer();
    await app.pool.query('DELETE FROM app.account_delete_limits');
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await login(c.phone, 'Wrong-Password-1');
    }
    expect(await attemptsTotal()).toBe(0);
    // ... and eight login failures did not take the account's deletion away from its owner.
    expect(await erase(c.phone)).toBe('DELETED');
  });

  it('the two buckets are independent: the address bucket refuses on its own, and so does the phone bucket from many addresses', async () => {
    const transactions = app.running.app.get(TransactionManager);
    const key = { hmacSha256Hex: (message: string): string => createHash('sha256').update(message).digest('hex') };
    const limiter = new AccountDeletionLimiter(transactions, { auth: { otpHmacKey: key }, accountDeletion: { ...DEFAULT_ACCOUNT_DELETION_CONFIG, ip: { limit: 2, windowSeconds: 600 } } } as never);
    await limiter.reserve('10.0.0.1', '0911111111');
    await limiter.reserve('10.0.0.1', '0922222222');
    // The third request from the same address is refused although the phone numbers are new...
    await expect(limiter.reserve('10.0.0.1', '0933333333')).rejects.toMatchObject({ code: 'ACCOUNT_DELETE_RATE_LIMITED' });
    // ... another address is fine, until the PHONE budget (5) is spent from many addresses.
    for (let n = 0; n < 5; n += 1) {
      await limiter.reserve(`10.0.1.${n}`, '0944444444');
    }
    await expect(limiter.reserve('10.0.2.1', '0944444444')).rejects.toMatchObject({ code: 'ACCOUNT_DELETE_RATE_LIMITED' });
  });

  it('one generic answer for an unknown phone, a wrong password, a fixture account and an account locked for a violation, with the same counter writes', async () => {
    const wrong = await customer();
    const violation = await customer();
    await app.pool.query(`UPDATE app.users SET status = 'DISABLED', lock_reason = 'VIOLATION', locked_at = now(), version = version + 1 WHERE user_id = $1::uuid`, [violation.userId]);
    const fixture = await customer();
    await app.pool.query(`UPDATE app.users SET account_origin = 'STAGING_FIXTURE', phone_verified_at = NULL WHERE user_id = $1::uuid`, [fixture.userId]);
    const unknown = { local: '0987654321' };

    const answers: Array<{ status: number; code: string | undefined; message: string | undefined; delta: number }> = [];
    for (const [phone, password] of [
      [unknown, PASSWORD],
      [wrong.phone, 'Wrong-Password-1'],
      [fixture.phone, PASSWORD],
      [violation.phone, PASSWORD],
    ] as const) {
      const before = await attemptsTotal();
      const response = await confirm(phone, password);
      answers.push({ status: response.status, code: errorCode(response), message: response.body.error?.message, delta: (await attemptsTotal()) - before });
    }
    // Same status, same code, same message, and exactly two counter increments (address + phone) for every one of them.
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect(answers[0]).toEqual({ status: 401, code: 'INVALID_CREDENTIALS', message: 'The phone number or password is not correct', delta: 2 });
    // A violation lock is not undone, purged or even reported: the row is exactly as it was.
    expect(await userRow(violation.userId)).toMatchObject({ status: 'DISABLED', lock_reason: 'VIOLATION', pending: false });
  });

  it('refuses malformed input before the budget is touched, and a browser from another origin before anything is read', async () => {
    const c = await customer();
    expect((await app.call('POST', '/account-deletion/confirm', { headers: { 'idempotency-key': randomUUID() }, body: { phone: c.phone.local, password: PASSWORD, role: 'ADMIN' } })).status).toBe(400);
    expect((await app.call('POST', '/account-deletion/confirm', { headers: { 'idempotency-key': randomUUID() }, body: { phone: c.phone.local } })).status).toBe(400);
    expect((await confirm(c.phone, PASSWORD, null)).status).toBe(400);
    expect(await attemptsTotal()).toBe(0);
    expect(refused(await confirm(c.phone, PASSWORD, randomUUID(), { origin: 'https://evil.example.test' }))).toMatchObject({ status: 403 });
    expect(await attemptsTotal()).toBe(0);
    // The configured origin passes (here the wrong password answers the generic error), and so does a client that sends no Origin at all.
    expect(refused(await confirm(c.phone, 'Wrong-Password-1', randomUUID(), { origin: PUBLIC_ORIGIN }))).toEqual({ status: 401, code: 'INVALID_CREDENTIALS' });
    expect(await userRow(c.userId)).toMatchObject({ status: 'ACTIVE', pending: false });
  });

  // ---- the immediate outcomes ----------------------------------------------------------------------------------------------------

  it('the password path only LOCKS the account (Owner order 2026-11-23): sessions revoked, nothing anonymized; the same key answers again without a second effect', async () => {
    const c = await customer();
    const orderId = await insertOrder(c.userId, shop.shopId, 'PREPARING');
    await finishOrder(orderId);
    const key = randomUUID();
    const done = await confirm(c.phone, PASSWORD, key);
    expect([done.status, resultOf(done)]).toEqual([200, 'LOCKED']);
    expect(await userRow(c.userId)).toMatchObject({ status: 'DISABLED', lock_reason: 'DELETE_REQUEST', pending: false });
    expect(await anonymized(c.userId)).toBe(false);
    expect(await liveSessions(c.userId)).toBe(0);
    expect((await me(c.token)).status).toBe(401);
    expect(await audits('account.delete.finalized.v1', c.userId)).toBe(1);
    expect(resultOf(await confirm(c.phone, PASSWORD, key))).toBe('LOCKED');
    expect(await audits('account.delete.finalized.v1', c.userId)).toBe(1);
  });

  it('money and orders to keep, nothing in progress: the account is anonymized, the order keeps its money, state and recipient snapshot', async () => {
    const c = await customer();
    const orderId = await insertOrder(c.userId, shop.shopId, 'PREPARING');
    await finishOrder(orderId);
    const before = (await app.pool.query('SELECT status, recipient_name, recipient_phone, shop_name FROM app.orders WHERE order_id = $1::uuid', [orderId])).rows[0];
    expect(await erase(c.phone)).toBe('DELETED');
    expect(await userRow(c.userId)).toMatchObject({ status: 'DISABLED', lock_reason: 'DELETE_REQUEST', pending: false });
    expect(await anonymized(c.userId)).toBe(true);
    expect(await liveSessions(c.userId)).toBe(0);
    expect((await me(c.token)).status).toBe(401);
    const order = (await app.pool.query<{ status: string; recipient_name: string; recipient_phone: string; shop_name: string }>(
      'SELECT status, recipient_name, recipient_phone, shop_name FROM app.orders WHERE order_id = $1::uuid',
      [orderId],
    )).rows[0];
    expect(order).toEqual(before);
    expect(await countRows(app.pool, `SELECT 1 FROM app.user_roles WHERE user_id = $1::uuid`, [c.userId])).toBeGreaterThan(0);
    expect(await audits('account.delete.finalized.v1', c.userId)).toBe(1);
    // A retry (same key, or a new one) is answered; nothing is written twice.
    expect(refused(await confirm(c.phone, PASSWORD, randomUUID()))).toEqual({ status: 401, code: 'INVALID_CREDENTIALS' });
    expect(await audits('account.delete.finalized.v1', c.userId)).toBe(1);
  });

  // ---- pending ------------------------------------------------------------------------------------------------------------------


  it('the account of a pending SHOP OWNER takes no new orders, starts no delivery of its own; its existing orders are finished normally', async () => {
    const owner = await createShopOwner(app);
    extraShops.push(owner.shopId);
    extraUsers.push(owner.userId);
    await openAllWeek(app, owner.shopId);
    const ownerDish = await newDish(app, owner.token, 'Bún chả', 40_000);
    const buyer = await customer();
    const earlier = await placeOrder(buyer, checkoutBody(owner.shopId, ownerDish));
    expect(earlier.status).toBe(201);
    const earlierId = String(dataOf(earlier).order_id);
    await markPending(owner.userId);

    // Another customer cannot order from the shop any more (it reads like a locked owner) ...
    const other = await customer();
    expect(refused(await placeOrder(other, checkoutBody(owner.shopId, ownerDish)))).toEqual({ status: 409, code: 'ORDER_SHOP_NOT_OPEN' });
    // ... the shop cannot recall a delivery or open a payment request ...
    const recallable = await insertDeliveryRow(app.pool, { shopId: owner.shopId, userId: owner.userId });
    // (A shop-created DIRECT delivery cannot be recalled at all since OD-5; the gate is reached by an order-linked one.)
    await app.pool.query('ALTER TABLE app.deliveries DISABLE TRIGGER USER');
    await app.pool.query("UPDATE app.deliveries SET source = 'ORDER', order_id = $1::uuid WHERE delivery_id = $2::uuid", [earlierId, recallable]);
    await app.pool.query('ALTER TABLE app.deliveries ENABLE TRIGGER USER');
    expect(refused(await app.call('POST', `/shop/me/deliveries/${recallable}/recall`, { bearer: owner.token, headers: { 'idempotency-key': randomUUID() }, body: {} }))).toEqual({ status: 409, code: 'ACCOUNT_DELETE_PENDING' });
    // (The shop payment request route is wired with the Administration routes, not in this application: its gate is pinned by new-work-gate.spec.ts.)
    // ... but the order it already has is confirmed and read as usual.
    const view = await app.call('GET', `/shop/me/orders/${earlierId}`, { bearer: owner.token });
    expect(view.status).toBe(200);
    expect((await app.call('POST', `/shop/me/orders/${earlierId}/confirm`, { bearer: owner.token, headers: { 'idempotency-key': randomUUID() }, body: { expected_version: dataOf(view).version } })).status).toBe(200);
  });

  // ---- OD-31: the owner who asked for the deletion keeps the WITHDRAWAL to get the balance back ----------------------------------

  const phoneOf = async (userId: string): Promise<{ local: string }> => {
    const normalized = String((await app.pool.query<{ p: string }>('SELECT phone_normalized AS p FROM app.users WHERE user_id = $1::uuid', [userId])).rows[0]?.p);
    return { local: `0${normalized.slice(3)}` };
  };
  const shipLogin = (phone: { local: string }): Promise<ApiResponse> =>
    app.call('POST', '/client-auth/login', { headers: { 'idempotency-key': randomUUID() }, body: { phone: phone.local, password: PASSWORD, device: { ...WEB_SHIP } } });
  const withdraw = (token: string, amount: number): Promise<ApiResponse> =>
    app.call('POST', '/driver/wallet/withdrawals', { bearer: token, headers: { 'idempotency-key': randomUUID() }, body: { amount_vnd: amount } });
  const walletOf = async (driverId: string): Promise<{ balance: string; held: string } | undefined> =>
    (await app.pool.query<{ balance: string; held: string }>('SELECT balance_vnd::text AS balance, held_vnd::text AS held FROM app.driver_wallets WHERE driver_id = $1::uuid', [driverId])).rows[0];

  it('OD-31 (a): a PENDING Shipper (not CLOSING) withdraws the WHOLE balance; a partial amount and a second request are refused; a top-up stays refused', async () => {
    const shipper = await newShipper(app, drivers, 50_000);
    extraUsers.push(shipper.userId);
    await markPending(shipper.userId);
    expect(refused(await withdraw(shipper.token, 20_000))).toEqual({ status: 409, code: 'WITHDRAWAL_INSUFFICIENT_AVAILABLE' });
    const created = await withdraw(shipper.token, 50_000);
    expect(created.status).toBe(201);
    expect(await walletOf(shipper.driverId)).toEqual({ balance: '50000', held: '50000' });
    // One open request only: the second is refused whatever its amount.
    expect(refused(await withdraw(shipper.token, 50_000)).status).toBeGreaterThanOrEqual(400);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.wallet_withdrawals WHERE driver_id = $1::uuid', [shipper.driverId])).toBe(1);
    // ... and the top-up is still gated.
    expect(refused(await app.call('POST', '/driver/wallet/topup-requests', { bearer: shipper.token, headers: { 'idempotency-key': randomUUID() }, body: { amount_vnd: 100_000 } }))).toEqual({ status: 409, code: 'ACCOUNT_DELETE_PENDING' });
  });


  it('OD-31 (d): a Shipper locked for VIOLATION or SECURITY gets NO exception: the withdrawal is still CLOSING-only', async () => {
    for (const reason of ['VIOLATION', 'SECURITY']) {
      const shipper = await newShipper(app, drivers, 50_000);
      extraUsers.push(shipper.userId);
      const phone = await phoneOf(shipper.userId);
      await app.pool.query(`UPDATE app.users SET status = 'DISABLED', lock_reason = $2, locked_at = now(), version = version + 1 WHERE user_id = $1::uuid`, [shipper.userId, reason]);
      await app.pool.query('UPDATE app.sessions SET revoked_at = now() WHERE user_id = $1::uuid AND revoked_at IS NULL', [shipper.userId]);
      const signedIn = await shipLogin(phone);
      expect(signedIn.status).toBe(200);
      const token = String(dataOf(signedIn).access_token);
      expect(refused(await withdraw(token, 50_000))).toEqual({ status: 409, code: 'WITHDRAWAL_ONLY_WHEN_CLOSING' });
      expect(await walletOf(shipper.driverId)).toEqual({ balance: '50000', held: '0' });
    }
  });


  // ---- Codex review: Argon2 work of every refusal, the phone alias bucket, the 503 atomicity, the administrative lock -----------

  it('every refusal (unknown phone, wrong password, locked VIOLATION, administration account, fixture) does ZERO hashing and exactly ONE Argon2 verification', async () => {
    const wrong = await customer();
    const violation = await customer();
    await app.pool.query(`UPDATE app.users SET status = 'DISABLED', lock_reason = 'VIOLATION', locked_at = now(), version = version + 1 WHERE user_id = $1::uuid`, [violation.userId]);
    const fixture = await customer();
    await app.pool.query(`UPDATE app.users SET account_origin = 'STAGING_FIXTURE', phone_verified_at = NULL WHERE user_id = $1::uuid`, [fixture.userId]);
    // An administration account (scope ADMIN, never found by a client phone lookup).
    const donor = await customer();
    const administration = { phone: { local: `09${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}` }, userId: randomUUID() };
    await app.pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, account_origin, status, version, created_at, updated_at)
       SELECT $1::uuid, $2, password_hash, 'ADMIN_PROVISIONED', 'ACTIVE', 1, now(), now() FROM app.users WHERE user_id = $3::uuid`,
      [administration.userId, `+84${administration.phone.local.slice(1)}`, donor.userId],
    );

    const hashSpy = jest.spyOn(argon2, 'hash');
    const verifySpy = jest.spyOn(argon2, 'verify');
    try {
      const counts: Array<[number, number]> = [];
      for (const [phone, password] of [
        [{ local: '0987654321' }, PASSWORD],
        [wrong.phone, 'Wrong-Password-1'],
        [violation.phone, PASSWORD],
        [administration.phone, PASSWORD],
        [fixture.phone, PASSWORD],
      ] as const) {
        hashSpy.mockClear();
        verifySpy.mockClear();
        expect(refused(await confirm(phone, password))).toEqual({ status: 401, code: 'INVALID_CREDENTIALS' });
        counts.push([hashSpy.mock.calls.length, verifySpy.mock.calls.length]);
      }
      expect(counts).toEqual([[0, 1], [0, 1], [0, 1], [0, 1], [0, 1]]);
    } finally {
      hashSpy.mockRestore();
      verifySpy.mockRestore();
      await app.pool.query('DELETE FROM app.users WHERE user_id = $1::uuid', [administration.userId]);
    }
  });

  it('the same phone written in every accepted way (0..., +84..., 84..., padded) is ONE phone bucket: the aliases cannot reset or multiply the budget', async () => {
    const c = await customer();
    const national = c.phone.local.slice(1);
    const spellings = [c.phone.local, `+84${national}`, `84${national}`, ` ${c.phone.local} `, `+84${national}`];
    for (const spelling of spellings) {
      expect(refused(await confirm({ local: spelling }, 'Wrong-Password-1'))).toEqual({ status: 401, code: 'INVALID_CREDENTIALS' });
    }
    // Five attempts under five spellings spent ONE phone budget (plus the address budget): the sixth, under yet another spelling, is refused.
    expect(await countRows(app.pool, 'SELECT 1 FROM app.account_delete_limits')).toBe(2);
    expect(refused(await confirm({ local: `84${national}` }, PASSWORD))).toEqual({ status: 429, code: 'ACCOUNT_DELETE_RATE_LIMITED' });
    expect(await userRow(c.userId)).toMatchObject({ status: 'ACTIVE', pending: false });
  });


  /** An administrative lock on an account whose deletion is pending (what the Administration lock leaves behind), without the Administration application. */
  const lockedByAdmin = (userId: string, reason: 'VIOLATION' | 'SECURITY'): Promise<unknown> =>
    app.pool.query(`UPDATE app.users SET status = 'DISABLED', lock_reason = $2, locked_at = now(), version = version + 1 WHERE user_id = $1::uuid`, [userId, reason]);



  it('users_delete_request_ck: a request can coexist with an ACTIVE row or a VIOLATION / SECURITY lock, never with the DELETE_REQUEST lock (that lock IS the end of the request)', async () => {
    const c = await customer();
    await app.pool.query(`UPDATE app.users SET status = 'DISABLED', lock_reason = 'DELETE_REQUEST', locked_at = now(), version = version + 1 WHERE user_id = $1::uuid`, [c.userId]);
    await expect(app.pool.query('UPDATE app.users SET delete_requested_at = now() WHERE user_id = $1::uuid', [c.userId])).rejects.toThrow(/users_delete_request_ck/);
  });

  it('a pending Shipper locked for VIOLATION gets no withdrawal exception (only a pending ACTIVE account or the DELETE_REQUEST lock does)', async () => {
    const shipper = await newShipper(app, drivers, 50_000);
    extraUsers.push(shipper.userId);
    const phone = await phoneOf(shipper.userId);
    await markPending(shipper.userId);
    await lockedByAdmin(shipper.userId, 'VIOLATION');
    await app.pool.query('UPDATE app.sessions SET revoked_at = now() WHERE user_id = $1::uuid AND revoked_at IS NULL', [shipper.userId]);
    const token = String(dataOf(await shipLogin(phone)).access_token);
    expect(refused(await withdraw(token, 50_000))).toEqual({ status: 409, code: 'WITHDRAWAL_ONLY_WHEN_CLOSING' });
    expect(await walletOf(shipper.driverId)).toEqual({ balance: '50000', held: '0' });
  });

  it('the account of a pending SHIPPER is offered nothing, takes no delivery, opens no top-up; a new role is not started', async () => {
    const shipper: Shipper = await newShipper(app, drivers);
    extraUsers.push(shipper.userId);
    const waiting = await insertDeliveryRow(app.pool, { shopId: shop.shopId, userId: shop.userId });
    await markPending(shipper.userId);

    const offers = await app.call('GET', '/driver/deliveries/offers', { bearer: shipper.token });
    expect([offers.status, dataOf(offers).offers]).toEqual([200, []]);
    expect(refused(await app.call('POST', `/driver/deliveries/${waiting}/accept`, { bearer: shipper.token, headers: { 'idempotency-key': randomUUID() }, body: {} }))).toEqual({ status: 409, code: 'ACCOUNT_DELETE_PENDING' });
    expect(refused(await app.call('POST', '/driver/wallet/topup-requests', { bearer: shipper.token, headers: { 'idempotency-key': randomUUID() }, body: { amount_vnd: 100_000 } }))).toEqual({ status: 409, code: 'ACCOUNT_DELETE_PENDING' });
    // (A WITHDRAWAL is not gated: OD-31, see the dedicated tests above.)
    // The delivery stays free for everybody else.
    expect(await countRows(app.pool, `SELECT 1 FROM app.deliveries WHERE delivery_id = $1::uuid AND state = 'waiting_driver'`, [waiting])).toBe(1);

    // A pending account does not start a NEW role either.
    const fresh = await customer();
    const shipLogin = await app.call('POST', '/client-auth/login', { headers: { 'idempotency-key': randomUUID() }, body: { phone: fresh.phone.local, password: PASSWORD, device: { ...WEB_SHIP } } });
    expect(shipLogin.status).toBe(200);
    const shipToken = String(dataOf(shipLogin).access_token);
    await markPending(fresh.userId);
    expect(refused(await app.call('POST', '/onboarding/driver', { bearer: shipToken, headers: { 'idempotency-key': randomUUID() }, body: { full_name: 'Nguyễn Văn An', plate_number: '59X1-123.45' } }))).toEqual({ status: 409, code: 'ACCOUNT_DELETE_PENDING' });
    expect(await countRows(app.pool, 'SELECT 1 FROM app.drivers WHERE user_id = $1::uuid', [fresh.userId])).toBe(0);
  });

  // ---- the sweeper ----------------------------------------------------------------------------------------------------------------



  // Owner decision 2026-11-22 (Apple 5.1.1(v)). The case a reviewer can meet: an account with NO order that still holds a saved address, a cart, a
  // push token and a notification. The old rule only locked it (every such row counted as "data to keep"); now it is anonymized and the number is free.
  it('account tokens and profile are removed, other records stay and the number can register a new account', async () => {
    const c = await customer();
    const sessionId = (await app.pool.query<{ session_id: string }>('SELECT session_id FROM app.sessions WHERE user_id = $1::uuid LIMIT 1', [c.userId])).rows[0]?.session_id;
    expect(sessionId).toBeDefined();
    await app.pool.query(`INSERT INTO app.customers (id, user_id) VALUES (gen_random_uuid(), $1::uuid) ON CONFLICT (user_id) DO NOTHING`, [c.userId]);
    await app.pool.query(
      `INSERT INTO app.customer_addresses (id, customer_id, label, recipient_name, contact_phone, address_description, latitude, longitude, is_default, is_active, version, display_name, is_pickup_default, is_delivery_default)
       SELECT gen_random_uuid(), id, 'HOME', 'Người nhận', '+84912345678', '12 Phố Huế, Hà Nội', 21.0, 105.82, true, true, 1, 'Nhà', true, true FROM app.customers WHERE user_id = $1::uuid`,
      [c.userId],
    );
    await app.pool.query(
      `INSERT INTO app.customer_carts (user_id, shop_id, lines, note, version, created_at, updated_at) VALUES ($1::uuid, $2::uuid, '[{"quantity":1}]'::jsonb, 'Ít cay', 1, now(), now())`,
      [c.userId, shop.shopId],
    );
    await app.pool.query(
      `INSERT INTO app.notification_push_tokens (token_id, session_id, user_id, app, provider, token, token_digest, registered_at, last_seen_at)
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'FOOD', 'FCM', 'push-token-for-test', md5(random()::text) || md5(random()::text), now(), now())`,
      [sessionId, c.userId],
    );
    await app.pool.query(
      `INSERT INTO app.notifications (notification_id, recipient_user_id, app, kind, category, title, body, target_type, target_version, dedupe_key, item_count, purge_after, created_at, updated_at)
       VALUES (gen_random_uuid(), $1::uuid, 'FOOD', 'ORDER_UPDATED', 'ORDERS', 'Đơn hàng', 'Nội dung thông báo', 'NONE', 0, md5(random()::text), 1, now() + interval '30 days', now(), now())`,
      [c.userId],
    );
    const addresses = 'SELECT 1 FROM app.customer_addresses a JOIN app.customers k ON k.id = a.customer_id WHERE k.user_id = $1::uuid';
    expect(await countRows(app.pool, addresses, [c.userId])).toBe(1);

    expect(await erase(c.phone)).toBe('DELETED');
    expect(await anonymized(c.userId)).toBe(true);
    expect(await countRows(app.pool, addresses, [c.userId])).toBe(1);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.customer_carts WHERE user_id = $1::uuid', [c.userId])).toBe(1);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.notification_push_tokens WHERE user_id = $1::uuid', [c.userId])).toBe(0);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.notifications WHERE recipient_user_id = $1::uuid', [c.userId])).toBe(1);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.sessions WHERE user_id = $1::uuid', [c.userId])).toBe(0);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.customer_profiles WHERE user_id = $1::uuid', [c.userId])).toBe(0);
    // The tombstone is never signed in to, and the old number no longer finds it.
    expect((await login(c.phone)).status).toBe(401);
    // The real number is released: the same phone registers a NEW account (new id) and signs in normally. The OTP resend cooldown of the
    // earlier verification would last minutes in real life; the test removes that one-time verification row instead of waiting.
    await app.pool.query(`DELETE FROM app.verification_proofs WHERE phone_normalized = $1`, [c.phone.normalized]);
    await app.pool.query(`DELETE FROM app.phone_verifications WHERE phone_normalized = $1`, [c.phone.normalized]);
    const proof = await obtainProof(app, c.phone as unknown as Parameters<typeof obtainProof>[1]);
    const registered = await app.call('POST', '/client-auth/register', {
      headers: { 'idempotency-key': randomUUID() },
      body: { phone: c.phone.local, password: PASSWORD, verification_token: proof.proofToken, device: { ...WEB_FOOD }, full_name: 'Khách đăng ký lại', consent: { terms_version: TERMS, privacy_version: PRIVACY } },
    });
    expect(registered.status).toBe(201);
    expect(String(dataOf(registered).user_id)).not.toBe(c.userId);
    extraCustomers.push(String(dataOf(registered).user_id));
    expect((await login(c.phone)).status).toBe(200);
  });

  // The tombstone cannot be re-enabled: the database refuses an anonymized row that becomes ACTIVE (users_anonymized_ck), whoever writes it.
  it('an anonymized account cannot be unlocked or reactivated: the database refuses it', async () => {
    const c = await customer();
    expect(await erase(c.phone)).toBe('DELETED');
    await expect(app.pool.query(`UPDATE app.users SET status = 'ACTIVE', lock_reason = NULL, locked_at = NULL WHERE user_id = $1::uuid`, [c.userId])).rejects.toMatchObject({ code: '23514' });
    expect(await userRow(c.userId)).toMatchObject({ status: 'DISABLED', lock_reason: 'DELETE_REQUEST' });
  });

  // ---- B (Owner 2026-11-22): every personal record of the account, not only the profile ----------------------------------------------------
  // Each record keeps its row, its money, its state and its time; only the personal text, number or name goes. These cases are red on the
  // code before migration 1798243200000, where those records still carried the data after the deletion.

  it('order and delivery addresses, coordinates, notes and financial snapshots stay intact', async () => {
    const c = await customer();
    const orderId = await insertOrder(c.userId, shop.shopId, 'PREPARING');
    const deliveryId = await insertDeliveryRow(app.pool, { shopId: shop.shopId, userId: c.userId });
    await withoutTriggers(['orders', 'order_items', 'deliveries'], async (q) => {
      await q.query(`UPDATE app.orders SET note = 'Gọi trước 10 phút', delivery_note = 'Để trước cửa, nhà số 12' WHERE order_id = $1::uuid`, [orderId]);
      await q.query(`UPDATE app.order_items SET note = 'Không hành' WHERE order_id = $1::uuid`, [orderId]);
      await q.query(
        `UPDATE app.deliveries SET note = 'Hàng dễ vỡ', dropoff_note = 'Cổng sau, gọi 0912345678', state = 'cancelled_by_system', ended_at = now() WHERE delivery_id = $1::uuid`,
        [deliveryId],
      );
    });
    await finishOrder(orderId);
    const orderQuery = 'SELECT status, paid_vnd::text AS paid, items_total_vnd::text AS total, created_at, address_text, address_lat, address_lng, note, delivery_note FROM app.orders WHERE order_id = $1::uuid';
    const deliveryQuery = 'SELECT state, fee_vnd::text AS fee, created_at, dropoff_address_text, dropoff_lat, dropoff_lng, note, dropoff_note FROM app.deliveries WHERE delivery_id = $1::uuid';
    const itemQuery = 'SELECT note FROM app.order_items WHERE order_id = $1::uuid';
    const orderBefore = (await app.pool.query(orderQuery, [orderId])).rows[0];
    const deliveryBefore = (await app.pool.query(deliveryQuery, [deliveryId])).rows[0];

    expect(await erase(c.phone)).toBe('DELETED');
    expect(await anonymized(c.userId)).toBe(true);
    const orderAfter = (await app.pool.query(orderQuery, [orderId])).rows[0];
    expect(orderAfter).toEqual(orderBefore);
    const deliveryAfter = (await app.pool.query(deliveryQuery, [deliveryId])).rows[0];
    expect(deliveryAfter).toEqual(deliveryBefore);
    expect((await app.pool.query<{ note: string }>(itemQuery, [orderId])).rows.map((row) => row.note)).toEqual(['Không hành']);
  });

  it('order chat history is preserved for both participants', async () => {
    const c = await customer();
    const orderId = await insertOrder(c.userId, shop.shopId, 'PREPARING');
    await finishOrder(orderId);
    const mine = randomUUID();
    const theirs = randomUUID();
    await app.pool.query(
      `INSERT INTO app.order_chat_messages (message_id, room_type, order_id, sender_user_id, sender_role, sender_name, body, client_key, created_at)
       VALUES ($1::uuid, 'ORDER', $2::uuid, $3::uuid, 'CUSTOMER', 'Nguyễn Văn Khách', 'Nhà số 12 ngõ 5, gọi 0912345678', $4::uuid, now() - interval '1 hour'),
              ($5::uuid, 'ORDER', $2::uuid, $6::uuid, 'SHOP', 'Quán thử', 'Quán nhận đơn rồi ạ', $7::uuid, now() - interval '1 hour')`,
      [mine, orderId, c.userId, randomUUID(), theirs, shop.userId, randomUUID()],
    );
    const chatQuery = 'SELECT message_id, body, sender_name, created_at FROM app.order_chat_messages WHERE message_id = $1::uuid';
    const before = (await app.pool.query(chatQuery, [mine])).rows[0];
    const shopBefore = (await app.pool.query(chatQuery, [theirs])).rows[0];

    expect(await erase(c.phone)).toBe('DELETED');
    expect((await app.pool.query(chatQuery, [mine])).rows[0]).toEqual(before);
    expect((await app.pool.query(chatQuery, [theirs])).rows[0]).toEqual(shopBefore);
  });

  it('the pictures the account uploaded for a complaint are deleted at once, fresh or old; the pictures of other people are not touched', async () => {
    const c = await customer();
    const other = await customer();
    const fresh = randomUUID();
    const old = randomUUID();
    const foreign = randomUUID();
    const png = "decode('89504e47', 'hex')";
    await app.pool.query(
      `INSERT INTO app.complaint_attachments (attachment_id, uploader_user_id, content_type, byte_size, data, created_at)
       VALUES ($1::uuid, $4::uuid, 'image/png', 4, ${png}, now()),
              ($2::uuid, $4::uuid, 'image/png', 4, ${png}, now() - interval '3 days'),
              ($3::uuid, $5::uuid, 'image/png', 4, ${png}, now())`,
      [fresh, old, foreign, c.userId, other.userId],
    );
    expect(await erase(c.phone)).toBe('DELETED');
    expect(await countRows(app.pool, 'SELECT 1 FROM app.complaint_attachments WHERE uploader_user_id = $1::uuid', [c.userId])).toBe(0);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.complaint_attachments WHERE attachment_id = $1::uuid', [foreign])).toBe(1);
    // Cleanup of this case only: the other customer's picture is removed here, so the suite can purge that customer at the end.
    await withoutTriggers(['complaint_attachments'], (q) => q.query('DELETE FROM app.complaint_attachments WHERE attachment_id = $1::uuid', [foreign]));
  });


  it('the phone of the account is gone from the OTP records: queued SMS jobs are removed, the verification rows keep their history under a placeholder number', async () => {
    const c = await customer();
    const verificationId = randomUUID();
    await app.pool.query(
      `INSERT INTO app.phone_verifications (verification_id, phone_normalized, purpose, otp_digest, status, attempt_count, expires_at, resend_not_before, invalidated_at, created_at)
       VALUES ($1::uuid, $2, 'REGISTER', $3, 'INVALIDATED', 0, now() + interval '5 minutes', now(), now(), now())`,
      [verificationId, c.phone.normalized, 'a'.repeat(64)],
    );
    await app.pool.query(
      `INSERT INTO app.sms_jobs (job_id, verification_id, purpose, phone_normalized, status, payload_iv, payload_tag, payload_ciphertext, crypto_key_id, created_at, expires_at)
       VALUES (gen_random_uuid(), $1::uuid, 'REGISTER', $2, 'QUEUED', decode(repeat('01', 12), 'hex'), decode(repeat('02', 16), 'hex'), decode('0304', 'hex'), 'test-key', now(), now() + interval '5 minutes')`,
      [verificationId, c.phone.normalized],
    );
    expect(await erase(c.phone)).toBe('DELETED');
    expect(await countRows(app.pool, 'SELECT 1 FROM app.sms_jobs WHERE phone_normalized = $1', [c.phone.normalized])).toBe(0);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.phone_verifications WHERE phone_normalized = $1', [c.phone.normalized])).toBe(0);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.verification_proofs WHERE phone_normalized = $1', [c.phone.normalized])).toBe(0);
    expect(await countRows(app.pool, "SELECT 1 FROM app.phone_verifications WHERE verification_id = $1::uuid AND phone_normalized ~ '^\\+999[0-9]{11}$'", [verificationId])).toBe(1);
  });

  // ---- C (Owner 2026-11-22, second round): the names, texts and metadata that the first round left in other tables -----------------------
  // Each row keeps its id, state and time; only the personal text, name or number goes. Red on the code before this round.

  async function insertComplaint(orderId: string, submitter: string, over: { body: string; shopId?: string; driverId?: string; driverName?: string; closed?: boolean }): Promise<string> {
    const complaintId = randomUUID();
    const closed = over.closed === true;
    await app.pool.query(
      `INSERT INTO app.complaints (complaint_id, code, submitter_user_id, submitter_role, category, order_id, shop_id, driver_id, related_code, shop_name, driver_name,
                                   scope_key, status, received_at, closed_at, close_reason, closure_no, body, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3::uuid, 'CUSTOMER', 'SERVICE', $4::uuid, $5::uuid, $6::uuid, 'K', 'Quán thử', $7, $8::uuid, $9, now(), $10,
               CASE WHEN $9::varchar = 'CLOSED_NO_ACTION' THEN 'Không đủ căn cứ' END, $11, $12, 1, now(), now())`,
      [
        complaintId,
        `C${randomUUID().slice(0, 8).toUpperCase()}`,
        submitter,
        orderId,
        over.shopId ?? shop.shopId,
        over.driverId ?? null,
        over.driverName ?? null,
        randomUUID(),
        closed ? 'CLOSED_NO_ACTION' : 'PENDING',
        closed ? new Date() : null,
        closed ? 1 : 0,
        over.body,
      ],
    );
    return complaintId;
  }

  async function insertComplaintMessage(complaintId: string, author: string, seq: number, body: string): Promise<string> {
    const messageId = randomUUID();
    await app.pool.query(
      `INSERT INTO app.complaint_messages (message_id, complaint_id, seq, kind, visibility, audience_role, author_type, author_user_id, body, created_at)
       VALUES ($1::uuid, $2::uuid, $3, 'APPENDED', 'PARTIES', NULL, 'PARTY', $4::uuid, $5, now() - interval '1 hour')`,
      [messageId, complaintId, seq, author, body],
    );
    return messageId;
  }

  it('complaints: the account\'s own complaint text is replaced, and a shipper name is replaced when that shipper is anonymized; another person\'s complaint text stays', async () => {
    const c = await customer();
    const other = await customer();
    const s = await newShipper(app, drivers, 50_000);
    extraUsers.push(s.userId);
    await emptyWallet(s.driverId);
    const orderId = await insertOrder(c.userId, shop.shopId, 'PREPARING');
    await finishOrder(orderId);
    const own = await insertComplaint(orderId, c.userId, { body: 'Đồ ăn nguội, gọi 0912345678' });
    const foreign = await insertComplaint(orderId, other.userId, { body: 'Shipper giao sai địa chỉ', driverId: s.driverId, driverName: 'Shipper Test' });
    const row = async (id: string): Promise<{ body: string; shop_name: string; driver_name: string | null; status: string; closure_no: number; version: string }> =>
      (await app.pool.query('SELECT body, shop_name, driver_name, status, closure_no, version::text FROM app.complaints WHERE complaint_id = $1::uuid', [id])).rows[0] as never;
    const ownBefore = await row(own);
    expect(await erase(await phoneOf(s.userId))).toBe('DELETED');
    expect(await row(foreign)).toEqual({ body: 'Shipper giao sai địa chỉ', shop_name: 'Quán thử', driver_name: 'Đã ẩn danh', status: 'PENDING', closure_no: 0, version: '2' });
    expect(await erase(c.phone)).toBe('DELETED');
    expect(await row(own)).toEqual({ ...ownBefore, body: 'Đã ẩn danh', version: '2' });
  });

  it('complaint messages: the text the account wrote is replaced; the other party\'s message of the same complaint keeps its text, row and time', async () => {
    const c = await customer();
    const other = await customer();
    const orderId = await insertOrder(c.userId, shop.shopId, 'PREPARING');
    await finishOrder(orderId);
    const complaint = await insertComplaint(orderId, c.userId, { body: 'Nội dung khiếu nại' });
    const mine = randomUUID();
    const theirs = await insertComplaintMessage(complaint, other.userId, 2, 'Chúng tôi đã kiểm tra');
    await app.pool.query(
      `INSERT INTO app.complaint_messages (message_id, complaint_id, seq, kind, visibility, audience_role, author_type, author_user_id, body, created_at)
       VALUES ($1::uuid, $2::uuid, 1, 'SUBMITTED', 'SUBMITTER', NULL, 'SUBMITTER', $3::uuid, 'Số nhà 12, gọi 0912345678', now() - interval '2 hours')`,
      [mine, complaint, c.userId],
    );
    const query = 'SELECT message_id, body, created_at, seq FROM app.complaint_messages WHERE message_id = $1::uuid';
    const before = (await app.pool.query(query, [mine])).rows[0];
    const otherBefore = (await app.pool.query(query, [theirs])).rows[0];
    expect(await erase(c.phone)).toBe('DELETED');
    expect((await app.pool.query(query, [mine])).rows[0]).toEqual({ ...before, body: 'Đã ẩn danh' });
    expect((await app.pool.query(query, [theirs])).rows[0]).toEqual(otherBefore);
  });

  it('review text and reviewer name are hidden, while shop replies and history stay intact', async () => {
    const c = await customer();
    const orderId = await insertOrder(c.userId, shop.shopId, 'PREPARING');
    await finishOrder(orderId);
    const review = randomUUID();
    await app.pool.query(
      `INSERT INTO app.reviews (review_id, kind, reviewer_user_id, shop_id, order_id, stars, comment, reviewer_name, shop_name, related_code, visibility, version, created_at)
       VALUES ($1::uuid, 'SHOP_BY_CUSTOMER', $2::uuid, $3::uuid, $4::uuid, 4, 'Đồ ăn ngon', 'Nguyễn Khách', 'Quán thử', 'R1', 'VISIBLE', 1, now())`,
      [review, c.userId, shop.shopId, orderId],
    );
    await app.pool.query(
      `INSERT INTO app.review_replies (review_id, shop_id, body, version, created_at, updated_at) VALUES ($1::uuid, $2::uuid, 'Cảm ơn anh Nguyễn Khách', 1, now(), now())`,
      [review, shop.shopId],
    );
    await app.pool.query(
      `INSERT INTO app.review_reply_history (review_id, version, body, written_by, written_at) VALUES ($1::uuid, 1, 'Cảm ơn anh Nguyễn Khách', $2::uuid, now())`,
      [review, shop.userId],
    );
    const reviewQuery = 'SELECT reviewer_name, comment, stars, version::text FROM app.reviews WHERE review_id = $1::uuid';
    const reviewBefore = (await app.pool.query(reviewQuery, [review])).rows[0];
    expect(await erase(c.phone)).toBe('DELETED');
    expect((await app.pool.query(reviewQuery, [review])).rows[0]).toEqual({ ...reviewBefore, reviewer_name: 'Đã ẩn danh', comment: 'Đã ẩn danh', version: '2' });
    expect((await app.pool.query("SELECT body, version::text AS version FROM app.review_replies WHERE review_id = $1::uuid", [review])).rows).toEqual([{ body: 'Cảm ơn anh Nguyễn Khách', version: '1' }]);
    expect((await app.pool.query('SELECT body FROM app.review_reply_history WHERE review_id = $1::uuid', [review])).rows).toEqual([{ body: 'Cảm ơn anh Nguyễn Khách' }]);
  });

  // The exception of the guards is opened by app.anonymize_app_user only. A session of the RUNTIME role may hold UPDATE/DELETE on these tables
  // and may run set_config itself: that must not open the exception (app.account_anonymize_on requires the owner of the SECURITY DEFINER
  // function). The probe role (ship11_runtime_probe, created by ci.yml and the local test database) has the runtime grants of the tables
  // below and nothing else. Every case is rolled back. Before the owner check each refused case below SUCCEEDED (red on the old code).
  describe('the anonymization exception is closed to a runtime session', () => {
    const PROBE = 'ship11_runtime_probe';

    /** Runs `work` as the probe role (after `grants`, inside a transaction that is always rolled back). */
    async function asRuntimeProbe(grants: string[], work: (client: PoolClient) => Promise<void>): Promise<void> {
      const client = await app.pool.connect();
      try {
        await client.query('BEGIN');
        const role = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [PROBE]);
        if (role.rows.length === 0) {
          throw new Error(`${PROBE} is missing: create it NOLOGIN and GRANT it to ship11_test (ci.yml does this; the local test database must too)`);
        }
        for (const grant of grants) await client.query(grant);
        await client.query(`SET LOCAL ROLE ${PROBE}`);
        const who = await client.query('SELECT current_user::text AS who');
        expect(who.rows[0]).toEqual({ who: PROBE });
        await work(client);
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    }

    /** Runs one statement inside a savepoint and returns its error message (undefined when it succeeded), then undoes it. */
    async function attempt(client: PoolClient, sql: string, params: unknown[] = []): Promise<string | undefined> {
      await client.query('SAVEPOINT attempt');
      let failure: string | undefined;
      try {
        await client.query(sql, params);
      } catch (error) {
        failure = (error as Error).message;
      }
      await client.query('ROLLBACK TO SAVEPOINT attempt');
      return failure;
    }

    it('the runtime role sets the flag itself and UPDATEs a complaint to the anonymized text: refused, the text stays', async () => {
      const c = await customer();
      const orderId = await insertOrder(c.userId, shop.shopId, 'PREPARING');
      await finishOrder(orderId);
      const complaint = await insertComplaint(orderId, c.userId, { body: 'Nội dung khiếu nại' });
      await asRuntimeProbe(['GRANT USAGE ON SCHEMA app TO ship11_runtime_probe', 'GRANT SELECT, UPDATE ON app.complaints TO ship11_runtime_probe'], async (client) => {
        await client.query("SELECT set_config('app.account_anonymize', 'on', true)");
        await client.query("SELECT set_config('app.account_anonymize_user', $1, true)", [c.userId]);
        const failure = await attempt(client, "UPDATE app.complaints SET body = 'Đã ẩn danh', version = version + 1, updated_at = now() WHERE complaint_id = $1::uuid", [complaint]);
        expect(failure).toBeDefined();
        // The guard refuses it, not the grant (the probe holds UPDATE on this table).
        expect(failure).not.toMatch(/permission denied/);
        const row = await client.query('SELECT body FROM app.complaints WHERE complaint_id = $1::uuid', [complaint]);
        expect(row.rows[0]).toEqual({ body: 'Nội dung khiếu nại' });
      });
    });

    it('the runtime role sets the flag itself and DELETEs a fresh picture of its account: refused, the picture stays', async () => {
      const c = await customer();
      const picture = randomUUID();
      await asRuntimeProbe(
        [
          'GRANT USAGE ON SCHEMA app TO ship11_runtime_probe',
          'GRANT SELECT, DELETE ON app.complaint_attachments TO ship11_runtime_probe',
        ],
        async (client) => {
          // The picture is written inside the same rolled-back transaction, as the owner (the probe holds no INSERT).
          await client.query(`RESET ROLE`);
          await client.query(
            `INSERT INTO app.complaint_attachments (attachment_id, uploader_user_id, complaint_id, message_id, content_type, byte_size, data, created_at)
             VALUES ($1::uuid, $2::uuid, NULL, NULL, 'image/png', 3, '\\x010203'::bytea, now())`,
            [picture, c.userId],
          );
          await client.query(`SET LOCAL ROLE ${PROBE}`);
          await client.query("SELECT set_config('app.account_anonymize', 'on', true)");
          await client.query("SELECT set_config('app.account_anonymize_user', $1, true)", [c.userId]);
          const failure = await attempt(client, 'DELETE FROM app.complaint_attachments WHERE attachment_id = $1::uuid', [picture]);
          expect(failure).toBeDefined();
          expect(failure).not.toMatch(/permission denied/);
          const left = await client.query('SELECT count(*)::int AS n FROM app.complaint_attachments WHERE attachment_id = $1::uuid', [picture]);
          expect(left.rows[0]).toEqual({ n: 1 });
        },
      );
    });

    it('the runtime role calls app.anonymize_app_user (its EXECUTE grant): the account is anonymized, because the function runs as the owner', async () => {
      const c = await customer();
      const orderId = await insertOrder(c.userId, shop.shopId, 'PREPARING');
      await finishOrder(orderId);
      const complaint = await insertComplaint(orderId, c.userId, { body: 'Nội dung khiếu nại' });
      await asRuntimeProbe(
        [
          'GRANT USAGE ON SCHEMA app TO ship11_runtime_probe',
          'GRANT EXECUTE ON FUNCTION app.anonymize_app_user(uuid, text) TO ship11_runtime_probe',
          'GRANT SELECT ON app.complaints TO ship11_runtime_probe',
        ],
        async (client) => {
          // An argon2-shaped value that verifies no password (the constraint users_password_hash_ck needs the prefix).
          const unusable = '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
          await app.pool.query("INSERT INTO app.account_deletion_requests (request_id, user_id, verification_id, created_at, expires_at) VALUES ($1::uuid, $2::uuid, $3::uuid, now() - interval '1 second', now() + interval '5 minutes')", [randomUUID(), c.userId, randomUUID()]);
          const done = await client.query('SELECT app.anonymize_app_user($1::uuid, $2::text) AS done', [c.userId, unusable]);
          expect(done.rows[0]).toEqual({ done: true });
          const row = await client.query('SELECT body FROM app.complaints WHERE complaint_id = $1::uuid', [complaint]);
          expect(row.rows[0]).toEqual({ body: 'Đã ẩn danh' });
        },
      );
    });
  });

  // Round 3 (Owner 2026-11-23, Codex): one canary per table. A canary is a unique text written for the account; after the deletion it must
  // be in no column of that row any more, while the row, its id, its state and its amounts stay.
  describe('canary text of the further tables', () => {
    const canary = (label: string): string => `CANARY-${label}-${randomUUID()}`;
    const rowText = async (sql: string, params: unknown[]): Promise<string> =>
      (await app.pool.query(sql, params)).rows.map((row) => (row as { txt: string }).txt).join('\n');

    it('complaint reconsiderations: the reason the account wrote is replaced; the request, its status and the other requests stay', async () => {
      const c = await customer();
      const orderId = await insertOrder(c.userId, shop.shopId, 'PREPARING');
      await finishOrder(orderId);
      const complaint = await insertComplaint(orderId, c.userId, { body: 'Đồ ăn nguội', closed: true });
      const closure = (await app.pool.query('SELECT closure_no FROM app.complaints WHERE complaint_id = $1::uuid', [complaint])).rows[0] as { closure_no: number };
      const mine = canary('RECON');
      const request = randomUUID();
      await app.pool.query(
        `INSERT INTO app.complaint_reconsiderations (request_id, complaint_id, closure_no, requested_by, reason, requested_at, status)
         VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, now(), 'PENDING')`,
        [request, complaint, closure.closure_no, c.userId, mine],
      );
      expect(await erase(c.phone)).toBe('DELETED');
      expect(await rowText('SELECT to_jsonb(t)::text AS txt FROM app.complaint_reconsiderations t WHERE request_id = $1::uuid', [request])).not.toContain(mine);
      expect((await app.pool.query('SELECT reason, status FROM app.complaint_reconsiderations WHERE request_id = $1::uuid', [request])).rows[0]).toEqual({ reason: 'Đã ẩn danh', status: 'PENDING' });
    });

    it("review moderation notes: the reviewer does not erase another party's moderation note", async () => {
      const c = await customer();
      const orderId = await insertOrder(c.userId, shop.shopId, 'PREPARING');
      await finishOrder(orderId);
      const review = randomUUID();
      await app.pool.query(
        `INSERT INTO app.reviews (review_id, kind, reviewer_user_id, shop_id, order_id, stars, comment, reviewer_name, shop_name, related_code, visibility, version, created_at)
         VALUES ($1::uuid, 'SHOP_BY_CUSTOMER', $2::uuid, $3::uuid, $4::uuid, 2, 'Chưa ngon', 'Khách Thử', 'Quán thử', 'R2', 'VISIBLE', 1, now())`,
        [review, c.userId, shop.shopId, orderId],
      );
      const moderation = randomUUID();
      const mine = canary('MODERATION');
      await app.pool.query(
        `INSERT INTO app.review_moderations (moderation_id, review_id, action, reason_code, reason_note, actor_user_id, created_at)
         VALUES ($1::uuid, $2::uuid, 'HIDE', 'OTHER', $3, $4::uuid, now())`,
        [moderation, review, mine, shop.userId],
      );
      expect(await erase(c.phone)).toBe('DELETED');
      expect(await rowText('SELECT to_jsonb(t)::text AS txt FROM app.review_moderations t WHERE moderation_id = $1::uuid', [moderation])).toContain(mine);
      expect((await app.pool.query('SELECT reason_note, action, reason_code FROM app.review_moderations WHERE moderation_id = $1::uuid', [moderation])).rows[0])
        .toEqual({ reason_note: mine, action: 'HIDE', reason_code: 'OTHER' });
    });

    it("driver events: the driver's event reason and detail stay intact", async () => {
      // No balance: a Shipper with money stays PENDING (the rule tested above), this case is about the data of the driver.
      const s = await newShipper(app, drivers, 0);
      const event = randomUUID();
      const mine = canary('DRIVER-EVENT');
      await app.pool.query(
        `INSERT INTO app.driver_events (event_id, driver_id, event_type, actor_type, actor_id, reason, detail, created_at)
         VALUES ($1::uuid, $2::uuid, 'driver.note', 'DRIVER', $3::uuid, $4::text, jsonb_build_object('note', $4::text), now())`,
        [event, s.driverId, s.userId, mine],
      );
      expect(await erase(await phoneOf(s.userId))).toBe('DELETED');
      expect(await rowText('SELECT to_jsonb(t)::text AS txt FROM app.driver_events t WHERE event_id = $1::uuid', [event])).toContain(mine);
      expect((await app.pool.query('SELECT event_type, reason, detail FROM app.driver_events WHERE event_id = $1::uuid', [event])).rows[0])
        .toEqual({ event_type: 'driver.note', reason: mine, detail: { note: mine } });
    });

    it('operations anomaly events: the note and case status stay intact', async () => {
      const c = await customer();
      const anomaly = randomUUID();
      await app.pool.query(
        `INSERT INTO app.ops_anomaly_cases (case_id, rule_kind, subject_kind, subject_id, status, occurrences, sample, window_from, window_to, evidence, last_evidence_at, note, version, first_flagged_at, updated_at)
         VALUES ($1::uuid, 'CUSTOMER_ORDER_CANCELS', 'USER', $2::uuid, 'NEW', 1, 1, now() - interval '1 day', now(), '{"cancelled": 3}'::jsonb, now(), 'Ghi chú thử', 1, now(), now())`,
        [anomaly, c.userId],
      );
      const event = randomUUID();
      const mine = canary('ANOMALY-EVENT');
      await app.pool.query(
        `INSERT INTO app.ops_anomaly_case_events (event_id, case_id, action, from_status, to_status, note, actor_user_id, at)
         VALUES ($1::uuid, $2::uuid, 'NOTE', 'NEW', 'NEW', $3, $4::uuid, now())`,
        [event, anomaly, mine, c.userId],
      );
      expect(await erase(c.phone)).toBe('DELETED');
      expect(await rowText('SELECT to_jsonb(t)::text AS txt FROM app.ops_anomaly_case_events t WHERE event_id = $1::uuid', [event])).toContain(mine);
      expect((await app.pool.query('SELECT note, to_status FROM app.ops_anomaly_case_events WHERE event_id = $1::uuid', [event])).rows[0])
        .toEqual({ note: mine, to_status: 'NEW' });
    });

  });

  it('all order and delivery event notes stay intact', async () => {
    const c = await customer();
    const orderId = await insertOrder(c.userId, shop.shopId, 'PREPARING');
    await finishOrder(orderId);
    const deliveryId = await insertDeliveryRow(app.pool, { shopId: shop.shopId, userId: c.userId });
    await withoutTriggers(['deliveries'], (q) =>
      q.query(`UPDATE app.deliveries SET state = 'cancelled_by_system', ended_at = now() WHERE delivery_id = $1::uuid`, [deliveryId]),
    );
    const mine = randomUUID();
    const systemNote = randomUUID();
    await app.pool.query(
      `INSERT INTO app.order_events (event_id, order_id, type, actor_type, actor_id, note, at) VALUES
         ($1::uuid, $2::uuid, 'NOTE', 'CUSTOMER', $3::uuid, 'Gọi trước 10 phút, cổng sau', now()),
         ($4::uuid, $2::uuid, 'NOTE', 'SYSTEM', NULL, 'Đơn đã kết thúc', now())`,
      [mine, orderId, c.userId, systemNote],
    );
    await app.pool.query(
      `INSERT INTO app.delivery_events (event_id, delivery_id, seq, event_type, actor_type, actor_id, note, created_at) VALUES
         ($1::uuid, $2::uuid, 1, 'note.added', 'CUSTOMER', $3::uuid, 'Để hàng trước cửa', now()),
         ($4::uuid, $2::uuid, 2, 'note.added', 'SYSTEM', NULL, 'Giao hàng đã kết thúc', now())`,
      [randomUUID(), deliveryId, c.userId, randomUUID()],
    );
    const orderBefore = (await app.pool.query('SELECT note FROM app.order_events WHERE order_id = $1::uuid ORDER BY at, event_id', [orderId])).rows;
    const deliveryBefore = (await app.pool.query('SELECT note FROM app.delivery_events WHERE delivery_id = $1::uuid ORDER BY seq', [deliveryId])).rows;
    expect(await erase(c.phone)).toBe('DELETED');
    expect((await app.pool.query('SELECT note FROM app.order_events WHERE order_id = $1::uuid ORDER BY at, event_id', [orderId])).rows).toEqual(orderBefore);
    expect((await app.pool.query('SELECT note FROM app.delivery_events WHERE delivery_id = $1::uuid ORDER BY seq', [deliveryId])).rows).toEqual(deliveryBefore);
  });

  it('delivery incidents: the shipper\'s incident and its notes stay intact', async () => {
    const s = await newShipper(app, drivers, 50_000);
    extraUsers.push(s.userId);
    await emptyWallet(s.driverId);
    const buyer = await customer();
    // A finished delivery of this shipper (cancelled, so nothing is in progress) with its assignment; written directly, the fixture needs no money.
    const deliveryId = await insertDeliveryRow(app.pool, { shopId: shop.shopId, userId: buyer.userId });
    await withoutTriggers(['deliveries'], (q) => q.query(`UPDATE app.deliveries SET state = 'cancelled_by_system', ended_at = now() WHERE delivery_id = $1::uuid`, [deliveryId]));
    const assignmentId = randomUUID();
    await withoutTriggers(['delivery_assignments'], (q) =>
      q.query(
        `INSERT INTO app.delivery_assignments (assignment_id, delivery_id, driver_id, status, accepted_at, commission_vnd, commission_policy, ended_at, end_actor, version, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'CANCELLED_BY_SHIPPER', now(), 1000, 'COMMISSION_V1', now(), 'SHIPPER', 1, now(), now())`,
        [assignmentId, deliveryId, s.driverId],
      ),
    );
    const incident = randomUUID();
    await app.pool.query(
      `INSERT INTO app.delivery_incidents (incident_id, delivery_id, assignment_id, driver_id, status, custody, reason_code, reason_note, goods_condition, opened_at, closed_at, closed_by, close_note, version, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'CLOSED', 'HANDLED', 'RECIPIENT_UNREACHABLE', 'Gọi 0912345678 không nghe máy', 'RETURNED_TO_SHOP', now() - interval '2 hours', now() - interval '1 hour', $5::uuid, 'Đã trả hàng về shop', 1, now(), now())`,
      [incident, deliveryId, assignmentId, s.driverId, shop.userId],
    );
    const query = 'SELECT status, custody, closed_at, reason_note, close_note, version::text FROM app.delivery_incidents WHERE incident_id = $1::uuid';
    const before = (await app.pool.query(query, [incident])).rows[0];
    expect(await erase(await phoneOf(s.userId))).toBe('DELETED');
    expect((await app.pool.query(query, [incident])).rows[0]).toEqual(before);
  });

  it('outbox events: the personal fields of the payload are replaced, the JSON structure, ids and the event type stay', async () => {
    const c = await customer();
    const event = randomUUID();
    await app.pool.query(
      `INSERT INTO app.outbox_events (event_id, event_type, event_schema_version, resource_type, resource_id, resource_version, occurred_at, payload, status, attempt_count, available_at)
       VALUES ($1::uuid, 'test.pii.profile.v1', 1, 'user', $2, 1, now(), $3::jsonb, 'PENDING', 0, now())`,
      [event, c.userId, JSON.stringify({ user_id: c.userId, phone: c.phone.normalized, name: 'Nguyễn Văn Khách', nested: { address_text: '12 Phố Huế', amount: 5000 }, list: [{ phone: c.phone.normalized }], keep: 'ok' })],
    );
    expect(await erase(c.phone)).toBe('DELETED');
    const payload = (await app.pool.query<{ payload: Record<string, unknown>; event_type: string }>('SELECT payload, event_type FROM app.outbox_events WHERE event_id = $1::uuid', [event])).rows[0];
    expect(payload?.event_type).toBe('test.pii.profile.v1');
    expect(payload?.payload).toEqual({
      user_id: c.userId,
      phone: 'Đã ẩn danh',
      name: 'Đã ẩn danh',
      nested: { address_text: '12 Phố Huế', amount: 5000 },
      list: [{ phone: 'Đã ẩn danh' }],
      keep: 'ok',
    });
  });

  it('audit entries: the personal fields of the metadata are replaced; the actor, the action and the resource stay', async () => {
    const c = await customer();
    const entry = randomUUID();
    await app.pool.query(
      `INSERT INTO app.audit_logs (audit_id, occurred_at, request_id, actor_type, actor_id, action, resource_type, resource_id, resource_version, outcome, metadata)
       VALUES ($1::uuid, now(), $2::uuid, 'SYSTEM', $3, 'test.pii.profile.v1', 'user', $3, 1, 'SUCCESS', $4::jsonb)`,
      [entry, randomUUID(), c.userId, JSON.stringify({ phone: c.phone.normalized, name: 'Nguyễn Văn Khách', reason: 'hết hạn' })],
    );
    expect(await erase(c.phone)).toBe('DELETED');
    expect((await app.pool.query('SELECT actor_id, action, resource_id, metadata FROM app.audit_logs WHERE audit_id = $1::uuid', [entry])).rows[0]).toEqual({
      actor_id: c.userId,
      action: 'test.pii.profile.v1',
      resource_id: c.userId,
      metadata: { phone: 'Đã ẩn danh', name: 'Đã ẩn danh', reason: 'hết hạn' },
    });
  });

  it('complaint pictures from the erasing account are hidden even while the complaint is open', async () => {
    const c = await customer();
    const orderId = await insertOrder(c.userId, shop.shopId, 'PREPARING');
    await finishOrder(orderId);
    const open = await insertComplaint(orderId, c.userId, { body: 'Đang mở' });
    const closed = await insertComplaint(orderId, c.userId, { body: 'Đã đóng', closed: true });
    const picture = async (complaintId: string | null): Promise<string> => {
      const attachment = randomUUID();
      let messageId: string | null = null;
      if (complaintId !== null) messageId = await insertComplaintMessage(complaintId, c.userId, 9, 'Ảnh minh hoạ');
      await app.pool.query(
        `INSERT INTO app.complaint_attachments (attachment_id, uploader_user_id, complaint_id, message_id, content_type, byte_size, data, created_at, linked_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, 'image/png', 4, decode('89504e47', 'hex'), now() - interval '2 days', $5)`,
        [attachment, c.userId, complaintId, messageId, complaintId === null ? null : new Date()],
      );
      return attachment;
    };
    const openPicture = await picture(open);
    const closedPicture = await picture(closed);
    const loose = await picture(null);
    expect(await erase(c.phone)).toBe('DELETED');
    const stillThere = async (id: string): Promise<number> => (await app.pool.query('SELECT 1 FROM app.complaint_attachments WHERE attachment_id = $1::uuid', [id])).rowCount ?? 0;
    expect(await stillThere(openPicture)).toBe(0);
    expect(await stillThere(closedPicture)).toBe(0);
    expect(await stillThere(loose)).toBe(0);


  });

  it('the sole owner’s shop profile loses its name and contact phone while locality and membership stay intact', async () => {
    const owner = await createShopOwner(app);
    extraUsers.push(owner.userId);
    extraShops.push(owner.shopId);
    const query = 'SELECT name, status, accepting_orders, address_text, pickup_lat, pickup_lng, contact_phone_normalized FROM app.shops WHERE shop_id = $1::uuid';
    const before = (await app.pool.query(query, [owner.shopId])).rows[0];
    expect(await erase(await phoneOf(owner.userId))).toBe('DELETED');
    expect(await anonymized(owner.userId)).toBe(true);
    expect((await app.pool.query(query, [owner.shopId])).rows[0]).toEqual({
      ...before, name: 'Cửa hàng đã ẩn danh', contact_phone_normalized: expect.stringMatching(/^\+999\d{11}$/),
    });
    expect(await countRows(app.pool, 'SELECT 1 FROM app.shop_members WHERE user_id = $1::uuid', [owner.userId])).toBe(1);
  });

  // ---- races ----------------------------------------------------------------------------------------------------------------------

  /**
   * Plays a command that is IN FLIGHT on the account: it holds the user row FOR UPDATE (what every writer takes first). `inside` runs in that
   * transaction (the work it commits); `release` commits and lets the queued requests go. Always released, even when the test fails.
   */
  async function holdUserRow(userId: string): Promise<{ inside: (sql: string, values?: unknown[]) => Promise<unknown>; release: () => Promise<void> }> {
    const client = await app.pool.connect();
    let open = true;
    await client.query('BEGIN');
    await client.query('SELECT 1 FROM app.users WHERE user_id = $1::uuid FOR UPDATE', [userId]);
    return {
      inside: (sql, values) => client.query(sql, values),
      release: async () => {
        if (!open) return;
        open = false;
        try {
          await client.query('COMMIT');
        } finally {
          client.release();
        }
      },
    };
  }
  /** Waits until `count` requests are blocked on a user row lock (a command's lockById, or the shared read before it), in the order they were started. */
  async function waitForWaiters(count: number): Promise<void> {
    for (let attempt = 0; attempt < 800; attempt += 1) {
      if ((await rowLockWaitersRunning(app.pool, '%FROM app.users WHERE user_id = $1::uuid FOR %')) >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('the requests did not queue behind the lock');
  }


  it('race: an order attempted just AFTER the confirmation (queued behind it) is refused, and no order exists for the deleted account', async () => {
    const c = await customer();
    const hold = await holdUserRow(c.userId);
    try {
      const confirming = confirm(c.phone);
      await waitForWaiters(1);
      const placing = placeOrder(c);
      await waitForWaiters(2);
      await hold.release();
      const [confirmation, order] = await Promise.all([confirming, placing]);
      // Nothing was in progress when the confirmation ran, so the account was anonymized; the late order finds no valid session.
      expect(resultOf(confirmation)).toBe('LOCKED');
      expect(order.status).toBeGreaterThanOrEqual(400);
      expect(await userRow(c.userId)).toMatchObject({ status: 'DISABLED', lock_reason: 'DELETE_REQUEST' });
      expect(await countRows(app.pool, 'SELECT 1 FROM app.orders WHERE customer_user_id = $1::uuid', [c.userId])).toBe(0);
    } finally {
      await hold.release();
    }
  });

  it('race: the same confirmation sent twice at once (a retry) makes one effect and one audit entry', async () => {
    const c = await customer();
    await insertOrder(c.userId, shop.shopId, 'PREPARING');
    const key = randomUUID();
    const [a, b] = await Promise.all([confirm(c.phone, PASSWORD, key), confirm(c.phone, PASSWORD, key)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([resultOf(a), resultOf(b)]).toEqual(['LOCKED', 'LOCKED']);
    expect(await audits('account.delete.finalized.v1', c.userId)).toBe(1);
    expect((await userRow(c.userId))?.pending).toBe(false);
  });


  // ---- the page ---------------------------------------------------------------------------------------------------------------------

  it('the page /delete-account is served from the backend origin with its own two assets, a strict CSP, the consequences before the button and no host name', async () => {
    const base = app.running.baseUrl;
    const page = await fetch(`${base}/delete-account`);
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(page.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    // The consequences are shown, and they come BEFORE the confirm button.
    for (const phrase of ['Không thể hủy sau khi xác nhận', 'đăng xuất', 'dữ liệu phải lưu', 'không nhận hoặc tạo được việc mới', 'Số dư ví']) {
      expect(html).toContain(phrase);
    }
    expect(html.indexOf('Hậu quả khi bạn xác nhận')).toBeLessThan(html.indexOf('id="submit"'));
    expect(html).toContain('id="ack" type="checkbox"');
    expect(html).not.toMatch(/https?:\/\//);
    const script = await fetch(`${base}/delete-account/app.js`);
    const js = await script.text();
    expect([script.status, script.headers.get('content-type')]).toEqual([200, 'text/javascript; charset=utf-8']);
    expect(js).toContain("fetch('/v1/account-deletion/confirm'");
    expect(js).not.toMatch(/https?:\/\//);
    const css = await fetch(`${base}/delete-account/app.css`);
    expect([css.status, css.headers.get('content-type')]).toEqual([200, 'text/css; charset=utf-8']);
    expect((await fetch(`${base}/delete-account/other`)).status).toBe(404);
  });

  it('the private wrong-method / unknown routes stay closed: no GET on the confirm route, no Admin route to cancel a request', async () => {
    expect((await app.call('GET', '/account-deletion/confirm')).status).toBe(404);
    expect((await app.call('POST', '/account-deletion/cancel', { body: {} })).status).toBe(404);
  });

  // ---- The owner's erasure from the signed-in app (Owner order 2026-11-23) ------------------------------------------------------------------------

  describe('erasure from the app: pre-check, one-time code, one-time request, erasure job', () => {
    let savedIpPerHour: number | undefined;
    beforeAll(async () => {
      // One loopback address sends every code of this suite: the hourly address budget is lifted for this block only (restored afterwards).
      savedIpPerHour = (await app.pool.query<{ ip_per_hour: number }>('SELECT ip_per_hour FROM app.otp_policy WHERE policy_id = 1')).rows[0]?.ip_per_hour;
      await withoutTriggers(['otp_policy'], (q) => q.query('UPDATE app.otp_policy SET ip_per_hour = 500 WHERE policy_id = 1'));
    });
    afterAll(async () => {
      await withoutTriggers(['otp_policy'], (q) => q.query('UPDATE app.otp_policy SET ip_per_hour = $1 WHERE policy_id = 1', [savedIpPerHour ?? 10]));
    });
    const codeCount = async (normalizedPhone: string): Promise<number> =>
      countRows(app.pool, "SELECT 1 FROM app.phone_verifications WHERE phone_normalized = $1 AND purpose = 'ACCOUNT_DELETE'", [normalizedPhone]);
    const requestCount = async (userId: string): Promise<number> =>
      countRows(app.pool, 'SELECT 1 FROM app.account_deletion_requests WHERE user_id = $1::uuid', [userId]);
    const statusOf = async (userId: string): Promise<string | undefined> =>
      (await app.pool.query<{ status: string }>('SELECT status FROM app.users WHERE user_id = $1::uuid', [userId])).rows[0]?.status;
    const normalizedOf = (phone: { local: string }): string => `+84${phone.local.slice(1)}`;
    const codesOf = (response: ApiResponse): string[] => ((response.body.data as { blockers?: Array<{ code: string }> } | undefined)?.blockers ?? []).map((b) => b.code);
    // Every code request of this block goes through here: the registration code of the fixture is not a recent send for the erasure.
    const tokenOf = async (phone: { local: string; normalized?: string }): Promise<string> => {
      await ageChallenges(phone.normalized ?? `+84${phone.local.slice(1)}`);
      return String((await login({ local: phone.local })).body.data?.access_token);
    };

    it('the erasure function refuses an account with no valid request (none, expired), whoever calls it', async () => {
      const c = await customer();
      await expect(app.pool.query('SELECT app.anonymize_app_user($1::uuid, $2::text)', [c.userId, 'x'])).rejects.toThrow(/ACCOUNT_ERASURE_NOT_REQUESTED/);
      // An expired request does not open it.
      await app.pool.query(
        "INSERT INTO app.account_deletion_requests (request_id, user_id, verification_id, created_at, expires_at) VALUES ($1::uuid, $2::uuid, $3::uuid, now() - interval '2 minutes', now() - interval '1 minute')",
        [randomUUID(), c.userId, randomUUID()],
      );
      await expect(app.pool.query('SELECT app.anonymize_app_user($1::uuid, $2::text)', [c.userId, 'x'])).rejects.toThrow(/ACCOUNT_ERASURE_NOT_REQUESTED/);
      expect(await anonymized(c.userId)).toBe(false);
    });

    it('the pre-check blocks work in progress and a balance at or above the minimum withdrawal: no code is sent', async () => {
      const c = await customer();
      const orderId = await insertOrder(c.userId, shop.shopId, 'PREPARING');
      const token = await tokenOf(c.phone);
      const blocked = await app.call('GET', '/account/deletion/precheck', { bearer: token });
      expect(blocked.body.data?.status).toBe('BLOCKED');
      expect(codesOf(blocked)).toContain('ACTIVE_WORK');
      expect(refused(await app.call('POST', '/account/deletion/code', { bearer: token, body: { accept_forfeit: true, forfeit_vnd: '0' } }))).toEqual({ status: 409, code: 'ACCOUNT_ERASURE_BLOCKED' });
      expect(await codeCount(c.phone.normalized)).toBe(0);
      await finishOrder(orderId);

      const shipper = await newShipper(app, drivers, 50_000);
      const shipperPhone = await phoneOf(shipper.userId);
      const sToken = await tokenOf(shipperPhone);
      const money = await app.call('GET', '/account/deletion/precheck', { bearer: sToken });
      expect(codesOf(money)).toContain('WALLET_AT_OR_ABOVE_MINIMUM');
      expect(refused(await app.call('POST', '/account/deletion/code', { bearer: sToken, body: { accept_forfeit: true, forfeit_vnd: '0' } }))).toEqual({ status: 409, code: 'ACCOUNT_ERASURE_BLOCKED' });
      expect(await codeCount(normalizedOf(shipperPhone))).toBe(0);
      expect(await anonymized(shipper.userId)).toBe(false);
    });

    it('records the agreed balance at confirmation and posts it only if anonymization commits', async () => {
      const shipper = await newShipper(app, drivers, 5_000);
      const phone = await phoneOf(shipper.userId);
      const token = await tokenOf(phone);
      const consent = { accept_forfeit: true, forfeit_vnd: '5000' };
      const codePath = '/account/deletion/code';
      const confirmPath = '/account/deletion/confirm';
      expect(refused(await app.call('POST', codePath, { bearer: token, body: { ...consent, accept_forfeit: false } }))).toEqual({ status: 409, code: 'ACCOUNT_ERASURE_CONSENT_REQUIRED' });
      expect(await codeCount(normalizedOf(phone))).toBe(0);
      const code = await app.call('POST', codePath, { bearer: token, body: consent });
      expect(code.status).toBe(200);
      const verificationId = String(dataOf(code).verification_id);
      const otp = app.provider.lastOtpFor(normalizedOf(phone));
      const confirmation = { verification_id: verificationId, otp, ...consent };
      expect(refused(await app.call('POST', confirmPath, { bearer: token, body: { ...confirmation, forfeit_vnd: '4000' } }))).toEqual({ status: 409, code: 'ACCOUNT_ERASURE_CONSENT_REQUIRED' });
      expect(await requestCount(shipper.userId)).toBe(0);
      expect(resultOf(await app.call('POST', confirmPath, { bearer: token, body: confirmation }))).toBe('ERASURE_SCHEDULED');
      const request = (await app.pool.query('SELECT request_id, forfeit_vnd::text, consumed_at FROM app.account_deletion_requests WHERE verification_id = $1::uuid', [verificationId])).rows[0];
      expect(request).toMatchObject({ forfeit_vnd: '5000', consumed_at: null });

      const adjustmentCount = (): Promise<number> => countRows(app.pool, "SELECT 1 FROM app.wallet_adjustments WHERE source_id = $1::uuid AND source_type = 'ACCOUNT_DELETE'", [request.request_id]);
      expect(await walletOf(shipper.driverId)).toEqual({ balance: '5000', held: '0' });
      expect(await adjustmentCount()).toBe(0);

      const deletion = app.running.app.get(AccountDeletionService, { strict: false });
      const record = jest.spyOn(deletion, 'recordFinalized').mockRejectedValueOnce(new Error('abort erasure transaction'));
      try {
        expect((await sweeper().sweep()).failed).toBe(1);
      } finally {
        record.mockRestore();
      }
      expect(await walletOf(shipper.driverId)).toEqual({ balance: '5000', held: '0' });
      expect(await adjustmentCount()).toBe(0);
      expect(await anonymized(shipper.userId)).toBe(false);
      expect(await countRows(app.pool, 'SELECT 1 FROM app.account_deletion_requests WHERE verification_id = $1::uuid AND consumed_at IS NULL', [verificationId])).toBe(1);

      expect((await sweeper().sweep()).failed).toBe(0);
      expect(await anonymized(shipper.userId)).toBe(true);
      const ledger = (await app.pool.query(
        'SELECT e.entry_kind AS kind, e.delta_vnd::text AS delta, e.balance_after_vnd::text AS after FROM app.wallet_ledger_entries e JOIN app.driver_wallets w ON w.wallet_id = e.wallet_id WHERE w.driver_id = $1::uuid ORDER BY e.sequence_no DESC LIMIT 1',
        [shipper.driverId],
      )).rows[0];
      expect(ledger).toEqual({ kind: 'ADJUSTMENT_DEBIT', delta: '-5000', after: '0' });
      expect(await adjustmentCount()).toBe(1);
    });

    it('keeps a cancelled withdrawal and its bank destination unchanged', async () => {
      const shipper = await newShipper(app, drivers, 5_000);
      await markPending(shipper.userId);
      const created = await withdraw(shipper.token, 5_000);
      expect(created.status).toBe(201);
      const withdrawal = dataOf(created);
      const id = String(withdrawal.withdrawal_id);
      expect((await app.call('POST', `/driver/wallet/withdrawals/${id}/cancel`, {
        bearer: shipper.token,
        headers: { 'idempotency-key': randomUUID() },
        body: { expected_version: withdrawal.version },
      })).status).toBe(200);
      const query = 'SELECT * FROM app.wallet_withdrawals WHERE withdrawal_id = $1::uuid';
      const before = (await app.pool.query(query, [id])).rows[0];
      expect(before).toMatchObject({ state: 'CANCELLED', account_number: expect.any(String) });
      await app.pool.query('UPDATE app.users SET delete_requested_at = NULL WHERE user_id = $1::uuid', [shipper.userId]);
      expect(await erase(await phoneOf(shipper.userId))).toBe('DELETED');
      expect((await app.pool.query(query, [id])).rows[0]).toEqual(before);
    });

    it('counts deletion SMS toward the shared phone cooldown and hourly limit', async () => {
      const c = await customer();
      const other = await customer();
      const token = await tokenOf(c.phone);
      const otherToken = await tokenOf(other.phone);
      const body = { accept_forfeit: false, forfeit_vnd: '0' };
      const codePath = '/account/deletion/code';
      const policy = (await app.pool.query('SELECT phone_per_hour FROM app.otp_policy WHERE policy_id = 1')).rows[0];
      await withoutTriggers(['otp_policy'], (q) => q.query('UPDATE app.otp_policy SET phone_per_hour = 1 WHERE policy_id = 1'));
      try {
        const sent = app.provider.sentCount();
        expect((await app.call('POST', codePath, { bearer: token, body })).status).toBe(200);
        const cooldown = await app.call('POST', codePath, { bearer: token, body });
        expect(cooldown.body.error).toMatchObject({ code: 'OTP_RATE_LIMITED', details: { reason: 'COOLDOWN' } });
        await withoutTriggers(['phone_verifications'], (q) => q.query(
          "UPDATE app.phone_verifications SET created_at = created_at - interval '11 minutes' WHERE phone_normalized = $1 AND purpose = 'ACCOUNT_DELETE'", [c.phone.normalized],
        ));
        const hourly = await app.call('POST', codePath, { bearer: token, body });
        expect(hourly.body.error).toMatchObject({ code: 'OTP_RATE_LIMITED', details: { reason: 'PHONE_HOUR' } });
        expect(await codeCount(c.phone.normalized)).toBe(1);
        expect(app.provider.sentCount()).toBe(sent + 1);
        expect((await app.call('POST', codePath, { bearer: otherToken, body })).status).toBe(200);
      } finally {
        await withoutTriggers(['otp_policy'], (q) => q.query('UPDATE app.otp_policy SET phone_per_hour = $1 WHERE policy_id = 1', [policy.phone_per_hour]));
      }
    });

    it('a wrong code and an expired code create no request and leave the account active', async () => {
      const c = await customer();
      const token = await tokenOf(c.phone);
      const code = await app.call('POST', '/account/deletion/code', { bearer: token, body: { accept_forfeit: true, forfeit_vnd: '0' } });
      expect(code.status).toBe(200);
      const verificationId = String(code.body.data?.verification_id);
      const wrong = await app.call('POST', '/account/deletion/confirm', { bearer: token, body: { verification_id: verificationId, otp: '000000', accept_forfeit: true, forfeit_vnd: '0' } });
      expect(wrong.status).not.toBe(200);
      expect(await requestCount(c.userId)).toBe(0);
      expect(await statusOf(c.userId)).toBe('ACTIVE');
      await withoutTriggers(['phone_verifications'], (q) => q.query("UPDATE app.phone_verifications SET created_at = now() - interval '2 minutes', expires_at = now() - interval '1 minute' WHERE verification_id = $1::uuid", [verificationId]));
      const expired = await app.call('POST', '/account/deletion/confirm', { bearer: token, body: { verification_id: verificationId, otp: app.provider.lastOtpFor(c.phone.normalized), accept_forfeit: true, forfeit_vnd: '0' } });
      expect(expired.status).not.toBe(200);
      expect(await requestCount(c.userId)).toBe(0);
      expect(await statusOf(c.userId)).toBe('ACTIVE');
    });

    it('blocks recovery while erasure is pending, then allows a fresh code after expiry without replaying the old code', async () => {
      const c = await customer();
      const token = await tokenOf(c.phone);
      const consent = { accept_forfeit: false, forfeit_vnd: '0' };
      const codePath = '/account/deletion/code';
      const confirmPath = '/account/deletion/confirm';
      const recoveryPath = '/account-recovery/locked';
      const code = await app.call('POST', codePath, { bearer: token, body: consent });
      expect(code.status).toBe(200);
      const expiredId = String(dataOf(code).verification_id);
      const oldOtp = app.provider.lastOtpFor(c.phone.normalized);
      const oldConfirmation = { verification_id: expiredId, otp: oldOtp, ...consent };
      expect(resultOf(await app.call('POST', confirmPath, { bearer: token, body: oldConfirmation }))).toBe('ERASURE_SCHEDULED');

      // Simulate a gateway delivery receipt for the existing OTP recovery route.
      const provider = Object.assign(app.provider, {
        assertReady: async () => ({ deliverable: true }),
        sendResetOtp: async (phone: string, otp: string, delivery: OtpDelivery) => {
          await app.provider.sendRegisterOtp(phone, otp);
          await app.pool.query("UPDATE app.phone_verifications SET status = 'PENDING' WHERE verification_id = $1::uuid", [delivery.verificationId]);
        },
      });
      try {
        await ageChallenges(c.phone.normalized);
        const sent = app.provider.sentCount();
        expect((await app.call('POST', `${recoveryPath}/otp`, { body: { phone: c.phone.local } })).status).toBe(200);
        expect(app.provider.sentCount()).toBe(sent);
        expect(await statusOf(c.userId)).toBe('DISABLED');

        await app.pool.query(
          "UPDATE app.account_deletion_requests SET created_at = now() - interval '2 minutes', expires_at = now() - interval '1 minute' WHERE verification_id = $1::uuid",
          [expiredId],
        );
        await ageChallenges(c.phone.normalized);
        const recoveryCode = await app.call('POST', `${recoveryPath}/otp`, { body: { phone: c.phone.local } });
        expect(app.provider.sentCount()).toBe(sent + 1);
        const verified = await app.call('POST', `${recoveryPath}/otp/${String(dataOf(recoveryCode).verification_id)}/verify`, {
          body: { otp: app.provider.lastOtpFor(c.phone.normalized) },
        });
        expect(verified.status).toBe(200);
        expect((await app.call('POST', `${recoveryPath}/recover`, {
          headers: { 'idempotency-key': randomUUID() },
          body: { verification_token: dataOf(verified).verification_token, password: PASSWORD },
        })).status).toBe(200);
      } finally {
        Reflect.deleteProperty(provider, 'assertReady');
        Reflect.deleteProperty(provider, 'sendResetOtp');
      }

      const freshSession = await tokenOf(c.phone);
      expect((await me(freshSession)).status).toBe(200);
      expect(refused(await app.call('POST', confirmPath, { bearer: freshSession, body: oldConfirmation })).code).toBe('OTP_ALREADY_USED');
      expect(await requestCount(c.userId)).toBe(1);

      const freshCode = await app.call('POST', codePath, { bearer: freshSession, body: consent });
      expect(freshCode.status).toBe(200);
      const freshId = String(dataOf(freshCode).verification_id);
      expect(resultOf(await app.call('POST', confirmPath, { bearer: freshSession, body: {
        verification_id: freshId, otp: app.provider.lastOtpFor(c.phone.normalized), ...consent,
      } }))).toBe('ERASURE_SCHEDULED');

      const requests = async (): Promise<Array<{ verification_id: string; consumed_at: Date | null }>> => (await app.pool.query(
        'SELECT verification_id, consumed_at FROM app.account_deletion_requests WHERE user_id = $1::uuid ORDER BY created_at', [c.userId],
      )).rows;
      expect(await requests()).toEqual([{ verification_id: expiredId, consumed_at: null }, { verification_id: freshId, consumed_at: null }]);
      expect(await sweeper().sweep()).toMatchObject({ finalized: 1, failed: 0 });
      const recorded = await requests();
      expect(recorded).toEqual([{ verification_id: expiredId, consumed_at: null }, { verification_id: freshId, consumed_at: expect.any(Date) }]);
      expect(await sweeper().sweep()).toMatchObject({ finalized: 0, failed: 0 });
      await expect(app.pool.query('SELECT app.anonymize_app_user($1::uuid, $2::text) AS done', [c.userId, 'x'])).resolves.toMatchObject({ rows: [{ done: false }] });
      expect(await requests()).toEqual(recorded);
    });

    it('the code of account A cannot erase account B: a challenge of another phone is refused with the wrong-code answer', async () => {
      const a = await customer();
      const b = await customer();
      const tokenA = await tokenOf(a.phone);
      const tokenB = await tokenOf(b.phone);
      const code = await app.call('POST', '/account/deletion/code', { bearer: tokenA, body: { accept_forfeit: true, forfeit_vnd: '0' } });
      const verificationId = String(code.body.data?.verification_id);
      const otpOfB = app.provider.lastOtpFor(b.phone.normalized);
      expect(refused(await app.call('POST', '/account/deletion/confirm', { bearer: tokenB, body: { verification_id: verificationId, otp: otpOfB, accept_forfeit: true, forfeit_vnd: '0' } })).code).toBe('OTP_INVALID');
      expect(await requestCount(b.userId)).toBe(0);
      expect(await statusOf(b.userId)).toBe('ACTIVE');
    });

    it('ACCOUNT_DELETE shares the phone quota purposes with the other account OTP flows', () => {
      expect(OTP_QUOTA_PURPOSES).toContain('ACCOUNT_DELETE');
    });

    it('an erasure request is used exactly once: the first call consumes it, a replay finds none and changes nothing', async () => {
      const c = await customer();
      const requestId = randomUUID();
      await app.pool.query(
        "INSERT INTO app.account_deletion_requests (request_id, user_id, verification_id, created_at, expires_at) VALUES ($1::uuid, $2::uuid, $3::uuid, now() - interval '1 second', now() + interval '5 minutes')",
        [requestId, c.userId, randomUUID()],
      );
      const unusable = '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      const first = await app.pool.query('SELECT app.anonymize_app_user($1::uuid, $2::text) AS done', [c.userId, unusable]);
      expect(first.rows[0]).toEqual({ done: true });
      const consumed = (await app.pool.query<{ consumed_at: Date | null }>('SELECT consumed_at FROM app.account_deletion_requests WHERE request_id = $1::uuid', [requestId])).rows[0]?.consumed_at;
      expect(consumed).toBeInstanceOf(Date);
      const version = (await userRow(c.userId))?.version;
      // The replay changes nothing: the request is spent, so it cannot erase again (and no new request can be written for an anonymized account).
      const second = await app.pool.query('SELECT app.anonymize_app_user($1::uuid, $2::text) AS done', [c.userId, unusable]);
      expect(second.rows[0]).toEqual({ done: false });
      expect((await userRow(c.userId))?.version).toBe(version);
      expect((await app.pool.query<{ consumed_at: Date | null }>('SELECT consumed_at FROM app.account_deletion_requests WHERE request_id = $1::uuid', [requestId])).rows[0]?.consumed_at).toEqual(consumed);
    });

    it('the erasure job takes only an account with a valid request: a lock without a request is never anonymized', async () => {
      const locked = await customer();
      expect(resultOf(await confirm(locked.phone))).toBe('LOCKED');
      expect((await sweeper().sweep()).failed).toBe(0);
      expect(await anonymized(locked.userId)).toBe(false);
      expect(await statusOf(locked.userId)).toBe('DISABLED');
    });
  });

});
