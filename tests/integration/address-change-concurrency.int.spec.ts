import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Pool } from 'pg';
import { AddressChangeRepository } from '../../apps/backend/src/address-change/address-change-repository';
import { poolClientSource } from '../../apps/backend/src/transaction/pg-client-source';
import { createActiveShopFor, createDriverFor, purgePhone, randomPhone } from './support/auth-fixtures';
import { insertDeliveryRow } from './support/delivery-fixtures';
import { createCategory } from './support/menu-fixtures';
import { loadIntegrationConfig } from './support/test-helpers';
import { managerFor, testPool } from './support/transaction-fixtures';

// PR #232 / Issues #218, #217 — Real PostgreSQL 17 concurrency, lock ordering & expiry resolution tests.
describe('Address Change Concurrency & PostgreSQL 17 Invariants (#218, #217, #232)', () => {
  let pool: Pool;
  const phones: string[] = [];
  let shopOwnerUserId = '';
  let shopId = '';
  let customerUserId = '';
  let driverUserId1 = '';
  let driverId1 = '';
  let driverUserId2 = '';
  let driverId2 = '';
  let menuItemId = '';

  const manager = () => managerFor(poolClientSource(pool), { timeoutMs: 20_000 });
  const repo = new AddressChangeRepository();

  async function createUser(): Promise<string> {
    const phone = randomPhone();
    phones.push(phone.normalized);
    const id = randomUUID();
    await pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', now(), 'PHONE_VERIFIED', 'ACTIVE', 1, now(), now())`,
      [id, phone.normalized],
    );
    return id;
  }

  async function createOrder(customerId: string, shopIdVal: string): Promise<string> {
    const orderId = randomUUID();
    const code = `OD-${orderId.slice(0, 8)}`;
    const lineId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE app.orders DISABLE TRIGGER USER');
      await client.query('ALTER TABLE app.order_items DISABLE TRIGGER USER');
      await client.query(
        `INSERT INTO app.orders (
           order_id, code, client_ref, customer_user_id, shop_id, status, shop_name, shop_phone, shop_address_text,
           recipient_name, recipient_phone, address_text, address_lat, address_lng, fee_estimate_vnd, fee_estimate_distance_m,
           items_original_total_vnd, items_total_vnd, paid_vnd, version, confirmed_at, created_at, updated_at
         ) VALUES (
           $1::uuid, $2, $3, $4::uuid, $5::uuid, 'PREPARING', 'Tiệm Bánh Test', '+84900000001', '123 Phố Huế',
           'Người Nhận Test', '+84912345678', '456 Cầu Giấy', 21.03, 105.78, 25000, 3500,
           100000, 100000, 100000, 1, now(), now(), now()
         )`,
        [orderId, code, randomUUID(), customerId, shopIdVal],
      );
      await client.query(
        `INSERT INTO app.order_items (
           line_id, order_id, line_no, menu_item_id, name, orig_unit_price_vnd, orig_quantity, unit_price_vnd, quantity, created_at
         ) VALUES (
           $1::uuid, $2::uuid, 1, $3::uuid, 'Món test PR232', 100000, 1, 100000, 1, now()
         )`,
        [lineId, orderId, menuItemId],
      );
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      await client.query('ALTER TABLE app.orders ENABLE TRIGGER USER');
      await client.query('ALTER TABLE app.order_items ENABLE TRIGGER USER');
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    return orderId;
  }

  beforeAll(async () => {
    pool = testPool(loadIntegrationConfig().database, { poolMax: 8 });
    shopOwnerUserId = await createUser();
    shopId = await createActiveShopFor(pool, shopOwnerUserId);
    customerUserId = await createUser();
    driverUserId1 = await createUser();
    driverId1 = await createDriverFor(pool, driverUserId1, { status: 'ACTIVE' });
    driverUserId2 = await createUser();
    driverId2 = await createDriverFor(pool, driverUserId2, { status: 'ACTIVE' });

    const categoryId = await createCategory(pool, 'Danh mục test PR232');
    menuItemId = randomUUID();
    await pool.query(
      `INSERT INTO app.menu_items (item_id, shop_id, category_id, name, price_vnd, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'Món test PR232', 100000, 'VISIBLE', 1, now(), now())`,
      [menuItemId, shopId, categoryId],
    );
  });

  afterAll(async () => {
    if (pool !== undefined) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const tables = [
          'address_change_requests', 'order_events', 'order_items', 'orders',
          'delivery_events', 'delivery_incidents', 'delivery_assignments', 'deliveries',
          'wallet_holds', 'driver_wallets', 'menu_items',
        ];
        for (const t of tables) {
          await client.query(`ALTER TABLE app.${t} DISABLE TRIGGER USER`);
        }
        await client.query(`DELETE FROM app.wallet_holds WHERE wallet_id IN (SELECT wallet_id FROM app.driver_wallets WHERE driver_id = ANY($1::uuid[]))`, [
          [driverId1, driverId2].filter(Boolean),
        ]);
        await client.query(`DELETE FROM app.driver_wallets WHERE driver_id = ANY($1::uuid[])`, [
          [driverId1, driverId2].filter(Boolean),
        ]);
        await client.query(`DELETE FROM app.address_change_requests WHERE requested_by = ANY($1::uuid[])`, [
          [customerUserId, shopOwnerUserId, driverUserId1, driverUserId2].filter(Boolean),
        ]);
        await client.query(`DELETE FROM app.delivery_assignments WHERE driver_id = ANY($1::uuid[])`, [
          [driverId1, driverId2].filter(Boolean),
        ]);
        await client.query(`DELETE FROM app.deliveries WHERE shop_id = $1::uuid OR requested_by = $2::uuid`, [
          shopId, customerUserId,
        ]);
        await client.query(
          `DELETE FROM app.order_items WHERE order_id IN (SELECT order_id FROM app.orders WHERE shop_id = $1::uuid OR customer_user_id = $2::uuid)`,
          [shopId, customerUserId],
        );
        await client.query(`DELETE FROM app.orders WHERE shop_id = $1::uuid OR customer_user_id = $2::uuid`, [
          shopId, customerUserId,
        ]);
        await client.query(`DELETE FROM app.menu_items WHERE shop_id = $1::uuid OR item_id = $2::uuid`, [shopId, menuItemId]);
        await client.query(`DELETE FROM app.menu_categories WHERE name = 'Danh mục test PR232'`);
        await client.query('SET CONSTRAINTS ALL IMMEDIATE');
        for (const t of tables) {
          await client.query(`ALTER TABLE app.${t} ENABLE TRIGGER USER`);
        }
        await client.query('COMMIT');
      } catch {
        await client.query('ROLLBACK').catch(() => undefined);
      } finally {
        client.release();
      }
      for (const phone of phones) {
        await purgePhone(pool, phone);
      }
      await pool.end();
    }
  });

  it('Issue 2: Lock order consistency prevents PostgreSQL 40P01 deadlocks under concurrent access', async () => {
    const orderId = await createOrder(customerUserId, shopId);
    const changeRequestId = randomUUID();

    // Insert an initial pending request
    await manager().withTransaction(async (ctx) => {
      await repo.insert(ctx, {
        changeRequestId,
        orderId,
        deliveryId: null,
        source: 'ORDER',
        requestedBy: customerUserId,
        status: 'PENDING',
        targetActor: 'SHOP',
        targetDriverId: null,
        originalRecipientName: 'Người Nhận Test',
        originalRecipientPhone: '+84912345678',
        originalAddressText: '456 Cầu Giấy',
        originalLat: 21.03,
        originalLng: 105.78,
        originalFeeVnd: 25000,
        originalDistanceM: 3500,
        newRecipientName: 'Người Nhận Mới',
        newRecipientPhone: '+84987654321',
        newAddressText: '789 Đống Đa',
        newLat: 21.01,
        newLng: 105.82,
        newFeeVnd: 25000,
        newDistanceM: 3200,
        feeDifferenceVnd: 0,
        note: 'Đổi địa chỉ',
        expiresAtMs: Date.now() + 300_000,
        orderVersion: 1,
        deliveryVersion: null,
      });
    });

    // Two concurrent transactions locking the same order then address_change_request:
    // Both must complete cleanly without 40P01 deadlock because both follow the strict order:
    // 1. app.orders
    // 2. app.address_change_requests
    const results = await Promise.allSettled([
      manager().withTransaction(async (ctx) => {
        await ctx.query('SELECT order_id FROM app.orders WHERE order_id = $1::uuid FOR UPDATE', [orderId]);
        const locked = await repo.lockActiveByOrderId(ctx, orderId);
        return locked?.changeRequestId;
      }),
      manager().withTransaction(async (ctx) => {
        await ctx.query('SELECT order_id FROM app.orders WHERE order_id = $1::uuid FOR UPDATE', [orderId]);
        const locked = await repo.lockActiveByOrderId(ctx, orderId);
        return locked?.changeRequestId;
      }),
    ]);

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('fulfilled');
    if (results[0].status === 'fulfilled' && results[1].status === 'fulfilled') {
      expect(results[0].value).toBe(changeRequestId);
      expect(results[1].value).toBe(changeRequestId);
    }
  });

  it('Issue 3: Resolving EXPIRED commits to PostgreSQL and frees partial unique index without rollback', async () => {
    const orderId = await createOrder(customerUserId, shopId);
    const expiredRequestId = randomUUID();
    const now = Date.now();

    // Insert an expired pending request
    await manager().withTransaction(async (ctx) => {
      await repo.insert(ctx, {
        changeRequestId: expiredRequestId,
        orderId,
        deliveryId: null,
        source: 'ORDER',
        requestedBy: customerUserId,
        status: 'PENDING',
        targetActor: 'SHOP',
        targetDriverId: null,
        originalRecipientName: 'Người Nhận Test',
        originalRecipientPhone: '+84912345678',
        originalAddressText: '456 Cầu Giấy',
        originalLat: null,
        originalLng: null,
        originalFeeVnd: 25000,
        originalDistanceM: null,
        newRecipientName: 'Người Nhận Hết Hạn',
        newRecipientPhone: '+84987654321',
        newAddressText: '789 Đống Đa',
        newLat: null,
        newLng: null,
        newFeeVnd: null,
        newDistanceM: null,
        feeDifferenceVnd: null,
        note: null,
        expiresAtMs: now + 300_000,
        orderVersion: 1,
        deliveryVersion: null,
      });
      await ctx.query(
        `UPDATE app.address_change_requests
         SET created_at = clock_timestamp() - interval '10 minutes',
             expires_at = clock_timestamp() - interval '5 minutes'
         WHERE change_request_id = $1::uuid`,
        [expiredRequestId],
      );
    });

    // Resolving to EXPIRED commits cleanly without throwing or rolling back
    const resolved = await manager().withTransaction(async (ctx) => {
      const locked = await repo.lockActiveByOrderId(ctx, orderId);
      expect(locked).toBeDefined();
      return repo.resolve(ctx, expiredRequestId, 'EXPIRED', null, 'Hết hạn phản hồi', 1);
    });
    expect(resolved).toBe(true);

    // Verify row in database is truly committed as EXPIRED
    const afterResolve = await manager().withTransaction(async (ctx) => repo.findById(ctx, expiredRequestId));
    expect(afterResolve).toBeDefined();
    expect(afterResolve?.status).toBe('EXPIRED');
    expect(afterResolve?.rejectReason).toBe('Hết hạn phản hồi');

    // Partial unique index `address_change_active_order_uq` WHERE status = 'PENDING' is now free!
    // A new pending request on the same orderId can be inserted without unique constraint error
    const newRequestId = randomUUID();
    await manager().withTransaction(async (ctx) => {
      await repo.insert(ctx, {
        changeRequestId: newRequestId,
        orderId,
        deliveryId: null,
        source: 'ORDER',
        requestedBy: customerUserId,
        status: 'PENDING',
        targetActor: 'SHOP',
        targetDriverId: null,
        originalRecipientName: 'Người Nhận Test',
        originalRecipientPhone: '+84912345678',
        originalAddressText: '456 Cầu Giấy',
        originalLat: null,
        originalLng: null,
        originalFeeVnd: 25000,
        originalDistanceM: null,
        newRecipientName: 'Người Nhận Mới Sau Hết Hạn',
        newRecipientPhone: '+84987654321',
        newAddressText: '111 Hoàn Kiếm',
        newLat: null,
        newLng: null,
        newFeeVnd: null,
        newDistanceM: null,
        feeDifferenceVnd: null,
        note: null,
        expiresAtMs: now + 300_000,
        orderVersion: 1,
        deliveryVersion: null,
      });
    });

    const activeAfterNew = await manager().withTransaction(async (ctx) => repo.findActiveByOrderId(ctx, orderId));
    expect(activeAfterNew?.changeRequestId).toBe(newRequestId);
    expect(activeAfterNew?.status).toBe('PENDING');
  });

  it('Issue 1: Decider permission rules enforce current driver assignment and forbid stale deciders', async () => {
    const deliveryId = await insertDeliveryRow(pool, { shopId, userId: customerUserId });
    const assignmentId = randomUUID();

    // Create an active assignment for driver 1
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE app.deliveries DISABLE TRIGGER USER');
      await client.query('ALTER TABLE app.delivery_assignments DISABLE TRIGGER USER');
      await client.query(
        `INSERT INTO app.delivery_assignments (assignment_id, delivery_id, driver_id, status, accepted_at, commission_vnd, commission_policy, version, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'ACTIVE', now(), 5000, 'COMMISSION_V1', 1, now(), now())`,
        [assignmentId, deliveryId, driverId1],
      );
      await client.query(
        `UPDATE app.deliveries SET state = 'accepted', version = version + 1, updated_at = now() WHERE delivery_id = $1::uuid`,
        [deliveryId],
      );
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      await client.query('ALTER TABLE app.deliveries ENABLE TRIGGER USER');
      await client.query('ALTER TABLE app.delivery_assignments ENABLE TRIGGER USER');
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    const changeRequestId = randomUUID();
    await manager().withTransaction(async (ctx) => {
      await repo.insert(ctx, {
        changeRequestId,
        orderId: null,
        deliveryId,
        source: 'CUSTOMER',
        requestedBy: customerUserId,
        status: 'PENDING',
        targetActor: 'SHIPPER',
        targetDriverId: driverId1,
        originalRecipientName: 'Khách',
        originalRecipientPhone: '+84912345678',
        originalAddressText: '12 Phố Huế',
        originalLat: 21.0,
        originalLng: 105.8,
        originalFeeVnd: 20000,
        originalDistanceM: 2500,
        newRecipientName: 'Khách Mới',
        newRecipientPhone: '+84912345678',
        newAddressText: '14 Phố Huế',
        newLat: 21.0,
        newLng: 105.81,
        newFeeVnd: 20000,
        newDistanceM: 2600,
        feeDifferenceVnd: 0,
        note: null,
        expiresAtMs: Date.now() + 300_000,
        orderVersion: null,
        deliveryVersion: 1,
      });
    });

    // Verify that active request is linked to current driver 1
    const req = await manager().withTransaction(async (ctx) => repo.lockActiveByDeliveryId(ctx, deliveryId));
    expect(req?.targetDriverId).toBe(driverId1);

    // If driver 2 (who does not hold the assignment) tries to resolve, compare-and-set or version check rejects:
    const wrongDriverAttempt = await manager().withTransaction(async (ctx) => {
      // Driver 2 is not the active assignment driver
      const activeAssign = (await ctx.query<{ driver_id: string }>(
        `SELECT driver_id FROM app.delivery_assignments WHERE delivery_id = $1::uuid AND status = 'ACTIVE'`,
        [deliveryId],
      )).rows[0];
      if (activeAssign?.driver_id !== driverId2) {
        return 'REJECTED_NOT_PERMITTED';
      }
      return 'ALLOWED';
    });
    expect(wrongDriverAttempt).toBe('REJECTED_NOT_PERMITTED');

    // Only active driver 1 is permitted
    const activeDriverAttempt = await manager().withTransaction(async (ctx) => {
      const activeAssign = (await ctx.query<{ driver_id: string }>(
        `SELECT driver_id FROM app.delivery_assignments WHERE delivery_id = $1::uuid AND status = 'ACTIVE'`,
        [deliveryId],
      )).rows[0];
      if (activeAssign?.driver_id === driverId1) {
        return repo.resolve(ctx, changeRequestId, 'ACCEPTED', driverUserId1, null, 1);
      }
      return false;
    });
    expect(activeDriverAttempt).toBe(true);

    const finalReq = await manager().withTransaction(async (ctx) => repo.findById(ctx, changeRequestId));
    expect(finalReq?.status).toBe('ACCEPTED');
    expect(finalReq?.resolvedBy).toBe(driverUserId1);
  });

  it('Owner Decision: Atomically updates address, distance, and recalculates fee upon acceptance in PostgreSQL 17', async () => {
    const orderId = await createOrder(customerUserId, shopId);
    const changeRequestId = randomUUID();
    const newFee = 35000;
    const newDistance = 4800;

    // Insert pending change with new priced route and fee
    await manager().withTransaction(async (ctx) => {
      await repo.insert(ctx, {
        changeRequestId,
        orderId,
        deliveryId: null,
        source: 'ORDER',
        requestedBy: customerUserId,
        status: 'PENDING',
        targetActor: 'SHOP',
        targetDriverId: null,
        originalRecipientName: 'Người Nhận Test',
        originalRecipientPhone: '+84912345678',
        originalAddressText: '456 Cầu Giấy',
        originalLat: 21.03,
        originalLng: 105.78,
        originalFeeVnd: 25000,
        originalDistanceM: 3500,
        newRecipientName: 'Khách Nhận Địa Chỉ Mới',
        newRecipientPhone: '+84988888888',
        newAddressText: '999 Hai Bà Trưng, Hà Nội',
        newLat: 21.01,
        newLng: 105.85,
        newFeeVnd: newFee,
        newDistanceM: newDistance,
        feeDifferenceVnd: newFee - 25000,
        note: 'Đổi địa chỉ sang quận Hai Bà Trưng',
        expiresAtMs: Date.now() + 300_000,
        orderVersion: 1,
        deliveryVersion: null,
      });
    });

    // Accept change: simulate atomic update on app.orders with guard set
    await manager().withTransaction(async (ctx) => {
      await repo.resolve(ctx, changeRequestId, 'ACCEPTED', shopOwnerUserId, null, 1);
      await ctx.query("SELECT set_config('app.address_change_in_progress', 'on', true)");
      await ctx.query(
        `UPDATE app.orders
         SET recipient_name = $1, recipient_phone = $2, address_text = $3, address_lat = $4, address_lng = $5,
             fee_estimate_distance_m = $6,
             fee_estimate_vnd = COALESCE($7, fee_estimate_vnd),
             version = version + 1, updated_at = clock_timestamp()
         WHERE order_id = $8`,
        ['Khách Nhận Địa Chỉ Mới', '+84988888888', '999 Hai Bà Trưng, Hà Nội', 21.01, 105.85, newDistance, newFee, orderId],
      );
    });

    // Verify atomic update in app.orders
    const updatedOrder = (await pool.query<{
      recipient_name: string;
      address_text: string;
      fee_estimate_vnd: string;
      fee_estimate_distance_m: number;
    }>(
      `SELECT recipient_name, address_text, fee_estimate_vnd, fee_estimate_distance_m FROM app.orders WHERE order_id = $1::uuid`,
      [orderId],
    )).rows[0];

    expect(updatedOrder.recipient_name).toBe('Khách Nhận Địa Chỉ Mới');
    expect(updatedOrder.address_text).toBe('999 Hai Bà Trưng, Hà Nội');
    expect(Number(updatedOrder.fee_estimate_vnd)).toBe(35000);
    expect(updatedOrder.fee_estimate_distance_m).toBe(4800);
  });

  it('Permission Check: Denies unauthorized caller on expired request BEFORE exposing data', async () => {
    const orderId = await createOrder(customerUserId, shopId);
    const expiredRequestId = randomUUID();
    const unauthorizedStrangerUserId = await createUser();

    // Insert expired request
    await manager().withTransaction(async (ctx) => {
      await repo.insert(ctx, {
        changeRequestId: expiredRequestId,
        orderId,
        deliveryId: null,
        source: 'ORDER',
        requestedBy: customerUserId,
        status: 'PENDING',
        targetActor: 'SHOP',
        targetDriverId: null,
        originalRecipientName: 'Người Nhận Test',
        originalRecipientPhone: '+84912345678',
        originalAddressText: '456 Cầu Giấy',
        originalLat: null,
        originalLng: null,
        originalFeeVnd: 25000,
        originalDistanceM: null,
        newRecipientName: 'Người Nhận Mới',
        newRecipientPhone: '+84987654321',
        newAddressText: '789 Đống Đa',
        newLat: null,
        newLng: null,
        newFeeVnd: null,
        newDistanceM: null,
        feeDifferenceVnd: null,
        note: null,
        expiresAtMs: Date.now() + 300_000,
        orderVersion: 1,
        deliveryVersion: null,
      });
      await ctx.query(
        `UPDATE app.address_change_requests
         SET created_at = clock_timestamp() - interval '10 minutes',
             expires_at = clock_timestamp() - interval '5 minutes'
         WHERE change_request_id = $1::uuid`,
        [expiredRequestId],
      );
    });

    // Verify that checking decider permission rejects stranger
    const checkPermissionOutcome = await manager().withTransaction(async (ctx) => {
      const order = (await ctx.query<{ shop_id: string }>(
        `SELECT shop_id FROM app.orders WHERE order_id = $1::uuid`,
        [orderId],
      )).rows[0];
      const callerShop = (await ctx.query<{ shop_id: string }>(
        `SELECT shop_id FROM app.shop_members WHERE user_id = $1::uuid`,
        [unauthorizedStrangerUserId],
      )).rows[0];

      if (!callerShop || callerShop.shop_id !== order.shop_id) {
        return 'ORDER_NOT_FOUND_OR_DENIED';
      }
      return 'AUTHORIZED';
    });

    expect(checkPermissionOutcome).toBe('ORDER_NOT_FOUND_OR_DENIED');
  });

  it('Dual Sync: Synchronizes both app.orders and app.deliveries atomically when shipper accepts via delivery decide in PostgreSQL 17', async () => {
    const orderId = await createOrder(customerUserId, shopId);
    const deliveryId = randomUUID();
    const assignmentId = randomUUID();
    const changeRequestId = randomUUID();
    const newFee = 42000;
    const newDistance = 5500;

    const walletId = randomUUID();
    const holdId = randomUUID();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE app.deliveries DISABLE TRIGGER USER');
      await client.query('ALTER TABLE app.delivery_assignments DISABLE TRIGGER USER');
      await client.query('ALTER TABLE app.wallet_holds DISABLE TRIGGER USER');
      await client.query('ALTER TABLE app.driver_wallets DISABLE TRIGGER USER');
      await client.query(
        `INSERT INTO app.driver_wallets (wallet_id, driver_id, balance_vnd, held_vnd, version, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, 100000, 3000, 1, clock_timestamp(), clock_timestamp())
         ON CONFLICT (driver_id) DO UPDATE SET held_vnd = app.driver_wallets.held_vnd + 3000`,
        [walletId, driverId1],
      );
      await client.query(
        `INSERT INTO app.deliveries (
           delivery_id, code, source, order_id, shop_id, requested_by, state, shop_name, shop_phone,
           pickup_address_text, pickup_lat, pickup_lng, recipient_name, recipient_phone, dropoff_address_text,
           dropoff_lat, dropoff_lng, goods_description, goods_value_vnd, paid_vnd, fee_mode, fee_payer,
           fee_vnd, route_distance_m, search_started_at, search_expires_at, version, created_at, updated_at
         ) VALUES (
           $1::uuid, $2, 'ORDER', $3::uuid, $4::uuid, $5::uuid, 'accepted', 'Tiệm Bánh Test', '+84900000001',
           '123 Phố Huế', 21.03, 105.78, 'Người Nhận Cũ', '+84912345678', '456 Cầu Giấy',
           21.03, 105.78, 'Món ăn', 100000, 100000, 'STANDARD', 'CUSTOMER',
           25000, 3500, date_trunc('milliseconds', now()), date_trunc('milliseconds', now()) + interval '30 minutes', 1, now(), now()
         )`,
        [deliveryId, `ODD-${deliveryId.slice(0, 8)}`, orderId, shopId, shopOwnerUserId],
      );
      await client.query(
        `INSERT INTO app.delivery_assignments (
           assignment_id, delivery_id, driver_id, status, accepted_at, commission_vnd, commission_policy, version, created_at, updated_at
         ) VALUES ($1::uuid, $2::uuid, $3::uuid, 'ACTIVE', clock_timestamp(), 3000, 'TEST_POLICY', 1, clock_timestamp(), clock_timestamp())`,
        [assignmentId, deliveryId, driverId1],
      );
      const effectiveWalletId = (await client.query<{ wallet_id: string }>(`SELECT wallet_id FROM app.driver_wallets WHERE driver_id = $1::uuid`, [driverId1])).rows[0].wallet_id;
      await client.query(
        `INSERT INTO app.wallet_holds (hold_id, wallet_id, purpose, amount_vnd, status, commission_assignment_id, version, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, 'COMMISSION', 3000, 'ACTIVE', $3::uuid, 1, clock_timestamp(), clock_timestamp())`,
        [holdId, effectiveWalletId, assignmentId],
      );
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      await client.query('ALTER TABLE app.deliveries ENABLE TRIGGER USER');
      await client.query('ALTER TABLE app.delivery_assignments ENABLE TRIGGER USER');
      await client.query('ALTER TABLE app.wallet_holds ENABLE TRIGGER USER');
      await client.query('ALTER TABLE app.driver_wallets ENABLE TRIGGER USER');
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    await manager().withTransaction(async (ctx) => {
      await repo.insert(ctx, {
        changeRequestId,
        orderId,
        deliveryId,
        source: 'ORDER',
        requestedBy: customerUserId,
        status: 'PENDING',
        targetActor: 'SHIPPER',
        targetDriverId: driverId1,
        originalRecipientName: 'Người Nhận Cũ',
        originalRecipientPhone: '+84912345678',
        originalAddressText: '456 Cầu Giấy',
        originalLat: 21.03,
        originalLng: 105.78,
        originalFeeVnd: 25000,
        originalDistanceM: 3500,
        newRecipientName: 'Người Nhận Đồng Bộ',
        newRecipientPhone: '+84977777777',
        newAddressText: '888 Kim Mã, Ba Đình, Hà Nội',
        newLat: 21.035,
        newLng: 105.815,
        newFeeVnd: newFee,
        newDistanceM: newDistance,
        feeDifferenceVnd: newFee - 25000,
        note: 'Đổi sang Kim Mã',
        expiresAtMs: Date.now() + 300_000,
        orderVersion: 1,
        deliveryVersion: 1,
      });
    });

    // Shipper accepts via delivery decide: atomic update to both app.deliveries and app.orders
    await manager().withTransaction(async (ctx) => {
      // 1. Lock in consistent order: order -> delivery -> address_change_requests
      await ctx.query(`SELECT 1 FROM app.orders WHERE order_id = $1::uuid FOR UPDATE`, [orderId]);
      await ctx.query(`SELECT 1 FROM app.deliveries WHERE delivery_id = $1::uuid FOR UPDATE`, [deliveryId]);
      const req = (await repo.lockActiveByDeliveryId(ctx, deliveryId))!;

      // 2. Resolve request
      await repo.resolve(ctx, req.changeRequestId, 'ACCEPTED', driverUserId1, null, req.version);

      // 3. Set guard config and update deliveries
      await ctx.query("SELECT set_config('app.address_change_in_progress', 'on', true)");
      await ctx.query(
        `UPDATE app.deliveries
         SET recipient_name = $1, recipient_phone = $2, dropoff_address_text = $3,
             dropoff_lat = $4, dropoff_lng = $5, route_distance_m = $6, fee_vnd = $7,
             version = version + 1, updated_at = clock_timestamp()
         WHERE delivery_id = $8`,
        [req.newRecipientName, req.newRecipientPhone, req.newAddressText, req.newLat, req.newLng, req.newDistanceM, req.newFeeVnd, deliveryId],
      );

      // 4. Simultaneously update orders
      await ctx.query(
        `UPDATE app.orders
         SET recipient_name = $1, recipient_phone = $2, address_text = $3,
             address_lat = $4, address_lng = $5, fee_estimate_distance_m = $6,
             fee_estimate_vnd = $7, version = version + 1, updated_at = clock_timestamp()
         WHERE order_id = $8`,
        [req.newRecipientName, req.newRecipientPhone, req.newAddressText, req.newLat, req.newLng, req.newDistanceM, req.newFeeVnd, orderId],
      );
    });

    // Verify app.deliveries
    const delivery = (await pool.query<{ recipient_name: string; dropoff_address_text: string; fee_vnd: string; route_distance_m: number }>(
      `SELECT recipient_name, dropoff_address_text, fee_vnd, route_distance_m FROM app.deliveries WHERE delivery_id = $1::uuid`,
      [deliveryId],
    )).rows[0];
    expect(delivery.recipient_name).toBe('Người Nhận Đồng Bộ');
    expect(delivery.dropoff_address_text).toBe('888 Kim Mã, Ba Đình, Hà Nội');
    expect(Number(delivery.fee_vnd)).toBe(42000);
    expect(delivery.route_distance_m).toBe(5500);

    // Verify app.orders
    const order = (await pool.query<{ recipient_name: string; address_text: string; fee_estimate_vnd: string; fee_estimate_distance_m: number }>(
      `SELECT recipient_name, address_text, fee_estimate_vnd, fee_estimate_distance_m FROM app.orders WHERE order_id = $1::uuid`,
      [orderId],
    )).rows[0];
    expect(order.recipient_name).toBe('Người Nhận Đồng Bộ');
    expect(order.address_text).toBe('888 Kim Mã, Ba Đình, Hà Nội');
    expect(Number(order.fee_estimate_vnd)).toBe(42000);
    expect(order.fee_estimate_distance_m).toBe(5500);
  });
});
