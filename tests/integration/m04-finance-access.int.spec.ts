import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { PoolClient } from 'pg';
import { ADMIN_SESSION_COOKIE } from '../../apps/backend/src/admin-auth/admin-auth-constants';
import { FinanceAccessParticipant } from '../../apps/backend/src/finance-access/finance-access-participant';
import { FinanceAccessRepository } from '../../apps/backend/src/finance-access/finance-access-repository';
import { AppError } from '../../apps/backend/src/common/app-errors';
import { TransactionContext } from '../../apps/backend/src/transaction/transaction-context';
import { ADMIN_PASSWORD, AdminApp, adminData, adminErrorCode, AdminResponse, cookieFrom, loginStep, preauthCookies, rewindAcceptedStep, sessionCookies, startAdminApp, totpNow } from './support/admin-fixtures';
import { begin, ok, post } from './support/activation-fixtures';
import { randomPhone, countRows, Phone } from './support/auth-fixtures';
import { eventually, failureOf } from './support/async-helpers';
import { holdRowLock } from './support/lock-fixtures';
import { createInvitation, createPayload, systemSession, SystemSession } from './support/provisioning-fixtures';
import { FINANCE_DOWN_SQL, FINANCE_UP_SQL } from './support/wallet-migration-sql';

// M04-B2.2a on a REAL Nest administration pipeline and PostgreSQL: the finance rights SYSTEM gives to an ADMIN one by one (default deny), and the
// receiving accounts of the system (SYSTEM only, always created NOT receiving). Nothing here opens a money path: the ledger stays closed and no
// wallet changes. The rows these tests commit (rights and accounts are never deleted by the product) are removed in afterAll, by the test role,
// under a lifted guard that is checked to be active again.

const tag = randomBytes(3).toString('hex').toUpperCase();
const READ = 'wallet.read';
const RECORD = 'wallet.topup.record';

interface Login {
  readonly cookie: string;
  readonly csrf: string;
}
interface ActivatedAdmin {
  readonly phone: Phone;
  readonly userId: string;
  readonly secret: string;
}

