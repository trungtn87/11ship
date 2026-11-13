import { ShippingEligibilityService } from '../../apps/backend/src/shipping-policy/shipping-eligibility-service';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { DeliverySweeper } from '../../apps/backend/src/delivery/delivery-sweeper';
import { M14_ROUTING } from '../../apps/backend/src/delivery/m14-route-client';
import { NotificationEventService } from '../../apps/backend/src/notifications/notification-event-service';
import { NotificationRuntime, NotificationRetention } from '../../apps/backend/src/notifications/notification-runtime';
import { PushDispatcher } from '../../apps/backend/src/notifications/push-dispatcher';
import { ReminderBatcher } from '../../apps/backend/src/notifications/reminder-batcher';
import { NotificationRepository } from '../../apps/backend/src/notifications/notification-repository';
import { CATEGORY_OF_KIND } from '../../apps/backend/src/notifications/notification-constants';
import { TransactionManager } from '../../apps/backend/src/transaction/transaction-manager';
import { createLegacyDirectDeliveryView } from './support/legacy-direct-delivery';
import { ApiResponse, AuthApp, createActiveShopFor, createServiceArea, dataOf, errorCode, grantStrayRole, obtainProof, PASSWORD, randomPhone, startAuthApp } from './support/auth-fixtures';

// M08 on a REAL Nest pipeline and PostgreSQL: the outbox events of M07 become inbox rows and pushes. The push provider is the REAL FCM client talking
// to a local HTTP server that stands in for Google (the OAuth token endpoint and messages:send), so the HTTP shape, the retry and the error handling are
// exercised; nothing here proves delivery to a physical phone.

const TERMS = 'test-terms-20261011-v1';
const PRIVACY = 'test-privacy-20261011-v1';
const WEB_SHIP = { device_id: 'web-ship-0008', platform: 'WEB', app: 'SHIP' };
const WEB_FOOD = { device_id: 'web-food-0008', platform: 'WEB', app: 'FOOD' };
const tag = randomBytes(3).toString('hex').toUpperCase();
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface ShopOwner {
  readonly userId: string;
  readonly token: string;
  readonly shopId: string;
}

interface Shipper {
  readonly userId: string;
  readonly token: string;
  readonly driverId: string;
  readonly walletId: string;
}

