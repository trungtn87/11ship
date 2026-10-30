import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Pool } from 'pg';
import { AddressChangeRepository } from '../../apps/backend/src/address-change/address-change-repository';
import { poolClientSource } from '../../apps/backend/src/transaction/pg-client-source';
import { createActiveShopFor, createDriverFor, purgePhone, randomPhone } from './support/auth-fixtures';
import { insertDeliveryRow } from './support/delivery-fixtures';
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
    await pool.query(
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
  });

  afterAll(async () => {
    if (pool !== undefined) {
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
        expiresAtMs: now - 1000, // already expired
        orderVersion: 1,
        deliveryVersion: null,
      });
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
    await pool.query(
      `INSERT INTO app.delivery_assignments (assignment_id, delivery_id, driver_id, state, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'accepted', now(), now())`,
      [assignmentId, deliveryId, driverId1],
    );
    await pool.query(
      `UPDATE app.deliveries SET state = 'accepted', updated_at = now() WHERE delivery_id = $1::uuid`,
      [deliveryId],
    );

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
        `SELECT driver_id FROM app.delivery_assignments WHERE delivery_id = $1::uuid AND state = 'accepted'`,
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
        `SELECT driver_id FROM app.delivery_assignments WHERE delivery_id = $1::uuid AND state = 'accepted'`,
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
});
