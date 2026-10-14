import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AdminChallengeRepository } from '../admin-auth/admin-challenge-repository';
import { AdminMembershipRepository } from '../admin-auth/admin-membership-repository';
import { AdminSessionRepository } from '../admin-auth/admin-session-repository';
import { ACCOUNT_ORIGIN_POLICY, AccountOriginPolicy, isOrdinaryClientAccount } from '../auth/account-origin';
import { PASSWORD_HASHER, PasswordHasher } from '../auth/password-hasher';
import { SessionRepository } from '../auth/session-repository';
import { ResetTargetRow, UserRepository } from '../auth/user-repository';
import { RESET_PASSWORD_PURPOSE } from '../auth/auth-constants';
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
import { TransactionContext } from '../transaction/transaction-context';
import {
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

/** The one answer, identical for a reset account, an unknown phone, SYSTEM and anything outside the test policy. */
export const RESET_ACK = Object.freeze({ next: 'LOGIN' });

export interface ResetOutcome {
  readonly status: number;
  readonly payload: unknown;
}

type TargetKind = 'USER' | 'ADMIN';

/** Stable, non-secret scope id: the phone is hashed under a namespace that keeps this scope disjoint from every other. */
export function resetScopeId(phoneNormalized: string): string {
  return createHash('sha256').update(`account.recovery.reset_test.phone.v1\u0000${phoneNormalized}`, 'utf8').digest('hex');
}

/**
 * No-OTP test password reset (M01-RESET, Owner decision 2026-10-13). Only runs with ACCOUNT_RECOVERY_MODE=DISABLED_TEST
 * (development/test on loopback); every other mode answers 503 before the key is read, hashed or any row touched.
 *
 * One transaction opened by the idempotency executor: record -> target user X -> admin membership X (admin only) -> classify ->
 * password + version -> every app session and admin session revoked, every unconsumed admin preauth step consumed -> audit.
 * The answer is the same for every phone, so the endpoint does not reveal which phone exists, and SYSTEM / unknown / out-of-policy
 * targets are changed in no way. Roles, status, profile, TOTP factor and membership are never touched. Pending TOTP enrollments
 * stay as they are (reset cannot activate them).
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
    private readonly transactions: TransactionManager,
    private readonly verification: VerificationService,
    private readonly proofs: ProofRepository,
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
   * Step 1 of the OTP reset: the generic answer. The challenge exists for every number; the SMS is queued only for a USER or
   * ADMIN account (never SYSTEM, a fixture or an out-of-policy row) whose number the recipient policy allows.
   */
  async requestOtp(phoneNormalized: string): Promise<OtpRequestResult> {
    this.assertSmsOtpOpen();
    return this.verification.requestResetOtp(phoneNormalized, async (context) => {
      const found = await this.users.findByPhone(context, phoneNormalized);
      if (found === undefined) {
        return false;
      }
      const target = await this.users.readResetTarget(context, found.userId);
      if (target === undefined || target.phoneNormalized !== phoneNormalized) {
        return false;
      }
      const membership = target.hasAdminMembership ? await this.memberships.find(context, target.userId) : undefined;
      return this.#classify(target, membership?.adminRole) !== undefined;
    });
  }

  /** Step 2: a one-use proof for the RESET_PASSWORD purpose. A REGISTER challenge is rejected as an unknown one. */
  async verifyOtp(verificationId: string, otp: string, requestId: string): Promise<OtpVerifyResult> {
    this.assertSmsOtpOpen();
    return this.verification.verifyOtp(verificationId, otp, requestId, RESET_PASSWORD_PURPOSE);
  }

  /**
   * Step 3: sets the new password for the account that owns the proven number. One transaction (opened by the idempotency
   * executor): proof lock + clock -> user -> membership (admin) -> password + version -> every app / admin session revoked and
   * every unconsumed admin preauth step superseded -> proof consumed -> audit (no phone, no code, no password).
   * Roles, status, profile and the TOTP factor are never touched; nothing signs the user in.
   */
  async resetWithProof(
    input: ResetOtpInput,
    idempotencyKey: string | readonly string[] | undefined,
    requestId: string,
  ): Promise<ResetOutcome> {
    this.assertSmsOtpOpen();
    parseIdempotencyKey(idempotencyKey);
    const token = parseCanonicalToken(input.verificationToken);
    if (token === undefined) {
      throw new AppError('VERIFICATION_PROOF_INVALID');
    }
    const tokenDigest = digestToken(token);
    const proofId = await this.transactions.withTransaction((context) => this.proofs.findIdByDigest(context, tokenDigest));
    if (proofId === undefined) {
      throw new AppError('VERIFICATION_PROOF_INVALID');
    }
    const passwordHash = await this.hasher.hash(input.password);
    const outcome = await this.executor.execute(
      {
        scopeType: RESET_OTP_SCOPE_TYPE,
        scopeId: proofId,
        operationId: RESET_OTP_OPERATION_ID,
        idempotencyKey,
        logicalRequest: { mode: 'SMS_OTP', verification_token: token, password: input.password },
        replay: { kind: 'non-sensitive' },
      },
      (context) => this.#applyWithProof(context, proofId, passwordHash, requestId),
    );
    return { status: outcome.status, payload: outcome.payload };
  }

  async #applyWithProof(context: TransactionContext, proofId: string, passwordHash: string, requestId: string) {
    const proof = await this.proofs.lockForRegister(context, proofId);
    if (proof === undefined) {
      throw new AppError('VERIFICATION_PROOF_INVALID');
    }
    const nowMs = await freshClockMs(context);
    if (proof.purpose !== RESET_PASSWORD_PURPOSE) {
      throw new AppError('VERIFICATION_PURPOSE_MISMATCH');
    }
    if (proof.consumed) {
      throw new AppError('VERIFICATION_PROOF_USED');
    }
    if (proof.invalidated || proof.expiresAtMs <= nowMs) {
      throw new AppError('VERIFICATION_PROOF_INVALID');
    }
    const found = await this.users.findByPhone(context, proof.phoneNormalized);
    if (found === undefined) {
      throw new AppError('VERIFICATION_PROOF_INVALID');
    }
    // Lock order of the module: user, then membership.
    const target = await this.users.lockResetTarget(context, found.userId);
    if (target === undefined || target.phoneNormalized !== proof.phoneNormalized) {
      throw new AppError('VERIFICATION_PROOF_INVALID');
    }
    const membership = target.hasAdminMembership ? await this.memberships.lock(context, target.userId) : undefined;
    const kind = this.#classify(target, membership?.adminRole);
    if (kind === undefined) {
      // SYSTEM, a fixture or an out-of-policy row is never reset by SMS, whatever proof is presented.
      throw new AppError('VERIFICATION_PROOF_INVALID');
    }
    await this.proofs.consume(context, proofId);
    await this.#changePassword(context, target, kind, passwordHash, requestId, RESET_OTP_AUDIT_ACTION, RESET_OTP_VERIFICATION_MARK);
    return { status: 200, replayGuard: { kind: 'reset_otp', proof_id: proofId }, payload: { ...RESET_ACK } };
  }

  async resetTest(input: ResetTestInput, idempotencyKey: string | readonly string[] | undefined, requestId: string): Promise<ResetOutcome> {
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
        logicalRequest: { mode: 'DISABLED_TEST', phone_normalized: input.phoneNormalized, password: input.password },
        // The stored answer is the constant acknowledgement: nothing secret, nothing account specific.
        replay: { kind: 'non-sensitive' },
      },
      (context) => this.#apply(context, input, passwordHash, requestId),
    );
    return { status: outcome.status, payload: outcome.payload };
  }

  async #apply(context: TransactionContext, input: ResetTestInput, passwordHash: string, requestId: string) {
    const ack = { status: 200, replayGuard: { kind: 'reset_test' }, payload: { ...RESET_ACK } };
    const found = await this.users.findByPhone(context, input.phoneNormalized);
    if (found === undefined) {
      return ack;
    }
    // Lock order of the module: user, then membership.
    const target = await this.users.lockResetTarget(context, found.userId);
    if (target === undefined || target.phoneNormalized !== input.phoneNormalized) {
      return ack;
    }
    const membership = target.hasAdminMembership ? await this.memberships.lock(context, target.userId) : undefined;
    const kind = this.#classify(target, membership?.adminRole);
    if (kind === undefined) {
      return ack;
    }
    await this.#changePassword(context, target, kind, passwordHash, requestId, RESET_TEST_AUDIT_ACTION, RESET_TEST_VERIFICATION_MARK);
    return ack;
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
   * USER: an ordinary client account (PHONE_VERIFIED / TEST_UNVERIFIED row shape, no membership) that THIS process serves.
   * ADMIN: ADMIN_PROVISIONED with an ADMIN membership (ACTIVE or DISABLED). SYSTEM, a fixture, an odd membership: undefined.
   * The account status (ACTIVE / DISABLED) does not matter: a reset never unlocks.
   */
  #classify(target: ResetTargetRow, adminRole: string | undefined): TargetKind | undefined {
    if (target.hasAdminMembership) {
      return target.accountOrigin === 'ADMIN_PROVISIONED' && adminRole === 'ADMIN' ? 'ADMIN' : undefined;
    }
    const ordinary =
      isOrdinaryClientAccount({
        accountOrigin: target.accountOrigin,
        phoneVerified: target.phoneVerified,
        hasAdminMembership: false,
      }) && this.policy.allows({ accountOrigin: target.accountOrigin, phoneNormalized: target.phoneNormalized });
    return ordinary ? 'USER' : undefined;
  }
}
