import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Type } from '@nestjs/common';
import { AppError } from '../../../apps/backend/src/common/app-errors';
import { poolClientSource } from '../../../apps/backend/src/transaction/pg-client-source';
import { waitForBlockedBackends } from './lock-fixtures';
import { newGate, gatedSource } from './provisioning-fixtures';
import { AdminCrypto } from '../../../apps/backend/src/admin-auth/admin-crypto';
import { AdminLimitsRepository } from '../../../apps/backend/src/admin-auth/admin-limits-repository';
import { AdminInvitationParticipant } from '../../../apps/backend/src/admin-invitations/admin-invitation-participant';
import { AdminActivationLimiter } from '../../../apps/backend/src/admin-activation/admin-activation-limiter';
import { AdminActivationRepository } from '../../../apps/backend/src/admin-activation/admin-activation-repository';
import { AdminActivationService } from '../../../apps/backend/src/admin-activation/admin-activation-service';
import { AdminInvitationReader } from '../../../apps/backend/src/admin-provisioning/admin-invitation-reader';
import { AdminIdentityParticipant } from '../../../apps/backend/src/auth/admin-identity-participant';
import { AdminPasswordVerifier } from '../../../apps/backend/src/auth/admin-password-verifier';
import { AuditWriter } from '../../../apps/backend/src/audit/audit-writer';
import { TransactionClientSource, TransactionManager } from '../../../apps/backend/src/transaction/transaction-manager';
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

export interface DisabledTestActivationApp {
  readonly app: AdminApp;
  readonly pool: Pool;
}

/** The activation wired with the local DISABLED_TEST phone verification: no OTP step, hence no provider is bound. */
export async function startDisabledTestActivationApp(options: StartAdminOptions = {}): Promise<DisabledTestActivationApp> {
  const app = await startAdminApp({ ...options, activationDisabledTest: true });
  return { app, pool: app.pool };
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
    status: 'STARTED' | 'OTP_VERIFIED' | 'PASSWORD_SET' | 'TOTP_ISSUED' | 'COMPLETED' | 'INVALIDATED';
    reason?: 'SUPERSEDED' | 'INVITATION_CLOSED' | 'PHONE_CONFLICT' | 'ATTEMPTS_EXHAUSTED';
    createdAgoSeconds: number;
    /** Negative: already expired. The column is immutable, so it is chosen here, at INSERT. */
    expiresInSeconds: number;
    otpVerifiedAgoSeconds?: number;
    /** Default REQUIRED (the column default). DISABLED_TEST rows never carry an OTP fact. */
    phoneVerificationMode?: 'REQUIRED' | 'DISABLED_TEST';
  },
): Promise<{ attemptId: string; cookie: string; userId: string; factorId: string }> {
  const cookie = generateToken().token;
  const attemptId = randomUUID();
  const userId = randomUUID();
  const factorId = randomUUID();
  const generation = await pool.query<{ generation_id: string }>('SELECT generation_id FROM app.admin_invitations WHERE invitation_id = $1::uuid', [
    input.invitationId,
  ]);
  const status = input.status;
  const verified = status === 'STARTED' || input.phoneVerificationMode === 'DISABLED_TEST' || (status === 'INVALIDATED' && input.otpVerifiedAgoSeconds === undefined) ? null : (input.otpVerifiedAgoSeconds ?? 1);
  const passwordSet = status === 'PASSWORD_SET' || status === 'TOTP_ISSUED' || status === 'COMPLETED';
  const sealed = status === 'TOTP_ISSUED';
  await pool.query(
    `INSERT INTO app.admin_activation_attempts
       (attempt_id, invitation_id, generation_id, user_id, factor_id, token_digest, csrf_nonce, csrf_key_id, status,
        invalidated_reason, otp_verified_at, password_set_at, password_hash,
        totp_key_id, totp_ciphertext, totp_iv, totp_tag, totp_issued_at,
        created_at, expires_at, completed_at, invalidated_at, phone_verification_mode)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7, 'k1', $8::varchar, $9::varchar,
             CASE WHEN $10::int IS NULL THEN NULL ELSE now() - make_interval(secs => $10::int) END,
             CASE WHEN $13::boolean THEN now() - make_interval(secs => COALESCE($10::int, 1)) ELSE NULL END,
             CASE WHEN $8::varchar IN ('PASSWORD_SET', 'TOTP_ISSUED') THEN '$argon2id$v=19$fixture' ELSE NULL END,
             CASE WHEN $14::boolean THEN 'k1' ELSE NULL END, $15, $16, $17,
             CASE WHEN $14::boolean THEN now() - make_interval(secs => COALESCE($10::int, 1)) ELSE NULL END,
             now() - make_interval(secs => $11::int), now() + make_interval(secs => $12::int),
             CASE WHEN $8::varchar = 'COMPLETED' THEN now() - make_interval(secs => $11::int) ELSE NULL END,
             CASE WHEN $8::varchar = 'INVALIDATED' THEN now() - make_interval(secs => $11::int) ELSE NULL END,
             $18::varchar)`,
    [
      attemptId,
      input.invitationId,
      generation.rows[0]?.generation_id,
      userId,
      factorId,
      digestToken(cookie),
      randomBytes(32),
      status,
      input.reason ?? null,
      verified,
      input.createdAgoSeconds,
      input.expiresInSeconds,
      passwordSet,
      sealed,
      sealed ? randomBytes(20) : null,
      sealed ? randomBytes(12) : null,
      sealed ? randomBytes(16) : null,
      input.phoneVerificationMode ?? 'REQUIRED',
    ],
  );
  return { attemptId, cookie, userId, factorId };
}

