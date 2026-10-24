import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  ApiResponse,
  AuthApp,
  countRows,
  createDriverFor,
  dataOf,
  errorCode,
  grantRole,
  grantStrayRole,
  installFault,
  obtainProof,
  PASSWORD,
  Phone,
  randomPhone,
  registerUser,
  removeFault,
  sessionIdOfToken,
  setUserStatus,
  startAuthApp,
} from './support/auth-fixtures';

// M01.05 — GET/PUT /v1/customer/me/profile and GET /v1/driver/me on the REAL Nest pipeline and a REAL PostgreSQL (TEST
// database only): own-profile reads, null states, identity only from the principal, name and version rules, replay under
// the current session and role, independence of the customer name from the driver profile, and all-or-nothing commits.
// Contract: docs/evidence/M01-05.md with contract10 sections 1-3 and contract11 sections 1-3.

const TERMS = 'test-terms-20261011-v1';
const PRIVACY = 'test-privacy-20261011-v1';
const WEB_FOOD = { device_id: 'web-food-0001', platform: 'WEB', app: 'FOOD' };
const WEB_SHIP = { device_id: 'web-ship-0001', platform: 'WEB', app: 'SHIP' };
const PROFILE_KEYS = ['user_id', 'full_name', 'version'];
// M03: the owner's view of the Shipper profile. The internal classification (driver_type) is NOT part of it.
const DRIVER_KEYS = [
  'accepting_deliveries',
  'bank',
  'can_edit_profile',
  'can_submit',
  'closure',
  'driver_id',
  'full_name',
  'phone',
  'plate_number',
  'presence',
  'readiness',
  'rejection_reason',
  'review_state',
  'reviewed_at',
  'shipper_code',
  'status',
  'submitted_at',
  'suspension_reason',
  'user_id',
  'version',
];
const MAX_VERSION = 9007199254740991;
const AUDIT_ACTION = 'customer.profile.update.v1';
// Written with escapes so that the NFC form of the expected values cannot depend on how an editor stores this file.
const NAME_AN = 'Nguyễn Văn An';
const NAME_BINH = 'Nguyễn Văn Bình';
const NAME_BINH_UNNORMALIZED = '  Nguyễn 　Văn \t Bình\n';

interface Account {
  readonly phone: Phone;
  readonly password: string;
  readonly userId: string;
}

