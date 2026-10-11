import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { AdminCredentialChecks } from '../../../apps/backend/src/admin-auth/admin-credential-checks';
import { AdminCrypto } from '../../../apps/backend/src/admin-auth/admin-crypto';
import { AdminFactorRepository } from '../../../apps/backend/src/admin-auth/admin-factor-repository';
import { AdminLimiter } from '../../../apps/backend/src/admin-auth/admin-limiter';
import { AdminLimitsRepository } from '../../../apps/backend/src/admin-auth/admin-limits-repository';
import { AdminMembershipRepository } from '../../../apps/backend/src/admin-auth/admin-membership-repository';
import { AdminSessionRepository } from '../../../apps/backend/src/admin-auth/admin-session-repository';
import { AdminInvitationParticipant } from '../../../apps/backend/src/admin-invitations/admin-invitation-participant';
import { AdminInvitationRepository } from '../../../apps/backend/src/admin-invitations/admin-invitation-repository';
import { AdminInvitationReader } from '../../../apps/backend/src/admin-provisioning/admin-invitation-reader';
import { AdminActivationInvalidator } from '../../../apps/backend/src/admin-activation/admin-activation-invalidator';
import { AdminActivationRepository } from '../../../apps/backend/src/admin-activation/admin-activation-repository';
import { AdminInvitationService } from '../../../apps/backend/src/admin-provisioning/admin-invitation-service';
import { AdminOperationRepository } from '../../../apps/backend/src/admin-provisioning/admin-operation-repository';
import { AdminOperationService } from '../../../apps/backend/src/admin-provisioning/admin-operation-service';
import { AdminSystemActor } from '../../../apps/backend/src/admin-provisioning/admin-system-actor';
import { AdminIdentityParticipant } from '../../../apps/backend/src/auth/admin-identity-participant';
import { UserRepository } from '../../../apps/backend/src/auth/user-repository';
import { AuditWriter, AuditWriterOptions } from '../../../apps/backend/src/audit/audit-writer';
import { Keyring } from '../../../apps/backend/src/crypto/keyring';
import { requireKeyring } from '../../../apps/backend/src/idempotency/idempotency.module';
import { IdempotencyExecutor } from '../../../apps/backend/src/idempotency/idempotency-executor';
import { poolClientSource } from '../../../apps/backend/src/transaction/pg-client-source';
import {
  TransactionClient,
  TransactionClientSource,
  TransactionManager,
} from '../../../apps/backend/src/transaction/transaction-manager';
import { ADMIN_SESSION_COOKIE } from '../../../apps/backend/src/admin-auth/admin-auth-constants';
import {
  AdminApp,
  AdminCallOptions,
  AdminResponse,
  adminData,
  cookieFrom,
  createSystem,
  enrollAndLogin,
  loginStep,
  preauthCookies,
  rewindAcceptedStep,
  SessionLogin,
  SystemAccount,
  totpNow,
} from './admin-fixtures';
import { Deferred, deferred } from './async-helpers';
import { randomPhone } from './auth-fixtures';

// Shared fixtures of the M01-D-ADMIN-1B suites: SYSTEM sessions, step-up operations, raw invitations for the cases a
// public path cannot produce quickly (an invitation already past expires_at), and services built directly over a
// gated transaction source for the barrier schedules. Test database only.

export const PROVISIONING_BASE = '/v1/admin';

export function api(app: AdminApp, method: 'GET' | 'POST', path: string, options: AdminCallOptions = {}): Promise<AdminResponse> {
  return app.call(method, path, { ...options, basePath: PROVISIONING_BASE });
}

export interface SystemSession {
  readonly account: SystemAccount;
  readonly login: SessionLogin;
}

/** A fresh SYSTEM account (the only one) with an enrolled factor and a live session. */
export async function systemSession(app: AdminApp, ip?: string): Promise<SystemSession> {
  const account = await createSystem(app);
  const login = await enrollAndLogin(app, account, ip);
  return { account, login };
}

/** A second full login of the same SYSTEM: #34 revokes the previous session, the factor stays the same. */
export async function relogin(app: AdminApp, session: SystemSession): Promise<SystemSession> {
  const preauth = await loginStep(app, session.account);
  await rewindAcceptedStep(app, session.account.userId);
  const verified = await app.call('POST', '/totp/verify', {
    body: { code: totpNow(session.login.secret) },
    cookies: preauthCookies(preauth),
    csrf: preauth.csrf,
  });
  if (verified.status !== 200) {
    throw new Error(`re-login failed: ${verified.status} ${verified.text}`);
  }
  const cookie = cookieFrom(verified, ADMIN_SESSION_COOKIE);
  if (cookie === undefined || cookie === '') {
    throw new Error('re-login did not set the session cookie');
  }
  return {
    account: session.account,
    login: { cookie, csrf: String(adminData(verified).csrf_token), secret: session.login.secret, response: verified },
  };
}

