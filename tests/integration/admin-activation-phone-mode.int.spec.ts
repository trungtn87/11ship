import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import { ADMIN_SESSION_COOKIE } from '../../apps/backend/src/admin-auth/admin-auth-constants';
import { DEFAULT_ACTIVATION_LIMITS } from '../../apps/backend/src/config/admin-activation-config';
import {
  ADMIN_PASSWORD,
  adminData,
  adminErrorCode,
  cookieFrom,
  loginStep,
  preauthCookies,
  rewindAcceptedStep,
  totpNow,
  wrongCode,
} from './support/admin-fixtures';
import {
  ACTIVATION_COOKIE,
  act,
  ActivationApp,
  attemptsOf,
  auditCount,
  begin,
  challengesOf,
  DisabledTestActivationApp,
  getState,
  insertAttempt,
  issueSecret,
  newInvite,
  ok,
  post,
  startActivationApp,
  startDisabledTestActivationApp,
} from './support/activation-fixtures';
import { systemSession, SystemSession } from './support/provisioning-fixtures';

// Local test contract (2026-10-13): ADMIN_ACTIVATION_PHONE_VERIFICATION_MODE=DISABLED_TEST. No OTP, no provider, no fake
// verification fact; password, TOTP and the ADMIN login stay real. REQUIRED keeps the OTP step and a mode mismatch never
// bypasses it. The real Nest pipeline and the real PostgreSQL; no sleeps decide anything.

const STEP = 'ADMIN_ACTIVATION_STEP_INVALID';
const SESSION = 'ADMIN_ACTIVATION_SESSION_INVALID';

