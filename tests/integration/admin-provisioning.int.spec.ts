import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import {
  AdminApp,
  adminData,
  adminErrorCode,
  count,
  createAdminMember,
  enrollAndLogin,
  startAdminApp,
} from './support/admin-fixtures';
import { randomPhone } from './support/auth-fixtures';
import {
  api,
  createInvitation,
  createOperation,
  createPayload,
  insertRawInvitation,
  invitationRow,
  operationRow,
  permissions,
  relogin,
  sessionOf,
  stepUp,
  totpBucketFailures,
  SystemSession,
  systemSession,
  verifyOperation,
} from './support/provisioning-fixtures';

// M01-D-ADMIN-1B over the REAL Nest pipeline and PostgreSQL: authorization (AZ), parser (contract 6.1), operation state
// (ST, F5), create (CR), reissue/revoke (RI, F4), reads, audit (AU) and the ingress quota (LM). Concurrency, replay,
// step-up counters and the migration have their own suites. The web is for ADMIN/SYSTEM only: the routes are refused to
// an ADMIN-role session and to anything that is not an administration cookie (Customer/Shop/Driver use their apps).

const LINK = /^https:\/\/admin\.example\.test\/activate#t=([A-Za-z0-9_-]{43})$/;

describe('M01-D-ADMIN-1B - SYSTEM invitations over HTTP', () => {
  let app: AdminApp;
  let system: SystemSession;

  beforeAll(async () => {
    app = await startAdminApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.clearLimits();
    system = await systemSession(app);
  });

  async function invitationCount(): Promise<number> {
    return count(app.pool, 'SELECT 1 FROM app.admin_invitations');
  }

  async function operationCount(): Promise<number> {
    return count(app.pool, 'SELECT 1 FROM app.admin_sensitive_operations');
  }

  // ----- AZ ---------------------------------------------------------------------------------------------------------

  describe('authorization (AZ)', () => {
    it('refuses an ADMIN-role session on every route with ADMIN_FORBIDDEN and changes nothing', async () => {
      const created = await createInvitation(app, system);
      const systemOp = await createOperation(app, system, 'REVOKE_INVITATION', {
        invitation_id: created.invitationId,
        expected_version: 1,
        reason: 'test',
      });
      await app.clearLimits();
      const member = await createAdminMember(app);
      const memberLogin = await enrollAndLogin(app, member);
      const as = sessionOf({ login: memberLogin });
      const before = { invitations: await invitationCount(), operations: await operationCount() };
      const calls = [
        api(app, 'POST', '/operations', { body: { action: 'CREATE_INVITATION', payload: createPayload() }, ...as }),
        api(app, 'POST', `/operations/${systemOp}/verify`, { body: { code: '123456' }, ...as }),
        api(app, 'GET', `/operations/${systemOp}`, { cookies: as.cookies }),
        api(app, 'POST', '/invitations', {
          body: { operation_id: randomUUID(), ...createPayload() },
          headers: { 'idempotency-key': randomUUID() },
          ...as,
        }),
        api(app, 'GET', '/invitations', { cookies: as.cookies }),
        api(app, 'GET', `/invitations/${created.invitationId}`, { cookies: as.cookies }),
        api(app, 'POST', `/invitations/${created.invitationId}/reissue`, {
          body: { operation_id: systemOp, expected_version: 1, reason: 'x' },
          headers: { 'idempotency-key': randomUUID() },
          ...as,
        }),
        api(app, 'POST', `/invitations/${created.invitationId}/revoke`, {
          body: { operation_id: systemOp, expected_version: 1, reason: 'x' },
          headers: { 'idempotency-key': randomUUID() },
          ...as,
        }),
      ];
      for (const response of await Promise.all(calls)) {
        expect(response.status).toBe(403);
        expect(adminErrorCode(response)).toBe('ADMIN_FORBIDDEN');
      }
      expect({ invitations: await invitationCount(), operations: await operationCount() }).toEqual(before);
      expect((await operationRow(app.pool, systemOp))?.status).toBe('PENDING');
    });

    it('refuses a missing cookie, an application-style token and a forged cookie with ADMIN_SESSION_INVALID', async () => {
      const forged = { __Host_11admin: 'x' };
      const noCookie = await api(app, 'POST', '/operations', { body: { action: 'CREATE_INVITATION', payload: createPayload() } });
      expect(noCookie.status).toBe(401);
      expect(adminErrorCode(noCookie)).toBe('ADMIN_SESSION_INVALID');
      // A Customer/Shop/Driver bearer token is not an administration cookie at all.
      const bearer = await api(app, 'GET', '/invitations', { headers: { authorization: `Bearer ${'A'.repeat(43)}` } });
      expect(bearer.status).toBe(401);
      const unknownToken = await api(app, 'GET', '/invitations', { cookies: { '__Host-11admin': 'B'.repeat(43) } });
      expect(unknownToken.status).toBe(401);
      expect(adminErrorCode(unknownToken)).toBe('ADMIN_SESSION_INVALID');
      const wrongName = await api(app, 'GET', '/invitations', { cookies: forged });
      expect(wrongName.status).toBe(401);
    });

    it('POST transport: a missing or foreign Origin and a missing CSRF token are 403, a non-JSON body is 400', async () => {
      const body = { action: 'CREATE_INVITATION', payload: createPayload() };
      const noOrigin = await api(app, 'POST', '/operations', { body, origin: null, ...sessionOf(system) });
      expect(noOrigin.status).toBe(403);
      expect(adminErrorCode(noOrigin)).toBe('ADMIN_CSRF_INVALID');
      const foreign = await api(app, 'POST', '/operations', { body, origin: 'https://evil.example.test', ...sessionOf(system) });
      expect(adminErrorCode(foreign)).toBe('ADMIN_CSRF_INVALID');
      const noCsrf = await api(app, 'POST', '/operations', { body, cookies: sessionOf(system).cookies });
      expect(noCsrf.status).toBe(403);
      expect(adminErrorCode(noCsrf)).toBe('ADMIN_CSRF_INVALID');
      const text = await api(app, 'POST', '/operations', { rawBody: JSON.stringify(body), contentType: 'text/plain', ...sessionOf(system) });
      expect(text.status).toBe(400);
      expect(await operationCount()).toBe(0);
    });

    it('GET: no Origin header is fine (same-origin), a present foreign Origin is refused; responses are no-store', async () => {
      const plain = await api(app, 'GET', '/invitations', { cookies: sessionOf(system).cookies });
      expect(plain.status).toBe(200);
      expect(plain.headers['cache-control']).toBe('no-store');
      const allowed = await api(app, 'GET', '/invitations', { cookies: sessionOf(system).cookies, origin: 'https://admin.example.test' });
      expect(allowed.status).toBe(200);
      const foreign = await api(app, 'GET', '/invitations', { cookies: sessionOf(system).cookies, origin: 'https://evil.example.test' });
      expect(foreign.status).toBe(403);
      expect(adminErrorCode(foreign)).toBe('ADMIN_CSRF_INVALID');
    });

    it.each([
      ['the account is DISABLED', "UPDATE app.users SET status = 'DISABLED', updated_at = now() WHERE user_id = $1::uuid"],
      ['the password changed (binding)', "UPDATE app.users SET password_hash = password_hash || 'x' WHERE user_id = $1::uuid"],
      ['the membership version moved', 'UPDATE app.admin_memberships SET version = version + 1 WHERE user_id = $1::uuid'],
      ['the factor generation moved (F5: every GET checks it)', 'UPDATE app.admin_totp_factors SET version = version + 1 WHERE user_id = $1::uuid'],
    ])('refuses GET and POST once %s', async (_case, sql) => {
      await app.pool.query(sql, [system.account.userId]);
      const list = await api(app, 'GET', '/invitations', { cookies: sessionOf(system).cookies });
      expect(list.status).toBe(401);
      expect(adminErrorCode(list)).toBe('ADMIN_SESSION_INVALID');
      const one = await api(app, 'GET', `/invitations/${randomUUID()}`, { cookies: sessionOf(system).cookies });
      expect(one.status).toBe(401);
      const post = await api(app, 'POST', '/operations', { body: { action: 'CREATE_INVITATION', payload: createPayload() }, ...sessionOf(system) });
      expect(post.status).toBe(401);
      expect(await operationCount()).toBe(0);
    });
  });

  // ----- finding on ad9b092: authorization before the target lookup of reissue/revoke -----------------------------

  describe('reissue/revoke authorize the session BEFORE looking the target up (finding, review of ad9b092)', () => {
    async function snapshot(invitationId: string): Promise<unknown> {
      const invitation = await invitationRow(app.pool, invitationId);
      const operations = await app.pool.query('SELECT operation_id, status, attempt_count FROM app.admin_sensitive_operations ORDER BY operation_id');
      const audits = await count(app.pool, "SELECT 1 FROM app.audit_logs WHERE action LIKE 'admin_invitation.%'");
      const records = await count(app.pool, "SELECT 1 FROM app.idempotency_records WHERE scope_type = 'admin_user'");
      return { invitation, operations: operations.rows, audits, records, bucket: await totpBucketFailures(app.pool) };
    }

    function call(kind: 'reissue' | 'revoke', invitationId: string, as: { cookies: Record<string, string>; csrf: string }) {
      return api(app, 'POST', `/invitations/${invitationId}/${kind}`, {
        body: { operation_id: randomUUID(), expected_version: 1, reason: 'r' },
        headers: { 'idempotency-key': randomUUID() },
        ...as,
      });
    }

    it.each(['reissue', 'revoke'] as const)(
      '%s: an ADMIN-role session gets 403 ADMIN_FORBIDDEN for an existing AND an unknown id; nothing changes',
      async (kind) => {
        const created = await createInvitation(app, system);
        await createOperation(app, system, 'REVOKE_INVITATION', { invitation_id: created.invitationId, expected_version: 1, reason: 'r' });
        await app.clearLimits();
        const member = await createAdminMember(app);
        const as = sessionOf({ login: await enrollAndLogin(app, member) });
        const before = await snapshot(created.invitationId);
        for (const id of [created.invitationId, randomUUID()]) {
          const response = await call(kind, id, as);
          expect(response.status).toBe(403);
          expect(adminErrorCode(response)).toBe('ADMIN_FORBIDDEN');
          expect(response.text).not.toContain('NOT_FOUND');
        }
        expect(await snapshot(created.invitationId)).toEqual(before);
      },
    );

    it.each(['reissue', 'revoke'] as const)('%s: a valid SYSTEM session still gets 404 for an unknown id', async (kind) => {
      const response = await call(kind, randomUUID(), sessionOf(system));
      expect(response.status).toBe(404);
      expect(adminErrorCode(response)).toBe('ADMIN_INVITATION_NOT_FOUND');
    });

    it.each([
      ['reissue', 'the session was revoked', 'UPDATE app.admin_sessions SET revoked_at = clock_timestamp() WHERE user_id = $1::uuid AND revoked_at IS NULL'],
      ['revoke', 'the session was revoked', 'UPDATE app.admin_sessions SET revoked_at = clock_timestamp() WHERE user_id = $1::uuid AND revoked_at IS NULL'],
      ['reissue', 'the session expired', "UPDATE app.admin_sessions SET expires_at = created_at + interval '1 millisecond' WHERE user_id = $1::uuid AND revoked_at IS NULL"],
      ['revoke', 'the session expired', "UPDATE app.admin_sessions SET expires_at = created_at + interval '1 millisecond' WHERE user_id = $1::uuid AND revoked_at IS NULL"],
      ['reissue', 'the factor version moved', 'UPDATE app.admin_totp_factors SET version = version + 1 WHERE user_id = $1::uuid'],
      ['revoke', 'the factor version moved', 'UPDATE app.admin_totp_factors SET version = version + 1 WHERE user_id = $1::uuid'],
      ['reissue', 'the membership version moved', 'UPDATE app.admin_memberships SET version = version + 1 WHERE user_id = $1::uuid'],
      ['revoke', 'the membership was disabled', "UPDATE app.admin_memberships SET status = 'DISABLED' WHERE user_id = $1::uuid"],
    ] as const)('%s: refused with 401 when %s, for an existing and an unknown id; nothing changes', async (kind, _case, sql) => {
      const created = await createInvitation(app, system);
      await app.clearLimits();
      await app.pool.query(sql, [system.account.userId]);
      const before = await snapshot(created.invitationId);
      for (const id of [created.invitationId, randomUUID()]) {
        const response = await call(kind, id, sessionOf(system));
        expect(response.status).toBe(401);
        expect(adminErrorCode(response)).toBe('ADMIN_SESSION_INVALID');
      }
      expect(await snapshot(created.invitationId)).toEqual(before);
    });
  });

  // ----- parser -----------------------------------------------------------------------------------------------------

  describe('strict parser (contract 6.1)', () => {
    const good = (): Record<string, unknown> => createPayload();
    it.each([
      ['an unknown root key', () => ({ action: 'CREATE_INVITATION', payload: good(), role: 'SYSTEM' })],
      ['an unknown action', () => ({ action: 'DELETE_INVITATION', payload: good() })],
      ['a forbidden payload key (role)', () => ({ action: 'CREATE_INVITATION', payload: { ...good(), role: 'ADMIN' } })],
      ['a forbidden payload key (status)', () => ({ action: 'CREATE_INVITATION', payload: { ...good(), status: 'ACCEPTED' } })],
      ['no permissions', () => ({ action: 'CREATE_INVITATION', payload: { ...good(), permissions: [] } })],
      ['REVIEW without VIEW', () => ({ action: 'CREATE_INVITATION', payload: { ...good(), permissions: [{ app: 'SHOP', can_view: false, can_review_profile: true, can_lock: false }] } })],
      ['CUSTOMER with REVIEW', () => ({ action: 'CREATE_INVITATION', payload: { ...good(), permissions: [{ app: 'CUSTOMER', can_view: true, can_review_profile: true, can_lock: false }] } })],
      ['a duplicate app', () => ({ action: 'CREATE_INVITATION', payload: { ...good(), permissions: [...permissions('SHOP'), ...permissions('SHOP')] } })],
      ['only LOCK-less no VIEW anywhere', () => ({ action: 'CREATE_INVITATION', payload: { ...good(), permissions: [{ app: 'SHOP', can_view: false, can_review_profile: false, can_lock: false }] } })],
      ['a non-Vietnamese phone', () => ({ action: 'CREATE_INVITATION', payload: { ...good(), phone: '+12025550123' } })],
      ['a 121-character name', () => ({ action: 'CREATE_INVITATION', payload: { ...good(), full_name: 'x'.repeat(121) } })],
      ['a blank name', () => ({ action: 'CREATE_INVITATION', payload: { ...good(), full_name: '   ' } })],
      ['a 1001-character note', () => ({ action: 'CREATE_INVITATION', payload: { ...good(), note: 'n'.repeat(1001) } })],
      ['a string version', () => ({ action: 'REVOKE_INVITATION', payload: { invitation_id: randomUUID(), expected_version: '1', reason: 'r' } })],
      ['an upper-case id', () => ({ action: 'REVOKE_INVITATION', payload: { invitation_id: randomUUID().toUpperCase(), expected_version: 1, reason: 'r' } })],
      ['a blank reason', () => ({ action: 'REVOKE_INVITATION', payload: { invitation_id: randomUUID(), expected_version: 1, reason: ' ' } })],
      ['a 501-character reason', () => ({ action: 'REVOKE_INVITATION', payload: { invitation_id: randomUUID(), expected_version: 1, reason: 'r'.repeat(501) } })],
      ['permissions on a revoke', () => ({ action: 'REVOKE_INVITATION', payload: { invitation_id: randomUUID(), expected_version: 1, reason: 'r', permissions: permissions() } })],
      ['an explicit null permissions on a reissue', () => ({ action: 'REISSUE_INVITATION', payload: { invitation_id: randomUUID(), expected_version: 1, reason: 'r', permissions: null } })],
      ['a name on a reissue (Q1)', () => ({ action: 'REISSUE_INVITATION', payload: { invitation_id: randomUUID(), expected_version: 1, reason: 'r', full_name: 'A' } })],
    ])('refuses %s with 400 ADMIN_INPUT_INVALID and writes nothing', async (_case, body) => {
      const response = await api(app, 'POST', '/operations', { body: body(), ...sessionOf(system) });
      expect(response.status).toBe(400);
      expect(adminErrorCode(response)).toBe('ADMIN_INPUT_INVALID');
      expect(response.text).not.toContain('Nguyễn');
      expect(await operationCount()).toBe(0);
    });

    it('refuses a malformed verify body without counting anything', async () => {
      const operationId = await createOperation(app, system, 'CREATE_INVITATION', createPayload());
      for (const body of [{ code: '12345' }, { code: 123456 }, { code: '123456', extra: 1 }, {}]) {
        const response = await api(app, 'POST', `/operations/${operationId}/verify`, { body, ...sessionOf(system) });
        expect(response.status).toBe(400);
        expect(adminErrorCode(response)).toBe('ADMIN_INPUT_INVALID');
      }
      expect((await operationRow(app.pool, operationId))?.attempt_count).toBe(0);
    });
  });

  // ----- ST (F5) ------------------------------------------------------------------------------------------------------

  describe('operation state (ST, F5)', () => {
    it('create -> GET PENDING/verifiable -> verify -> GET VERIFIED/usable; a second verify is refused before any code is compared', async () => {
      const created = await api(app, 'POST', '/operations', { body: { action: 'CREATE_INVITATION', payload: createPayload() }, ...sessionOf(system) });
      expect(created.status).toBe(201);
      const data = adminData(created);
      expect(data.status).toBe('PENDING');
      expect(Object.keys(data).sort()).toEqual(['action', 'expires_at', 'operation_id', 'status']);
      const operationId = String(data.operation_id);
      const row = await app.pool.query<{ seconds: string }>(
        'SELECT extract(epoch FROM expires_at - created_at)::text AS seconds FROM app.admin_sensitive_operations WHERE operation_id = $1::uuid',
        [operationId],
      );
      expect(Number(row.rows[0]?.seconds)).toBe(120);

      const pending = adminData(await api(app, 'GET', `/operations/${operationId}`, { cookies: sessionOf(system).cookies }));
      expect(pending).toMatchObject({ status: 'PENDING', expired: false, verifiable: true, usable: false, attempts_remaining: 5 });

      expect((await verifyOperation(app, system, operationId)).status).toBe(200);
      const verified = adminData(await api(app, 'GET', `/operations/${operationId}`, { cookies: sessionOf(system).cookies }));
      expect(verified).toMatchObject({ status: 'VERIFIED', expired: false, verifiable: false, usable: true, attempts_remaining: null });

      const again = await verifyOperation(app, system, operationId);
      expect(again.status).toBe(403);
      expect(adminErrorCode(again)).toBe('ADMIN_STEP_UP_REQUIRED');
      expect((await operationRow(app.pool, operationId))?.attempt_count).toBe(0);
    });

    it('a VERIFIED operation past its 120 s is reported usable=false/expired=true with status VERIFIED, and GET writes nothing', async () => {
      const session = await app.pool.query<{ session_id: string; factor_id: string; factor_version: string; membership_version: string }>(
        `SELECT session_id, factor_id, factor_version::text, membership_version::text FROM app.admin_sessions
          WHERE user_id = $1::uuid AND revoked_at IS NULL`,
        [system.account.userId],
      );
      const s = session.rows[0];
      expect(s).toBeDefined();
      const operationId = randomUUID();
      await app.pool.query(
        `INSERT INTO app.admin_sensitive_operations (operation_id, actor_user_id, actor_session_id, factor_id, factor_version,
           membership_version, action, payload_fingerprint, fingerprint_key_id, status, attempt_count, created_at, expires_at, verified_at)
         SELECT $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::bigint, $6::bigint, 'CREATE_INVITATION', repeat('a', 64), 'k1', 'VERIFIED', 0,
                c.t - interval '200 seconds', c.t - interval '80 seconds', c.t - interval '190 seconds'
           FROM (SELECT date_trunc('milliseconds', clock_timestamp()) AS t) c`,
        [operationId, system.account.userId, s?.session_id, s?.factor_id, s?.factor_version, s?.membership_version],
      );
      const view = adminData(await api(app, 'GET', `/operations/${operationId}`, { cookies: sessionOf(system).cookies }));
      expect(view).toMatchObject({ status: 'VERIFIED', expired: true, usable: false, verifiable: false });
      expect((await operationRow(app.pool, operationId))?.status).toBe('VERIFIED');
    });

    it('a new login (new session) makes the old operation unusable without storing INVALIDATED', async () => {
      const operationId = await createOperation(app, system, 'CREATE_INVITATION', createPayload());
      await app.clearLimits();
      const second = await relogin(app, system);
      const view = adminData(await api(app, 'GET', `/operations/${operationId}`, { cookies: sessionOf(second).cookies }));
      expect(view).toMatchObject({ status: 'PENDING', verifiable: false, usable: false });
      const verify = await verifyOperation(app, second, operationId);
      expect(verify.status).toBe(403);
      expect(adminErrorCode(verify)).toBe('ADMIN_STEP_UP_REQUIRED');
      expect(await operationRow(app.pool, operationId)).toMatchObject({ status: 'PENDING', attempt_count: 0 });
    });

    it("an unknown or another actor's operation is the same single STEP_UP_REQUIRED on GET", async () => {
      const response = await api(app, 'GET', `/operations/${randomUUID()}`, { cookies: sessionOf(system).cookies });
      expect(response.status).toBe(403);
      expect(adminErrorCode(response)).toBe('ADMIN_STEP_UP_REQUIRED');
    });
  });

  // ----- CR -----------------------------------------------------------------------------------------------------------

  describe('create (CR)', () => {
    it('creates the PENDING invitation with its sealed snapshot; only a digest is stored; one audit; the operation is CONSUMED', async () => {
      const phone = randomPhone();
      const payload = createPayload(phone.local, { permissions: [...permissions('SHOP', 'CUSTOMER')] });
      const operationId = await stepUp(app, system, 'CREATE_INVITATION', payload);
      const key = randomUUID();
      const response = await api(app, 'POST', '/invitations', {
        body: { operation_id: operationId, ...payload },
        headers: { 'idempotency-key': key },
        ...sessionOf(system),
      });
      expect(response.status).toBe(201);
      const data = adminData(response);
      const invitation = data.invitation as Record<string, unknown>;
      expect(invitation).toMatchObject({ status: 'PENDING', version: 1, full_name: 'Nguyễn Văn Quản Trị', note: 'ca sáng' });
      expect(invitation.phone_masked).toBe(`${phone.local.slice(0, 2)}•• ••• ${phone.local.slice(-3)}`);
      expect(invitation.permissions).toEqual([
        { app: 'CUSTOMER', can_view: true, can_review_profile: false, can_lock: false },
        { app: 'SHOP', can_view: true, can_review_profile: false, can_lock: false },
      ]);
      const link = String(data.activation_link);
      const token = (LINK.exec(link) ?? [])[1] as string;
      expect(token).toHaveLength(43);

      const stored = await app.pool.query<{ token_digest: string; snapshot_sealed: boolean; created_by: string; hours: string }>(
        `SELECT token_digest, snapshot_sealed, created_by, extract(epoch FROM expires_at - created_at)::text AS hours
           FROM app.admin_invitations WHERE invitation_id = $1::uuid`,
        [String(invitation.invitation_id)],
      );
      expect(stored.rows[0]?.token_digest).toBe(createHash('sha256').update(token, 'utf8').digest('hex'));
      expect(stored.rows[0]?.snapshot_sealed).toBe(true);
      expect(stored.rows[0]?.created_by).toBe(system.account.userId);
      expect(Number(stored.rows[0]?.hours)).toBe(72 * 3600);
      expect((await operationRow(app.pool, operationId))?.status).toBe('CONSUMED');
      expect(await count(app.pool, "SELECT 1 FROM app.audit_logs WHERE action = 'admin_invitation.created.v1' AND resource_id = $1 AND actor_type = 'SYSTEM'", [String(invitation.invitation_id)])).toBe(1);
      expect(await count(app.pool, "SELECT 1 FROM app.idempotency_records WHERE scope_type = 'admin_user' AND idempotency_key = $1", [key])).toBe(1);

      // The token and the link exist only in the response (and in its encrypted replay): not in any table text or log.
      const leaks = await app.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM app.audit_logs WHERE metadata::text LIKE '%' || $1 || '%' OR metadata::text LIKE '%' || $2 || '%'`,
        [token, phone.normalized],
      );
      expect(leaks.rows[0]?.n).toBe('0');
      const logs = app.running.logs.join('\n');
      expect(logs).not.toContain(token);
      expect(logs).not.toContain(phone.normalized);
      expect(logs).not.toContain('Nguyễn Văn Quản Trị');
    });

    it('refuses at create-operation a phone that already has a live PENDING invitation (early check)', async () => {
      const phone = randomPhone();
      await createInvitation(app, system, createPayload(phone.local));
      const response = await api(app, 'POST', '/operations', { body: { action: 'CREATE_INVITATION', payload: createPayload(phone.local) }, ...sessionOf(system) });
      expect(response.status).toBe(409);
      expect(adminErrorCode(response)).toBe('ADMIN_INVITATION_PENDING_EXISTS');
    });

    it('refuses under the locks a PENDING that appeared after the step-up; the operation stays VERIFIED', async () => {
      const phone = randomPhone();
      const payload = createPayload(phone.local);
      const operationId = await stepUp(app, system, 'CREATE_INVITATION', payload);
      await insertRawInvitation(app.pool, { createdBy: system.account.userId, phoneNormalized: phone.normalized, expired: false });
      const response = await api(app, 'POST', '/invitations', {
        body: { operation_id: operationId, ...payload },
        headers: { 'idempotency-key': randomUUID() },
        ...sessionOf(system),
      });
      expect(response.status).toBe(409);
      expect(adminErrorCode(response)).toBe('ADMIN_INVITATION_PENDING_EXISTS');
      expect((await operationRow(app.pool, operationId))?.status).toBe('VERIFIED');
    });

    it('closes an expired-but-PENDING invitation of the phone as EXPIRED (audited) and creates the new one', async () => {
      const phone = randomPhone();
      const old = await insertRawInvitation(app.pool, { createdBy: system.account.userId, phoneNormalized: phone.normalized, expired: true });
      const created = await createInvitation(app, system, createPayload(phone.local));
      expect(await invitationRow(app.pool, old)).toMatchObject({ status: 'EXPIRED', version: '2' });
      expect(await invitationRow(app.pool, created.invitationId)).toMatchObject({ status: 'PENDING', version: '1' });
      expect(await count(app.pool, "SELECT 1 FROM app.audit_logs WHERE action = 'admin_invitation.expired.v1' AND resource_id = $1", [old])).toBe(1);
    });

    it('refuses a phone that already belongs to an administration account (an application account of the same phone is another scope): early at create-operation and again under the locks (Q3)', async () => {
      const early = randomPhone();
      const insertUser = (normalized: string): Promise<unknown> =>
        app.pool.query(
          `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
           VALUES ($1::uuid, $2, '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', NULL, 'ADMIN_PROVISIONED', 'ACTIVE', 1, now(), now())`,
          [randomUUID(), normalized],
        );
      app.track(early.normalized);
      await insertUser(early.normalized);
      const refused = await api(app, 'POST', '/operations', { body: { action: 'CREATE_INVITATION', payload: createPayload(early.local) }, ...sessionOf(system) });
      expect(refused.status).toBe(409);
      expect(adminErrorCode(refused)).toBe('ADMIN_PHONE_CONFLICT');

      const late = randomPhone();
      app.track(late.normalized);
      const payload = createPayload(late.local);
      const operationId = await stepUp(app, system, 'CREATE_INVITATION', payload);
      await insertUser(late.normalized);
      const response = await api(app, 'POST', '/invitations', {
        body: { operation_id: operationId, ...payload },
        headers: { 'idempotency-key': randomUUID() },
        ...sessionOf(system),
      });
      expect(response.status).toBe(409);
      expect(adminErrorCode(response)).toBe('ADMIN_PHONE_CONFLICT');
      expect(await invitationCount()).toBe(0);
      expect((await operationRow(app.pool, operationId))?.status).toBe('VERIFIED');
    });

    it('refuses a body that differs from the verified operation (fingerprint) with STEP_UP_REQUIRED', async () => {
      const payload = createPayload();
      const operationId = await stepUp(app, system, 'CREATE_INVITATION', payload);
      const response = await api(app, 'POST', '/invitations', {
        body: { operation_id: operationId, ...payload, note: 'another note' },
        headers: { 'idempotency-key': randomUUID() },
        ...sessionOf(system),
      });
      expect(response.status).toBe(403);
      expect(adminErrorCode(response)).toBe('ADMIN_STEP_UP_REQUIRED');
      expect((await operationRow(app.pool, operationId))?.status).toBe('VERIFIED');
      expect(await invitationCount()).toBe(0);
    });

    it('requires the Idempotency-Key header', async () => {
      const payload = createPayload();
      const operationId = await stepUp(app, system, 'CREATE_INVITATION', payload);
      const response = await api(app, 'POST', '/invitations', { body: { operation_id: operationId, ...payload }, ...sessionOf(system) });
      expect(response.status).toBe(400);
      expect(adminErrorCode(response)).toBe('IDEMPOTENCY_KEY_REQUIRED');
    });
  });

  // ----- RI (F4) ------------------------------------------------------------------------------------------------------

  describe('reissue and revoke (RI, F4)', () => {
    async function reissue(invitationId: string, payload: Record<string, unknown>, operationPayload = payload) {
      const operationId = await stepUp(app, system, 'REISSUE_INVITATION', { invitation_id: invitationId, ...operationPayload });
      return {
        operationId,
        response: await api(app, 'POST', `/invitations/${invitationId}/reissue`, {
          body: { operation_id: operationId, ...payload },
          headers: { 'idempotency-key': randomUUID() },
          ...sessionOf(system),
        }),
      };
    }

    async function permissionRows(invitationId: string): Promise<unknown[]> {
      const rows = await app.pool.query(
        'SELECT app, can_view, can_review_profile, can_lock FROM app.admin_invitation_permissions WHERE invitation_id = $1::uuid ORDER BY app',
        [invitationId],
      );
      return rows.rows;
    }

    it('without permissions it copies the old snapshot, name, note and phone; old SUPERSEDED -> new PENDING in one transaction', async () => {
      const phone = randomPhone();
      const old = await createInvitation(app, system, createPayload(phone.local, { permissions: permissions('SHOP', 'DRIVER') }));
      const oldPermissions = await permissionRows(old.invitationId);
      await app.clearLimits();
      const { response } = await reissue(old.invitationId, { expected_version: 1, reason: 'mất link' });
      expect(response.status).toBe(201);
      const data = adminData(response);
      const fresh = data.invitation as Record<string, unknown>;
      expect(data.superseded_invitation_id).toBe(old.invitationId);
      expect(String(data.activation_link)).toMatch(LINK);
      expect(data.activation_link).not.toBe(old.link);
      expect(fresh).toMatchObject({ status: 'PENDING', version: 1, full_name: 'Nguyễn Văn Quản Trị', note: 'ca sáng' });
      expect(await invitationRow(app.pool, old.invitationId)).toMatchObject({ status: 'SUPERSEDED', version: '2', successor_id: fresh.invitation_id });
      expect(await permissionRows(String(fresh.invitation_id))).toEqual(oldPermissions);
      expect(await permissionRows(old.invitationId)).toEqual(oldPermissions);
      const phones = await app.pool.query('SELECT 1 FROM app.admin_invitations WHERE phone_normalized = $1', [phone.normalized]);
      expect(phones.rowCount).toBe(2);
      const audit = await app.pool.query<{ metadata: Record<string, unknown> }>(
        "SELECT metadata FROM app.audit_logs WHERE action = 'admin_invitation.reissued.v1' AND resource_id = $1",
        [String(fresh.invitation_id)],
      );
      expect(audit.rows[0]?.metadata).toMatchObject({ permissions_source: 'COPIED', reason: 'mất link', superseded_invitation_id: old.invitationId });
    });

    it('with permissions it writes a NEW snapshot and leaves the old snapshot unchanged', async () => {
      const old = await createInvitation(app, system, createPayload(undefined, { permissions: permissions('SHOP') }));
      const oldPermissions = await permissionRows(old.invitationId);
      await app.clearLimits();
      const newPermissions = [{ app: 'DRIVER', can_view: true, can_review_profile: true, can_lock: true }];
      const { response } = await reissue(old.invitationId, { expected_version: 1, reason: 'đổi quyền', permissions: newPermissions });
      expect(response.status).toBe(201);
      const fresh = adminData(response).invitation as Record<string, unknown>;
      expect(fresh.permissions).toEqual(newPermissions);
      expect(await permissionRows(String(fresh.invitation_id))).toEqual([{ app: 'DRIVER', can_view: true, can_review_profile: true, can_lock: true }]);
      expect(await permissionRows(old.invitationId)).toEqual(oldPermissions);
    });

    it('"copy" and "explicit list" are different confirmations: an operation for one cannot be used for the other', async () => {
      const old = await createInvitation(app, system, createPayload(undefined, { permissions: permissions('SHOP') }));
      await app.clearLimits();
      const { operationId, response } = await reissue(
        old.invitationId,
        { expected_version: 1, reason: 'r', permissions: permissions('SHOP') },
        { expected_version: 1, reason: 'r' },
      );
      expect(response.status).toBe(403);
      expect(adminErrorCode(response)).toBe('ADMIN_STEP_UP_REQUIRED');
      expect((await operationRow(app.pool, operationId))?.status).toBe('VERIFIED');
      expect((await invitationRow(app.pool, old.invitationId))?.status).toBe('PENDING');
    });

    it('a stale expected_version or a terminal target is refused already at create-operation', async () => {
      const created = await createInvitation(app, system);
      const stale = await api(app, 'POST', '/operations', {
        body: { action: 'REISSUE_INVITATION', payload: { invitation_id: created.invitationId, expected_version: 2, reason: 'r' } },
        ...sessionOf(system),
      });
      expect(stale.status).toBe(409);
      expect(adminErrorCode(stale)).toBe('ADMIN_VERSION_CONFLICT');
      await app.pool.query(
        "UPDATE app.admin_invitations SET status = 'REVOKED', version = 2, terminal_at = now() WHERE invitation_id = $1::uuid",
        [created.invitationId],
      );
      const terminal = await api(app, 'POST', '/operations', {
        body: { action: 'REVOKE_INVITATION', payload: { invitation_id: created.invitationId, expected_version: 2, reason: 'r' } },
        ...sessionOf(system),
      });
      expect(terminal.status).toBe(409);
      expect(adminErrorCode(terminal)).toBe('ADMIN_INVITATION_NOT_PENDING');
      const missing = await api(app, 'POST', '/operations', {
        body: { action: 'REVOKE_INVITATION', payload: { invitation_id: randomUUID(), expected_version: 1, reason: 'r' } },
        ...sessionOf(system),
      });
      expect(missing.status).toBe(404);
      expect(adminErrorCode(missing)).toBe('ADMIN_INVITATION_NOT_FOUND');
    });

    it('reissues and revokes an invitation that is PENDING but already past expires_at (Q2, Owner decision)', async () => {
      const expiredA = await insertRawInvitation(app.pool, { createdBy: system.account.userId, phoneNormalized: randomPhone().normalized, expired: true });
      const { response } = await reissue(expiredA, { expected_version: 1, reason: 'gia hạn' });
      expect(response.status).toBe(201);
      expect((await invitationRow(app.pool, expiredA))?.status).toBe('SUPERSEDED');
      const fresh = adminData(response).invitation as Record<string, unknown>;
      expect(new Date(String(fresh.expires_at)).getTime()).toBeGreaterThan(Date.now() + 71 * 3600 * 1000);

      await app.clearLimits();
      const expiredB = await insertRawInvitation(app.pool, { createdBy: system.account.userId, phoneNormalized: randomPhone().normalized, expired: true });
      const payload = { expected_version: 1, reason: 'thu hồi' };
      const operationId = await stepUp(app, system, 'REVOKE_INVITATION', { invitation_id: expiredB, ...payload });
      const revoked = await api(app, 'POST', `/invitations/${expiredB}/revoke`, {
        body: { operation_id: operationId, ...payload },
        headers: { 'idempotency-key': randomUUID() },
        ...sessionOf(system),
      });
      expect(revoked.status).toBe(200);
      expect(adminData(revoked).invitation).toMatchObject({ invitation_id: expiredB, status: 'REVOKED', version: 2, expired: false });
    });

    it('revokes a PENDING invitation (200, REVOKED, version + 1); the reason is audited but never echoed or logged', async () => {
      const created = await createInvitation(app, system);
      await app.clearLimits();
      const reason = `lý do ${randomUUID()}`;
      const payload = { expected_version: 1, reason };
      const operationId = await stepUp(app, system, 'REVOKE_INVITATION', { invitation_id: created.invitationId, ...payload });
      const response = await api(app, 'POST', `/invitations/${created.invitationId}/revoke`, {
        body: { operation_id: operationId, ...payload },
        headers: { 'idempotency-key': randomUUID() },
        ...sessionOf(system),
      });
      expect(response.status).toBe(200);
      expect(adminData(response).invitation).toMatchObject({ status: 'REVOKED', version: 2 });
      expect(response.text).not.toContain(reason);
      expect(app.running.logs.join('\n')).not.toContain(reason);
      const audit = await app.pool.query<{ metadata: Record<string, unknown>; actor_type: string }>(
        "SELECT metadata, actor_type FROM app.audit_logs WHERE action = 'admin_invitation.revoked.v1' AND resource_id = $1",
        [created.invitationId],
      );
      expect(audit.rows[0]).toMatchObject({ actor_type: 'SYSTEM', metadata: { reason, version: 2, operation_id: operationId } });
    });
  });

  // ----- reads ----------------------------------------------------------------------------------------------------------

  describe('reads (6.7, 6.9)', () => {
    it('GET one invitation: masked phone, permissions, expired flag from the database clock, never a token or link', async () => {
      const created = await createInvitation(app, system);
      const token = (LINK.exec(created.link) ?? [])[1] as string;
      const response = await api(app, 'GET', `/invitations/${created.invitationId}`, { cookies: sessionOf(system).cookies });
      expect(response.status).toBe(200);
      const data = adminData(response);
      expect(data.activation).toEqual({ state: 'NONE' });
      expect(data.invitation).toMatchObject({ invitation_id: created.invitationId, status: 'PENDING', expired: false, terminal_at: null, successor_id: null });
      expect(response.text).not.toContain(token);
      expect(response.text).not.toContain('token');
      expect(response.text).not.toContain('activate#');

      const expired = await insertRawInvitation(app.pool, { createdBy: system.account.userId, phoneNormalized: randomPhone().normalized, expired: true });
      const expiredView = adminData(await api(app, 'GET', `/invitations/${expired}`, { cookies: sessionOf(system).cookies }));
      expect(expiredView.invitation).toMatchObject({ status: 'PENDING', expired: true });
      expect(await invitationRow(app.pool, expired)).toMatchObject({ status: 'PENDING', version: '1' });

      const missing = await api(app, 'GET', `/invitations/${randomUUID()}`, { cookies: sessionOf(system).cookies });
      expect(missing.status).toBe(404);
      expect(adminErrorCode(missing)).toBe('ADMIN_INVITATION_NOT_FOUND');
    });

    it('lists newest first with an opaque cursor and a status filter; malformed query values are 400', async () => {
      const ids: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        ids.push(await insertRawInvitation(app.pool, { createdBy: system.account.userId, phoneNormalized: randomPhone().normalized, expired: index === 0 }));
      }
      const first = adminData(await api(app, 'GET', '/invitations?limit=2', { cookies: sessionOf(system).cookies }));
      const firstItems = first.items as Array<Record<string, unknown>>;
      expect(firstItems).toHaveLength(2);
      expect(typeof first.next_cursor).toBe('string');
      expect(firstItems[0]).not.toHaveProperty('permissions');
      const second = adminData(
        await api(app, 'GET', `/invitations?limit=2&cursor=${String(first.next_cursor)}`, { cookies: sessionOf(system).cookies }),
      );
      const all = [...firstItems, ...(second.items as Array<Record<string, unknown>>)].map((item) => item.invitation_id);
      expect(new Set(all)).toEqual(new Set(ids));
      expect(second.next_cursor).toBeNull();
      const expired = (second.items as Array<Record<string, unknown>>).concat(firstItems).find((item) => item.invitation_id === ids[0]);
      expect(expired?.expired).toBe(true);

      const revoked = adminData(await api(app, 'GET', '/invitations?status=REVOKED', { cookies: sessionOf(system).cookies }));
      expect(revoked.items).toEqual([]);
      for (const query of ['limit=0', 'limit=51', 'limit=x', 'status=DELETED', 'cursor=bm90LWEtY3Vyc29y', 'limit=1&limit=2', 'page=1']) {
        const response = await api(app, 'GET', `/invitations?${query}`, { cookies: sessionOf(system).cookies });
        expect(response.status).toBe(400);
        expect(adminErrorCode(response)).toBe('ADMIN_INPUT_INVALID');
      }
    });
  });

  // ----- LM -------------------------------------------------------------------------------------------------------------

  describe('ingress quota (LM)', () => {
    it('shares the existing POST quota per address: at most 30 per minute, then 429 with Retry-After', async () => {
      await app.clearLimits();
      let limited: Awaited<ReturnType<typeof api>> | undefined;
      for (let index = 0; index < 32 && limited === undefined; index += 1) {
        const response = await api(app, 'POST', '/operations', { body: { action: 'CREATE_INVITATION', payload: createPayload() }, ...sessionOf(system) });
        if (response.status === 429) {
          limited = response;
          expect(index).toBe(30);
        }
      }
      expect(limited).toBeDefined();
      expect(adminErrorCode(limited as Awaited<ReturnType<typeof api>>)).toBe('ADMIN_AUTH_RATE_LIMITED');
      expect(Number((limited as Awaited<ReturnType<typeof api>>).headers['retry-after'])).toBeGreaterThanOrEqual(1);
      // At most ONE live operation per SYSTEM, whatever the number of create-operations.
      expect(await count(app.pool, "SELECT 1 FROM app.admin_sensitive_operations WHERE status IN ('PENDING','VERIFIED')")).toBe(1);
    });
  });
});