export function sessionOf(session: { login: { cookie: string; csrf: string } }): { cookies: Record<string, string>; csrf: string } {
  return { cookies: { [ADMIN_SESSION_COOKIE]: session.login.cookie }, csrf: session.login.csrf };
}

export function permissions(...apps: Array<'CUSTOMER' | 'SHOP' | 'DRIVER'>): Record<string, unknown>[] {
  return (apps.length === 0 ? (['SHOP'] as const) : apps).map((app) => ({
    app,
    can_view: true,
    can_review_profile: false,
    can_lock: false,
  }));
}

export function createPayload(phoneLocal?: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    full_name: 'Nguyễn Văn Quản Trị',
    phone: phoneLocal ?? randomPhone().local,
    note: 'ca sáng',
    permissions: permissions('SHOP'),
    ...extra,
  };
}

export async function createOperation(
  app: AdminApp,
  session: SystemSession,
  action: 'CREATE_INVITATION' | 'REISSUE_INVITATION' | 'REVOKE_INVITATION',
  payload: Record<string, unknown>,
): Promise<string> {
  const response = await api(app, 'POST', '/operations', { body: { action, payload }, ...sessionOf(session) });
  if (response.status !== 201) {
    throw new Error(`create-operation failed: ${response.status} ${response.text}`);
  }
  return String(adminData(response).operation_id);
}

/** Verifies with the CURRENT step's code; the accepted step is rewound first so the code counts as a first use. */
export async function verifyOperation(app: AdminApp, session: SystemSession, operationId: string): Promise<AdminResponse> {
  await rewindAcceptedStep(app, session.account.userId);
  return api(app, 'POST', `/operations/${operationId}/verify`, {
    body: { code: totpNow(session.login.secret) },
    ...sessionOf(session),
  });
}

/** create-operation + verify: a VERIFIED operation id for exactly this action and payload. */
export async function stepUp(
  app: AdminApp,
  session: SystemSession,
  action: 'CREATE_INVITATION' | 'REISSUE_INVITATION' | 'REVOKE_INVITATION',
  payload: Record<string, unknown>,
): Promise<string> {
  const operationId = await createOperation(app, session, action, payload);
  const verified = await verifyOperation(app, session, operationId);
  if (verified.status !== 200) {
    throw new Error(`verify failed: ${verified.status} ${verified.text}`);
  }
  return operationId;
}

export interface CreatedInvitation {
  readonly invitationId: string;
  readonly version: number;
  readonly link: string;
  readonly response: AdminResponse;
}

export async function createInvitation(
  app: AdminApp,
  session: SystemSession,
  payload: Record<string, unknown> = createPayload(),
  key: string = randomUUID(),
): Promise<CreatedInvitation> {
  const operationId = await stepUp(app, session, 'CREATE_INVITATION', payload);
  const response = await api(app, 'POST', '/invitations', {
    body: { operation_id: operationId, ...payload },
    headers: { 'idempotency-key': key },
    ...sessionOf(session),
  });
  if (response.status !== 201) {
    throw new Error(`create invitation failed: ${response.status} ${response.text}`);
  }
  const data = adminData(response);
  const invitation = data.invitation as Record<string, unknown>;
  return {
    invitationId: String(invitation.invitation_id),
    version: Number(invitation.version),
    link: String(data.activation_link),
    response,
  };
}

/**
 * A sealed PENDING invitation written directly (test database only), for states a public path cannot produce at once:
 * already past expires_at, or a PENDING that appears while a request holds a verified operation. expires_at is never
 * updatable (identity), so the dates are chosen at INSERT.
 */
