import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { FakeActivationOtpProvider } from '../../../apps/backend/src/admin-activation/activation-otp-providers';
import { ACTIVATION_COOKIE } from '../../../apps/backend/src/admin-activation/admin-activation-constants';
import { digestToken, generateToken } from '../../../apps/backend/src/auth/tokens';
import {
  ADMIN_PASSWORD,
  AdminApp,
  AdminCallOptions,
  AdminResponse,
  adminData,
  cookieFrom,
  startAdminApp,
  StartAdminOptions,
} from './admin-fixtures';
import { Phone, randomPhone } from './auth-fixtures';
import { createInvitation, createPayload, SystemSession } from './provisioning-fixtures';

// Shared fixtures of the M01-D-ADMIN-1C suites. The real Nest pipeline, the real PostgreSQL, the real services; only
// the SMS side is the explicit FakeActivationOtpProvider (bound by the test, never a fallback). Test database only.

export const ACTIVATION_BASE = '/v1/admin-activation';
export { ACTIVATION_COOKIE };

export interface ActivationApp {
  readonly app: AdminApp;
  readonly provider: FakeActivationOtpProvider;
  readonly pool: Pool;
}

export async function startActivationApp(options: StartAdminOptions = {}): Promise<ActivationApp> {
  const provider = new FakeActivationOtpProvider();
  const app = await startAdminApp({ ...options, activationProvider: provider });
  return { app, provider, pool: app.pool };
}

export function act(app: AdminApp, method: 'GET' | 'POST', path: string, options: AdminCallOptions = {}): Promise<AdminResponse> {
  return app.call(method, path, { ...options, basePath: ACTIVATION_BASE });
}

export interface Invite {
  readonly invitationId: string;
  readonly token: string;
  readonly phone: Phone;
}

/** A real invitation made through the 1B routes; the link token is parsed out of the one-time activation link. */
export async function newInvite(app: AdminApp, session: SystemSession, phone: Phone = randomPhone()): Promise<Invite> {
  app.track(phone.normalized);
  const created = await createInvitation(app, session, createPayload(phone.local));
  const token = created.link.split('#t=')[1];
  if (token === undefined) {
    throw new Error('activation link without a token');
  }
  return { invitationId: created.invitationId, token, phone };
}

/** The client side of one activation session: the cookie secret and the CSRF token (from start or GET state). */
export interface Act {
  readonly cookie: string;
  readonly csrf: string;
}

export const cookiesOf = (session: { cookie: string }): Record<string, string> => ({ [ACTIVATION_COOKIE]: session.cookie });

export function post(app: AdminApp, path: string, session: Act | undefined, body: unknown = {}, extra: AdminCallOptions = {}): Promise<AdminResponse> {
  return act(app, 'POST', path, {
    body,
    ...(session === undefined ? {} : { cookies: cookiesOf(session), csrf: session.csrf }),
    ...extra,
  });
}

export function getState(app: AdminApp, session: Act | undefined, extra: AdminCallOptions = {}): Promise<AdminResponse> {
  return act(app, 'GET', '/state', { ...(session === undefined ? {} : { cookies: cookiesOf(session) }), ...extra });
}

export async function begin(app: AdminApp, invite: Invite, previous?: Act): Promise<Act> {
  const response = await act(app, 'POST', '/start', {
    body: { token: invite.token },
    ...(previous === undefined ? {} : { cookies: cookiesOf(previous) }),
  });
  if (response.status !== 201 && response.status !== 200) {
    throw new Error(`start failed: ${response.status} ${response.text}`);
  }
  const cookie = cookieFrom(response, ACTIVATION_COOKIE);
  const csrf = adminData(response).csrf_token;
  if ((cookie === undefined || cookie === '') && previous === undefined) {
    throw new Error('start did not set the activation cookie');
  }
  return { cookie: cookie === undefined || cookie === '' ? (previous as Act).cookie : cookie, csrf: String(csrf) };
}

export function ok(response: AdminResponse, status = 200): AdminResponse {
  if (response.status !== status) {
    throw new Error(`expected ${status}, got ${response.status}: ${response.text}`);
  }
  return response;
}

export interface ActivationDeps {
  readonly app: AdminApp;
  readonly provider: FakeActivationOtpProvider;
}

export async function sendOtp(deps: ActivationDeps, invite: Invite, session: Act): Promise<string> {
  ok(await post(deps.app, '/otp/request', session), 202);
  const otp = deps.provider.lastOtpFor(invite.phone.normalized);
  if (otp === undefined) {
    throw new Error('the fake provider received no OTP');
  }
  return otp;
}

export async function verifyOtp(deps: ActivationDeps, invite: Invite, session: Act): Promise<void> {
  const otp = await sendOtp(deps, invite, session);
  ok(await post(deps.app, '/otp/verify', session, { code: otp }));
}

export async function setPassword(deps: ActivationDeps, session: Act, password: string = ADMIN_PASSWORD): Promise<void> {
  ok(await post(deps.app, '/password', session, { password }));
}

export async function issueSecret(deps: ActivationDeps, session: Act): Promise<string> {
  const response = ok(await post(deps.app, '/totp/enrollment', session));
  return String(adminData(response).secret);
}

export type Stage = 'START' | 'OTP_VERIFIED' | 'PASSWORD_SET' | 'TOTP_ISSUED';

export interface Progress {
  readonly session: Act;
  readonly secret?: string;
}

