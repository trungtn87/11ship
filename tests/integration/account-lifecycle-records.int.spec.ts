import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { AccountActivityRegistry } from '../../apps/backend/src/account-lifecycle/account-activity-registry';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import { AdminApp, adminData, adminErrorCode, AdminResponse, sessionCookies, startAdminApp } from './support/admin-fixtures';
import { grantRole, PASSWORD, Phone, randomPhone } from './support/auth-fixtures';
import { insertCommissionSource } from './support/delivery-fixtures';
import { systemSession, SystemSession } from './support/provisioning-fixtures';

// M01-LOCK-01 (Nhóm 13) on the REAL Nest pipeline and a REAL PostgreSQL (TEST database only). Every fixture is a plain INSERT of a made-up row
// (the repository's usual pattern for rows owned by other modules: user triggers off for the insert only); no production data, no SMS, no courier.

const tag = randomBytes(3).toString('hex').toUpperCase();
const ADMIN_BASE = '/v1/admin';
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('account lock / delete against the real records of every module', () => {
  let app: AdminApp;
  let system: SystemSession;
  const hasher = new Argon2idPasswordHasher();
  const seededIds: string[] = [];

  const sys = (): { cookie: string; csrf: string } => ({ cookie: system.login.cookie, csrf: system.login.csrf });
  const command = async (kind: 'lock' | 'delete', userId: string, version: number, key: string = randomUUID()): Promise<AdminResponse> => {
    await app.clearLimits();
    return app.call('POST', `/users/${userId}/${kind}`, {
      basePath: ADMIN_BASE,
      body: { expected_version: version, reason: 'Kiểm thử bảo vệ dữ liệu tài khoản' },
      cookies: sessionCookies(sys()),
      csrf: sys().csrf,
      headers: { 'idempotency-key': key },
    });
  };
  const detail = async (userId: string): Promise<Record<string, unknown>> => {
    return adminData(await app.call('GET', `/users/${userId}`, { basePath: ADMIN_BASE, cookies: sessionCookies(sys()) }));
  };
  const outcome = (response: AdminResponse): { status: number; code: string | undefined } => ({ status: response.status, code: adminErrorCode(response) });

  interface Seeded {
    readonly id: string;
    readonly phone: Phone;
  }
  async function seedUser(roles: readonly ('CUSTOMER' | 'SHOP' | 'DRIVER')[] = ['CUSTOMER']): Promise<Seeded> {
    const phone = randomPhone();
    app.track(phone.normalized);
    const id = randomUUID();
    seededIds.push(id);
    await app.pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, clock_timestamp(), 'PHONE_VERIFIED', 'ACTIVE', 1, clock_timestamp(), clock_timestamp())`,
      [id, phone.normalized, await hasher.hash(PASSWORD)],
    );
    for (const role of roles) {
      if (role === 'CUSTOMER') {
        await app.pool.query('INSERT INTO app.user_roles (user_id, role, created_at) VALUES ($1::uuid, $2, clock_timestamp())', [id, 'CUSTOMER']);
        await app.pool.query('INSERT INTO app.customer_profiles (user_id, full_name) VALUES ($1::uuid, $2)', [id, `Khách ${tag}`]);
      } else {
        await grantRole(app.pool, id, role);
      }
    }
    return { id, phone };
  }
  const shopOf = async (userId: string): Promise<string> =>
    String((await app.pool.query<{ shop_id: string }>('SELECT shop_id FROM app.shop_members WHERE user_id = $1::uuid', [userId])).rows[0]?.shop_id);
  const driverOf = async (userId: string): Promise<string> =>
    String((await app.pool.query<{ driver_id: string }>('SELECT driver_id FROM app.drivers WHERE user_id = $1::uuid', [userId])).rows[0]?.driver_id);
  const userRow = async (id: string): Promise<{ status: string; version: string } | undefined> =>
    (await app.pool.query<{ status: string; version: string }>('SELECT status, version::text FROM app.users WHERE user_id = $1::uuid', [id])).rows[0];

  async function withoutTriggers<T>(tables: readonly string[], run: (q: { query(sql: string, values?: unknown[]): Promise<unknown> }) => Promise<T>): Promise<T> {
    const client = await app.pool.connect();
    try {
      await client.query('BEGIN');
      for (const table of tables) {
        await client.query(`ALTER TABLE app.${table} DISABLE TRIGGER USER`);
      }
      const result = await run(client);
      for (const table of tables) {
        await client.query(`ALTER TABLE app.${table} ENABLE TRIGGER USER`);
      }
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  const insertOrder = async (customerId: string, shopId: string, status: string): Promise<string> => {
    const orderId = randomUUID();
    await withoutTriggers(['orders'], (q) =>
      q.query(
        `INSERT INTO app.orders (order_id, code, client_ref, customer_user_id, shop_id, status, shop_name, shop_phone, shop_address_text, recipient_name, recipient_phone, address_text,
           items_original_total_vnd, items_total_vnd, confirmed_at, ended_at, end_actor, created_at, updated_at)
         VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5::uuid, $6::varchar, 'Quán thử', '0900000000', 'Số 1', 'Người nhận', '0912345678', 'Số 2', 50000, 50000,
           CASE WHEN $6::varchar IN ('PREPARING','COMPLETED') THEN now() END, CASE WHEN $6::varchar = 'COMPLETED' THEN now() END, CASE WHEN $6::varchar = 'COMPLETED' THEN 'SHOP' END, now(), now())`,
        [orderId, `#${tag}${orderId.slice(0, 5)}`, randomUUID(), customerId, shopId, status],
      ),
    );
    return orderId;
  };
  const orderExists = async (orderId: string): Promise<boolean> => (await app.pool.query('SELECT 1 FROM app.orders WHERE order_id = $1::uuid', [orderId])).rows.length === 1;

  beforeAll(async () => {
    app = await startAdminApp({ userAccountMutations: true, activationDisabledTest: false });
    system = await systemSession(app);
  }, 300_000);

  afterAll(async () => {
    try {
      // The fixtures above are made-up rows of other modules: remove them (children first) before the harness removes the accounts.
      const client = await app.pool.connect();
      try {
        await client.query('BEGIN');
        for (const table of ['complaints', 'customer_carts', 'wallet_topup_requests', 'driver_wallets', 'delivery_assignments', 'deliveries', 'orders']) {
          await client.query(`ALTER TABLE app.${table} DISABLE TRIGGER USER`);
        }
        const drivers = '(SELECT driver_id FROM app.drivers WHERE user_id = ANY($1::uuid[]))';
        const shops = '(SELECT shop_id FROM app.shop_members WHERE user_id = ANY($1::uuid[]))';
        await client.query('DELETE FROM app.complaints WHERE submitter_user_id = ANY($1::uuid[])', [seededIds]);
        await client.query('DELETE FROM app.customer_carts WHERE user_id = ANY($1::uuid[])', [seededIds]);
        await client.query(`DELETE FROM app.wallet_topup_requests WHERE driver_id IN ${drivers}`, [seededIds]);
        await client.query(`DELETE FROM app.driver_wallets WHERE driver_id IN ${drivers}`, [seededIds]);
        await client.query(`DELETE FROM app.delivery_assignments WHERE driver_id IN ${drivers}`, [seededIds]);
        await client.query(`DELETE FROM app.deliveries WHERE requested_by = ANY($1::uuid[]) OR shop_id IN ${shops}`, [seededIds]);
        await client.query(`DELETE FROM app.orders WHERE customer_user_id = ANY($1::uuid[]) OR shop_id IN ${shops}`, [seededIds]);
        for (const table of ['complaints', 'customer_carts', 'wallet_topup_requests', 'driver_wallets', 'delivery_assignments', 'deliveries', 'orders']) {
          await client.query(`ALTER TABLE app.${table} ENABLE TRIGGER USER`);
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    } finally {
      await app.close();
    }
  });

  it('a customer with an order being prepared: shown as active work, lock and delete refused, nothing lost; allowed once the order ended (retry)', async () => {
    const customer = await seedUser(['CUSTOMER']);
    const owner = await seedUser(['SHOP']);
    const orderId = await insertOrder(customer.id, await shopOf(owner.id), 'PREPARING');
    const shown = await detail(customer.id);
    expect(shown.lifecycle).toMatchObject({ related_data: ['ORDERS'], active_work: ['ORDERS'], lock_blocked_reason: 'ACTIVE_WORK', delete_effect: 'LOCK' });
    const version = Number(shown.version);
    const key = randomUUID();
    expect(outcome(await command('lock', customer.id, version, key))).toEqual({ status: 409, code: 'USER_ACCOUNT_HAS_ACTIVE_WORK' });
    expect(outcome(await command('delete', customer.id, version))).toEqual({ status: 409, code: 'USER_ACCOUNT_HAS_ACTIVE_WORK' });
    expect(await userRow(customer.id)).toEqual({ status: 'ACTIVE', version: String(version) });
    expect(await orderExists(orderId)).toBe(true);

    await app.pool.query("ALTER TABLE app.orders DISABLE TRIGGER USER");
    await app.pool.query("UPDATE app.orders SET status = 'COMPLETED', ended_at = now(), end_actor = 'SHOP' WHERE order_id = $1::uuid", [orderId]);
    await app.pool.query('ALTER TABLE app.orders ENABLE TRIGGER USER');
    // Retry: a new intent after the order ended is allowed. A delete of an account WITH history locks it (DELETE_REQUEST), never purges it.
    const deleted = await command('delete', customer.id, version);
    expect(deleted.status).toBe(200);
    expect(adminData(deleted)).toMatchObject({ result: 'LOCKED', lock_reason: 'DELETE_REQUEST', related_data: ['ORDERS'] });
    expect(await userRow(customer.id)).toMatchObject({ status: 'DISABLED' });
    expect(await orderExists(orderId)).toBe(true);
  });

  it('historical order only: no active work, the lock works; the delete locks and keeps the order, the account and its roles', async () => {
    const customer = await seedUser(['CUSTOMER']);
    const owner = await seedUser(['SHOP']);
    const orderId = await insertOrder(customer.id, await shopOf(owner.id), 'COMPLETED');
    const shown = await detail(customer.id);
    expect(shown.lifecycle).toMatchObject({ related_data: ['ORDERS'], active_work: [], lock_blocked_reason: null });
    expect(adminData(await command('delete', customer.id, Number(shown.version)))).toMatchObject({ result: 'LOCKED' });
    expect(await userRow(customer.id)).toMatchObject({ status: 'DISABLED' });
    expect(await orderExists(orderId)).toBe(true);
    expect((await app.pool.query('SELECT 1 FROM app.user_roles WHERE user_id = $1::uuid', [customer.id])).rows).toHaveLength(1);
  });

  it('an account with NO data at all is still removed for good (the delete path keeps working)', async () => {
    const lonely = await seedUser(['CUSTOMER']);
    const shown = await detail(lonely.id);
    expect(shown.lifecycle).toMatchObject({ related_data: [], active_work: [], delete_effect: 'DELETE_PERMANENTLY' });
    expect(adminData(await command('delete', lonely.id, Number(shown.version)))).toMatchObject({ result: 'DELETED' });
    expect(await userRow(lonely.id)).toBeUndefined();
  });

  it('multiple roles: a shop owner whose shop has an order from ANOTHER customer is blocked by that order; the same account as customer is judged together', async () => {
    const owner = await seedUser(['CUSTOMER', 'SHOP']);
    const customer = await seedUser(['CUSTOMER']);
    const orderId = await insertOrder(customer.id, await shopOf(owner.id), 'PENDING_CONFIRMATION');
    const shown = await detail(owner.id);
    expect(shown.lifecycle).toMatchObject({ active_work: ['ORDERS'], lock_blocked_reason: 'ACTIVE_WORK' });
    expect(outcome(await command('lock', owner.id, Number(shown.version)))).toEqual({ status: 409, code: 'USER_ACCOUNT_HAS_ACTIVE_WORK' });
    expect(await userRow(owner.id)).toMatchObject({ status: 'ACTIVE' });
    expect(await orderExists(orderId)).toBe(true);
  });

  it('a shipper with an accepted delivery is blocked (DELIVERIES); an ended one is only related data', async () => {
    const shipper = await seedUser(['DRIVER']);
    const owner = await seedUser(['SHOP']);
    const driverId = await driverOf(shipper.id);
    await withoutTriggers(['deliveries', 'delivery_assignments'], async (q) => {
      await q.query('SET CONSTRAINTS ALL DEFERRED');
      await insertCommissionSource(q as never, { shopId: await shopOf(owner.id), userId: owner.id, driverId, amountVnd: 3000, outcome: 'ACTIVE' });
    });
    const shown = await detail(shipper.id);
    expect(shown.lifecycle).toMatchObject({ related_data: expect.arrayContaining(['DELIVERIES', 'DRIVER_PROFILE']), active_work: ['DELIVERIES'] });
    expect(outcome(await command('lock', shipper.id, Number(shown.version)))).toEqual({ status: 409, code: 'USER_ACCOUNT_HAS_ACTIVE_WORK' });
    expect(await userRow(shipper.id)).toMatchObject({ status: 'ACTIVE' });

    const finished = await seedUser(['DRIVER']);
    await withoutTriggers(['deliveries', 'delivery_assignments'], async (q) => {
      await insertCommissionSource(q as never, { shopId: await shopOf(owner.id), userId: owner.id, driverId: await driverOf(finished.id), amountVnd: 3000, outcome: 'CAPTURED' });
    });
    const done = await detail(finished.id);
    expect(done.lifecycle).toMatchObject({ active_work: [], lock_blocked_reason: null });
  });

  it('wallet: a pending top-up request is money in progress and blocks; a balance alone does not, but it is related data (never purged)', async () => {
    const pending = await seedUser(['DRIVER']);
    const balanceOnly = await seedUser(['DRIVER']);
    for (const [user, state] of [[pending, 'PENDING'], [balanceOnly, null]] as const) {
      const driverId = await driverOf(user.id);
      const walletId = randomUUID();
      await withoutTriggers(['driver_wallets', 'wallet_topup_requests'], async (q) => {
        await q.query(
          `INSERT INTO app.driver_wallets (wallet_id, driver_id, balance_vnd, held_vnd, version, created_at, updated_at) VALUES ($1::uuid, $2::uuid, 100000, 0, 1, clock_timestamp(), clock_timestamp())`,
          [walletId, driverId],
        );
        if (state !== null) {
          await q.query(
            `INSERT INTO app.wallet_topup_requests (request_id, wallet_id, driver_id, amount_requested_vnd, state, created_by_user_id, version, created_at, updated_at)
             VALUES ($1::uuid, $2::uuid, $3::uuid, 50000, 'PENDING', $4::uuid, 1, clock_timestamp(), clock_timestamp())`,
            [randomUUID(), walletId, driverId, user.id],
          );
        }
      });
    }
    const blocked = await detail(pending.id);
    expect(blocked.lifecycle).toMatchObject({ active_work: ['WALLET'], lock_blocked_reason: 'ACTIVE_WORK' });
    expect(outcome(await command('lock', pending.id, Number(blocked.version)))).toEqual({ status: 409, code: 'USER_ACCOUNT_HAS_ACTIVE_WORK' });
    const free = await detail(balanceOnly.id);
    expect(free.lifecycle).toMatchObject({ related_data: expect.arrayContaining(['WALLET']), active_work: [] });
    expect(adminData(await command('delete', balanceOnly.id, Number(free.version)))).toMatchObject({ result: 'LOCKED' });
    expect((await app.pool.query('SELECT balance_vnd::text FROM app.driver_wallets WHERE driver_id = $1::uuid', [await driverOf(balanceOnly.id)])).rows[0]).toEqual({ balance_vnd: '100000' });
  });

  it('a complaint linked to the account is related data (kept), not active work; a table nobody registered still turns a delete into a lock', async () => {
    const customer = await seedUser(['CUSTOMER']);
    const owner = await seedUser(['SHOP']);
    const shopId = await shopOf(owner.id);
    const orderId = await insertOrder(customer.id, shopId, 'COMPLETED');
    await app.pool.query(
      `INSERT INTO app.complaints (complaint_id, code, submitter_user_id, submitter_role, category, order_id, shop_id, related_code, shop_name, scope_key, status, body, created_at, updated_at)
       VALUES ($1::uuid, $2, $3::uuid, 'CUSTOMER', 'SERVICE', $4::uuid, $5::uuid, 'K', 'Quán', $4::uuid, 'PENDING', 'Đơn có vấn đề', now(), now())`,
      [randomUUID(), `LK${String(Date.now()).slice(-9)}`, customer.id, orderId, shopId],
    );
    const shown = await detail(customer.id);
    expect(shown.lifecycle).toMatchObject({ related_data: expect.arrayContaining(['ORDERS', 'DISPUTES']), active_work: [] });

    const cartOnly = await seedUser(['CUSTOMER']);
    await app.pool.query(
      `INSERT INTO app.customer_carts (user_id, shop_id, lines, version, created_at, updated_at) VALUES ($1::uuid, $2::uuid, '[{"x":1}]'::jsonb, 1, clock_timestamp(), clock_timestamp())`,
      [cartOnly.id, shopId],
    );
    const cart = await detail(cartOnly.id);
    expect(cart.lifecycle).toMatchObject({ related_data: ['LINKED_RECORDS'], delete_effect: 'LOCK' });
    expect(adminData(await command('delete', cartOnly.id, Number(cart.version)))).toMatchObject({ result: 'LOCKED' });
    expect(await userRow(cartOnly.id)).toMatchObject({ status: 'DISABLED' });
  });

  it('a check that cannot answer refuses the lock and the delete (503) and changes nothing: an error is never "no data"', async () => {
    const registry = app.running.app.get(AccountActivityRegistry, { strict: false });
    const customer = await seedUser(['CUSTOMER']);
    const version = Number((await detail(customer.id)).version);
    registry.register({ name: 'TEST_BROKEN', relatedData: () => Promise.reject(new Error('boom')), activeWork: () => Promise.reject(new Error('boom')) });
    try {
      expect(outcome(await command('lock', customer.id, version))).toEqual({ status: 503, code: 'USER_ACCOUNT_ACTIVITY_UNVERIFIED' });
      expect(outcome(await command('delete', customer.id, version))).toEqual({ status: 503, code: 'USER_ACCOUNT_ACTIVITY_UNVERIFIED' });
      expect(await userRow(customer.id)).toEqual({ status: 'ACTIVE', version: String(version) });
    } finally {
      registry.unregister('TEST_BROKEN');
    }
    expect(adminData(await command('delete', customer.id, version))).toMatchObject({ result: 'DELETED' });
  });

  it('race: an order placed for the shop (shop row held FOR SHARE, as the order command does) while the owner is being locked: the lock waits and then sees the order', async () => {
    const owner = await seedUser(['SHOP']);
    const customer = await seedUser(['CUSTOMER']);
    const shopId = await shopOf(owner.id);
    const version = Number((await detail(owner.id)).version);
    const writer = await app.pool.connect();
    try {
      await writer.query('BEGIN');
      await writer.query('SELECT 1 FROM app.shops WHERE shop_id = $1::uuid FOR SHARE', [shopId]);
      await writer.query('ALTER TABLE app.orders DISABLE TRIGGER USER');
      await writer.query(
        `INSERT INTO app.orders (order_id, code, client_ref, customer_user_id, shop_id, status, shop_name, shop_phone, shop_address_text, recipient_name, recipient_phone, address_text, items_original_total_vnd, items_total_vnd, created_at, updated_at)
         VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5::uuid, 'PENDING_CONFIRMATION', 'Quán', '0900000000', 'Số 1', 'Người nhận', '0912345678', 'Số 2', 50000, 50000, now(), now())`,
        [randomUUID(), `#${tag}RC`, randomUUID(), customer.id, shopId],
      );
      await writer.query('ALTER TABLE app.orders ENABLE TRIGGER USER');
      let settled = false;
      const racing = command('lock', owner.id, version).then((response) => {
        settled = true;
        return response;
      });
      await sleep(700);
      expect(settled).toBe(false); // queued behind the order transaction: it cannot decide from a stale view
      await writer.query('COMMIT');
      expect(outcome(await racing)).toEqual({ status: 409, code: 'USER_ACCOUNT_HAS_ACTIVE_WORK' });
    } finally {
      await writer.query('ROLLBACK').catch(() => undefined);
      writer.release();
    }
    expect(await userRow(owner.id)).toMatchObject({ status: 'ACTIVE' });
  });

  it('race: two concurrent lock requests for one account change it once (the other is a version conflict or already in state)', async () => {
    const customer = await seedUser(['CUSTOMER']);
    const version = Number((await detail(customer.id)).version);
    const [a, b] = await Promise.all([command('lock', customer.id, version), command('lock', customer.id, version)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await userRow(customer.id)).toMatchObject({ status: 'DISABLED' });
    expect(Number((await app.pool.query<{ n: string }>("SELECT count(*)::text AS n FROM app.audit_logs WHERE action = 'admin.user.lock.v1' AND resource_id = $1", [customer.id])).rows[0]?.n)).toBe(1);
  });
});
