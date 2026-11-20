import { m14RouteAnswer } from './support/m14-fake-route';
import { randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { DeliveryRecorder } from '../../apps/backend/src/delivery/delivery-recorder';
import { DeliveryRepository } from '../../apps/backend/src/delivery/delivery-repository';
import { DeliverySweeper } from '../../apps/backend/src/delivery/delivery-sweeper';
import { FeeAnswerExpiry } from '../../apps/backend/src/delivery/fee-answer-expiry';
import { M14_ROUTING } from '../../apps/backend/src/delivery/m14-route-client';
import { OrderSweeper } from '../../apps/backend/src/orders/order-sweeper';
import { TransactionManager } from '../../apps/backend/src/transaction/transaction-manager';
import { ApiResponse, AuthApp, countRows, dataOf, obtainProof, PASSWORD, randomPhone, startAuthApp } from './support/auth-fixtures';
import { createLegacyDirectDelivery } from './support/legacy-direct-delivery';
import { createShopOwner, ShopOwner } from './support/shop-management-fixtures';

// Issue #414 (Owner 2026-11-20): a call of a Shipper WITHOUT an Order (DIRECT, and CUSTOMER courier calls) ends by the same stage marks as an
// ORDER's delivery: an accepted run that has not picked up up to its cancel time is cancelled by the system ONCE, through the existing cancel path
// (assignment ended, commission hold released, audit, transition). Goods that were picked up are never cancelled by the timer. The 5-minute pickup
// reminder stops after 3 reminders, also across a restart of the sweeper.

const TERMS = 'terms-20261114-v3';
const PRIVACY = 'privacy-20261114-v3';
const WEB_SHIP = { device_id: 'web-ship-0414', platform: 'WEB', app: 'SHIP' };
const WEB_FOOD = { device_id: 'web-food-0414', platform: 'WEB', app: 'FOOD' };
const tag = randomBytes(3).toString('hex').toUpperCase();
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Shipper {
  readonly userId: string;
  readonly token: string;
  readonly driverId: string;
  readonly walletId: string;
}

describe('Issue #414 — call without an Order: timer marks and pickup reminders', () => {
  let app: AuthApp;
  let router: http.Server;
  let shop: ShopOwner;
  const drivers: string[] = [];
  let addedPolicy = false;

  beforeAll(async () => {
    router = http.createServer((request, response) => {
      request.resume();
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(m14RouteAnswer(2.5, 420)));
    });
    await new Promise<void>((resolve) => router.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(router.address() as AddressInfo).port}`;
    app = await startAuthApp(
      {},
      { relaxTimeouts: true, configOverride: { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY } }, overrides: [{ provide: M14_ROUTING, useValue: { origin, timeoutMs: 3000 } }] },
    );
    shop = await createShopOwner(app);
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

  /** Removes exactly the rows this suite created (its shop's deliveries and the wallets of its Shippers). Errors are NOT swallowed. */
  async function cleanup(): Promise<void> {
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

  const asShipper = (s: Shipper, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<ApiResponse> =>
    app.call(method, path, { bearer: s.token, ...(method !== 'GET' ? { headers: { 'idempotency-key': randomUUID() } } : {}), ...(body === undefined ? {} : { body }) });

  /** An ACTIVE, accepting Shipper with a wallet and a fresh position near the shop. Same setup as the M07 suite. */
  async function newShipper(funds = 50_000): Promise<Shipper> {
    const phone = randomPhone();
    app.track(phone.normalized);
    const proof = await obtainProof(app, phone);
    const registered = await app.call('POST', '/client-auth/register', {
      headers: { 'idempotency-key': randomUUID() },
      body: { phone: phone.local, password: PASSWORD, verification_token: proof.proofToken, device: { ...WEB_FOOD }, full_name: `Shipper ${tag}`, consent: { terms_version: TERMS, privacy_version: PRIVACY } },
    });
    expect(registered.status).toBe(201);
    const userId = String(dataOf(registered).user_id);
    const loggedIn = await app.call('POST', '/client-auth/login', { headers: { 'idempotency-key': randomUUID() }, body: { phone: phone.local, password: PASSWORD, device: { ...WEB_SHIP } } });
    expect(loggedIn.status).toBe(200);
    const token = String(dataOf(loggedIn).access_token);
    const created = await app.call('POST', '/onboarding/driver', { bearer: token, headers: { 'idempotency-key': randomUUID() }, body: { full_name: `Shipper ${tag}`, plate_number: '59X1-414.14' } });
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
    const walletId = await fund(driverId, funds);
    drivers.push(driverId);
    const shipper: Shipper = { userId, token, driverId, walletId };
    const located = await asShipper(shipper, 'PUT', '/driver/location', { lat: 21.0005, lng: 105.8005, accuracy_m: 20 });
    expect([200, 204]).toContain(located.status);
    return shipper;
  }

  /** Test-only funding (the money-in path is not part of this suite): one ledger credit, the source gate lifted in one transaction. */
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

  const heldOf = async (s: Shipper): Promise<number> => Number((await app.pool.query<{ held_vnd: string }>('SELECT held_vnd FROM app.driver_wallets WHERE wallet_id = $1::uuid', [s.walletId])).rows[0]?.held_vnd);

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

  /** A DIRECT call by the shop; for CUSTOMER the record is turned into a customer courier call (test data only, as in the other suites). */
  async function newCall(source: 'DIRECT' | 'CUSTOMER'): Promise<string> {
    const id = await createLegacyDirectDelivery(app, shop, createBody());
    if (source === 'CUSTOMER') {
      const client = await app.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('ALTER TABLE app.deliveries DISABLE TRIGGER USER');
        await client.query(`UPDATE app.deliveries SET source = 'CUSTOMER', version = version + 1, updated_at = clock_timestamp() WHERE delivery_id = $1::uuid`, [id]);
        await client.query('ALTER TABLE app.deliveries ENABLE TRIGGER USER');
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
    return id;
  }

  async function acceptCall(s: Shipper, id: string): Promise<Json> {
    const accepted = await asShipper(s, 'POST', `/driver/deliveries/${id}/accept`, {});
    expect([accepted.status, accepted.text.slice(0, 300)]).toEqual([200, accepted.text.slice(0, 300)]);
    return dataOf(accepted) as Json;
  }

  /** Moves the snapshot's cancel time 1 minute into the past (test-only, the snapshot trigger is lifted for this statement). Only the ACTIVE assignment. */
  async function passCancelAt(deliveryId: string): Promise<void> {
    const client = await app.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE app.delivery_assignments DISABLE TRIGGER USER');
      await client.query(
        `UPDATE app.delivery_assignments SET timeout_snapshot = timeout_snapshot || jsonb_build_object(
            'cancel_at', to_char((clock_timestamp() - interval '1 minute') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            'warning_at', to_char((clock_timestamp() - interval '2 minutes') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
          WHERE delivery_id = $1::uuid AND status = 'ACTIVE'`,
        [deliveryId],
      );
      await client.query('ALTER TABLE app.delivery_assignments ENABLE TRIGGER USER');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Moves the accept and the last reminder 6 minutes into the past so the next pickup reminder is due (test-only). */
  async function makeReminderDue(deliveryId: string): Promise<void> {
    const client = await app.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE app.delivery_assignments DISABLE TRIGGER USER');
      await client.query(
        `UPDATE app.delivery_assignments SET accepted_at = accepted_at - interval '6 minutes', last_pickup_reminder_at = last_pickup_reminder_at - interval '6 minutes'
          WHERE delivery_id = $1::uuid AND status = 'ACTIVE'`,
        [deliveryId],
      );
      await client.query('ALTER TABLE app.delivery_assignments ENABLE TRIGGER USER');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  const stateOf = async (id: string): Promise<string> => String((await app.pool.query('SELECT state FROM app.deliveries WHERE delivery_id = $1::uuid', [id])).rows[0]?.state);
  const assignmentStatusOf = async (id: string): Promise<string> =>
    String((await app.pool.query('SELECT status FROM app.delivery_assignments WHERE delivery_id = $1::uuid ORDER BY accepted_at DESC LIMIT 1', [id])).rows[0]?.status);
  const eventsOf = (id: string, type: string): Promise<number> => countRows(app.pool, 'SELECT 1 FROM app.delivery_events WHERE delivery_id = $1::uuid AND event_type = $2', [id, type]);
  const timeoutTransitionsOf = (id: string): Promise<number> =>
    countRows(app.pool, `SELECT 1 FROM app.cancellation_transitions WHERE resource_type = 'deliveries' AND resource_id = $1::uuid AND source = 'timeout'`, [id]);

  const runOrderSweep = (): Promise<unknown> => app.running.app.get(OrderSweeper).sweep();

  for (const source of ['DIRECT', 'CUSTOMER'] as const) {
    describe(`${source} call without an Order`, () => {
      it('(a) accepted, not picked up and past the cancel time: cancelled by the system exactly once, the commission hold goes back', async () => {
        const s = await newShipper();
        const id = await newCall(source);
        const heldBefore = await heldOf(s);
        await acceptCall(s, id);
        expect(await heldOf(s)).toBeGreaterThan(heldBefore);
        await passCancelAt(id);

        await runOrderSweep();

        expect(await stateOf(id)).toBe('cancelled_by_system');
        expect(await assignmentStatusOf(id)).toBe('CANCELLED_BY_SYSTEM');
        expect(await eventsOf(id, 'delivery.cancelled_by_system')).toBe(1);
        expect(await timeoutTransitionsOf(id)).toBe(1);
        expect(await heldOf(s)).toBe(heldBefore);
      });

      it('(d) a second and third sweep change nothing: still one cancellation, one transition', async () => {
        const s = await newShipper();
        const id = await newCall(source);
        await acceptCall(s, id);
        await passCancelAt(id);

        await Promise.all([runOrderSweep(), runOrderSweep()]);
        await runOrderSweep();
        await app.running.app.get(DeliverySweeper).sweep();

        expect(await stateOf(id)).toBe('cancelled_by_system');
        expect(await eventsOf(id, 'delivery.cancelled_by_system')).toBe(1);
        expect(await timeoutTransitionsOf(id)).toBe(1);
      });

      it('(b) picked up before the cancel time: never cancelled by the timer, even when the marks are past', async () => {
        const s = await newShipper();
        const id = await newCall(source);
        const view = await acceptCall(s, id);
        // The fee is already fixed for a standard call, so the destination step is not needed (as in the M07 helper): straight to the pickup.
        const picked = await asShipper(s, 'POST', `/driver/deliveries/${id}/pickup`, { expected_version: view.version });
        expect([picked.status, picked.text.slice(0, 300)]).toEqual([200, picked.text.slice(0, 300)]);
        await passCancelAt(id);

        await runOrderSweep();
        await app.running.app.get(DeliverySweeper).sweep();

        expect(await stateOf(id)).toBe('delivering');
        expect(await eventsOf(id, 'delivery.cancelled_by_system')).toBe(0);
        expect(await timeoutTransitionsOf(id)).toBe(0);
      });

      it('(c) accepted and not yet past the cancel time: not cancelled', async () => {
        const s = await newShipper();
        const id = await newCall(source);
        await acceptCall(s, id);

        await runOrderSweep();
        await app.running.app.get(DeliverySweeper).sweep();

        expect(await stateOf(id)).toBe('accepted');
        expect(await assignmentStatusOf(id)).toBe('ACTIVE');
        expect(await timeoutTransitionsOf(id)).toBe(0);
      });

      it('(e) pickup reminders stop at 3 across many sweeps and across a restart of the sweeper', async () => {
        const s = await newShipper();
        const id = await newCall(source);
        await acceptCall(s, id);
        const sweeper = app.running.app.get(DeliverySweeper);
        // A fresh sweeper (as after a process restart): it keeps no state, the count lives in the recorded events.
        const nest = app.running.app;
        const restarted = new DeliverySweeper(nest.get(TransactionManager, { strict: false }), nest.get(DeliveryRepository, { strict: false }), nest.get(DeliveryRecorder, { strict: false }), nest.get(FeeAnswerExpiry, { strict: false }));

        for (let round = 1; round <= 5; round += 1) {
          await makeReminderDue(id);
          await sweeper.sweep();
          await restarted.sweep();
          await sweeper.sweep();
          expect(await eventsOf(id, 'delivery.pickup_reminder')).toBe(Math.min(round, 3));
        }
        expect(await stateOf(id)).toBe('accepted');
      });
    });
  }
});
