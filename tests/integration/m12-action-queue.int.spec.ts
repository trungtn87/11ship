import { randomBytes, randomUUID } from 'node:crypto';
import { purgeShopDisplayCodes } from './support/shop-display-fixtures';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import { ADMIN_PASSWORD, AdminApp, adminData, adminErrorCode, AdminResponse, startAdminApp } from './support/admin-fixtures';
import { createActiveShopFor, createDriverFor, purgePhone, randomPhone } from './support/auth-fixtures';
import { ActivatedAdmin, activatedAdmin, changeGrant, getAs, Login, permission, postAs, purgeDeliveriesOfShops, purgeGrants, seedDelivery, systemLoginOf } from './support/m12-fixtures';
import { systemSession, SystemSession } from './support/provisioning-fixtures';

// M12 "Việc cần xử lý" (#216) on a REAL PostgreSQL and the real administration pipeline. The database is shared with other suites, so every figure is checked
// through the rows THIS suite seeded (their codes / ids), never through global totals. What is proved: each file appears once and the same file read twice is
// the same row, it leaves the queue when its owner finishes it (money confirmed, entitlement granted), a source the actor may not see is FORBIDDEN and not an
// empty list, a view-only actor is offered "VIEW" and no handling, a revoked right stops at the very next call, and the query is strict.

const tag = randomBytes(3).toString('hex').toUpperCase();
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const HOUR = 3_600_000;