describe('M08 — notifications, reminders and sync', () => {
  let app: AuthApp;
  let router: http.Server;
  let fcm: http.Server;
  let shop: ShopOwner;
  const drivers: string[] = [];
  const users: string[] = [];
  let addedPolicy = false;
  /** What the fake provider answers next (status), and what it received. */
  const fcmPlan = new Map<string, number[]>();
  const plan = (token: string, ...statuses: number[]): void => void fcmPlan.set(token, statuses);
  const fcmSeen: Json[] = [];

  const runtime = (): NotificationRuntime => app.running.app.get(NotificationRuntime);
  const pushes = (): PushDispatcher => app.running.app.get(PushDispatcher);
  const reminders = (): ReminderBatcher => app.running.app.get(ReminderBatcher);
  const sweeper = (): DeliverySweeper => app.running.app.get(DeliverySweeper);

  beforeAll(async () => {
    router = http.createServer((request, response) => {
      request.resume();
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ trip: { summary: { length: 2.5, time: 420 } } }));
    });
    await new Promise<void>((resolve) => router.listen(0, '127.0.0.1', resolve));
    fcm = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (c: Buffer) => chunks.push(c));
      request.on('end', () => {
        response.setHeader('content-type', 'application/json');
        if (request.url === '/token') {
          response.end(JSON.stringify({ access_token: 'test-access', expires_in: 3600 }));
          return;
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Json;
        fcmSeen.push({ url: request.url, auth: request.headers.authorization, body });
        const status = fcmPlan.get(String(body.message?.token))?.shift() ?? 200;
        response.statusCode = status;
        response.end(JSON.stringify(status === 200 ? { name: 'projects/test-proj/messages/1' } : status === 404 ? { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } } : { error: { status: 'UNAVAILABLE' } }));
      });
    });
    await new Promise<void>((resolve) => fcm.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(fcm.address() as AddressInfo).port}`;
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'm08-sa-')), 'sa.json');
    writeFileSync(file, JSON.stringify({ client_email: 'push@test-proj.iam.example', private_key: privateKey, token_uri: `${origin}/token` }));
    app = await startAuthApp(
      {},
      {
        relaxTimeouts: true,
        configOverride: { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY }, push: { projectId: 'test-proj', serviceAccountFile: file, apiOrigin: origin } },
        overrides: [{ provide: M14_ROUTING, useValue: { origin: `http://127.0.0.1:${(router.address() as AddressInfo).port}`, timeoutMs: 3000 } }],
      },
    );
    shop = await newShop();
    users.push(shop.userId);
    const existing = await app.pool.query('SELECT 1 FROM app.shipping_fee_policy_versions LIMIT 1');
    if ((existing.rowCount ?? 0) === 0) {
      await app.pool.query(
        `INSERT INTO app.shipping_fee_policy_versions (version_id, version_no, schema_version, tiers, applied_by, applied_at) VALUES ($1::uuid, 1, 2, $2::jsonb, $3::uuid, now())`,
        [randomUUID(), JSON.stringify([{ from_m: 0, to_m: 3000, fee_vnd: 10000 }, { from_m: 3000, to_m: 6000, fee_vnd: 15000 }, { from_m: 6000, to_m: 10000, fee_vnd: 20000 }]), shop.userId],
      );
      addedPolicy = true;
    }
    await settle();
  });

  afterAll(async () => {
    let failure: unknown;
    try {
      await cleanup();
    } catch (error) {
      failure = error;
    }
    try {
      await app.close();
    } catch (error) {
      failure ??= error;
    }
    await new Promise<void>((resolve) => router.close(() => resolve()));
    await new Promise<void>((resolve) => fcm.close(() => resolve()));
    if (failure !== undefined) throw failure;
  });

  async function cleanup(): Promise<void> {
    const client = await app.pool.connect();
    const tables = ['wallet_withdrawal_events', 'wallet_withdrawals', 'wallet_topup_requests', 'wallet_ledger_entries', 'wallet_holds', 'delivery_incidents', 'delivery_events', 'delivery_assignments', 'deliveries', 'driver_wallets', 'shipping_fee_agreement_events', 'shipping_fee_agreements', 'shipping_fee_policy_versions'];
    try {
      await client.query('BEGIN');
      for (const table of tables) {
        await client.query(`ALTER TABLE app.${table} DISABLE TRIGGER USER`);
      }
      const mine = `SELECT delivery_id FROM app.deliveries WHERE shop_id = $1::uuid`;
      const wallets = `SELECT wallet_id FROM app.driver_wallets WHERE driver_id = ANY($1::uuid[])`;
      await client.query('DELETE FROM app.notification_pushes WHERE recipient_user_id = ANY($1::uuid[])', [users]);
      await client.query(`DELETE FROM app.notification_reminders WHERE delivery_id IN (${mine})`, [shop.shopId]);
      await client.query(`DELETE FROM app.notification_offer_rounds WHERE delivery_id IN (${mine})`, [shop.shopId]);
      await client.query('DELETE FROM app.notifications WHERE recipient_user_id = ANY($1::uuid[])', [users]);
      await client.query('DELETE FROM app.notification_settings WHERE user_id = ANY($1::uuid[])', [users]);
      await client.query('DELETE FROM app.notification_push_tokens WHERE user_id = ANY($1::uuid[])', [users]);
      // Rows the withdrawal and topup tests committed: they reference the wallets deleted below.
      await client.query(`DELETE FROM app.wallet_withdrawal_events WHERE withdrawal_id IN (SELECT withdrawal_id FROM app.wallet_withdrawals WHERE driver_id = ANY($1::uuid[]))`, [drivers]);
      await client.query('DELETE FROM app.wallet_withdrawals WHERE driver_id = ANY($1::uuid[])', [drivers]);
      await client.query('DELETE FROM app.wallet_topup_requests WHERE driver_id = ANY($1::uuid[])', [drivers]);
      await client.query(`DELETE FROM app.wallet_ledger_entries WHERE wallet_id IN (${wallets})`, [drivers]);
      await client.query(`DELETE FROM app.wallet_holds WHERE wallet_id IN (${wallets})`, [drivers]);
      await client.query(`DELETE FROM app.delivery_incidents WHERE delivery_id IN (${mine})`, [shop.shopId]);
      await client.query(`DELETE FROM app.delivery_events WHERE delivery_id IN (${mine})`, [shop.shopId]);
      await client.query(`DELETE FROM app.shipping_fee_agreement_events WHERE agreement_id IN (SELECT agreement_id FROM app.shipping_fee_agreements WHERE delivery_id IN (${mine}))`, [shop.shopId]);
      await client.query(`DELETE FROM app.shipping_fee_agreements WHERE delivery_id IN (${mine})`, [shop.shopId]);
      await client.query(`DELETE FROM app.delivery_assignments WHERE delivery_id IN (${mine})`, [shop.shopId]);
      await client.query('DELETE FROM app.deliveries WHERE shop_id = $1::uuid', [shop.shopId]);
      await client.query('DELETE FROM app.shipper_latest_locations WHERE driver_id = ANY($1::uuid[])', [drivers]);
      await client.query('DELETE FROM app.driver_wallets WHERE driver_id = ANY($1::uuid[])', [drivers]);
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

  // ---- helpers -------------------------------------------------------------------------------------------------------------------

  /** A shop owner whose session is a CLIENT session of the Food app (the notification routes only serve client sessions). */
  async function newShop(): Promise<ShopOwner> {
    const phone = randomPhone();
    app.track(phone.normalized);
    const proof = await obtainProof(app, phone);
    const registered = await app.call('POST', '/client-auth/register', {
      headers: { 'idempotency-key': randomUUID() },
      body: { phone: phone.local, password: PASSWORD, verification_token: proof.proofToken, device: { ...WEB_FOOD }, full_name: `Quán ${tag}`, consent: { terms_version: TERMS, privacy_version: PRIVACY } },
    });
    expect(registered.status).toBe(201);
    const userId = String(dataOf(registered).user_id);
    await grantStrayRole(app.pool, userId, 'SHOP');
    const shopId = await createActiveShopFor(app.pool, userId, await createServiceArea(app.pool));
    const loggedIn = await app.call('POST', '/client-auth/login', { headers: { 'idempotency-key': randomUUID() }, body: { phone: phone.local, password: PASSWORD, device: { ...WEB_FOOD } } });
    expect(loggedIn.status).toBe(200);
    const token = String(dataOf(loggedIn).access_token);
    const selected = await app.call('POST', '/client-auth/context', { bearer: token, headers: { 'idempotency-key': randomUUID() }, body: { context: 'SHOP_OWNER' } });
    expect([selected.status, selected.text.slice(0, 200)]).toEqual([200, selected.text.slice(0, 200)]);
    return { userId, token, shopId };
  }

  /** Sends everything that is due, so a scenario starts with no pending push of an earlier one. */
  async function flush(): Promise<void> {
    for (let i = 0; i < 20; i += 1) {
      if ((await pushes().runOnce()).claimed === 0) {
        break;
      }
    }
  }
  const sentWith = (token: string): Json[] => fcmSeen.filter((m) => m.body.message.token === token);

  const asShop = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path_: string, body?: unknown): Promise<ApiResponse> =>
    app.call(method, path_, { bearer: shop.token, ...(method === 'POST' && !path_.startsWith('/notifications') ? { headers: { 'idempotency-key': randomUUID() } } : {}), ...(body === undefined ? {} : { body }) });
  const asShipper = (s: Shipper, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path_: string, body?: unknown): Promise<ApiResponse> =>
    app.call(method, path_, { bearer: s.token, ...(method === 'POST' && !path_.startsWith('/notifications') ? { headers: { 'idempotency-key': randomUUID() } } : {}), ...(body === undefined ? {} : { body }) });

  async function newShipper(near = true): Promise<Shipper> {
    const phone = randomPhone();
    app.track(phone.normalized);
    const proof = await obtainProof(app, phone);
    const registered = await app.call('POST', '/client-auth/register', {
      headers: { 'idempotency-key': randomUUID() },
      body: { phone: phone.local, password: PASSWORD, verification_token: proof.proofToken, device: { ...WEB_FOOD }, full_name: `Shipper ${tag}`, consent: { terms_version: TERMS, privacy_version: PRIVACY } },
    });
    expect(registered.status).toBe(201);
    const userId = String(dataOf(registered).user_id);
    users.push(userId);
    const loggedIn = await app.call('POST', '/client-auth/login', { headers: { 'idempotency-key': randomUUID() }, body: { phone: phone.local, password: PASSWORD, device: { ...WEB_SHIP } } });
    expect(loggedIn.status).toBe(200);
    const token = String(dataOf(loggedIn).access_token);
    const created = await app.call('POST', '/onboarding/driver', { bearer: token, headers: { 'idempotency-key': randomUUID() }, body: { full_name: `Shipper ${tag}`, plate_number: '59X1-123.45' } });
    expect(created.status).toBe(201);
    const driverId = String(dataOf(created).driver_id);
    await app.pool.query(`UPDATE app.drivers SET status = 'ACTIVE', accepting_deliveries = true, review_state = 'APPROVED' WHERE driver_id = $1::uuid`, [driverId]);
    await app.pool.query(
      `INSERT INTO app.driver_bank_accounts (driver_id, bank_code, bank_name, account_number, account_holder, verification_state, verified_by, verified_at, created_at, updated_at)
       VALUES ($1::uuid, 'VCB', 'Vietcombank', '0123456789', 'SHIPPER', 'VERIFIED', $2::uuid, now(), now(), now())`,
      [driverId, userId],
    );
    const selected = await app.call('POST', '/client-auth/context', { bearer: token, headers: { 'idempotency-key': randomUUID() }, body: { context: 'DRIVER' } });
    expect(selected.status).toBe(200);
    const walletId = await fund(driverId, 50_000);
    drivers.push(driverId);
    const shipper: Shipper = { userId, token, driverId, walletId };
    const located = await asShipper(shipper, 'PUT', '/driver/location', { lat: near ? 21.0005 : 21.2, lng: 105.8005, accuracy_m: 20 });
    expect([200, 204]).toContain(located.status);
    return shipper;
  }

  async function fund(driverId: string, amount: number): Promise<string> {
    const client = await app.pool.connect();
    try {
      await client.query('BEGIN');
      const walletId = (await client.query<{ wallet_id: string }>('SELECT wallet_id::text FROM app.driver_wallets WHERE driver_id = $1::uuid', [driverId])).rows[0]?.wallet_id as string;
      await client.query('UPDATE app.drivers SET initial_funding_required = false WHERE driver_id = $1::uuid', [driverId]);
      await client.query('ALTER TABLE app.wallet_ledger_entries DISABLE TRIGGER wallet_ledger_a_source_gate');
      await client.query(`INSERT INTO app.wallet_ledger_entries (entry_id, wallet_id, sequence_no, entry_kind, delta_vnd, balance_after_vnd, created_at) VALUES ($1::uuid, $2::uuid, 1, 'ADJUSTMENT_CREDIT', $3, $3, now())`, [randomUUID(), walletId, amount]);
      await client.query('UPDATE app.driver_wallets SET balance_vnd = $2, version = version + 1 WHERE wallet_id = $1::uuid', [walletId, amount]);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      await client.query('ALTER TABLE app.wallet_ledger_entries ENABLE TRIGGER wallet_ledger_a_source_gate');
      await client.query('COMMIT');
      return walletId;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  const createBody = (): Json => ({
    recipient_name: 'Khách nhận',
    recipient_phone: '0912345678',
    dropoff_address_text: '12 Phố Huế, Hai Bà Trưng, Hà Nội',
    dropoff_lat: 21.0,
    dropoff_lng: 105.82,
    goods_description: 'Hộp quà',
    goods_value_vnd: 200_000,
    paid_vnd: 0,
    fee_payer: 'CUSTOMER',
  });

  async function newDelivery(): Promise<Json> {
    // POST /shop/me/deliveries is closed (OD-5): the DIRECT delivery is built by the fixture.
    return createLegacyDirectDeliveryView(app, shop, createBody());
  }

  /** Drain due events, including the backlog left by earlier suites; never silently stop before this scenario's event is consumed. */
  async function settle(): Promise<void> {
    for (let i = 0; i < 2000; i += 1) {
      const summary = await runtime().dispatcher.dispatchOnce();
      if (summary.claimed === 0) return;
    }
    throw new Error('M08 fixture did not drain the due outbox backlog within 2000 batches');
  }
  async function backdateReminders(): Promise<void> {
    await app.pool.query(`UPDATE app.notification_reminders SET due_at = due_at - interval '10 seconds', valid_until = valid_until - interval '10 seconds' WHERE status = 'PENDING'`);
  }
  const inbox = async (who: Shipper | 'shop', query = ''): Promise<Json> => {
    const response = who === 'shop' ? await asShop('GET', `/notifications${query}`) : await asShipper(who, 'GET', `/notifications${query}`);
    expect(response.status).toBe(200);
    return dataOf(response) as Json;
  };
  const rows = async (sql: string, args: unknown[] = []): Promise<Json[]> => (await app.pool.query(sql, args)).rows as Json[];
  const registerToken = (who: Shipper | 'shop', token: string): Promise<ApiResponse> => (who === 'shop' ? asShop('PUT', '/notifications/push-token', { provider: 'FCM', token }) : asShipper(who, 'PUT', '/notifications/push-token', { provider: 'FCM', token }));
  const tokenOf = (n: string): string => `tok_${tag}_${n}_${'x'.repeat(40)}`;

  // ---- new-offer notification --------------------------------------------------------------------------------------------------

  it('a new delivery gives an eligible Shipper ONE collapsed card and no generic push content leaks the customer, the address or the kind of delivery', async () => {
    const near = await newShipper(true);
    const far = await newShipper(false);
    expect((await registerToken(near, tokenOf('near'))).status).toBe(200);
    const delivery = await newDelivery();
    const [eligible] = await app.running.app.get(ShippingEligibilityService).precheck({ driverId: near.driverId, deliveryIds: [String(delivery.delivery_id)] }, Date.now());
    expect(eligible).toMatchObject({ eligible: true, reasons: [] });
    await settle();
    const cards = (await inbox(near)).items as Json[];
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ kind: 'NEW_OFFERS', title: 'Có đơn giao hàng mới', read: false, target: { type: 'DELIVERY_LIST', id: null, list: 'OFFERS' } });
    const text = JSON.stringify(cards[0]);
    expect(text).not.toMatch(/0912345678|Phố Huế|PLATFORM|EXTERNAL|Khách nhận/);
    expect((await inbox(far)).items).toHaveLength(0);
    // The shop is not told about its own call.
    expect((await inbox('shop')).items.filter((i: Json) => i.kind === 'NEW_OFFERS')).toHaveLength(0);
    expect(delivery.state).toBe('waiting_driver');

    await flush();
    expect(sentWith(tokenOf('near'))).toHaveLength(1);
    const sent = sentWith(tokenOf('near'))[0] as Json;
    expect(sent.url).toBe('/v1/projects/test-proj/messages:send');
    expect(sent.auth).toBe('Bearer test-access');
    expect(JSON.stringify(sent.body)).not.toMatch(/0912345678|Phố Huế|Khách nhận/);
    expect(sent.body.message.data).toMatchObject({ kind: 'NEW_OFFERS', target_type: 'DELIVERY_LIST' });
    const pushRows = await rows(`SELECT status, attempt_count FROM app.notification_pushes WHERE recipient_user_id = $1::uuid`, [near.userId]);
    expect(pushRows).toEqual([{ status: 'SENT', attempt_count: 1 }]);
    // A far Shipper has a card-less inbox AND no push row at all.
    expect(await rows(`SELECT 1 FROM app.notification_pushes WHERE recipient_user_id = $1::uuid`, [far.userId])).toHaveLength(0);
  });

  it('a Shipper whose position is older than 2 minutes is not told about a new delivery (the server stops distributing, whatever the app does); a fresh one is', async () => {
    const fresh = await newShipper(true);
    const stale = await newShipper(true);
    expect((await registerToken(fresh, tokenOf('fresh'))).status).toBe(200);
    expect((await registerToken(stale, tokenOf('stale'))).status).toBe(200);
    await app.pool.query(`UPDATE app.shipper_latest_locations SET recorded_at = clock_timestamp() - interval '121 seconds' WHERE driver_id = $1::uuid`, [stale.driverId]);
    await newDelivery();
    await settle();
    expect((await inbox(fresh)).items).toHaveLength(1);
    expect((await inbox(stale)).items).toHaveLength(0);
    await flush();
    expect(sentWith(tokenOf('fresh'))).toHaveLength(1);
    expect(sentWith(tokenOf('stale'))).toHaveLength(0);
    expect(await rows(`SELECT 1 FROM app.notification_pushes WHERE recipient_user_id = $1::uuid`, [stale.userId])).toHaveLength(0);
  });

  it('a Shipper whose session is over is not offered new deliveries, even with a fresh position and the switch on', async () => {
    const live = await newShipper(true);
    const gone = await newShipper(true);
    expect((await registerToken(live, tokenOf('live'))).status).toBe(200);
    expect((await registerToken(gone, tokenOf('gone'))).status).toBe(200);
    const left = await app.call('POST', '/client-auth/logout', { bearer: gone.token, body: {} });
    expect(left.status).toBe(204);
    await newDelivery();
    await settle();
    expect((await inbox(live)).items).toHaveLength(1);
    expect(await rows(`SELECT 1 FROM app.notifications WHERE recipient_user_id = $1::uuid AND kind = 'NEW_OFFERS'`, [gone.userId])).toHaveLength(0);
    await flush();
    expect(sentWith(tokenOf('gone'))).toHaveLength(0);
  });

  it('redelivery of the same outbox event, and a second round for the same delivery version, never create a second card or push', async () => {
    const s = await newShipper(true);
    expect((await registerToken(s, tokenOf('dup'))).status).toBe(200);
    const delivery = await newDelivery();
    await settle();
    const first = (await inbox(s)).items as Json[];
    expect(first).toHaveLength(1);
    const before = await rows(`SELECT count(*)::int AS n FROM app.notification_pushes WHERE recipient_user_id = $1::uuid`, [s.userId]);
    await app.pool.query(`UPDATE app.outbox_events SET status = 'PENDING', attempt_count = 0, available_at = now(), locked_at = NULL, lock_token = NULL, published_at = NULL WHERE resource_id = $1`, [delivery.delivery_id]);
    await settle();
    expect(await rows(`SELECT count(*)::int AS n FROM app.notifications WHERE recipient_user_id = $1::uuid AND kind = 'NEW_OFFERS'`, [s.userId])).toEqual([{ n: 1 }]);
    expect(await rows(`SELECT count(*)::int AS n FROM app.notification_pushes WHERE recipient_user_id = $1::uuid`, [s.userId])).toEqual(before);
  });

  it('a Shipper giving the delivery back starts a NEW round for others without moving the 30-minute deadline, and the one who gave it back is not asked again', async () => {
    const a = await newShipper(true);
    const b = await newShipper(true);
    const delivery = await newDelivery();
    const id = String(delivery.delivery_id);
    await settle();
    const deadlineBefore = String((await rows(`SELECT search_expires_at FROM app.deliveries WHERE delivery_id = $1::uuid`, [id]))[0]?.search_expires_at);
    const accepted = await asShipper(a, 'POST', `/driver/deliveries/${id}/accept`, {});
    expect(accepted.status).toBe(200);
    await settle();
    expect(((await inbox('shop')).items as Json[]).some((i) => i.kind === 'DELIVERY_ACCEPTED')).toBe(true);
    const held = dataOf(await asShipper(a, 'GET', `/driver/deliveries/${id}`)) as Json;
    const released = await asShipper(a, 'POST', `/driver/deliveries/${id}/release`, { reason: 'Xe hỏng', expected_version: held.version });
    expect([released.status, released.text.slice(0, 200)]).toEqual([200, released.text.slice(0, 200)]);
    await settle();
    expect(String((await rows(`SELECT search_expires_at FROM app.deliveries WHERE delivery_id = $1::uuid`, [id]))[0]?.search_expires_at)).toBe(deadlineBefore);
    expect(((await inbox('shop')).items as Json[]).some((i) => i.kind === 'DELIVERY_RELEASED')).toBe(true);
    // b has two rounds on this delivery (create + release): ONE card, refreshed; a (the one who released) was in round one only.
    expect(await rows(`SELECT count(*)::int AS n FROM app.notification_offer_rounds WHERE delivery_id = $1::uuid AND user_id = $2::uuid`, [id, b.userId])).toEqual([{ n: 2 }]);
    expect(await rows(`SELECT count(*)::int AS n FROM app.notification_offer_rounds WHERE delivery_id = $1::uuid AND user_id = $2::uuid`, [id, a.userId])).toEqual([{ n: 1 }]);
    expect(((await inbox(b)).items as Json[]).filter((i) => i.kind === 'NEW_OFFERS')).toHaveLength(1);
  });

  it('an offer that is taken before its push goes out is announced to nobody (no push, a SKIPPED row says why)', async () => {
    const a = await newShipper(true);
    const b = await newShipper(true);
    expect((await registerToken(b, tokenOf('late'))).status).toBe(200);
    const delivery = await newDelivery();
    await settle();
    const taken = await asShipper(a, 'POST', `/driver/deliveries/${delivery.delivery_id}/accept`, {});
    expect(taken.status).toBe(200);
    await flush();
    expect(sentWith(tokenOf('late'))).toHaveLength(0);
    expect(await rows(`SELECT status, skip_reason FROM app.notification_pushes WHERE recipient_user_id = $1::uuid`, [b.userId])).toEqual([{ status: 'SKIPPED', skip_reason: 'NO_LONGER_AVAILABLE' }]);
  });

  // ---- devices and sessions ---------------------------------------------------------------------------------------------------

  it('a logout, or another account taking the same phone token, ends the link: nothing is sent to the old account', async () => {
    const s = await newShipper(true);
    expect((await registerToken(s, tokenOf('out'))).status).toBe(200);
    const delivery = await newDelivery();
    await settle();
    const logout = await app.call('POST', '/client-auth/logout', { bearer: s.token, body: {} });
    expect(logout.status).toBe(204);
    expect(await rows(`SELECT invalid_reason FROM app.notification_push_tokens WHERE user_id = $1::uuid`, [s.userId])).toEqual([{ invalid_reason: 'SESSION_ENDED' }]);
    await flush();
    expect(sentWith(tokenOf('out'))).toHaveLength(0);
    expect(await rows(`SELECT status, skip_reason FROM app.notification_pushes WHERE recipient_user_id = $1::uuid`, [s.userId])).toEqual([{ status: 'SKIPPED', skip_reason: 'TOKEN_ENDED' }]);
    expect(delivery.delivery_id).toBeDefined();

    // The same physical token registered by the next account on this phone: the old binding ends, the new one is live.
    const next = await newShipper(true);
    const t = tokenOf('shared');
    const first = await newShipper(true);
    expect((await registerToken(first, t)).status).toBe(200);
    expect((await registerToken(next, t)).status).toBe(200);
    expect(await rows(`SELECT user_id, invalid_reason FROM app.notification_push_tokens WHERE token_digest = encode(sha256($1::bytea), 'hex') ORDER BY registered_at`, [t])).toEqual([
      { user_id: first.userId, invalid_reason: 'REPLACED' },
      { user_id: next.userId, invalid_reason: null },
    ]);
  });

  it('inbox rows are private to the account AND the app of the session', async () => {
    const s = await newShipper(true);
    await newDelivery();
    await settle();
    const card = ((await inbox(s)).items as Json[])[0] as Json;
    const other = await newShipper(true);
    expect((await asShipper(other, 'POST', `/notifications/${card.notification_id}/open`, {})).status).toBe(404);
    expect((await asShipper(other, 'POST', '/notifications/read', { ids: [card.notification_id] })).status).toBe(200);
    expect(((await inbox(s)).items as Json[])[0]).toMatchObject({ read: false });
    // The shop's session (Food app) cannot see the Shipper's row either.
    expect((await asShop('POST', `/notifications/${card.notification_id}/open`, {})).status).toBe(404);
  });

  // ---- retry, TTL and provider honesty ------------------------------------------------------------------------------------------

  it('a provider outage retries with backoff and then succeeds; a dead token is dropped; a push past its own deadline is never sent', async () => {
    const s = await newShipper(true);
    expect((await registerToken(s, tokenOf('retry'))).status).toBe(200);
    await flush();
    await newDelivery();
    await settle();
    plan(tokenOf('retry'), 503);
    await pushes().runOnce();
    let push = (await rows(`SELECT status, attempt_count, last_error_code, last_error_evidence FROM app.notification_pushes WHERE recipient_user_id = $1::uuid`, [s.userId]))[0] as Json;
    expect(push).toMatchObject({ status: 'PENDING', attempt_count: 1, last_error_code: 'HTTP_503' });
    expect(String(push.last_error_evidence)).not.toContain('tok_');
    // Not due yet: nothing more is sent to this token.
    await flush();
    expect(sentWith(tokenOf('retry'))).toHaveLength(1);
    await app.pool.query(`UPDATE app.notification_pushes SET next_attempt_at = now() WHERE recipient_user_id = $1::uuid`, [s.userId]);
    await pushes().runOnce();
    push = (await rows(`SELECT status, attempt_count FROM app.notification_pushes WHERE recipient_user_id = $1::uuid`, [s.userId]))[0] as Json;
    expect(push).toMatchObject({ status: 'SENT', attempt_count: 2 });

    // Dead token: the provider says UNREGISTERED -> the token ends and the push is skipped, not retried.
    const t = await newShipper(true);
    expect((await registerToken(t, tokenOf('dead'))).status).toBe(200);
    await flush();
    await newDelivery();
    await settle();
    plan(tokenOf('dead'), 404);
    await pushes().runOnce();
    expect(await rows(`SELECT status, skip_reason FROM app.notification_pushes WHERE recipient_user_id = $1::uuid`, [t.userId])).toEqual([{ status: 'SKIPPED', skip_reason: 'TOKEN_REJECTED' }]);
    expect(await rows(`SELECT invalid_reason FROM app.notification_push_tokens WHERE user_id = $1::uuid`, [t.userId])).toEqual([{ invalid_reason: 'PROVIDER_REJECTED' }]);

    // TTL: the push's deadline passed (history remains): closed as EXPIRED, never sent late.
    const u = await newShipper(true);
    expect((await registerToken(u, tokenOf('ttl'))).status).toBe(200);
    await newDelivery();
    await settle();
    await app.pool.query(`UPDATE app.notification_pushes SET expires_at = now() - interval '1 second' WHERE recipient_user_id = $1::uuid`, [u.userId]);
    await flush();
    expect(sentWith(tokenOf('ttl'))).toHaveLength(0);
    expect(await rows(`SELECT status FROM app.notification_pushes WHERE recipient_user_id = $1::uuid`, [u.userId])).toEqual([{ status: 'EXPIRED' }]);
    expect(((await inbox(u)).items as Json[]).filter((i) => i.kind === 'NEW_OFFERS')).toHaveLength(1);
  });

  it('settings: a switched-off group still keeps the inbox row but sends no push; sound off keeps the push', async () => {
    const s = await newShipper(true);
    expect((await registerToken(s, tokenOf('set'))).status).toBe(200);
    await flush();
    const put = await asShipper(s, 'PUT', '/notifications/settings', { available: false, sound: false });
    expect(put.status).toBe(200);
    expect(dataOf(put)).toMatchObject({ available: false, sound: false, vibrate: true, push_available: true });
    await newDelivery();
    await settle();
    expect(await rows(`SELECT status, skip_reason FROM app.notification_pushes WHERE recipient_user_id = $1::uuid`, [s.userId])).toEqual([{ status: 'SKIPPED', skip_reason: 'SETTING_OFF' }]);
    expect(((await inbox(s)).items as Json[]).filter((i) => i.kind === 'NEW_OFFERS')).toHaveLength(1);
    expect((await asShipper(s, 'PUT', '/notifications/settings', { available: true })).status).toBe(200);
    expect((await asShipper(s, 'PUT', '/notifications/settings', { timer: 5 })).status).toBe(400);
    // Sound off, group on: the push is sent on the silent channel.
    await newDelivery();
    await settle();
    await flush();
    expect(sentWith(tokenOf('set')).at(-1)?.body.message.android.notification.channel_id).toBe('n11_qv');
  });

  // ---- the shop's results and reminders ----------------------------------------------------------------------------------------

  it('the shop hears about pickup, success and failure; opening from the inbox marks read and re-checks the right; a stranger gets nothing', async () => {
    const s = await newShipper(true);
    const delivery = await newDelivery();
    const id = String(delivery.delivery_id);
    expect((await asShipper(s, 'POST', `/driver/deliveries/${id}/accept`, {})).status).toBe(200);
    const read = dataOf(await asShipper(s, 'GET', `/driver/deliveries/${id}`)) as Json;
    const located = await asShipper(s, 'POST', `/driver/deliveries/${id}/pickup`, { expected_version: read.version });
    expect([located.status, located.text.slice(0, 200)]).toEqual([200, located.text.slice(0, 200)]);
    const after = dataOf(located) as Json;
    const done = await asShipper(s, 'POST', `/driver/deliveries/${id}/complete`, { expected_version: after.version });
    expect([done.status, done.text.slice(0, 200)]).toEqual([200, done.text.slice(0, 200)]);
    await settle();
    const list = await inbox('shop');
    const kinds = (list.items as Json[]).map((i) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(['DELIVERY_ACCEPTED', 'DELIVERY_PICKED_UP', 'DELIVERY_COMPLETED']));
    expect(list.unread_count).toBeGreaterThanOrEqual(3);
    const completed = (list.items as Json[]).find((i) => i.kind === 'DELIVERY_COMPLETED') as Json;
    const opened = dataOf(await asShop('POST', `/notifications/${completed.notification_id}/open`, {})) as Json;
    expect(opened).toMatchObject({ outcome: 'ENDED', target: { type: 'DELIVERY', id }, delivery_state: 'completed' });
    expect(((await inbox('shop', '?filter=unread')).items as Json[]).some((i) => i.notification_id === completed.notification_id)).toBe(false);
    const all = dataOf(await asShop('POST', '/notifications/read-all', {})) as Json;
    expect(all.unread_count).toBe(0);
  });

  it('pickup reminders: one grouped notification for several deliveries due together; picking up silences the reminder; a restart or a late backlog never replays old marks', async () => {
    const s = await newShipper(true);
    const ids: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const d = await newDelivery();
      ids.push(String(d.delivery_id));
      expect((await asShipper(s, 'POST', `/driver/deliveries/${d.delivery_id}/accept`, {})).status).toBe(200);
    }
    await settle();
    const client = await app.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE app.delivery_assignments DISABLE TRIGGER delivery_assignments_guard');
      await client.query(`UPDATE app.delivery_assignments SET accepted_at = accepted_at - interval '6 minutes' WHERE delivery_id = ANY($1::uuid[])`, [ids]);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      await client.query('ALTER TABLE app.delivery_assignments ENABLE TRIGGER delivery_assignments_guard');
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    await sweeper().sweep();
    await sweeper().sweep(); // the stored mark: a second pass sends nothing more
    await settle();
    await backdateReminders();
    const first = await reminders().runOnce();
    expect(first).toMatchObject({ sent: 2 });
    const grouped = ((await inbox(s)).items as Json[]).filter((i) => i.kind === 'PICKUP_REMINDER');
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({ title: 'Bạn còn 2 đơn chưa lấy hàng', target: { type: 'DELIVERY_LIST', list: 'ACTIVE' } });
    // Nothing is replayed by a second run (the rows are resolved, in the table, not in memory).
    expect(await reminders().runOnce()).toMatchObject({ sent: 0, stale: 0, invalid: 0 });

    // Another round of reminders; then the Shipper picks up ONE delivery: only the other one is reminded.
    const view = dataOf(await asShipper(s, 'GET', `/driver/deliveries/${ids[0]}`)) as Json;
    expect((await asShipper(s, 'POST', `/driver/deliveries/${ids[0]}/pickup`, { expected_version: view.version })).status).toBe(200);
    const guardClient = await app.pool.connect();
    try {
      await guardClient.query('BEGIN');
      await guardClient.query('ALTER TABLE app.delivery_assignments DISABLE TRIGGER delivery_assignments_guard');
      await guardClient.query(`UPDATE app.delivery_assignments SET last_pickup_reminder_at = now() - interval '6 minutes' WHERE delivery_id = ANY($1::uuid[]) AND status = 'ACTIVE'`, [ids]);
      await guardClient.query('SET CONSTRAINTS ALL IMMEDIATE');
      await guardClient.query('ALTER TABLE app.delivery_assignments ENABLE TRIGGER delivery_assignments_guard');
      await guardClient.query('COMMIT');
    } finally {
      guardClient.release();
    }
    await sweeper().sweep();
    await settle();
    await backdateReminders();
    expect(await reminders().runOnce()).toMatchObject({ sent: 1 });
    const singles = ((await inbox(s)).items as Json[]).filter((i) => i.kind === 'PICKUP_REMINDER' && i.target.type === 'DELIVERY');
    expect(singles).toHaveLength(1);
    expect(singles[0]?.target.id).toBe(ids[1]);

    expect((await rows(`SELECT 1 FROM app.notification_reminders WHERE recipient_user_id = $1::uuid`, [s.userId])).length).toBeGreaterThanOrEqual(3);
  });

  it('a pickup reminder that is due is dropped (not sent) when the Shipper gives the delivery back or the shop cancels it before the reminder goes out', async () => {
    const backdateAccepted = async (deliveryId: string): Promise<void> => {
      const client = await app.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('ALTER TABLE app.delivery_assignments DISABLE TRIGGER delivery_assignments_guard');
        await client.query(`UPDATE app.delivery_assignments SET accepted_at = accepted_at - interval '6 minutes' WHERE delivery_id = $1::uuid`, [deliveryId]);
        await client.query('SET CONSTRAINTS ALL IMMEDIATE');
        await client.query('ALTER TABLE app.delivery_assignments ENABLE TRIGGER delivery_assignments_guard');
        await client.query('COMMIT');
      } finally {
        client.release();
      }
    };
    const s = await newShipper(true);
    const released = await newDelivery();
    const cancelled = await newDelivery();
    for (const d of [released, cancelled]) {
      expect((await asShipper(s, 'POST', `/driver/deliveries/${d.delivery_id}/accept`, {})).status).toBe(200);
      await backdateAccepted(String(d.delivery_id));
    }
    await settle();
    await sweeper().sweep();
    await settle();
    await backdateReminders();
    expect((await rows(`SELECT 1 FROM app.notification_reminders WHERE recipient_user_id = $1::uuid AND kind = 'PICKUP' AND status = 'PENDING'`, [s.userId])).length).toBe(2);

    const held = dataOf(await asShipper(s, 'GET', `/driver/deliveries/${released.delivery_id}`)) as Json;
    const give = await asShipper(s, 'POST', `/driver/deliveries/${released.delivery_id}/release`, { reason: 'Xe hỏng', expected_version: held.version });
    expect([give.status, give.text.slice(0, 200)]).toEqual([200, give.text.slice(0, 200)]);
    const cancel = await asShop('POST', `/shop/me/deliveries/${cancelled.delivery_id}/cancel`, { reason: 'Khách đổi ý', expected_version: dataOf(await asShop('GET', `/shop/me/deliveries/${cancelled.delivery_id}`)).version });
    expect([cancel.status, cancel.text.slice(0, 200)]).toEqual([200, cancel.text.slice(0, 200)]);

    const sentBefore = ((await inbox(s)).items as Json[]).filter((i) => i.kind === 'PICKUP_REMINDER').length;
    expect(await reminders().runOnce()).toMatchObject({ sent: 0 });
    expect(((await inbox(s)).items as Json[]).filter((i) => i.kind === 'PICKUP_REMINDER')).toHaveLength(sentBefore);
    expect((await rows(`SELECT 1 FROM app.notification_reminders WHERE recipient_user_id = $1::uuid AND kind = 'PICKUP' AND status = 'PENDING'`, [s.userId])).length).toBe(0);
    // Nothing starts again later: the sweeper has no assignment left to remind about.
    await sweeper().sweep();
    await settle();
    await backdateReminders();
    expect(await reminders().runOnce()).toMatchObject({ sent: 0 });
  });

  it('search reminders go to the shop only while it is searching; a stale backlog (past its window) is dropped, never sent late', async () => {
    const d = await newDelivery();
    const id = String(d.delivery_id);
    const client = await app.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE app.deliveries DISABLE TRIGGER deliveries_guard');
      await client.query(
        `UPDATE app.deliveries SET search_started_at = search_started_at - interval '6 minutes', search_expires_at = search_expires_at - interval '6 minutes', created_at = created_at - interval '6 minutes' WHERE delivery_id = $1::uuid`,
        [id],
      );
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      await client.query('ALTER TABLE app.deliveries ENABLE TRIGGER deliveries_guard');
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    await sweeper().sweep();
    await settle();
    await backdateReminders();
    expect(await reminders().runOnce()).toMatchObject({ sent: 1 });
    const mine = ((await inbox('shop')).items as Json[]).filter((i) => i.kind === 'SEARCH_REMINDER');
    expect(mine.at(0)).toMatchObject({ title: 'Đơn vẫn đang tìm shipper', target: { type: 'DELIVERY', id } });

    // The delivery is cancelled by the shop; a reminder that was already pending turns into nothing.
    await app.pool.query(
      `INSERT INTO app.notification_reminders (reminder_id, event_id, kind, recipient_user_id, app, delivery_id, due_at, valid_until, status)
       VALUES ($1::uuid, $2::uuid, 'SEARCH_15', $3::uuid, 'FOOD', $4::uuid, now() - interval '10 seconds', now() + interval '5 minutes', 'PENDING')`,
      [randomUUID(), randomUUID(), shop.userId, id],
    );
    const cancel = await asShop('POST', `/shop/me/deliveries/${id}/cancel`, { reason: 'Khách đổi ý', expected_version: dataOf(await asShop('GET', `/shop/me/deliveries/${id}`)).version });
    expect([cancel.status, cancel.text.slice(0, 200)]).toEqual([200, cancel.text.slice(0, 200)]);
    expect(await reminders().runOnce()).toMatchObject({ sent: 0, invalid: 1 });

    // A reminder that waited beyond its window (a long outage) is dropped as stale.
    const other = await newDelivery();
    await app.pool.query(
      `INSERT INTO app.notification_reminders (reminder_id, event_id, kind, recipient_user_id, app, delivery_id, due_at, valid_until, status)
       VALUES ($1::uuid, $2::uuid, 'SEARCH_5', $3::uuid, 'FOOD', $4::uuid, now() - interval '20 minutes', now() - interval '11 minutes', 'PENDING')`,
      [randomUUID(), randomUUID(), shop.userId, other.delivery_id],
    );
    expect(await reminders().runOnce()).toMatchObject({ sent: 0, stale: 1 });
  });

  // ---- retention ----------------------------------------------------------------------------------------------------------------

  it('retention: archived after the visible window (hidden), deleted after the total window; the business rows stay', async () => {
    const s = await newShipper(true);
    const delivery = await newDelivery();
    await settle();
    const card = (await rows(`SELECT notification_id FROM app.notifications WHERE recipient_user_id = $1::uuid`, [s.userId]))[0] as Json;
    await app.pool.query(`UPDATE app.notifications SET created_at = now() - interval '91 days', updated_at = now() - interval '91 days' WHERE notification_id = $1::uuid`, [card.notification_id]);
    const retention = app.running.app.get(NotificationRetention);
    await retention.runOnce();
    expect(((await inbox(s)).items as Json[]).some((i) => i.notification_id === card.notification_id)).toBe(false);
    expect(await rows(`SELECT archived_at IS NOT NULL AS archived FROM app.notifications WHERE notification_id = $1::uuid`, [card.notification_id])).toEqual([{ archived: true }]);
    await app.pool.query(`UPDATE app.notifications SET purge_after = now() - interval '1 second' WHERE notification_id = $1::uuid`, [card.notification_id]);
    await retention.runOnce();
    expect(await rows(`SELECT 1 FROM app.notifications WHERE notification_id = $1::uuid`, [card.notification_id])).toHaveLength(0);
    expect(await rows(`SELECT 1 FROM app.deliveries WHERE delivery_id = $1::uuid`, [delivery.delivery_id])).toHaveLength(1);
  });

  it('a Shipper without a device still gets the card; the push row says NO_TOKEN (evidence, not a guess); sync returns what is newer than the cursor', async () => {
    const s = await newShipper(true);
    const before = await inbox(s);
    await newDelivery();
    await settle();
    expect(await rows(`SELECT status, skip_reason FROM app.notification_pushes WHERE recipient_user_id = $1::uuid`, [s.userId])).toEqual([{ status: 'SKIPPED', skip_reason: 'NO_TOKEN' }]);
    const changes = dataOf(await asShipper(s, 'GET', `/notifications/changes?after=${String(before.latest_seq)}`)) as Json;
    expect(changes.items).toHaveLength(1);
    expect(changes.unread_count).toBe(1);
    const again = dataOf(await asShipper(s, 'GET', `/notifications/changes?after=${String(changes.latest_seq)}`)) as Json;
    expect(again.items).toHaveLength(0);
    expect(errorCode(await asShipper(s, 'GET', '/notifications?limit=0'))).toBeDefined();
  });

  it('profile results reach the owner once; events of modules that do not exist yet (Orders, withdrawals) are acknowledged as not integrated and make nothing up', async () => {
    const s = await newShipper(true);
    const events = app.running.app.get(NotificationEventService);
    const eventId = randomUUID();
    const approved = { eventId, eventType: 'driver.state_changed.v1', eventSchemaVersion: 1, resourceType: 'driver', resourceId: s.driverId, resourceVersion: 9, occurredAt: new Date().toISOString(), attemptCount: 1, payload: { driver_id: s.driverId, change: 'approved', status: 'ACTIVE', review_state: 'APPROVED', accepting_deliveries: false, version: 9 } };
    await events.consume(approved);
    await events.consume(approved);
    const mine = ((await inbox(s)).items as Json[]).filter((i) => i.kind === 'PROFILE_APPROVED');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ title: 'Hồ sơ shipper đã được duyệt', target: { type: 'PROFILE' } });
    const opened = dataOf(await asShipper(s, 'POST', `/notifications/${mine[0]?.notification_id}/open`, {})) as Json;
    expect(opened).toMatchObject({ outcome: 'OK', target: { type: 'PROFILE' } });
    // An internal change (a bank check) tells nobody.
    await events.consume({ ...approved, eventId: randomUUID(), payload: { ...approved.payload, change: 'bank_verified', version: 10 } });
    expect((await inbox(s)).items.filter((i: Json) => i.kind.startsWith('PROFILE_'))).toHaveLength(1);

    const orderEvent = { ...approved, eventId: randomUUID(), eventType: 'order.created.v1', resourceType: 'order', payload: { order_id: randomUUID() } };
    await events.consume(orderEvent);
    expect(await rows(`SELECT outcome FROM app.notification_consumed_events WHERE event_id = $1::uuid`, [orderEvent.eventId])).toEqual([{ outcome: 'NOT_INTEGRATED' }]);
    // A foreign event type is not ours: nothing is recorded, nothing is made.
    const foreign = { ...approved, eventId: randomUUID(), eventType: 'menu.item.changed.v1' };
    await events.consume(foreign);
    expect(await rows(`SELECT 1 FROM app.notification_consumed_events WHERE event_id = $1::uuid`, [foreign.eventId])).toHaveLength(0);
  });

  // ---- M08-R-09 (P6-9): an event older than 24 h is classified by its DRAFT, never silently dropped by its type ----------------------------------------

  const metricCount = async (key: string): Promise<number> => Number((await rows(`SELECT count(*)::int AS n FROM app.ops_metrics WHERE metric_key = $1`, [key]))[0]?.n);
  const staleAudits = async (eventId: string): Promise<Json[]> => rows(`SELECT action, outcome, metadata FROM app.audit_logs WHERE action = 'notification.stale_event.v1' AND resource_id = $1`, [eventId]);
  const outcomeOf = async (eventId: string): Promise<unknown> => (await rows(`SELECT outcome FROM app.notification_consumed_events WHERE event_id = $1::uuid`, [eventId]))[0]?.outcome;
  const hoursAgo = (h: number): string => new Date(Date.now() - h * 3_600_000).toISOString();
  const pushesOf = async (eventId: string): Promise<Json[]> => rows(`SELECT p.status, p.skip_reason FROM app.notification_pushes p JOIN app.notifications n USING (notification_id) WHERE n.source_event_id = $1::uuid`, [eventId]);
  const cardTimes = async (eventId: string): Promise<Json[]> => rows(`SELECT created_at, updated_at FROM app.notifications WHERE source_event_id = $1::uuid`, [eventId]);
  const ageHours = (iso: unknown): number => (Date.now() - Date.parse(String(iso))) / 3_600_000;

  /**
   * Seeds rows the consumer reads back from the owners' tables. The user guard triggers are lifted for this seeding only: the seed transaction COMMITs first
   * (its deferred foreign keys are settled there), and only then the triggers come back on, in their own statements. A failing seed is rolled back, and the
   * triggers are restored in every case, so nothing half-seeded or switched off leaks into another test.
   */
  async function seed(tables: string[], body: (c: import('pg').PoolClient) => Promise<void>): Promise<void> {
    const client = await app.pool.connect();
    let failure: unknown;
    try {
      await client.query('BEGIN');
      for (const t of tables) await client.query(`ALTER TABLE ${t} DISABLE TRIGGER USER`);
      await body(client);
      await client.query('COMMIT');
    } catch (error) {
      failure = error;
      await client.query('ROLLBACK').catch(() => undefined);
    }
    try {
      for (const t of tables) await client.query(`ALTER TABLE ${t} ENABLE TRIGGER USER`);
    } catch (restoreError) {
      client.release(restoreError instanceof Error ? restoreError : new Error('trigger restore failed'));
      throw failure ?? restoreError;
    }
    client.release();
    if (failure !== undefined) throw failure;
  }

  it('a 25 h old account event is delivered late: inbox row at the time of the event, push SKIPPED/STALE_EVENT, audit, HIGH metric, and a redelivery adds nothing', async () => {
    const s = await newShipper(true);
    expect((await registerToken(s, tokenOf('late'))).status).toBe(200);
    await flush();
    const events = app.running.app.get(NotificationEventService);
    const late = { eventId: randomUUID(), eventType: 'driver.state_changed.v1', eventSchemaVersion: 1, resourceType: 'driver', resourceId: s.driverId, resourceVersion: 5, occurredAt: hoursAgo(25), attemptCount: 1, payload: { driver_id: s.driverId, change: 'approved', status: 'ACTIVE', review_state: 'APPROVED', accepting_deliveries: false, version: 5 } };
    const before = { late: await metricCount('m08_stale_event.delivered_late'), high: await metricCount('m08_stale_event.delivered_late_high'), dropped: await metricCount('m08_stale_event.dropped') };
    await events.consume(late);
    await events.consume(late);
    expect(await outcomeOf(late.eventId)).toBe('DELIVERED_LATE');
    const card = ((await inbox(s)).items as Json[]).filter((i) => i.kind === 'PROFILE_APPROVED');
    expect(card).toHaveLength(1);
    expect(ageHours(card[0]?.created_at)).toBeGreaterThan(24);
    expect(await pushesOf(late.eventId)).toEqual([{ status: 'SKIPPED', skip_reason: 'STALE_EVENT' }]);
    const audits = await staleAudits(late.eventId);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ outcome: 'SUCCESS', metadata: { event_type: 'driver.state_changed.v1', draft_kind: 'PROFILE_APPROVED', draft_class: 'DURABLE', result: 'DELIVERED_LATE', high_priority: true } });
    expect(audits[0]?.metadata.age_ms).toBeGreaterThan(24 * 3_600_000);
    // The high class is counted only on its own metric; the ordinary late counter does not move.
    expect(await metricCount('m08_stale_event.delivered_late')).toBe(before.late);
    expect(await metricCount('m08_stale_event.delivered_late_high')).toBe(before.high + 1);
    expect(await metricCount('m08_stale_event.dropped')).toBe(before.dropped);
  });

  it('a 25 h old ORDER_PLACED is a time-bound draft: dropped as STALE_EVENT, no inbox row, audit and dropped metric', async () => {
    const events = app.running.app.get(NotificationEventService);
    const orderId = randomUUID();
    const placed = { eventId: randomUUID(), eventType: 'order.changed.v1', eventSchemaVersion: 1, resourceType: 'order', resourceId: orderId, resourceVersion: 2, occurredAt: hoursAgo(25), attemptCount: 1, payload: { order_id: orderId, code: 'DH-LATE', shop_id: shop.shopId, customer_user_id: randomUUID(), change: 'placed', status: 'PLACED', version: 2 } };
    const droppedBefore = await metricCount('m08_stale_event.dropped');
    await events.consume(placed);
    expect(await outcomeOf(placed.eventId)).toBe('STALE_EVENT');
    expect(((await inbox('shop')).items as Json[]).filter((i) => i.kind === 'ORDER_PLACED' && i.target?.id === orderId)).toHaveLength(0);
    expect((await staleAudits(placed.eventId))[0]).toMatchObject({ metadata: { draft_kind: 'ORDER_PLACED', draft_class: 'TIME_BOUND', result: 'DROPPED' } });
    expect(await metricCount('m08_stale_event.dropped')).toBe(droppedBefore + 1);
  });

  it('a 25 h old end state of a delivery reaches the shop inbox; time-bound siblings (search stopped, search reminder) are dropped; a late step behind a newer one is still delivered, with newer_notice_exists in the audit only', async () => {
    const d = await newDelivery();
    const id = String(d.delivery_id);
    const events = app.running.app.get(NotificationEventService);
    const ev = (change: string, version: number, h: number) => ({ eventId: randomUUID(), eventType: 'delivery.changed.v1', eventSchemaVersion: 1, resourceType: 'delivery', resourceId: id, resourceVersion: version, occurredAt: hoursAgo(h), attemptCount: 1, payload: { delivery_id: id, code: String(d.code ?? 'DG-1'), shop_id: shop.shopId, change, state: change, version } });
    const kindsOf = async (): Promise<string[]> => ((await inbox('shop')).items as Json[]).filter((i) => i.target?.id === id).map((i) => String(i.kind));

    const done = ev('completed', 9, 25);
    await events.consume(done);
    expect(await outcomeOf(done.eventId)).toBe('DELIVERED_LATE');
    expect(await kindsOf()).toEqual(expect.arrayContaining(['DELIVERY_COMPLETED']));
    expect(await pushesOf(done.eventId)).toEqual(expect.arrayContaining([{ status: 'SKIPPED', skip_reason: 'STALE_EVENT' }]));

    const stopped = ev('search_stopped', 3, 25);
    const reminder = ev('search_reminder_5', 3, 25);
    const droppedBefore = await metricCount('m08_stale_event.dropped');
    await events.consume(stopped);
    await events.consume(reminder);
    expect(await outcomeOf(stopped.eventId)).toBe('STALE_EVENT');
    expect(await outcomeOf(reminder.eventId)).toBe('STALE_EVENT');
    expect(await kindsOf()).not.toContain('SEARCH_STOPPED');
    expect(await rows(`SELECT 1 FROM app.notification_reminders WHERE event_id = $1::uuid`, [reminder.eventId])).toHaveLength(0);
    expect((await staleAudits(stopped.eventId))[0]).toMatchObject({ metadata: { draft_class: 'TIME_BOUND', result: 'DROPPED' } });
    expect(await metricCount('m08_stale_event.dropped')).toBe(droppedBefore + 2);

    // Completed is already known (version 9). The late "picked up" (version 5) is still told, because it is durable; the audit records the evidence only.
    const behind = ev('picked_up', 5, 25);
    await events.consume(behind);
    expect(await outcomeOf(behind.eventId)).toBe('DELIVERED_LATE');
    expect(await kindsOf()).toContain('DELIVERY_PICKED_UP');
    expect((await staleAudits(behind.eventId))[0]).toMatchObject({ metadata: { draft_class: 'DURABLE', result: 'DELIVERED_LATE', newer_notice_exists: true } });
  });

  it('a 25 h old withdrawal request reaches the Shipper: inbox row at the time of the event, push SKIPPED/STALE_EVENT, HIGH metric', async () => {
    const s = await newShipper(true);
    const events = app.running.app.get(NotificationEventService);
    const withdrawalId = randomUUID();
    const holdId = randomUUID();
    const at = new Date(Date.now() - 25 * 3_600_000).toISOString();
    await seed(['app.wallet_holds', 'app.wallet_withdrawals'], async (c) => {
      await c.query(`INSERT INTO app.wallet_holds (hold_id, wallet_id, purpose, amount_vnd, status, withdrawal_id, version, created_at, updated_at) VALUES ($1::uuid, $2::uuid, 'WITHDRAWAL', 50000, 'ACTIVE', $3::uuid, 1, $4::timestamptz, $4::timestamptz)`, [holdId, s.walletId, withdrawalId, at]);
      await c.query(
        `INSERT INTO app.wallet_withdrawals (withdrawal_id, wallet_id, driver_id, hold_id, amount_vnd, state, version, bank_code, bank_name, account_number, account_holder, bank_snapshot_at, bank_verified_at, created_by_user_id, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 50000, 'PENDING', 1, 'VCB', 'Vietcombank', '0123456789', 'Tai xe', $5::timestamptz, $5::timestamptz, $6::uuid, $5::timestamptz, $5::timestamptz)`,
        [withdrawalId, s.walletId, s.driverId, holdId, at, s.userId],
      );
    });
    const late = { eventId: randomUUID(), eventType: 'wallet.withdrawal.changed.v1', eventSchemaVersion: 1, resourceType: 'wallet_withdrawal', resourceId: withdrawalId, resourceVersion: 1, occurredAt: at, attemptCount: 1, payload: { withdrawal_id: withdrawalId, state: 'PENDING', version: 1 } };
    const highBefore = await metricCount('m08_stale_event.delivered_late_high');
    await events.consume(late);
    expect(await outcomeOf(late.eventId)).toBe('DELIVERED_LATE');
    const card = ((await inbox(s)).items as Json[]).filter((i) => i.kind === 'WITHDRAWAL_REQUESTED');
    expect(card).toHaveLength(1);
    expect(ageHours(card[0]?.created_at)).toBeGreaterThan(24);
    expect(await pushesOf(late.eventId)).toEqual([{ status: 'SKIPPED', skip_reason: 'STALE_EVENT' }]);
    expect(await metricCount('m08_stale_event.delivered_late_high')).toBe(highBefore + 1);
  });

  it('a 25 h old topup confirmation reaches the Shipper the same way (inbox at the event time, push skipped, HIGH metric)', async () => {
    const s = await newShipper(true);
    const events = app.running.app.get(NotificationEventService);
    const requestId = randomUUID();
    const at = new Date(Date.now() - 25 * 3_600_000).toISOString();
    await seed(['app.wallet_topup_requests'], async (c) => {
      await c.query(
        `INSERT INTO app.wallet_topup_requests (request_id, wallet_id, driver_id, amount_requested_vnd, state, created_by_user_id, resolved_by_user_id, version, created_at, updated_at, resolved_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 100000, 'CONFIRMED', $4::uuid, $5::uuid, 2, $6::timestamptz, $6::timestamptz, $6::timestamptz)`,
        [requestId, s.walletId, s.driverId, s.userId, shop.userId, at],
      );
    });
    const late = { eventId: randomUUID(), eventType: 'wallet.topup_request.changed.v1', eventSchemaVersion: 1, resourceType: 'wallet_topup_request', resourceId: requestId, resourceVersion: 2, occurredAt: at, attemptCount: 1, payload: { request_id: requestId, state: 'CONFIRMED', version: 2 } };
    await events.consume(late);
    expect(await outcomeOf(late.eventId)).toBe('DELIVERED_LATE');
    const card = ((await inbox(s)).items as Json[]).filter((i) => i.kind === 'TOPUP_CONFIRMED');
    expect(card).toHaveLength(1);
    expect(ageHours(card[0]?.created_at)).toBeGreaterThan(24);
    expect(await pushesOf(late.eventId)).toEqual([{ status: 'SKIPPED', skip_reason: 'STALE_EVENT' }]);
  });

  it('a 25 h old finance message reaches the owner as the collapsed card at the event time', async () => {
    const s = await newShipper(true);
    const events = app.running.app.get(NotificationEventService);
    const requestId = randomUUID();
    const at = new Date(Date.now() - 25 * 3_600_000).toISOString();
    let sequence = '';
    await seed(['app.business_finance_requests', 'app.business_finance_messages'], async (c) => {
      await c.query(`INSERT INTO app.business_finance_requests (request_id, kind, owner_user_id, amount_requested_vnd, state, version, created_at) VALUES ($1::uuid, 'TOPUP', $2::uuid, 100000, 'PENDING', 1, $3::timestamptz)`, [requestId, s.userId, at]);
      const msg = await c.query<{ sequence_no: string }>(
        `INSERT INTO app.business_finance_messages (request_id, sender_user_id, sender_role, body, event_kind, created_at) VALUES ($1::uuid, $2::uuid, 'SHOP', 'Vui lòng kiểm tra lại', 'MESSAGE', $3::timestamptz) RETURNING sequence_no`,
        [requestId, shop.userId, at],
      );
      sequence = String(msg.rows[0]?.sequence_no);
    });
    const late = { eventId: randomUUID(), eventType: 'business.finance.updated.v1', eventSchemaVersion: 1, resourceType: 'business_finance_request', resourceId: requestId, resourceVersion: 1, occurredAt: at, attemptCount: 1, payload: { request_id: requestId, sequence } };
    await events.consume(late);
    expect(await outcomeOf(late.eventId)).toBe('DELIVERED_LATE');
    const card = ((await inbox(s)).items as Json[]).filter((i) => i.kind === 'FINANCE_UPDATED');
    expect(card).toHaveLength(1);
    expect(ageHours(card[0]?.created_at)).toBeGreaterThan(24);
    expect(await pushesOf(late.eventId)).toEqual([{ status: 'SKIPPED', skip_reason: 'STALE_EVENT' }]);
    expect(await cardTimes(late.eventId)).toEqual([{ created_at: expect.any(Date), updated_at: expect.any(Date) }]);
    const [times] = (await cardTimes(late.eventId)) as { created_at: Date; updated_at: Date }[];
    expect(Date.now() - new Date(times?.updated_at ?? 0).getTime()).toBeGreaterThan(24 * 3_600_000);
  });

  it('a late chat card keeps its event time and never moves an existing card backwards: a young message first, then a 25 h old one', async () => {
    const s = await newShipper(true);
    const d = await newDelivery();
    const id = String(d.delivery_id);
    const events = app.running.app.get(NotificationEventService);
    const chat = (h: number) => ({ eventId: randomUUID(), eventType: 'order.chat_message.v1', eventSchemaVersion: 1, resourceType: 'order_chat_message', resourceId: randomUUID(), resourceVersion: 1, occurredAt: hoursAgo(h), attemptCount: 1, payload: { room_type: 'DIRECT', room_id: id, sender_user_id: s.userId } });

    const young = chat(1);
    await events.consume(young);
    expect(await outcomeOf(young.eventId)).toBe('OK');
    const [youngCard] = (await cardTimes(young.eventId)) as { created_at: Date; updated_at: Date }[];
    expect(ageHours(youngCard?.updated_at)).toBeGreaterThan(0.9);
    expect(ageHours(youngCard?.updated_at)).toBeLessThan(1.1);

    const old = chat(25);
    await events.consume(old);
    expect(await outcomeOf(old.eventId)).toBe('DELIVERED_LATE');
    // The card keeps the young event as its source; the late event's own push is found by its push key.
    expect(await rows(`SELECT status, skip_reason FROM app.notification_pushes WHERE push_key = $1`, [`chat:${old.eventId}`])).toEqual([{ status: 'SKIPPED', skip_reason: 'STALE_EVENT' }]);
    // The same card (one per room and recipient): its last update is still the young one's time.
    const [again] = (await rows(`SELECT notification_id, created_at, updated_at FROM app.notifications WHERE recipient_user_id = $1::uuid AND dedupe_key = $2`, [shop.userId, `chat:DIRECT:${id}`])) as { created_at: Date; updated_at: Date }[];
    expect(again).toBeDefined();
    expect(Math.abs(new Date(again?.updated_at ?? 0).getTime() - new Date(youngCard?.updated_at ?? 0).getTime())).toBeLessThan(1_000);
    expect(ageHours(again?.created_at)).toBeLessThan(2);
    expect(await rows(`SELECT count(*)::int AS n FROM app.notifications WHERE recipient_user_id = $1::uuid AND dedupe_key = $2`, [shop.userId, `chat:DIRECT:${id}`])).toEqual([{ n: 1 }]);
  });

  it('an event within 24 h keeps the existing behaviour: normal outcome, live push, no stale audit and no stale metric', async () => {
    const s = await newShipper(true);
    expect((await registerToken(s, tokenOf('young'))).status).toBe(200);
    await flush();
    const events = app.running.app.get(NotificationEventService);
    const young = { eventId: randomUUID(), eventType: 'driver.state_changed.v1', eventSchemaVersion: 1, resourceType: 'driver', resourceId: s.driverId, resourceVersion: 6, occurredAt: hoursAgo(23), attemptCount: 1, payload: { driver_id: s.driverId, change: 'rejected', status: 'ACTIVE', review_state: 'REJECTED', accepting_deliveries: false, version: 6 } };
    const before = await metricCount('m08_stale_event.delivered_late');
    await events.consume(young);
    expect(await outcomeOf(young.eventId)).toBe('OK');
    const card = ((await inbox(s)).items as Json[]).find((i) => i.kind === 'PROFILE_REJECTED') as Json;
    expect(Date.now() - Date.parse(String(card.created_at))).toBeGreaterThan(22 * 3_600_000);
    expect(await rows(`SELECT status, (expires_at > now()) AS live FROM app.notification_pushes WHERE recipient_user_id = $1::uuid`, [s.userId])).toEqual([{ status: 'PENDING', live: true }]);
    expect(await staleAudits(young.eventId)).toHaveLength(0);
    expect(await metricCount('m08_stale_event.delivered_late')).toBe(before);
  });
  // ---- P6-9 (review): one atomic upsert for a collapsed card; the newer fact wins and an older one never moves the card backwards ----------------------

  const repo = (): NotificationRepository => app.running.app.get(NotificationRepository);
  const txs = (): TransactionManager => app.running.app.get(TransactionManager);
  const cardOf = async (dedupe: string): Promise<Json[]> => rows(`SELECT notification_id, title, source_event_id, created_at, updated_at, read_at, seq::text AS seq FROM app.notifications WHERE recipient_user_id = $1::uuid AND app = 'FOOD' AND dedupe_key = $2`, [shop.userId, dedupe]);
  const putCard = (dedupe: string, eventId: string, title: string, hoursOld: number): Promise<{ notificationId: string; refreshed: boolean }> =>
    txs().withTransaction((context) =>
      repo().upsertCollapsedCard(context, {
        notificationId: randomUUID(),
        recipientUserId: shop.userId,
        app: 'FOOD',
        kind: 'ORDER_CHAT_MESSAGE',
        category: CATEGORY_OF_KIND.ORDER_CHAT_MESSAGE,
        title,
        body: 'Mở để xem',
        targetType: 'DELIVERY',
        targetId: randomUUID(),
        targetVersion: 0,
        dedupeKey: dedupe,
        sourceEventId: eventId,
        validForMs: null,
        purgeDays: 30,
        ageMs: hoursOld * 3_600_000,
      }),
    );

  it('two workers refreshing one card at the same time, in either call order: one card, the newer fact wins, the older one never moves it backwards', async () => {
    for (const order of ['old-first', 'new-first'] as const) {
      const dedupe = `race:${order}:${randomUUID()}`;
      const oldEvent = randomUUID();
      const newEvent = randomUUID();
      const oldWrite = putCard(dedupe, oldEvent, 'Tin cũ', 25);
      const newWrite = putCard(dedupe, newEvent, 'Tin mới', 1);
      await Promise.all(order === 'old-first' ? [oldWrite, newWrite] : [newWrite, oldWrite]);
      const cards = await cardOf(dedupe);
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({ title: 'Tin mới', source_event_id: newEvent });
      expect(ageHours(cards[0]?.updated_at)).toBeGreaterThan(0.9);
      expect(ageHours(cards[0]?.updated_at)).toBeLessThan(1.1);
      // created_at is the time of the fact that created the card: whichever of the two reached the table first. Both are real facts.
      const created = ageHours(cards[0]?.created_at);
      expect(created > 24.9 && created < 25.1 || created > 0.9 && created < 1.1).toBe(true);
    }
  });

  it('an older fact arriving after a newer one leaves the card alone: text, source, last update, unread state and created_at do not move', async () => {
    const dedupe = `old-after-new:${randomUUID()}`;
    const newEvent = randomUUID();
    await putCard(dedupe, newEvent, 'Tin mới', 1);
    await app.pool.query(`UPDATE app.notifications SET read_at = clock_timestamp() WHERE recipient_user_id = $1::uuid AND app = 'FOOD' AND dedupe_key = $2`, [shop.userId, dedupe]);
    const before = (await cardOf(dedupe))[0] as Json;
    expect(before.read_at).not.toBeNull();
    await putCard(dedupe, randomUUID(), 'Tin cũ', 25);
    const after = (await cardOf(dedupe))[0] as Json;
    expect(after).toMatchObject({ title: 'Tin mới', source_event_id: newEvent });
    expect(after.read_at).toEqual(before.read_at);
    expect(after.updated_at).toEqual(before.updated_at);
    expect(after.created_at).toEqual(before.created_at);
    // The live cursor is renewed on every refresh, as it always was.
    expect(BigInt(String(after.seq)) > BigInt(String(before.seq))).toBe(true);
  });

  it('a newer fact after the card was read makes it unread again, with its own text, source and time; the card was created by the older one', async () => {
    const dedupe = `new-after-old:${randomUUID()}`;
    const oldEvent = randomUUID();
    const newEvent = randomUUID();
    await putCard(dedupe, oldEvent, 'Tin cũ', 25);
    await app.pool.query(`UPDATE app.notifications SET read_at = clock_timestamp() WHERE recipient_user_id = $1::uuid AND app = 'FOOD' AND dedupe_key = $2`, [shop.userId, dedupe]);
    const before = (await cardOf(dedupe))[0] as Json;
    await putCard(dedupe, newEvent, 'Tin mới', 1);
    const after = (await cardOf(dedupe))[0] as Json;
    expect(after).toMatchObject({ title: 'Tin mới', source_event_id: newEvent, read_at: null });
    expect(ageHours(after.updated_at)).toBeLessThan(1.1);
    expect(after.created_at).toEqual(before.created_at);
    expect(ageHours(after.created_at)).toBeGreaterThan(24.9);
    expect(BigInt(String(after.seq)) > BigInt(String(before.seq))).toBe(true);
  });
});