describe('admin activation - phone verification mode', () => {
  let local: DisabledTestActivationApp;
  let required: ActivationApp;
  let system: SystemSession;

  beforeAll(async () => {
    local = await startDisabledTestActivationApp();
    system = await systemSession(local.app);
    required = await startActivationApp();
  });

  afterAll(async () => {
    await required.app.close();
    await local.app.close();
  });

  beforeEach(async () => {
    await local.app.clearLimits();
    required.provider.clear();
  });

  const modeOf = async (attemptId: string): Promise<string> =>
    String((await local.pool.query<{ m: string }>('SELECT phone_verification_mode AS m FROM app.admin_activation_attempts WHERE attempt_id = $1::uuid', [attemptId])).rows[0]?.m);

  it('DISABLED_TEST: invitation -> link -> password -> TOTP -> complete -> ADMIN login, with no OTP and no verification fact', async () => {
    const { app, pool } = local;
    const invite = await newInvite(app, system);
    const before = await auditCount(pool);

    const started = await act(app, 'POST', '/start', { body: { token: invite.token } });
    expect(started.status).toBe(201);
    expect(adminData(started).state).toBe('STARTED');
    expect(adminData(started).phone_verification_mode).toBe('DISABLED_TEST');
    expect(adminData(started).otp).toBeUndefined();
    const session = { cookie: String(cookieFrom(started, ACTIVATION_COOKIE)), csrf: String(adminData(started).csrf_token) };

    const state = adminData(ok(await getState(app, session)));
    expect(state.phone_verification_mode).toBe('DISABLED_TEST');
    expect(state.otp).toBeUndefined();
    expect(typeof state.password_deadline).toBe('string');
    expect(state.restart_required).toBe(false);

    // The OTP routes are refused with the safe state and leave no challenge, no delivery, no proof.
    const [attempt] = await attemptsOf(pool, invite.invitationId);
    for (const [path, body] of [['/otp/request', {}], ['/otp/verify', { code: '123456' }]] as const) {
      const refused = await post(app, path, session, body);
      expect(refused.status).toBe(409);
      expect(adminErrorCode(refused)).toBe(STEP);
    }
    expect(await challengesOf(pool, String(attempt?.attempt_id))).toEqual([]);

    // The password comes straight from STARTED; no OTP fact is invented.
    ok(await post(app, '/password', session, { password: ADMIN_PASSWORD }));
    const row = await pool.query<{ status: string; otp_verified_at: Date | null; phone_verification_mode: string }>(
      'SELECT status, otp_verified_at, phone_verification_mode FROM app.admin_activation_attempts WHERE attempt_id = $1::uuid',
      [attempt?.attempt_id],
    );
    expect(row.rows[0]).toEqual({ status: 'PASSWORD_SET', otp_verified_at: null, phone_verification_mode: 'DISABLED_TEST' });
    const audit = await pool.query<{ metadata: { from_state: string } }>(
      "SELECT metadata FROM app.audit_logs WHERE action = 'admin_activation.password_set.v1' AND resource_id = $1",
      [attempt?.attempt_id],
    );
    expect(audit.rows[0]?.metadata.from_state).toBe('STARTED');

    // Completion needs the real TOTP of the issued secret.
    const secret = await issueSecret({ app, provider: required.provider }, session);
    const wrong = await post(app, '/complete', session, { code: wrongCode(secret) });
    expect(wrong.status).not.toBe(200);
    expect(
      Number((await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM app.users WHERE phone_normalized = $1', [invite.phone.normalized])).rows[0]?.n),
    ).toBe(0);
    const completed = ok(await post(app, '/complete', session, { code: totpNow(secret) }));
    expect(adminData(completed)).toEqual({ state: 'COMPLETED', next: 'LOGIN' });
    expect(completed.setCookie.some((line) => line.startsWith(`${ADMIN_SESSION_COOKIE}=`))).toBe(false);

    const account = await pool.query<{ user_id: string; account_origin: string; status: string; phone_verified_at: Date | null }>(
      'SELECT user_id, account_origin, status, phone_verified_at FROM app.users WHERE phone_normalized = $1',
      [invite.phone.normalized],
    );
    expect(account.rows).toHaveLength(1);
    expect(account.rows[0]?.account_origin).toBe('ADMIN_PROVISIONED');
    expect(account.rows[0]?.status).toBe('ACTIVE');
    const userId = String(account.rows[0]?.user_id);
    const membership = await pool.query<{ admin_role: string }>('SELECT admin_role FROM app.admin_memberships WHERE user_id = $1::uuid', [userId]);
    expect(membership.rows).toEqual([{ admin_role: 'ADMIN' }]);
    const profile = await pool.query<{ phone_verified_at: Date | null }>('SELECT phone_verified_at FROM app.admin_profiles WHERE user_id = $1::uuid', [userId]);
    expect(profile.rows).toEqual([{ phone_verified_at: null }]);
    expect(await auditCount(pool)).toBeGreaterThan(before);
    // The terminal answer keeps its shape.
    expect(adminData(ok(await getState(app, session)))).toEqual({ state: 'COMPLETED', next: 'LOGIN' });

    // Login ADMIN: password, then the TOTP (a later step is simulated like every login suite does).
    const preauth = await loginStep(app, { phone: invite.phone, password: ADMIN_PASSWORD, userId });
    await rewindAcceptedStep(app, userId);
    const verified = await app.call('POST', '/totp/verify', { body: { code: totpNow(secret) }, cookies: preauthCookies(preauth), csrf: preauth.csrf });
    expect(verified.status).toBe(200);
    expect(cookieFrom(verified, ADMIN_SESSION_COOKIE)).toBeTruthy();
  });

  it('DISABLED_TEST: TOTP enrollment cannot skip the password and a wrong TOTP creates no account', async () => {
    const { app, pool } = local;
    const invite = await newInvite(app, system);
    const session = await begin(app, invite);
    const early = await post(app, '/totp/enrollment', session);
    expect(early.status).toBe(409);
    expect(adminErrorCode(early)).toBe(STEP);
    const complete = await post(app, '/complete', session, { code: '000000' });
    expect(complete.status).toBe(409);
    expect(
      Number((await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM app.users WHERE phone_normalized = $1', [invite.phone.normalized])).rows[0]?.n),
    ).toBe(0);
  });

  it('DISABLED_TEST: the password window starts at the attempt and closes with STEP_INVALID (restart_required)', async () => {
    const { app, pool } = local;
    const invite = await newInvite(app, system);
    const { cookie } = await insertAttempt(pool, {
      invitationId: invite.invitationId,
      status: 'STARTED',
      phoneVerificationMode: 'DISABLED_TEST',
      // The attempt lifetime is capped at one hour (DDL), so the window is closed by being older than it, not by a long life.
      createdAgoSeconds: DEFAULT_ACTIVATION_LIMITS.passwordDeadlineSeconds + 60,
      expiresInSeconds: 600,
    });
    const state = await getState(app, { cookie, csrf: '' });
    expect(state.status).toBe(200);
    const csrf = String(adminData(state).csrf_token);
    expect(adminData(state).restart_required).toBe(true);
    const late = await post(app, '/password', { cookie, csrf }, { password: ADMIN_PASSWORD });
    expect(late.status).toBe(409);
    expect(adminErrorCode(late)).toBe(STEP);
    expect((await attemptsOf(pool, invite.invitationId)).map((row) => row.status)).toEqual(['STARTED']);
  });

  it('DISABLED_TEST: a phone that became an account stops the password with ADMIN_PHONE_CONFLICT and writes nothing', async () => {
    const { app, pool } = local;
    const invite = await newInvite(app, system);
    const session = await begin(app, invite);
    await pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, now(), 'ADMIN_PROVISIONED', 'ACTIVE', 1, now(), now())`,
      [randomUUID(), invite.phone.normalized, await new Argon2idPasswordHasher().hash(ADMIN_PASSWORD)],
    );
    const refused = await post(app, '/password', session, { password: ADMIN_PASSWORD });
    expect(adminErrorCode(refused)).toBe('ADMIN_PHONE_CONFLICT');
    expect((await attemptsOf(pool, invite.invitationId)).map((row) => row.status)).toEqual(['STARTED']);
  });

  it('REQUIRED is unchanged: the start reports REQUIRED with the OTP block, and the password cannot skip the OTP', async () => {
    const { app, pool } = required;
    const invite = await newInvite(local.app, system);
    const started = await act(app, 'POST', '/start', { body: { token: invite.token } });
    expect(started.status).toBe(201);
    expect(adminData(started).phone_verification_mode).toBe('REQUIRED');
    // The 201 carries no otp block; GET state does.
    const session = await begin(app, invite);
    expect(adminData(ok(await getState(app, session))).otp).toEqual({ status: 'NONE' });
    const skip = await post(app, '/password', session, { password: ADMIN_PASSWORD });
    expect(skip.status).toBe(409);
    expect(adminErrorCode(skip)).toBe(STEP);
    const [attempt] = await attemptsOf(pool, invite.invitationId);
    expect(await modeOf(String(attempt?.attempt_id))).toBe('REQUIRED');
  });

  it('a mode mismatch never continues an attempt, in either direction, and the reopened link takes the current mode', async () => {
    const invite = await newInvite(local.app, system);

    // DISABLED_TEST attempt, process back to REQUIRED: the attempt is not served (no OTP bypass).
    const disabled = await begin(local.app, invite);
    const [first] = await attemptsOf(local.pool, invite.invitationId);
    expect(await modeOf(String(first?.attempt_id))).toBe('DISABLED_TEST');
    const underRequired = await getState(required.app, disabled);
    expect(underRequired.status).toBe(401);
    expect(adminErrorCode(underRequired)).toBe(SESSION);
    const passwordUnderRequired = await post(required.app, '/password', disabled, { password: ADMIN_PASSWORD });
    expect(passwordUnderRequired.status).toBe(401);

    // Opening the link under REQUIRED supersedes it with a REQUIRED attempt.
    const upgraded = await begin(required.app, invite, disabled);
    const attempts = await attemptsOf(local.pool, invite.invitationId);
    expect(attempts.map((row) => row.status)).toEqual(['INVALIDATED', 'STARTED']);
    expect(await modeOf(String(attempts[1]?.attempt_id))).toBe('REQUIRED');

    // REQUIRED attempt, process switched to DISABLED_TEST: it cannot take a password without its OTP.
    const underLocal = await post(local.app, '/password', upgraded, { password: ADMIN_PASSWORD });
    expect(underLocal.status).toBe(401);
    expect(adminErrorCode(underLocal)).toBe(SESSION);
    expect((await attemptsOf(local.pool, invite.invitationId)).map((row) => row.status)).toEqual(['INVALIDATED', 'STARTED']);
  });

  it('the database refuses an OTP fact on DISABLED_TEST, a mode change and a password step that skips the OTP on REQUIRED', async () => {
    const { pool } = local;
    const invite = await newInvite(local.app, system);
    const disabled = await insertAttempt(pool, {
      invitationId: invite.invitationId,
      status: 'STARTED',
      phoneVerificationMode: 'DISABLED_TEST',
      createdAgoSeconds: 5,
      expiresInSeconds: 600,
    });
    await expect(
      pool.query("UPDATE app.admin_activation_attempts SET status = 'OTP_VERIFIED', otp_verified_at = now() WHERE attempt_id = $1::uuid", [disabled.attemptId]),
    ).rejects.toThrow();
    await expect(
      pool.query("UPDATE app.admin_activation_attempts SET phone_verification_mode = 'REQUIRED' WHERE attempt_id = $1::uuid", [disabled.attemptId]),
    ).rejects.toThrow();

    const other = await newInvite(local.app, system);
    const strict = await insertAttempt(pool, { invitationId: other.invitationId, status: 'STARTED', createdAgoSeconds: 5, expiresInSeconds: 600 });
    await expect(
      pool.query(
        "UPDATE app.admin_activation_attempts SET status = 'PASSWORD_SET', password_set_at = now(), password_hash = '$argon2id$v=19$x' WHERE attempt_id = $1::uuid",
        [strict.attemptId],
      ),
    ).rejects.toThrow();
  });
});
