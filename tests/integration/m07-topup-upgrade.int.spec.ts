import { randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Pool, PoolClient } from 'pg';
import { ADMIN_SESSION_COOKIE } from '../../apps/backend/src/admin-auth/admin-auth-constants';
import { M14_ROUTING } from '../../apps/backend/src/delivery/m14-route-client';
import { ADMIN_PASSWORD, AdminApp, adminData, AdminResponse, cookieFrom, loginStep, preauthCookies, rewindAcceptedStep, sessionCookies, startAdminApp, totpNow } from './support/admin-fixtures';
import { begin, ok, post } from './support/activation-fixtures';
import { ApiResponse, AuthApp, dataOf, obtainProof, PASSWORD, Phone, purgePhone, randomPhone, startAuthApp } from './support/auth-fixtures';
import { M07_DOWN_SQL, M07_MIGRATION_NAME, M07_UP_SQL } from './support/m07-migration-sql';
import { M08_DOWN_SQL, M08_MIGRATION_NAME, M08_UP_SQL } from './support/m08-migration-sql';
import { M11_DOWN_SQL, M11_MIGRATION_NAME, M11_UP_SQL } from './support/m11-migration-sql';
import { createInvitation, createPayload, systemSession, SystemSession } from './support/provisioning-fixtures';
import { createShopOwner, ShopOwner } from './support/shop-management-fixtures';

// M07 over a database that ALREADY holds M04 money. The M07 migration is taken off (its own Down, which must keep TOPUP working), real TOPUP money is posted
// the way the product posts it (Shipper request over HTTP, Admin confirmation over HTTP, M04's posting service), the M07 migration is applied on top, and
// everything must be exactly as it was; then M07 runs on that money: another top-up, accept (hold), complete (one debit), cancel and fail (release), and the
// ledger gate still refuses every source it must refuse. Both applications (administration and client) share the one test database.

const TERMS = 'test-terms-20261011-v1';
const PRIVACY = 'test-privacy-20261011-v1';
const tag = randomBytes(3).toString('hex').toUpperCase();
const RECORD = 'wallet.topup.record';
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Login {
  readonly cookie: string;
  readonly csrf: string;
}
interface Shipper {
  readonly phone: Phone;
  readonly userId: string;
  readonly token: string;
  readonly driverId: string;
  readonly walletId: string;
}