/** Walks the real routes up to (and including) the given stage. */
export async function advance(deps: ActivationDeps, invite: Invite, stage: Stage, previous?: Act): Promise<Progress> {
  const session = await begin(deps.app, invite, previous);
  if (stage === 'START') {
    return { session };
  }
  await verifyOtp(deps, invite, session);
  if (stage === 'OTP_VERIFIED') {
    return { session };
  }
  await setPassword(deps, session);
  if (stage === 'PASSWORD_SET') {
    return { session };
  }
  return { session, secret: await issueSecret(deps, session) };
}

// ----- direct database access (test database only) ---------------------------------------------------------------

export interface AttemptDb {
  readonly attempt_id: string;
  readonly status: string;
  readonly invalidated_reason: string | null;
  readonly totp_attempt_count: number;
  readonly user_id: string;
  readonly factor_id: string;
  readonly xmin: string;
}

export async function attemptsOf(pool: Pool, invitationId: string): Promise<AttemptDb[]> {
  const result = await pool.query<AttemptDb>(
    `SELECT attempt_id, status, invalidated_reason, totp_attempt_count, user_id, factor_id, xmin::text AS xmin
       FROM app.admin_activation_attempts WHERE invitation_id = $1::uuid ORDER BY created_at, attempt_id`,
    [invitationId],
  );
  return result.rows;
}

export async function liveAttempts(pool: Pool, invitationId: string): Promise<AttemptDb[]> {
  return (await attemptsOf(pool, invitationId)).filter((row) => row.status !== 'INVALIDATED' && row.status !== 'COMPLETED');
}

export interface ChallengeDb {
  readonly challenge_id: string;
  readonly status: string;
  readonly attempt_count: number;
  readonly xmin: string;
}

export async function challengesOf(pool: Pool, attemptId: string): Promise<ChallengeDb[]> {
  const result = await pool.query<ChallengeDb>(
    `SELECT challenge_id, status, attempt_count, xmin::text AS xmin FROM app.admin_activation_otp_challenges
      WHERE attempt_id = $1::uuid ORDER BY created_at, challenge_id`,
    [attemptId],
  );
  return result.rows;
}

export async function invitationStatus(pool: Pool, invitationId: string): Promise<string> {
  const result = await pool.query<{ status: string }>('SELECT status FROM app.admin_invitations WHERE invitation_id = $1::uuid', [invitationId]);
  return String(result.rows[0]?.status);
}

export async function auditCount(pool: Pool, actionPrefix = 'admin_activation.'): Promise<number> {
  const result = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM app.audit_logs WHERE action LIKE $1', [`${actionPrefix}%`]);
  return Number(result.rows[0]?.n ?? '0');
}

export async function bucketRows(pool: Pool, exceptKind?: string): Promise<Record<string, unknown>[]> {
  const result = await pool.query<Record<string, unknown>>(
    `SELECT * FROM app.admin_auth_limits WHERE ($1::text IS NULL OR kind <> $1) ORDER BY bucket_key`,
    [exceptKind ?? null],
  );
  return result.rows;
}

export async function bucketFailures(pool: Pool, kind: string): Promise<number> {
  const result = await pool.query<{ n: string }>(
    `SELECT COALESCE(sum(failure_count), 0)::text AS n FROM app.admin_auth_limits WHERE kind = $1`,
    [kind],
  );
  return Number(result.rows[0]?.n ?? '0');
}

/**
 * A live attempt written directly with times in the past/future of the DATABASE clock (created_at / expires_at are
 * immutable, so the only way to build "just before / just after expiry" is an INSERT). Returns the cookie secret; the
 * CSRF token is then read through GET state. Test database only.
 */
export async function insertAttempt(
  pool: Pool,
  input: {
    invitationId: string;
    status: 'STARTED' | 'OTP_VERIFIED' | 'COMPLETED' | 'INVALIDATED';
    reason?: 'SUPERSEDED' | 'INVITATION_CLOSED' | 'PHONE_CONFLICT' | 'ATTEMPTS_EXHAUSTED';
    createdAgoSeconds: number;
    expiresInSeconds: number;
    otpVerifiedAgoSeconds?: number;
  },
): Promise<{ attemptId: string; cookie: string }> {
  const cookie = generateToken().token;
  const attemptId = randomUUID();
  const generation = await pool.query<{ generation_id: string }>('SELECT generation_id FROM app.admin_invitations WHERE invitation_id = $1::uuid', [
    input.invitationId,
  ]);
  const verified = input.otpVerifiedAgoSeconds;
  await pool.query(
    `INSERT INTO app.admin_activation_attempts
       (attempt_id, invitation_id, generation_id, user_id, factor_id, token_digest, csrf_nonce, csrf_key_id, status,
        invalidated_reason, otp_verified_at, password_set_at, created_at, expires_at, completed_at, invalidated_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7, 'k1', $8, $9,
             CASE WHEN $10::int IS NULL THEN NULL ELSE now() - make_interval(secs => $10::int) END,
             CASE WHEN $8 = 'COMPLETED' THEN now() - make_interval(secs => $10::int) ELSE NULL END,
             now() - make_interval(secs => $11::int), now() + make_interval(secs => $12::int),
             CASE WHEN $8 = 'COMPLETED' THEN now() - make_interval(secs => $11::int) ELSE NULL END,
             CASE WHEN $8 = 'INVALIDATED' THEN now() - make_interval(secs => $11::int) ELSE NULL END)`,
    [
      attemptId,
      input.invitationId,
      generation.rows[0]?.generation_id,
      randomUUID(),
      randomUUID(),
      digestToken(cookie),
      randomBytes(32),
      input.status,
      input.reason ?? null,
      input.status === 'OTP_VERIFIED' || input.status === 'COMPLETED' ? (verified ?? 1) : null,
      input.createdAgoSeconds,
      input.expiresInSeconds,
    ],
  );
  return { attemptId, cookie };
}
