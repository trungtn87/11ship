import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ADMIN_SESSION_COOKIE } from '../../apps/backend/src/admin-auth/admin-auth-constants';
import { evaluateQuote } from '../../apps/backend/src/shipping-policy/shipping-fee-quote';
import { ShippingFeePolicyReader, ShippingFeePolicyRepository } from '../../apps/backend/src/shipping-policy/shipping-fee-policy-repository';
import { poolClientSource } from '../../apps/backend/src/transaction/pg-client-source';
import { ADMIN_PASSWORD, AdminApp, adminData, adminErrorCode, AdminResponse, cookieFrom, loginStep, preauthCookies, rewindAcceptedStep, sessionCookies, startAdminApp, totpNow } from './support/admin-fixtures';
import { begin, ok, post } from './support/activation-fixtures';
import { countRows, Phone, randomPhone } from './support/auth-fixtures';
import { createInvitation, createPayload, systemSession, SystemSession } from './support/provisioning-fixtures';
import { managerFor } from './support/transaction-fixtures';

// M06-A against the REAL Nest pipeline and PostgreSQL: the flexible shipping-fee table, its draft, its immutable versions, who may change
// it, and the guarantee that an applied change never reaches a fee that was already stored. Nothing is mocked.

const tag = randomBytes(3).toString('hex').toUpperCase();
interface AdminLogin {
  readonly cookie: string;
  readonly csrf: string;
}

const tiers = (rows: ReadonlyArray<readonly [number, number, number]>): Array<{ from_m: number; to_m: number; fee_vnd: number }> => rows.map(([from_m, to_m, fee_vnd]) => ({ from_m, to_m, fee_vnd }));
const TAIL = { base_fee_vnd: 20000, step_m: 1000, step_fee_vnd: 3000 };
// The approved screen's example (UI reference): 0-2 km 10.000, 2-4 km 12.000, 4-7 km 15.000, 7-10 km 20.000; then 20.000 + 3.000 per km.
const TABLE_1 = { tiers: tiers([[0, 2000, 10000], [2000, 4000, 12000], [4000, 7000, 15000], [7000, 10000, 20000]]), tail: TAIL };
const TABLE_2 = { tiers: tiers([[0, 1500, 8000], [1500, 3500, 11000], [3500, 8000, 17000]]), tail: { base_fee_vnd: 25000, step_m: 500, step_fee_vnd: 2000 } };

