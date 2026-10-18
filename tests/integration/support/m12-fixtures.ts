import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { ADMIN_SESSION_COOKIE } from '../../../apps/backend/src/admin-auth/admin-auth-constants';
import { ADMIN_PASSWORD, AdminApp, adminData, AdminResponse, cookieFrom, loginStep, preauthCookies, rewindAcceptedStep, sessionCookies, totpNow } from './admin-fixtures';
import { begin, ok, post } from './activation-fixtures';
import { Phone, randomPhone } from './auth-fixtures';
import { createInvitation, createPayload, SystemSession } from './provisioning-fixtures';

// Shared fixtures of the M12 suites (administration overview, operations, permissions, configuration, reports, audit). Test database only: the rows are plain
// INSERTs of valid rows (the owners' flows have their own suites), and `purge...` removes exactly what a suite created, with the user triggers lifted
// only inside one transaction (the application never deletes these rows).

export interface Login {
  readonly cookie: string;
  readonly csrf: string;
}

export interface ActivatedAdmin {
  readonly phone: Phone;
  readonly userId: string;
  readonly secret: string;
  readonly login: Login;
}

export const permission = (app: 'CUSTOMER' | 'SHOP' | 'DRIVER', flags: { view?: boolean; review?: boolean; lock?: boolean } = { view: true }): Record<string, unknown> => ({
  app,
  can_view: flags.view ?? true,
  can_review_profile: flags.review ?? false,
  can_lock: flags.lock ?? false,
});

/** An ADMIN activated through the real invitation flow with the given M01 app permissions, already logged in. */
export async function activatedAdmin(admin: AdminApp, system: SystemSession, permissions: Record<string, unknown>[], fullName: string): Promise<ActivatedAdmin> {
  const phone = randomPhone();
  admin.track(phone.normalized);
  const invitation = await createInvitation(admin, system, createPayload(phone.local, { full_name: fullName, permissions }));
  const token = invitation.link.split('#t=')[1] as string;
  const session = await begin(admin, { invitationId: invitation.invitationId, token, phone });
  ok(await post(admin, '/password', session, { password: ADMIN_PASSWORD }));
  const secret = String(adminData(ok(await post(admin, '/totp/enrollment', session))).secret);
  ok(await post(admin, '/complete', session, { code: totpNow(secret) }));
  const found = await admin.pool.query<{ user_id: string }>('SELECT user_id FROM app.users WHERE phone_normalized = $1', [phone.normalized]);
  const userId = (found.rows[0] as { user_id: string }).user_id;
  return { phone, userId, secret, login: await loginAdmin(admin, { phone, userId, secret }) };
}

export async function loginAdmin(admin: AdminApp, who: { phone: Phone; userId: string; secret: string }): Promise<Login> {
  const preauth = await loginStep(admin, { phone: who.phone, password: ADMIN_PASSWORD, userId: who.userId });
  await rewindAcceptedStep(admin, who.userId);
  const verified = await admin.call('POST', '/totp/verify', { body: { code: totpNow(who.secret) }, cookies: preauthCookies(preauth), csrf: preauth.csrf });
  if (verified.status !== 200) {
    throw new Error(`admin login failed: ${verified.status} ${verified.text}`);
  }
  return { cookie: String(cookieFrom(verified, ADMIN_SESSION_COOKIE)), csrf: String(adminData(verified).csrf_token) };
}

export const systemLoginOf = (system: SystemSession): Login => ({ cookie: system.login.cookie, csrf: system.login.csrf });

export function getAs(admin: AdminApp, who: Login | undefined, path: string): Promise<AdminResponse> {
  return admin.call('GET', path, { basePath: '/v1/admin', ...(who === undefined ? {} : { cookies: sessionCookies(who) }) });
}

export async function postAs(admin: AdminApp, who: Login, path: string, body: unknown, key: string = randomUUID()): Promise<AdminResponse> {
  await admin.clearLimits(); // the ingress quota is not under test
  return admin.call('POST', path, { basePath: '/v1/admin', body, cookies: sessionCookies(who), csrf: who.csrf, headers: { 'idempotency-key': key } });
}