describe('M04-B2.2a — finance access and receiving accounts', () => {
  let admin: AdminApp;
  let system: SystemSession;
  let plain: ActivatedAdmin;
  let plainLogin: Login;
  let other: ActivatedAdmin;
  let otherLogin: Login;
  const accountIds: string[] = [];

  const permission = (app: string, view: boolean, review: boolean, lock: boolean): Record<string, unknown> => ({ app, can_view: view, can_review_profile: review, can_lock: lock });

  beforeAll(async () => {
    admin = await startAdminApp({ activationDisabledTest: true });
    system = await systemSession(admin);
    // Every application permission an ADMIN can be given, so that "can view / review / lock" is proven NOT to be a finance right.
    plain = await activatedAdmin([permission('DRIVER', true, true, true), permission('SHOP', true, false, true)], `Admin đủ quyền ứng dụng ${tag}`);
    plainLogin = await login(plain);
    other = await activatedAdmin([permission('DRIVER', true, false, false)], `Admin khác ${tag}`);
    otherLogin = await login(other);
  });

  afterAll(async () => {
    try {
      const client = await admin.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('ALTER TABLE app.admin_finance_grants DISABLE TRIGGER admin_finance_grants_no_delete');
        await client.query('DELETE FROM app.admin_finance_grants');
        await client.query('ALTER TABLE app.admin_finance_grants ENABLE TRIGGER admin_finance_grants_no_delete');
        await client.query('ALTER TABLE app.system_owned_bank_accounts DISABLE TRIGGER wallet_system_accounts_no_delete');
        await client.query('DELETE FROM app.system_owned_bank_accounts WHERE system_account_id = ANY($1::uuid[])', [accountIds]);
        await client.query('ALTER TABLE app.system_owned_bank_accounts ENABLE TRIGGER wallet_system_accounts_no_delete');
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    } finally {
      await admin.close();
    }
  });

  // ------------------------------------------------------------------------------------------------ helpers
  async function activatedAdmin(permissions: Record<string, unknown>[], fullName: string): Promise<ActivatedAdmin> {
    const phone = randomPhone();
    admin.track(phone.normalized);
    const invitation = await createInvitation(admin, system, createPayload(phone.local, { full_name: fullName, permissions }));
    const token = invitation.link.split('#t=')[1] as string;
    const session = await begin(admin, { invitationId: invitation.invitationId, token, phone });
    ok(await post(admin, '/password', session, { password: ADMIN_PASSWORD }));
    const secret = String(adminData(ok(await post(admin, '/totp/enrollment', session))).secret);
    ok(await post(admin, '/complete', session, { code: totpNow(secret) }));
    const found = await admin.pool.query<{ user_id: string }>('SELECT user_id FROM app.users WHERE phone_normalized = $1', [phone.normalized]);
    return { phone, userId: (found.rows[0] as { user_id: string }).user_id, secret };
  }

  async function login(who: ActivatedAdmin): Promise<Login> {
    const preauth = await loginStep(admin, { phone: who.phone, password: ADMIN_PASSWORD, userId: who.userId });
    await rewindAcceptedStep(admin, who.userId);
    const verified = await admin.call('POST', '/totp/verify', { body: { code: totpNow(who.secret) }, cookies: preauthCookies(preauth), csrf: preauth.csrf });
    if (verified.status !== 200) {
      throw new Error(`admin login failed: ${verified.status} ${verified.text}`);
    }
    return { cookie: String(cookieFrom(verified, ADMIN_SESSION_COOKIE)), csrf: String(adminData(verified).csrf_token) };
  }

  const systemLogin = (): Login => ({ cookie: system.login.cookie, csrf: system.login.csrf });
  const code = (response: AdminResponse): { status: number; code: string | undefined } => ({ status: response.status, code: adminErrorCode(response) });

  const get = (who: Login | undefined, path: string): Promise<AdminResponse> =>
    admin.call('GET', path, { basePath: '/v1/admin', ...(who === undefined ? {} : { cookies: sessionCookies(who) }) });

  async function send(who: Login, path: string, body: unknown, options: { key?: string; csrf?: string | null } = {}): Promise<AdminResponse> {
    await admin.clearLimits(); // the ingress quota is not under test
    return admin.call('POST', path, {
      basePath: '/v1/admin',
      body,
      cookies: sessionCookies(who),
      ...(options.csrf === null ? {} : { csrf: options.csrf ?? who.csrf }),
      headers: { 'idempotency-key': options.key ?? randomUUID() },
    });
  }
  const grant = (target: string, key: string, version: number, options: { key?: string; who?: Login } = {}): Promise<AdminResponse> =>
    send(options.who ?? systemLogin(), `/finance/access/admins/${target}/grant`, { permission_key: key, expected_version: version }, options.key === undefined ? {} : { key: options.key });
  const revoke = (target: string, key: string, version: number, options: { key?: string; who?: Login } = {}): Promise<AdminResponse> =>
    send(options.who ?? systemLogin(), `/finance/access/admins/${target}/revoke`, { permission_key: key, expected_version: version }, options.key === undefined ? {} : { key: options.key });

  const permissionsOf = (response: AdminResponse): Array<{ permission_key: string; state: string; version: number }> => adminData(response).permissions as Array<{ permission_key: string; state: string; version: number }>;
  const rowsOf = (userId: string): Promise<Array<Record<string, unknown>>> =>
    admin.pool.query('SELECT permission_key, state, version::text, granted_by_user_id::text, revoked_by_user_id::text FROM app.admin_finance_grants WHERE user_id = $1::uuid ORDER BY permission_key', [userId]).then((r) => r.rows as Array<Record<string, unknown>>);
  const auditCount = (resourceId: string, action: string): Promise<number> => countRows(admin.pool, 'SELECT 1 FROM app.audit_logs WHERE resource_id = $1 AND action = $2', [resourceId, action]);

  async function expectNoMoney(): Promise<void> {
    expect(await countRows(admin.pool, 'SELECT 1 FROM app.wallet_ledger_entries')).toBe(0);
    expect(await countRows(admin.pool, 'SELECT 1 FROM app.wallet_topups')).toBe(0);
    expect(await countRows(admin.pool, 'SELECT 1 FROM app.wallet_bank_transactions')).toBe(0);
    expect(await countRows(admin.pool, 'SELECT 1 FROM app.driver_wallets WHERE balance_vnd <> 0 OR held_vnd <> 0')).toBe(0);
  }

  // ------------------------------------------------------------------------------------------------ tests
  it('1. default deny: an ADMIN with every application permission still has no finance right, SYSTEM has them implicitly, and nobody but SYSTEM can manage them', async () => {
    const mineAdmin = adminData(await get(plainLogin, '/finance/access/me'));
    expect(mineAdmin).toMatchObject({ role: 'ADMIN', implicit: false, permissions: [] });
    const mineSystem = adminData(await get(systemLogin(), '/finance/access/me'));
    expect(mineSystem).toMatchObject({ role: 'SYSTEM', implicit: true, permissions: ['shop.payment.read', 'shop.payment.record', 'shop.entitlement.manage', READ, RECORD, 'wallet.withdrawal.process', 'wallet.withdrawal.confirm', 'wallet.withdrawal.reconcile'] });
    expect((await get(undefined, '/finance/access/me')).status).toBe(401);
    // Everything else is SYSTEM only: an ADMIN gets ADMIN_FORBIDDEN and nothing changes.
    const responses = [
      await get(plainLogin, `/finance/access/admins/${plain.userId}`),
      await grant(plain.userId, READ, 0, { who: plainLogin }), // not even to itself
      await grant(other.userId, RECORD, 0, { who: plainLogin }),
      await revoke(other.userId, RECORD, 1, { who: plainLogin }),
      await get(plainLogin, '/finance/bank-accounts'),
      await get(plainLogin, `/finance/bank-accounts/${randomUUID()}`),
      await send(plainLogin, '/finance/bank-accounts', { bank_id: 'VCB', account_number: '0123456789', account_holder: 'KHONG DUOC' }),
    ];
    for (const response of responses) {
      expect(code(response)).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    }
    expect(await rowsOf(plain.userId)).toEqual([]);
    expect(await countRows(admin.pool, `SELECT 1 FROM app.system_owned_bank_accounts WHERE account_holder = 'KHONG DUOC'`)).toBe(0);
  });

  it('2. SYSTEM grants and revokes each right with versions and idempotency; the history stays; the audit and the event carry no personal data', async () => {
    const target = other.userId;
    const view = await get(systemLogin(), `/finance/access/admins/${target}`);
    expect(permissionsOf(view)).toEqual([
      { permission_key: 'shop.payment.read', state: 'NONE', version: 0, granted_at: null, revoked_at: null },
      { permission_key: 'shop.payment.record', state: 'NONE', version: 0, granted_at: null, revoked_at: null },
      { permission_key: 'shop.entitlement.manage', state: 'NONE', version: 0, granted_at: null, revoked_at: null },
      { permission_key: READ, state: 'NONE', version: 0, granted_at: null, revoked_at: null },
      { permission_key: RECORD, state: 'NONE', version: 0, granted_at: null, revoked_at: null },
      { permission_key: 'wallet.withdrawal.process', state: 'NONE', version: 0, granted_at: null, revoked_at: null },
      { permission_key: 'wallet.withdrawal.confirm', state: 'NONE', version: 0, granted_at: null, revoked_at: null },
      { permission_key: 'wallet.withdrawal.reconcile', state: 'NONE', version: 0, granted_at: null, revoked_at: null },
    ]);
    const key = randomUUID();
    const granted = await grant(target, RECORD, 0, { key });
    expect(granted.status).toBe(200);
    expect(permissionsOf(granted).find((p) => p.permission_key === RECORD)).toMatchObject({ state: 'GRANTED', version: 1 });
    expect(permissionsOf(granted).find((p) => p.permission_key === READ)).toMatchObject({ state: 'NONE', version: 0 }); // the other right is untouched
    expect(adminData(await get(otherLogin, '/finance/access/me'))).toMatchObject({ role: 'ADMIN', permissions: [RECORD] });
    expect(await rowsOf(target)).toEqual([{ permission_key: RECORD, state: 'GRANTED', version: '1', granted_by_user_id: system.account.userId, revoked_by_user_id: null }]);
    expect(await auditCount(target, 'admin.finance_access.grant.v1')).toBe(1);
    const event = (await admin.pool.query('SELECT payload FROM app.outbox_events WHERE resource_id = $1 ORDER BY occurred_at DESC LIMIT 1', [target])).rows[0] as { payload: Record<string, unknown> };
    expect(event.payload).toEqual({ user_id: target, permission_key: RECORD, state: 'GRANTED', version: 1 });
    // A replay of the same key and body changes nothing and audits nothing more; the same key with another body is refused.
    expect((await grant(target, RECORD, 0, { key })).status).toBe(200);
    expect(adminErrorCode(await grant(target, READ, 0, { key }))).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await auditCount(target, 'admin.finance_access.grant.v1')).toBe(1);
    expect((await rowsOf(target))[0]).toMatchObject({ version: '1' });
    // State and version conflicts.
    expect(code(await grant(target, RECORD, 1))).toEqual({ status: 409, code: 'FINANCE_GRANT_STATE_CONFLICT' });
    expect(code(await grant(target, RECORD, 9))).toEqual({ status: 409, code: 'FINANCE_VERSION_CONFLICT' });
    expect(code(await revoke(target, READ, 0))).toEqual({ status: 409, code: 'FINANCE_GRANT_STATE_CONFLICT' }); // nothing to take back
    expect(code(await revoke(target, RECORD, 4))).toEqual({ status: 409, code: 'FINANCE_VERSION_CONFLICT' });
    // Revoke, then the right is gone at once; a second revoke is refused; granting again continues the same row.
    const revoked = await revoke(target, RECORD, 1);
    expect(permissionsOf(revoked).find((p) => p.permission_key === RECORD)).toMatchObject({ state: 'REVOKED', version: 2 });
    expect(adminData(await get(otherLogin, '/finance/access/me'))).toMatchObject({ permissions: [] });
    expect(code(await revoke(target, RECORD, 2))).toEqual({ status: 409, code: 'FINANCE_GRANT_STATE_CONFLICT' });
    expect(permissionsOf(await grant(target, RECORD, 2)).find((p) => p.permission_key === RECORD)).toMatchObject({ state: 'GRANTED', version: 3 });
    expect(await rowsOf(target)).toEqual([{ permission_key: RECORD, state: 'GRANTED', version: '3', granted_by_user_id: system.account.userId, revoked_by_user_id: null }]);
    // End state of this test: nothing granted (clean for the next ones).
    expect(permissionsOf(await revoke(target, RECORD, 3)).find((p) => p.permission_key === RECORD)).toMatchObject({ state: 'REVOKED', version: 4 });
    expect(await auditCount(target, 'admin.finance_access.revoke.v1')).toBe(2);
    await expectNoMoney();
  });

  it('3. strict input and targets: unknown or reserved rights, extra fields, a missing CSRF or cookie, SYSTEM / unknown / ordinary users as targets, a disabled admin', async () => {
    const target = other.userId;
    for (const body of [{}, { permission_key: READ }, { permission_key: 'wallet.adjustment.post', expected_version: 0 }, { permission_key: 'driver.bank.read', expected_version: 0 }, { permission_key: 'wallet.*', expected_version: 0 },
      { permission_key: READ, expected_version: -1 }, { permission_key: READ, expected_version: 0, role: 'SYSTEM' }, { permission_key: READ, expected_version: 0, user_id: plain.userId }]) {
      expect([JSON.stringify(body), (await send(systemLogin(), `/finance/access/admins/${target}/grant`, body)).status]).toEqual([JSON.stringify(body), 400]);
    }
    expect(adminErrorCode(await send(systemLogin(), `/finance/access/admins/${target}/grant`, { permission_key: READ, expected_version: 0 }, { csrf: null }))).toBe('ADMIN_CSRF_INVALID');
    expect(adminErrorCode(await send(systemLogin(), `/finance/access/admins/${target}/grant`, { permission_key: READ, expected_version: 0 }, { csrf: 'wrong' }))).toBe('ADMIN_CSRF_INVALID');
    expect((await admin.call('POST', `/finance/access/admins/${target}/grant`, { basePath: '/v1/admin', body: { permission_key: READ, expected_version: 0 }, headers: { 'idempotency-key': randomUUID() } })).status).toBeGreaterThanOrEqual(400);
    expect(adminErrorCode(await send(systemLogin(), `/finance/access/admins/${target}/grant`, { permission_key: READ, expected_version: 0 }, { key: 'not-a-uuid' }))).toBe('INVALID_IDEMPOTENCY_KEY');
    // Targets that are not an ADMIN membership read the same: not found. Nothing is written.
    const ordinaryPhone = randomPhone();
    admin.track(ordinaryPhone.normalized);
    const ordinaryId = randomUUID();
    await admin.pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', now(), 'PHONE_VERIFIED', 'ACTIVE', 1, now(), now())`,
      [ordinaryId, ordinaryPhone.normalized],
    );
    for (const id of [system.account.userId, randomUUID(), ordinaryId]) {
      expect(code(await grant(id, READ, 0))).toEqual({ status: 404, code: 'FINANCE_ADMIN_NOT_FOUND' });
      expect(code(await get(systemLogin(), `/finance/access/admins/${id}`))).toEqual({ status: 404, code: 'FINANCE_ADMIN_NOT_FOUND' });
    }
    expect((await get(systemLogin(), '/finance/access/admins/not-a-uuid')).status).toBe(400);
    expect((await get(systemLogin(), `/finance/access/admins/${target}?x=1`)).status).toBe(400);
    expect(await rowsOf(system.account.userId)).toEqual([]);
    // A disabled administrator cannot be given a right, but one it already has can still be taken back.
    expect(permissionsOf(await grant(target, READ, 0)).find((p) => p.permission_key === READ)).toMatchObject({ state: 'GRANTED' });
    await admin.pool.query(`UPDATE app.admin_memberships SET status = 'DISABLED', version = version + 1, updated_at = now() WHERE user_id = $1::uuid`, [target]);
    try {
      expect(code(await grant(target, RECORD, 0))).toEqual({ status: 404, code: 'FINANCE_ADMIN_NOT_FOUND' });
      expect(permissionsOf(await revoke(target, READ, 1)).find((p) => p.permission_key === READ)).toMatchObject({ state: 'REVOKED', version: 2 });
    } finally {
      await admin.pool.query(`UPDATE app.admin_memberships SET status = 'ACTIVE', version = version + 1, updated_at = now() WHERE user_id = $1::uuid`, [target]);
    }
  });

  it('4. the database refuses what the service never does: a right for SYSTEM, a delete, a skipped version, a changed identity, a right without a revocation record', async () => {
    const client = await admin.pool.connect();
    try {
      await client.query('BEGIN');
      const refused = async (label: string, run: () => Promise<unknown>, needle: string): Promise<void> => {
        await client.query(`SAVEPOINT ${label}`);
        const error = await failureOf(run);
        await client.query(`ROLLBACK TO SAVEPOINT ${label}`);
        expect([label, error instanceof Error && error.message.includes(needle)]).toEqual([label, true]);
      };
      const insert = (userId: string, key = READ, state = 'GRANTED', version = 1): Promise<unknown> =>
        client.query(
          `INSERT INTO app.admin_finance_grants (user_id, permission_key, state, granted_by_user_id, granted_at, revoked_by_user_id, revoked_at, version, created_at, updated_at)
           VALUES ($1::uuid, $2, $3, $4::uuid, now(), NULL, NULL, $5, now(), now())`,
          [userId, key, state, system.account.userId, version],
        );
      await refused('system_row', () => insert(system.account.userId), 'FINANCE_GRANT_ADMIN_ONLY');
      await refused('unknown_user', () => insert(randomUUID()), 'FINANCE_GRANT_ADMIN_ONLY');
      await refused('born_revoked', () => insert(plain.userId, READ, 'REVOKED'), 'FINANCE_GRANT_MUST_START_GRANTED');
      await refused('bad_key', () => insert(plain.userId, 'Wallet Read'), 'admin_finance_grants_key_ck');
      await insert(plain.userId, RECORD);
      const update = (set: string): Promise<unknown> => client.query(`UPDATE app.admin_finance_grants SET ${set} WHERE user_id = $1::uuid AND permission_key = $2`, [plain.userId, RECORD]);
      await refused('skip_version', () => update(`state = 'REVOKED', revoked_by_user_id = granted_by_user_id, revoked_at = now(), version = 5`), 'FINANCE_GRANT_VERSION_CONFLICT');
      await refused('identity', () => update(`permission_key = 'wallet.read', version = version + 1`), 'FINANCE_GRANT_IDENTITY_IMMUTABLE');
      await refused('revoked_without_record', () => update(`state = 'REVOKED', version = version + 1`), 'admin_finance_grants_revocation_ck');
      await refused('delete', () => client.query('DELETE FROM app.admin_finance_grants'), 'never deleted');
      await refused('truncate', () => client.query('TRUNCATE app.admin_finance_grants'), 'never deleted');
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
    expect(await rowsOf(plain.userId)).toEqual([]);
  });

  it('5. the participant a finance command asks: default deny, GRANTED passes, REVOKED and an expired session do not, SYSTEM always passes; and a revocation and a command being authorized cannot interleave', async () => {
    const participant = new FinanceAccessParticipant(new FinanceAccessRepository());
    const actorOf = (userId: string, role: 'ADMIN' | 'SYSTEM', expiresAtMs = Date.now() + 3_600_000) => ({ known: { userId }, checked: { membership: { adminRole: role } }, session: { expiresAtMs } }) as unknown as Parameters<FinanceAccessParticipant['require']>[1];
    const inTransaction = async <T>(run: (client: PoolClient, context: TransactionContext) => Promise<T>): Promise<T> => {
      const client = await admin.pool.connect();
      try {
        await client.query('BEGIN');
        return await run(client, { isActive: true, query: (text, values) => client.query(text, values as unknown[] | undefined) });
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    };
    const target = other.userId;
    const asAdmin = (): Promise<unknown> => inTransaction((_, context) => participant.require(context, actorOf(target, 'ADMIN'), RECORD, Date.now()).then(() => 'ok'));
    expect(((await failureOf(asAdmin)) as AppError).code).toBe('ADMIN_FORBIDDEN'); // no row
    expect(await inTransaction((_, context) => participant.require(context, actorOf(system.account.userId, 'SYSTEM'), RECORD, Date.now()).then(() => 'ok'))).toBe('ok'); // SYSTEM: no row needed
    expect(permissionsOf(await grant(target, RECORD, 4)).find((p) => p.permission_key === RECORD)).toMatchObject({ state: 'GRANTED', version: 5 });
    expect(await asAdmin()).toBe('ok');
    const expired = await failureOf(() => inTransaction((_, context) => participant.require(context, actorOf(target, 'ADMIN', Date.now() - 1000), RECORD, Date.now())));
    expect((expired as AppError).code).toBe('ADMIN_SESSION_INVALID');
    expect(((await failureOf(() => inTransaction((_, context) => participant.require(context, actorOf(target, 'ADMIN'), READ, Date.now())))) as AppError).code).toBe('ADMIN_FORBIDDEN'); // another right is not implied

    // A command already past the check holds the row FOR SHARE: the revocation waits for it, and only then takes effect.
    const checking = await admin.pool.connect();
    let released = false;
    try {
      await checking.query('BEGIN');
      await participant.require({ isActive: true, query: (text, values) => checking.query(text, values as unknown[] | undefined) }, actorOf(target, 'ADMIN'), RECORD, Date.now());
      const revoking = revoke(target, RECORD, 5);
      await eventually(
        async () => Number((await admin.pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`)).rows[0]?.n) >= 1,
        'the revocation waits behind the command that already passed the check',
      );
      await checking.query('COMMIT');
      released = true;
      expect(permissionsOf(await revoking).find((p) => p.permission_key === RECORD)).toMatchObject({ state: 'REVOKED', version: 6 });
    } finally {
      if (!released) {
        await checking.query('ROLLBACK').catch(() => undefined);
      }
      checking.release();
    }
    // Started after the revocation: refused.
    expect(((await failureOf(asAdmin)) as AppError).code).toBe('ADMIN_FORBIDDEN');
    await expectNoMoney();
  });

  it('6. races decided by the database: two grants of one right make ONE row, the same key twice makes ONE effect', async () => {
    const target = plain.userId;
    const held = await holdRowLock(admin.pool, 'SELECT 1 FROM app.users WHERE user_id = $1::uuid FOR UPDATE', [target]);
    let released = false;
    try {
      const waiting = async (): Promise<number> => Number((await admin.pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`)).rows[0]?.n);
      const a = grant(target, READ, 0);
      const b = grant(target, READ, 0);
      await eventually(async () => (await waiting()) >= 2, 'two grants blocked behind the held target user row');
      await held.release();
      released = true;
      const results = await Promise.all([a, b]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(adminErrorCode(results.find((r) => r.status === 409) as AdminResponse)).toBe('FINANCE_VERSION_CONFLICT');
    } finally {
      if (!released) {
        await held.release();
      }
    }
    expect(await rowsOf(target)).toEqual([{ permission_key: READ, state: 'GRANTED', version: '1', granted_by_user_id: system.account.userId, revoked_by_user_id: null }]);
    expect(await auditCount(target, 'admin.finance_access.grant.v1')).toBe(1);
    const key = randomUUID();
    const first = revoke(target, READ, 1, { key });
    const second = revoke(target, READ, 1, { key });
    const twin = await Promise.all([first, second]);
    for (const r of twin) {
      expect([200, 409]).toContain(r.status);
    }
    expect(twin.some((r) => r.status === 200)).toBe(true);
    expect(await rowsOf(target)).toEqual([{ permission_key: READ, state: 'REVOKED', version: '2', granted_by_user_id: system.account.userId, revoked_by_user_id: system.account.userId }]);
    expect(await auditCount(target, 'admin.finance_access.revoke.v1')).toBe(1);
  });

  it('7. SYSTEM configures a real receiving account: always created NOT receiving, identity fixed, no duplicate, no number in the audit or the event, nothing switches it on', async () => {
    const number = String(Math.floor(1e11 + Math.random() * 9e11));
    const body = { bank_id: 'VCB', account_number: number, account_holder: `CONG TY 11SHIP ${tag}` };
    const key = randomUUID();
    const created = await send(systemLogin(), '/finance/bank-accounts', body, { key });
    expect(created.status).toBe(201);
    const data = adminData(created);
    accountIds.push(String(data.account_id));
    expect(data).toMatchObject({ bank_id: 'VCB', account_number: number, account_holder: body.account_holder, can_receive: false, version: 1 });
    const row = (await admin.pool.query('SELECT can_receive, version::text FROM app.system_owned_bank_accounts WHERE system_account_id = $1::uuid', [data.account_id])).rows[0];
    expect(row).toEqual({ can_receive: false, version: '1' });
    // Replay: the same account, no second row. A second key for the same bank and number: one conflict that says nothing more.
    const replay = await send(systemLogin(), '/finance/bank-accounts', body, { key });
    expect([replay.status, adminData(replay).account_id]).toEqual([201, data.account_id]);
    const duplicate = await send(systemLogin(), '/finance/bank-accounts', { ...body, account_holder: 'AI DO KHAC' });
    expect(code(duplicate)).toEqual({ status: 409, code: 'FINANCE_BANK_ACCOUNT_EXISTS' });
    expect(duplicate.text).not.toContain(number);
    expect(await countRows(admin.pool, 'SELECT 1 FROM app.system_owned_bank_accounts WHERE account_number = $1', [number])).toBe(1);
    // The audit row and the event carry the identifier and the bank code only.
    const id = String(data.account_id);
    const audit = (await admin.pool.query('SELECT metadata::text AS m FROM app.audit_logs WHERE resource_id = $1', [id])).rows;
    const events = (await admin.pool.query('SELECT payload::text AS p FROM app.outbox_events WHERE resource_id = $1', [id])).rows;
    expect(audit).toHaveLength(1);
    expect(events).toHaveLength(1);
    for (const text of [...audit.map((r: { m: string }) => r.m), ...events.map((r: { p: string }) => r.p)]) {
      expect(text).not.toContain(number);
      expect(text).not.toContain(tag);
    }
    // Reads (SYSTEM only), and no route that changes, switches on or deletes an account.
    expect(adminData(await get(systemLogin(), `/finance/bank-accounts/${id}`))).toMatchObject({ account_id: id, can_receive: false });
    expect(((adminData(await get(systemLogin(), '/finance/bank-accounts')).accounts) as Array<{ account_id: string }>).some((account) => account.account_id === id)).toBe(true);
    expect(code(await get(systemLogin(), `/finance/bank-accounts/${randomUUID()}`))).toEqual({ status: 404, code: 'FINANCE_BANK_ACCOUNT_NOT_FOUND' });
    expect((await get(systemLogin(), '/finance/bank-accounts/not-a-uuid')).status).toBe(400);
    for (const [method, path] of [['POST', `/finance/bank-accounts/${id}`], ['POST', `/finance/bank-accounts/${id}/enable`], ['POST', `/finance/bank-accounts/${id}/receive`], ['POST', `/finance/bank-accounts/${id}/delete`]] as const) {
      expect([path, (await admin.call(method, path, { basePath: '/v1/admin', body: {}, cookies: sessionCookies(systemLogin()), csrf: systemLogin().csrf, headers: { 'idempotency-key': randomUUID() } })).status]).toEqual([path, 404]);
    }
    // Strict input: shapes the table accepts, no can_receive from a client, no extra field.
    for (const bad of [{}, { ...body, can_receive: true }, { ...body, bank_id: 'vcb' }, { ...body, bank_id: 'V' }, { ...body, account_number: '12345' }, { ...body, account_number: 'abc1234567' }, { ...body, account_holder: '' }, { ...body, account_holder: 'A'.repeat(121) },
      { ...body, system_account_id: randomUUID() }, { bank_id: 'VCB', account_number: number }]) {
      expect([JSON.stringify(bad), (await send(systemLogin(), '/finance/bank-accounts', bad)).status]).toEqual([JSON.stringify(bad), 400]);
    }
    // Two creations of the same new number at once: one account, one conflict.
    const raceNumber = String(Math.floor(1e11 + Math.random() * 9e11));
    const results = await Promise.all([1, 2].map(() => send(systemLogin(), '/finance/bank-accounts', { bank_id: 'ACB', account_number: raceNumber, account_holder: `RACE ${tag}` })));
    for (const r of results.filter((x) => x.status === 201)) {
      accountIds.push(String(adminData(r).account_id));
    }
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await countRows(admin.pool, 'SELECT 1 FROM app.system_owned_bank_accounts WHERE account_number = $1', [raceNumber])).toBe(1);
    // Nothing the product created can receive: the B2.1 Shipper request path stays closed without an active account of its own.
    expect(await countRows(admin.pool, `SELECT 1 FROM app.system_owned_bank_accounts WHERE system_account_id = ANY($1::uuid[]) AND can_receive`, [accountIds])).toBe(0);
    await expectNoMoney();
  });

  it('8. migration: the down latch refuses any grant (even a revoked one) and loses nothing; with the table empty, down then up leaves A1, A2.1, B1 and M03 data identical', async () => {
    const before = await rowsOf(plain.userId);
    expect(before.length).toBeGreaterThan(0); // test 6 left a REVOKED row
    const refusing = await admin.pool.connect();
    try {
      await refusing.query('BEGIN');
      const error = await failureOf(() => refusing.query(FINANCE_DOWN_SQL));
      expect(error instanceof Error && error.message.includes('FINANCE_GRANTS_DOWN_REFUSED')).toBe(true);
    } finally {
      await refusing.query('ROLLBACK').catch(() => undefined);
      refusing.release();
    }
    expect(await rowsOf(plain.userId)).toEqual(before);
    const snapshot = async (client: PoolClient): Promise<unknown> => ({
      wallets: (await client.query('SELECT * FROM app.driver_wallets ORDER BY wallet_id')).rows,
      ledger: (await client.query('SELECT * FROM app.wallet_ledger_entries ORDER BY entry_id')).rows,
      requests: (await client.query('SELECT * FROM app.wallet_topup_requests ORDER BY request_id')).rows,
      drivers: (await client.query('SELECT * FROM app.drivers ORDER BY driver_id')).rows,
      memberships: (await client.query('SELECT * FROM app.admin_memberships ORDER BY user_id')).rows,
    });
    const client = await admin.pool.connect();
    try {
      await client.query('BEGIN');
      const state = await snapshot(client);
      await client.query('ALTER TABLE app.admin_finance_grants DISABLE TRIGGER admin_finance_grants_no_delete');
      await client.query('DELETE FROM app.admin_finance_grants');
      await client.query('ALTER TABLE app.admin_finance_grants ENABLE TRIGGER admin_finance_grants_no_delete');
      await client.query(FINANCE_DOWN_SQL);
      expect((await client.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'admin_finance_grants'`)).rowCount).toBe(0);
      expect(await snapshot(client)).toEqual(state);
      await client.query(FINANCE_UP_SQL);
      expect((await client.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'admin_finance_grants'`)).rowCount).toBe(1);
      expect(await snapshot(client)).toEqual(state);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
    expect(await rowsOf(plain.userId)).toEqual(before);
    const guards = await admin.pool.query<{ tgname: string; tgenabled: string }>(`SELECT tgname, tgenabled FROM pg_trigger WHERE tgname IN ('admin_finance_grants_guard', 'admin_finance_grants_no_delete', 'wallet_ledger_a_source_gate') AND NOT tgisinternal ORDER BY tgname`);
    expect(guards.rows.map((r) => [r.tgname, r.tgenabled])).toEqual([['admin_finance_grants_guard', 'O'], ['admin_finance_grants_no_delete', 'O'], ['wallet_ledger_a_source_gate', 'O']]);
    // The ledger gate is untouched: a credit is still refused.
    await expect(admin.pool.query(`INSERT INTO app.wallet_ledger_entries (entry_id, wallet_id, sequence_no, entry_kind, delta_vnd, balance_after_vnd, created_at, topup_id) VALUES ($1::uuid, $2::uuid, 1, 'TOPUP', 1000, 1000, now(), $3::uuid)`, [randomUUID(), randomUUID(), randomUUID()])).rejects.toThrow('WALLET_LEDGER_SOURCE_NOT_AVAILABLE');
  });
});