/**
 * A challenge written directly with times chosen at INSERT (created_at / expires_at / resend_not_before are immutable). The
 * digest is the real one for `otp`, so a verify can match it. Test database only.
 */
export async function insertChallenge(
  ctx: ActivationApp,
  input: {
    attemptId: string;
    phoneNormalized: string;
    otp: string;
    status: 'PENDING_DELIVERY' | 'PENDING' | 'LOCKED' | 'INVALIDATED' | 'DELIVERY_FAILED';
    createdAgoSeconds: number;
    expiresInSeconds: number;
    /** Seconds after created_at before a resend is allowed (>= 1). */
    cooldownSeconds?: number;
    attemptCount?: number;
  },
): Promise<string> {
  const challengeId = randomUUID();
  const crypto = ctx.app.running.app.get(AdminCrypto, { strict: false });
  const digest = crypto.activationOtpDigest(challengeId, input.phoneNormalized, input.otp);
  const ended = input.status === 'LOCKED' || input.status === 'INVALIDATED' || input.status === 'DELIVERY_FAILED';
  await ctx.pool.query(
    `INSERT INTO app.admin_activation_otp_challenges
       (challenge_id, attempt_id, phone_normalized, otp_digest, digest_key_id, status, attempt_count,
        created_at, expires_at, resend_not_before, ended_at)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::varchar, $7::int,
             now() - make_interval(secs => $8::int), now() + make_interval(secs => $9::int),
             now() - make_interval(secs => $8::int) + make_interval(secs => $10::int),
             CASE WHEN $11::boolean THEN now() - make_interval(secs => $8::int) ELSE NULL END)`,
    [
      challengeId,
      input.attemptId,
      input.phoneNormalized,
      digest.digest,
      digest.keyId,
      input.status,
      input.status === 'LOCKED' ? 5 : (input.attemptCount ?? 0),
      input.createdAgoSeconds,
      input.expiresInSeconds,
      input.cooldownSeconds ?? 60,
      ended,
    ],
  );
  return challengeId;
}

// ----- deterministic schedules ----------------------------------------------------------------------------------

export type Settled<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };

export function settle<T>(run: Promise<T>): Promise<Settled<T>> {
  return run.then(
    (value): Settled<T> => ({ ok: true, value }),
    (error: unknown): Settled<T> => ({ ok: false, error }),
  );
}

export function codeOf(result: Settled<unknown>): string | undefined {
  return !result.ok && result.error instanceof AppError ? result.error.code : undefined;
}

export function answerOf<T>(result: Settled<T>): T {
  if (!result.ok) {
    throw result.error instanceof Error ? result.error : new Error('unexpected failure');
  }
  return result.value;
}

export const INVITATION_X = /FROM app\.admin_invitations[\s\S]*FOR UPDATE/;
export const ATTEMPT_X = /FROM app\.admin_activation_attempts[\s\S]*FOR UPDATE/;
export const CHALLENGE_X = /FROM app\.admin_activation_otp_challenges[\s\S]*FOR UPDATE/;

export interface Schedule<A, B> {
  readonly first: Promise<Settled<A>>;
  readonly second: Promise<Settled<B>>;
  /** Lets the paused FIRST request continue. */
  release(): void;
}

/**
 * A deterministic interleaving. FIRST runs over a source that pauses it right AFTER PostgreSQL answered the statement
 * matching `pattern` (so the lock is held). Only when FIRST is really parked there does SECOND start; the schedule
 * returns once SECOND is blocked on a lock (or, with `expectBlocked: false`, once SECOND has been started). The test
 * decides when FIRST continues. No sleep orders anything.
 */
