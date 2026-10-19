import { randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { expect } from '@jest/globals';
import { FEEDBACK_ORDER_PORT, FeedbackOrderPort, OrderFact } from '../../../apps/backend/src/feedback/feedback-order-port';
import { M14_ROUTING } from '../../../apps/backend/src/delivery/m14-route-client';
import { TransactionContext } from '../../../apps/backend/src/transaction/transaction-context';
import { ApiResponse, AuthApp, countRows, dataOf, obtainProof, PASSWORD, randomPhone, startAuthApp } from './auth-fixtures';
import { createShopOwner, ShopOwner } from './shop-management-fixtures';

// The world M11 is tested in: a REAL Nest pipeline and PostgreSQL, a real local M14 routing server, one shop, Shippers and customers that go through
// the real registration / login, and deliveries that go through the REAL M07 routes (accept, destination, pickup, complete / fail). The ONE stand-in is the
// M10 order adapter (M10 is not built): a port bound in memory that answers like M10 will (an order belongs to the account that placed it).

export const TERMS = 'test-terms-20261011-v1';
export const PRIVACY = 'test-privacy-20261011-v1';
const WEB_SHIP = { device_id: 'web-ship-0011', platform: 'WEB', app: 'SHIP' };
const WEB_FOOD = { device_id: 'web-food-0011', platform: 'WEB', app: 'FOOD' };
export const tag = randomBytes(3).toString('hex').toUpperCase();
export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Shipper {
  readonly userId: string;
  readonly token: string;
  readonly driverId: string;
  readonly walletId: string;
}

export interface Customer {
  readonly userId: string;
  readonly token: string;
}

export interface StubOrder extends OrderFact {
  customerUserId: string;
}

/** The in-memory M10: an order of the account that placed it. `integrated=false` makes it answer like the default "not connected" binding. */
export class StubOrders implements FeedbackOrderPort {
  integrated = true;
  readonly orders = new Map<string, StubOrder>();

  orderOfCustomer(_context: TransactionContext, orderId: string, customerUserId: string): Promise<OrderFact | undefined> {
    const order = this.orders.get(orderId);
    return Promise.resolve(order !== undefined && order.customerUserId === customerUserId ? order : undefined);
  }
}

export class M11World {
  readonly drivers: string[] = [];
  readonly stub = new StubOrders();
  private addedPolicy = false;

  private constructor(
    readonly app: AuthApp,
    private readonly router: http.Server,
    readonly shop: ShopOwner,
  ) {}

  static async start(): Promise<M11World> {
    const router = http.createServer((request, response) => {
      request.resume();
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ trip: { summary: { length: 2.5, time: 420 } } }));
    });
    await new Promise<void>((resolve) => router.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(router.address() as AddressInfo).port}`;
    const stub = new StubOrders();
    const app = await startAuthApp(
      {},
      {
        relaxTimeouts: true,
        configOverride: { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY } },
        overrides: [
          { provide: M14_ROUTING, useValue: { origin, timeoutMs: 3000 } },
          { provide: FEEDBACK_ORDER_PORT, useValue: stub },
        ],
      },
    );
    const shop = await createShopOwner(app);
    const world = new M11World(app, router, shop);
    (world as { stub: StubOrders }).stub = stub;
    const existing = await app.pool.query('SELECT 1 FROM app.shipping_fee_policy_versions LIMIT 1');
    if ((existing.rowCount ?? 0) === 0) {
      await app.pool.query(
        `INSERT INTO app.shipping_fee_policy_versions (version_id, version_no, schema_version, tiers, applied_by, applied_at) VALUES ($1::uuid, 1, 2, $2::jsonb, $3::uuid, now())`,
        [randomUUID(), JSON.stringify([{ from_m: 0, to_m: 3000, fee_vnd: 10000 }, { from_m: 3000, to_m: 6000, fee_vnd: 15000 }, { from_m: 6000, to_m: 10000, fee_vnd: 20000 }]), shop.userId],
      );
      world.addedPolicy = true;
    }
    return world;
  }

  async close(): Promise<void> {
    try {
      await this.cleanup();
    } finally {
      await this.app.close();
      await new Promise<void>((resolve) => this.router.close(() => resolve()));
    }
  }

  /** Removes exactly the rows this suite created, in one transaction with the user triggers of those tables lifted (the application never deletes them). */
  private async cleanup(): Promise<void> {
    const client = await this.app.pool.connect();
    const m11 = ['complaint_adjustments', 'complaint_reconsiderations', 'complaint_attachments', 'complaint_messages', 'complaints', 'review_reply_history', 'review_replies', 'review_moderations', 'reviews'];
    const m07 = ['wallet_ledger_entries', 'wallet_holds', 'delivery_incidents', 'delivery_events', 'delivery_assignments', 'deliveries', 'driver_wallets', 'shipping_fee_agreement_events', 'shipping_fee_agreements', 'shipping_fee_policy_versions'];
    try {
      await client.query('BEGIN');
      for (const table of [...m11, ...m07]) {
        await client.query(`ALTER TABLE app.${table} DISABLE TRIGGER USER`);
      }
      const mine = `SELECT delivery_id FROM app.deliveries WHERE shop_id = $1::uuid`;
      const wallets = `SELECT wallet_id FROM app.driver_wallets WHERE driver_id = ANY($1::uuid[])`;
      const shopId = this.shop.shopId;
      // The test database holds only this suite's rows of these tables (other suites never write M11 rows): they are removed whole, children first.
      for (const table of ['complaint_adjustments', 'complaint_reconsiderations', 'complaint_attachments', 'complaint_messages', 'complaints', 'review_reply_history', 'review_replies', 'review_moderations', 'reviews']) {
        await client.query(`DELETE FROM app.${table}`);
      }
      await client.query(`DELETE FROM app.wallet_ledger_entries WHERE wallet_id IN (${wallets})`, [this.drivers]);
      await client.query(`DELETE FROM app.wallet_holds WHERE wallet_id IN (${wallets})`, [this.drivers]);
      await client.query(`DELETE FROM app.delivery_incidents WHERE delivery_id IN (${mine})`, [shopId]);
      await client.query(`DELETE FROM app.delivery_events WHERE delivery_id IN (${mine})`, [shopId]);
      await client.query(`DELETE FROM app.shipping_fee_agreement_events WHERE agreement_id IN (SELECT agreement_id FROM app.shipping_fee_agreements WHERE delivery_id IN (${mine}))`, [shopId]);
      await client.query(`DELETE FROM app.shipping_fee_agreements WHERE delivery_id IN (${mine})`, [shopId]);
      await client.query(`DELETE FROM app.delivery_assignments WHERE delivery_id IN (${mine})`, [shopId]);
      await client.query('DELETE FROM app.deliveries WHERE shop_id = $1::uuid', [shopId]);
      await client.query('DELETE FROM app.shipper_latest_locations WHERE driver_id = ANY($1::uuid[])', [this.drivers]);
      await client.query('DELETE FROM app.driver_wallets WHERE driver_id = ANY($1::uuid[])', [this.drivers]);
      if (this.addedPolicy) {
        await client.query('DELETE FROM app.shipping_fee_policy_versions');
      }
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      for (const table of [...m11, ...m07]) {
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

  // ---- calls -----------------------------------------------------------------------------------------------------------------

  as(token: string, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, key: string = randomUUID()): Promise<ApiResponse> {
    return this.app.call(method, path, { bearer: token, ...(method !== 'GET' ? { headers: { 'idempotency-key': key } } : {}), ...(body === undefined ? {} : { body }) });
  }

  asShop = (method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, key?: string): Promise<ApiResponse> => this.as(this.shop.token, method, path, body, key);
  asShipper = (s: Shipper, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, key?: string): Promise<ApiResponse> => this.as(s.token, method, path, body, key);
  asCustomer = (c: Customer, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, key?: string): Promise<ApiResponse> => this.as(c.token, method, path, body, key);

  // ---- people ----------------------------------------------------------------------------------------------------------------

  private async register(device: Json, fullName: string): Promise<{ userId: string; phone: ReturnType<typeof randomPhone> }> {
    const phone = randomPhone();
    this.app.track(phone.normalized);
    const proof = await obtainProof(this.app, phone);
    const registered = await this.app.call('POST', '/client-auth/register', {
      headers: { 'idempotency-key': randomUUID() },
      body: { phone: phone.local, password: PASSWORD, verification_token: proof.proofToken, device: { ...device }, full_name: fullName, consent: { terms_version: TERMS, privacy_version: PRIVACY } },
    });
    expect(registered.status).toBe(201);
    return { userId: String(dataOf(registered).user_id), phone };
  }

  async newCustomer(name = `Khách ${tag}`): Promise<Customer> {
    const { userId, phone } = await this.register(WEB_FOOD, name);
    const loggedIn = await this.app.call('POST', '/client-auth/login', { headers: { 'idempotency-key': randomUUID() }, body: { phone: phone.local, password: PASSWORD, device: { ...WEB_FOOD } } });
    expect(loggedIn.status).toBe(200);
    return { userId, token: String(dataOf(loggedIn).access_token) };
  }

  /** An ACTIVE, accepting Shipper with a wallet, a ledger credit and a fresh position near the shop. */
  async newShipper(funds = 50_000): Promise<Shipper> {
    const { userId, phone } = await this.register(WEB_FOOD, `Shipper ${tag}`);
    const loggedIn = await this.app.call('POST', '/client-auth/login', { headers: { 'idempotency-key': randomUUID() }, body: { phone: phone.local, password: PASSWORD, device: { ...WEB_SHIP } } });
    expect(loggedIn.status).toBe(200);
    const token = String(dataOf(loggedIn).access_token);
    const created = await this.app.call('POST', '/onboarding/driver', { bearer: token, headers: { 'idempotency-key': randomUUID() }, body: { full_name: `Shipper ${tag}`, plate_number: '59X1-123.45' } });
    expect(created.status).toBe(201);
    const driverId = String(dataOf(created).driver_id);
    await this.app.pool.query(`UPDATE app.drivers SET status = 'ACTIVE', accepting_deliveries = true, review_state = 'APPROVED' WHERE driver_id = $1::uuid`, [driverId]);
    await this.app.pool.query(
      `INSERT INTO app.driver_bank_accounts (driver_id, bank_code, bank_name, account_number, account_holder, verification_state, verified_by, verified_at, created_at, updated_at)
       VALUES ($1::uuid, 'VCB', 'Vietcombank', '0123456789', 'SHIPPER', 'VERIFIED', $2::uuid, now(), now(), now())`,
      [driverId, userId],
    );
    const selected = await this.app.call('POST', '/auth/role/select', { bearer: token, body: { role: 'DRIVER' } });
    expect(selected.status).toBe(200);
    const walletId = await this.fund(driverId, funds);
    this.drivers.push(driverId);
    const shipper: Shipper = { userId, token, driverId, walletId };
    const located = await this.asShipper(shipper, 'PUT', '/driver/location', { lat: 21.0005, lng: 105.8005, accuracy_m: 20 });
    expect([200, 204]).toContain(located.status);
    return shipper;
  }

  /** Test-only funding: the money-in path is not under test here, so the ledger credit is written with the source gate lifted in ONE transaction. */
  private async fund(driverId: string, amount: number): Promise<string> {
    const client = await this.app.pool.connect();
    try {
      await client.query('BEGIN');
      const walletId = randomUUID();
      await client.query(`INSERT INTO app.driver_wallets (wallet_id, driver_id, balance_vnd, held_vnd, version, created_at, updated_at) VALUES ($1::uuid, $2::uuid, 0, 0, 1, now(), now())`, [walletId, driverId]);
      await client.query('ALTER TABLE app.wallet_ledger_entries DISABLE TRIGGER wallet_ledger_a_source_gate');
      await client.query(`INSERT INTO app.wallet_ledger_entries (entry_id, wallet_id, sequence_no, entry_kind, delta_vnd, balance_after_vnd, created_at) VALUES ($1::uuid, $2::uuid, 1, 'ADJUSTMENT_CREDIT', $3, $3, now())`, [randomUUID(), walletId, amount]);
      await client.query('UPDATE app.driver_wallets SET balance_vnd = $2, version = version + 1 WHERE wallet_id = $1::uuid', [walletId, amount]);
      await client.query('COMMIT');
      return walletId;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  wallet = async (s: Shipper): Promise<{ balance: number; held: number }> => {
    const row = (await this.app.pool.query<{ balance_vnd: string; held_vnd: string }>('SELECT balance_vnd, held_vnd FROM app.driver_wallets WHERE wallet_id = $1::uuid', [s.walletId])).rows[0];
    return { balance: Number(row?.balance_vnd), held: Number(row?.held_vnd) };
  };

  ledgerCount = (s: Shipper): Promise<number> => countRows(this.app.pool, 'SELECT 1 FROM app.wallet_ledger_entries WHERE wallet_id = $1::uuid', [s.walletId]);

  // ---- deliveries (the real M07 routes) --------------------------------------------------------------------------------------

  async newDelivery(over: Json = {}): Promise<Json> {
    const created = await this.asShop('POST', '/shop/me/deliveries', {
      recipient_name: 'Khách nhận',
      recipient_phone: '0912345678',
      dropoff_address_text: '12 Phố Huế, Hai Bà Trưng, Hà Nội',
      dropoff_lat: 21.0,
      dropoff_lng: 105.82,
      goods_description: 'Hộp quà',
      goods_value_vnd: 200_000,
      paid_vnd: 0,
      fee_payer: 'CUSTOMER',
      ...over,
    });
    expect([created.status, created.text.slice(0, 200)]).toEqual([201, created.text.slice(0, 200)]);
    return dataOf(created) as Json;
  }

  /** Accepts and picks up, leaving the delivery `delivering`. Returns the delivery id and its current version. */
  async deliver(s: Shipper, over: Json = {}): Promise<{ id: string; version: number }> {
    const delivery = await this.newDelivery(over);
    const accepted = await this.asShipper(s, 'POST', `/driver/deliveries/${delivery.delivery_id}/accept`, {});
    expect([accepted.status, accepted.text.slice(0, 300)]).toEqual([200, accepted.text.slice(0, 300)]);
    let current = dataOf(accepted) as Json;
    if (current.state === 'accepted') {
      const confirmed = await this.asShipper(s, 'POST', `/driver/deliveries/${delivery.delivery_id}/destination`, { expected_version: current.version, lat: 21.0, lng: 105.82, fee_vnd: 15_000 });
      if (confirmed.status === 200) {
        current = dataOf(confirmed) as Json;
      }
    }
    const picked = await this.asShipper(s, 'POST', `/driver/deliveries/${delivery.delivery_id}/pickup`, { expected_version: current.version });
    expect([picked.status, picked.text.slice(0, 300)]).toEqual([200, picked.text.slice(0, 300)]);
    return { id: String(delivery.delivery_id), version: Number((dataOf(picked) as Json).version) };
  }

  async completed(s: Shipper, over: Json = {}): Promise<string> {
    const run = await this.deliver(s, over);
    const done = await this.asShipper(s, 'POST', `/driver/deliveries/${run.id}/complete`, { expected_version: run.version });
    expect([done.status, done.text.slice(0, 300)]).toEqual([200, done.text.slice(0, 300)]);
    return run.id;
  }

  async failed(s: Shipper, over: Json = {}): Promise<string> {
    const run = await this.deliver(s, over);
    const failed = await this.asShipper(s, 'POST', `/driver/deliveries/${run.id}/fail`, { expected_version: run.version, reason_code: 'RECIPIENT_UNREACHABLE', goods_condition: 'WITH_SHIPPER', note: 'Không liên lạc được' });
    expect([failed.status, failed.text.slice(0, 300)]).toEqual([200, failed.text.slice(0, 300)]);
    return run.id;
  }

  /** A delivery the Shipper accepted and gave back before pickup (assignment CANCELLED_BY_SHIPPER; the delivery searches again). */
  async givenBack(s: Shipper): Promise<string> {
    const delivery = await this.newDelivery();
    const accepted = await this.asShipper(s, 'POST', `/driver/deliveries/${delivery.delivery_id}/accept`, {});
    expect(accepted.status).toBe(200);
    const released = await this.asShipper(s, 'POST', `/driver/deliveries/${delivery.delivery_id}/release`, { reason: 'Xe hỏng', expected_version: (dataOf(accepted) as Json).version });
    expect(released.status).toBe(200);
    return String(delivery.delivery_id);
  }

  /** Test-only: makes a finished DIRECT delivery the delivery of a stub order (M10 will create the link itself). */
  async linkToOrder(deliveryId: string, customer: Customer, over: Partial<StubOrder> = {}): Promise<StubOrder> {
    const orderId = randomUUID();
    const client = await this.app.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE app.deliveries DISABLE TRIGGER deliveries_guard');
      await client.query(`UPDATE app.deliveries SET source = 'ORDER', order_id = $2::uuid WHERE delivery_id = $1::uuid`, [deliveryId, orderId]);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      await client.query('ALTER TABLE app.deliveries ENABLE TRIGGER deliveries_guard');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const order: StubOrder = { orderId, code: `#${tag}${deliveryId.slice(0, 4)}`, shopId: this.shop.shopId, shopName: 'Quán thử', completed: true, customerUserId: customer.userId, ...over };
    this.stub.orders.set(orderId, order);
    return order;
  }

  /** A stub order with no delivery (a food order the customer finished, or not). */
  newOrder(customer: Customer, over: Partial<StubOrder> = {}): StubOrder {
    const orderId = randomUUID();
    const order: StubOrder = { orderId, code: `#${tag}${orderId.slice(0, 4)}`, shopId: this.shop.shopId, shopName: 'Quán thử', completed: true, customerUserId: customer.userId, ...over };
    this.stub.orders.set(orderId, order);
    return order;
  }

  count = (sql: string, values: unknown[] = []): Promise<number> => countRows(this.app.pool, sql, values);
}

/** A 1x1 PNG: a real picture the signature check accepts. */
export const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
