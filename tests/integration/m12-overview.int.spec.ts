import { randomBytes, randomUUID } from 'node:crypto';
import { purgeShopDisplayCodes } from './support/shop-display-fixtures';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { resolvePeriod } from '../../apps/backend/src/admin-m12/vietnam-time';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import { ADMIN_PASSWORD, AdminApp, adminData, adminErrorCode, AdminResponse, startAdminApp } from './support/admin-fixtures';
import { createActiveShopFor, createDriverFor, purgePhone, randomPhone } from './support/auth-fixtures';
import { ActivatedAdmin, activatedAdmin, changeGrant, getAs, Login, permission, postAs, purgeDeliveriesOfShops, purgeGrants, seedDelivery, systemLoginOf } from './support/m12-fixtures';
import { systemSession, SystemSession } from './support/provisioning-fixtures';

// M12-A on a REAL PostgreSQL and the real administration pipeline. The database is shared with other suites, so every figure is checked as a DELTA of what
// this suite seeded. What is proved: who sees which figure (FORBIDDEN / NOT_READY are never 0), the Vietnam day boundary, a tile and the list it opens
// share one number, a "stopped" search that was called again is not counted, and the money figures come from the ledger (a confirmed top-up) - and a revoked right
// stops working at the next call.

const tag = randomBytes(3).toString('hex').toUpperCase();
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const VIETNAM_OFFSET = 7 * 3_600_000;
const DAY = 86_400_000;

