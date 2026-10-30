import { randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { M14_ROUTING } from '../../apps/backend/src/delivery/m14-route-client';
import { ApiResponse, AuthApp, dataOf, errorCode, startAuthApp } from './support/auth-fixtures';
import { Customer, Json, newCustomer, newShipper, PRIVACY, Shipper, TERMS, walletOf } from './support/m10-fixtures';

const tag = randomBytes(3).toString('hex').toUpperCase();

describe('F5 Integration: Customer Courier & COD Lifecycle (PostgreSQL 17)', () => {
  let app: AuthApp;
  let router: http.Server;
  let alice: Customer;
  let bob: Customer;
  const drivers: string[] = [];
  const createdDeliveryIds: string[] = [];
  let addedPolicy = false;

  beforeAll(async () => {
    // Setup local real M14 routing HTTP server
    router = http.createServer((request, response) => {
      request.resume();
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ trip: { summary: { length: 2.5, time: 420 } } }));
    });
    await new Promise<void>((resolve) => router.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(router.address() as AddressInfo).port}`;

    app = await startAuthApp(
      {},
      {
        relaxTimeouts: true,
        configOverride: { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY } },
        overrides: [{ provide: M14_ROUTING, useValue: { origin, timeoutMs: 3000 } }],
      },
    );

    alice = await newCustomer(app, `Khách Alice ${tag}`);
    bob = await newCustomer(app, `Khách Bob ${tag}`);

    // Ensure fee policy exists in test database
    const existing = await app.pool.query('SELECT 1 FROM app.shipping_fee_policy_versions LIMIT 1');
    if ((existing.rowCount ?? 0) === 0) {
      await app.pool.query(
        `INSERT INTO app.shipping_fee_policy_versions (version_id, version_no, schema_version, tiers, applied_by, applied_at) VALUES ($1::uuid, 1, 2, $2::jsonb, $3::uuid, now())`,
        [
          randomUUID(),
          JSON.stringify([
            { from_m: 0, to_m: 3000, fee_vnd: 10000 },
            { from_m: 3000, to_m: 6000, fee_vnd: 15000 },
            { from_m: 6000, to_m: 10000, fee_vnd: 20000 },
          ]),
          alice.userId,
        ],
      );
      addedPolicy = true;
    }
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
    await new Promise<void>((resolve) => router.close(() => resolve()));
  });

  async function cleanup(): Promise<void> {
    const client = await app.pool.connect();
    const tables = [
      'reviews',
      'complaint_messages',
      'complaint_attachments',
      'complaints',
      'delivery_tracking_links',
      'wallet_ledger_entries',
      'wallet_holds',
      'delivery_incidents',
      'delivery_events',
      'delivery_assignments',
      'deliveries',
      'driver_wallets',
      'shipping_fee_agreement_events',
      'shipping_fee_agreements',
    ];
    try {
      await client.query('BEGIN');
      for (const table of tables) {
        await client.query(`ALTER TABLE app.${table} DISABLE TRIGGER USER`);
      }
      if (drivers.length > 0) {
        const wallets = `SELECT wallet_id FROM app.driver_wallets WHERE driver_id = ANY($1::uuid[])`;
        await client.query(`DELETE FROM app.wallet_ledger_entries WHERE wallet_id IN (${wallets})`, [drivers]);
        await client.query(`DELETE FROM app.wallet_holds WHERE wallet_id IN (${wallets})`, [drivers]);
      }
      if (createdDeliveryIds.length > 0) {
        await client.query('DELETE FROM app.reviews WHERE delivery_id = ANY($1::uuid[])', [createdDeliveryIds]);
        await client.query('DELETE FROM app.complaint_attachments WHERE complaint_id IN (SELECT complaint_id FROM app.complaints WHERE delivery_id = ANY($1::uuid[]))', [createdDeliveryIds]);
        await client.query('DELETE FROM app.complaint_messages WHERE complaint_id IN (SELECT complaint_id FROM app.complaints WHERE delivery_id = ANY($1::uuid[]))', [createdDeliveryIds]);
        await client.query('DELETE FROM app.complaints WHERE delivery_id = ANY($1::uuid[])', [createdDeliveryIds]);
        await client.query('DELETE FROM app.delivery_tracking_links WHERE delivery_id = ANY($1::uuid[])', [createdDeliveryIds]);
        await client.query('DELETE FROM app.delivery_incidents WHERE delivery_id = ANY($1::uuid[])', [createdDeliveryIds]);
        await client.query('DELETE FROM app.delivery_events WHERE delivery_id = ANY($1::uuid[])', [createdDeliveryIds]);
        await client.query('DELETE FROM app.delivery_assignments WHERE delivery_id = ANY($1::uuid[])', [createdDeliveryIds]);
        await client.query(
          'DELETE FROM app.shipping_fee_agreement_events WHERE agreement_id IN (SELECT agreement_id FROM app.shipping_fee_agreements WHERE delivery_id = ANY($1::uuid[]))',
          [createdDeliveryIds],
        );
        await client.query('DELETE FROM app.shipping_fee_agreements WHERE delivery_id = ANY($1::uuid[])', [createdDeliveryIds]);
        await client.query('DELETE FROM app.deliveries WHERE delivery_id = ANY($1::uuid[])', [createdDeliveryIds]);
      }
      if (drivers.length > 0) {
        await client.query('DELETE FROM app.shipper_latest_locations WHERE driver_id = ANY($1::uuid[])', [drivers]);
        await client.query('DELETE FROM app.driver_wallets WHERE driver_id = ANY($1::uuid[])', [drivers]);
      }
      if (addedPolicy) {
        await client.query('DELETE FROM app.shipping_fee_policy_versions');
      }
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      for (const table of tables) {
        await client.query(`ALTER TABLE app.${table} ENABLE TRIGGER USER`);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  // Helpers
  const asCustomer = (c: Customer, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, key = randomUUID()): Promise<ApiResponse> =>
    app.call(method, path, { bearer: c.token, ...(method !== 'GET' ? { headers: { 'idempotency-key': key } } : {}), ...(body === undefined ? {} : { body }) });

  const asShipper = (s: Shipper, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, key = randomUUID()): Promise<ApiResponse> =>
    app.call(method, path, { bearer: s.token, ...(method !== 'GET' ? { headers: { 'idempotency-key': key } } : {}), ...(body === undefined ? {} : { body }) });

  it('1. Customer creates direct courier delivery with full GPS pins (Standard fee)', async () => {
    const res = await asCustomer(alice, 'POST', '/customers/me/deliveries', {
      recipient_name: 'Nguyễn Văn Nhận',
      recipient_phone: '0987654321',
      pickup_address_text: '123 Đường Láng, Hà Nội',
      pickup_lat: 21.0005,
      pickup_lng: 105.8005,
      dropoff_address_text: '456 Cầu Giấy, Hà Nội',
      dropoff_lat: 21.0333,
      dropoff_lng: 105.7999,
      goods_description: 'Tài liệu hợp đồng',
      fee_payer: 'SENDER',
    });

    expect(res.status).toBe(201);
    const data = dataOf(res) as Json;
    expect(data.delivery_id).toBeDefined();
    createdDeliveryIds.push(data.delivery_id);

    expect(data.source).toBe('CUSTOMER');
    expect(data.state).toBe('waiting_driver');
    expect(data.fee.payer).toBe('SENDER');
    expect(data.fee.amount_vnd).toBe(10000); // 2.5km fits 0-3km tier (10,000 VND)
    expect(data.recipient_pays_vnd).toBe(0);
    expect(data.cod_vnd).toBe(0);

    // Verify row in database
    const dbRow = (await app.pool.query('SELECT source, shop_id, order_id, fee_payer, fee_mode, fee_vnd FROM app.deliveries WHERE delivery_id = $1::uuid', [data.delivery_id])).rows[0];
    expect(dbRow.source).toBe('CUSTOMER');
    expect(dbRow.shop_id).toBeNull();
    expect(dbRow.order_id).toBeNull();
    expect(dbRow.fee_payer).toBe('SENDER');
    expect(dbRow.fee_mode).toBe('STANDARD');
    expect(Number(dbRow.fee_vnd)).toBe(10000);
  });

  it('2. Customer creates delivery without GPS pins (requires agreed fee, sets fee_mode=AGREED)', async () => {
    // Missing GPS and missing agreed fee -> 400 FEE_REQUIRED
    const bad = await asCustomer(alice, 'POST', '/customers/me/deliveries', {
      recipient_name: 'Trần Nhận Hàng',
      recipient_phone: '0912345678',
      pickup_address_text: 'Ngõ sâu không có GPS',
      dropoff_address_text: 'Hẻm nhỏ',
      goods_description: 'Quà tặng',
    });
    expect(bad.status).toBe(400);
    expect(errorCode(bad)).toBe('FEE_REQUIRED');

    // With agreed fee -> 201
    const ok = await asCustomer(alice, 'POST', '/customers/me/deliveries', {
      recipient_name: 'Trần Nhận Hàng',
      recipient_phone: '0912345678',
      pickup_address_text: 'Ngõ sâu không có GPS',
      dropoff_address_text: 'Hẻm nhỏ',
      goods_description: 'Quà sinh nhật',
      agreed_fee: { amount_vnd: 35000, reason_note: 'Khách tự đề xuất' },
    });
    expect(ok.status).toBe(201);
    const data = dataOf(ok) as Json;
    createdDeliveryIds.push(data.delivery_id);

    expect(data.fee.amount_vnd).toBe(35000);
    expect(data.fee.payer).toBe('SENDER');
    expect(data.pickup.lat).toBeNull();
    expect(data.recipient.lat).toBeNull();

    const dbRow = (await app.pool.query('SELECT fee_mode, fee_vnd FROM app.deliveries WHERE delivery_id = $1::uuid', [data.delivery_id])).rows[0];
    expect(dbRow.fee_mode).toBe('AGREED');
    expect(Number(dbRow.fee_vnd)).toBe(35000);
  });

  it('3. COD validation, recipient payment sum and limits', async () => {
    // COD > 10,000,000 VND -> 400
    const overLimit = await asCustomer(alice, 'POST', '/customers/me/deliveries', {
      recipient_name: 'Người Nhận',
      recipient_phone: '0912345678',
      dropoff_address_text: 'Địa chỉ',
      goods_description: 'Điện thoại xịn',
      cod_vnd: 15_000_000,
      agreed_fee: { amount_vnd: 50000 },
    });
    expect(overLimit.status).toBe(400);

    // Invalid fee_payer (rejects 'CUSTOMER' / 'SHOP' on customer courier) -> 400
    const invalidPayer = await asCustomer(alice, 'POST', '/customers/me/deliveries', {
      recipient_name: 'Người Nhận',
      recipient_phone: '0912345678',
      dropoff_address_text: 'Địa chỉ',
      goods_description: 'Hàng hoá',
      fee_payer: 'SHOP',
      agreed_fee: { amount_vnd: 50000 },
    });
    expect(invalidPayer.status).toBe(400);

    // Valid COD with RECIPIENT payer -> recipient_pays_vnd = cod + fee
    const validCod = await asCustomer(alice, 'POST', '/customers/me/deliveries', {
      recipient_name: 'Lê Văn COD',
      recipient_phone: '0933333333',
      pickup_address_text: 'Cửa hàng quần áo',
      dropoff_address_text: 'Nhà riêng',
      goods_description: 'Áo khoác',
      cod_vnd: 450_000,
      fee_payer: 'RECIPIENT',
      agreed_fee: { amount_vnd: 30000 },
    });
    expect(validCod.status).toBe(201);
    const codData = dataOf(validCod) as Json;
    createdDeliveryIds.push(codData.delivery_id);

    expect(codData.cod_vnd).toBe(450_000);
    expect(codData.fee.amount_vnd).toBe(30_000);
    expect(codData.fee.payer).toBe('RECIPIENT');
    expect(codData.recipient_pays_vnd).toBe(480_000); // 450k + 30k
  });

  it('4. Shipper accepts delivery; double accept race condition rejected', async () => {
    const s1 = await newShipper(app, drivers, 100_000);
    const s2 = await newShipper(app, drivers, 100_000);

    const deliveryRes = await asCustomer(alice, 'POST', '/customers/me/deliveries', {
      recipient_name: 'Phạm Thị Thử',
      recipient_phone: '0944444444',
      dropoff_address_text: 'Địa chỉ thử race',
      goods_description: 'Bưu kiện',
      agreed_fee: { amount_vnd: 25000 },
    });
    expect(deliveryRes.status).toBe(201);
    const deliveryId = String((dataOf(deliveryRes) as Json).delivery_id);
    createdDeliveryIds.push(deliveryId);

    // Shipper1 and Shipper2 race to accept
    const [res1, res2] = await Promise.all([
      asShipper(s1, 'POST', `/driver/deliveries/${deliveryId}/accept`, {}),
      asShipper(s2, 'POST', `/driver/deliveries/${deliveryId}/accept`, {}),
    ]);

    expect([res1.status, res2.status].sort()).toEqual([200, 409]);
    const winner = res1.status === 200 ? s1 : s2;
    const loser = res1.status === 200 ? s2 : s1;
    const winnerRes = res1.status === 200 ? res1 : res2;

    // Verify assignment in DB
    const assignments = await app.pool.query('SELECT driver_id, status FROM app.delivery_assignments WHERE delivery_id = $1::uuid', [deliveryId]);
    expect(assignments.rows).toHaveLength(1);
    expect(assignments.rows[0].driver_id).toBe(winner.driverId);
    expect(assignments.rows[0].status).toBe('ACTIVE');

    // Winner wallet has commission held (1000 VND), loser wallet is untouched
    const loserWallet = await walletOf(app, loser);
    expect(loserWallet.held).toBe(0);

    // Complete delivery so winner has no pending work
    const p = await asShipper(winner, 'POST', `/driver/deliveries/${deliveryId}/pickup`, { expected_version: (dataOf(winnerRes) as Json).version });
    await asShipper(winner, 'POST', `/driver/deliveries/${deliveryId}/complete`, { expected_version: (dataOf(p) as Json).version });
  });

  it('5. Full lifecycle: Pickup -> Complete -> Ledger Check (No COD in platform ledger)', async () => {
    const s = await newShipper(app, drivers, 100_000);

    // Delivery with 500,000 VND COD and 20,000 VND delivery fee
    const res = await asCustomer(alice, 'POST', '/customers/me/deliveries', {
      recipient_name: 'Đặng Hoàn Thành',
      recipient_phone: '0955555555',
      dropoff_address_text: '789 Giải Phóng',
      goods_description: 'Đồng hồ đeo tay',
      cod_vnd: 500_000,
      fee_payer: 'RECIPIENT',
      agreed_fee: { amount_vnd: 20000 },
    });
    const deliveryId = String((dataOf(res) as Json).delivery_id);
    createdDeliveryIds.push(deliveryId);

    // Shipper accepts
    const accepted = await asShipper(s, 'POST', `/driver/deliveries/${deliveryId}/accept`, {});
    expect(accepted.status).toBe(200);
    const acceptedData = dataOf(accepted) as Json;

    // Shipper picks up
    const picked = await asShipper(s, 'POST', `/driver/deliveries/${deliveryId}/pickup`, {
      expected_version: acceptedData.version,
    });
    expect(picked.status).toBe(200);

    // Customer cannot cancel after pickup
    const cancelTry = await asCustomer(alice, 'POST', `/customers/me/deliveries/${deliveryId}/cancel`, {
      reason: 'Khách muốn hủy',
      expected_version: (dataOf(picked) as Json).version,
    });
    expect(cancelTry.status).toBeGreaterThanOrEqual(400);

    // Shipper completes
    const completed = await asShipper(s, 'POST', `/driver/deliveries/${deliveryId}/complete`, {
      expected_version: (dataOf(picked) as Json).version,
    });
    expect(completed.status).toBe(200);
    expect((dataOf(completed) as Json).state).toBe('completed');

    // Verify wallet ledger: Check that COD amount (500,000 VND) NEVER touched wallet ledger!
    const ledgerRows = await app.pool.query(
      'SELECT delta_vnd, entry_kind FROM app.wallet_ledger_entries WHERE wallet_id = $1::uuid',
      [s.walletId],
    );
    for (const row of ledgerRows.rows) {
      expect(Math.abs(Number(row.delta_vnd))).not.toBe(500_000);
    }
  });

  it('6. Cancellation before pickup resets / terminates delivery cleanly', async () => {
    const res = await asCustomer(alice, 'POST', '/customers/me/deliveries', {
      recipient_name: 'Ngô Thử Hủy',
      recipient_phone: '0966666666',
      dropoff_address_text: 'Cầu Diễn',
      goods_description: 'Bánh mỳ',
      agreed_fee: { amount_vnd: 20000 },
    });
    const delivery = dataOf(res) as Json;
    createdDeliveryIds.push(delivery.delivery_id);

    // Customer cancels before any driver accepts
    const cancelled = await asCustomer(alice, 'POST', `/customers/me/deliveries/${delivery.delivery_id}/cancel`, {
      reason: 'Tôi đổi ý không gửi nữa',
      expected_version: delivery.version,
    });
    expect(cancelled.status).toBe(200);
    expect((dataOf(cancelled) as Json).state).toBe('cancelled_by_merchant');
  });

  it('7. Access control: other customer cannot read or cancel someone elses delivery', async () => {
    const res = await asCustomer(alice, 'POST', '/customers/me/deliveries', {
      recipient_name: 'Bảo Mật',
      recipient_phone: '0977777777',
      dropoff_address_text: 'Bí mật',
      goods_description: 'Hàng riêng tư',
      agreed_fee: { amount_vnd: 20000 },
    });
    const deliveryId = String((dataOf(res) as Json).delivery_id);
    createdDeliveryIds.push(deliveryId);

    // Bob tries to read Alice's delivery
    const readTry = await asCustomer(bob, 'GET', `/customers/me/deliveries/${deliveryId}`);
    expect([403, 404]).toContain(readTry.status);

    // Bob tries to cancel Alice's delivery
    const cancelTry = await asCustomer(bob, 'POST', `/customers/me/deliveries/${deliveryId}/cancel`, {
      reason: 'Phá hoại',
      expected_version: 1,
    });
    expect([403, 404]).toContain(cancelTry.status);
  });

  it('8. Public tracking link generation, security headers, dynamic data, map & revocation', async () => {
    const res = await asCustomer(alice, 'POST', '/customers/me/deliveries', {
      recipient_name: 'Khách Nhận Tracking',
      recipient_phone: '0911223344',
      pickup_address_text: 'Điểm nhận hàng',
      dropoff_address_text: 'Điểm giao hàng',
      goods_description: 'Hàng mẫu <script>alert("xss")</script>',
      cod_vnd: 200_000,
      fee_payer: 'RECIPIENT',
      agreed_fee: { amount_vnd: 25000 },
    });
    const deliveryId = String((dataOf(res) as Json).delivery_id);
    createdDeliveryIds.push(deliveryId);

    // Generate tracking link
    const linkRes = await asCustomer(alice, 'POST', `/customers/me/deliveries/${deliveryId}/tracking-link`);
    expect(linkRes.status).toBe(201);
    const linkData = dataOf(linkRes) as Json;
    expect(linkData.token).toBeDefined();
    expect(linkData.tracking_url).toBeDefined();
    const token = String(linkData.token);

    // Public JSON endpoint access: GET /v1/public/tracking/:token
    const publicJson = await app.call('GET', `/public/tracking/${token}`);
    expect(publicJson.status).toBe(200);
    expect(publicJson.headers.get('cache-control')).toContain('no-store');
    expect(publicJson.headers.get('x-robots-tag')).toContain('noindex, nofollow');
    expect(publicJson.headers.get('referrer-policy')).toBe('no-referrer');

    const trackData = dataOf(publicJson) as Json;
    expect(trackData.status).toBe('ACTIVE');
    expect(trackData.state).toBe('waiting_driver');
    expect(trackData.cod_vnd).toBe(200_000);
    expect(trackData.recipient_pays_vnd).toBe(225_000);
    expect(trackData.location).toBeNull();

    // Public HTML tracking page via route rewrite: GET /track/:token on root
    const htmlResponse = await fetch(`${app.running.baseUrl}/track/${token}`);
    expect(htmlResponse.status).toBe(200);
    const htmlText = await htmlResponse.text();
    // XSS prevented: script tag is escaped
    expect(htmlText).not.toContain('<script>alert("xss")</script>');
    expect(htmlText).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    // Leaflet map included
    expect(htmlText).toContain('unpkg.com/leaflet');
    expect(htmlText).toContain("L.map('map')");

    // Toggle location sharing ON
    const toggleOn = await asCustomer(alice, 'POST', `/customers/me/deliveries/${deliveryId}/tracking-link/toggle-location`, {
      share_location: true,
    });
    expect(toggleOn.status).toBe(200);
    expect((dataOf(toggleOn) as Json).share_location).toBe(true);

    // Revoke link
    const revoked = await asCustomer(alice, 'POST', `/customers/me/deliveries/${deliveryId}/tracking-link/revoke`);
    expect(revoked.status).toBe(200);
    expect((dataOf(revoked) as Json).revoked).toBe(true);

    // After revocation, public tracking returns EXPIRED and wipes active data
    const deadJson = await app.call('GET', `/public/tracking/${token}`);
    expect(deadJson.status).toBe(200);
    expect((dataOf(deadJson) as Json).status).toBe('EXPIRED');
    expect((dataOf(deadJson) as Json).message).toContain('hết hiệu lực');
  });

  it('9. Customer reviews shipper on completed customer delivery (shop_id is NULL)', async () => {
    const s = await newShipper(app, drivers, 100_000);

    const res = await asCustomer(alice, 'POST', '/customers/me/deliveries', {
      recipient_name: 'Khách Đánh Giá',
      recipient_phone: '0988776655',
      dropoff_address_text: 'Đống Đa',
      goods_description: 'Tài liệu',
      agreed_fee: { amount_vnd: 20000 },
    });
    const deliveryId = String((dataOf(res) as Json).delivery_id);
    createdDeliveryIds.push(deliveryId);

    // Accept -> Pickup -> Complete
    const a = await asShipper(s, 'POST', `/driver/deliveries/${deliveryId}/accept`, {});
    const p = await asShipper(s, 'POST', `/driver/deliveries/${deliveryId}/pickup`, { expected_version: (dataOf(a) as Json).version });
    await asShipper(s, 'POST', `/driver/deliveries/${deliveryId}/complete`, { expected_version: (dataOf(p) as Json).version });

    // Review state before rating
    const preReview = await asCustomer(alice, 'GET', `/customers/me/deliveries/${deliveryId}/review`);
    expect(preReview.status).toBe(200);
    expect((dataOf(preReview) as Json).shipper.can_review).toBe(true);

    // Customer rates shipper
    const rateRes = await asCustomer(alice, 'POST', `/customers/me/deliveries/${deliveryId}/review/shipper`, {
      stars: 5,
      comment: 'Tài xế giao rất nhanh và nhiệt tình',
    });
    expect(rateRes.status).toBe(201);
    const reviewData = dataOf(rateRes) as Json;
    expect(reviewData.review.review_id).toBeDefined();

    // Verify DB row: shop_id and order_id MUST be null, reviews_guard passed
    const dbReview = (
      await app.pool.query(
        'SELECT delivery_id, shop_id, order_id, reviewer_user_id, driver_id, stars, comment FROM app.reviews WHERE delivery_id = $1::uuid',
        [deliveryId],
      )
    ).rows[0];
    expect(dbReview).toMatchObject({
      delivery_id: deliveryId,
      shop_id: null,
      order_id: null,
      reviewer_user_id: alice.userId,
      driver_id: s.driverId,
      stars: 5,
      comment: 'Tài xế giao rất nhanh và nhiệt tình',
    });

    // Already reviewed -> can_review is now false
    const postReview = await asCustomer(alice, 'GET', `/customers/me/deliveries/${deliveryId}/review`);
    expect(postReview.status).toBe(200);
    expect((dataOf(postReview) as Json).shipper.can_review).toBe(false);
  });

  it('10. Customer direct chat and complaint support for customer delivery', async () => {
    const s = await newShipper(app, drivers, 100_000);

    const res = await asCustomer(alice, 'POST', '/customers/me/deliveries', {
      recipient_name: 'Khách Khiếu Nại',
      recipient_phone: '0977889900',
      dropoff_address_text: 'Thanh Xuân',
      goods_description: 'Tranh ảnh dễ vỡ',
      agreed_fee: { amount_vnd: 20000 },
    });
    const deliveryId = String((dataOf(res) as Json).delivery_id);
    createdDeliveryIds.push(deliveryId);

    // Accept by shipper
    await asShipper(s, 'POST', `/driver/deliveries/${deliveryId}/accept`, {});

    // Customer gets chat room seat: GET /v1/customers/me/deliveries/:id/chat
    const chatSeat = await asCustomer(alice, 'GET', `/customers/me/deliveries/${deliveryId}/chat`);
    expect(chatSeat.status).toBe(200);
    const seatData = dataOf(chatSeat) as Json;
    expect(seatData.room.id).toBe(deliveryId);
    expect(seatData.room.open).toBe(true);

    // Customer creates complaint for delivery: POST /v1/customers/me/complaints
    const complaintRes = await asCustomer(alice, 'POST', '/customers/me/complaints', {
      category: 'SERVICE',
      delivery_id: deliveryId,
      body: 'Giao hàng trễ so với thỏa thuận ban đầu',
    });
    expect([201, 200]).toContain(complaintRes.status);
    const complaintData = dataOf(complaintRes) as Json;
    expect(complaintData.complaint.complaint_id).toBeDefined();

    // Verify complaint row in DB has shop_id NULL
    const dbComplaint = (
      await app.pool.query('SELECT complaint_id, shop_id, delivery_id FROM app.complaints WHERE complaint_id = $1::uuid', [
        complaintData.complaint.complaint_id,
      ])
    ).rows[0];
    expect(dbComplaint.shop_id).toBeNull();
    expect(dbComplaint.delivery_id).toBe(deliveryId);
  });
});
