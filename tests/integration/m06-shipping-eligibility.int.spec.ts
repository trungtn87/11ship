import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ADMIN_SESSION_COOKIE } from '../../apps/backend/src/admin-auth/admin-auth-constants';
import { DriverBankRepository } from '../../apps/backend/src/driver/driver-bank-repository';
import { DriverRepository } from '../../apps/backend/src/driver/driver-repository';
import { poolClientSource } from '../../apps/backend/src/transaction/pg-client-source';
import { WalletRepository } from '../../apps/backend/src/wallet/wallet-repository';
import { WalletService } from '../../apps/backend/src/wallet/wallet-service';
import { EligibilityParametersRepository } from '../../apps/backend/src/shipping-policy/eligibility-parameters-repository';
import { BatchOrder } from '../../apps/backend/src/shipping-policy/shipping-batching';
import { LatLng } from '../../apps/backend/src/shipping-policy/shipping-eligibility';
import { ROUTE_SNAPSHOT_TTL_MS, ShippingEligibilityService } from '../../apps/backend/src/shipping-policy/shipping-eligibility-service';
import {
  AvailableBalancePort,
  DeliveryOffer,
  DeliveryOfferPort,
  NotIntegratedDeliveryOfferPort,
  NotIntegratedRouteMatrixPort,
  NotIntegratedShipperLocationPort,
  NotIntegratedShipperWorkPort,
  RouteMatrixPort,
  ShipperLocation,
  ShipperLocationPort,
  ShipperOpenWork,
  ShipperWorkPort,
  WalletAvailableBalancePort,
} from '../../apps/backend/src/shipping-policy/shipping-ports';
import { ADMIN_PASSWORD, AdminApp, adminData, adminErrorCode, AdminResponse, cookieFrom, loginStep, preauthCookies, rewindAcceptedStep, sessionCookies, startAdminApp, totpNow } from './support/admin-fixtures';
import { begin, ok, post } from './support/activation-fixtures';
import { countRows, createDriverFor, Phone, randomPhone } from './support/auth-fixtures';
import { createInvitation, createPayload, systemSession, SystemSession } from './support/provisioning-fixtures';
import { managerFor } from './support/transaction-fixtures';

// M06-B/C on a REAL PostgreSQL: the Admin parameters (who may change them, bounds, version, history), and the eligibility/batching service
// (count and wallet limits, the PLATFORM exceptions, fail-closed ports, route snapshot, and two simultaneous acceptances that must not exceed the
// count or the balance). M07/M14 do not exist yet, so their ports are explicit test doubles; M04's wallet is the real read model in one test.

