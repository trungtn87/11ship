import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from '@jest/globals';
import { ApiResponse, AuthApp, dataOf, obtainProof, PASSWORD, randomPhone } from './auth-fixtures';
import { createItemWithPicture, createCategory } from './menu-fixtures';

// M10 fixtures: a customer account on the 11Food app, a Shipper with a funded wallet and a position, the shop's weekly schedule, the dishes and the cleanup of
// the rows an Order test leaves (orders and deliveries are never deleted by the application, so a test removes exactly its own rows with the user triggers of
// those tables lifted for the statement). Everything goes through the real HTTP pipeline except the test-only wallet funding (the money-in path is M04).

export const TERMS = 'test-terms-20261011-v1';
export const PRIVACY = 'test-privacy-20261011-v1';
export const WEB_SHIP = { device_id: 'web-ship-0010', platform: 'WEB', app: 'SHIP' };
export const WEB_FOOD = { device_id: 'web-food-0010', platform: 'WEB', app: 'FOOD' };
export const tag = randomBytes(3).toString('hex').toUpperCase();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = Record<string, any>;

export interface Customer {
  readonly userId: string;
  readonly token: string;
  readonly phone: { local: string; normalized: string };
}

export interface Shipper {
  readonly userId: string;
  readonly token: string;
  readonly driverId: string;
  readonly walletId: string;
}

export async function newCustomer(app: AuthApp, name = `Khách ${tag}`): Promise<Customer> {
  const phone = randomPhone();
  app.track(phone.normalized);
  const proof = await obtainProof(app, phone);
  const registered = await app.call('POST', '/client-auth/register', {
    headers: { 'idempotency-key': randomUUID() },
    body: { phone: phone.local, password: PASSWORD, verification_token: proof.proofToken, device: { ...WEB_FOOD }, full_name: name, consent: { terms_version: TERMS, privacy_version: PRIVACY } },
  });
  expect(registered.status).toBe(201);
  const loggedIn = await app.call('POST', '/client-auth/login', { headers: { 'idempotency-key': randomUUID() }, body: { phone: phone.local, password: PASSWORD, device: { ...WEB_FOOD } } });
  expect(loggedIn.status).toBe(200);
  return { userId: String(dataOf(registered).user_id), token: String(dataOf(loggedIn).access_token), phone: { local: phone.local, normalized: phone.normalized } };
}

/** Open 24 hours every day: the shop is online now and at any wanted time. */
export async function openAllWeek(app: AuthApp, shopId: string): Promise<void> {
  await app.pool.query('DELETE FROM app.shop_business_hours WHERE shop_id = $1::uuid', [shopId]);
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    await app.pool.query(
      `INSERT INTO app.shop_business_hours (shop_id, weekday, start_minute, end_minute, end_day_offset) VALUES ($1::uuid, $2, 0, 1440, 0)`,
      [shopId, weekday],
    );
  }
}

/** Replaces the shop's schedule with exactly these intervals (weekday, start, end, endDayOffset). */
export async function setHours(app: AuthApp, shopId: string, intervals: readonly (readonly [number, number, number, number])[]): Promise<void> {
  await app.pool.query('DELETE FROM app.shop_business_hours WHERE shop_id = $1::uuid', [shopId]);
  for (const [weekday, start, end, offset] of intervals) {
    await app.pool.query(
      `INSERT INTO app.shop_business_hours (shop_id, weekday, start_minute, end_minute, end_day_offset) VALUES ($1::uuid, $2, $3, $4, $5)`,
      [shopId, weekday, start, end, offset],
    );
  }
}

export interface Dish {
  readonly itemId: string;
  readonly name: string;
  readonly price: number;
}

export async function newDish(app: AuthApp, shopToken: string, name: string, price: number): Promise<Dish> {
  const category = await createCategory(app.pool, `Nhóm M10 ${tag}`);
  const created = await createItemWithPicture(app, shopToken, { name, price_vnd: price, category_id: category });
  expect([created.status, created.text.slice(0, 200)]).toEqual([201, created.text.slice(0, 200)]);
  const item = (dataOf(created) as Json).item as Json;
  return { itemId: String(item.item_id), name, price };
}

