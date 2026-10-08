import { randomUUID } from 'node:crypto';
import { expect } from '@jest/globals';
import { Pool } from 'pg';
import {
  ApiResponse,
  AuthApp,
  createActiveShopFor,
  createServiceArea,
  grantStrayRole,
  registerUser,
  Registered,
  sessionIdOfToken,
} from './auth-fixtures';

// M02-A fixtures: an ACTIVE shop whose owner is already in the SHOP context, the three Shop management calls and a
// compact "what exists now" snapshot used to prove that a refused or failed command changed nothing.

export interface ShopOwner {
  readonly user: Registered;
  readonly userId: string;
  readonly token: string;
  readonly sessionId: string;
  readonly shopId: string;
  readonly areaId: string;
}

export interface Wire {
  weekday: number;
  start_minute: number;
  end_minute: number;
  end_day_offset: number;
}

export const interval = (weekday: number, start: number, end: number, offset = 0): Wire => ({
  weekday,
  start_minute: start,
  end_minute: end,
  end_day_offset: offset,
});

/** A registered user with an ACTIVE owned shop (version 2, no schedule) and a session in the SHOP context. */
export async function createShopOwner(app: AuthApp, options: { areaId?: string } = {}): Promise<ShopOwner> {
  const user = await registerUser(app);
  const areaId = options.areaId ?? (await createServiceArea(app.pool));
  await grantStrayRole(app.pool, user.userId, 'SHOP');
  const shopId = await createActiveShopFor(app.pool, user.userId, areaId);
  const selected = await app.call('POST', '/auth/role/select', { bearer: user.accessToken, body: { role: 'SHOP' } });
  expect(selected.status).toBe(200);
  return {
    user,
    userId: user.userId,
    token: user.accessToken,
    sessionId: await sessionIdOfToken(app.pool, user.accessToken),
    shopId,
    areaId,
  };
}

export function profileBody(owner: ShopOwner, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    expected_version: 2,
    name: 'Quán Mới',
    contact_phone: '0912345678',
    address_text: '5 Phố Huế, Hai Bà Trưng',
    zalo: 'zalo.new',
    facebook: null,
    pickup_lat: 21.0123,
    pickup_lng: 105.8456,
    service_area_id: owner.areaId,
    ...overrides,
  };
}

export const getShop = (app: AuthApp, token: string | undefined): Promise<ApiResponse> =>
  app.call('GET', '/shop/me', token === undefined ? {} : { bearer: token });

export const putProfile = (
  app: AuthApp,
  token: string | undefined,
  body: unknown,
  key: string | null = randomUUID(),
): Promise<ApiResponse> =>
  app.call('PUT', '/shop/me/profile', {
    body,
    ...(token === undefined ? {} : { bearer: token }),
    ...(key === null ? {} : { headers: { 'idempotency-key': key } }),
  });

export const putHours = (
  app: AuthApp,
  token: string | undefined,
  body: unknown,
  key: string | null = randomUUID(),
): Promise<ApiResponse> =>
  app.call('PUT', '/shop/me/business-hours', {
    body,
    ...(token === undefined ? {} : { bearer: token }),
    ...(key === null ? {} : { headers: { 'idempotency-key': key } }),
  });

export const hoursBody = (intervals: readonly Wire[], expectedVersion = 2): Record<string, unknown> => ({
  expected_version: expectedVersion,
  intervals,
});

export async function insertHours(pool: Pool, shopId: string, intervals: readonly Wire[]): Promise<void> {
  for (const wire of intervals) {
    await pool.query(
      `INSERT INTO app.shop_business_hours (shop_id, weekday, start_minute, end_minute, end_day_offset)
       VALUES ($1::uuid, $2, $3, $4, $5)`,
      [shopId, wire.weekday, wire.start_minute, wire.end_minute, wire.end_day_offset],
    );
  }
}

export async function hoursOf(pool: Pool, shopId: string): Promise<Wire[]> {
  const result = await pool.query<Wire>(
    `SELECT weekday::int, start_minute::int, end_minute::int, end_day_offset::int
       FROM app.shop_business_hours WHERE shop_id = $1::uuid ORDER BY weekday, start_minute`,
    [shopId],
  );
  return result.rows;
}

export interface ShopState {
  readonly version: number;
  readonly status: string;
  readonly name: string;
  readonly contact: string;
  readonly zalo: string | null;
  readonly facebook: string | null;
  readonly addressText: string;
  readonly pickupLat: number | null;
  readonly pickupLng: number | null;
  readonly areaId: string;
  readonly acceptingOrders: boolean;
  readonly hours: Wire[];
  readonly audits: number;
  readonly events: number;
  readonly records: number;
}

