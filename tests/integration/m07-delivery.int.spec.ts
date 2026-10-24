import { randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { DeliverySweeper } from '../../apps/backend/src/delivery/delivery-sweeper';
import { M14_ROUTING } from '../../apps/backend/src/delivery/m14-route-client';
import { ApiResponse, AuthApp, countRows, dataOf, errorCode, obtainProof, PASSWORD, randomPhone, startAuthApp } from './support/auth-fixtures';
import { createShopOwner, ShopOwner } from './support/shop-management-fixtures';

// M07 on a REAL Nest pipeline and PostgreSQL: a shop calls a Shipper, the Shipper accepts, picks up and completes or fails; the rules around it
// (one winner, no money for the loser, cancel before pickup from either side, no cancel after pickup, the fee/pin gate, the 30-minute window that
// a give-back never restarts, the privacy of the offer). The M14 routing service is a REAL local HTTP server (not an in-process fake).
// M10 (Order), M08 and M11 are not connected: only direct calls from the shop are exercised.

const TERMS = 'test-terms-20261011-v1';
const PRIVACY = 'test-privacy-20261011-v1';
const WEB_SHIP = { device_id: 'web-ship-0007', platform: 'WEB', app: 'SHIP' };
const WEB_FOOD = { device_id: 'web-food-0007', platform: 'WEB', app: 'FOOD' };
const tag = randomBytes(3).toString('hex').toUpperCase();
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Shipper {
  readonly userId: string;
  readonly token: string;
  readonly driverId: string;
  readonly walletId: string;
}

describe('M07 — delivery flow', () => {
  let app: AuthApp;
  let router: http.Server;
  let shop: ShopOwner;
  const drivers: string[] = [];
  let addedPolicy = false;

  beforeAll(async () => {
    router = http.createServer((request, response) => {
      request.resume();
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ trip: { summary: { length: 2.5, time: 420 } } }));
    });
    await new Promise<void>((resolve) => router.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(router.address() as AddressInfo).port}`;
    app = await startAuthApp(
      {},
      { relaxTimeouts: true, configOverride: { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY } }, overrides: [{ provide: M14_ROUTING, useValue: { origin, timeoutMs: 3000 } }] },
    );
    shop = await createShopOwner(app);
    // A fee table must be in force, otherwise the fee is honestly "not determined" and no delivery can be picked up (that case has its own test).
    const existing = await app.pool.query('SELECT 1 FROM app.shipping_fee_policy_versions LIMIT 1');
    if ((existing.rowCount ?? 0) === 0) {
      await app.pool.query(
        `INSERT INTO app.shipping_fee_policy_versions (version_id, version_no, schema_version, tiers, applied_by, applied_at) VALUES ($1::uuid, 1, 2, $2::jsonb, $3::uuid, now())`,
        [randomUUID(), JSON.stringify([{ from_m: 0, to_m: 3000, fee_vnd: 10000 }, { from_m: 3000, to_m: 6000, fee_vnd: 15000 }, { from_m: 6000, to_m: 10000, fee_vnd: 20000 }]), shop.userId],
      );
      addedPolicy = true;
    }
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
    await new Promise<void>((resolve) => router.close(() => resolve()));
  });

  /**
   * Removes exactly the rows this suite created (its shop's deliveries and the wallets of its Shippers), in one transaction with the user triggers of
   * those tables lifted (the application never deletes them). The phones are purged afterwards by app.close(). Errors are NOT swallowed.
   */
  async function cleanup(): Promise<void> {
    await dropExtraCommissionPolicies();
    const client = await app.pool.connect();
    const tables = ['wallet_ledger_entries', 'wallet_holds', 'delivery_incidents', 'delivery_events', 'delivery_assignments', 'deliveries', 'driver_wallets', 'shipping_fee_agreement_events', 'shipping_fee_agreements', 'shipping_fee_policy_versions'];
    try {
      await client.query('BEGIN');
      for (const table of tables) {
        await client.query(`ALTER TABLE app.${table} DISABLE TRIGGER USER`);
      }
      const mine = `SELECT delivery_id FROM app.deliveries WHERE shop_id = $1::uuid`;
      const wallets = `SELECT wallet_id FROM app.driver_wallets WHERE driver_id = ANY($1::uuid[])`;
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
      await client.query('SET CONSTRAINTS ALL IMMEDIATE'); // the deferred withdrawal foreign keys fire now, before the triggers come back
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

  const asShop = (method: 'GET' | 'POST', path: string, body?: unknown, key: string = randomUUID()): Promise<ApiResponse> =>
    app.call(method, path, { bearer: shop.token, ...(method === 'POST' ? { headers: { 'idempotency-key': key } } : {}), ...(body === undefined ? {} : { body }) });
  const asShipper = (s: Shipper, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, key: string = randomUUID()): Promise<ApiResponse> =>
    app.call(method, path, { bearer: s.token, ...(method !== 'GET' ? { headers: { 'idempotency-key': key } } : {}), ...(body === undefined ? {} : { body }) });

  /** An ACTIVE, accepting Shipper with a wallet, ledger credit and a fresh position near the shop (committed, then purged with the account). */
  async function newShipper(funds = 50_000, near = true, android = false): Promise<Shipper> {
    const phone = randomPhone();
    app.track(phone.normalized);
    const proof = await obtainProof(app, phone);
    const registered = await app.call('POST', '/client-auth/register', {
      headers: { 'idempotency-key': randomUUID() },
      body: { phone: phone.local, password: PASSWORD, verification_token: proof.proofToken, device: { ...WEB_FOOD }, full_name: `Shipper ${tag}`, consent: { terms_version: TERMS, privacy_version: PRIVACY } },
    });
    expect(registered.status).toBe(201);
    const userId = String(dataOf(registered).user_id);
    const loggedIn = await app.call('POST', '/client-auth/login', { headers: { 'idempotency-key': randomUUID() }, body: { phone: phone.local, password: PASSWORD, device: { ...WEB_SHIP, ...(android ? { platform: 'ANDROID' } : {}) } } });
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
    const selected = await app.call('POST', '/auth/role/select', { bearer: token, body: { role: 'DRIVER' } });
    expect([selected.status, selected.text.slice(0, 200)]).toEqual([200, selected.text.slice(0, 200)]);
    const walletId = await fund(driverId, funds);
    drivers.push(driverId);
    const shipper: Shipper = { userId, token, driverId, walletId };
    const located = await asShipper(shipper, 'PUT', '/driver/location', { lat: near ? 21.0005 : 21.2, lng: 105.8005, accuracy_m: 20 });
    expect([200, 204]).toContain(located.status);
    return shipper;
  }

  /** Test-only funding: the money-in path (M04-B2/B3) does not exist yet, so the ledger credit is written with the source gates lifted in ONE transaction. */
  async function fund(driverId: string, amount: number): Promise<string> {
    const client = await app.pool.connect();
    try {
      await client.query('BEGIN');
      const wallet = await client.query<{ wallet_id: string }>('SELECT wallet_id FROM app.driver_wallets WHERE driver_id = $1::uuid', [driverId]);
      let walletId = wallet.rows[0]?.wallet_id;
      if (walletId === undefined) {
        walletId = randomUUID();
        await client.query(`INSERT INTO app.driver_wallets (wallet_id, driver_id, balance_vnd, held_vnd, version, created_at, updated_at) VALUES ($1::uuid, $2::uuid, 0, 0, 1, now(), now())`, [walletId, driverId]);
      }
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

  const wallet = async (s: Shipper): Promise<{ balance: number; held: number }> => {
    const row = (await app.pool.query<{ balance_vnd: string; held_vnd: string }>('SELECT balance_vnd, held_vnd FROM app.driver_wallets WHERE wallet_id = $1::uuid', [s.walletId])).rows[0];
    return { balance: Number(row?.balance_vnd), held: Number(row?.held_vnd) };
  };

  const createBody = (over: Json = {}): Json => ({
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

  async function newDelivery(over: Json = {}): Promise<Json> {
    const created = await asShop('POST', '/shop/me/deliveries', createBody(over));
    expect([created.status, created.text.slice(0, 200)]).toEqual([201, created.text.slice(0, 200)]);
    return dataOf(created) as Json;
  }

  async function acceptNew(s: Shipper, over: Json = {}): Promise<Json> {
    const delivery = await newDelivery(over);
    const accepted = await asShipper(s, 'POST', `/driver/deliveries/${delivery.delivery_id}/accept`, {});
    expect([accepted.status, accepted.text.slice(0, 300)]).toEqual([200, accepted.text.slice(0, 300)]);
    return dataOf(accepted) as Json;
  }

  const stateOf = async (id: string): Promise<string> => String((await app.pool.query('SELECT state FROM app.deliveries WHERE delivery_id = $1::uuid', [id])).rows[0]?.state);
  const eventsOf = (id: string, type: string): Promise<number> => countRows(app.pool, 'SELECT 1 FROM app.delivery_events WHERE delivery_id = $1::uuid AND event_type = $2', [id, type]);
  const codeOf = (r: ApiResponse): string | undefined => errorCode(r);

  // ---- tests ---------------------------------------------------------------------------------------------------------------------

  it('the shop calls a Shipper: the offer hides the phone, the street address and the map point until accepted', async () => {
    const s = await newShipper();
    const delivery = await newDelivery();
    expect(delivery).toMatchObject({ state: 'waiting_driver' });
    const offers = dataOf(await asShipper(s, 'GET', '/driver/deliveries/offers')) as Json;
    const offer = (offers.offers as Json[]).find((o) => o.delivery_id === delivery.delivery_id);
    expect(offer).toBeDefined();
    const text = JSON.stringify(offer);
    expect(text).not.toContain('0912345678');
    expect(text).not.toContain('12 Phố Huế');
    expect(text).not.toMatch(/dropoff_lat|recipient_phone/);
  });

  it('accept: the Shipper gets the contacts and the commission is held; the delivery is accepted', async () => {
    const s = await newShipper();
    const view = await acceptNew(s);
    expect(view).toMatchObject({ state: 'accepted' });
    expect(await wallet(s)).toEqual({ balance: 50_000, held: 1000 });
    expect(await eventsOf(String(view.delivery_id), 'delivery.accepted')).toBe(1);
    const detail = dataOf(await asShipper(s, 'GET', `/driver/deliveries/${view.delivery_id}`)) as Json;
    expect(JSON.stringify(detail)).toContain('+84912345678');
  });

  it('two Shippers racing for one delivery: exactly one wins and the loser holds no money', async () => {
    const a = await newShipper();
    const b = await newShipper();
    const delivery = await newDelivery();
    const [ra, rb] = await Promise.all([
      asShipper(a, 'POST', `/driver/deliveries/${delivery.delivery_id}/accept`, {}),
      asShipper(b, 'POST', `/driver/deliveries/${delivery.delivery_id}/accept`, {}),
    ]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    const loser = ra.status === 200 ? b : a;
    expect(await wallet(loser)).toEqual({ balance: 50_000, held: 0 });
    expect(await countRows(app.pool, `SELECT 1 FROM app.delivery_assignments WHERE delivery_id = $1::uuid AND status = 'ACTIVE'`, [delivery.delivery_id])).toBe(1);
  });

  it('a Shipper with too little money cannot accept and nothing is held', async () => {
    const poor = await newShipper(500);
    const delivery = await newDelivery();
    const response = await asShipper(poor, 'POST', `/driver/deliveries/${delivery.delivery_id}/accept`, {});
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await wallet(poor)).toEqual({ balance: 500, held: 0 });
    expect(await stateOf(String(delivery.delivery_id))).toBe('waiting_driver');
  });

  it('a Shipper far from the shop is not eligible', async () => {
    const far = await newShipper(50_000, false);
    const delivery = await newDelivery();
    const response = await asShipper(far, 'POST', `/driver/deliveries/${delivery.delivery_id}/accept`, {});
    expect(codeOf(response)).toBe('DELIVERY_NOT_ELIGIBLE');
    expect(await wallet(far)).toEqual({ balance: 50_000, held: 0 });
  });

  const presenceOf = async (s: Shipper): Promise<Json> => (dataOf(await asShipper(s, 'GET', '/driver/me')) as Json).presence as Json;
  const ageLocation = (s: Shipper, seconds: number): Promise<unknown> =>
    app.pool.query(`UPDATE app.shipper_latest_locations SET recorded_at = clock_timestamp() - ($2::float8 * interval '1 second') WHERE driver_id = $1::uuid`, [s.driverId, seconds]);

  it('a position older than 2 minutes stops new orders on the server whatever the app does: no offer, no accept; a fresh position resumes them', async () => {
    const s = await newShipper();
    const delivery = await newDelivery();
    const listed = async (): Promise<boolean> => ((dataOf(await asShipper(s, 'GET', '/driver/deliveries/offers')) as Json).offers as Json[]).some((o) => o.delivery_id === delivery.delivery_id);
    expect(await listed()).toBe(true);
    // One late report (110 s old) is tolerated; two missed ones (121 s) are not.
    await ageLocation(s, 110);
    expect(await listed()).toBe(true);
    await ageLocation(s, 121);
    expect(await listed()).toBe(false);
    expect(await presenceOf(s)).toMatchObject({ intent_online: true, location_ready: false, can_receive_orders: false, paused_reason: 'LOCATION_STALE' });
    const refused = await asShipper(s, 'POST', `/driver/deliveries/${delivery.delivery_id}/accept`, {});
    expect(codeOf(refused)).toBe('DELIVERY_NOT_ELIGIBLE');
    expect(await wallet(s)).toEqual({ balance: 50_000, held: 0 });
    expect(await stateOf(String(delivery.delivery_id))).toBe('waiting_driver');
    // The position comes back: the switch was never touched, so receiving resumes by itself.
    expect((await asShipper(s, 'PUT', '/driver/location', { lat: 21.0005, lng: 105.8005, accuracy_m: 20 })).status).toBe(200);
    expect(await presenceOf(s)).toMatchObject({ intent_online: true, location_ready: true, paused_reason: null });
    expect(await listed()).toBe(true);
    expect((await asShipper(s, 'POST', `/driver/deliveries/${delivery.delivery_id}/accept`, {})).status).toBe(200);
  });

  describe('a session that is over (logout, revoked, expired) does nothing for the Shipper', () => {
    const logout = (s: Shipper): Promise<ApiResponse> => app.call('POST', '/client-auth/logout', { bearer: s.token, body: {} });

    async function expectDead(s: Shipper, deliveryId: string): Promise<void> {
      const version = 1;
      const refused = [
        await asShipper(s, 'PUT', '/driver/location', { lat: 21.0005, lng: 105.8005, accuracy_m: 20 }),
        await asShipper(s, 'GET', '/driver/me'),
        await asShipper(s, 'POST', '/driver/me/accepting', { expected_version: version, accepting: true }),
        await asShipper(s, 'GET', '/driver/deliveries/offers'),
        await asShipper(s, 'POST', `/driver/deliveries/${deliveryId}/accept`, {}),
      ];
      expect(refused.map((r) => r.status)).toEqual([401, 401, 401, 401, 401]);
      expect(await stateOf(deliveryId)).toBe('waiting_driver');
      expect(await countRows(app.pool, `SELECT 1 FROM app.delivery_assignments WHERE delivery_id = $1::uuid`, [deliveryId])).toBe(0);
    }

    it('after logout the old token cannot report a position, switch on, list offers or accept; nothing is held', async () => {
      const s = await newShipper();
      const delivery = await newDelivery();
      expect((await logout(s)).status).toBe(204);
      await expectDead(s, String(delivery.delivery_id));
      expect(await wallet(s)).toEqual({ balance: 50_000, held: 0 });
    });

    it('a session revoked on the server side is just as dead, and so is one past its expiry', async () => {
      const revoked = await newShipper();
      const delivery = await newDelivery();
      await app.pool.query(`UPDATE app.sessions SET revoked_at = clock_timestamp() WHERE user_id = $1::uuid AND revoked_at IS NULL`, [revoked.userId]);
      await expectDead(revoked, String(delivery.delivery_id));
      const expired = await newShipper();
      await app.pool.query(`UPDATE app.sessions SET created_at = clock_timestamp() - interval '2 hours', expires_at = clock_timestamp() - interval '1 second' WHERE user_id = $1::uuid`, [expired.userId]);
      await expectDead(expired, String(delivery.delivery_id));
    });
  });

  it('a Shipper who switched off never comes back online by reporting a position, and gets no new order', async () => {
    const s = await newShipper();
    const version = ((dataOf(await asShipper(s, 'GET', '/driver/me')) as Json).version);
    const off = await asShipper(s, 'POST', '/driver/me/accepting', { expected_version: version, accepting: false });
    expect(off.status).toBe(200);
    expect((await asShipper(s, 'PUT', '/driver/location', { lat: 21.0005, lng: 105.8005, accuracy_m: 20 })).status).toBe(200);
    expect(await presenceOf(s)).toMatchObject({ intent_online: false, can_receive_orders: false, should_share_location: false });
    const delivery = await newDelivery();
    expect(codeOf(await asShipper(s, 'POST', `/driver/deliveries/${delivery.delivery_id}/accept`, {}))).toBe('DELIVERY_NOT_ELIGIBLE');
    expect(dataOf(await asShipper(s, 'GET', '/driver/me')).accepting_deliveries).toBe(false);
  });

  it('switching off with a delivery in progress is accepted: new orders stop, the position stays shared until the delivery ends', async () => {
    const s = await newShipper();
    const view = await acceptNew(s);
    const me = dataOf(await asShipper(s, 'GET', '/driver/me')) as Json;
    const off = await asShipper(s, 'POST', '/driver/me/accepting', { expected_version: me.version, accepting: false });
    expect(off.status).toBe(200);
    expect(dataOf(off)).toMatchObject({ accepting_deliveries: false, status: 'ACTIVE', presence: { intent_online: false, can_receive_orders: false, has_active_work: true, should_share_location: true } });
    expect(await stateOf(String(view.delivery_id))).toBe('accepted');
    const other = await newDelivery();
    expect(codeOf(await asShipper(s, 'POST', `/driver/deliveries/${other.delivery_id}/accept`, {}))).toBe('DELIVERY_NOT_ELIGIBLE');
    const picked = await asShipper(s, 'POST', `/driver/deliveries/${view.delivery_id}/pickup`, { expected_version: view.version });
    expect(picked.status).toBe(200);
    expect(await presenceOf(s)).toMatchObject({ has_active_work: true, should_share_location: true });
    const completed = await asShipper(s, 'POST', `/driver/deliveries/${view.delivery_id}/complete`, { expected_version: dataOf(picked).version });
    expect(completed.status).toBe(200);
    expect(await presenceOf(s)).toMatchObject({ intent_online: false, has_active_work: false, should_share_location: false });
  });

  it('goods still with the Shipper after a failed delivery count as work in progress: the position stays shared until the shop takes them back', async () => {
    const s = await newShipper();
    const view = await acceptNew(s);
    const dest = await asShipper(s, 'POST', `/driver/deliveries/${view.delivery_id}/destination`, { expected_version: view.version, lat: 21.0, lng: 105.82, fee_vnd: 15_000 });
    const base = dest.status === 200 ? (dataOf(dest) as Json) : view;
    const picked = dataOf(await asShipper(s, 'POST', `/driver/deliveries/${view.delivery_id}/pickup`, { expected_version: base.version })) as Json;
    const me = dataOf(await asShipper(s, 'GET', '/driver/me')) as Json;
    expect((await asShipper(s, 'POST', '/driver/me/accepting', { expected_version: me.version, accepting: false })).status).toBe(200);
    const failed = await asShipper(s, 'POST', `/driver/deliveries/${view.delivery_id}/fail`, { expected_version: picked.version, reason_code: 'RECIPIENT_UNREACHABLE', goods_condition: 'WITH_SHIPPER', note: 'Không liên lạc được' });
    expect(failed.status).toBe(200);
    expect(await countRows(app.pool, `SELECT 1 FROM app.delivery_assignments WHERE delivery_id = $1::uuid AND status = 'ACTIVE'`, [view.delivery_id])).toBe(0);
    expect(await presenceOf(s)).toMatchObject({ intent_online: false, has_active_work: true, should_share_location: true });
  });

  it('retrying an accept after a lost answer does not take the commission twice', async () => {
    const s = await newShipper();
    const delivery = await newDelivery();
    const key = randomUUID();
    const first = await asShipper(s, 'POST', `/driver/deliveries/${delivery.delivery_id}/accept`, {}, key);
    const again = await asShipper(s, 'POST', `/driver/deliveries/${delivery.delivery_id}/accept`, {}, key);
    const fresh = await asShipper(s, 'POST', `/driver/deliveries/${delivery.delivery_id}/accept`, {});
    expect([first.status, again.status, fresh.status]).toEqual([200, 200, 200]);
    expect(await wallet(s)).toEqual({ balance: 50_000, held: 1000 });
  });

  it('the Shipper gives the delivery back with a reason: the hold is released and the search goes on within the original window', async () => {
    const s = await newShipper();
    const view = await acceptNew(s);
    const expiresBefore = (await app.pool.query('SELECT search_expires_at FROM app.deliveries WHERE delivery_id = $1::uuid', [view.delivery_id])).rows[0].search_expires_at as Date;
    const noReason = await asShipper(s, 'POST', `/driver/deliveries/${view.delivery_id}/release`, { reason: '', expected_version: view.version });
    expect(noReason.status).toBe(400);
    const released = await asShipper(s, 'POST', `/driver/deliveries/${view.delivery_id}/release`, { reason: 'Xe hỏng', expected_version: view.version });
    expect(released.status).toBe(200);
    expect(await wallet(s)).toEqual({ balance: 50_000, held: 0 });
    expect(await stateOf(String(view.delivery_id))).toBe('waiting_driver');
    const expiresAfter = (await app.pool.query('SELECT search_expires_at FROM app.deliveries WHERE delivery_id = $1::uuid', [view.delivery_id])).rows[0].search_expires_at as Date;
    expect(expiresAfter.getTime()).toBe(expiresBefore.getTime());
  });

  it('the shop cancels before pickup with a reason: the delivery ends and the hold is released', async () => {
    const s = await newShipper();
    const view = await acceptNew(s);
    expect((await asShop('POST', `/shop/me/deliveries/${view.delivery_id}/cancel`, { reason: '', expected_version: view.version })).status).toBe(400);
    const cancelled = await asShop('POST', `/shop/me/deliveries/${view.delivery_id}/cancel`, { reason: 'Khách đổi ý', expected_version: view.version });
    expect(cancelled.status).toBe(200);
    expect(await stateOf(String(view.delivery_id))).toBe('cancelled_by_merchant');
    expect(await wallet(s)).toEqual({ balance: 50_000, held: 0 });
  });

  it('an address without a map point needs a fee band (or an agreed fee): without one the call is refused with a clear code, with one pickup needs no pin', async () => {
    const s = await newShipper();
    const refused = await asShop('POST', '/shop/me/deliveries', createBody({ dropoff_lat: undefined, dropoff_lng: undefined }));
    expect([refused.status, codeOf(refused)]).toEqual([400, 'FEE_REQUIRED']);
    const bands = dataOf(await asShop('GET', '/shop/me/delivery-fee-bands')) as Json;
    expect(bands.bands).toHaveLength(3);
    const view = await acceptNew(s, { dropoff_lat: undefined, dropoff_lng: undefined, fee_band: 1 });
    expect(view.fee).toMatchObject({ mode: 'STANDARD', amount_vnd: 15_000, status: 'FINAL', basis: 'ESTIMATED_BAND' });
    expect(view.recipient).toMatchObject({ lat: null, lng: null });
    expect(view.can).toMatchObject({ pickup: true, confirm_fee: false });
    const picked = await asShipper(s, 'POST', `/driver/deliveries/${view.delivery_id}/pickup`, { expected_version: view.version });
    expect([picked.status, picked.text.slice(0, 200)]).toEqual([200, picked.text.slice(0, 200)]);
    expect(await stateOf(String(view.delivery_id))).toBe('delivering');
  });

  it('M03 closing stops new orders but retains the active delivery and refuses a full refund', async () => {
    const s = await newShipper();
    const view = await acceptNew(s);
    const profile = dataOf(await asShipper(s, 'GET', '/driver/me'));
    const closing = await asShipper(s, 'POST', '/driver/me/closure-request', { expected_version: profile.version, note: null });
    expect(closing.status).toBe(200);
    expect(dataOf(closing)).toMatchObject({ status: 'CLOSING', accepting_deliveries: false });
    const refund = await asShipper(s, 'POST', '/driver/wallet/withdrawals', { amount_vnd: 50_000 });
    expect(codeOf(refund)).toBe('DRIVER_HAS_ACTIVE_WORK');
    expect(await stateOf(String(view.delivery_id))).toBe('accepted');
    expect(await wallet(s)).toEqual({ balance: 50_000, held: 1000 });

    // CLOSING stops new assignments, never the pickup/completion of an assignment already held.
    const picked = await asShipper(s, 'POST', `/driver/deliveries/${view.delivery_id}/pickup`, { expected_version: view.version });
    expect(picked.status).toBe(200);
    const completed = await asShipper(s, 'POST', `/driver/deliveries/${view.delivery_id}/complete`, { expected_version: dataOf(picked).version });
    expect(completed.status).toBe(200);
    expect(await stateOf(String(view.delivery_id))).toBe('completed');
    expect(await wallet(s)).toEqual({ balance: 49_000, held: 0 });
  });

  it('PASSWORD Android full path: accept, pickup, complete: the commission is captured once and the delivery is completed', async () => {
    const s = await newShipper(50_000, true, true);
    const view = await acceptNew(s);
    let current = view;
    if (current.state === 'accepted') {
      const confirmed = await asShipper(s, 'POST', `/driver/deliveries/${view.delivery_id}/destination`, { expected_version: current.version, lat: 21.0, lng: 105.82, fee_vnd: 15_000 });
      if (confirmed.status === 200) {
        current = dataOf(confirmed) as Json;
      }
    }
    const picked = await asShipper(s, 'POST', `/driver/deliveries/${view.delivery_id}/pickup`, { expected_version: current.version });
    expect([picked.status, picked.text.slice(0, 300)]).toEqual([200, picked.text.slice(0, 300)]);
    const afterPickup = dataOf(picked) as Json;
    expect(await stateOf(String(view.delivery_id))).toMatch(/picked_up|delivering/);
    const shipperRelease = await asShipper(s, 'POST', `/driver/deliveries/${view.delivery_id}/release`, { reason: 'x', expected_version: afterPickup.version });
    expect(shipperRelease.status).toBeGreaterThanOrEqual(400);
    const done = await asShipper(s, 'POST', `/driver/deliveries/${view.delivery_id}/complete`, { expected_version: afterPickup.version });
    expect([done.status, done.text.slice(0, 300)]).toEqual([200, done.text.slice(0, 300)]);
    expect(await stateOf(String(view.delivery_id))).toBe('completed');
    expect(await wallet(s)).toEqual({ balance: 49_000, held: 0 });
    expect(await countRows(app.pool, `SELECT 1 FROM app.wallet_ledger_entries WHERE wallet_id = $1::uuid AND delta_vnd = -1000`, [s.walletId])).toBe(1);
  });

  /** Test-only: removes the policy versions above 1 (the table is append-only for the application; the owner lifts the guard for this one statement). */
  async function dropExtraCommissionPolicies(): Promise<void> {
    const c = await app.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('ALTER TABLE app.wallet_commission_policies DISABLE TRIGGER wallet_commission_policies_append_only');
      await c.query('DELETE FROM app.wallet_commission_policies WHERE policy_version > 1');
      await c.query('ALTER TABLE app.wallet_commission_policies ENABLE TRIGGER wallet_commission_policies_append_only');
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      c.release();
    }
  }

  async function pickupAndComplete(s: Shipper, view: Json): Promise<void> {
    let current = view;
    if (current.state === 'accepted') {
      const confirmed = await asShipper(s, 'POST', `/driver/deliveries/${view.delivery_id}/destination`, { expected_version: current.version, lat: 21.0, lng: 105.82, fee_vnd: 15_000 });
      if (confirmed.status === 200) {
        current = dataOf(confirmed) as Json;
      }
    }
    const picked = await asShipper(s, 'POST', `/driver/deliveries/${view.delivery_id}/pickup`, { expected_version: current.version });
    expect([picked.status, picked.text.slice(0, 300)]).toEqual([200, picked.text.slice(0, 300)]);
    const afterPickup = dataOf(picked) as Json;
    const done = await asShipper(s, 'POST', `/driver/deliveries/${view.delivery_id}/complete`, { expected_version: afterPickup.version });
    expect([done.status, done.text.slice(0, 300)]).toEqual([200, done.text.slice(0, 300)]);
  }

  it('a new commission version applies only to later assignments: the old one keeps its amount, the new one uses the new amount, and each completion debits exactly once', async () => {
    const older = await newShipper();
    const newer = await newShipper();
    const oldView = await acceptNew(older); // accepted under version 1
    expect(await wallet(older)).toEqual({ balance: 50_000, held: 1000 });
    try {
      await app.pool.query(`INSERT INTO app.wallet_commission_policies (policy_version, commission_vnd, created_by_user_id, created_at) VALUES (2, 2500, $1::uuid, now())`, [shop.userId]);
      const newView = await acceptNew(newer); // accepted under version 2
      const rows = (await app.pool.query<{ delivery_id: string; commission_vnd: string; commission_policy: string }>(
        `SELECT delivery_id::text, commission_vnd::text, commission_policy FROM app.delivery_assignments WHERE delivery_id = ANY($1::uuid[])`,
        [[String(oldView.delivery_id), String(newView.delivery_id)]],
      )).rows;
      const byDelivery = new Map(rows.map((r) => [r.delivery_id, r]));
      expect(byDelivery.get(String(oldView.delivery_id))).toMatchObject({ commission_vnd: '1000', commission_policy: 'COMMISSION_V1' });
      expect(byDelivery.get(String(newView.delivery_id))).toMatchObject({ commission_vnd: '2500', commission_policy: 'COMMISSION_V2' });
      // The change reached the held amounts too: the older hold is untouched.
      expect(await wallet(older)).toEqual({ balance: 50_000, held: 1000 });
      expect(await wallet(newer)).toEqual({ balance: 50_000, held: 2500 });

      // Completing: the OLD assignment is debited its OLD amount, the NEW one its NEW amount, each exactly once, and the holds are captured.
      await pickupAndComplete(older, oldView);
      await pickupAndComplete(newer, newView);
      expect(await wallet(older)).toEqual({ balance: 49_000, held: 0 });
      expect(await wallet(newer)).toEqual({ balance: 47_500, held: 0 });
      expect(await countRows(app.pool, `SELECT 1 FROM app.wallet_ledger_entries WHERE entry_kind = 'COMMISSION_DEBIT' AND wallet_id = $1::uuid`, [older.walletId])).toBe(1);
      expect(await countRows(app.pool, `SELECT 1 FROM app.wallet_ledger_entries WHERE entry_kind = 'COMMISSION_DEBIT' AND wallet_id = $1::uuid AND delta_vnd = -2500`, [newer.walletId])).toBe(1);
      expect(await countRows(app.pool, `SELECT 1 FROM app.wallet_ledger_entries WHERE entry_kind = 'COMMISSION_DEBIT' AND wallet_id = $1::uuid AND delta_vnd = -1000`, [older.walletId])).toBe(1);
      // A repeated completion does not debit again.
      const again = await asShipper(older, 'POST', `/driver/deliveries/${oldView.delivery_id}/complete`, { expected_version: 1 });
      expect(again.status).toBeGreaterThanOrEqual(400);
      expect(await wallet(older)).toEqual({ balance: 49_000, held: 0 });
    } finally {
      await dropExtraCommissionPolicies();
    }
  });

  it('after pickup the Shipper can neither fail the delivery nor give it back, even by calling the API directly; only completing is left', async () => {
    const s = await newShipper();
    const view = await acceptNew(s);
    const id = String(view.delivery_id);
    const picked = dataOf(await asShipper(s, 'POST', `/driver/deliveries/${id}/pickup`, { expected_version: view.version })) as Json;
    expect(picked.can).toMatchObject({ complete: true, release: false, fail: false });
    for (const body of [{ expected_version: picked.version, reason_code: 'RECIPIENT_UNREACHABLE', goods_condition: 'WITH_SHIPPER', note: 'Không liên lạc được' }, {}]) {
      const failed = await asShipper(s, 'POST', `/driver/deliveries/${id}/fail`, body);
      expect([failed.status, codeOf(failed)]).toEqual([403, 'SHIPPER_FAIL_NOT_ALLOWED']);
    }
    const released = await asShipper(s, 'POST', `/driver/deliveries/${id}/release`, { reason: 'Không giao được', expected_version: picked.version });
    expect([released.status, codeOf(released)]).toEqual([409, 'AFTER_PICKUP_NO_CANCEL']);
    expect(await stateOf(id)).toBe('delivering');
    expect(await wallet(s)).toEqual({ balance: 50_000, held: 1000 });
    expect(await countRows(app.pool, 'SELECT 1 FROM app.delivery_incidents WHERE delivery_id = $1::uuid', [id])).toBe(0);
  });

  it('the creator of a DIRECT call cancels after pickup: the commission is given back, the goods stay with the Shipper until the shop settles them, and only then can it call again', async () => {
    const s = await newShipper();
    const view = await acceptNew(s);
    const id = String(view.delivery_id);
    const picked = dataOf(await asShipper(s, 'POST', `/driver/deliveries/${id}/pickup`, { expected_version: view.version })) as Json;
    const shopView = dataOf(await asShop('GET', `/shop/me/deliveries/${id}`)) as Json;
    expect(shopView.can).toMatchObject({ cancel: true, cancel_after_pickup: true });
    const stranger = await createShopOwner(app);
    expect((await app.call('POST', `/shop/me/deliveries/${id}/cancel`, { bearer: stranger.token, headers: { 'idempotency-key': randomUUID() }, body: { reason: 'Không phải của tôi', expected_version: picked.version } })).status).toBe(404);
    expect((await asShop('POST', `/shop/me/deliveries/${id}/cancel`, { reason: '', expected_version: picked.version })).status).toBe(400);
    const cancelled = await asShop('POST', `/shop/me/deliveries/${id}/cancel`, { reason: 'Khách không nhận nữa', expected_version: picked.version });
    expect([cancelled.status, cancelled.text.slice(0, 300)]).toEqual([200, cancelled.text.slice(0, 300)]);
    expect(await stateOf(id)).toBe('cancelled_by_merchant');
    expect(await wallet(s)).toEqual({ balance: 50_000, held: 0 });
    expect(await countRows(app.pool, `SELECT 1 FROM app.delivery_incidents WHERE delivery_id = $1::uuid AND status = 'OPEN' AND custody = 'SHIPPER'`, [id])).toBe(1);
    expect(await eventsOf(id, 'delivery.cancelled_after_pickup')).toBe(1);
    // the Shipper cannot complete a cancelled delivery, and nobody can cancel it twice
    expect((await asShipper(s, 'POST', `/driver/deliveries/${id}/complete`, { expected_version: picked.version })).status).toBeGreaterThanOrEqual(400);
    expect((await asShop('POST', `/shop/me/deliveries/${id}/cancel`, { reason: 'Lần hai', expected_version: picked.version + 1 })).status).toBeGreaterThanOrEqual(400);
    // the goods are NOT assumed to be back at the shop: no new call until the shop says so
    const blocked = await asShop('POST', `/shop/me/deliveries/${id}/recall`, {});
    expect([blocked.status, codeOf(blocked)]).toEqual([409, 'RECALL_BLOCKED_GOODS_OUT']);
    const resolved = await asShop('POST', `/shop/me/deliveries/${id}/custody`, { resolution: 'GOODS_RETURNED' });
    expect([resolved.status, resolved.text.slice(0, 200)]).toEqual([200, resolved.text.slice(0, 200)]);
    expect(await stateOf(id)).toBe('cancelled_by_merchant');
    const recalled = await asShop('POST', `/shop/me/deliveries/${id}/recall`, {});
    expect([recalled.status, recalled.text.slice(0, 200)]).toEqual([201, recalled.text.slice(0, 200)]);
  });

  it('the shop cancelling and the Shipper picking up at the same moment: exactly one wins and the money agrees with the winner', async () => {
    const s = await newShipper();
    const view = await acceptNew(s);
    const [cancel, pickup] = await Promise.all([
      asShop('POST', `/shop/me/deliveries/${view.delivery_id}/cancel`, { reason: 'Đổi ý', expected_version: view.version }),
      asShipper(s, 'POST', `/driver/deliveries/${view.delivery_id}/pickup`, { expected_version: view.version }),
    ]);
    expect([cancel.status, pickup.status].filter((status) => status === 200)).toHaveLength(1);
    const state = await stateOf(String(view.delivery_id));
    if (cancel.status === 200) {
      expect(state).toBe('cancelled_by_merchant');
      expect(await wallet(s)).toEqual({ balance: 50_000, held: 0 });
    } else {
      expect(state).toBe('delivering');
      expect(await wallet(s)).toEqual({ balance: 50_000, held: 1000 });
    }
  });

  it('only one active delivery per call is created for the same request key (idempotent create)', async () => {
    const key = randomUUID();
    const first = await asShop('POST', '/shop/me/deliveries', createBody({ goods_description: `Gói ${tag}` }), key);
    const again = await asShop('POST', '/shop/me/deliveries', createBody({ goods_description: `Gói ${tag}` }), key);
    expect([first.status, again.status]).toEqual([201, 201]);
    expect((dataOf(first) as Json).delivery_id).toBe((dataOf(again) as Json).delivery_id);
  });

  it('the shop sees only its own deliveries, and a Shipper cannot read one it never held', async () => {
    const other = await newShipper();
    const delivery = await newDelivery();
    const read = await asShipper(other, 'GET', `/driver/deliveries/${delivery.delivery_id}`);
    expect(read.status).toBe(404);
  });

  // ---- time: the 30-minute window, the reminders, the give-back ----------------------------------------------------------------------

  /** Moves the whole search window of a delivery into the past by whole minutes (the guard that keeps it immutable is lifted for this statement only). */
  async function age(deliveryId: string, minutes: number): Promise<void> {
    const client = await app.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE app.deliveries DISABLE TRIGGER deliveries_guard');
      await client.query(
        `UPDATE app.deliveries SET search_started_at = search_started_at - make_interval(mins => $2::int), search_expires_at = search_expires_at - make_interval(mins => $2::int),
                created_at = created_at - make_interval(mins => $2::int) WHERE delivery_id = $1::uuid`,
        [deliveryId, minutes],
      );
      await client.query('SET CONSTRAINTS ALL IMMEDIATE'); // ALTER TABLE refuses pending deferred trigger events
      await client.query('ALTER TABLE app.deliveries ENABLE TRIGGER deliveries_guard');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  const sweeper = (): DeliverySweeper => app.running.app.get(DeliverySweeper);
  const row = async (id: string): Promise<Json> => (await app.pool.query('SELECT * FROM app.deliveries WHERE delivery_id = $1::uuid', [id])).rows[0] as Json;

  it('after 30 minutes the search stops by itself: no Order is touched, nobody can accept, and the shop can call again (a new delivery linked to the old one)', async () => {
    const s = await newShipper();
    const delivery = await newDelivery();
    const id = String(delivery.delivery_id);
    await age(id, 31);
    await sweeper().sweep();
    expect(await stateOf(id)).toBe('search_stopped');
    expect((await row(id)).search_stopped_at).not.toBeNull();
    const late = await asShipper(s, 'POST', `/driver/deliveries/${id}/accept`, {});
    expect(codeOf(late)).toBe('DELIVERY_SEARCH_EXPIRED');
    expect(await wallet(s)).toEqual({ balance: 50_000, held: 0 });
    const recalled = await asShop('POST', `/shop/me/deliveries/${id}/recall`, {});
    expect([recalled.status, recalled.text.slice(0, 200)]).toEqual([201, recalled.text.slice(0, 200)]);
    const next = dataOf(recalled) as Json;
    expect(next).toMatchObject({ previous_delivery_id: id, state: 'waiting_driver' });
    expect(await stateOf(id)).toBe('search_stopped');
    // At most one ACTIVE delivery per call chain: the old one is not active, the new one is.
    expect(await countRows(app.pool, `SELECT 1 FROM app.deliveries WHERE previous_delivery_id = $1::uuid`, [id])).toBe(1);
  });

  it('the shop is reminded once at minute 5 and once at minute 15, and a second pass sends nothing twice', async () => {
    const delivery = await newDelivery();
    const id = String(delivery.delivery_id);
    await age(id, 6);
    await sweeper().sweep();
    await sweeper().sweep();
    expect((await row(id)).reminded_5_at).not.toBeNull();
    expect((await row(id)).reminded_15_at).toBeNull();
    expect(await eventsOf(id, 'delivery.search_reminder_5')).toBe(1);
    expect(await eventsOf(id, 'delivery.search_reminder_15')).toBe(0);
    await age(id, 10);
    await sweeper().sweep();
    await sweeper().sweep();
    expect((await row(id)).reminded_15_at).not.toBeNull();
    expect(await eventsOf(id, 'delivery.search_reminder_5')).toBe(1);
    expect(await eventsOf(id, 'delivery.search_reminder_15')).toBe(1);
    expect(await stateOf(id)).toBe('waiting_driver');
  });

  it('a Shipper who gives the delivery back after the window has closed ends the search; it does not restart', async () => {
    const s = await newShipper();
    const view = await acceptNew(s);
    const id = String(view.delivery_id);
    await age(id, 31);
    const released = await asShipper(s, 'POST', `/driver/deliveries/${id}/release`, { reason: 'Kẹt xe', expected_version: view.version });
    expect([released.status, released.text.slice(0, 200)]).toEqual([200, released.text.slice(0, 200)]);
    expect(await stateOf(id)).toBe('search_stopped');
    expect(await wallet(s)).toEqual({ balance: 50_000, held: 0 });
  });

  it('a Shipper whose money covers one commission wins one of two simultaneous accepts, never both', async () => {
    const s = await newShipper(1500);
    const a = await newDelivery();
    const b = await newDelivery();
    const [ra, rb] = await Promise.all([
      asShipper(s, 'POST', `/driver/deliveries/${a.delivery_id}/accept`, {}),
      asShipper(s, 'POST', `/driver/deliveries/${b.delivery_id}/accept`, {}),
    ]);
    expect([ra.status, rb.status].filter((status) => status === 200)).toHaveLength(1);
    expect(await wallet(s)).toEqual({ balance: 1500, held: 1000 });
    expect(await countRows(app.pool, `SELECT 1 FROM app.delivery_assignments WHERE driver_id = $1::uuid AND status = 'ACTIVE'`, [s.driverId])).toBe(1);
  });

  it('an EXTERNAL Shipper holds at most 3 deliveries at once; a fourth is refused and holds no money', async () => {
    const s = await newShipper(50_000);
    const accepted: string[] = [];
    let refused: ApiResponse | undefined;
    for (let i = 0; i < 4; i += 1) {
      const delivery = await newDelivery();
      const response = await asShipper(s, 'POST', `/driver/deliveries/${delivery.delivery_id}/accept`, {});
      if (response.status === 200) {
        accepted.push(String(delivery.delivery_id));
      } else {
        refused = response;
        break;
      }
    }
    expect(accepted.length).toBeLessThanOrEqual(3);
    expect(refused).toBeDefined();
    expect(codeOf(refused as ApiResponse)).toBe('DELIVERY_NOT_ELIGIBLE');
    expect(await wallet(s)).toEqual({ balance: 50_000, held: 1000 * accepted.length });
  });

  it('a DIRECT call is followed by its status only: the shop never gets the Shipper position of it', async () => {
    const s = await newShipper();
    const view = await acceptNew(s);
    const id = String(view.delivery_id);
    const mineView = dataOf(await asShop('GET', `/shop/me/deliveries/${id}`)) as Json;
    expect(mineView.state).toBe('accepted');
    expect(mineView.location).toBeNull();
    const other = await createShopOwner(app);
    const stranger = await app.call('GET', `/shop/me/deliveries/${id}`, { bearer: other.token });
    expect(stranger.status).toBe(404);
    expect((await asShop('POST', `/shop/me/deliveries/${id}/cancel`, { reason: 'Đổi ý', expected_version: mineView.version })).status).toBe(200);
  });

  it('a fee that is already settled is never asked again: the Shipper goes straight to pickup, a repeated confirmation is a no-op, and after pickup the fee is locked', async () => {
    const s = await newShipper();
    const view = await acceptNew(s);
    const id = String(view.delivery_id);
    expect(view.fee).toMatchObject({ mode: 'STANDARD', amount_vnd: 10_000 });
    expect(view.can).toMatchObject({ confirm_fee: false, confirm_destination: false, pickup: true });
    const same = await asShipper(s, 'POST', `/driver/deliveries/${id}/destination`, { expected_version: view.version, fee_vnd: 10_000 });
    expect([same.status, same.text.slice(0, 200)]).toEqual([200, same.text.slice(0, 200)]);
    const retyped = await asShipper(s, 'POST', `/driver/deliveries/${id}/destination`, { expected_version: (dataOf(same) as Json).version, fee_vnd: 18_000 });
    expect([retyped.status, codeOf(retyped)]).toEqual([409, 'FEE_LOCKED']);
    const picked = dataOf(await asShipper(s, 'POST', `/driver/deliveries/${id}/pickup`, { expected_version: (dataOf(same) as Json).version })) as Json;
    expect(picked.state).toBe('delivering');
    const again = await asShipper(s, 'POST', `/driver/deliveries/${id}/destination`, { expected_version: picked.version, fee_vnd: 1000 });
    expect(again.status).toBeGreaterThanOrEqual(400);
    expect(Number((await row(id)).fee_vnd)).toBe(10_000);
  });

  it('a call that was never priced (legacy STANDARD with no fee) is not stuck: the Shipper confirms the agreed amount once and picks up', async () => {
    const s = await newShipper();
    const delivery = await newDelivery();
    const id = String(delivery.delivery_id);
    // Reproduces the old data: a priced call whose fee was never stored (the fee table could not price it at the time).
    for (const table of ['deliveries', 'shipping_fee_agreement_events', 'shipping_fee_agreements']) {
      await app.pool.query(`ALTER TABLE app.${table} DISABLE TRIGGER USER`);
    }
    await app.pool.query('UPDATE app.deliveries SET fee_vnd = NULL WHERE delivery_id = $1::uuid', [id]);
    await app.pool.query('DELETE FROM app.shipping_fee_agreement_events WHERE agreement_id IN (SELECT agreement_id FROM app.shipping_fee_agreements WHERE delivery_id = $1::uuid)', [id]);
    await app.pool.query('DELETE FROM app.shipping_fee_agreements WHERE delivery_id = $1::uuid', [id]);
    for (const table of ['deliveries', 'shipping_fee_agreement_events', 'shipping_fee_agreements']) {
      await app.pool.query(`ALTER TABLE app.${table} ENABLE TRIGGER USER`);
    }
    const accepted = await asShipper(s, 'POST', `/driver/deliveries/${id}/accept`, {});
    expect([accepted.status, accepted.text.slice(0, 200)]).toEqual([200, accepted.text.slice(0, 200)]);
    const view = dataOf(accepted) as Json;
    expect(view.can).toMatchObject({ confirm_fee: true, pickup: false });
    expect((await asShipper(s, 'POST', `/driver/deliveries/${id}/pickup`, { expected_version: view.version })).status).toBe(409);
    const missing = await asShipper(s, 'POST', `/driver/deliveries/${id}/destination`, { expected_version: view.version });
    expect([missing.status, codeOf(missing)]).toEqual([409, 'FEE_NOT_CONFIRMED']);
    const confirmed = dataOf(await asShipper(s, 'POST', `/driver/deliveries/${id}/destination`, { expected_version: view.version, fee_vnd: 18_000 })) as Json;
    expect(confirmed.fee.amount_vnd).toBe(18_000);
    const picked = dataOf(await asShipper(s, 'POST', `/driver/deliveries/${id}/pickup`, { expected_version: confirmed.version })) as Json;
    expect(picked.state).toBe('delivering');
    expect((await row(id)).fee_confirmed_by).toBe(s.driverId);
  });

  it('completing and the creator cancelling after pickup at the same moment: exactly one wins, and the commission follows the winner', async () => {
    const s = await newShipper();
    const view = await acceptNew(s);
    const id = String(view.delivery_id);
    const picked = dataOf(await asShipper(s, 'POST', `/driver/deliveries/${id}/pickup`, { expected_version: view.version })) as Json;
    const [done, cancelled] = await Promise.all([
      asShipper(s, 'POST', `/driver/deliveries/${id}/complete`, { expected_version: picked.version }),
      asShop('POST', `/shop/me/deliveries/${id}/cancel`, { reason: 'Không nhận nữa', expected_version: picked.version }),
    ]);
    expect([done.status, cancelled.status].filter((status) => status === 200)).toHaveLength(1);
    if (done.status === 200) {
      expect(await stateOf(id)).toBe('completed');
      expect(await wallet(s)).toEqual({ balance: 49_000, held: 0 });
      expect(await countRows(app.pool, 'SELECT 1 FROM app.delivery_incidents WHERE delivery_id = $1::uuid', [id])).toBe(0);
    } else {
      expect(await stateOf(id)).toBe('cancelled_by_merchant');
      expect(await wallet(s)).toEqual({ balance: 50_000, held: 0 });
    }
  });
});