/** An instant `days` days ahead at the given Vietnam wall-clock time (UTC+7, no daylight saving). */
export function vietnamInstant(days: number, hour: number, minute = 0): Date {
  const now = new Date(Date.now() + 7 * 3_600_000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days, hour - 7, minute));
}

/** ISO weekday (Monday = 1) of an instant on the Vietnam wall clock. */
export function vietnamWeekday(at: Date): number {
  const day = new Date(at.getTime() + 7 * 3_600_000).getUTCDay();
  return day === 0 ? 7 : day;
}

export async function newShipper(app: AuthApp, drivers: string[], funds = 50_000): Promise<Shipper> {
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
  expect(selected.status).toBe(200);
  const walletId = await fund(app, driverId, funds);
  drivers.push(driverId);
  const shipper: Shipper = { userId, token, driverId, walletId };
  const located = await app.call('PUT', '/driver/location', { bearer: token, headers: { 'idempotency-key': randomUUID() }, body: { lat: 21.0005, lng: 105.8005, accuracy_m: 20 } });
  expect([200, 204]).toContain(located.status);
  return shipper;
}

/** Test-only funding: the money-in path (M04-B2/B3) is not under test, so the ledger credit is written with the source gate lifted in ONE transaction. */
async function fund(app: AuthApp, driverId: string, amount: number): Promise<string> {
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

export async function walletOf(app: AuthApp, s: Shipper): Promise<{ balance: number; held: number }> {
  const row = (await app.pool.query<{ balance_vnd: string; held_vnd: string }>('SELECT balance_vnd, held_vnd FROM app.driver_wallets WHERE wallet_id = $1::uuid', [s.walletId])).rows[0];
  return { balance: Number(row?.balance_vnd), held: Number(row?.held_vnd) };
}

/** Moves the whole search window of a delivery into the past by whole minutes (the guard that keeps it immutable is lifted for this statement only). */
export async function ageDelivery(app: AuthApp, deliveryId: string, minutes: number): Promise<void> {
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE app.deliveries DISABLE TRIGGER deliveries_guard');
    await client.query(
      `UPDATE app.deliveries SET search_started_at = search_started_at - make_interval(mins => $2::int), search_expires_at = search_expires_at - make_interval(mins => $2::int),
              created_at = created_at - make_interval(mins => $2::int) WHERE delivery_id = $1::uuid`,
      [deliveryId, minutes],
    );
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('ALTER TABLE app.deliveries ENABLE TRIGGER deliveries_guard');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Removes the order, delivery and wallet rows of the given shops, Shippers and customers, in one transaction with the user triggers of those tables lifted (the
 * application never deletes them). The phones themselves are purged afterwards by app.close(). Errors are NOT swallowed.
 */
export async function cleanupOrders(app: AuthApp, input: { shopIds: readonly string[]; customerIds: readonly string[]; drivers: readonly string[]; userIds: readonly string[]; policyAdded?: boolean }): Promise<void> {
  const client = await app.pool.connect();
  const tables = [
    'order_events', 'order_items', 'orders', 'customer_carts', 'wallet_ledger_entries', 'wallet_holds', 'delivery_incidents', 'delivery_events', 'delivery_assignments', 'deliveries',
    'driver_wallets', 'shipping_fee_agreement_events', 'shipping_fee_agreements', 'shipping_fee_policy_versions', 'notifications', 'notification_pushes', 'notification_consumed_events', 'notification_reminders', 'notification_offer_rounds',
  ];
  try {
    await client.query('BEGIN');
    for (const table of tables) {
      await client.query(`ALTER TABLE app.${table} DISABLE TRIGGER USER`);
    }
    const shops = [...input.shopIds];
    const customers = [...input.customerIds];
    const drivers = [...input.drivers];
    const orders = `SELECT order_id FROM app.orders WHERE shop_id = ANY($1::uuid[]) OR customer_user_id = ANY($2::uuid[])`;
    const deliveries = `SELECT delivery_id FROM app.deliveries WHERE shop_id = ANY($1::uuid[]) OR order_id IN (${orders})`;
    const wallets = `SELECT wallet_id FROM app.driver_wallets WHERE driver_id = ANY($1::uuid[])`;
    await client.query(`DELETE FROM app.wallet_ledger_entries WHERE wallet_id IN (${wallets})`, [drivers]);
    await client.query(`DELETE FROM app.wallet_holds WHERE wallet_id IN (${wallets})`, [drivers]);
    const assignments = `SELECT assignment_id FROM app.delivery_assignments WHERE delivery_id IN (${deliveries})`;
    await client.query(`DELETE FROM app.wallet_ledger_entries WHERE commission_assignment_id IN (${assignments})`, [shops, customers]);
    await client.query(`DELETE FROM app.wallet_holds WHERE commission_assignment_id IN (${assignments})`, [shops, customers]);
    for (const table of ['delivery_incidents', 'delivery_events']) {
      await client.query(`DELETE FROM app.${table} WHERE delivery_id IN (${deliveries})`, [shops, customers]);
    }
    await client.query(`DELETE FROM app.shipping_fee_agreement_events WHERE agreement_id IN (SELECT agreement_id FROM app.shipping_fee_agreements WHERE delivery_id IN (${deliveries}))`, [shops, customers]);
    await client.query(`DELETE FROM app.shipping_fee_agreements WHERE delivery_id IN (${deliveries})`, [shops, customers]);
    await client.query(`DELETE FROM app.delivery_assignments WHERE delivery_id IN (${deliveries})`, [shops, customers]);
    for (const table of ['notification_reminders', 'notification_offer_rounds']) {
      await client.query(`DELETE FROM app.${table} WHERE delivery_id IN (${deliveries})`, [shops, customers]);
    }
    await client.query(`DELETE FROM app.order_chat_messages WHERE order_id IN (${orders}) OR delivery_id IN (${deliveries})`, [shops, customers]);
    await client.query(`ALTER TABLE app.order_chat_holds DISABLE TRIGGER USER`);
    await client.query(`DELETE FROM app.order_chat_holds WHERE order_id IN (${orders}) OR delivery_id IN (${deliveries})`, [shops, customers]);
    await client.query(`ALTER TABLE app.order_chat_holds ENABLE TRIGGER USER`);
    await client.query(`DELETE FROM app.deliveries WHERE delivery_id IN (${deliveries})`, [shops, customers]);
    await client.query(`DELETE FROM app.order_events WHERE order_id IN (${orders})`, [shops, customers]);
    await client.query(`DELETE FROM app.order_items WHERE order_id IN (${orders})`, [shops, customers]);
    await client.query(`DELETE FROM app.orders WHERE shop_id = ANY($1::uuid[]) OR customer_user_id = ANY($2::uuid[])`, [shops, customers]);
    await client.query('DELETE FROM app.customer_carts WHERE shop_id = ANY($1::uuid[]) OR user_id = ANY($2::uuid[])', [shops, customers]);
    await client.query('DELETE FROM app.shipper_latest_locations WHERE driver_id = ANY($1::uuid[])', [drivers]);
    await client.query('DELETE FROM app.driver_wallets WHERE driver_id = ANY($1::uuid[])', [drivers]);
    // The notified accounts are the given ones and the Shippers' own accounts (offers, reminders).
    const notified = `SELECT user_id FROM app.drivers WHERE driver_id = ANY($2::uuid[])`;
    await client.query(`DELETE FROM app.notification_pushes WHERE recipient_user_id = ANY($1::uuid[]) OR recipient_user_id IN (${notified})`, [[...input.userIds], drivers]);
    await client.query(`DELETE FROM app.notifications WHERE recipient_user_id = ANY($1::uuid[]) OR recipient_user_id IN (${notified})`, [[...input.userIds], drivers]);
    if (input.policyAdded === true) {
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

export const codeOf = (response: ApiResponse): string | undefined => {
  try {
    return (JSON.parse(response.text) as { error?: { code?: string } }).error?.code;
  } catch {
    return undefined;
  }
};