describe('M12-A — overview', () => {
  let admin: AdminApp;
  let system: SystemSession;
  let driverViewer: ActivatedAdmin;
  let shopViewer: ActivatedAdmin;
  let shopId = '';
  let hash = '';
  const shopIds: string[] = [];
  const shippers: Array<{ phone: ReturnType<typeof randomPhone> }> = [];
  const accountIds: string[] = [];

  beforeAll(async () => {
    admin = await startAdminApp({ activationDisabledTest: true });
    system = await systemSession(admin);
    driverViewer = await activatedAdmin(admin, system, [permission('DRIVER')], `Xem tổng quan ${tag}`);
    shopViewer = await activatedAdmin(admin, system, [permission('SHOP')], `Xem quán ${tag}`);
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

  const overview = async (who: Login | undefined, query = 'range=today'): Promise<AdminResponse> => getAs(admin, who, `/overview?${query}`);
  const data = async (who: Login, query?: string): Promise<Json> => {
    const response = await overview(who, query);
    expect([response.status, response.text.slice(0, 300)]).toEqual([200, response.text.slice(0, 300)]);
    return adminData(response) as Json;
  };
  const value = (body: Json, group: string, metric: string): number => {
    const found = body.groups[group].metrics[metric];
    expect(found.status).toBe('OK');
    return found.value as number;
  };
  const todoOf = (body: Json, key: string): Json => (body.todo as Json[]).find((item) => item.key === key) as Json;

  it('1. rights: SYSTEM sees everything built; an ADMIN with DRIVER view sees deliveries but money is FORBIDDEN; a step that does not exist is NOT_READY, never 0', async () => {
    const asSystem = await data(systemLoginOf(system));
    expect(asSystem.time_zone).toBe('Asia/Ho_Chi_Minh');
    expect(asSystem.generated_at).toEqual(expect.any(String));
    for (const [group, metric] of [['deliveries_period', 'created'], ['deliveries_now', 'searching'], ['partners_now', 'shops_online'], ['partners_now', 'shippers_accepting'], ['partners_now', 'shippers_eligible'], ['money_now', 'wallet_balance_vnd'], ['money_period', 'commission_vnd']]) {
      expect(asSystem.groups[group].metrics[metric].status).toBe('OK');
    }
    // Orders (M10), withdrawals (M04-C) and complaints (M11) are built and read from their owners; only the shop review step does not exist (a shop is never "waiting for approval").
    expect(asSystem.groups.orders.metrics.created.status).toBe('OK');
    expect(asSystem.groups.orders.metrics.awaiting_confirmation.status).toBe('OK');
    expect(asSystem.groups.money_period.metrics.withdrawal_vnd.status).toBe('OK');
    expect(asSystem.groups.money_now.metrics.withdrawal_pending.status).toBe('OK');
    expect(todoOf(asSystem, 'complaints_unhandled').status).toBe('OK');
    expect(todoOf(asSystem, 'withdrawals_pending').status).toBe('OK');
    expect(todoOf(asSystem, 'shop_profiles_pending')).toMatchObject({ status: 'NOT_READY', reason: 'M02_NO_SHOP_REVIEW_FLOW' });

    const driver = await data(driverViewer.login);
    expect(driver.groups.deliveries_period.metrics.created.status).toBe('OK');
    expect(driver.groups.partners_now.metrics.shippers_accepting.status).toBe('OK');
    expect(driver.groups.partners_now.metrics.shops_online).toEqual({ status: 'FORBIDDEN' });
    expect(driver.groups.money_now.metrics.wallet_balance_vnd).toEqual({ status: 'FORBIDDEN' });
    expect(driver.groups.money_period.metrics.commission_vnd).toEqual({ status: 'FORBIDDEN' });
    expect(todoOf(driver, 'topups_pending')).toEqual({ key: 'topups_pending', status: 'FORBIDDEN' });
    // Shipper profiles waiting for review need the REVIEW right on DRIVER, not just VIEW.
    expect(todoOf(driver, 'shipper_profiles_pending')).toEqual({ key: 'shipper_profiles_pending', status: 'FORBIDDEN' });
    // The success rate of a figure the actor may not read is a status, not 0/0.
    const shop = await data(shopViewer.login);
    expect(shop.groups.partners_now.metrics.shops_online.status).toBe('OK');
    expect(shop.groups.partners_now.metrics.shippers_accepting).toEqual({ status: 'FORBIDDEN' });
    expect(shop.groups.deliveries_period.success_rate.numerator).toEqual(expect.any(Number));

    expect((await overview(undefined)).status).toBe(401);
  });

  it('2. the query is strict: unknown range or parameter, custom without both days, a future day, more than 92 days and half-valid dates are refused', async () => {
    for (const query of ['range=forever', 'range=custom', 'range=custom&from=2026-10-01', 'range=custom&from=2026-02-30&to=2026-03-01', 'range=custom&from=2020-01-01&to=2026-10-01', 'range=custom&from=2999-01-01&to=2999-01-02', 'range=today&from=2026-10-01', 'bogus=1', 'range=today&range=7d']) {
      const response = await overview(systemLoginOf(system), query);
      expect([query, response.status, adminErrorCode(response)]).toEqual([query, 400, 'ADMIN_INPUT_INVALID']);
    }
    for (const range of ['today', 'yesterday', '7d', 'month']) {
      expect((await overview(systemLoginOf(system), `range=${range}`)).status).toBe(200);
    }
  });

  it('3. the Vietnam day: 23:59:59.999 belongs to its day, 00:00:00.000 to the next; a tile and the list it opens give the same number', async () => {
    const now = Date.now();
    const today = resolvePeriod('today', now);
    const yesterdayStart = today.fromMs - DAY;
    const lastOfYesterday = new Date(today.fromMs - 1).toISOString(); // 23:59:59.999 Vietnam
    const firstOfToday = new Date(today.fromMs).toISOString(); // 00:00:00.000 Vietnam
    const beforeYesterday = await data(systemLoginOf(system), 'range=yesterday');
    const beforeToday = await data(systemLoginOf(system), 'range=today');
    await seedDelivery(admin.pool, { shopId, userId: system.account.userId, createdAtIso: lastOfYesterday });
    await seedDelivery(admin.pool, { shopId, userId: system.account.userId, createdAtIso: firstOfToday });
    const afterYesterday = await data(systemLoginOf(system), 'range=yesterday');
    const afterToday = await data(systemLoginOf(system), 'range=today');
    expect(value(afterYesterday, 'deliveries_period', 'created') - value(beforeYesterday, 'deliveries_period', 'created')).toBe(1);
    expect(value(afterToday, 'deliveries_period', 'created') - value(beforeToday, 'deliveries_period', 'created')).toBe(1);
    expect(afterYesterday.period.from_day).toBe(new Date(yesterdayStart + VIETNAM_OFFSET).toISOString().slice(0, 10));
    // The same custom day through the explicit range answers the same number.
    const day = afterYesterday.period.from_day as string;
    const custom = await data(systemLoginOf(system), `range=custom&from=${day}&to=${day}`);
    expect(value(custom, 'deliveries_period', 'created')).toBe(value(afterYesterday, 'deliveries_period', 'created'));
    // The tile's link opens the list with the same filter, and the list's total is the tile's number.
    const link = afterYesterday.groups.deliveries_period.metrics.created.link as Json;
    expect(link.area).toBe('deliveries');
    const list = adminData(await getAs(admin, systemLoginOf(system), `/deliveries?${new URLSearchParams(link.query).toString()}&limit=1`)) as Json;
    expect(list.total).toBe(value(afterYesterday, 'deliveries_period', 'created'));
  });

  it('4. a stopped search that was called again is not "stopped"; the tile and the list agree; searching counts the waiting ones', async () => {
    const before = await data(systemLoginOf(system));
    const stoppedAlone = await seedDelivery(admin.pool, { shopId, userId: system.account.userId, state: 'search_stopped' });
    const stoppedRecalled = await seedDelivery(admin.pool, { shopId, userId: system.account.userId, state: 'search_stopped' });
    await seedDelivery(admin.pool, { shopId, userId: system.account.userId, previousDeliveryId: stoppedRecalled });
    const after = await data(systemLoginOf(system));
    expect(todoOf(after, 'deliveries_stopped').value - todoOf(before, 'deliveries_stopped').value).toBe(1);
    expect(value(after, 'deliveries_now', 'searching') - value(before, 'deliveries_now', 'searching')).toBe(1);
    const link = todoOf(after, 'deliveries_stopped').link as Json;
    expect(link).toEqual({ area: 'deliveries', query: { group: 'stopped' } });
    const list = adminData(await getAs(admin, systemLoginOf(system), `/deliveries?group=stopped&limit=50&shop=Fixture`)) as Json;
    const ids = (list.items as Json[]).map((item) => item.delivery_id);
    expect(ids).toContain(stoppedAlone);
    expect(ids).not.toContain(stoppedRecalled);
    expect((list.items as Json[]).find((item) => item.delivery_id === stoppedAlone)?.signals).toEqual(['SEARCH_STOPPED']);
    expect(list.total).toBe(todoOf(after, 'deliveries_stopped').value);
  });

  it('5. money comes from the ledger: a confirmed top-up moves the ledger sum and the wallet total by exactly its ACTUAL amount; the pending count drops; wallet.read is checked on every call', async () => {
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

    const reader = await activatedAdmin(admin, system, [permission('DRIVER')], `Đọc ví ${tag}`);
    expect((await changeGrant(admin, system, 'grant', reader.userId, 'wallet.read', 0)).status).toBe(200);
    const before = await data(reader.login);
    expect(before.groups.money_now.metrics.wallet_balance_vnd.status).toBe('OK');
    expect(before.groups.money_now.metrics.topup_pending.link).toEqual({ area: 'finance-topups', query: { status: 'PENDING' } });
    const pendingBefore = value(before, 'money_now', 'topup_pending');

    const confirmed = await postAs(admin, system$, `/finance/topup-requests/${requestId}/confirm`, {
      expected_version: 1,
      actual_amount_vnd: 60_000, // the ACTUAL amount, not the requested 100 000
      bank_id: 'VCB',
      system_owned_account_id: accountId,
      canonical_transaction_id: `FT${Math.floor(1e11 + Math.random() * 9e11)}`,
      received_at: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(confirmed.status).toBe(200);

    const after = await data(reader.login);
    expect(value(after, 'money_period', 'topup_vnd') - value(before, 'money_period', 'topup_vnd')).toBe(60_000);
    expect(value(after, 'money_now', 'wallet_balance_vnd') - value(before, 'money_now', 'wallet_balance_vnd')).toBe(60_000);
    expect(value(after, 'money_now', 'wallet_available_vnd') - value(before, 'money_now', 'wallet_available_vnd')).toBe(60_000);
    expect(pendingBefore - value(after, 'money_now', 'topup_pending')).toBe(1);
    // A top-up is a deposit, not revenue: commission and adjustments did not move.
    expect(value(after, 'money_period', 'commission_vnd')).toBe(value(before, 'money_period', 'commission_vnd'));
    expect(value(after, 'money_period', 'adjustment_net_vnd')).toBe(value(before, 'money_period', 'adjustment_net_vnd'));

    // Revoked: the very next call of the same session no longer shows money (FORBIDDEN, not 0).
    expect((await changeGrant(admin, system, 'revoke', reader.userId, 'wallet.read', 1)).status).toBe(200);
    const revoked = await data(reader.login);
    expect(revoked.groups.money_now.metrics.wallet_balance_vnd).toEqual({ status: 'FORBIDDEN' });
    expect(todoOf(revoked, 'topups_pending')).toEqual({ key: 'topups_pending', status: 'FORBIDDEN' });
  });
});