describe('M06-A — shipping fee table (policy versions, draft, API)', () => {
  let admin: AdminApp;
  let system: SystemSession;
  let viewer: AdminLogin;
  const reader = (): ShippingFeePolicyReader => new ShippingFeePolicyReader(new ShippingFeePolicyRepository());
  const manager = () => managerFor(poolClientSource(admin.pool), { timeoutMs: 20_000 });

  /** The versions table is immutable for every role; a test database is reset by switching its trigger off for one statement. */
  async function resetPolicy(): Promise<void> {
    const client = await admin.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE app.shipping_fee_policy_versions DISABLE TRIGGER shipping_fee_policy_versions_immutable');
      await client.query('DELETE FROM app.shipping_fee_policy_versions');
      await client.query('ALTER TABLE app.shipping_fee_policy_versions ENABLE TRIGGER shipping_fee_policy_versions_immutable');
      await client.query('UPDATE app.shipping_fee_policy_drafts SET version = version + 1, tiers = NULL, tail_base_fee_vnd = NULL, tail_step_m = NULL, tail_step_fee_vnd = NULL, updated_by = NULL');
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
    const invitation = await createInvitation(admin, system, createPayload(phone.local, { full_name: `Xem phí ${tag}`, permissions: [{ app: 'DRIVER', can_view: true, can_review_profile: false, can_lock: false }] }));
    const token = invitation.link.split('#t=')[1] as string;
    const session = await begin(admin, { invitationId: invitation.invitationId, token, phone });
    ok(await post(admin, '/password', session, { password: ADMIN_PASSWORD }));
    const secret = String(adminData(ok(await post(admin, '/totp/enrollment', session))).secret);
    ok(await post(admin, '/complete', session, { code: totpNow(secret) }));
    const found = await admin.pool.query<{ user_id: string }>('SELECT user_id FROM app.users WHERE phone_normalized = $1', [phone.normalized]);
    viewer = await login({ phone, userId: (found.rows[0] as { user_id: string }).user_id, secret });
    await resetPolicy();
  });

  afterAll(async () => {
    // The versions point at the SYSTEM administrator: they are removed (trigger off for the reset) before the accounts.
    await resetPolicy();
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
  const get = (who: AdminLogin | undefined): Promise<AdminResponse> => admin.call('GET', '/shipping-fee-policy', { basePath: '/v1/admin', ...(who === undefined ? {} : { cookies: sessionCookies(who) }) });

  async function write(who: AdminLogin, path: string, body: unknown, key: string = randomUUID()): Promise<AdminResponse> {
    await admin.clearLimits(); // the ingress quota is not under test here
    return admin.call('POST', `/shipping-fee-policy/${path}`, { basePath: '/v1/admin', body, cookies: sessionCookies(who), csrf: who.csrf, headers: { 'idempotency-key': key } });
  }
  const codeOf = (r: AdminResponse): { status: number; code: string | undefined } => ({ status: r.status, code: adminErrorCode(r) });
  type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const state = async (who: AdminLogin = systemLogin()): Promise<Json> => adminData(await get(who)) as Json;
  const draftVersion = async (): Promise<number> => Number((await state()).draft.version);
  const saveDraft = async (table: { tiers: unknown; tail: unknown }): Promise<AdminResponse> => write(systemLogin(), 'draft', { expected_version: await draftVersion(), ...table });
  const apply = async (note?: string): Promise<AdminResponse> => write(systemLogin(), 'apply', { expected_version: await draftVersion(), ...(note === undefined ? {} : { note }) });
  const preview = (who: AdminLogin, body: unknown): Promise<AdminResponse> => write(who, 'preview', body);
  const versionCount = (): Promise<number> => countRows(admin.pool, 'SELECT 1 FROM app.shipping_fee_policy_versions');

  it('starts with NO fee table: nothing is priced, never 0 and never a built-in formula', async () => {
    const start = await state();
    expect(start.active).toBeNull();
    expect(start.draft).toMatchObject({ tiers: null, tail: null });
    expect(start.history).toEqual([]);
    const quote = adminData(await preview(systemLogin(), { distance_m: 3500 }));
    expect(quote).toMatchObject({ status: 'UNPRICED', fee_vnd: null, reason: 'POLICY_NOT_CONFIGURED' });
  });

  it('reads and previews for any administrator; no session reads nothing', async () => {
    expect(codeOf(await get(undefined))).toEqual({ status: 401, code: 'ADMIN_SESSION_INVALID' });
    expect((await get(viewer)).status).toBe(200);
    const priced = adminData(await preview(viewer, { distance_m: 5500, ...TABLE_1 }));
    expect(priced).toMatchObject({ status: 'PRICED', fee_vnd: 15000, based_on: 'EDITING' });
  });

  it('only SYSTEM changes the table: an ADMIN is refused by the server and nothing is written', async () => {
    const before = await state();
    expect(codeOf(await write(viewer, 'draft', { expected_version: Number(before.draft.version), ...TABLE_1 }))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect(codeOf(await write(viewer, 'apply', { expected_version: Number(before.draft.version) }))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect(await state()).toEqual(before);
    expect(await versionCount()).toBe(0);
  });

  it('refuses a wrong table (gap, overlap, negative, not starting at 0, empty; decimal, extra key, wrong type) and keeps the draft as it was', async () => {
    const before = await state();
    const v = Number(before.draft.version);
    const wrong: unknown[] = [
      { tiers: tiers([[0, 2000, 10000], [2500, 4000, 12000]]), tail: TAIL }, // gap
      { tiers: tiers([[0, 2000, 10000], [1500, 4000, 12000]]), tail: TAIL }, // overlap
      { tiers: tiers([[0, 2000, -1]]), tail: TAIL }, // negative fee
      { tiers: tiers([[100, 2000, 10000]]), tail: TAIL }, // does not start at 0
      { tiers: [], tail: TAIL }, // empty
      { tiers: tiers([[0, 0, 10000]]), tail: TAIL }, // empty band
      { tiers: tiers([[0, 2000, 10000]]), tail: { ...TAIL, step_m: 0 } }, // tail without a step
      { tiers: tiers([[0, 2000, 10000]]), tail: { ...TAIL, base_fee_vnd: -5 } },
    ];
    for (const table of wrong) {
      expect(codeOf(await write(systemLogin(), 'draft', { expected_version: v, ...(table as object) }))).toEqual({ status: 400, code: 'SHIPPING_POLICY_INVALID' });
    }
    for (const table of [{ tiers: tiers([[0, 2000, 10000.5]]), tail: TAIL }, { tiers: [{ from_m: 0, to_m: 2000, fee_vnd: 1000, extra: 1 }], tail: TAIL }, { tiers: [{ from_m: '0', to_m: 2000, fee_vnd: 1000 }], tail: TAIL }, { tiers: [{ from_m: 0, to_m: 2000, fee_vnd: 1000 }] }]) {
      expect(codeOf(await write(systemLogin(), 'draft', { expected_version: v, ...table }))).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' });
    }
    expect(await state()).toEqual(before);
  });

  it('saves a draft (version-checked, audited), applies it as version 1, and prices exact boundaries in metres without rounding', async () => {
    const stale = await draftVersion();
    expect((await saveDraft(TABLE_1)).status).toBe(200);
    expect(codeOf(await write(systemLogin(), 'draft', { expected_version: stale, ...TABLE_2 }))).toEqual({ status: 409, code: 'SHIPPING_DRAFT_VERSION_CONFLICT' });
    expect(codeOf(await write(systemLogin(), 'apply', { expected_version: stale }))).toEqual({ status: 409, code: 'SHIPPING_DRAFT_VERSION_CONFLICT' });
    expect(await versionCount()).toBe(0); // a draft is not in force

    const applied = await apply('Bảng giá đầu tiên');
    expect(applied.status).toBe(200);
    const after = adminData(applied) as Json;
    expect(after.active).toMatchObject({ version_no: 1, note: 'Bảng giá đầu tiên', tiers: TABLE_1.tiers, tail: TAIL });
    expect(after.draft).toMatchObject({ tiers: null, tail: null });
    expect(after.history).toBeUndefined();
    expect((await state()).history).toHaveLength(1);

    // Distance in metres, half-open bands; the boundary belongs to the next band; no km rounding (1999.9 m is still the first band).
    const fee = async (distance_m: number): Promise<unknown> => adminData(await preview(systemLogin(), { distance_m })).fee_vnd;
    expect(await fee(0)).toBe(10000);
    expect(await fee(1999.9)).toBe(10000);
    expect(await fee(2000)).toBe(12000);
    expect(await fee(5500)).toBe(15000);
    expect(await fee(9999)).toBe(20000);
    expect(await fee(10000)).toBe(20000); // the tail starts: base only
    expect(await fee(10999)).toBe(20000);
    expect(await fee(11000)).toBe(23000);
    expect(await fee(12500)).toBe(26000);
    expect(adminData(await preview(systemLogin(), { distance_m: 5500 }))).toMatchObject({ based_on: 'ACTIVE', policy_version_no: 1, band: 2 });

    expect(await countRows(admin.pool, "SELECT 1 FROM app.audit_logs WHERE action IN ('admin.shipping_fee_policy.save_draft.v1','admin.shipping_fee_policy.apply.v1') AND actor_id = $1", [system.account.userId])).toBeGreaterThanOrEqual(2);
  });

  it('refuses to apply an empty draft or one identical to the table in force; refuses a missing distance without guessing', async () => {
    expect(codeOf(await apply())).toEqual({ status: 409, code: 'SHIPPING_DRAFT_EMPTY' });
    expect((await saveDraft(TABLE_1)).status).toBe(200);
    expect(codeOf(await apply())).toEqual({ status: 409, code: 'SHIPPING_POLICY_UNCHANGED' });
    for (const bad of [{ distance_m: -1 }, { distance_m: '5' }, { distance_m: 2_000_000 }, {}]) {
      expect(codeOf(await preview(systemLogin(), bad)).status).toBe(400);
    }
    expect(await versionCount()).toBe(1);
  });

  it('a new version never changes a fee that was already stored (old orders keep their snapshot), and history is immutable', async () => {
    // What an order stores when it closes a quote: the version number and the fee, read in the transaction that prices it.
    const stored = await manager().withTransaction(async (context) => evaluateQuote(await reader().active(context), 5500));
    expect(stored).toMatchObject({ status: 'PRICED', feeVnd: 15000, policyVersionNo: 1 });

    expect((await saveDraft(TABLE_2)).status).toBe(200);
    expect((await apply('Giảm mốc đầu')).status).toBe(200);

    const now = await manager().withTransaction(async (context) => evaluateQuote(await reader().active(context), 5500));
    expect(now).toMatchObject({ status: 'PRICED', feeVnd: 17000, policyVersionNo: 2 }); // the NEXT quote uses the new table
    // The stored snapshot still reproduces its own fee from version 1, which is untouched.
    const history = ((await state()).history as Json[]).slice().reverse();
    expect(history.map((h) => h.version_no)).toEqual([1, 2]);
    expect(history[0]).toMatchObject({ tiers: TABLE_1.tiers, tail: TAIL });
    const v1 = (await manager().withTransaction((context) => new ShippingFeePolicyRepository().history(context, 10))).find((v) => v.versionNo === 1);
    expect(evaluateQuote(v1 === undefined ? null : { versionNo: 1, policy: v1.policy }, 5500)).toMatchObject({ feeVnd: (stored as { feeVnd: number }).feeVnd });

    for (const sql of ['UPDATE app.shipping_fee_policy_versions SET note = $1', 'DELETE FROM app.shipping_fee_policy_versions', 'TRUNCATE app.shipping_fee_policy_versions']) {
      await expect(admin.pool.query(sql, sql.startsWith('UPDATE') ? ['x'] : [])).rejects.toMatchObject({ code: '23001' });
    }
    await expect(admin.pool.query('DELETE FROM app.shipping_fee_policy_drafts')).rejects.toMatchObject({ code: '23001' });
    expect(await versionCount()).toBe(2);
  });

  it('the database itself refuses a wrong table, whatever the application does', async () => {
    const insert = (json: unknown, tail = [1, 1000, 100]): Promise<unknown> =>
      admin.pool.query(
        `INSERT INTO app.shipping_fee_policy_versions (version_id, version_no, tiers, tail_base_fee_vnd, tail_step_m, tail_step_fee_vnd, applied_by, applied_at)
         VALUES ($1::uuid, 999, $2::jsonb, $3, $4, $5, $6::uuid, now())`,
        [randomUUID(), JSON.stringify(json), tail[0], tail[1], tail[2], system.account.userId],
      );
    for (const bad of [tiers([[0, 1000, 1], [1500, 2000, 1]]), tiers([[0, 1000, 1], [900, 2000, 1]]), tiers([[0, 1000, -1]]), tiers([[5, 1000, 1]]), [], tiers([[0, 1000, 1]]).concat({ from_m: 1000, to_m: 2000, fee_vnd: 1, extra: 1 } as never), [{ from_m: '0', to_m: 1000, fee_vnd: 1 }], tiers([[0, 1000, 99_000_000]])]) {
      await expect(insert(bad)).rejects.toMatchObject({ code: '23514' });
    }
    await expect(insert(tiers([[0, 1000, 1]]), [0, 0, 0])).rejects.toMatchObject({ code: '23514' }); // step of 0 m
    expect(await versionCount()).toBe(2);
  });

  it('two applies of the same draft at once: exactly one wins and the numbers stay contiguous', async () => {
    expect((await saveDraft({ tiers: tiers([[0, 3000, 9000]]), tail: TAIL })).status).toBe(200);
    const v = await draftVersion();
    await admin.clearLimits();
    const results = await Promise.all([write(systemLogin(), 'apply', { expected_version: v }), write(systemLogin(), 'apply', { expected_version: v })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(codeOf(results.find((r) => r.status === 409) as AdminResponse).code).toBe('SHIPPING_DRAFT_VERSION_CONFLICT');
    const numbers = (await admin.pool.query<{ version_no: string }>('SELECT version_no::text FROM app.shipping_fee_policy_versions ORDER BY version_no')).rows.map((r) => Number(r.version_no));
    expect(numbers).toEqual([1, 2, 3]);
  });

  it('a replay of the same Idempotency-Key does not apply twice', async () => {
    expect((await saveDraft(TABLE_1)).status).toBe(200);
    const key = randomUUID();
    const v = await draftVersion();
    const first = await write(systemLogin(), 'apply', { expected_version: v }, key);
    const second = await write(systemLogin(), 'apply', { expected_version: v }, key);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(await versionCount()).toBe(4);
  });
});