describe('M01.05 — own profile read model', () => {
  let app: AuthApp;

  beforeAll(async () => {
    app = await startAuthApp({}, { relaxTimeouts: true, configOverride: { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY } } });
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------------------------------- helpers

  /** A real CUSTOMER account created through the client registration (profile name NAME_AN, version 1). */
  async function newCustomer(): Promise<Account> {
    const phone = randomPhone();
    const proof = await obtainProof(app, phone);
    const response = await app.call('POST', '/client-auth/register', {
      headers: { 'idempotency-key': randomUUID() },
      body: {
        phone: phone.local,
        password: PASSWORD,
        verification_token: proof.proofToken,
        device: { ...WEB_FOOD },
        full_name: NAME_AN,
        consent: { terms_version: TERMS, privacy_version: PRIVACY },
      },
    });
    expect(response.status).toBe(201);
    return { phone, password: PASSWORD, userId: String(dataOf(response).user_id) };
  }

  /** A legacy account: ordinary and verified, with no CUSTOMER role and no profile row. */
  async function legacyAccount(): Promise<Account> {
    const legacy = await registerUser(app);
    return { phone: legacy.phone, password: legacy.password, userId: legacy.userId };
  }

  async function clientLogin(user: Account, device: Record<string, unknown> = { ...WEB_FOOD }): Promise<string> {
    const response = await app.call('POST', '/client-auth/login', {
      headers: { 'idempotency-key': randomUUID() },
      body: { phone: user.phone.local, password: user.password, device },
    });
    expect(response.status).toBe(200);
    return String(dataOf(response).access_token);
  }

  const getProfile = (token: string, query = '') => app.call('GET', `/customer/me/profile${query}`, { bearer: token });
  const getDriver = (token: string, query = '') => app.call('GET', `/driver/me${query}`, { bearer: token });
  const logout = (token: string) => app.call('POST', '/client-auth/logout', { bearer: token, body: {} });

  function putProfile(token: string, body: unknown, key: string | null = randomUUID(), query = ''): Promise<ApiResponse> {
    return app.call('PUT', `/customer/me/profile${query}`, {
      bearer: token,
      ...(key === null ? {} : { headers: { 'idempotency-key': key } }),
      body,
    });
  }

  const change = (version: number, name: string) => ({ full_name: name, expected_version: version });

  /** A GET that carries a body (fetch refuses to build one), to prove the route refuses it. */
  function getWithBody(path: string, token: string, body: string): Promise<{ status: number; code: string | undefined }> {
    const url = new URL(`${app.running.baseUrl}/v1${path}`);
    return new Promise((resolve, reject) => {
      const outgoing = httpRequest(
        {
          hostname: url.hostname,
          port: url.port,
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            'content-length': String(Buffer.byteLength(body)),
          },
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
          incoming.on('end', () => {
            let code: string | undefined;
            try {
              code = (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { error?: { code?: string } }).error?.code;
            } catch {
              code = undefined;
            }
            resolve({ status: incoming.statusCode ?? 0, code });
          });
        },
      );
      outgoing.on('error', reject);
      outgoing.end(body);
    });
  }

  async function profileRow(userId: string) {
    const result = await app.pool.query<{ full_name: string | null; version: string; created_at: Date; updated_at: Date }>(
      'SELECT full_name, version::text AS version, created_at, updated_at FROM app.customer_profiles WHERE user_id = $1::uuid',
      [userId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('profile row not found');
    }
    return { fullName: row.full_name, version: Number(row.version), createdAt: row.created_at.getTime(), updatedAt: row.updated_at.getTime() };
  }

  async function driverRow(userId: string) {
    const result = await app.pool.query(
      `SELECT driver_id, full_name, plate_number, driver_type, status, accepting_deliveries, version::text AS version, updated_at
         FROM app.drivers WHERE user_id = $1::uuid`,
      [userId],
    );
    return result.rows[0] as Record<string, unknown> | undefined;
  }

  const profileCount = (userId: string) => countRows(app.pool, 'SELECT 1 FROM app.customer_profiles WHERE user_id = $1::uuid', [userId]);
  const roleCount = (userId: string) => countRows(app.pool, 'SELECT 1 FROM app.user_roles WHERE user_id = $1::uuid', [userId]);
  const consentCount = (userId: string) => countRows(app.pool, 'SELECT 1 FROM app.user_consents WHERE user_id = $1::uuid', [userId]);
  const auditCount = (userId: string) =>
    countRows(app.pool, 'SELECT 1 FROM app.audit_logs WHERE actor_id = $1 AND action = $2', [userId, AUDIT_ACTION]);
  const anyAuditCount = (userId: string) => countRows(app.pool, 'SELECT 1 FROM app.audit_logs WHERE actor_id = $1', [userId]);
  const recordCount = (userId: string) =>
    countRows(app.pool, "SELECT 1 FROM app.idempotency_records WHERE scope_type = 'customer_profile' AND scope_id = $1", [userId]);
  const outboxCount = (userId: string) => countRows(app.pool, 'SELECT 1 FROM app.outbox_events WHERE resource_id = $1', [userId]);

  // ------------------------------------------------------------------------------------------ A — customer GET

  describe('A — GET /customer/me/profile', () => {
    it('returns the own profile in the exact shape, no-store, from either app, without choosing a context', async () => {
      const user = await newCustomer();
      const food = await clientLogin(user);
      const response = await getProfile(food);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(Object.keys(response.body)).toEqual(['data']);
      expect(Object.keys(dataOf(response))).toEqual(PROFILE_KEYS);
      expect(dataOf(response)).toEqual({ user_id: user.userId, full_name: NAME_AN, version: 1 });

      // A SHIP session whose active context is DRIVER reads and keeps that context: the read changes nothing.
      await grantRole(app.pool, user.userId, 'DRIVER');
      const ship = await clientLogin(user, { ...WEB_SHIP });
      const sessionId = await sessionIdOfToken(app.pool, ship);
      const read = await getProfile(ship);
      expect(read.status).toBe(200);
      expect(dataOf(read)).toEqual({ user_id: user.userId, full_name: NAME_AN, version: 1 });
      const stored = await app.pool.query<{ active_role: string | null }>('SELECT active_role FROM app.sessions WHERE session_id = $1::uuid', [
        sessionId,
      ]);
      expect(stored.rows[0]?.active_role).toBe('DRIVER');
    });

    it('a profile that never got a name reads full_name null with its version', async () => {
      const user = await legacyAccount();
      await grantStrayRole(app.pool, user.userId, 'CUSTOMER');
      await app.pool.query('INSERT INTO app.customer_profiles (user_id) VALUES ($1::uuid)', [user.userId]);
      const response = await getProfile(await clientLogin(user));
      expect(response.status).toBe(200);
      expect(dataOf(response)).toEqual({ user_id: user.userId, full_name: null, version: 1 });
    });

    it('a CUSTOMER without a profile row reads { data: null } and nothing is created', async () => {
      const user = await legacyAccount();
      await grantStrayRole(app.pool, user.userId, 'CUSTOMER');
      const roles = await roleCount(user.userId);
      const response = await getProfile(await clientLogin(user));
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ data: null });
      expect(await profileCount(user.userId)).toBe(0);
      expect(await roleCount(user.userId)).toBe(roles);
    });

    it('an account without the CUSTOMER role is ROLE_NOT_AVAILABLE and nothing is granted or created', async () => {
      const user = await legacyAccount();
      const token = await clientLogin(user);
      const response = await getProfile(token);
      expect([response.status, errorCode(response)]).toEqual([403, 'ROLE_NOT_AVAILABLE']);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await roleCount(user.userId)).toBe(0);
      expect(await profileCount(user.userId)).toBe(0);
    });

    it('refuses a missing, revoked or disabled session', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      const anonymous = await app.call('GET', '/customer/me/profile');
      expect([anonymous.status, errorCode(anonymous)]).toEqual([401, 'SESSION_INVALID']);
      expect(anonymous.headers.get('cache-control')).toBe('no-store');

      await setUserStatus(app.pool, user.userId, 'DISABLED');
      const disabled = await getProfile(token);
      expect([disabled.status, errorCode(disabled)]).toEqual([403, 'ACCOUNT_DISABLED']);
      await setUserStatus(app.pool, user.userId, 'ACTIVE');

      expect((await logout(token)).status).toBe(204);
      const revoked = await getProfile(token);
      expect([revoked.status, errorCode(revoked)]).toEqual([401, 'SESSION_REVOKED']);
    });

    it('takes no selector: a query parameter or a body is refused and another user is never reachable', async () => {
      const mine = await newCustomer();
      const other = await newCustomer();
      const token = await clientLogin(mine);
      for (const query of [`?user_id=${other.userId}`, `?driver_id=${randomUUID()}`, '?x=1']) {
        const response = await getProfile(token, query);
        expect([response.status, errorCode(response)]).toEqual([400, 'BAD_REQUEST']);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.text).not.toContain(other.userId);
      }
      for (const body of ['{}', JSON.stringify({ user_id: other.userId })]) {
        const response = await getWithBody('/customer/me/profile', token, body);
        expect([response.status, response.code]).toEqual([400, 'BAD_REQUEST']);
      }
      const own = await getProfile(token);
      expect(dataOf(own).user_id).toBe(mine.userId);
    });

    it('writes nothing: no audit row, no idempotency record, no change of the profile', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      const before = { audit: await anyAuditCount(user.userId), records: await recordCount(user.userId), row: await profileRow(user.userId) };
      expect((await getProfile(token)).status).toBe(200);
      expect((await getProfile(token)).status).toBe(200);
      expect(await anyAuditCount(user.userId)).toBe(before.audit);
      expect(await recordCount(user.userId)).toBe(before.records);
      expect(await profileRow(user.userId)).toEqual(before.row);
    });
  });

  // ---------------------------------------------------------------------------------------------- B — customer PUT

  describe('B — PUT /customer/me/profile: name, version, authorization', () => {
    it('normalizes the name, raises the version by exactly 1 and leaves one safe audit row and no outbox event', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      const before = await profileRow(user.userId);
      const outbox = await outboxCount(user.userId);

      const response = await putProfile(token, change(1, NAME_BINH_UNNORMALIZED));
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(Object.keys(dataOf(response))).toEqual(PROFILE_KEYS);
      expect(dataOf(response)).toEqual({ user_id: user.userId, full_name: NAME_BINH, version: 2 });

      const after = await profileRow(user.userId);
      expect(after.fullName).toBe(NAME_BINH);
      expect(after.version).toBe(2);
      expect(after.createdAt).toBe(before.createdAt);
      expect(after.updatedAt).toBeGreaterThanOrEqual(after.createdAt);
      expect(dataOf(await getProfile(token))).toEqual({ user_id: user.userId, full_name: NAME_BINH, version: 2 });

      expect(await auditCount(user.userId)).toBe(1);
      const audit = await app.pool.query<{ metadata: Record<string, unknown>; resource_type: string; resource_id: string; resource_version: string }>(
        'SELECT metadata, resource_type, resource_id, resource_version::text AS resource_version FROM app.audit_logs WHERE actor_id = $1 AND action = $2',
        [user.userId, AUDIT_ACTION],
      );
      const row = audit.rows[0];
      expect(row?.metadata).toEqual({ user_id: user.userId, from_version: 1, to_version: 2 });
      expect([row?.resource_type, row?.resource_id, row?.resource_version]).toEqual(['customer_profile', user.userId, '2']);
      expect(JSON.stringify(row)).not.toContain(token);
      expect(JSON.stringify(row)).not.toContain(NAME_BINH);
      expect(await recordCount(user.userId)).toBe(1);
      expect(await outboxCount(user.userId)).toBe(outbox);

      // The next change raises it by 1 again.
      const second = await putProfile(token, change(2, NAME_AN));
      expect(dataOf(second)).toEqual({ user_id: user.userId, full_name: NAME_AN, version: 3 });
    });

    it('accepts 120 code points and refuses an invalid name or body without changing anything', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      const long = '\u{1F600}'.repeat(120);
      const accepted = await putProfile(token, change(1, long));
      expect([accepted.status, dataOf(accepted).full_name, dataOf(accepted).version]).toEqual([200, long, 2]);

      const before = await profileRow(user.userId);
      const bodies: unknown[] = [
        change(2, '\u{1F600}'.repeat(121)),
        change(2, ''),
        change(2, '   '),
        change(2, 'a​b'),
        change(2, 'a\u0007b'),
        { full_name: 'An' },
        { expected_version: 2 },
        { full_name: 'An', expected_version: 2, user_id: user.userId },
        { full_name: 'An', expected_version: 2, driver_id: randomUUID() },
        change(0, 'An'),
        change(-1, 'An'),
        { full_name: 'An', expected_version: 1.5 },
        { full_name: 'An', expected_version: '2' },
        { full_name: 'An', expected_version: MAX_VERSION + 2 },
        [],
      ];
      for (const body of bodies) {
        const response = await putProfile(token, body);
        expect([response.status, errorCode(response)]).toEqual([400, 'BAD_REQUEST']);
      }
      const withQuery = await putProfile(token, change(2, 'An'), randomUUID(), `?user_id=${user.userId}`);
      expect([withQuery.status, errorCode(withQuery)]).toEqual([400, 'BAD_REQUEST']);
      expect(await profileRow(user.userId)).toEqual(before);
      expect(await auditCount(user.userId)).toBe(1);
    });

    it('a stale version is VERSION_CONFLICT and changes nothing; the key is not consumed', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      const before = await profileRow(user.userId);
      const key = randomUUID();
      for (const stale of [2, 7]) {
        const response = await putProfile(token, change(stale, 'Ten Moi'), key);
        expect([response.status, errorCode(response)]).toEqual([409, 'VERSION_CONFLICT']);
        expect(response.headers.get('cache-control')).toBe('no-store');
      }
      expect(await profileRow(user.userId)).toEqual(before);
      expect(await auditCount(user.userId)).toBe(0);
      expect(await recordCount(user.userId)).toBe(0);
      // The same key later succeeds with the right version: nothing was consumed.
      expect((await putProfile(token, change(1, 'Ten Moi'), key)).status).toBe(200);
    });

    it('a version that cannot be raised within the schema bound is VERSION_CONFLICT', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      await app.pool.query('UPDATE app.customer_profiles SET version = $2::bigint WHERE user_id = $1::uuid', [user.userId, MAX_VERSION]);
      const before = await profileRow(user.userId);
      const response = await putProfile(token, change(MAX_VERSION, 'Ten Moi'));
      expect([response.status, errorCode(response)]).toEqual([409, 'VERSION_CONFLICT']);
      expect(await profileRow(user.userId)).toEqual(before);
      expect(await auditCount(user.userId)).toBe(0);
    });

    it('two writers with the same expected version: exactly one wins, the other is VERSION_CONFLICT', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      const results = await Promise.all([putProfile(token, change(1, 'Ten Mot')), putProfile(token, change(1, 'Ten Hai'))]);
      expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
      expect(results.find((result) => result.status === 409)).toBeDefined();
      expect(errorCode(results.find((result) => result.status === 409) as ApiResponse)).toBe('VERSION_CONFLICT');
      expect((await profileRow(user.userId)).version).toBe(2);
      expect(await auditCount(user.userId)).toBe(1);
    });

    it('requires the Idempotency-Key', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      const missing = await putProfile(token, change(1, 'Ten Moi'), null);
      expect([missing.status, errorCode(missing)]).toEqual([400, 'IDEMPOTENCY_KEY_REQUIRED']);
      const invalid = await putProfile(token, change(1, 'Ten Moi'), 'not a valid key !');
      expect([invalid.status, errorCode(invalid)]).toEqual([400, 'INVALID_IDEMPOTENCY_KEY']);
      expect((await profileRow(user.userId)).version).toBe(1);
    });

    it('without the CUSTOMER role, or without a profile row, it is ROLE_NOT_AVAILABLE and creates nothing', async () => {
      const noRole = await legacyAccount();
      const noRoleToken = await clientLogin(noRole);
      const first = await putProfile(noRoleToken, change(1, 'Ten Moi'));
      expect([first.status, errorCode(first)]).toEqual([403, 'ROLE_NOT_AVAILABLE']);
      expect(await roleCount(noRole.userId)).toBe(0);
      expect(await profileCount(noRole.userId)).toBe(0);

      const noProfile = await legacyAccount();
      await grantStrayRole(app.pool, noProfile.userId, 'CUSTOMER');
      const second = await putProfile(await clientLogin(noProfile), change(1, 'Ten Moi'));
      expect([second.status, errorCode(second)]).toEqual([403, 'ROLE_NOT_AVAILABLE']);
      expect(await profileCount(noProfile.userId)).toBe(0);
      expect(await roleCount(noProfile.userId)).toBe(1);
      for (const userId of [noRole.userId, noProfile.userId]) {
        expect(await auditCount(userId)).toBe(0);
        expect(await recordCount(userId)).toBe(0);
      }
    });

    it('a disabled or revoked session cannot write', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      await setUserStatus(app.pool, user.userId, 'DISABLED');
      const disabled = await putProfile(token, change(1, 'Ten Moi'));
      expect([disabled.status, errorCode(disabled)]).toEqual([403, 'ACCOUNT_DISABLED']);
      await setUserStatus(app.pool, user.userId, 'ACTIVE');
      expect((await logout(token)).status).toBe(204);
      const revoked = await putProfile(token, change(1, 'Ten Moi'));
      expect([revoked.status, errorCode(revoked)]).toEqual([401, 'SESSION_REVOKED']);
      expect((await profileRow(user.userId)).version).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------------------------- C — replay

  describe('C — PUT replay', () => {
    it('replays the stored result without writing again, never moves the profile back, and refuses another body', async () => {
      const user = await newCustomer();
      const token = await clientLogin(user);
      const key = randomUUID();
      const first = await putProfile(token, change(1, NAME_BINH), key);
      expect(first.status).toBe(200);
      const afterFirst = await profileRow(user.userId);

      const replay = await putProfile(token, change(1, NAME_BINH), key);
      expect(replay.status).toBe(200);
      expect(dataOf(replay)).toEqual(dataOf(first));
      expect(await profileRow(user.userId)).toEqual(afterFirst);
      expect(await auditCount(user.userId)).toBe(1);
      expect(await recordCount(user.userId)).toBe(1);

      // Another change happens; the replay still answers with the stored result and restores nothing.
      expect((await putProfile(token, change(2, 'Ten Khac'))).status).toBe(200);
      const later = await profileRow(user.userId);
      const again = await putProfile(token, change(1, NAME_BINH), key);
      expect(again.status).toBe(200);
      expect(dataOf(again)).toEqual({ user_id: user.userId, full_name: NAME_BINH, version: 2 });
      expect(await profileRow(user.userId)).toEqual(later);
      expect(await auditCount(user.userId)).toBe(2);

      const other = await putProfile(token, change(1, 'Ten Khac Nua'), key);
      expect([other.status, errorCode(other)]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
      expect(await profileRow(user.userId)).toEqual(later);
    });

    it('re-checks the session and the role before it returns the stored result; another valid session may replay', async () => {
      const user = await newCustomer();
      const food = await clientLogin(user);
      const key = randomUUID();
      const first = await putProfile(food, change(1, NAME_BINH), key);
      expect(first.status).toBe(200);
      const committed = await profileRow(user.userId);

      // A different valid session of the same user (the other app) replays.
      const ship = await clientLogin(user, { ...WEB_SHIP });
      const viaShip = await putProfile(ship, change(1, NAME_BINH), key);
      expect(viaShip.status).toBe(200);
      expect(dataOf(viaShip)).toEqual(dataOf(first));

      // The role is gone: no stored result is returned.
      await app.pool.query("DELETE FROM app.user_roles WHERE user_id = $1::uuid AND role = 'CUSTOMER'", [user.userId]);
      const noRole = await putProfile(food, change(1, NAME_BINH), key);
      expect([noRole.status, errorCode(noRole)]).toEqual([403, 'ROLE_NOT_AVAILABLE']);
      expect(noRole.text).not.toContain(NAME_BINH);
      await grantStrayRole(app.pool, user.userId, 'CUSTOMER');

      // The account is disabled: no stored result either.
      await setUserStatus(app.pool, user.userId, 'DISABLED');
      const disabled = await putProfile(food, change(1, NAME_BINH), key);
      expect([disabled.status, errorCode(disabled)]).toEqual([403, 'ACCOUNT_DISABLED']);
      await setUserStatus(app.pool, user.userId, 'ACTIVE');

      // A revoked session cannot replay.
      expect((await logout(ship)).status).toBe(204);
      const revoked = await putProfile(ship, change(1, NAME_BINH), key);
      expect([revoked.status, errorCode(revoked)]).toEqual([401, 'SESSION_REVOKED']);

      expect(await profileRow(user.userId)).toEqual(committed);
      expect(await auditCount(user.userId)).toBe(1);
    });
  });

  // ------------------------------------------------------------------------------ D — customer edit vs driver

  describe('D — a customer edit does not touch the driver profile', () => {
    it('leaves the driver row, the roles and the consents unchanged, and GET /driver/me still shows the driver name', async () => {
      const user = await newCustomer();
      const driverId = await createDriverFor(app.pool, user.userId, { status: 'ACTIVE' });
      await grantStrayRole(app.pool, user.userId, 'DRIVER');
      const token = await clientLogin(user, { ...WEB_SHIP });
      const before = { driver: await driverRow(user.userId), roles: await roleCount(user.userId), consents: await consentCount(user.userId) };
      expect(before.driver).toBeDefined();

      const response = await putProfile(token, change(1, NAME_BINH));
      expect(response.status).toBe(200);

      expect(await driverRow(user.userId)).toEqual(before.driver);
      expect(await roleCount(user.userId)).toBe(before.roles);
      expect(await consentCount(user.userId)).toBe(before.consents);
      const driver = await getDriver(token);
      expect(dataOf(driver).driver_id).toBe(driverId);
      expect(dataOf(driver).full_name).toBe('Fixture driver');
      expect(dataOf(await getProfile(token)).full_name).toBe(NAME_BINH);
    });
  });

  // ------------------------------------------------------------------------------------------------- E — rollback

  describe('E — all-or-nothing commit', () => {
    const faults = [
      { name: 'test_fault_profile_audit', table: 'app.audit_logs', condition: (id: string) => `NEW.action = '${AUDIT_ACTION}' AND NEW.actor_id = '${id}'` },
      {
        name: 'test_fault_profile_record',
        table: 'app.idempotency_records',
        condition: (id: string) => `NEW.scope_type = 'customer_profile' AND NEW.scope_id = '${id}'`,
      },
    ];

    for (const fault of faults) {
      it(`a failure of ${fault.table} rolls back the name, the version, the audit row and the record together`, async () => {
        const user = await newCustomer();
        const token = await clientLogin(user);
        const key = randomUUID();
        const before = await profileRow(user.userId);
        const outbox = await outboxCount(user.userId);

        await installFault(app.pool, fault.name, fault.table, 'INSERT', fault.condition(user.userId));
        try {
          const response = await putProfile(token, change(1, NAME_BINH), key);
          expect(response.status).toBeGreaterThanOrEqual(500);
          expect(await profileRow(user.userId)).toEqual(before);
          expect(await auditCount(user.userId)).toBe(0);
          expect(await recordCount(user.userId)).toBe(0);
          expect(await outboxCount(user.userId)).toBe(outbox);
        } finally {
          await removeFault(app.pool, fault.name, fault.table);
        }

        // Nothing was consumed: the same key and body now commit once.
        const retry = await putProfile(token, change(1, NAME_BINH), key);
        expect(dataOf(retry)).toEqual({ user_id: user.userId, full_name: NAME_BINH, version: 2 });
        expect(await auditCount(user.userId)).toBe(1);
      });
    }
  });

  // ---------------------------------------------------------------------------------------- F — GET /driver/me

  describe('F — GET /driver/me', () => {
    it('is { data: null } for a user without a driver profile', async () => {
      const user = await newCustomer();
      const response = await getDriver(await clientLogin(user));
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.body).toEqual({ data: null });
    });

    for (const status of ['PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSING', 'CLOSED']) {
      it(`reads the own ${status} profile exactly as stored, from either app, without the DRIVER role or context`, async () => {
        const user = await newCustomer();
        const driverId = await createDriverFor(app.pool, user.userId, { status });
        const expected = {
          driver_id: driverId,
          user_id: user.userId,
          full_name: 'Fixture driver',
          plate_number: null,
          status,
          accepting_deliveries: false,
          version: 1,
        };
        for (const device of [{ ...WEB_FOOD }, { ...WEB_SHIP }]) {
          const response = await getDriver(await clientLogin(user, device));
          expect(response.status).toBe(200);
          expect(Object.keys(dataOf(response)).sort()).toEqual(DRIVER_KEYS);
          expect(dataOf(response)).toMatchObject(expected);
          expect(response.text).not.toContain('driver_type');
          expect(response.text).not.toContain('PLATFORM');
        }
      });
    }

    it('returns the plate and the accepting flag as stored and never the PLATFORM classification; a legacy account without CUSTOMER can read its driver', async () => {
      const user = await legacyAccount();
      const driverId = await createDriverFor(app.pool, user.userId, { status: 'ACTIVE' });
      await app.pool.query(
        `UPDATE app.drivers SET driver_type = 'PLATFORM', plate_number = '51A-123.45', accepting_deliveries = true,
                updated_at = clock_timestamp() WHERE user_id = $1::uuid`,
        [user.userId],
      );
      const response = await getDriver(await clientLogin(user, { ...WEB_SHIP }));
      expect(response.status).toBe(200);
      expect(dataOf(response)).toMatchObject({
        driver_id: driverId,
        user_id: user.userId,
        full_name: 'Fixture driver',
        plate_number: '51A-123.45',
        status: 'ACTIVE',
        accepting_deliveries: true,
        version: 1,
      });
      // Even a PLATFORM Shipper never learns it: the classification is not in any client response.
      expect(response.text).not.toMatch(/PLATFORM|EXTERNAL|driver_type/);
      // The customer profile of that account stays a separate thing: no CUSTOMER role, no customer profile.
      expect(errorCode(await getProfile(await clientLogin(user)))).toBe('ROLE_NOT_AVAILABLE');
    });

    it('never shows another user\'s driver and takes no selector, query or body', async () => {
      const owner = await newCustomer();
      const driverId = await createDriverFor(app.pool, owner.userId);
      const stranger = await newCustomer();
      const token = await clientLogin(stranger);

      expect((await getDriver(token)).body).toEqual({ data: null });
      for (const query of [`?driver_id=${driverId}`, `?user_id=${owner.userId}`, '?x=1']) {
        const response = await getDriver(token, query);
        expect([response.status, errorCode(response)]).toEqual([400, 'BAD_REQUEST']);
        expect(response.text).not.toContain(driverId);
      }
      const withBody = await getWithBody('/driver/me', token, JSON.stringify({ driver_id: driverId }));
      expect([withBody.status, withBody.code]).toEqual([400, 'BAD_REQUEST']);
    });

    it('refuses a missing, disabled or revoked session and writes nothing', async () => {
      const user = await newCustomer();
      await createDriverFor(app.pool, user.userId);
      const token = await clientLogin(user);
      const before = { audit: await anyAuditCount(user.userId), driver: await driverRow(user.userId) };
      const sessionId = await sessionIdOfToken(app.pool, token);

      expect((await getDriver(token)).status).toBe(200);
      expect(await anyAuditCount(user.userId)).toBe(before.audit);
      expect(await driverRow(user.userId)).toEqual(before.driver);
      const session = await app.pool.query<{ revoked: boolean }>('SELECT revoked_at IS NOT NULL AS revoked FROM app.sessions WHERE session_id = $1::uuid', [
        sessionId,
      ]);
      expect(session.rows[0]?.revoked).toBe(false);

      const anonymous = await app.call('GET', '/driver/me');
      expect([anonymous.status, errorCode(anonymous)]).toEqual([401, 'SESSION_INVALID']);
      expect(anonymous.headers.get('cache-control')).toBe('no-store');
      await setUserStatus(app.pool, user.userId, 'DISABLED');
      const disabled = await getDriver(token);
      expect([disabled.status, errorCode(disabled)]).toEqual([403, 'ACCOUNT_DISABLED']);
      await setUserStatus(app.pool, user.userId, 'ACTIVE');
      expect((await logout(token)).status).toBe(204);
      const revoked = await getDriver(token);
      expect([revoked.status, errorCode(revoked)]).toEqual([401, 'SESSION_REVOKED']);
    });
  });
});