describe('M12 — Việc cần xử lý (action queue)', () => {
  let admin: AdminApp;
  let system: SystemSession;
  let driverViewer: ActivatedAdmin;
  let shopId = '';
  let hash = '';
  const shopIds: string[] = [];
  const shippers: Array<{ phone: ReturnType<typeof randomPhone> }> = [];
  const accountIds: string[] = [];

  beforeAll(async () => {
    admin = await startAdminApp({ activationDisabledTest: true });
    system = await systemSession(admin);
    driverViewer = await activatedAdmin(admin, system, [permission('DRIVER')], `Xem hàng đợi ${tag}`);
    shopId = await createActiveShopFor(admin.pool, system.account.userId);
    shopIds.push(shopId);
    hash = await new Argon2idPasswordHasher().hash(ADMIN_PASSWORD);
  });

  afterAll(async () => {
    try {
      await purgeDeliveriesOfShops(admin.pool, shopIds);
      for (const shipper of shippers) {
        await purgePhone(admin.pool, shipper.phone.normalized);
      }
      const client = await admin.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('ALTER TABLE app.shop_entitlement_grants DISABLE TRIGGER USER');
        await client.query('DELETE FROM app.shop_entitlement_grants WHERE shop_id = ANY($1::uuid[])', [shopIds]);
        await client.query('ALTER TABLE app.shop_entitlement_grants ENABLE TRIGGER USER');
        await client.query('ALTER TABLE app.business_finance_messages DISABLE TRIGGER USER');
        await client.query('DELETE FROM app.business_finance_messages WHERE request_id IN (SELECT request_id FROM app.business_finance_requests WHERE shop_id = ANY($1::uuid[]))', [shopIds]);
        await client.query('ALTER TABLE app.business_finance_messages ENABLE TRIGGER USER');
        await client.query('ALTER TABLE app.business_finance_requests DISABLE TRIGGER USER');
        await client.query('DELETE FROM app.business_finance_requests WHERE shop_id = ANY($1::uuid[])', [shopIds]);
        await client.query('ALTER TABLE app.business_finance_requests ENABLE TRIGGER USER');
        await client.query('ALTER TABLE app.system_owned_bank_accounts DISABLE TRIGGER wallet_system_accounts_no_delete');
        await client.query('DELETE FROM app.system_owned_bank_accounts WHERE system_account_id = ANY($1::uuid[])', [accountIds]);
        await client.query('ALTER TABLE app.system_owned_bank_accounts ENABLE TRIGGER wallet_system_accounts_no_delete');
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
      await purgeGrants(admin.pool);
      await admin.pool.query('DELETE FROM app.shop_members WHERE shop_id = ANY($1::uuid[])', [shopIds]);
      await purgeShopDisplayCodes(admin.pool, shopIds);
      await admin.pool.query('DELETE FROM app.shops WHERE shop_id = ANY($1::uuid[])', [shopIds]);
    } finally {
      await admin.close();
    }
  });

  const queue = (who: Login | undefined, query = ''): Promise<AdminResponse> => getAs(admin, who, `/overview/action-queue${query === '' ? '' : `?${query}`}`);
  const data = async (who: Login, query?: string): Promise<Json> => {
    const response = await queue(who, query);
    expect([response.status, response.text.slice(0, 300)]).toEqual([200, response.text.slice(0, 300)]);
    return adminData(response) as Json;
  };
  const sourceOf = (body: Json, kind: string): Json => (body.sources as Json[]).find((source) => source.kind === kind) as Json;
  const itemsOf = (body: Json, kind: string): Json[] => (body.items as Json[]).filter((item) => item.kind === kind);
  const shopName = async (): Promise<string> => String((await admin.pool.query('SELECT name FROM app.shops WHERE shop_id = $1::uuid', [shopId])).rows[0].name);
  const insertPayment = async (state: 'PENDING' | 'CONFIRMED', ageMs: number, reminded = false): Promise<string> => {
    const requestId = randomUUID();
    await admin.pool.query(
      `INSERT INTO app.business_finance_requests (request_id, kind, owner_user_id, shop_id, amount_requested_vnd, actual_amount_vnd, state, created_at, resolved_at, resolved_by, reminded_at)
       VALUES ($1::uuid, 'SHOP_PAYMENT', $2::uuid, $3::uuid, 200000, CASE WHEN $4 = 'CONFIRMED' THEN 200000 END, $4, now() - ($5::bigint * interval '1 millisecond'),
               CASE WHEN $4 = 'CONFIRMED' THEN now() - ($5::bigint * interval '1 millisecond') + interval '1 minute' END, CASE WHEN $4 = 'CONFIRMED' THEN $2::uuid END,
               CASE WHEN $6::boolean THEN now() END)`,
      [requestId, system.account.userId, shopId, state, ageMs, reminded],
    );
    return requestId;
  };

  it('1. the query is strict and a session is required; an unknown kind, status, day or order is refused', async () => {
    expect((await queue(undefined)).status).toBe(401);
    for (const query of ['kind=NOPE', 'status=lower', 'from=2026-02-30', 'to=bogus', 'from=2026-10-02&to=2026-10-01', 'sort=random', 'bogus=1', 'kind=COMPLAINT&kind=GOODS_OPEN']) {
      const response = await queue(systemLoginOf(system), query);
      expect([query, response.status, adminErrorCode(response)]).toEqual([query, 400, 'ADMIN_INPUT_INVALID']);
    }
    expect((await queue(systemLoginOf(system), 'kind=COMPLAINT&status=PENDING&from=2026-01-01&to=2026-12-31&sort=newest')).status).toBe(200);
  });

  it('2. rights: a DRIVER-view administrator reads the delivery files but every finance source, the Shipper review and shop payments are FORBIDDEN (never an empty list or 0)', async () => {
    const asSystem = await data(systemLoginOf(system));
    expect((asSystem.sources as Json[]).map((source) => source.status)).not.toContain('FORBIDDEN');
    const driver = await data(driverViewer.login);
    for (const kind of ['DELIVERY_STOPPED', 'ORDER_AWAITING_CONFIRMATION', 'GOODS_OPEN', 'COMPLAINT']) {
      expect(sourceOf(driver, kind).status).toBe('OK');
    }
    for (const kind of ['SHIPPER_REVIEW', 'ADJUSTMENT_PENDING_FINANCE', 'TOPUP_PENDING', 'WITHDRAWAL_OPEN', 'SHOP_PAYMENT_PENDING', 'SHOP_PAYMENT_AWAITING_GRANT']) {
      expect(sourceOf(driver, kind)).toEqual({ kind, status: 'FORBIDDEN' });
    }
    expect((driver.items as Json[]).every((item) => !['SHIPPER_REVIEW', 'TOPUP_PENDING', 'SHOP_PAYMENT_PENDING'].includes(item.kind))).toBe(true);
  });

  it('3. a stopped search is ONE file, the same on every read; a search that was called again is not in the queue; viewing the delivery list is not handling', async () => {
    // seedDelivery stops the search 30 minutes after creation, so created 2.5 h ago means waiting since 2 h ago.
    const stopped = await seedDelivery(admin.pool, { shopId, userId: system.account.userId, state: 'search_stopped', createdAtIso: new Date(Date.now() - 2.5 * HOUR).toISOString() });
    const recalled = await seedDelivery(admin.pool, { shopId, userId: system.account.userId, state: 'search_stopped' });
    await seedDelivery(admin.pool, { shopId, userId: system.account.userId, previousDeliveryId: recalled });
    const mine = (body: Json): Json[] => itemsOf(body, 'DELIVERY_STOPPED').filter((item) => item.key.endsWith(stopped) || item.key.endsWith(recalled));
    const first = await data(systemLoginOf(system), 'kind=DELIVERY_STOPPED');
    const second = await data(systemLoginOf(system), 'kind=DELIVERY_STOPPED');
    expect(mine(first).map((item) => item.key)).toEqual([`DELIVERY_STOPPED|${stopped}`]);
    expect(mine(second)).toEqual(mine(first).map((item) => ({ ...item, age_seconds: expect.any(Number) })));
    const item = mine(first)[0] as Json;
    expect(item).toMatchObject({ status: 'search_stopped', action: 'VIEW', overdue: null, link: { area: 'deliveries', query: { group: 'stopped' } } });
    expect(item.age_seconds).toBeGreaterThanOrEqual(2 * 3600);
    const viewer = await data(driverViewer.login, 'kind=DELIVERY_STOPPED');
    expect(mine(viewer)[0]?.action).toBe('VIEW');
  });

  it('4. shop payment: pending is a file; once CONFIRMED but not yet granted it stays (one per shop, never from chat); granting the entitlement removes it; rights decide VIEW / HANDLE and a revoked right stops at the next call', async () => {
    const name = await shopName();
    const pending = await insertPayment('PENDING', 3 * HOUR, true);
    const before = await data(systemLoginOf(system), 'kind=SHOP_PAYMENT_PENDING');
    const mineBefore = itemsOf(before, 'SHOP_PAYMENT_PENDING').filter((item) => item.code === name);
    expect(mineBefore).toHaveLength(1);
    expect(mineBefore[0]).toMatchObject({ key: `SHOP_PAYMENT_PENDING|shop-payment:${pending}`, status: 'PENDING', overdue: true, link: { area: 'business-finance', query: { request: pending } } });

    // The money is confirmed (three payments for the same shop): the pending file leaves, ONE "waiting for the grant" file for the shop appears.
    await admin.pool.query(`UPDATE app.business_finance_requests SET state = 'CONFIRMED', actual_amount_vnd = 200000, resolved_at = created_at + interval '1 minute', resolved_by = $2::uuid, version = version + 1 WHERE request_id = $1::uuid`, [pending, system.account.userId]);
    const firstConfirmed = await insertPayment('CONFIRMED', 5 * HOUR);
    const secondConfirmed = await insertPayment('CONFIRMED', 1 * HOUR);
    const waiting = await data(systemLoginOf(system), 'kind=SHOP_PAYMENT_AWAITING_GRANT');
    const granted = itemsOf(waiting, 'SHOP_PAYMENT_AWAITING_GRANT').filter((item) => item.code === name);
    expect(granted).toHaveLength(1);
    expect(granted[0]).toMatchObject({ status: 'CONFIRMED', overdue: null, action: 'HANDLE', detail: { confirmed_payments: 3 }, link: { area: 'business-finance', query: { request: secondConfirmed } } });
    expect(granted[0]?.age_seconds).toBeGreaterThanOrEqual(5 * 3600 - 60);
    expect(firstConfirmed).not.toBe(secondConfirmed);
    expect(itemsOf(await data(systemLoginOf(system), 'kind=SHOP_PAYMENT_PENDING'), 'SHOP_PAYMENT_PENDING').filter((item) => item.code === name)).toHaveLength(0);

    // View-only: shop.payment.read shows the file but offers no handling; shop.entitlement.manage adds it; revoking it stops at the very next call.
    const reader = await activatedAdmin(admin, system, [permission('SHOP')], `Đọc thanh toán ${tag}`);
    expect(sourceOf(await data(reader.login), 'SHOP_PAYMENT_AWAITING_GRANT')).toEqual({ kind: 'SHOP_PAYMENT_AWAITING_GRANT', status: 'FORBIDDEN' });
    expect((await changeGrant(admin, system, 'grant', reader.userId, 'shop.payment.read', 0)).status).toBe(200);
    const viewOnly = await data(reader.login, 'kind=SHOP_PAYMENT_AWAITING_GRANT');
    expect(itemsOf(viewOnly, 'SHOP_PAYMENT_AWAITING_GRANT').find((item) => item.code === name)?.action).toBe('VIEW');
    expect((await changeGrant(admin, system, 'grant', reader.userId, 'shop.entitlement.manage', 0)).status).toBe(200);
    expect(itemsOf(await data(reader.login, 'kind=SHOP_PAYMENT_AWAITING_GRANT'), 'SHOP_PAYMENT_AWAITING_GRANT').find((item) => item.code === name)?.action).toBe('HANDLE');
    expect((await changeGrant(admin, system, 'revoke', reader.userId, 'shop.payment.read', 1)).status).toBe(200);
    expect((await changeGrant(admin, system, 'revoke', reader.userId, 'shop.entitlement.manage', 1)).status).toBe(200);
    expect(sourceOf(await data(reader.login), 'SHOP_PAYMENT_AWAITING_GRANT')).toEqual({ kind: 'SHOP_PAYMENT_AWAITING_GRANT', status: 'FORBIDDEN' });

    // The entitlement is granted after the confirmation: the file leaves; history stays in the payment room.
    await admin.pool.query(`INSERT INTO app.shop_entitlement_grants (grant_id, shop_id, entitlement, action, reason, actor_user_id, created_at) VALUES ($1::uuid, $2::uuid, 'MENU_EXPANDED', 'GRANT', 'Đã nhận tiền', $3::uuid, clock_timestamp())`, [randomUUID(), shopId, system.account.userId]);
    const done = await data(systemLoginOf(system), 'kind=SHOP_PAYMENT_AWAITING_GRANT');
    expect(itemsOf(done, 'SHOP_PAYMENT_AWAITING_GRANT').filter((item) => item.code === name)).toHaveLength(0);
    // A later REVOKE is an administrator's decision, not an unanswered payment.
    await admin.pool.query(`INSERT INTO app.shop_entitlement_grants (grant_id, shop_id, entitlement, action, reason, actor_user_id, created_at) VALUES ($1::uuid, $2::uuid, 'MENU_EXPANDED', 'REVOKE', 'Thu hồi', $3::uuid, clock_timestamp())`, [randomUUID(), shopId, system.account.userId]);
    expect(itemsOf(await data(systemLoginOf(system), 'kind=SHOP_PAYMENT_AWAITING_GRANT'), 'SHOP_PAYMENT_AWAITING_GRANT').filter((item) => item.code === name)).toHaveLength(0);
  });

  it('5. filters and order: kind and status narrow the list, a day outside the file\'s start excludes it, oldest-first is the default and newest reverses it; the source counts ignore the filters', async () => {
    const name = await shopName();
    const older = await insertPayment('PENDING', 30 * HOUR);
    const newer = await insertPayment('PENDING', 1 * HOUR);
    const all = await data(systemLoginOf(system), 'kind=SHOP_PAYMENT_PENDING&status=PENDING');
    const keys = itemsOf(all, 'SHOP_PAYMENT_PENDING').filter((item) => item.code === name).map((item) => item.key);
    expect(keys).toEqual([`SHOP_PAYMENT_PENDING|shop-payment:${older}`, `SHOP_PAYMENT_PENDING|shop-payment:${newer}`]);
    const reversed = await data(systemLoginOf(system), 'kind=SHOP_PAYMENT_PENDING&sort=newest');
    expect(itemsOf(reversed, 'SHOP_PAYMENT_PENDING').filter((item) => item.code === name).map((item) => item.key)).toEqual(keys.slice().reverse());
    const longAgo = await data(systemLoginOf(system), 'kind=SHOP_PAYMENT_PENDING&from=2020-01-01&to=2020-01-02');
    expect(itemsOf(longAgo, 'SHOP_PAYMENT_PENDING').filter((item) => item.code === name)).toHaveLength(0);
    expect(sourceOf(longAgo, 'SHOP_PAYMENT_PENDING')).toMatchObject({ status: 'OK', count: expect.any(Number), truncated: false });
    expect(sourceOf(longAgo, 'SHOP_PAYMENT_PENDING').count).toBeGreaterThanOrEqual(2);
    expect((await data(systemLoginOf(system), 'kind=COMPLAINT')).items.every((item: Json) => item.kind === 'COMPLAINT')).toBe(true);
  });

  it('6. a Shipper top-up waits until the money is confirmed, then leaves the queue; wallet.read is needed to see it, wallet.topup.record to handle it, and a revoked right stops at the next call', async () => {
    const system$ = systemLoginOf(system);
    const number = String(Math.floor(1e11 + Math.random() * 9e11));
    const created = await postAs(admin, system$, '/finance/bank-accounts', { bank_id: 'VCB', account_number: number, account_holder: `CONG TY ${tag}` });
    expect(created.status).toBe(201);
    const accountId = String(adminData(created).account_id);
    accountIds.push(accountId);
    expect((await postAs(admin, system$, `/finance/bank-accounts/${accountId}/receiving`, { expected_version: 1, can_receive: true })).status).toBe(200);

    const phone = randomPhone();
    shippers.push({ phone });
    admin.track(phone.normalized);
    const userId = randomUUID();
    await admin.pool.query(`INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at) VALUES ($1::uuid, $2, $3, now(), 'PHONE_VERIFIED', 'ACTIVE', 1, now(), now())`, [userId, phone.normalized, hash]);
    const driverId = await createDriverFor(admin.pool, userId, { status: 'PENDING' });
    const walletId = randomUUID();
    await admin.pool.query(`INSERT INTO app.driver_wallets (wallet_id, driver_id, balance_vnd, held_vnd, version, created_at, updated_at) VALUES ($1::uuid, $2::uuid, 0, 0, 1, now(), now())`, [walletId, driverId]);
    const requestId = randomUUID();
    await admin.pool.query(`INSERT INTO app.wallet_topup_requests (request_id, wallet_id, driver_id, amount_requested_vnd, state, created_by_user_id, version, created_at, updated_at) VALUES ($1::uuid, $2::uuid, $3::uuid, 100000, 'PENDING', $4::uuid, 1, now(), now())`, [requestId, walletId, driverId, userId]);

    const reader = await activatedAdmin(admin, system, [permission('DRIVER')], `Đọc nạp ${tag}`);
    expect((await changeGrant(admin, system, 'grant', reader.userId, 'wallet.read', 0)).status).toBe(200);
    const open = async (who: Login): Promise<Json[]> => itemsOf(await data(who, 'kind=TOPUP_PENDING'), 'TOPUP_PENDING').filter((item) => item.key === `TOPUP_PENDING|topup:${requestId}`);
    const viewOnly = await open(reader.login);
    expect(viewOnly).toHaveLength(1);
    expect(viewOnly[0]).toMatchObject({ status: 'PENDING', action: 'VIEW', link: { area: 'finance-topup', query: { id: requestId } } });
    expect(await open(reader.login)).toHaveLength(1); // the same file on a second read, not a second file
    expect((await open(system$))[0]?.action).toBe('HANDLE');

    const confirmed = await postAs(admin, system$, `/finance/topup-requests/${requestId}/confirm`, {
      expected_version: 1,
      actual_amount_vnd: 60_000,
      bank_id: 'VCB',
      system_owned_account_id: accountId,
      canonical_transaction_id: `FT${Math.floor(1e11 + Math.random() * 9e11)}`,
      received_at: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(confirmed.status).toBe(200);
    expect(await open(system$)).toHaveLength(0);
    expect(await open(reader.login)).toHaveLength(0);

    expect((await changeGrant(admin, system, 'revoke', reader.userId, 'wallet.read', 1)).status).toBe(200);
    expect(sourceOf(await data(reader.login), 'TOPUP_PENDING')).toEqual({ kind: 'TOPUP_PENDING', status: 'FORBIDDEN' });
    expect(sourceOf(await data(reader.login), 'WITHDRAWAL_OPEN')).toEqual({ kind: 'WITHDRAWAL_OPEN', status: 'FORBIDDEN' });
  });
});
