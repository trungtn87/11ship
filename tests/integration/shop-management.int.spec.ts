import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  AuthApp,
  countRows,
  createServiceArea,
  dataOf,
  errorCode,
  grantRole,
  registerUser,
  startAuthApp,
} from './support/auth-fixtures';
import {
  createShopOwner,
  getShop,
  hoursBody,
  hoursOf,
  interval,
  localSlot,
  profileBody,
  putHours,
  putProfile,
  ShopOwner,
  shopState,
} from './support/shop-management-fixtures';

// M02-A — Shop management through the REAL Nest pipeline on a REAL PostgreSQL: acceptance A01-A05, A07, A09, A16.
// Races, faults and replay authorization live in sibling suites; the availability boundaries in
// shop-availability.int.spec.ts.
describe('M02-A — Shop management', () => {
  let app: AuthApp;

  beforeAll(async () => {
    app = await startAuthApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const EVALUATED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

  describe('A01 — the owner reads the shop; nobody else can', () => {
    it('GET /shop/me returns the full data object and no accepting_orders', async () => {
      const owner = await createShopOwner(app);
      const response = await getShop(app, owner.token);
      expect(response.status).toBe(200);
      const data = dataOf(response);
      expect(Object.keys(data).sort()).toEqual(
        [
          'address_text', 'availability', 'contact_phone', 'facebook', 'hours', 'name', 'pickup_lat', 'pickup_lng',
          'service_area_id', 'shop_id', 'status', 'timezone', 'version', 'zalo',
        ].sort(),
      );
      expect(data).toMatchObject({
        shop_id: owner.shopId,
        name: 'Fixture shop',
        contact_phone: '+84900000001',
        address_text: 'Fixture address',
        service_area_id: owner.areaId,
        status: 'ACTIVE',
        version: 2,
        timezone: 'Asia/Ho_Chi_Minh',
        hours: [],
      });
      const availability = data.availability as Record<string, unknown>;
      expect(availability).toMatchObject({ online: false, reason: 'NO_BUSINESS_HOURS' });
      expect(String(availability.evaluated_at)).toMatch(EVALUATED_AT);
      expect(response.text).not.toMatch(/accepting/i);
    });

    it('a profile update followed by a read round-trips every field', async () => {
      const owner = await createShopOwner(app);
      const put = await putProfile(app, owner.token, profileBody(owner));
      expect(put.status).toBe(200);
      const data = dataOf(await getShop(app, owner.token));
      expect(data).toMatchObject({
        name: 'Quán Mới',
        contact_phone: '+84912345678',
        address_text: '5 Phố Huế, Hai Bà Trưng',
        zalo: 'zalo.new',
        facebook: null,
        pickup_lat: 21.0123,
        pickup_lng: 105.8456,
        version: 3,
      });
    });

    it('requires authentication, the SHOP context and ownership', async () => {
      expect((await getShop(app, undefined)).status).toBe(401);

      const roleless = await registerUser(app);
      const r = await getShop(app, roleless.accessToken);
      expect([r.status, errorCode(r)]).toEqual([403, 'SHOP_ROLE_REQUIRED']);

      // A user with both roles whose current context is DRIVER.
      const both = await createShopOwner(app);
      await grantRole(app.pool, both.userId, 'DRIVER');
      expect((await app.call('POST', '/auth/role/select', { bearer: both.token, body: { role: 'DRIVER' } })).status).toBe(200);
      const d = await getShop(app, both.token);
      expect([d.status, errorCode(d)]).toEqual([403, 'SHOP_ROLE_REQUIRED']);
      for (const response of [
        await putProfile(app, both.token, profileBody(both)),
        await putHours(app, both.token, hoursBody([])),
      ]) {
        expect([response.status, errorCode(response)]).toEqual([403, 'SHOP_ROLE_REQUIRED']);
      }

      // A SHOP session without an OWNER membership (the membership was removed).
      const orphan = await createShopOwner(app);
      await app.pool.query('DELETE FROM app.shop_members WHERE user_id = $1::uuid', [orphan.userId]);
      const o = await getShop(app, orphan.token);
      expect([o.status, errorCode(o)]).toEqual([404, 'SHOP_NOT_FOUND']);
      const w = await putHours(app, orphan.token, hoursBody([]));
      expect([w.status, errorCode(w)]).toEqual([404, 'SHOP_NOT_FOUND']);
    });

    it('each owner sees only their own shop', async () => {
      const a = await createShopOwner(app);
      const b = await createShopOwner(app);
      expect(dataOf(await getShop(app, a.token)).shop_id).toBe(a.shopId);
      expect(dataOf(await getShop(app, b.token)).shop_id).toBe(b.shopId);
    });

    it('a read mutates nothing: no audit, no event, no idempotency record, no version change', async () => {
      const owner = await createShopOwner(app);
      const before = await shopState(app.pool, owner);
      await getShop(app, owner.token);
      await getShop(app, owner.token);
      expect(await shopState(app.pool, owner)).toEqual(before);
    });
  });

  describe('A02 — DISABLED is readable but read-only; INCOMPLETE belongs to onboarding', () => {
    it('DISABLED: GET answers OFFLINE / SHOP_DISABLED, every PUT is refused and changes nothing', async () => {
      const owner = await createShopOwner(app);
      await app.pool.query("UPDATE app.shops SET status = 'DISABLED' WHERE shop_id = $1::uuid", [owner.shopId]);
      const read = await getShop(app, owner.token);
      expect(read.status).toBe(200);
      expect(dataOf(read).availability).toMatchObject({ online: false, reason: 'SHOP_DISABLED' });
      const before = await shopState(app.pool, owner);
      for (const response of [
        await putProfile(app, owner.token, profileBody(owner)),
        await putHours(app, owner.token, hoursBody([interval(1, 0, 600)])),
      ]) {
        expect([response.status, errorCode(response)]).toEqual([403, 'SHOP_DISABLED']);
      }
      expect(await shopState(app.pool, owner)).toEqual(before);
    });

    it('INCOMPLETE: GET answers SHOP_INCOMPLETE, every PUT is refused with SHOP_PROFILE_INCOMPLETE', async () => {
      const owner = await createShopOwner(app);
      await app.pool.query("UPDATE app.shops SET status = 'INCOMPLETE' WHERE shop_id = $1::uuid", [owner.shopId]);
      const read = await getShop(app, owner.token);
      expect(read.status).toBe(200);
      expect(dataOf(read).availability).toMatchObject({ online: false, reason: 'SHOP_INCOMPLETE' });
      const before = await shopState(app.pool, owner);
      for (const response of [
        await putProfile(app, owner.token, profileBody(owner)),
        await putHours(app, owner.token, hoursBody([])),
      ]) {
        expect([response.status, errorCode(response)]).toEqual([409, 'SHOP_PROFILE_INCOMPLETE']);
      }
      expect(await shopState(app.pool, owner)).toEqual(before);
    });
  });

  describe('A03 — profile update', () => {
    it('accepts a contact phone different from the login phone and records one audit, one event, one record', async () => {
      const owner = await createShopOwner(app);
      const before = await shopState(app.pool, owner);
      const response = await putProfile(app, owner.token, profileBody(owner, { contact_phone: '0933333333' }));
      expect(response.status).toBe(200);
      expect(dataOf(response)).toMatchObject({
        shop_id: owner.shopId,
        version: 3,
        profile: { contact_phone: '+84933333333', name: 'Quán Mới', service_area_id: owner.areaId },
      });
      const after = await shopState(app.pool, owner);
      expect(after).toMatchObject({ version: 3, name: 'Quán Mới', contact: '+84933333333', acceptingOrders: false });
      expect([after.audits - before.audits, after.events - before.events, after.records - before.records]).toEqual([1, 1, 1]);
      const audit = await app.pool.query(
        "SELECT action, outcome, resource_id::text AS resource_id FROM app.audit_logs WHERE request_id = $1::uuid AND action LIKE 'shop.%'",
        [response.requestId],
      );
      expect(audit.rows).toEqual([{ action: 'shop.profile.update.v1', outcome: 'SUCCESS', resource_id: owner.shopId }]);
      const event = await app.pool.query(
        "SELECT payload FROM app.outbox_events WHERE event_type = 'shop.profile_updated.v1' AND resource_id::text = $1",
        [owner.shopId],
      );
      expect(event.rows).toEqual([{ payload: { shop_id: owner.shopId, version: 3 } }]);
    });

    it('grants no role and changes neither status nor the legacy accepting_orders', async () => {
      const owner = await createShopOwner(app);
      const roles = () => countRows(app.pool, 'SELECT 1 FROM app.user_roles WHERE user_id = $1::uuid', [owner.userId]);
      const rolesBefore = await roles();
      await putProfile(app, owner.token, profileBody(owner));
      expect(await roles()).toBe(rolesBefore);
      expect(await shopState(app.pool, owner)).toMatchObject({ status: 'ACTIVE', acceptingOrders: false });
    });

    it.each([
      ['latitude out of range', { pickup_lat: 91 }],
      ['longitude out of range', { pickup_lng: 181 }],
      ['null latitude', { pickup_lat: null }],
      ['malformed service area', { service_area_id: 'nope' }],
      ['blank name', { name: '  ' }],
      ['invalid phone', { contact_phone: '12345' }],
      ['version 0', { expected_version: 0 }],
    ])('rejects %s as BAD_REQUEST without writing', async (_label, patch) => {
      const owner = await createShopOwner(app);
      const before = await shopState(app.pool, owner);
      const response = await putProfile(app, owner.token, profileBody(owner, patch));
      expect([response.status, errorCode(response)]).toEqual([400, 'BAD_REQUEST']);
      expect(await shopState(app.pool, owner)).toEqual(before);
    });

    it('refuses an unknown and an INACTIVE service area with INVALID_SERVICE_AREA without writing', async () => {
      const owner = await createShopOwner(app);
      const before = await shopState(app.pool, owner);
      const unknown = await putProfile(app, owner.token, profileBody(owner, { service_area_id: randomUUID() }));
      expect([unknown.status, errorCode(unknown)]).toEqual([400, 'INVALID_SERVICE_AREA']);
      const inactive = await createServiceArea(app.pool, 'INACTIVE');
      const refused = await putProfile(app, owner.token, profileBody(owner, { service_area_id: inactive }));
      expect([refused.status, errorCode(refused)]).toEqual([400, 'INVALID_SERVICE_AREA']);
      expect(await shopState(app.pool, owner)).toEqual(before);
    });

    it('moves the shop to another ACTIVE service area', async () => {
      const owner = await createShopOwner(app);
      const other = await createServiceArea(app.pool);
      const response = await putProfile(app, owner.token, profileBody(owner, { service_area_id: other }));
      expect(response.status).toBe(200);
      expect(dataOf(await getShop(app, owner.token)).service_area_id).toBe(other);
    });

    it.each([
      'user_id', 'shop_id', 'status', 'role', 'roles', 'version', 'accepting_orders', 'availability', 'online',
      'platform_fee', 'commission_rate', 'is_admin', 'admin', 'approved', 'owner_id', 'member_role',
    ])('refuses the privileged/unknown field %s and writes nothing', async (field) => {
      const owner = await createShopOwner(app);
      const before = await shopState(app.pool, owner);
      const response = await putProfile(app, owner.token, profileBody(owner, { [field]: field === 'status' ? 'ACTIVE' : true }));
      expect([response.status, errorCode(response)]).toEqual([400, 'BAD_REQUEST']);
      expect(await shopState(app.pool, owner)).toEqual(before);
    });

    it('requires a valid Idempotency-Key', async () => {
      const owner = await createShopOwner(app);
      const missing = await putProfile(app, owner.token, profileBody(owner), null);
      expect([missing.status, errorCode(missing)]).toEqual([400, 'IDEMPOTENCY_KEY_REQUIRED']);
      const invalid = await putProfile(app, owner.token, profileBody(owner), 'not-a-uuid');
      expect([invalid.status, errorCode(invalid)]).toEqual([400, 'INVALID_IDEMPOTENCY_KEY']);
    });
  });

  describe('A04 / A05 — the weekly schedule', () => {
    it('stores a normal week with several intervals a day, replacing the previous schedule completely', async () => {
      const owner = await createShopOwner(app);
      const first = [interval(1, 480, 720), interval(1, 840, 1260), interval(2, 480, 1260)];
      const put = await putHours(app, owner.token, hoursBody(first));
      expect(put.status).toBe(200);
      expect(dataOf(put)).toEqual({
        shop_id: owner.shopId,
        version: 3,
        timezone: 'Asia/Ho_Chi_Minh',
        intervals: first,
      });
      expect(await hoursOf(app.pool, owner.shopId)).toEqual(first);
      expect(dataOf(await getShop(app, owner.token)).hours).toEqual(first);

      const second = [interval(5, 600, 900)];
      expect((await putHours(app, owner.token, hoursBody(second, 3))).status).toBe(200);
      expect(await hoursOf(app.pool, owner.shopId)).toEqual(second);
      expect((await shopState(app.pool, owner)).version).toBe(4);
    });

    it('[] is the closed-all-week schedule and clears the rows', async () => {
      const owner = await createShopOwner(app);
      await putHours(app, owner.token, hoursBody([interval(1, 0, 600)]));
      const cleared = await putHours(app, owner.token, hoursBody([], 3));
      expect(cleared.status).toBe(200);
      expect(dataOf(cleared).intervals).toEqual([]);
      expect(await hoursOf(app.pool, owner.shopId)).toEqual([]);
      expect(dataOf(await getShop(app, owner.token)).availability).toMatchObject({ reason: 'NO_BUSINESS_HOURS' });
    });

    it('"whole week" is seven explicit days of 00:00-24:00; both spellings of a full day are stored canonically', async () => {
      const owner = await createShopOwner(app);
      const week = [1, 2, 3, 4, 5, 6, 7].map((day) => interval(day, 0, 1440));
      expect((await putHours(app, owner.token, hoursBody(week))).status).toBe(200);
      expect(await hoursOf(app.pool, owner.shopId)).toEqual(week);
      const alternative = [1, 2, 3, 4, 5, 6, 7].map((day) => interval(day, 0, 0, 1));
      expect((await putHours(app, owner.token, hoursBody(alternative, 3))).status).toBe(200);
      expect(await hoursOf(app.pool, owner.shopId)).toEqual(week);
      const weekdayZero = await putHours(app, owner.token, hoursBody([interval(0, 0, 1440)], 4));
      expect([weekdayZero.status, errorCode(weekdayZero)]).toEqual([400, 'INVALID_BUSINESS_HOURS']);
      expect(await app.pool.query('SELECT 1 FROM app.shop_business_hours WHERE weekday = 0')).toMatchObject({ rowCount: 0 });
    });

    it('overnight and Sunday -> Monday intervals are legal; adjacency is legal and not merged', async () => {
      const owner = await createShopOwner(app);
      const schedule = [
        interval(1, 120, 600), // Monday after the Sunday overnight tail ends at 02:00
        interval(1, 600, 720), // adjacent: closes exactly when the next opens
        interval(3, 1080, 120, 1), // Wednesday 18:00 -> Thursday 02:00
        interval(7, 1320, 120, 1), // Sunday 22:00 -> Monday 02:00
      ];
      const put = await putHours(app, owner.token, hoursBody(schedule));
      expect(put.status).toBe(200);
      expect(await hoursOf(app.pool, owner.shopId)).toEqual(schedule);
    });

    it('rejects overlaps (same day, across midnight, Sunday -> Monday), more than 28 intervals and bad values, keeping the old schedule', async () => {
      const owner = await createShopOwner(app);
      const original = [interval(2, 600, 900)];
      await putHours(app, owner.token, hoursBody(original));
      const day = (d: number) => [interval(d, 0, 100), interval(d, 200, 300), interval(d, 400, 500), interval(d, 600, 700)];
      const tooMany = [1, 2, 3, 4, 5, 6, 7].flatMap(day).concat([interval(1, 800, 900)]);
      const bad: Array<[string, unknown[]]> = [
        ['same-day overlap', [interval(1, 0, 100), interval(1, 50, 150)]],
        ['duplicate', [interval(1, 0, 100), interval(1, 0, 100)]],
        ['overnight into the next interval', [interval(1, 1080, 120, 1), interval(2, 60, 200)]],
        ['Sunday tail into Monday', [interval(7, 1320, 120, 1), interval(1, 60, 200)]],
        ['29 intervals', tooMany],
        ['end before start', [interval(1, 600, 600)]],
        ['more than 24 hours', [interval(1, 60, 120, 1)]],
        ['weekday 8', [interval(8, 0, 60)]],
      ];
      for (const [label, intervals] of bad) {
        const response = await putHours(app, owner.token, hoursBody(intervals, 3));
        expect([label, response.status, errorCode(response)]).toEqual([label, 400, 'INVALID_BUSINESS_HOURS']);
      }
      expect(await hoursOf(app.pool, owner.shopId)).toEqual(original);
      expect((await shopState(app.pool, owner)).version).toBe(3);
    });

    it('28 intervals (the maximum) are accepted', async () => {
      const owner = await createShopOwner(app);
      const day = (d: number) => [interval(d, 0, 100), interval(d, 200, 300), interval(d, 400, 500), interval(d, 600, 700)];
      const full = [1, 2, 3, 4, 5, 6, 7].flatMap(day);
      expect((await putHours(app, owner.token, hoursBody(full))).status).toBe(200);
      expect(await hoursOf(app.pool, owner.shopId)).toHaveLength(28);
    });

    it('refuses a malformed shape as BAD_REQUEST', async () => {
      const owner = await createShopOwner(app);
      for (const body of [
        { expected_version: 2 },
        { intervals: [] },
        { expected_version: 2, intervals: {} },
        { expected_version: 2, intervals: [{ weekday: 1 }] },
        { expected_version: 2, intervals: [{ ...interval(1, 0, 60), start_minute: '0' }] },
        { expected_version: 2, intervals: [{ ...interval(1, 0, 60), extra: 1 }] },
        { expected_version: 2, intervals: [], shop_id: owner.shopId },
      ]) {
        const response = await putHours(app, owner.token, body);
        expect([response.status, errorCode(response)]).toEqual([400, 'BAD_REQUEST']);
      }
    });
  });

  describe('A07 — there is no switch; availability follows the schedule and the clock', () => {
    it('no accepting-orders route exists, and accepting_orders is refused in both PUT bodies', async () => {
      const owner = await createShopOwner(app);
      for (const method of ['PUT', 'POST'] as const) {
        if (method === 'PUT') {
          const response = await app.call('PUT', '/shop/me/accepting-orders', {
            bearer: owner.token,
            body: { accepting_orders: true },
            headers: { 'idempotency-key': randomUUID() },
          });
          expect([response.status, errorCode(response)]).toEqual([404, 'NOT_FOUND']);
        } else {
          const response = await app.call('POST', '/shop/me/accepting-orders', {
            bearer: owner.token,
            body: { accepting_orders: true },
            headers: { 'idempotency-key': randomUUID() },
          });
          expect(response.status).toBe(404);
        }
      }
      const profile = await putProfile(app, owner.token, profileBody(owner, { accepting_orders: true }));
      const hours = await putHours(app, owner.token, { ...hoursBody([]), accepting_orders: true });
      expect([profile.status, errorCode(profile)]).toEqual([400, 'BAD_REQUEST']);
      expect([hours.status, errorCode(hours)]).toEqual([400, 'BAD_REQUEST']);
      expect((await shopState(app.pool, owner)).acceptingOrders).toBe(false);
    });

    it('a 24-hour interval started 30 minutes ago is ONLINE; one that opens in two hours is OFFLINE; and back', async () => {
      const owner = await createShopOwner(app);
      const ago = await localSlot(app.pool, -30);
      // start = end with +1 day is exactly 24 hours from `ago`, so now is inside it whatever the weekday.
      const covering = interval(ago.weekday, ago.minute, ago.minute, 1);
      expect((await putHours(app, owner.token, hoursBody([covering]))).status).toBe(200);
      expect(dataOf(await getShop(app, owner.token)).availability).toMatchObject({ online: true, reason: 'ONLINE' });

      const later = await localSlot(app.pool, 120);
      const upcoming = interval(later.weekday, later.minute, later.minute + 1);
      expect((await putHours(app, owner.token, hoursBody([upcoming], 3))).status).toBe(200);
      expect(dataOf(await getShop(app, owner.token)).availability).toMatchObject({
        online: false,
        reason: 'OUTSIDE_BUSINESS_HOURS',
      });

      expect((await putHours(app, owner.token, hoursBody([covering], 4))).status).toBe(200);
      expect(dataOf(await getShop(app, owner.token)).availability).toMatchObject({ online: true, reason: 'ONLINE' });
    });

    it('the legacy accepting_orders value (true or false) does not change availability', async () => {
      const owner = await createShopOwner(app);
      const ago = await localSlot(app.pool, -30);
      await putHours(app, owner.token, hoursBody([interval(ago.weekday, ago.minute, ago.minute, 1)]));
      const seen: unknown[] = [];
      for (const flag of [false, true, false]) {
        await app.pool.query('UPDATE app.shops SET accepting_orders = $2 WHERE shop_id = $1::uuid', [owner.shopId, flag]);
        const availability = dataOf(await getShop(app, owner.token)).availability as Record<string, unknown>;
        seen.push([availability.online, availability.reason]);
      }
      expect(seen).toEqual([[true, 'ONLINE'], [true, 'ONLINE'], [true, 'ONLINE']]);
    });
  });

  describe('A09 — idempotency', () => {
    async function overOwner(): Promise<{ owner: ShopOwner; key: string }> {
      return { owner: await createShopOwner(app), key: randomUUID() };
    }

    it('profile: the same key and request replays the exact response with no second effect', async () => {
      const { owner, key } = await overOwner();
      const body = profileBody(owner);
      const first = await putProfile(app, owner.token, body, key);
      const after = await shopState(app.pool, owner);
      const second = await putProfile(app, owner.token, body, key);
      expect([second.status, dataOf(second)]).toEqual([first.status, dataOf(first)]);
      expect(await shopState(app.pool, owner)).toEqual(after);
    });

    it('hours: a lost-response retry (same key, same body) replays; a reordered input is the same logical request', async () => {
      const { owner, key } = await overOwner();
      const a = interval(3, 600, 900);
      const b = interval(1, 480, 720);
      const first = await putHours(app, owner.token, hoursBody([a, b]), key);
      expect(first.status).toBe(200);
      const after = await shopState(app.pool, owner);
      const retry = await putHours(app, owner.token, hoursBody([a, b]), key);
      const reordered = await putHours(app, owner.token, hoursBody([b, a]), key);
      for (const replay of [retry, reordered]) {
        expect([replay.status, dataOf(replay)]).toEqual([200, dataOf(first)]);
      }
      expect(await shopState(app.pool, owner)).toEqual(after);
    });

    it('hours: the two spellings of a full day are one logical request (A18)', async () => {
      const { owner, key } = await overOwner();
      const first = await putHours(app, owner.token, hoursBody([interval(2, 0, 1440)]), key);
      const after = await shopState(app.pool, owner);
      const replay = await putHours(app, owner.token, hoursBody([interval(2, 0, 0, 1)]), key);
      expect([replay.status, dataOf(replay)]).toEqual([200, dataOf(first)]);
      expect(await shopState(app.pool, owner)).toEqual(after);
    });

    it('a changed body under the same key is IDEMPOTENCY_KEY_REUSED and writes nothing', async () => {
      const { owner, key } = await overOwner();
      await putHours(app, owner.token, hoursBody([interval(1, 0, 60)]), key);
      const after = await shopState(app.pool, owner);
      const changed = await putHours(app, owner.token, hoursBody([interval(1, 0, 90)]), key);
      expect([changed.status, errorCode(changed)]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
      const otherOperation = await putProfile(app, owner.token, profileBody(owner), key);
      expect(otherOperation.status).toBe(409);
      expect(await shopState(app.pool, owner)).toEqual(after);
    });

    it('a new key with a stale expected_version is VERSION_CONFLICT and writes nothing', async () => {
      const { owner } = await overOwner();
      await putHours(app, owner.token, hoursBody([interval(1, 0, 60)]));
      const after = await shopState(app.pool, owner);
      for (const response of [
        await putHours(app, owner.token, hoursBody([interval(2, 0, 60)], 2)),
        await putProfile(app, owner.token, profileBody(owner, { expected_version: 2 })),
      ]) {
        expect([response.status, errorCode(response)]).toEqual([409, 'VERSION_CONFLICT']);
      }
      expect(await shopState(app.pool, owner)).toEqual(after);
    });

    it('a refused request (error) does not consume its key: the same key works after the cause is fixed', async () => {
      const { owner, key } = await overOwner();
      const refused = await putHours(app, owner.token, hoursBody([interval(1, 0, 100), interval(1, 50, 150)]), key);
      expect(refused.status).toBe(400);
      const ok = await putHours(app, owner.token, hoursBody([interval(1, 0, 100)]), key);
      expect(ok.status).toBe(200);
    });
  });
});