export async function insertRawInvitation(
  pool: Pool,
  input: { createdBy: string; phoneNormalized: string; expired: boolean },
): Promise<string> {
  const client = await pool.connect();
  const invitationId = randomUUID();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO app.admin_invitations
         (invitation_id, generation_id, phone_normalized, full_name, note, token_digest, status, version, created_by,
          created_at, expires_at, snapshot_sealed)
       VALUES ($1::uuid, $2::uuid, $3, 'Raw Invitation', NULL, $4, 'PENDING', 1, $5::uuid,
               ${input.expired ? "now() - interval '2 hours'" : 'now()'},
               ${input.expired ? "now() - interval '1 hour'" : "now() + interval '72 hours'"}, false)`,
      [invitationId, randomUUID(), input.phoneNormalized, randomUUID().replace(/-/g, '').padEnd(64, '0'), input.createdBy],
    );
    await client.query(
      `INSERT INTO app.admin_invitation_permissions (invitation_id, app, can_view, can_review_profile, can_lock)
       VALUES ($1::uuid, 'SHOP', true, false, false)`,
      [invitationId],
    );
    await client.query('UPDATE app.admin_invitations SET snapshot_sealed = true WHERE invitation_id = $1::uuid', [invitationId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return invitationId;
}

export async function operationRow(
  pool: Pool,
  operationId: string,
): Promise<{ status: string; attempt_count: number; invalidated_reason: string | null } | undefined> {
  const result = await pool.query<{ status: string; attempt_count: number; invalidated_reason: string | null }>(
    'SELECT status, attempt_count, invalidated_reason FROM app.admin_sensitive_operations WHERE operation_id = $1::uuid',
    [operationId],
  );
  return result.rows[0];
}

export async function invitationRow(
  pool: Pool,
  invitationId: string,
): Promise<{ status: string; version: string; successor_id: string | null } | undefined> {
  const result = await pool.query<{ status: string; version: string; successor_id: string | null }>(
    'SELECT status, version::text AS version, successor_id FROM app.admin_invitations WHERE invitation_id = $1::uuid',
    [invitationId],
  );
  return result.rows[0];
}

export async function totpBucketFailures(pool: Pool): Promise<number> {
  const result = await pool.query<{ n: string }>(
    `SELECT COALESCE(sum(failure_count), 0)::text AS n FROM app.admin_auth_limits WHERE kind = 'TOTP_USER'`,
  );
  return Number(result.rows[0]?.n ?? '0');
}

// ----- services built directly, for barrier schedules and fault injection -----------------------------------------

export interface Gate {
  readonly reached: Deferred;
  readonly release: Deferred;
}

export function newGate(): Gate {
  return { reached: deferred(), release: deferred() };
}

/**
 * The real pool, except that the FIRST statement matching `pattern` is paused after PostgreSQL has answered it (so the
 * lock it took is held) until the test releases the gate. Every statement text is also appended to `trace`, if given.
 */
export function gatedSource(pool: Pool, pattern: RegExp | null, gate: Gate | null, trace?: string[][]): TransactionClientSource {
  const inner = poolClientSource(pool);
  let fired = false;
  return {
    async acquire(): Promise<TransactionClient> {
      const real = await inner.acquire();
      const statements: string[] = [];
      trace?.push(statements);
      return {
        query: async (text, values) => {
          statements.push(text);
          const result = await real.query(text, values);
          if (!fired && pattern !== null && gate !== null && pattern.test(text)) {
            fired = true;
            gate.reached.resolve();
            await gate.release.promise;
          }
          return result;
        },
        release: (destroy) => real.release(destroy),
        onError: (listener) => real.onError(listener),
      };
    },
  };
}

export interface DirectServices {
  readonly operations: AdminOperationService;
  readonly invitations: AdminInvitationService;
}

/**
 * The 1B services over a chosen transaction source, wired exactly like AdminAuthModule does (same classes, same
 * configuration as the running test app). `executorSource` (default: the same source) lets a test inject a fault only
 * into the idempotent mutation (for example a lost COMMIT acknowledgement); `audit` lets it inject an audit failure.
 */
export function directServices(
  app: AdminApp,
  source: TransactionClientSource,
  options: {
    executorSource?: TransactionClientSource;
    audit?: AuditWriterOptions;
    /** Replaces the CRYPTO keyring of the administration crypto and of the executor. */
    keyring?: Keyring;
    /** Replaces only the executor's keyring (idempotency records). */
    executorKeyring?: Keyring;
  } = {},
): DirectServices {
  const config = app.config;
  const adminConfig = config.adminAuth;
  if (adminConfig === undefined) {
    throw new Error('the test app has no administration configuration');
  }
  const transaction = { timeoutMs: config.transaction.timeoutMs, idleInTransactionTimeoutMs: config.transaction.idleInTransactionTimeoutMs };
  const manager = new TransactionManager(source, transaction);
  const executorManager = options.executorSource === undefined ? manager : new TransactionManager(options.executorSource, transaction);
  const keyring = options.keyring ?? requireKeyring(config);
  const crypto = new AdminCrypto(keyring);
  const identities = new AdminIdentityParticipant(new UserRepository());
  const memberships = new AdminMembershipRepository();
  const factors = new AdminFactorRepository();
  const sessions = new AdminSessionRepository();
  const checks = new AdminCredentialChecks(identities, memberships, crypto);
  const actor = new AdminSystemActor(manager, sessions, checks, factors, crypto);
  const operationsRepository = new AdminOperationRepository();
  const reader = new AdminInvitationReader();
  const limits = new AdminLimitsRepository();
  const limiter = new AdminLimiter(manager, limits, adminConfig.limiter.key);
  const audit = new AuditWriter(options.audit);
  const operations = new AdminOperationService(
    manager,
    actor,
    operationsRepository,
    reader,
    identities,
    factors,
    limits,
    limiter,
    crypto,
    audit,
    config,
  );
  const invitations = new AdminInvitationService(
    manager,
    new IdempotencyExecutor(executorManager, options.executorKeyring ?? keyring, config.idempotency),
    actor,
    new AdminInvitationParticipant(new AdminInvitationRepository()),
    reader,
    operationsRepository,
    identities,
    crypto,
    audit,
    new AdminActivationInvalidator(new AdminActivationRepository(), audit),
    adminConfig.limiter.key,
    config,
    adminConfig,
  );
  return { operations, invitations };
}

/** Lock statements as the trace sees them, ranked by the contract's table (section 8.1). Writes are not ranked. */
export function lockRank(statement: string, seenAdvisory: boolean): { rank: number; name: string } | undefined {
  if (/pg_advisory_xact_lock/.test(statement)) {
    return seenAdvisory ? { rank: 3, name: 'L3 phone advisory' } : { rank: 1, name: 'L1 idempotency advisory' };
  }
  if (/FROM app\.idempotency_records[\s\S]*FOR UPDATE/.test(statement)) {
    return { rank: 1.5, name: 'L1 idempotency record' };
  }
  if (/app\.admin_auth_limits/.test(statement) && /FOR UPDATE|INSERT INTO/.test(statement)) {
    return { rank: 2, name: 'L2 TOTP bucket' };
  }
  const rowLock = /FOR (UPDATE|SHARE)/.test(statement);
  if (!rowLock) {
    return undefined;
  }
  if (/FROM app\.users\b/.test(statement)) {
    return { rank: 4, name: 'L4 users' };
  }
  if (/FROM app\.admin_memberships\b/.test(statement)) {
    return { rank: 5, name: 'L5 admin_memberships' };
  }
  if (/FROM app\.admin_totp_factors\b/.test(statement)) {
    return { rank: 6, name: 'L6 admin_totp_factors' };
  }
  if (/FROM app\.admin_sessions\b/.test(statement)) {
    return { rank: 7, name: 'L7 admin_sessions' };
  }
  if (/FROM app\.admin_invitations\b/.test(statement)) {
    return { rank: 8, name: 'L8 admin_invitations' };
  }
  if (/FROM app\.admin_sensitive_operations\b/.test(statement)) {
    return { rank: 9, name: 'L9 admin_sensitive_operations' };
  }
  if (/FROM app\.admin_activation_attempts\b/.test(statement)) {
    return { rank: 9.5, name: 'L9a admin_activation_attempts' };
  }
  if (/FROM app\.admin_activation_otp_challenges\b/.test(statement)) {
    return { rank: 9.6, name: 'L9b admin_activation_otp_challenges' };
  }
  return { rank: 99, name: `unranked lock: ${statement.slice(0, 80)}` };
}

/** The ranked lock sequence of one traced transaction. */
export function lockSequence(statements: readonly string[]): string[] {
  let seenAdvisory = false;
  const names: string[] = [];
  for (const statement of statements) {
    const ranked = lockRank(statement, seenAdvisory);
    if (ranked !== undefined) {
      if (ranked.rank === 1) {
        seenAdvisory = true;
      }
      names.push(ranked.name);
    }
  }
  return names;
}

export function isNonDecreasing(statements: readonly string[]): boolean {
  let seenAdvisory = false;
  let last = 0;
  for (const statement of statements) {
    const ranked = lockRank(statement, seenAdvisory);
    if (ranked === undefined) {
      continue;
    }
    if (ranked.rank === 1) {
      seenAdvisory = true;
    }
    if (ranked.rank < last || ranked.rank === 99) {
      return false;
    }
    last = ranked.rank;
  }
  return true;
}