/** SYSTEM gives / takes back one function right (the finance-access routes carry every function grant, see finance-access-constants). */
export const changeGrant = (admin: AdminApp, system: SystemSession, command: 'grant' | 'revoke', target: string, key: string, version: number): Promise<AdminResponse> =>
  postAs(admin, systemLoginOf(system), `/finance/access/admins/${target}/${command}`, { permission_key: key, expected_version: version });

export interface DeliverySeed {
  readonly deliveryId?: string;
  readonly shopId: string;
  readonly userId: string;
  readonly state?: 'waiting_driver' | 'search_stopped';
  readonly createdAtIso?: string;
  readonly previousDeliveryId?: string | null;
  readonly source?: 'DIRECT';
}

/** A delivery row in `waiting_driver` or a stopped search, created at an exact instant (for the Vietnam day boundaries). Returns its id. */
export async function seedDelivery(pool: Pool, seed: DeliverySeed): Promise<string> {
  const deliveryId = seed.deliveryId ?? randomUUID();
  const created = seed.createdAtIso ?? new Date().toISOString();
  const stopped = seed.state === 'search_stopped';
  await pool.query(
    `INSERT INTO app.deliveries (
       delivery_id, code, source, shop_id, requested_by, state, previous_delivery_id, shop_name, shop_phone, pickup_address_text, pickup_lat, pickup_lng,
       recipient_name, recipient_phone, dropoff_address_text, goods_description, goods_value_vnd, paid_vnd, fee_mode, fee_payer,
       search_started_at, search_expires_at, search_stopped_at, ended_at, version, created_at, updated_at)
     VALUES ($1::uuid, $2, 'DIRECT', $3::uuid, $4::uuid, $5, $6::uuid, 'Fixture shop', '+84900000001', 'Fixture address', 21.0, 105.8,
       'Khách', '+84912345678', '12 Phố Huế', 'Hộp quà', 0, 0, 'STANDARD', 'CUSTOMER',
       $7::timestamptz, $7::timestamptz + interval '30 minutes', CASE WHEN $8::boolean THEN $7::timestamptz + interval '30 minutes' END,
       CASE WHEN $8::boolean THEN $7::timestamptz + interval '30 minutes' END, 1, $7::timestamptz, $7::timestamptz + interval '30 minutes')`,
    [deliveryId, `M12-${deliveryId.slice(0, 8)}`, seed.shopId, seed.userId, seed.state ?? 'waiting_driver', seed.previousDeliveryId ?? null, created, stopped],
  );
  return deliveryId;
}

/** Removes the deliveries (and what hangs on them) of the given shops, with the user triggers lifted in one transaction. Errors are NOT swallowed. */
export async function purgeDeliveriesOfShops(pool: Pool, shopIds: readonly string[]): Promise<void> {
  if (shopIds.length === 0) {
    return;
  }
  const client = await pool.connect();
  const tables = ['delivery_incidents', 'delivery_events', 'delivery_assignments', 'deliveries'];
  try {
    await client.query('BEGIN');
    for (const table of tables) {
      await client.query(`ALTER TABLE app.${table} DISABLE TRIGGER USER`);
    }
    const mine = 'SELECT delivery_id FROM app.deliveries WHERE shop_id = ANY($1::uuid[])';
    await client.query(`DELETE FROM app.delivery_incidents WHERE delivery_id IN (${mine})`, [shopIds]);
    await client.query(`DELETE FROM app.delivery_events WHERE delivery_id IN (${mine})`, [shopIds]);
    await client.query(`DELETE FROM app.delivery_assignments WHERE delivery_id IN (${mine})`, [shopIds]);
    await client.query('UPDATE app.deliveries SET previous_delivery_id = NULL WHERE shop_id = ANY($1::uuid[])', [shopIds]);
    await client.query('DELETE FROM app.deliveries WHERE shop_id = ANY($1::uuid[])', [shopIds]);
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

/** Removes every finance/function grant row (test database only; the table forbids DELETE for the application). */
export async function purgeGrants(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE app.admin_finance_grants DISABLE TRIGGER admin_finance_grants_no_delete');
    await client.query('DELETE FROM app.admin_finance_grants');
    await client.query('ALTER TABLE app.admin_finance_grants ENABLE TRIGGER admin_finance_grants_no_delete');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