const tag = randomBytes(3).toString('hex').toUpperCase();
interface AdminLogin {
  readonly cookie: string;
  readonly csrf: string;
}
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const NOW = Date.UTC(2026, 9, 17, 18, 20, 0);
const P = (x: number): LatLng => ({ lat: 22 + x / 1000, lng: 106 });
/** About 11 km north of the origin: outside the 3 km search radius. */
const FAR: LatLng = { lat: 22.1, lng: 106 };
const NO_SERVICE_TIME = 'UPDATE app.shipping_eligibility_parameters SET version = version + 1, pickup_service_seconds = 0, handoff_service_seconds = 0';
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('M06-B/C — eligibility parameters and decisions', () => {
  let admin: AdminApp;
  let system: SystemSession;
  let viewer: AdminLogin;

  async function resetParameters(): Promise<void> {
    const client = await admin.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE app.shipping_eligibility_parameter_changes DISABLE TRIGGER shipping_eligibility_changes_append_only');
      await client.query('DELETE FROM app.shipping_eligibility_parameter_changes');
      await client.query('ALTER TABLE app.shipping_eligibility_parameter_changes ENABLE TRIGGER shipping_eligibility_changes_append_only');
      await client.query(
        `UPDATE app.shipping_eligibility_parameters SET version = version + 1, external_max_deliveries = 3, batch_max_delay_seconds = 300,
                pickup_service_seconds = 120, handoff_service_seconds = 60, updated_by = NULL`,
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    admin = await startAdminApp({ activationDisabledTest: true });
    system = await systemSession(admin);
    const phone = randomPhone();
    admin.track(phone.normalized);
    const invitation = await createInvitation(admin, system, createPayload(phone.local, { full_name: `Xem điều kiện ${tag}`, permissions: [{ app: 'DRIVER', can_view: true, can_review_profile: false, can_lock: false }] }));
    const token = invitation.link.split('#t=')[1] as string;
    const session = await begin(admin, { invitationId: invitation.invitationId, token, phone });
    ok(await post(admin, '/password', session, { password: ADMIN_PASSWORD }));
    const secret = String(adminData(ok(await post(admin, '/totp/enrollment', session))).secret);
    ok(await post(admin, '/complete', session, { code: totpNow(secret) }));
    const found = await admin.pool.query<{ user_id: string }>('SELECT user_id FROM app.users WHERE phone_normalized = $1', [phone.normalized]);
    viewer = await login({ phone, userId: (found.rows[0] as { user_id: string }).user_id, secret });
    await resetParameters();
  });

  afterAll(async () => {
    await resetParameters();
    await admin.close();
  });

  async function login(who: { phone: Phone; userId: string; secret: string }): Promise<AdminLogin> {
    const preauth = await loginStep(admin, { phone: who.phone, password: ADMIN_PASSWORD, userId: who.userId });
    await rewindAcceptedStep(admin, who.userId);
    const verified = await admin.call('POST', '/totp/verify', { body: { code: totpNow(who.secret) }, cookies: preauthCookies(preauth), csrf: preauth.csrf });
    if (verified.status !== 200) {
      throw new Error(`admin login failed: ${verified.status} ${verified.text}`);
    }
    return { cookie: String(cookieFrom(verified, ADMIN_SESSION_COOKIE)), csrf: String(adminData(verified).csrf_token) };
  }

  const systemLogin = (): AdminLogin => ({ cookie: system.login.cookie, csrf: system.login.csrf });
  const get = (who: AdminLogin | undefined): Promise<AdminResponse> => admin.call('GET', '/shipping-eligibility-policy', { basePath: '/v1/admin', ...(who === undefined ? {} : { cookies: sessionCookies(who) }) });
  async function write(who: AdminLogin, body: unknown, key: string = randomUUID()): Promise<AdminResponse> {
    await admin.clearLimits();
    return admin.call('POST', '/shipping-eligibility-policy', { basePath: '/v1/admin', body, cookies: sessionCookies(who), csrf: who.csrf, headers: { 'idempotency-key': key } });
  }
  const codeOf = (r: AdminResponse): { status: number; code: string | undefined } => ({ status: r.status, code: adminErrorCode(r) });
  const state = async (who: AdminLogin = systemLogin()): Promise<Json> => adminData(await get(who)) as Json;
  const values = (v: number, over: Json = {}): Json => ({ external_max_deliveries: 3, batch_max_delay_seconds: 300, pickup_service_seconds: 120, handoff_service_seconds: 60, ...over, expected_version: v });

  describe('Admin parameters', () => {
    it('starts from the approved defaults (EXTERNAL 3, 300 s), shows the fixed 3 km radius, and every administrator reads it', async () => {
      const start = await state();
      expect(start).toMatchObject({ external_max_deliveries: 3, batch_max_delay_seconds: 300, fixed: { search_radius_m: 3000, platform_unlimited: true }, history: [] });
      expect((await get(viewer)).status).toBe(200);
      expect(codeOf(await get(undefined))).toEqual({ status: 401, code: 'ADMIN_SESSION_INVALID' });
    });

    it('only SYSTEM changes them: an ADMIN is refused and nothing is written', async () => {
      const before = await state();
      expect(codeOf(await write(viewer, values(Number(before.version), { external_max_deliveries: 5 })))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
      expect(await state()).toEqual(before);
      expect(await countRows(admin.pool, 'SELECT 1 FROM app.shipping_eligibility_parameter_changes')).toBe(0);
    });

    it('refuses values out of bounds, the radius as a setting, extra keys and the wrong type', async () => {
      const v = Number((await state()).version);
      for (const bad of [
        values(v, { external_max_deliveries: 0 }),
        values(v, { external_max_deliveries: 21 }),
        values(v, { batch_max_delay_seconds: -1 }),
        values(v, { batch_max_delay_seconds: 3601 }),
        values(v, { pickup_service_seconds: 1801 }),
        values(v, { handoff_service_seconds: 1.5 }),
        values(v, { external_max_deliveries: '5' }),
        values(v, { search_radius_m: 3000 }),
        { expected_version: v, external_max_deliveries: 3 },
      ]) {
        expect(codeOf(await write(systemLogin(), bad))).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' });
      }
      expect(Number((await state()).version)).toBe(v);
    });

    it('SYSTEM changes them: versioned, logged (old, new, actor, time), audited; a stale screen conflicts; an identical save changes nothing', async () => {
      const before = await state();
      const v = Number(before.version);
      const changed = await write(systemLogin(), values(v, { external_max_deliveries: 5, batch_max_delay_seconds: 420 }));
      expect(changed.status).toBe(200);
      const after = adminData(changed) as Json;
      expect(after).toMatchObject({ version: v + 1, external_max_deliveries: 5, batch_max_delay_seconds: 420 });
      expect(after.history[0]).toMatchObject({ version_after: v + 1, old: { external_max_deliveries: 3, batch_max_delay_seconds: 300 }, new: { external_max_deliveries: 5, batch_max_delay_seconds: 420 }, changed_by: system.account.userId });
      expect(await countRows(admin.pool, "SELECT 1 FROM app.audit_logs WHERE action = 'admin.shipping_eligibility_policy.update.v1' AND actor_id = $1", [system.account.userId])).toBeGreaterThanOrEqual(1);
      expect(codeOf(await write(systemLogin(), values(v, { external_max_deliveries: 9 })))).toEqual({ status: 409, code: 'SHIPPING_ELIGIBILITY_VERSION_CONFLICT' });
      const same = adminData(await write(systemLogin(), values(v + 1, { external_max_deliveries: 5, batch_max_delay_seconds: 420 }))) as Json;
      expect(same.version).toBe(v + 1);
      expect(await countRows(admin.pool, 'SELECT 1 FROM app.shipping_eligibility_parameter_changes')).toBe(1);
      await expect(admin.pool.query('DELETE FROM app.shipping_eligibility_parameter_changes')).rejects.toMatchObject({ code: '23001' });
      await expect(admin.pool.query('DELETE FROM app.shipping_eligibility_parameters')).rejects.toMatchObject({ code: '23001' });
      // The next check reads the new value from the database (no cache).
      const read = await admin.pool.query<{ n: number }>('SELECT external_max_deliveries AS n FROM app.shipping_eligibility_parameters');
      expect(read.rows[0]?.n).toBe(5);
      await resetParameters();
    });
  });

  describe('Eligibility and batching decisions (M07/M14 ports are test doubles)', () => {
    const manager = () => managerFor(poolClientSource(admin.pool), { timeoutMs: 20_000 });
    const drivers = new DriverRepository();
    const banks = new DriverBankRepository();
    const parameters = new EligibilityParametersRepository();

    const world = {
      count: 0,
      orders: [] as BatchOrder[],
      available: 100_000n,
      hold: 5000n as bigint | null,
      shop: P(0) as LatLng | null,
      dropoff: P(5) as LatLng | null,
      driverPoint: P(0.2),
      fresh: true,
      routeCalls: 0,
      routeUp: true,
      expiresAtMs: NOW + 600_000,
      hasShipper: false,
    };
    const offers: DeliveryOfferPort = {
      offer: (): Promise<DeliveryOffer> =>
        Promise.resolve({ deliveryId: 'N', searching: true, hasShipper: world.hasShipper, searchExpiresAtMs: world.expiresAtMs, shop: world.shop, dropoff: world.dropoff, requiredHoldVnd: world.hold }),
    };
    const work: ShipperWorkPort = { openWork: (): Promise<ShipperOpenWork> => Promise.resolve({ activeCount: world.count, orders: world.orders }) };
    const locations: ShipperLocationPort = { current: (): Promise<ShipperLocation> => Promise.resolve({ point: world.driverPoint, recordedAtMs: NOW, fresh: world.fresh, valid: true }) };
    const routes: RouteMatrixPort = {
      durations: (points) => {
        world.routeCalls += 1;
        if (!world.routeUp) {
          return Promise.resolve({ kind: 'unavailable' as const });
        }
        const minutes = points.map((a) => points.map((b) => Math.abs(a.lat - b.lat) * 1000 * 60));
        return Promise.resolve({ kind: 'ok' as const, seconds: minutes, routeVersion: 'test-1' });
      },
    };
    const balance: AvailableBalancePort = { availableVnd: (): Promise<bigint> => Promise.resolve(world.available) };
    const service = (): ShippingEligibilityService => new ShippingEligibilityService(manager(), drivers, banks, parameters, offers, work, locations, routes, balance);

    let driverId = '';
    let userId = '';

    async function newDriver(type: 'EXTERNAL' | 'PLATFORM' = 'EXTERNAL'): Promise<string> {
      const phone = randomPhone();
      admin.track(phone.normalized);
      userId = randomUUID();
      await admin.pool.query(
        `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
         VALUES ($1::uuid, $2, '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', now(), 'PHONE_VERIFIED', 'ACTIVE', 1, now(), now())`,
        [userId, phone.normalized],
      );
      const id = await createDriverFor(admin.pool, userId, { status: 'ACTIVE' });
      await admin.pool.query(`UPDATE app.drivers SET accepting_deliveries = true, driver_type = $2 WHERE driver_id = $1::uuid`, [id, type]);
      await admin.pool.query(
        `INSERT INTO app.driver_bank_accounts (driver_id, bank_code, bank_name, account_number, account_holder, verification_state, verified_by, verified_at, created_at, updated_at)
         VALUES ($1::uuid, 'VCB', 'Vietcombank', '0123456789', 'FIXTURE', 'VERIFIED', $2::uuid, now(), now(), now())`,
        [id, userId],
      );
      return id;
    }

    const reset = (): void => {
      Object.assign(world, { count: 0, orders: [], available: 100_000n, hold: 5000n, shop: P(0), dropoff: P(5), driverPoint: P(0.2), fresh: true, routeCalls: 0, routeUp: true, expiresAtMs: NOW + 600_000, hasShipper: false });
    };
    const A = (eta = NOW + 600_000): BatchOrder => ({ orderId: 'A', originalEtaMs: eta, pickedUp: true, pickup: null, dropoff: P(10) });

    beforeAll(async () => {
      driverId = await newDriver();
    });

    it('an empty Shipper near the shop is eligible without asking for any route', async () => {
      reset();
      const { decision, route } = await service().preview({ driverId, deliveryId: 'N' }, NOW);
      expect(decision).toMatchObject({ eligible: true, reasons: [], batch: { applicable: false } });
      expect(route).toBeUndefined();
      expect(world.routeCalls).toBe(0);
    });

    it('EXTERNAL is capped by the configured count (read from the database); PLATFORM is not, but still needs the wallet', async () => {
      reset();
      world.count = 3;
      expect((await service().preview({ driverId, deliveryId: 'N' }, NOW)).decision.reasons).toEqual(['ACTIVE_LIMIT_REACHED']);
      world.count = 2;
      expect((await service().preview({ driverId, deliveryId: 'N' }, NOW)).decision.eligible).toBe(true);
      // The Admin raises the cap: the very next check sees it.
      world.count = 3;
      await admin.pool.query('UPDATE app.shipping_eligibility_parameters SET version = version + 1, external_max_deliveries = 4');
      expect((await service().preview({ driverId, deliveryId: 'N' }, NOW)).decision.eligible).toBe(true);
      await resetParameters();

      const platform = await newDriver('PLATFORM');
      world.count = 40;
      world.shop = P(0);
      world.driverPoint = FAR; // outside the radius, which PLATFORM ignores
      expect((await service().preview({ driverId: platform, deliveryId: 'N' }, NOW)).decision.eligible).toBe(true);
      world.available = 1000n;
      expect((await service().preview({ driverId: platform, deliveryId: 'N' }, NOW)).decision.reasons).toEqual(['BALANCE_TOO_LOW']);
      world.available = 100_000n;
      world.fresh = false;
      expect((await service().preview({ driverId: platform, deliveryId: 'N' }, NOW)).decision.reasons).toEqual(['LOCATION_STALE']);
      world.fresh = true;
      world.shop = null; // PLATFORM is exempt from the radius only: the shop position is still required
      expect((await service().preview({ driverId: platform, deliveryId: 'N' }, NOW)).decision.reasons).toEqual(['SHOP_LOCATION_MISSING']);
    });

    it('refuses an EXTERNAL Shipper beyond the fixed 3 km (2,9 km passes, 4 km does not), a delivery that has a Shipper or whose search is over, and a Shipper that is not ready', async () => {
      reset();
      world.driverPoint = P(26); // about 2,9 km from the shop
      expect((await service().preview({ driverId, deliveryId: 'N' }, NOW)).decision.eligible).toBe(true);
      world.driverPoint = P(36); // about 4 km: inside the old 5 km radius, outside the 3 km one
      expect((await service().preview({ driverId, deliveryId: 'N' }, NOW)).decision.reasons).toEqual(['OUT_OF_SEARCH_RADIUS']);
      world.driverPoint = FAR;
      expect((await service().preview({ driverId, deliveryId: 'N' }, NOW)).decision.reasons).toEqual(['OUT_OF_SEARCH_RADIUS']);
      reset();
      world.hasShipper = true;
      expect((await service().preview({ driverId, deliveryId: 'N' }, NOW)).decision.reasons).toEqual(['DELIVERY_NOT_AVAILABLE']);
      reset();
      world.expiresAtMs = NOW;
      expect((await service().preview({ driverId, deliveryId: 'N' }, NOW)).decision.reasons).toEqual(['DELIVERY_SEARCH_EXPIRED']);
      reset();
      await admin.pool.query('UPDATE app.drivers SET accepting_deliveries = false WHERE driver_id = $1::uuid', [driverId]);
      expect((await service().preview({ driverId, deliveryId: 'N' }, NOW)).decision.reasons).toEqual(['DRIVER_NOT_ACCEPTING']);
      await admin.pool.query('UPDATE app.drivers SET accepting_deliveries = true WHERE driver_id = $1::uuid', [driverId]);
    });

    it('fails closed with the default bindings: M07 and M14 are not connected, so nothing is eligible and nothing is invented (the wallet is the real M04 read model)', async () => {
      reset();
      const notConnected = new ShippingEligibilityService(
        manager(),
        drivers,
        banks,
        parameters,
        new NotIntegratedDeliveryOfferPort(),
        new NotIntegratedShipperWorkPort(),
        new NotIntegratedShipperLocationPort(),
        new NotIntegratedRouteMatrixPort(),
        new WalletAvailableBalancePort(new WalletService(new WalletRepository(), drivers)),
      );
      const { decision } = await notConnected.preview({ driverId, deliveryId: 'N' }, NOW);
      expect(decision.eligible).toBe(false);
      expect(decision.reasons).toEqual(expect.arrayContaining(['DEPENDENCY_NOT_READY', 'LOCATION_UNAVAILABLE']));
      await expect(notConnected.preview({ driverId: randomUUID(), deliveryId: 'N' }, NOW)).rejects.toMatchObject({ code: 'DRIVER_NOT_FOUND' });
    });

    it('with open work: the route is asked outside the transaction and the old ETA is protected; no route means no acceptance', async () => {
      reset();
      world.driverPoint = P(0);
      world.dropoff = P(-1.5);
      world.shop = P(-1.5);
      world.orders = [A(NOW + 600_000)]; // A: 10 min away, original ETA 18:30
      world.count = 1;
      await admin.pool.query(NO_SERVICE_TIME);
      const ok1 = await service().preview({ driverId, deliveryId: 'N' }, NOW);
      expect(ok1.decision).toMatchObject({ eligible: true, batch: { applicable: true, delaysSeconds: { A: 180 } } }); // +3 min, inside 5
      expect(ok1.route?.routeVersion).toBe('test-1');
      expect(world.routeCalls).toBe(1);
      // M14 down: refused, never a guess.
      world.routeUp = false;
      expect((await service().preview({ driverId, deliveryId: 'N' }, NOW)).decision.reasons).toEqual(['ROUTE_DATA_UNAVAILABLE']);
      world.routeUp = true;
      // The Admin tightens the limit to 2 minutes: the same acceptance is now refused.
      await admin.pool.query('UPDATE app.shipping_eligibility_parameters SET version = version + 1, batch_max_delay_seconds = 120, pickup_service_seconds = 0, handoff_service_seconds = 0');
      expect((await service().preview({ driverId, deliveryId: 'N' }, NOW)).decision.reasons).toEqual(['BATCH_DELAY_EXCEEDED']);
      await resetParameters();
    });

    it('confirm re-checks under the Shipper lock with the route snapshot: stale age, moved GPS or changed places are refused (ROUTE_STALE)', async () => {
      reset();
      world.driverPoint = P(0);
      world.dropoff = P(-1.5);
      world.shop = P(-1.5);
      world.orders = [A()];
      world.count = 1;
      await admin.pool.query(NO_SERVICE_TIME);
      const svc = service();
      const { route } = await svc.preview({ driverId, deliveryId: 'N' }, NOW);
      const confirm = (r: typeof route, at: number) => manager().withTransaction((context) => svc.confirm(context, { driverId, deliveryId: 'N' }, r, at));
      expect(await confirm(route, NOW + 1000)).toMatchObject({ eligible: true });
      expect(await confirm(route, NOW + ROUTE_SNAPSHOT_TTL_MS + 1)).toMatchObject({ eligible: false, reasons: ['ROUTE_STALE'] });
      expect(await confirm(undefined, NOW + 1000)).toMatchObject({ eligible: false, reasons: ['ROUTE_STALE'] });
      world.driverPoint = P(0.001);
      expect(await confirm(route, NOW + 1000)).toMatchObject({ eligible: false, reasons: ['ROUTE_STALE'] });
      world.driverPoint = P(0);
      world.dropoff = P(-1.6);
      expect(await confirm(route, NOW + 1000)).toMatchObject({ eligible: false, reasons: ['ROUTE_STALE'] });
      await resetParameters();
    });

    it('two simultaneous acceptances by one EXTERNAL Shipper cannot exceed the count: the Shipper lock serializes them', async () => {
      reset();
      world.count = 2; // one place left of 3
      const svc = service();
      const accept = (): Promise<boolean> =>
        manager().withTransaction(async (context) => {
          const decision = await svc.confirm(context, { driverId, deliveryId: 'N' }, undefined, NOW);
          if (decision.eligible) {
            await sleep(150); // M07 inserts the assignment and the hold here, in this very transaction
            world.count += 1;
          }
          return decision.eligible;
        });
      const results = await Promise.all([accept(), accept(), accept()]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(world.count).toBe(3);
    });

    it('two simultaneous acceptances cannot spend the same balance (the second sees the first hold)', async () => {
      reset();
      world.available = 10_000n;
      world.hold = 8000n;
      const svc = service();
      const accept = (): Promise<{ eligible: boolean; reasons: readonly string[] }> =>
        manager().withTransaction(async (context) => {
          const decision = await svc.confirm(context, { driverId, deliveryId: 'N' }, undefined, NOW);
          if (decision.eligible) {
            await sleep(150);
            world.available -= 8000n;
          }
          return decision;
        });
      const [first, second] = await Promise.all([accept(), accept()]);
      expect([first.eligible, second.eligible].sort()).toEqual([false, true]);
      expect((first.eligible ? second : first).reasons).toEqual(['BALANCE_TOO_LOW']);
      expect(world.available).toBe(2000n);
    });
  });
});
