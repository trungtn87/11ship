import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  ApiResponse,
  AuthApp,
  countRows,
  createServiceArea,
  dataOf,
  DEVICE,
  errorCode,
  grantStrayRole,
  loginUser,
  randomPhone,
  registerUser,
  Registered,
  setUserStatus,
  sessionIdOfToken,
  shopProfileBody,
  startAuthApp,
} from './support/auth-fixtures';

// M01-A2S — Shop onboarding through the REAL Nest pipeline on a REAL PostgreSQL (acceptance A03-20..A03-25,
// the /auth/me projection, SHOP selection rules, privacy). Races and faults live in sibling suites.
describe('M01-A2S — Shop onboarding', () => {
  let app: AuthApp;

  beforeAll(async () => {
    app = await startAuthApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const saveProfile = (
    token: string | undefined,
    body: unknown,
    key: string | undefined = randomUUID(),
  ): Promise<ApiResponse> =>
    app.call('PUT', '/onboarding/shop/profile', {
      body,
      ...(token === undefined ? {} : { bearer: token }),
      ...(key === undefined ? {} : { headers: { 'idempotency-key': key } }),
    });

  const complete = (
    token: string | undefined,
    body: unknown,
    key: string | undefined = randomUUID(),
  ): Promise<ApiResponse> =>
    app.call('POST', '/onboarding/shop/complete', {
      body,
      ...(token === undefined ? {} : { bearer: token }),
      ...(key === undefined ? {} : { headers: { 'idempotency-key': key } }),
    });

  const me = (token: string): Promise<ApiResponse> => app.call('GET', '/auth/me', { bearer: token });
  const selectRole = (token: string, role: string): Promise<ApiResponse> =>
    app.call('POST', '/auth/role/select', { bearer: token, body: { role } });

  const GPS = { pickup_lat: 21.0285, pickup_lng: 105.8542 };

  async function shopRowsOf(userId: string): Promise<Array<Record<string, unknown>>> {
    const result = await app.pool.query(
      `SELECT s.shop_id, s.status, s.accepting_orders, s.version, s.name, s.service_area_id
         FROM app.shops s JOIN app.shop_members m ON m.shop_id = s.shop_id
        WHERE m.user_id = $1::uuid`,
      [userId],
    );
    return result.rows;
  }

  async function rolesOf(userId: string): Promise<string[]> {
    const result = await app.pool.query<{ role: string }>(
      'SELECT role FROM app.user_roles WHERE user_id = $1::uuid ORDER BY role',
      [userId],
    );
    return result.rows.map((row) => row.role);
  }

  async function onboardedEvents(userId: string): Promise<Array<{ payload: Record<string, unknown>; resource_id: string }>> {
    const result = await app.pool.query(
      `SELECT payload, resource_id FROM app.outbox_events
        WHERE event_type = 'shop.onboarded.v1' AND payload->>'user_id' = $1`,
      [userId],
    );
    return result.rows;
  }

  async function auditActions(requestId: string): Promise<string[]> {
    const result = await app.pool.query<{ action: string }>(
      'SELECT action FROM app.audit_logs WHERE request_id = $1::uuid ORDER BY action',
      [requestId],
    );
    return result.rows.map((row) => row.action);
  }

  /** A registered user with a complete INCOMPLETE shop (GPS + ACTIVE area). */
  async function completeDraft(): Promise<{ user: Registered; shopId: string; areaId: string; version: number }> {
    const user = await registerUser(app);
    const areaId = await createServiceArea(app.pool);
    const saved = await saveProfile(user.accessToken, shopProfileBody({ ...GPS, service_area_id: areaId }));
    expect(saved.status).toBe(201);
    return { user, shopId: String(dataOf(saved).shop_id), areaId, version: Number(dataOf(saved).version) };
  }

  describe('A03-20 — save and resume an INCOMPLETE profile', () => {
    it('creates one INCOMPLETE shop with its OWNER membership, grants no role and publishes no event', async () => {
      const user = await registerUser(app);
      const response = await saveProfile(user.accessToken, shopProfileBody());
      expect(response.status).toBe(201);
      const data = dataOf(response);
      expect(data).toEqual({ shop_id: expect.any(String), status: 'INCOMPLETE', version: 1, role_granted: false });

      const rows = await shopRowsOf(user.userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ shop_id: data.shop_id, status: 'INCOMPLETE', accepting_orders: false });
      expect(Number(rows[0]?.version)).toBe(1);
      expect(
        await countRows(app.pool, "SELECT 1 FROM app.shop_members WHERE user_id = $1::uuid AND member_role = 'OWNER'", [user.userId]),
      ).toBe(1);
      expect(await rolesOf(user.userId)).toEqual([]);
      expect(await onboardedEvents(user.userId)).toEqual([]);
      expect(await auditActions(response.requestId)).toEqual(['onboarding.shop.profile.save.v1']);
    });

    it('updates the draft at the exact version (200) and replaces every field', async () => {
      const user = await registerUser(app);
      const areaId = await createServiceArea(app.pool);
      const created = await saveProfile(user.accessToken, shopProfileBody({ name: 'First' }));
      const updated = await saveProfile(
        user.accessToken,
        shopProfileBody({ name: 'Second', ...GPS, service_area_id: areaId, zalo: null, expected_version: 1 }),
      );
      expect(updated.status).toBe(200);
      expect(dataOf(updated)).toEqual({ shop_id: dataOf(created).shop_id, status: 'INCOMPLETE', version: 2, role_granted: false });
      const rows = await shopRowsOf(user.userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ name: 'Second', service_area_id: areaId });
      expect(await auditActions(updated.requestId)).toEqual(['onboarding.shop.profile.save.v1']);
    });

    it('a stale expected_version is VERSION_CONFLICT, a second create is SHOP_ONBOARDING_EXISTS, nothing changes', async () => {
      const user = await registerUser(app);
      await saveProfile(user.accessToken, shopProfileBody({ name: 'Keep' }));
      const stale = await saveProfile(user.accessToken, shopProfileBody({ name: 'Lost', expected_version: 7 }));
      expect([stale.status, errorCode(stale)]).toEqual([409, 'VERSION_CONFLICT']);
      const again = await saveProfile(user.accessToken, shopProfileBody({ name: 'Lost' }));
      expect([again.status, errorCode(again)]).toEqual([409, 'SHOP_ONBOARDING_EXISTS']);
      const rows = await shopRowsOf(user.userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ name: 'Keep' });
      expect(Number(rows[0]?.version)).toBe(1);
    });

    it('expected_version without any draft is VERSION_CONFLICT and creates nothing', async () => {
      const user = await registerUser(app);
      const response = await saveProfile(user.accessToken, shopProfileBody({ expected_version: 1 }));
      expect([response.status, errorCode(response)]).toEqual([409, 'VERSION_CONFLICT']);
      expect(await shopRowsOf(user.userId)).toEqual([]);
    });

    it("never touches another user's shop: the caller always acts on their own", async () => {
      const first = await registerUser(app);
      const second = await registerUser(app);
      const created = await saveProfile(first.accessToken, shopProfileBody({ name: 'Mine' }));
      expect(created.status).toBe(201);
      const other = await saveProfile(second.accessToken, shopProfileBody({ name: 'Theirs', expected_version: 1 }));
      expect([other.status, errorCode(other)]).toEqual([409, 'VERSION_CONFLICT']);
      expect(await shopRowsOf(second.userId)).toEqual([]);
      expect((await shopRowsOf(first.userId))[0]).toMatchObject({ name: 'Mine' });
    });

    it('two users may use the same shop name and contact phone: only the OWNER rule is unique', async () => {
      const contact = randomPhone().local;
      const first = await registerUser(app);
      const second = await registerUser(app);
      expect((await saveProfile(first.accessToken, shopProfileBody({ contact_phone: contact }))).status).toBe(201);
      expect((await saveProfile(second.accessToken, shopProfileBody({ contact_phone: contact }))).status).toBe(201);
    });
  });

  describe('A03-21 — an incomplete profile cannot be completed', () => {
    it('refuses completion without GPS and service area, and without any profile', async () => {
      const none = await registerUser(app);
      const noProfile = await complete(none.accessToken, { expected_version: 1 });
      expect([noProfile.status, errorCode(noProfile)]).toEqual([409, 'SHOP_PROFILE_INCOMPLETE']);

      const user = await registerUser(app);
      await saveProfile(user.accessToken, shopProfileBody());
      const missing = await complete(user.accessToken, { expected_version: 1 });
      expect([missing.status, errorCode(missing)]).toEqual([409, 'SHOP_PROFILE_INCOMPLETE']);

      const areaOnly = await saveProfile(
        user.accessToken,
        shopProfileBody({ service_area_id: await createServiceArea(app.pool), expected_version: 1 }),
      );
      expect(areaOnly.status).toBe(200);
      const noGps = await complete(user.accessToken, { expected_version: 2 });
      expect([noGps.status, errorCode(noGps)]).toEqual([409, 'SHOP_PROFILE_INCOMPLETE']);

      const rows = await shopRowsOf(user.userId);
      expect(rows[0]).toMatchObject({ status: 'INCOMPLETE', accepting_orders: false });
      expect(await rolesOf(user.userId)).toEqual([]);
      expect(await onboardedEvents(user.userId)).toEqual([]);
    });

    it('a stale version on completion is VERSION_CONFLICT and changes nothing', async () => {
      const { user, version } = await completeDraft();
      const stale = await complete(user.accessToken, { expected_version: version + 1 });
      expect([stale.status, errorCode(stale)]).toEqual([409, 'VERSION_CONFLICT']);
      expect(await rolesOf(user.userId)).toEqual([]);
    });
  });

  describe('A03-22 — completion', () => {
    it('with GPS and an ACTIVE area: shop ACTIVE, accepting_orders=false, SHOP role, audit and outbox, no new token', async () => {
      const { user, shopId, version } = await completeDraft();
      const response = await complete(user.accessToken, { expected_version: version });
      expect(response.status).toBe(200);
      expect(dataOf(response)).toEqual({
        shop_id: shopId,
        status: 'ACTIVE',
        accepting_orders: false,
        role_granted: true,
        version: version + 1,
      });

      const rows = await shopRowsOf(user.userId);
      expect(rows[0]).toMatchObject({ status: 'ACTIVE', accepting_orders: false });
      expect(Number(rows[0]?.version)).toBe(version + 1);
      expect(await rolesOf(user.userId)).toEqual(['SHOP']);
      expect(await auditActions(response.requestId)).toEqual(['onboarding.shop.complete.v1']);

      const events = await onboardedEvents(user.userId);
      expect(events).toHaveLength(1);
      expect(events[0]?.payload).toEqual({ shop_id: shopId, user_id: user.userId });
      expect(events[0]?.resource_id).toBe(shopId);

      // No auto role-select and no new token: the session is exactly as it was.
      expect(Object.keys(dataOf(response)).some((key) => /token/i.test(key))).toBe(false);
      const session = await app.pool.query<{ active_role: string | null }>(
        'SELECT active_role FROM app.sessions WHERE session_id = $1::uuid',
        [await sessionIdOfToken(app.pool, user.accessToken)],
      );
      expect(session.rows[0]?.active_role).toBeNull();
    });

    it('an ACTIVE shop is no longer mutable through onboarding, and cannot be completed twice with a new key', async () => {
      const { user, version } = await completeDraft();
      expect((await complete(user.accessToken, { expected_version: version })).status).toBe(200);
      const edit = await saveProfile(user.accessToken, shopProfileBody({ expected_version: version + 1 }));
      expect([edit.status, errorCode(edit)]).toEqual([409, 'SHOP_ONBOARDING_EXISTS']);
      const create = await saveProfile(user.accessToken, shopProfileBody());
      expect([create.status, errorCode(create)]).toEqual([409, 'SHOP_ONBOARDING_EXISTS']);
      const again = await complete(user.accessToken, { expected_version: version + 1 });
      expect([again.status, errorCode(again)]).toEqual([409, 'SHOP_ONBOARDING_EXISTS']);
      expect(await onboardedEvents(user.userId)).toHaveLength(1);
    });
  });

  describe('A03-23 — idempotency', () => {
    it('the same key and body replays the stored result without a second effect (create and complete)', async () => {
      const user = await registerUser(app);
      const body = shopProfileBody();
      const key = randomUUID();
      const first = await saveProfile(user.accessToken, body, key);
      const replay = await saveProfile(user.accessToken, body, key);
      expect([first.status, replay.status]).toEqual([201, 201]);
      expect(dataOf(replay)).toEqual(dataOf(first));
      expect(await shopRowsOf(user.userId)).toHaveLength(1);

      const { user: owner, version } = await completeDraft();
      const completeKey = randomUUID();
      const done = await complete(owner.accessToken, { expected_version: version }, completeKey);
      const replayed = await complete(owner.accessToken, { expected_version: version }, completeKey);
      expect([done.status, replayed.status]).toEqual([200, 200]);
      expect(dataOf(replayed)).toEqual(dataOf(done));
      expect(await onboardedEvents(owner.userId)).toHaveLength(1);
      expect(
        await countRows(app.pool, "SELECT 1 FROM app.audit_logs WHERE action = 'onboarding.shop.complete.v1' AND actor_id = $1", [owner.userId]),
      ).toBe(1);
    });

    it('the same key with a different body is IDEMPOTENCY_KEY_REUSED and changes nothing', async () => {
      const user = await registerUser(app);
      const key = randomUUID();
      expect((await saveProfile(user.accessToken, shopProfileBody({ name: 'One' }), key)).status).toBe(201);
      const reused = await saveProfile(user.accessToken, shopProfileBody({ name: 'Two', expected_version: 1 }), key);
      expect([reused.status, errorCode(reused)]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
      expect((await shopRowsOf(user.userId))[0]).toMatchObject({ name: 'One' });
    });

    it('absent and null optional fields are the same logical request', async () => {
      const user = await registerUser(app);
      const key = randomUUID();
      const base = { name: 'N', contact_phone: randomPhone().local, address_text: 'A' };
      const first = await saveProfile(user.accessToken, base, key);
      const second = await saveProfile(
        user.accessToken,
        { ...base, zalo: null, facebook: null, pickup_lat: null, pickup_lng: null, service_area_id: null, expected_version: null },
        key,
      );
      expect([first.status, second.status]).toEqual([201, 201]);
      expect(dataOf(second)).toEqual(dataOf(first));
    });

    it('two users may use the same Idempotency-Key: the scope is the authenticated user', async () => {
      const key = randomUUID();
      const first = await registerUser(app);
      const second = await registerUser(app);
      expect((await saveProfile(first.accessToken, shopProfileBody(), key)).status).toBe(201);
      expect((await saveProfile(second.accessToken, shopProfileBody(), key)).status).toBe(201);
    });

    it('a replay is refused once the account is disabled (the stored result is not decrypted)', async () => {
      const user = await registerUser(app);
      const key = randomUUID();
      const body = shopProfileBody();
      expect((await saveProfile(user.accessToken, body, key)).status).toBe(201);
      await setUserStatus(app.pool, user.userId, 'DISABLED');
      const replay = await saveProfile(user.accessToken, body, key);
      expect(replay.status).toBeGreaterThanOrEqual(400);
      expect(replay.body.data).toBeUndefined();
    });

    it('requires a valid Idempotency-Key on both commands', async () => {
      const user = await registerUser(app);
      const missing = await saveProfile(user.accessToken, shopProfileBody(), undefined);
      expect([missing.status, errorCode(missing)]).toEqual([400, 'IDEMPOTENCY_KEY_REQUIRED']);
      const invalid = await saveProfile(user.accessToken, shopProfileBody(), 'not a key');
      expect([invalid.status, errorCode(invalid)]).toEqual([400, 'INVALID_IDEMPOTENCY_KEY']);
      const missingComplete = await complete(user.accessToken, { expected_version: 1 }, undefined);
      expect([missingComplete.status, errorCode(missingComplete)]).toEqual([400, 'IDEMPOTENCY_KEY_REQUIRED']);
      expect(await shopRowsOf(user.userId)).toEqual([]);
    });
  });

  describe('A03-25 — service area rules', () => {
    it('refuses an unknown, an INACTIVE and a malformed service area without writing', async () => {
      const user = await registerUser(app);
      const unknown = await saveProfile(user.accessToken, shopProfileBody({ service_area_id: randomUUID() }));
      expect([unknown.status, errorCode(unknown)]).toEqual([400, 'INVALID_SERVICE_AREA']);
      const inactive = await saveProfile(
        user.accessToken,
        shopProfileBody({ service_area_id: await createServiceArea(app.pool, 'INACTIVE') }),
      );
      expect([inactive.status, errorCode(inactive)]).toEqual([400, 'INVALID_SERVICE_AREA']);
      const malformed = await saveProfile(user.accessToken, shopProfileBody({ service_area_id: 'not-a-uuid' }));
      expect([malformed.status, errorCode(malformed)]).toEqual([400, 'BAD_REQUEST']);
      expect(await shopRowsOf(user.userId)).toEqual([]);
    });

    it('an area deactivated after the draft was saved blocks completion', async () => {
      const { user, areaId, version } = await completeDraft();
      await app.pool.query(
        "UPDATE app.service_areas SET status = 'INACTIVE', version = version + 1, updated_at = clock_timestamp() WHERE service_area_id = $1::uuid",
        [areaId],
      );
      const response = await complete(user.accessToken, { expected_version: version });
      expect([response.status, errorCode(response)]).toEqual([400, 'INVALID_SERVICE_AREA']);
      expect((await shopRowsOf(user.userId))[0]).toMatchObject({ status: 'INCOMPLETE' });
      expect(await rolesOf(user.userId)).toEqual([]);
    });
  });

  describe('strict input and authentication', () => {
    it('refuses security-sensitive and unknown fields without creating anything', async () => {
      const user = await registerUser(app);
      for (const extra of [
        { user_id: user.userId },
        { shop_id: randomUUID() },
        { role: 'SHOP' },
        { roles: ['SHOP'] },
        { status: 'ACTIVE' },
        { accepting_orders: true },
        { is_admin: true },
        { driver_type: 'PLATFORM' },
      ]) {
        const response = await saveProfile(user.accessToken, shopProfileBody(extra));
        expect([extra, response.status, errorCode(response)]).toEqual([extra, 400, 'BAD_REQUEST']);
      }
      const completeExtra = await complete(user.accessToken, { expected_version: 1, status: 'ACTIVE' });
      expect([completeExtra.status, errorCode(completeExtra)]).toEqual([400, 'BAD_REQUEST']);
      expect(await shopRowsOf(user.userId)).toEqual([]);
    });

    it('validates coordinates, text and phone', async () => {
      const user = await registerUser(app);
      for (const body of [
        shopProfileBody({ pickup_lat: 10 }),
        shopProfileBody({ pickup_lat: 95, pickup_lng: 10 }),
        shopProfileBody({ name: '   ' }),
        shopProfileBody({ name: 'x'.repeat(121) }),
      ]) {
        const response = await saveProfile(user.accessToken, body);
        expect([response.status, errorCode(response)]).toEqual([400, 'BAD_REQUEST']);
      }
      const phone = await saveProfile(user.accessToken, shopProfileBody({ contact_phone: '12345' }));
      expect([phone.status, errorCode(phone)]).toEqual([400, 'INVALID_PHONE']);
      expect(await shopRowsOf(user.userId)).toEqual([]);
    });

    it('requires a valid session', async () => {
      const missing = await saveProfile(undefined, shopProfileBody());
      expect(missing.status).toBe(401);
      const bogus = await saveProfile('x'.repeat(43), shopProfileBody());
      expect([bogus.status, errorCode(bogus)]).toEqual([401, 'SESSION_INVALID']);
      const completeMissing = await complete(undefined, { expected_version: 1 });
      expect(completeMissing.status).toBe(401);
    });

    it('a disabled account can neither save nor complete', async () => {
      const user = await registerUser(app);
      await saveProfile(user.accessToken, shopProfileBody());
      await setUserStatus(app.pool, user.userId, 'DISABLED');
      const save = await saveProfile(user.accessToken, shopProfileBody({ expected_version: 1 }));
      expect(save.status).toBeGreaterThanOrEqual(401);
      expect(save.status).toBeLessThanOrEqual(403);
      const done = await complete(user.accessToken, { expected_version: 1 });
      expect(done.status).toBeGreaterThanOrEqual(401);
      expect(done.status).toBeLessThanOrEqual(403);
      expect(await rolesOf(user.userId)).toEqual([]);
    });
  });

  describe('/auth/me onboarding projection and SHOP selection', () => {
    it('reports NOT_STARTED, INCOMPLETE and COMPLETED; DRIVER is the constant NOT_STARTED', async () => {
      const user = await registerUser(app);
      let data = dataOf(await me(user.accessToken));
      expect(data.onboarding).toEqual({ shop: 'NOT_STARTED', driver: 'NOT_STARTED' });
      expect(data.onboarding_required).toBe(true);

      const areaId = await createServiceArea(app.pool);
      await saveProfile(user.accessToken, shopProfileBody({ ...GPS, service_area_id: areaId }));
      data = dataOf(await me(user.accessToken));
      expect(data.onboarding).toEqual({ shop: 'INCOMPLETE', driver: 'NOT_STARTED' });
      expect(data.available_roles).toEqual([]);

      await complete(user.accessToken, { expected_version: 1 });
      data = dataOf(await me(user.accessToken));
      expect(data.onboarding).toEqual({ shop: 'COMPLETED', driver: 'NOT_STARTED' });
      expect(data.available_roles).toEqual(['SHOP']);
      expect(data.active_role).toBeNull(); // completion did not select the role
      expect(data.role_selection_required).toBe(true);
    });

    it('SHOP is selectable only for a completed shop: onboarding, then role/select works with the existing session', async () => {
      const { user, version } = await completeDraft();
      const before = await selectRole(user.accessToken, 'SHOP');
      expect([before.status, errorCode(before)]).toEqual([403, 'ROLE_NOT_AVAILABLE']);
      expect((await complete(user.accessToken, { expected_version: version })).status).toBe(200);
      const selected = await selectRole(user.accessToken, 'SHOP');
      expect(selected.status).toBe(200);
      expect(dataOf(selected).active_role).toBe('SHOP');
    });

    it('a stray SHOP role (no shop, or an INCOMPLETE one) is neither listed nor selectable, at /me, login and role/select', async () => {
      const user = await registerUser(app);
      await grantStrayRole(app.pool, user.userId, 'SHOP');
      for (const state of ['no shop', 'incomplete shop']) {
        if (state === 'incomplete shop') {
          await saveProfile(user.accessToken, shopProfileBody());
        }
        const data = dataOf(await me(user.accessToken));
        expect([state, data.available_roles, data.onboarding_required]).toEqual([state, [], true]);
        const select = await selectRole(user.accessToken, 'SHOP');
        expect([state, select.status, errorCode(select)]).toEqual([state, 403, 'ROLE_NOT_AVAILABLE']);
        const login = await loginUser(app, user, { ...DEVICE, device_id: `device-stray-${state.length}` });
        expect([state, dataOf(login).available_roles]).toEqual([state, []]);
      }
      expect(await countRows(app.pool, "SELECT 1 FROM app.sessions WHERE user_id = $1::uuid AND active_role = 'SHOP'", [user.userId])).toBe(0);
    });

    it('a DISABLED shop is COMPLETED but not selectable', async () => {
      const { user, version } = await completeDraft();
      await complete(user.accessToken, { expected_version: version });
      await app.pool.query(
        `UPDATE app.shops SET status = 'DISABLED', accepting_orders = false, version = version + 1, updated_at = clock_timestamp()
          WHERE shop_id IN (SELECT shop_id FROM app.shop_members WHERE user_id = $1::uuid)`,
        [user.userId],
      );
      const data = dataOf(await me(user.accessToken));
      expect(data.onboarding).toEqual({ shop: 'COMPLETED', driver: 'NOT_STARTED' });
      expect(data.available_roles).toEqual([]);
      const select = await selectRole(user.accessToken, 'SHOP');
      expect([select.status, errorCode(select)]).toEqual([403, 'ROLE_NOT_AVAILABLE']);
    });

    it('A1 regression after real onboarding: SHOP moves between devices and a DRIVER session is untouched', async () => {
      const { user, version } = await completeDraft();
      expect((await complete(user.accessToken, { expected_version: version })).status).toBe(200);
      // DRIVER onboarding does not exist yet: a bare DRIVER role row stands in for it, as in the A1 suites.
      await grantStrayRole(app.pool, user.userId, 'DRIVER');
      const login = async (deviceId: string): Promise<string> =>
        String(dataOf(await loginUser(app, user, { ...DEVICE, device_id: deviceId })).access_token);
      const deviceB = await login('device-onboarded-b');
      const driverDevice = await login('device-onboarded-d');

      expect((await selectRole(driverDevice, 'DRIVER')).status).toBe(200);
      expect((await selectRole(user.accessToken, 'SHOP')).status).toBe(200);
      expect((await selectRole(deviceB, 'SHOP')).status).toBe(200);

      const revoked = await me(user.accessToken);
      expect([revoked.status, errorCode(revoked)]).toEqual([401, 'SESSION_REVOKED']);
      expect(dataOf(await me(deviceB)).active_role).toBe('SHOP');
      expect(dataOf(await me(driverDevice)).active_role).toBe('DRIVER');
      expect(
        await countRows(app.pool, "SELECT 1 FROM app.sessions WHERE user_id = $1::uuid AND active_role = 'SHOP' AND revoked_at IS NULL", [user.userId]),
      ).toBe(1);
    });
  });

  describe('privacy', () => {
    it('shop name, address, contact phone, GPS and social links never reach audit, outbox, idempotency metadata or logs', async () => {
      const user = await registerUser(app);
      const marker = `PRIVMARK${randomUUID().replace(/-/g, '')}`;
      const contact = randomPhone();
      const areaId = await createServiceArea(app.pool);
      const body = shopProfileBody({
        name: `${marker}_NAME`,
        address_text: `${marker}_ADDRESS`,
        zalo: `${marker}_ZALO`,
        facebook: `${marker}_FACEBOOK`,
        contact_phone: contact.local,
        pickup_lat: 12.3456789,
        pickup_lng: 98.7654321,
        service_area_id: areaId,
      });
      const key = randomUUID();
      const saved = await saveProfile(user.accessToken, body, key);
      const completed = await complete(user.accessToken, { expected_version: 1 });
      expect([saved.status, completed.status]).toEqual([201, 200]);

      const surfaces = [
        (
          await app.pool.query<{ t: string }>(
            `SELECT row_to_json(a)::text AS t FROM app.audit_logs a WHERE a.request_id = ANY($1::uuid[])`,
            [[saved.requestId, completed.requestId]],
          )
        ).rows.map((row) => row.t),
        (
          await app.pool.query<{ t: string }>(
            `SELECT row_to_json(o)::text AS t FROM app.outbox_events o WHERE o.payload->>'user_id' = $1`,
            [user.userId],
          )
        ).rows.map((row) => row.t),
        // Metadata columns of the idempotency records (the replay payload itself is stored encrypted).
        (
          await app.pool.query<{ t: string }>(
            `SELECT (r.scope_id || r.operation_id || r.replay_guard::text) AS t
               FROM app.idempotency_records r WHERE r.scope_type = 'user' AND r.scope_id = $1`,
            [user.userId],
          )
        ).rows.map((row) => row.t),
        app.running.logs,
      ].flat();
      const text = surfaces.join('\n');
      for (const secret of [marker, contact.local, contact.normalized, contact.international, '12.3456789', '98.7654321']) {
        expect([secret, text.includes(secret)]).toEqual([secret, false]);
      }
      // The outbox payload is exactly the two identifiers.
      const events = await onboardedEvents(user.userId);
      expect(Object.keys(events[0]?.payload ?? {}).sort()).toEqual(['shop_id', 'user_id']);
    });

    it('error bodies never echo what the client sent', async () => {
      const user = await registerUser(app);
      const marker = `ECHOMARK${randomUUID().replace(/-/g, '')}`;
      const response = await saveProfile(user.accessToken, shopProfileBody({ name: marker, service_area_id: randomUUID() }));
      expect(response.status).toBe(400);
      expect(response.text).not.toContain(marker);
    });
  });
});