export async function schedule<A, B>(
  ctx: ActivationApp,
  pattern: RegExp,
  first: (gated: TransactionClientSource, plain: TransactionClientSource) => Promise<A>,
  second: (plain: TransactionClientSource) => Promise<B>,
  options: { expectBlocked?: boolean } = {},
): Promise<Schedule<A, B>> {
  const gate = newGate();
  const gated = gatedSource(ctx.pool, pattern, gate);
  const plain = poolClientSource(ctx.pool);
  const p1 = settle(first(gated, plain));
  try {
    const reached = await Promise.race([gate.reached.promise.then(() => 'gate' as const), p1.then(() => 'finished' as const)]);
    if (reached === 'finished') {
      throw new Error('the first request finished without reaching the gate');
    }
    const p2 = settle(second(plain));
    if (options.expectBlocked !== false) {
      await waitForBlockedBackends(ctx.pool);
    }
    return { first: p1, second: p2, release: () => gate.release.resolve() };
  } catch (error) {
    gate.release.resolve();
    throw error;
  }
}

// ----- the real service over a chosen transaction source (trace and fault injection) -------------------------------

export function directActivation(ctx: ActivationApp, source: TransactionClientSource): AdminActivationService {
  const nest = ctx.app.running.app;
  const get = <T>(token: Type<T>): T => nest.get(token, { strict: false });
  const config = ctx.app.config;
  const adminAuth = config.adminAuth;
  const activation = config.adminActivation;
  if (adminAuth === undefined || activation === undefined) {
    throw new Error('the test app has no activation configuration');
  }
  const manager = new TransactionManager(source, {
    timeoutMs: config.transaction.timeoutMs,
    idleInTransactionTimeoutMs: config.transaction.idleInTransactionTimeoutMs,
  });
  const limits = get(AdminLimitsRepository);
  return new AdminActivationService(
    manager,
    get(AdminActivationRepository),
    get(AdminInvitationParticipant),
    get(AdminInvitationReader),
    get(AdminIdentityParticipant),
    get(AdminPasswordVerifier),
    get(AdminCrypto),
    get(AuditWriter),
    new AdminActivationLimiter(manager, limits, adminAuth, activation),
    limits,
    adminAuth.limiter.key,
    ctx.provider,
    config,
    activation,
  );
}

export interface ActivationRank {
  readonly rank: number;
  readonly name: string;
}

/** Contract section 9: R0 < S0 < L2 < L3 < L8 < L9a < L9b. Anything else that locks a row is unranked (99) and fails the order check. */
export function activationRank(statement: string): ActivationRank | undefined {
  if (/pg_advisory_xact_lock/.test(statement)) {
    return { rank: 3, name: 'L3 phone advisory' };
  }
  if (/app\.admin_auth_limits/.test(statement) && /FOR UPDATE|INSERT INTO/.test(statement)) {
    return { rank: 2, name: 'L2 bucket' };
  }
  if (!/FOR (UPDATE|SHARE)/.test(statement)) {
    return undefined;
  }
  if (/FROM app\.admin_invitations\b/.test(statement)) {
    return { rank: 8, name: /FOR SHARE/.test(statement) ? 'L8 invitation S' : 'L8 invitation X' };
  }
  if (/FROM app\.admin_activation_attempts\b/.test(statement)) {
    return { rank: 9.5, name: 'L9a attempt' };
  }
  if (/FROM app\.admin_activation_otp_challenges\b/.test(statement)) {
    return { rank: 9.6, name: 'L9b challenge' };
  }
  return { rank: 99, name: `unranked lock: ${statement.slice(0, 80)}` };
}

export function activationLockSequence(statements: readonly string[]): string[] {
  return statements.map(activationRank).filter((ranked): ranked is ActivationRank => ranked !== undefined).map((ranked) => ranked.name);
}

export function activationOrderOk(statements: readonly string[]): boolean {
  let last = 0;
  for (const statement of statements) {
    const ranked = activationRank(statement);
    if (ranked === undefined) {
      continue;
    }
    if (ranked.rank < last || ranked.rank === 99) {
      return false;
    }
    last = ranked.rank;
  }
  return true;
}

/** True when `lock_timeout` is set before the first lock statement of the transaction. */
export function setsLockTimeoutFirst(statements: readonly string[]): boolean {
  const timeout = statements.findIndex((statement) => /set_config\('lock_timeout'/.test(statement));
  const firstLock = statements.findIndex((statement) => activationRank(statement) !== undefined);
  return timeout >= 0 && (firstLock < 0 || timeout < firstLock);
}
