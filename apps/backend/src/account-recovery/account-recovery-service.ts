import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AdminChallengeRepository } from '../admin-auth/admin-challenge-repository';
import { AdminMembershipRepository } from '../admin-auth/admin-membership-repository';
import { AdminSessionRepository } from '../admin-auth/admin-session-repository';
import { ACCOUNT_ORIGIN_POLICY, AccountOriginPolicy, isOrdinaryClientAccount } from '../auth/account-origin';
import { PASSWORD_HASHER, PasswordHasher } from '../auth/password-hasher';
import { SessionRepository } from '../auth/session-repository';
import { ResetTargetRow, UserRepository } from '../auth/user-repository';
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
} from './account-recovery-constants';
import { ResetTestInput } from './account-recovery-validation';

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
      action: RESET_TEST_AUDIT_ACTION,
      resourceType: 'user',
      resourceId: target.userId,
      resourceVersion: version,
      outcome: 'SUCCESS',
      metadata: {
        target_user_id: target.userId,
        target_kind: kind,
        version,
        verification: RESET_TEST_VERIFICATION_MARK,
        revoked_app_sessions: revokedSessions,
        admin_credentials_revoked: adminSessionsRevoked,
      },
    });
    return ack;
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