async function count(pool: Pool, sql: string, value: string): Promise<number> {
  const result = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, [value]);
  return result.rows[0]?.n ?? 0;
}

/** Everything a Shop management command may change, for before/after equality. */
export async function shopState(pool: Pool, owner: ShopOwner): Promise<ShopState> {
  const shop = await pool.query<{
    version: string | number;
    status: string;
    name: string;
    contact_phone_normalized: string;
    zalo: string | null;
    facebook: string | null;
    address_text: string;
    pickup_lat: number | null;
    pickup_lng: number | null;
    service_area_id: string;
    accepting_orders: boolean;
  }>(
    `SELECT version, status, name, contact_phone_normalized, zalo, facebook, address_text, pickup_lat, pickup_lng,
            service_area_id, accepting_orders
       FROM app.shops WHERE shop_id = $1::uuid`,
    [owner.shopId],
  );
  const row = shop.rows[0];
  if (row === undefined) {
    throw new Error('shop fixture vanished');
  }
  return {
    version: Number(row.version),
    status: row.status,
    name: row.name,
    contact: row.contact_phone_normalized,
    zalo: row.zalo,
    facebook: row.facebook,
    addressText: row.address_text,
    pickupLat: row.pickup_lat === null ? null : Number(row.pickup_lat),
    pickupLng: row.pickup_lng === null ? null : Number(row.pickup_lng),
    areaId: row.service_area_id,
    acceptingOrders: row.accepting_orders,
    hours: await hoursOf(pool, owner.shopId),
    audits: await count(pool, "app.audit_logs WHERE actor_id::text = $1 AND action LIKE 'shop.%'", owner.userId),
    events: await count(
      pool,
      "app.outbox_events WHERE resource_id::text = $1 AND event_type IN ('shop.profile_updated.v1', 'shop.business_hours_updated.v1')",
      owner.shopId,
    ),
    records: await count(pool, "app.idempotency_records WHERE scope_id = $1 AND operation_id LIKE 'shop.%'", owner.userId),
  };
}

/** Fault trigger for DELETE (installFault in auth-fixtures covers INSERT and UPDATE). */
export async function installDeleteFault(pool: Pool, name: string, table: string, condition: string): Promise<void> {
  if (!/^[a-z_]+$/.test(name) || !/^app\.[a-z_]+$/.test(table)) {
    throw new Error('unsafe fault identifiers');
  }
  await pool.query(
    `CREATE FUNCTION app.${name}() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN
       IF ${condition} THEN
         RAISE EXCEPTION 'injected fault' USING ERRCODE = 'XX001';
       END IF;
       RETURN OLD;
     END $$`,
  );
  await pool.query(`CREATE TRIGGER ${name} BEFORE DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION app.${name}()`);
}

/** Local Vietnam week position of "now + offsetMinutes", from the database clock: ISO weekday and minute of day. */
export async function localSlot(pool: Pool, offsetMinutes: number): Promise<{ weekday: number; minute: number }> {
  const result = await pool.query<{ weekday: number; minute: number }>(
    `SELECT extract(isodow FROM t)::int AS weekday, (extract(hour FROM t) * 60 + extract(minute FROM t))::int AS minute
       FROM (SELECT (clock_timestamp() + make_interval(mins => $1::int)) AT TIME ZONE 'Asia/Ho_Chi_Minh' AS t) x`,
    [offsetMinutes],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('no clock row');
  }
  return row;
}

/**
 * Barrier: a row trigger on app.shop_business_hours that waits for an advisory lock a test holds, on the INSERT of
 * ONE shop's rows. By then the replacing request already holds the user, session, membership and shop rows and has
 * deleted the old schedule (uncommitted), so "a backend waits on the advisory lock" proves it is mid-transaction.
 */
export async function installHoursInsertStall(pool: Pool, shopId: string, key: readonly [number, number]): Promise<void> {
  if (!/^[0-9a-f-]{36}$/.test(shopId)) {
    throw new Error('unsafe shop id');
  }
  await pool.query(
    `CREATE FUNCTION app.test_stall_hours_insert() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN
       IF NEW.shop_id = '${shopId}'::uuid THEN
         PERFORM pg_advisory_xact_lock(${key[0]}, ${key[1]});
       END IF;
       RETURN NEW;
     END $$`,
  );
  await pool.query(
    `CREATE TRIGGER test_stall_hours_insert BEFORE INSERT ON app.shop_business_hours
       FOR EACH ROW EXECUTE FUNCTION app.test_stall_hours_insert()`,
  );
}

export async function removeHoursInsertStall(pool: Pool): Promise<void> {
  await pool.query('DROP TRIGGER IF EXISTS test_stall_hours_insert ON app.shop_business_hours');
  await pool.query('DROP FUNCTION IF EXISTS app.test_stall_hours_insert()');
}
