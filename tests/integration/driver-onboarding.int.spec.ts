import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  ApiResponse,
  AuthApp,
  countRows,
  createDriverFor,
  createServiceArea,
  dataOf,
  driverBody,
  errorCode,
  grantStrayRole,
  loginUser,
  registerUser,
  Registered,
  shopProfileBody,
  startAuthApp,
} from './support/auth-fixtures';

// M01-A2D — Driver onboarding through the REAL Nest pipeline on a REAL PostgreSQL (acceptance A03-26..A03-30,
// the Driver parts of C01..C08, the /auth/me projection, DRIVER selection rules, privacy). Races and faults
// live in sibling suites.
describe('M01-A2D — Driver onboarding', () => {
  let app: AuthApp;

  beforeAll(async () => {
    app = await startAuthApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const create = (token: string | undefined, body: unknown, key: string | null = randomUUID()): Promise<ApiResponse> =>
    app.call('POST', '/onboarding/driver', {
      body,
      ...(token === undefined ? {} : { bearer: token }),
      ...(key === null ? {} : { headers: { 'idempotency-key': key } }),
    });

  const me = (token: string): Promise<ApiResponse> => app.call('GET', '/auth/me', { bearer: token });
  const selectRole = (token: string, role: string): Promise<ApiResponse> =>
    app.call('POST', '/auth/role/select', { bearer: token, body: { role } });
  const count = (sql: string, values: unknown[]): Promise<number> => countRows(app.pool, sql, values);

  async function driverRowsOf(userId: string): Promise<Array<Record<string, unknown>>> {
    const result = await app.pool.query(
      `SELECT driver_id, user_id, full_name, plate_number, driver_type, status, accepting_deliveries, version
         FROM app.drivers WHERE user_id = $1::uuid`,
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
        WHERE event_type = 'driver.onboarded.v1' AND payload->>'user_id' = $1`,
      [userId],
    );
    return result.rows;
  }

  async function nothingWritten(user: Registered): Promise<void> {
    expect(await driverRowsOf(user.userId)).toEqual([]);
    expect(await rolesOf(user.userId)).toEqual([]);
    expect(await onboardedEvents(user.userId)).toEqual([]);
    expect(
      await count("SELECT 1 FROM app.idempotency_records WHERE scope_type = 'user' AND scope_id = $1 AND operation_id = 'onboarding.driver.create.v1'", [
        user.userId,
      ]),
    ).toBe(0);
  }

  describe('POST /onboarding/driver (A03-26)', () => {
    it('creates an EXTERNAL / PENDING / not-accepting Driver, the DRIVER role, one audit row and one event', async () => {
      const user = await registerUser(app);
      const response = await create(user.accessToken, driverBody({ full_name: '  Lê Văn Shipper  ' }));

      expect(response.status).toBe(201);
      const data = dataOf(response);
      expect(data).toMatchObject({
        status: 'ACTIVE',
        accepting_deliveries: false,
        role_granted: true,
        version: 1,
      });
      expect(Object.keys(data).sort()).toEqual(['accepting_deliveries', 'driver_id', 'role_granted', 'status', 'version']);
      // Creating the profile logs nobody in: no token, no selected role.
      expect(response.text).not.toContain('access_token');
      expect(response.text).not.toContain('refresh_token');

      const rows = await driverRowsOf(user.userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        driver_id: data.driver_id,
        full_name: 'Lê Văn Shipper',
        plate_number: '29A-123.45',
        driver_type: 'EXTERNAL',
        status: 'ACTIVE',
        accepting_deliveries: false,
      });
      expect(Number(rows[0]?.version)).toBe(1);
      expect(await rolesOf(user.userId)).toEqual(['DRIVER']);

      const audit = await app.pool.query<{ action: string; resource_type: string; resource_id: string }>(
        'SELECT action, resource_type, resource_id FROM app.audit_logs WHERE request_id = $1::uuid',
        [response.requestId],
      );
      expect(audit.rows).toEqual([
        { action: 'onboarding.driver.create.v1', resource_type: 'driver', resource_id: String(data.driver_id) },
      ]);
      const events = await onboardedEvents(user.userId);
      expect(events).toHaveLength(1);
      expect(events[0]?.payload).toEqual({ driver_id: data.driver_id, user_id: user.userId });
    });

    it('the plate is optional', async () => {
      const user = await registerUser(app);
      const body = driverBody();
      delete body.plate_number;
      const response = await create(user.accessToken, body);
      expect(response.status).toBe(201);
      expect((await driverRowsOf(user.userId))[0]?.plate_number).toBeNull();
    });

    it('does not select the role: /auth/me lists DRIVER, reports ACTIVE, and onboarding is not required again', async () => {
      const user = await registerUser(app);
      expect(dataOf(await me(user.accessToken))).toMatchObject({
        onboarding: { shop: 'NOT_STARTED', driver: 'NOT_STARTED' },
        onboarding_required: true,
      });
      expect((await create(user.accessToken, driverBody())).status).toBe(201);

      const data = dataOf(await me(user.accessToken));
      expect(data).toMatchObject({
        available_roles: ['DRIVER'],
        active_role: null,
        onboarding: { shop: 'NOT_STARTED', driver: 'ACTIVE' },
        onboarding_required: false,
        role_selection_required: true,
      });

      const selected = await selectRole(user.accessToken, 'DRIVER');
      expect(selected.status).toBe(200);
      expect(dataOf(selected)).toMatchObject({ active_role: 'DRIVER', available_roles: ['DRIVER'] });
      // Login reports the same.
      const login = dataOf(await loginUser(app, user, { device_id: 'device-driver-login', platform: 'ANDROID', app: 'SHIP11' }));
      expect([login.available_roles, login.onboarding_required, login.role_selection_required]).toEqual([['DRIVER'], false, true]);
    });
  });

  describe('validation and authentication (A03-27)', () => {
    it('needs a Bearer session and an Idempotency-Key', async () => {
      const user = await registerUser(app);
      const body = driverBody();
      const anonymous = await create(undefined, body);
      expect(anonymous.status).toBe(401);
      const noKey = await create(user.accessToken, body, null);
      expect([noKey.status, errorCode(noKey)]).toEqual([400, 'IDEMPOTENCY_KEY_REQUIRED']);
      const badKey = await create(user.accessToken, body, 'not-a-uuid');
      expect([badKey.status, errorCode(badKey)]).toEqual([400, 'INVALID_IDEMPOTENCY_KEY']);
      await nothingWritten(user);
    });

    it('rejects a body that is wrong in any way, and writes nothing', async () => {
      const user = await registerUser(app);
      const ok = (): Record<string, unknown> => driverBody();
      const without = (field: string): Record<string, unknown> => {
        const body = ok();
        delete body[field];
        return body;
      };
      const cases: Array<[string, unknown]> = [
        ['no full_name', without('full_name')],
        ['blank full_name', driverBody({ full_name: '   ' })],
        ['full_name over 120', driverBody({ full_name: 'x'.repeat(121) })],
        ['numeric full_name', driverBody({ full_name: 12 })],
        ['blank plate', driverBody({ plate_number: '  ' })],
        ['plate over 32', driverBody({ plate_number: 'p'.repeat(33) })],
        ['array body', [ok()]],
        ['null body', null],
        ['string body', 'driver'],
        ['unknown field', { ...ok(), nickname: 'x' }],
        ['forged status', { ...ok(), status: 'ACTIVE' }],
        ['forged driver_type PLATFORM', { ...ok(), driver_type: 'PLATFORM' }],
        ['forged driver_type SYSTEM', { ...ok(), driver_type: 'SYSTEM' }],
        ['admin role injection', { ...ok(), role: 'ADMIN', roles: ['ADMIN'], is_admin: true }],
        ['bank injection', { ...ok(), bank_account: '1234', bank_verified: true }],
        ['wallet injection', { ...ok(), wallet_balance: 1000, wallet_funded: true }],
        ['identity injection', { ...ok(), cccd: '012345678901', vehicle_type: 'MOTORBIKE' }],
        ['forged accepting_deliveries', { ...ok(), accepting_deliveries: true }],
        ['forged user_id', { ...ok(), user_id: randomUUID() }],
        ['forged version', { ...ok(), version: 9 }],
        ['forged driver_id', { ...ok(), driver_id: randomUUID() }],
        ['GPS', { ...ok(), latitude: 21.0, longitude: 105.8 }],
        ['camelCase field', { ...without('full_name'), fullName: 'X' }],
      ];
      for (const [label, body] of cases) {
        const response = await create(user.accessToken, body);
        expect([label, response.status]).toEqual([label, 400]);
      }
      await nothingWritten(user);
    });

    it('A03-29 (revised): legacy service_area_ids is an unknown field — generic 400, no effects, even with a valid ACTIVE area', async () => {
      const user = await registerUser(app);
      const active = await createServiceArea(app.pool);
      const legacy: Array<[string, unknown]> = [
        ['one valid active area', driverBody({ service_area_ids: [active] })],
        ['empty list', driverBody({ service_area_ids: [] })],
        ['null', driverBody({ service_area_ids: null })],
        ['unknown id', driverBody({ service_area_ids: [randomUUID()] })],
        ['duplicate ids', driverBody({ service_area_ids: [active, active] })],
        ['singular key', driverBody({ service_area_id: active })],
      ];
      for (const [label, body] of legacy) {
        const response = await create(user.accessToken, body);
        expect([label, response.status, errorCode(response)]).toEqual([label, 400, 'BAD_REQUEST']);
        expect(response.text).not.toContain(active);
      }
      await nothingWritten(user);
    });

    it('A03-28/29 (revised): full_name alone succeeds with no service-area fixture, no GPS and no plate', async () => {
      const user = await registerUser(app);
      const response = await create(user.accessToken, { full_name: 'Chỉ Có Tên' });
      expect(response.status).toBe(201);
      expect(await driverRowsOf(user.userId)).toMatchObject([{ full_name: 'Chỉ Có Tên', plate_number: null, status: 'ACTIVE' }]);
    });

    it('a refusal does not consume the key: the same key then succeeds with a valid body', async () => {
      const user = await registerUser(app);
      const key = randomUUID();
      expect((await create(user.accessToken, driverBody({ full_name: '   ' }), key)).status).toBe(400);
      expect((await create(user.accessToken, driverBody(), key)).status).toBe(201);
    });
  });

  describe('one Driver per user, replay and conflict (A03-28)', () => {
    it('a different key after success is DRIVER_PROFILE_EXISTS; the original profile is untouched', async () => {
      const user = await registerUser(app);
      const first = await create(user.accessToken, driverBody());
      expect(first.status).toBe(201);

      const second = await create(user.accessToken, driverBody({ full_name: 'Someone Else' }));
      expect([second.status, errorCode(second)]).toEqual([409, 'DRIVER_PROFILE_EXISTS']);

      const rows = await driverRowsOf(user.userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ driver_id: dataOf(first).driver_id, full_name: 'Nguyễn Văn Tài' });
      expect(await rolesOf(user.userId)).toEqual(['DRIVER']);
      expect(await onboardedEvents(user.userId)).toHaveLength(1);
    });

    it('the same key and request replays the first answer without a second effect', async () => {
      const user = await registerUser(app);
      const key = randomUUID();
      const first = await create(user.accessToken, driverBody(), key);
      const again = await create(user.accessToken, driverBody(), key);
      expect([first.status, again.status]).toEqual([201, 201]);
      expect(dataOf(again)).toEqual(dataOf(first));
      expect(await driverRowsOf(user.userId)).toHaveLength(1);
      expect(await onboardedEvents(user.userId)).toHaveLength(1);
      expect(await count("SELECT 1 FROM app.audit_logs WHERE actor_id = $1 AND action = 'onboarding.driver.create.v1'", [user.userId])).toBe(1);
    });

    it('the same key with a changed request is IDEMPOTENCY_KEY_REUSED and changes nothing', async () => {
      const user = await registerUser(app);
      const key = randomUUID();
      expect((await create(user.accessToken, driverBody(), key)).status).toBe(201);
      for (const body of [
        driverBody({ full_name: 'Changed Name' }),
        driverBody({ plate_number: '30B-999.99' }),
        driverBody({ plate_number: null }),
      ]) {
        const response = await create(user.accessToken, body, key);
        expect([response.status, errorCode(response)]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
      }
      expect((await driverRowsOf(user.userId))[0]?.full_name).toBe('Nguyễn Văn Tài');
    });

    it("another user's key scope is separate: the same key value works for two users", async () => {
      const key = randomUUID();
      const first = await registerUser(app);
      const second = await registerUser(app);
      expect((await create(first.accessToken, driverBody(), key)).status).toBe(201);
      expect((await create(second.accessToken, driverBody(), key)).status).toBe(201);
      expect(await driverRowsOf(first.userId)).toHaveLength(1);
      expect(await driverRowsOf(second.userId)).toHaveLength(1);
    });
  });

  describe('Shop and Driver for one user (A03-C03)', () => {
    it('Shop completion then Driver creation: both roles, both selectable, neither disturbs the other', async () => {
      const user = await registerUser(app);
      const shopArea = await createServiceArea(app.pool);
      const saved = await app.call('PUT', '/onboarding/shop/profile', {
        bearer: user.accessToken,
        body: shopProfileBody({ pickup_lat: 21.03, pickup_lng: 105.85, service_area_id: shopArea }),
        headers: { 'idempotency-key': randomUUID() },
      });
      expect(saved.status).toBe(201);
      const completed = await app.call('POST', '/onboarding/shop/complete', {
        bearer: user.accessToken,
        body: { expected_version: Number(dataOf(saved).version) },
        headers: { 'idempotency-key': randomUUID() },
      });
      expect(completed.status).toBe(200);
      expect((await create(user.accessToken, driverBody())).status).toBe(201);

      expect(await rolesOf(user.userId)).toEqual(['DRIVER', 'SHOP']);
      const data = dataOf(await me(user.accessToken));
      expect(data).toMatchObject({
        available_roles: ['DRIVER', 'SHOP'],
        onboarding: { shop: 'COMPLETED', driver: 'ACTIVE' },
        onboarding_required: false,
        role_selection_required: true,
      });
      expect((await selectRole(user.accessToken, 'SHOP')).status).toBe(200);
      expect((await selectRole(user.accessToken, 'DRIVER')).status).toBe(200);
    });

    it('Driver creation then Shop completion: the same result', async () => {
      const user = await registerUser(app);
      const shopArea = await createServiceArea(app.pool);
      expect((await create(user.accessToken, driverBody())).status).toBe(201);
      const saved = await app.call('PUT', '/onboarding/shop/profile', {
        bearer: user.accessToken,
        body: shopProfileBody({ pickup_lat: 21.03, pickup_lng: 105.85, service_area_id: shopArea }),
        headers: { 'idempotency-key': randomUUID() },
      });
      expect(saved.status).toBe(201);
      expect(dataOf(await me(user.accessToken))).toMatchObject({
        available_roles: ['DRIVER'],
        onboarding: { shop: 'INCOMPLETE', driver: 'ACTIVE' },
        onboarding_required: false,
      });
      const completed = await app.call('POST', '/onboarding/shop/complete', {
        bearer: user.accessToken,
        body: { expected_version: Number(dataOf(saved).version) },
        headers: { 'idempotency-key': randomUUID() },
      });
      expect(completed.status).toBe(200);
      expect(dataOf(await me(user.accessToken)).available_roles).toEqual(['DRIVER', 'SHOP']);
    });

    it('a Driver profile does not make SHOP available: without a completed shop it stays refused', async () => {
      const user = await registerUser(app);
      expect((await create(user.accessToken, driverBody())).status).toBe(201);
      expect(dataOf(await me(user.accessToken)).available_roles).toEqual(['DRIVER']);
      const shop = await selectRole(user.accessToken, 'SHOP');
      expect([shop.status, errorCode(shop)]).toEqual([403, 'ROLE_NOT_AVAILABLE']);
    });
  });

  describe('DRIVER selection and eligibility (C01..C08, Driver parts)', () => {
    async function projection(user: Registered, label: string): Promise<unknown[]> {
      const fromMe = dataOf(await me(user.accessToken));
      const fromLogin = dataOf(
        await loginUser(app, user, { device_id: `device-${label}`, platform: 'ANDROID', app: 'SHIP11' }),
      );
      return [fromMe, fromLogin].map((d) => [d.available_roles, d.onboarding_required, d.role_selection_required]);
    }

    it('a stray DRIVER role without a Driver profile is not offered and not selectable; onboarding is required', async () => {
      const user = await registerUser(app);
      await grantStrayRole(app.pool, user.userId, 'DRIVER');
      expect(await projection(user, 'stray')).toEqual([
        [[], true, false],
        [[], true, false],
      ]);
      const selected = await selectRole(user.accessToken, 'DRIVER');
      expect([selected.status, errorCode(selected)]).toEqual([403, 'ROLE_NOT_AVAILABLE']);
    });

    it('a Driver profile without the DRIVER role row is not offered', async () => {
      const user = await registerUser(app);
      await createDriverFor(app.pool, user.userId);
      const selected = await selectRole(user.accessToken, 'DRIVER');
      expect([selected.status, errorCode(selected)]).toEqual([403, 'ROLE_NOT_AVAILABLE']);
      expect(dataOf(await me(user.accessToken)).available_roles).toEqual([]);
    });

    for (const status of ['PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSING']) {
      it(`a ${status} Driver with the role stays selectable, listed by login and /me, and never sent to onboarding again`, async () => {
        const user = await registerUser(app);
        await grantStrayRole(app.pool, user.userId, 'DRIVER');
        await createDriverFor(app.pool, user.userId, { status });
        expect(await projection(user, `st-${status.toLowerCase()}`)).toEqual([
          [['DRIVER'], false, true],
          [['DRIVER'], false, true],
        ]);
        const selected = await selectRole(user.accessToken, 'DRIVER');
        expect([selected.status, dataOf(selected).active_role]).toEqual([200, 'DRIVER']);
      });
    }

    it('a CLOSED Driver is neither listed nor selectable, and onboarding is NOT asked for again (dead end avoided)', async () => {
      const user = await registerUser(app);
      await grantStrayRole(app.pool, user.userId, 'DRIVER');
      await createDriverFor(app.pool, user.userId, { status: 'CLOSED' });
      expect(await projection(user, 'closed')).toEqual([
        [[], false, false],
        [[], false, false],
      ]);
      const selected = await selectRole(user.accessToken, 'DRIVER');
      expect([selected.status, errorCode(selected)]).toEqual([403, 'ROLE_NOT_AVAILABLE']);
      expect(dataOf(await me(user.accessToken)).onboarding).toMatchObject({ driver: 'CLOSED' });
    });

    it('a user who already has a Driver profile cannot create another, whatever its status', async () => {
      for (const status of ['PENDING', 'CLOSED']) {
        const user = await registerUser(app);
        await createDriverFor(app.pool, user.userId, { status });
        const response = await create(user.accessToken, driverBody());
        expect([status, response.status, errorCode(response)]).toEqual([status, 409, 'DRIVER_PROFILE_EXISTS']);
        expect(await rolesOf(user.userId)).toEqual([]);
      }
    });

    it('an ACTIVE session whose Driver profile closes is refused the next selection', async () => {
      const user = await registerUser(app);
      expect((await create(user.accessToken, driverBody())).status).toBe(201);
      expect((await selectRole(user.accessToken, 'DRIVER')).status).toBe(200);
      await app.pool.query(
        "UPDATE app.drivers SET status = 'CLOSED', updated_at = clock_timestamp() WHERE user_id = $1::uuid",
        [user.userId],
      );
      const again = await selectRole(user.accessToken, 'DRIVER');
      expect([again.status, errorCode(again)]).toEqual([403, 'ROLE_NOT_AVAILABLE']);
    });
  });

  describe('privacy (A03-30)', () => {
    it('name, plate and the raw request never reach audit, outbox, idempotency metadata, responses to others or logs', async () => {
      const user = await registerUser(app);
      // Short enough for the 32-character plate once the suffix is added.
      const marker = `PM${randomUUID().replace(/-/g, '').slice(0, 14)}`;
      const key = randomUUID();
      const response = await create(
        user.accessToken,
        driverBody({ full_name: `${marker}_NAME`, plate_number: `${marker}_PLATE` }),
        key,
      );
      expect(response.status).toBe(201);
      expect(response.text).not.toContain(marker);

      const surfaces = [
        (
          await app.pool.query<{ t: string }>('SELECT row_to_json(a)::text AS t FROM app.audit_logs a WHERE a.request_id = $1::uuid', [
            response.requestId,
          ])
        ).rows.map((row) => row.t),
        (
          await app.pool.query<{ t: string }>(`SELECT row_to_json(o)::text AS t FROM app.outbox_events o WHERE o.payload->>'user_id' = $1`, [
            user.userId,
          ])
        ).rows.map((row) => row.t),
        (
          await app.pool.query<{ t: string }>(
            `SELECT (r.scope_id || r.operation_id || r.replay_guard::text) AS t
               FROM app.idempotency_records r WHERE r.scope_type = 'user' AND r.scope_id = $1`,
            [user.userId],
          )
        ).rows.map((row) => row.t),
        // /auth/me exposes the state, never the name or the plate.
        [(await me(user.accessToken)).text],
        app.running.logs,
      ].flat();
      const text = surfaces.join('\n');
      expect(text.includes(marker)).toBe(false);
      const events = await onboardedEvents(user.userId);
      expect(Object.keys(events[0]?.payload ?? {}).sort()).toEqual(['driver_id', 'user_id']);
    });

    it('error bodies never echo what the client sent', async () => {
      const user = await registerUser(app);
      const marker = `ECHOMARK${randomUUID().replace(/-/g, '')}`;
      const unknownField = await create(user.accessToken, { ...driverBody(), [marker]: 'x' });
      expect(unknownField.status).toBe(400);
      expect(unknownField.text).not.toContain(marker);
      const badName = await create(user.accessToken, driverBody({ full_name: marker.repeat(10) }));
      expect(badName.status).toBe(400);
      expect(badName.text).not.toContain(marker);
      const legacyArea = await create(user.accessToken, driverBody({ full_name: marker, service_area_ids: [randomUUID()] }));
      expect(legacyArea.status).toBe(400);
      expect(legacyArea.text).not.toContain(marker);
    });
  });
});
