import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AdminChallengeRepository } from '../admin-auth/admin-challenge-repository';
import { AdminMembershipRepository } from '../admin-auth/admin-membership-repository';
import { AdminSessionRepository } from '../admin-auth/admin-session-repository';
import { ACCOUNT_ORIGIN_POLICY, AccountOriginPolicy, isOrdinaryClientAccount } from '../auth/account-origin';
import { PASSWORD_HASHER, PasswordHasher } from '../auth/password-hasher';
import { SessionRepository } from '../auth/session-repository';
import { AccountScope, ResetTargetRow, UserRepository } from '../auth/user-repository';
import { RECOVER_ACCOUNT_PURPOSE, RESET_PASSWORD_ADMIN_PURPOSE, RESET_PASSWORD_PURPOSE } from '../auth/auth-constants';
import { ProofRepository } from '../auth/proof-repository';
import { digestToken, parseCanonicalToken } from '../auth/tokens';
import { OtpRequestResult, OtpVerifyResult, VerificationService } from '../auth/verification-service';
import { AppError } from '../common/app-errors';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { TransactionManager } from '../transaction/transaction-manager';
import { AuditWriter } from '../audit/audit-writer';
import { TechnicalError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { AccountRecoveryMode } from '../config/account-recovery-config';
import { IdempotencyExecutor } from '../idempotency/idempotency-executor';
import { parseIdempotencyKey } from '../idempotency/idempotency-key';
import { OutboxWriter } from '../outbox/outbox-writer';
import { SystemSettingsReader } from '../system-settings/system-settings-reader';
import { TransactionContext } from '../transaction/transaction-context';
import {
  RECOVER_AUDIT_ACTION,
  RECOVER_OPERATION_ID,
  RECOVER_USER_UNLOCKED_EVENT,
  RESET_TEST_AUDIT_ACTION,
  RESET_TEST_OPERATION_ID,
  RESET_TEST_SCOPE_TYPE,
  RESET_TEST_VERIFICATION_MARK,
  RESET_OTP_AUDIT_ACTION,
  RESET_OTP_OPERATION_ID,
  RESET_OTP_SCOPE_TYPE,
  RESET_OTP_VERIFICATION_MARK,
} from './account-recovery-constants';
import { ResetOtpInput, ResetTestInput } from './account-recovery-validation';

/** The one answer, identical for a reset account, an unknown phone, SYSTEM and anything outside the policy. */
export const RESET_ACK = Object.freeze({ next: 'LOGIN' });

export interface ResetOutcome {
  readonly status: number;
  readonly payload: unknown;
}

type TargetKind = 'USER' | 'ADMIN';

/** The scope an entry point serves. It is fixed by the CONTROLLER that calls the service, never by a request value. */
const PURPOSE_OF: Readonly<Record<AccountScope, string>> = {
  APP_USER: RESET_PASSWORD_PURPOSE,
  ADMIN_WEB: RESET_PASSWORD_ADMIN_PURPOSE,
};

/** Stable, non-secret scope id: the phone is hashed under a namespace that keeps this scope disjoint from every other. */
export function resetScopeId(phoneNormalized: string): string {
  return createHash('sha256').update(`account.recovery.reset_test.phone.v1\u0000${phoneNormalized}`, 'utf8').digest('hex');
}

/**
 * Password reset and account recovery by phone.
 *
 * SCOPES (Owner decision 2026-10-14). The application (11Food / 11Ship) resets and recovers APP_USER accounts only; the administration web
 * resets ADMIN_WEB accounts only (an ADMIN, never SYSTEM). The scope is passed by the controller of the entry point and decides, in
 * this order: the challenge purpose (RESET_PASSWORD / RESET_PASSWORD_ADMIN / RECOVER_ACCOUNT, so an OTP or a proof of one flow is
 * refused by the others), the account lookup (phone + scope) and the classification of the target. Nothing a client sends picks the scope.
 *
 * SYSTEM SETTING (APP_USER reset only): otp_password_reset_enabled=false closes every step of the self-service reset (request, verify and
 * reset answer PASSWORD_RESET_DISABLED); it never turns into a reset without a proof. The recovery of a locked account is NOT governed by
 * it: that flow always needs an OTP, and without a working SMS gateway it fails honestly.
 *
 * The no-OTP test reset (ACCOUNT_RECOVERY_MODE=DISABLED_TEST) exists for development and test on loopback only and serves APP_USER.
 */
@Injectable()
export class AccountRecoveryService {
  readonly mode: AccountRecoveryMode;

  constructor(
    private readonly executor: IdempotencyExecutor,
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly memberships: AdminMembershipRepository,
    private readonly adminSessions: AdminSessionRepository,
    private readonly challenges: AdminChallengeRepository,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly transactions: TransactionManager,
    private readonly verification: VerificationService,
    private readonly proofs: ProofRepository,
    private readonly systemSettings: SystemSettingsReader,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(ACCOUNT_ORIGIN_POLICY) private readonly policy: AccountOriginPolicy,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.mode = config.accountRecoveryMode ?? 'UNAVAILABLE';
  }

  /** Closed mode (the default, and every environment but local development/test) is 503 before anything else happens. */
  assertOpen(): void {
    if (this.mode !== 'DISABLED_TEST') {
      throw new TechnicalError('unavailable', 'Account recovery is not available');
    }
  }

  /** SMS_OTP mode only (issue #102). Every other mode, including DISABLED_TEST, answers 503 before anything else happens. */
  assertSmsOtpOpen(): void {
    if (this.mode !== 'SMS_OTP') {
      throw new TechnicalError('unavailable', 'Account recovery is not available');
    }
  }

  /**
   * The application-side gate of the SYSTEM switch otp_password_reset_enabled, read from the database on every call. Closed means the
   * self-service reset is locked (403 PASSWORD_RESET_DISABLED); it is never a way around the proof. The ADMIN_WEB reset is not governed by it.
   */
  async assertAppResetEnabled(): Promise<void> {
    if (!(await this.systemSettings.passwordResetOtpEnabled())) {
      throw new AppError('PASSWORD_RESET_DISABLED');
    }
  }

  /** The mode the application reports to its clients: SMS_OTP only while the server mode allows it AND the SYSTEM switch is on. */
  async effectiveAppMode(): Promise<'SMS_OTP' | 'DISABLED_TEST' | 'UNAVAILABLE'> {
    if (this.mode === 'DISABLED_TEST') {
      return 'DISABLED_TEST'; // the non-production no-OTP test mode (never configured on the production VPS)
    }
    return this.mode === 'SMS_OTP' && (await this.systemSettings.passwordResetOtpEnabled()) ? 'SMS_OTP' : 'UNAVAILABLE';
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  // Password reset by OTP (SMS_OTP mode)
  // ---------------------------------------------------------------------------------------------------------------------------

  /**
   * Step 1 of the OTP reset: the generic answer. The challenge exists for every number; the SMS is queued only for an account of THIS
   * scope that the reset serves (never SYSTEM, a fixture, an out-of-policy row or an account of the other scope) whose number the
   * recipient policy allows.
   */
  async requestOtp(scope: AccountScope, phoneNormalized: string, clientIp: string): Promise<OtpRequestResult> {
    this.assertSmsOtpOpen();
    if (scope === 'APP_USER') {
      await this.assertAppResetEnabled();
    }
    return this.verification.requestResetOtp(
      phoneNormalized,
      async (context) => {
        const target = await this.#targetByPhone(context, scope, phoneNormalized);
        return target !== undefined && (await this.#classify(context, scope, target)) !== undefined;
      },
      PURPOSE_OF[scope],
      clientIp,
    );
  }

  /** Step 2: a one-use proof for the purpose of the scope. A challenge of another purpose is rejected as an unknown one. */
  async verifyOtp(scope: AccountScope, verificationId: string, otp: string, requestId: string): Promise<OtpVerifyResult> {
    this.assertSmsOtpOpen();
    if (scope === 'APP_USER') {
      await this.assertAppResetEnabled();
    }
    return this.verification.verifyOtp(verificationId, otp, requestId, PURPOSE_OF[scope]);
  }

  /**
   * Step 3: sets the new password for the account of THIS scope that owns the proven number. One transaction (opened by the idempotency
   * executor): proof lock + clock -> user -> membership (admin) -> password + version -> every app / admin session revoked and
   * every unconsumed admin preauth step superseded -> proof consumed -> audit (no phone, no code, no password).
   * Roles, status, profile and the TOTP factor are never touched; nothing signs the user in.
   */
  async resetWithProof(
    scope: AccountScope,
    input: ResetOtpInput,
    idempotencyKey: string | readonly string[] | undefined,
    requestId: string,
  ): Promise<ResetOutcome> {
    this.assertSmsOtpOpen();
    if (scope === 'APP_USER') {
      await this.assertAppResetEnabled();
    }
    parseIdempotencyKey(idempotencyKey);
    const proofId = await this.#proofIdOf(input.verificationToken);
    const token = parseCanonicalToken(input.verificationToken) as string;
    const passwordHash = await this.hasher.hash(input.password);
    const outcome = await this.executor.execute(
      {
        scopeType: RESET_OTP_SCOPE_TYPE,
        scopeId: proofId,
        operationId: RESET_OTP_OPERATION_ID,
        idempotencyKey,
        logicalRequest: { mode: 'SMS_OTP', scope, verification_token: token, password: input.password },
        replay: { kind: 'non-sensitive' },
      },
      (context) => this.#applyWithProof(context, scope, proofId, passwordHash, requestId),
    );
    return { status: outcome.status, payload: outcome.payload };
  }

  async #applyWithProof(context: TransactionContext, scope: AccountScope, proofId: string, passwordHash: string, requestId: string) {
    const proof = await this.proofs.lockForRegister(context, proofId);
    if (proof === undefined) {
      throw new AppError('VERIFICATION_PROOF_INVALID');
    }
    const nowMs = await freshClockMs(context);
    if (proof.purpose !== PURPOSE_OF[scope]) {
      throw new AppError('VERIFICATION_PURPOSE_MISMATCH');
    }
    if (proof.consumed) {
      throw new AppError('VERIFICATION_PROOF_USED');
    }
    if (proof.invalidated || proof.expiresAtMs <= nowMs) {
      throw new AppError('VERIFICATION_PROOF_INVALID');
    }
    const found = await this.users.findByPhone(context, scope, proof.phoneNormalized);
    if (found === undefined) {
      throw new AppError('VERIFICATION_PROOF_INVALID');
    }
    // Lock order of the module: user, then membership.
    const target = await this.users.lockResetTarget(context, found.userId);
    if (target === undefined || target.phoneNormalized !== proof.phoneNormalized || target.accountScope !== scope) {
      throw new AppError('VERIFICATION_PROOF_INVALID');
    }
    const kind = await this.#classify(context, scope, target, 'lock');
    if (kind === undefined) {
      // SYSTEM, a fixture or an out-of-policy row is never reset by SMS, whatever proof is presented.
      throw new AppError('VERIFICATION_PROOF_INVALID');
    }
    await this.proofs.consume(context, proofId);
    await this.#changePassword(context, target, kind, passwordHash, requestId, RESET_OTP_AUDIT_ACTION, RESET_OTP_VERIFICATION_MARK);
    return { status: 200, replayGuard: { kind: 'reset_otp', proof_id: proofId }, payload: { ...RESET_ACK } };
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  // Recovery of an APP_USER account locked at its owner's request (always OTP, never governed by the OTP switches)
  // ---------------------------------------------------------------------------------------------------------------------------

  /**
   * Step 1 of the recovery: the same generic answer for every number (no way to tell a recoverable account from any other). The SMS is
   * queued only for a locked account whose lock reason is DELETE_REQUEST. An account locked for a violation or for security is never
   * eligible: it cannot unlock itself.
   */
  async requestRecoveryOtp(phoneNormalized: string, clientIp: string): Promise<OtpRequestResult> {
    this.assertSmsOtpOpen();
    return this.verification.requestResetOtp(
      phoneNormalized,
      async (context) => {
        const target = await this.#targetByPhone(context, 'APP_USER', phoneNormalized);
        return target !== undefined && (await this.#isRecoverable(context, target));
      },
      RECOVER_ACCOUNT_PURPOSE,
      clientIp,
    );
  }

  async verifyRecoveryOtp(verificationId: string, otp: string, requestId: string): Promise<OtpVerifyResult> {
    this.assertSmsOtpOpen();
    return this.verification.verifyOtp(verificationId, otp, requestId, RECOVER_ACCOUNT_PURPOSE);
  }

  /**
   * Step 3 of the recovery: the proven phone, a NEW password, and the old account (same user id, roles, profile, history) is unlocked.
   * One transaction: proof -> user -> eligibility (locked, DELETE_REQUEST, ordinary APP_USER) -> proof consumed -> password -> ACTIVE
   * (lock reason cleared) -> every session revoked -> audit -> outbox. The shop and the driver profile are NOT touched: unlocking the
   * account does not reactivate either; each keeps the state it has and works again only if it still meets its own conditions.
   */
  async recover(
    input: ResetOtpInput,
    idempotencyKey: string | readonly string[] | undefined,
    requestId: string,
  ): Promise<ResetOutcome> {
    this.assertSmsOtpOpen();
    parseIdempotencyKey(idempotencyKey);
    const proofId = await this.#proofIdOf(input.verificationToken);
    const token = parseCanonicalToken(input.verificationToken) as string;
    const passwordHash = await this.hasher.hash(input.password);
    const outcome = await this.executor.execute(
      {
        scopeType: RESET_OTP_SCOPE_TYPE,
        scopeId: proofId,
        operationId: RECOVER_OPERATION_ID,
        idempotencyKey,
        logicalRequest: { mode: 'RECOVER_LOCKED', verification_token: token, password: input.password },
        replay: { kind: 'non-sensitive' },
      },
      (context) => this.#applyRecovery(context, proofId, passwordHash, requestId),
    );
    return { status: outcome.status, payload: outcome.payload };
  }

  async #applyRecovery(context: TransactionContext, proofId: string, passwordHash: string, requestId: string) {
    const proof = await this.proofs.lockForRegister(context, proofId);
    if (proof === undefined) {
      throw new AppError('VERIFICATION_PROOF_INVALID');
    }
    const nowMs = await freshClockMs(context);
    if (proof.purpose !== RECOVER_ACCOUNT_PURPOSE) {
      throw new AppError('VERIFICATION_PURPOSE_MISMATCH');
    }
    if (proof.consumed) {
      throw new AppError('VERIFICATION_PROOF_USED');
    }
    if (proof.invalidated || proof.expiresAtMs <= nowMs) {
      throw new AppError('VERIFICATION_PROOF_INVALID');
    }
    const found = await this.users.findByPhone(context, 'APP_USER', proof.phoneNormalized);
    if (found === undefined) {
      throw new AppError('VERIFICATION_PROOF_INVALID');
    }
    const target = await this.users.lockResetTarget(context, found.userId);
    if (target === undefined || target.phoneNormalized !== proof.phoneNormalized || !(await this.#isRecoverable(context, target))) {
      // Not locked any more, locked for another reason, or no longer an ordinary application account: nothing is changed.
      throw new AppError('VERIFICATION_PROOF_INVALID');
    }
    await this.proofs.consume(context, proofId);
    const passwordVersion = await this.users.setPasswordHash(context, { userId: target.userId, passwordHash });
    if (passwordVersion === undefined) {
      throw new TechnicalError('internal', 'Locked account could not be updated');
    }
    const unlocked = await this.users.setAccountStatus(context, {
      userId: target.userId,
      from: 'DISABLED',
      to: 'ACTIVE',
      expectedVersion: passwordVersion,
    });
    if (unlocked === undefined) {
      throw new TechnicalError('internal', 'Locked account could not be unlocked');
    }
    const revoked = await this.sessions.revokeAllForUser(context, target.userId);
    await this.audit.append(context, {
      requestId,
      actorType: 'ANONYMOUS',
      action: RECOVER_AUDIT_ACTION,
      resourceType: 'user',
      resourceId: target.userId,
      resourceVersion: unlocked.version,
      outcome: 'SUCCESS',
      metadata: {
        target_user_id: target.userId,
        from_status: 'DISABLED',
        to_status: 'ACTIVE',
        lock_reason: 'DELETE_REQUEST',
        version: unlocked.version,
        verification: RESET_OTP_VERIFICATION_MARK,
        revoked_app_sessions: revoked,
      },
    });
    await this.outbox.append(context, {
      eventType: RECOVER_USER_UNLOCKED_EVENT,
      eventSchemaVersion: 1,
      resourceType: 'user',
      resourceId: target.userId,
      resourceVersion: unlocked.version,
      payload: { user_id: target.userId, account_status: 'ACTIVE', version: unlocked.version },
    });
    return { status: 200, replayGuard: { kind: 'recover_locked', proof_id: proofId, command_id: randomUUID() }, payload: { ...RESET_ACK } };
  }

  /** A locked account its owner may recover: APP_USER, DISABLED, lock reason DELETE_REQUEST, an ordinary client account of this process. */
  async #isRecoverable(context: TransactionContext, target: ResetTargetRow): Promise<boolean> {
    return (
      target.accountScope === 'APP_USER' &&
      target.status === 'DISABLED' &&
      target.lockReason === 'DELETE_REQUEST' &&
      (await this.#classify(context, 'APP_USER', target)) === 'USER'
    );
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  // No-OTP test reset (development / test on loopback only)
  // ---------------------------------------------------------------------------------------------------------------------------

  async resetTest(scope: AccountScope, input: ResetTestInput, idempotencyKey: string | readonly string[] | undefined, requestId: string): Promise<ResetOutcome> {
    this.assertOpen();
    parseIdempotencyKey(idempotencyKey);
    // Hashed outside any transaction (like login/register); a replay or a no-op target wastes one hash, which also keeps the
    // cost of every answer alike.
    const passwordHash = await this.hasher.hash(input.password);
    const outcome = await this.executor.execute(
      {
        scopeType: RESET_TEST_SCOPE_TYPE,
        scopeId: resetScopeId(input.phoneNormalized),
        operationId: RESET_TEST_OPERATION_ID,
        idempotencyKey,
        // The whole input plus the mode; only HMAC-fingerprinted by the executor, never stored or logged.
        logicalRequest: { mode: 'DISABLED_TEST', scope, phone_normalized: input.phoneNormalized, password: input.password },
        // The stored answer is the constant acknowledgement: nothing secret, nothing account specific.
        replay: { kind: 'non-sensitive' },
      },
      (context) => this.#apply(context, scope, input, passwordHash, requestId),
    );
    return { status: outcome.status, payload: outcome.payload };
  }

  async #apply(context: TransactionContext, scope: AccountScope, input: ResetTestInput, passwordHash: string, requestId: string) {
    const ack = { status: 200, replayGuard: { kind: 'reset_test' }, payload: { ...RESET_ACK } };
    const found = await this.users.findByPhone(context, scope, input.phoneNormalized);
    if (found === undefined) {
      return ack;
    }
    // Lock order of the module: user, then membership.
    const target = await this.users.lockResetTarget(context, found.userId);
    if (target === undefined || target.phoneNormalized !== input.phoneNormalized) {
      return ack;
    }
    const kind = await this.#classify(context, scope, target, 'lock');
    if (kind === undefined) {
      return ack;
    }
    await this.#changePassword(context, target, kind, passwordHash, requestId, RESET_TEST_AUDIT_ACTION, RESET_TEST_VERIFICATION_MARK);
    return ack;
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  // Shared
  // ---------------------------------------------------------------------------------------------------------------------------

  async #proofIdOf(rawToken: string): Promise<string> {
    const token = parseCanonicalToken(rawToken);
    if (token === undefined) {
      throw new AppError('VERIFICATION_PROOF_INVALID');
    }
    const tokenDigest = digestToken(token);
    const proofId = await this.transactions.withTransaction((context) => this.proofs.findIdByDigest(context, tokenDigest));
    if (proofId === undefined) {
      throw new AppError('VERIFICATION_PROOF_INVALID');
    }
    return proofId;
  }

  /** The account of THIS scope behind a phone, read without a lock (the eligibility probe of an OTP request). */
  async #targetByPhone(context: TransactionContext, scope: AccountScope, phoneNormalized: string): Promise<ResetTargetRow | undefined> {
    const found = await this.users.findByPhone(context, scope, phoneNormalized);
    if (found === undefined) {
      return undefined;
    }
    const target = await this.users.readResetTarget(context, found.userId);
    return target === undefined || target.phoneNormalized !== phoneNormalized || target.accountScope !== scope ? undefined : target;
  }

  async #changePassword(
    context: TransactionContext,
    target: ResetTargetRow,
    kind: TargetKind,
    passwordHash: string,
    requestId: string,
    auditAction: string,
    verificationMark: string,
  ): Promise<void> {
    const version = await this.users.setPasswordHash(context, { userId: target.userId, passwordHash });
    if (version === undefined) {
      throw new TechnicalError('internal', 'Locked account could not be updated');
    }
    const revokedSessions = await this.sessions.revokeAllForUser(context, target.userId);
    let adminSessionsRevoked = false;
    if (kind === 'ADMIN') {
      await this.adminSessions.revokeAllForUser(context, target.userId);
      await this.challenges.supersedeUnconsumed(context, target.userId);
      adminSessionsRevoked = true;
    }
    await this.audit.append(context, {
      requestId,
      actorType: 'ANONYMOUS',
      action: auditAction,
      resourceType: 'user',
      resourceId: target.userId,
      resourceVersion: version,
      outcome: 'SUCCESS',
      metadata: {
        target_user_id: target.userId,
        target_kind: kind,
        version,
        verification: verificationMark,
        revoked_app_sessions: revokedSessions,
        admin_credentials_revoked: adminSessionsRevoked,
      },
    });
  }

  /**
   * APP_USER scope -> USER: an ordinary client account (verified or unverified phone, no membership) that THIS process serves.
   * ADMIN_WEB scope -> ADMIN: ADMIN_PROVISIONED with an ADMIN membership (ACTIVE or DISABLED). SYSTEM, a fixture, an odd membership,
   * an account of the other scope: undefined. The account status (ACTIVE / DISABLED) does not matter: a reset never unlocks.
   * `membership` = 'lock' takes the membership row lock (the writers); the probes of an OTP request read without a lock.
   */
  async #classify(
    context: TransactionContext,
    scope: AccountScope,
    target: ResetTargetRow,
    membership: 'lock' | 'read' = 'read',
  ): Promise<TargetKind | undefined> {
    if (target.accountScope !== scope) {
      return undefined;
    }
    if (scope === 'ADMIN_WEB') {
      if (!target.hasAdminMembership || target.accountOrigin !== 'ADMIN_PROVISIONED') {
        return undefined;
      }
      const row = membership === 'lock' ? await this.memberships.lock(context, target.userId) : await this.memberships.find(context, target.userId);
      return row?.adminRole === 'ADMIN' ? 'ADMIN' : undefined;
    }
    const ordinary =
      !target.hasAdminMembership &&
      isOrdinaryClientAccount({ accountOrigin: target.accountOrigin, phoneVerified: target.phoneVerified, hasAdminMembership: false }) &&
      this.policy.allows({ accountOrigin: target.accountOrigin, phoneNormalized: target.phoneNormalized });
    return ordinary ? 'USER' : undefined;
  }
}