describe('M07 on top of real M04 TOPUP money (upgrade from main)', () => {
  let client: AuthApp;
  let admin: AdminApp;
  let system: SystemSession;
  let router: http.Server;
  let shop: ShopOwner;
  let recorder: { readonly phone: Phone; readonly userId: string; readonly secret: string };
  let recorderLogin: Login;
  let accountId = '';
  let m07Applied = true;
  let addedPolicy = false;
  const shippers: Shipper[] = [];
  const pool = (): Pool => admin.pool;

  /**
   * The M07 migration goes in and out as the runner would do it: its SQL, then its row in the history (so `npm run db:migrate` stays consistent). M08
   * (notifications) and M11 (ratings and complaints) reference M07's deliveries, so they leave BEFORE M07 (M11 first) and come back AFTER it, each with its
   * own history row.
   */
  async function runMigration(sql: string, record: 'insert' | 'delete'): Promise<void> {
    const c = await pool().connect();
    try {
      await c.query('BEGIN');
      if (record === 'delete') {
        await c.query(M11_DOWN_SQL);
        await c.query(M08_DOWN_SQL);
        await c.query(sql);
        await c.query('DELETE FROM public.pgmigrations WHERE name = ANY($1::text[])', [[M07_MIGRATION_NAME, M08_MIGRATION_NAME, M11_MIGRATION_NAME]]);
      } else {
        await c.query(sql);
        await c.query(M08_UP_SQL);
        await c.query(M11_UP_SQL);
        await c.query('INSERT INTO public.pgmigrations (name, run_on) VALUES ($1, now()), ($2, now()), ($3, now())', [M07_MIGRATION_NAME, M08_MIGRATION_NAME, M11_MIGRATION_NAME]);
      }
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      c.release();
    }
  }

  beforeAll(async () => {
    router = http.createServer((request, response) => {
      request.resume();
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ trip: { summary: { length: 2.5, time: 420 } } }));
    });
    await new Promise<void>((resolve) => router.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(router.address() as AddressInfo).port}`;
    client = await startAuthApp({}, { relaxTimeouts: true, configOverride: { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY } }, overrides: [{ provide: M14_ROUTING, useValue: { origin, timeoutMs: 3000 } }] });
    admin = await startAdminApp({ activationDisabledTest: true });
    // Back to the schema of main: M07 is taken off through its own Down (it is empty, so the safety latch lets it go).
    await runMigration(M07_DOWN_SQL, 'delete');
    m07Applied = false;
    system = await systemSession(admin);
    recorder = await activatedAdmin(`Admin ghi ${tag}`);
    recorderLogin = await login(recorder);
    expect((await adminSend(systemLogin(), `/finance/access/admins/${recorder.userId}/grant`, { permission_key: RECORD, expected_version: 0 })).status).toBe(200);
    const created = await adminSend(systemLogin(), '/finance/bank-accounts', { bank_id: 'VCB', account_number: String(Math.floor(1e11 + Math.random() * 9e11)), account_holder: `CONG TY ${tag}` });
    expect(created.status).toBe(201);
    accountId = String(adminData(created).account_id);
    expect((await adminSend(systemLogin(), `/finance/bank-accounts/${accountId}/receiving`, { expected_version: 1, can_receive: true })).status).toBe(200);
    shop = await createShopOwner(client);
  });

  afterAll(async () => {
    try {
      if (!m07Applied) {
        await runMigration(M07_UP_SQL, 'insert');
        m07Applied = true;
      }
      await removeCommittedRows();
    } finally {
      await client.close();
      await admin.close();
      await new Promise<void>((resolve) => router.close(() => resolve()));
    }
  });

  /** Everything this suite committed, newest dependants first, with only the user triggers of those tables lifted for the transaction. */
  async function removeCommittedRows(): Promise<void> {
    const c: PoolClient = await pool().connect();
    const tables = ['wallet_ledger_entries', 'wallet_holds', 'delivery_incidents', 'delivery_events', 'delivery_assignments', 'deliveries', 'shipping_fee_agreement_events', 'shipping_fee_agreements', 'shipping_fee_policy_versions', 'admin_finance_grants'];
    try {
      await c.query('BEGIN');
      for (const table of tables) {
        await c.query(`ALTER TABLE app.${table} DISABLE TRIGGER USER`);
      }
      const wallets = `SELECT wallet_id FROM app.driver_wallets WHERE driver_id = ANY($1::uuid[])`;
      const mine = `SELECT delivery_id FROM app.deliveries WHERE shop_id = $1::uuid`;
      const ids = shippers.map((s) => s.driverId);
      await c.query(`DELETE FROM app.wallet_ledger_entries WHERE commission_assignment_id IS NOT NULL AND wallet_id IN (${wallets})`, [ids]);
      await c.query(`DELETE FROM app.wallet_holds WHERE wallet_id IN (${wallets})`, [ids]);
      await c.query(`DELETE FROM app.delivery_incidents WHERE delivery_id IN (${mine})`, [shop.shopId]);
      await c.query(`DELETE FROM app.delivery_events WHERE delivery_id IN (${mine})`, [shop.shopId]);
      await c.query(`DELETE FROM app.shipping_fee_agreement_events WHERE agreement_id IN (SELECT agreement_id FROM app.shipping_fee_agreements WHERE delivery_id IN (${mine}))`, [shop.shopId]);
      await c.query(`DELETE FROM app.shipping_fee_agreements WHERE delivery_id IN (${mine})`, [shop.shopId]);
      await c.query(`DELETE FROM app.delivery_assignments WHERE delivery_id IN (${mine})`, [shop.shopId]);
      await c.query('DELETE FROM app.deliveries WHERE shop_id = $1::uuid', [shop.shopId]);
      await c.query('DELETE FROM app.shipper_latest_locations WHERE driver_id = ANY($1::uuid[])', [ids]);
      if (addedPolicy) {
        await c.query('DELETE FROM app.shipping_fee_policy_versions');
      }
      await c.query('DELETE FROM app.admin_finance_grants');
      for (const table of tables) {
        await c.query(`ALTER TABLE app.${table} ENABLE TRIGGER USER`);
      }
      await c.query('COMMIT');
      for (const s of shippers) {
        await purgePhone(pool(), s.phone.normalized); // wallets, ledger (TOPUP), topups, bank records, requests, driver, user
      }
      await c.query('BEGIN');
      await c.query('ALTER TABLE app.system_owned_bank_accounts DISABLE TRIGGER wallet_system_accounts_no_delete');
      await c.query('DELETE FROM app.system_owned_bank_accounts WHERE system_account_id = $1::uuid', [accountId]);
      await c.query('ALTER TABLE app.system_owned_bank_accounts ENABLE TRIGGER wallet_system_accounts_no_delete');
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      c.release();
    }
  }

  // ---- admin side ------------------------------------------------------------------------------------------------------------------

  async function activatedAdmin(fullName: string): Promise<{ phone: Phone; userId: string; secret: string }> {
    const phone = randomPhone();
    admin.track(phone.normalized);
    const permissions = [{ app: 'DRIVER', can_view: true, can_review_profile: false, can_lock: false }];
    const invitation = await createInvitation(admin, system, createPayload(phone.local, { full_name: fullName, permissions }));
    const token = invitation.link.split('#t=')[1] as string;
    const session = await begin(admin, { invitationId: invitation.invitationId, token, phone });
    ok(await post(admin, '/password', session, { password: ADMIN_PASSWORD }));
    const secret = String(adminData(ok(await post(admin, '/totp/enrollment', session))).secret);
    ok(await post(admin, '/complete', session, { code: totpNow(secret) }));
    const found = await pool().query<{ user_id: string }>('SELECT user_id FROM app.users WHERE phone_normalized = $1', [phone.normalized]);
    return { phone, userId: (found.rows[0] as { user_id: string }).user_id, secret };
  }

  async function login(who: { phone: Phone; userId: string; secret: string }): Promise<Login> {
    const preauth = await loginStep(admin, { phone: who.phone, password: ADMIN_PASSWORD, userId: who.userId });
    await rewindAcceptedStep(admin, who.userId);
    const verified = await admin.call('POST', '/totp/verify', { body: { code: totpNow(who.secret) }, cookies: preauthCookies(preauth), csrf: preauth.csrf });
    if (verified.status !== 200) {
      throw new Error(`admin login failed: ${verified.status} ${verified.text}`);
    }
    return { cookie: String(cookieFrom(verified, ADMIN_SESSION_COOKIE)), csrf: String(adminData(verified).csrf_token) };
  }

  const systemLogin = (): Login => ({ cookie: system.login.cookie, csrf: system.login.csrf });
  async function adminSend(who: Login, path: string, body: unknown, key: string = randomUUID()): Promise<AdminResponse> {
    await admin.clearLimits();
    return admin.call('POST', path, { basePath: '/v1/admin', body, cookies: sessionCookies(who), csrf: who.csrf, headers: { 'idempotency-key': key } });
  }

  // ---- Shipper / shop side ---------------------------------------------------------------------------------------------------------

  const asShipper = (s: Shipper, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, key: string = randomUUID()): Promise<ApiResponse> =>
    client.call(method, path, { bearer: s.token, ...(method !== 'GET' ? { headers: { 'idempotency-key': key } } : {}), ...(body === undefined ? {} : { body }) });
  const asShop = (method: 'GET' | 'POST', path: string, body?: unknown): Promise<ApiResponse> =>
    client.call(method, path, { bearer: shop.token, ...(method === 'POST' ? { headers: { 'idempotency-key': randomUUID() } } : {}), ...(body === undefined ? {} : { body }) });

  /** An ACTIVE Shipper with a verified bank, in the DRIVER context, a fresh position near the shop and an EMPTY wallet (the money comes from a real top-up). */
  async function newShipper(): Promise<Shipper> {
    const phone = randomPhone();
    client.track(phone.normalized);
    const proof = await obtainProof(client, phone);
    const registered = await client.call('POST', '/client-auth/register', {
      headers: { 'idempotency-key': randomUUID() },
      body: { phone: phone.local, password: PASSWORD, verification_token: proof.proofToken, device: { device_id: 'web-food-0009', platform: 'WEB', app: 'FOOD' }, full_name: `Shipper ${tag}`, consent: { terms_version: TERMS, privacy_version: PRIVACY } },
    });
    expect(registered.status).toBe(201);
    const userId = String(dataOf(registered).user_id);
    const loggedIn = await client.call('POST', '/client-auth/login', { headers: { 'idempotency-key': randomUUID() }, body: { phone: phone.local, password: PASSWORD, device: { device_id: 'web-ship-0009', platform: 'WEB', app: 'SHIP' } } });
    const token = String(dataOf(loggedIn).access_token);
    const created = await client.call('POST', '/onboarding/driver', { bearer: token, headers: { 'idempotency-key': randomUUID() }, body: { full_name: `Shipper ${tag}`, plate_number: '59X1-123.45' } });
    expect(created.status).toBe(201);
    const driverId = String(dataOf(created).driver_id);
    await pool().query(`UPDATE app.drivers SET status = 'ACTIVE', accepting_deliveries = true, review_state = 'APPROVED' WHERE driver_id = $1::uuid`, [driverId]);
    await pool().query(
      `INSERT INTO app.driver_bank_accounts (driver_id, bank_code, bank_name, account_number, account_holder, verification_state, verified_by, verified_at, created_at, updated_at)
       VALUES ($1::uuid, 'VCB', 'Vietcombank', '0123456789', 'SHIPPER', 'VERIFIED', $2::uuid, now(), now(), now())`,
      [driverId, userId],
    );
    expect((await client.call('POST', '/auth/role/select', { bearer: token, body: { role: 'DRIVER' } })).status).toBe(200);
    const wallet = await pool().query<{ wallet_id: string }>('SELECT wallet_id FROM app.driver_wallets WHERE driver_id = $1::uuid', [driverId]);
    let walletId = wallet.rows[0]?.wallet_id;
    if (walletId === undefined) {
      walletId = randomUUID();
      await pool().query(`INSERT INTO app.driver_wallets (wallet_id, driver_id, balance_vnd, held_vnd, version, created_at, updated_at) VALUES ($1::uuid, $2::uuid, 0, 0, 1, now(), now())`, [walletId, driverId]);
    }
    const shipper: Shipper = { phone, userId, token, driverId, walletId };
    shippers.push(shipper);
    return shipper;
  }

  /** The latest position lives in an M07 table, so it can only be reported once M07 is in. */
  async function reportLocation(s: Shipper): Promise<void> {
    const located = await asShipper(s, 'PUT', '/driver/location', { lat: 21.0005, lng: 105.8005, accuracy_m: 20 });
    expect([200, 204]).toContain(located.status);
  }

  /** The product's own path: the Shipper asks (HTTP), the Admin with the record right confirms against the bank statement (HTTP, M04's posting service). */
  async function realTopup(s: Shipper, amount: number): Promise<void> {
    const requested = await asShipper(s, 'POST', '/driver/wallet/topup-requests', { amount_vnd: amount });
    expect([requested.status, requested.text.slice(0, 200)]).toEqual([201, requested.text.slice(0, 200)]);
    const request = dataOf(requested) as Json;
    const confirmed = await adminSend(recorderLogin, `/finance/topup-requests/${String(request.request_id)}/confirm`, {
      expected_version: Number(request.version),
      actual_amount_vnd: amount,
      bank_id: 'VCB',
      system_owned_account_id: accountId,
      canonical_transaction_id: `FT${Math.floor(1e11 + Math.random() * 9e11)}`,
      received_at: new Date(Date.now() - 60_000).toISOString(),
    });
    expect([confirmed.status, confirmed.text.slice(0, 300)]).toEqual([200, confirmed.text.slice(0, 300)]);
  }

  interface Snapshot {
    readonly wallet: Json;
    readonly ledger: Json[];
    readonly topups: Json[];
    readonly bank: Json[];
    readonly requests: Json[];
  }
  async function snapshot(s: Shipper): Promise<Snapshot> {
    const q = async (sql: string): Promise<Json[]> => (await pool().query(sql, [s.walletId])).rows as Json[];
    return {
      wallet: ((await q('SELECT wallet_id, driver_id, balance_vnd, held_vnd, version FROM app.driver_wallets WHERE wallet_id = $1::uuid'))[0]) as Json,
      ledger: await q('SELECT entry_id, sequence_no, entry_kind, delta_vnd, balance_after_vnd, topup_id FROM app.wallet_ledger_entries WHERE wallet_id = $1::uuid ORDER BY sequence_no'),
      topups: await q('SELECT topup_id, request_id, bank_record_id, actual_amount_vnd FROM app.wallet_topups WHERE wallet_id = $1::uuid ORDER BY topup_id'),
      bank: await q('SELECT b.bank_record_id, b.amount_vnd FROM app.wallet_bank_transactions b JOIN app.wallet_topups t ON t.bank_record_id = b.bank_record_id WHERE t.wallet_id = $1::uuid ORDER BY b.bank_record_id'),
      requests: await q('SELECT request_id, state, amount_requested_vnd FROM app.wallet_topup_requests WHERE wallet_id = $1::uuid ORDER BY request_id'),
    };
  }
  const money = async (s: Shipper): Promise<{ balance: number; held: number }> => {
    const w = (await pool().query<{ balance_vnd: string; held_vnd: string }>('SELECT balance_vnd, held_vnd FROM app.driver_wallets WHERE wallet_id = $1::uuid', [s.walletId])).rows[0];
    return { balance: Number(w?.balance_vnd), held: Number(w?.held_vnd) };
  };
  const ledgerSum = async (s: Shipper): Promise<number> => Number((await pool().query<{ sum: string }>('SELECT COALESCE(SUM(delta_vnd), 0)::text AS sum FROM app.wallet_ledger_entries WHERE wallet_id = $1::uuid', [s.walletId])).rows[0]?.sum);
  const gateDefinition = async (): Promise<string> => String((await pool().query('SELECT pg_get_functiondef(\'app.wallet_ledger_source_gate\'::regproc) AS def')).rows[0]?.def);

  const deliveryBody = (): Json => ({ recipient_name: 'Khách nhận', recipient_phone: '0912345678', dropoff_address_text: '12 Phố Huế, Hai Bà Trưng, Hà Nội', dropoff_lat: 21.0, dropoff_lng: 105.82, goods_description: 'Hộp quà', goods_value_vnd: 200_000, paid_vnd: 0, fee_payer: 'CUSTOMER' });
  async function acceptNew(s: Shipper): Promise<Json> {
    const created = await asShop('POST', '/shop/me/deliveries', deliveryBody());
    expect(created.status).toBe(201);
    const accepted = await asShipper(s, 'POST', `/driver/deliveries/${String((dataOf(created) as Json).delivery_id)}/accept`, {});
    expect([accepted.status, accepted.text.slice(0, 300)]).toEqual([200, accepted.text.slice(0, 300)]);
    return dataOf(accepted) as Json;
  }

  // ---- tests (in order: they share the database state) ------------------------------------------------------------------------------

  let shipper: Shipper;
  let before: Snapshot;

  it('on the schema of main (M07 taken off by its own Down) the gate still posts TOPUP through the real Admin confirmation, and nothing else', async () => {
    const def = await gateDefinition();
    expect(def).toContain("entry_kind = 'TOPUP'");
    expect(def).not.toContain('COMMISSION_DEBIT');
    shipper = await newShipper();
    await realTopup(shipper, 100_000);
    await realTopup(shipper, 120_000);
    before = await snapshot(shipper);
    expect(before.ledger.map((row) => [row.entry_kind, Number(row.delta_vnd), Number(row.balance_after_vnd)])).toEqual([['TOPUP', 100_000, 100_000], ['TOPUP', 120_000, 220_000]]);
    expect(await money(shipper)).toEqual({ balance: 220_000, held: 0 });
    expect(before.requests.every((r) => r.state === 'CONFIRMED')).toBe(true);
  });

  it('the M07 migration is refused when the ledger holds anything but TOPUP rows with their topup record, and then touches nothing', async () => {
    const c = await pool().connect();
    try {
      await c.query('BEGIN');
      await c.query('ALTER TABLE app.wallet_ledger_entries DISABLE TRIGGER USER');
      await c.query(
        `INSERT INTO app.wallet_ledger_entries (entry_id, wallet_id, sequence_no, entry_kind, delta_vnd, balance_after_vnd, created_at) VALUES ($1::uuid, $2::uuid, 3, 'ADJUSTMENT_CREDIT', 1000, 221000, now())`,
        [randomUUID(), shipper.walletId],
      );
      await c.query('SAVEPOINT m07');
      const refused = await c.query(M07_UP_SQL).then(() => undefined, (error: unknown) => error);
      expect(String(refused)).toContain('M07_MIGRATION_REFUSED');
      await c.query('ROLLBACK TO SAVEPOINT m07');
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release();
    }
    expect(await snapshot(shipper)).toEqual(before);
    expect(await countTables()).toBe(0);
  });

  const countTables = async (): Promise<number> => (await pool().query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name IN ('deliveries', 'delivery_assignments')`)).rowCount ?? 0;

  it('applying the M07 migration over that money keeps every transaction, the balance and the history exactly as they were', async () => {
    await runMigration(M07_UP_SQL, 'insert');
    m07Applied = true;
    expect(await countTables()).toBe(2);
    expect(await snapshot(shipper)).toEqual(before);
    const def = await gateDefinition();
    expect(def).toContain("entry_kind = 'TOPUP'");
    expect(def).toContain('COMMISSION_DEBIT');
    // The fee table M06 needs, then the M07 flows below.
    const existing = await pool().query('SELECT 1 FROM app.shipping_fee_policy_versions LIMIT 1');
    if ((existing.rowCount ?? 0) === 0) {
      await pool().query(`INSERT INTO app.shipping_fee_policy_versions (version_id, version_no, schema_version, tiers, applied_by, applied_at) VALUES ($1::uuid, 1, 2, $2::jsonb, $3::uuid, now())`, [
        randomUUID(),
        JSON.stringify([{ from_m: 0, to_m: 3000, fee_vnd: 10000 }, { from_m: 3000, to_m: 6000, fee_vnd: 15000 }, { from_m: 6000, to_m: 10000, fee_vnd: 20000 }]),
        shop.userId,
      ]);
      addedPolicy = true;
    }
  });

  it('after the upgrade a Shipper can still top up (a third real TOPUP posts and the chain continues)', async () => {
    await realTopup(shipper, 110_000);
    const after = await snapshot(shipper);
    expect(after.ledger.map((row) => Number(row.sequence_no))).toEqual([1, 2, 3]);
    expect(after.ledger.slice(0, 2)).toEqual(before.ledger);
    expect(await money(shipper)).toEqual({ balance: 330_000, held: 0 });
    expect(await ledgerSum(shipper)).toBe(330_000);
  });

  it('accept holds the commission, complete debits it exactly once, cancel and fail release it', async () => {
    await reportLocation(shipper);
    // accept + complete
    const a = await acceptNew(shipper);
    expect(await money(shipper)).toEqual({ balance: 330_000, held: 1000 });
    const picked = dataOf(await asShipper(shipper, 'POST', `/driver/deliveries/${String(a.delivery_id)}/pickup`, { expected_version: a.version })) as Json;
    const done = await asShipper(shipper, 'POST', `/driver/deliveries/${String(a.delivery_id)}/complete`, { expected_version: picked.version });
    expect([done.status, done.text.slice(0, 200)]).toEqual([200, done.text.slice(0, 200)]);
    expect(await money(shipper)).toEqual({ balance: 329_000, held: 0 });
    expect((await pool().query(`SELECT 1 FROM app.wallet_ledger_entries WHERE wallet_id = $1::uuid AND entry_kind = 'COMMISSION_DEBIT' AND delta_vnd = -1000`, [shipper.walletId])).rowCount).toBe(1);
    // accept + shop cancel
    const b = await acceptNew(shipper);
    expect(await money(shipper)).toEqual({ balance: 329_000, held: 1000 });
    expect((await asShop('POST', `/shop/me/deliveries/${String(b.delivery_id)}/cancel`, { reason: 'Đổi ý', expected_version: b.version })).status).toBe(200);
    expect(await money(shipper)).toEqual({ balance: 329_000, held: 0 });
    // accept + shipper release
    const c = await acceptNew(shipper);
    expect((await asShipper(shipper, 'POST', `/driver/deliveries/${String(c.delivery_id)}/release`, { reason: 'Xe hỏng', expected_version: c.version })).status).toBe(200);
    expect(await money(shipper)).toEqual({ balance: 329_000, held: 0 });
    // accept + pickup + fail
    const d = await acceptNew(shipper);
    const pickedD = dataOf(await asShipper(shipper, 'POST', `/driver/deliveries/${String(d.delivery_id)}/pickup`, { expected_version: d.version })) as Json;
    const failed = await asShipper(shipper, 'POST', `/driver/deliveries/${String(d.delivery_id)}/fail`, { expected_version: pickedD.version, reason_code: 'OTHER', goods_condition: 'WITH_SHIPPER', note: 'x' });
    expect([failed.status, failed.text.slice(0, 200)]).toEqual([200, failed.text.slice(0, 200)]);
    expect(await money(shipper)).toEqual({ balance: 329_000, held: 0 });
    // Everything adds up: balance = ledger, the TOPUP rows are the ones from before, and exactly one debit was ever taken.
    expect(await ledgerSum(shipper)).toBe(329_000);
    const kinds = (await pool().query<{ entry_kind: string }>('SELECT entry_kind FROM app.wallet_ledger_entries WHERE wallet_id = $1::uuid ORDER BY sequence_no', [shipper.walletId])).rows.map((row) => row.entry_kind);
    expect(kinds).toEqual(['TOPUP', 'TOPUP', 'TOPUP', 'COMMISSION_DEBIT']);
  });

  it('the ledger gate still refuses every source it must refuse (withdrawal, adjustments, a topup without its record, a debit without its captured hold)', async () => {
    const attempt = async (kind: string, delta: number, extra: { topup?: string | null; assignment?: string | null } = {}): Promise<string> => {
      const c = await pool().connect();
      try {
        await c.query('BEGIN');
        const error = await c
          .query(
            `INSERT INTO app.wallet_ledger_entries (entry_id, wallet_id, sequence_no, entry_kind, delta_vnd, balance_after_vnd, created_at, topup_id, commission_assignment_id)
             VALUES (gen_random_uuid(), $1::uuid, 99, $2, $3, 1000, now(), $4::uuid, $5::uuid)`,
            [shipper.walletId, kind, delta, extra.topup ?? null, extra.assignment ?? null],
          )
          .then(() => undefined, (e: unknown) => e);
        return String(error);
      } finally {
        await c.query('ROLLBACK').catch(() => undefined);
        c.release();
      }
    };
    const topup = (await pool().query<{ topup_id: string }>('SELECT topup_id FROM app.wallet_topups WHERE wallet_id = $1::uuid LIMIT 1', [shipper.walletId])).rows[0]?.topup_id as string;
    const assignment = (await pool().query<{ assignment_id: string }>('SELECT assignment_id FROM app.delivery_assignments WHERE driver_id = $1::uuid LIMIT 1', [shipper.driverId])).rows[0]?.assignment_id as string;
    for (const [label, message] of [
      ['withdrawal', await attempt('WITHDRAWAL_DEBIT', -1000)],
      ['adjustment credit', await attempt('ADJUSTMENT_CREDIT', 1000)],
      ['adjustment debit', await attempt('ADJUSTMENT_DEBIT', -1000)],
      ['topup without a record', await attempt('TOPUP', 1000)],
      ['topup with a wrong amount', await attempt('TOPUP', 777, { topup })],
      ['commission debit without an assignment', await attempt('COMMISSION_DEBIT', -1000)],
      ['commission debit for a released assignment', await attempt('COMMISSION_DEBIT', -1000, { assignment })],
    ] as const) {
      expect([label, message.includes('WALLET_LEDGER_SOURCE_NOT_AVAILABLE')]).toEqual([label, true]);
    }
  });

  it("the M07 Down is refused while delivery or commission rows exist (nothing lost), and the TOPUP money is not delivery history", async () => {
    const c = await pool().connect();
    try {
      await c.query('BEGIN');
      const refused = await c.query(M07_DOWN_SQL).then(() => undefined, (error: unknown) => error);
      expect(String(refused)).toContain('M07_DOWN_REFUSED');
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release();
    }
    expect(await ledgerSum(shipper)).toBe(329_000);
    expect(await countTables()).toBe(2);
  });
});
