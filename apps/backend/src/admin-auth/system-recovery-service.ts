import { randomUUID } from 'node:crypto';
import { AdminSessionRevocationParticipant } from '../auth/admin-session-revocation-participant';
import { AdminPasswordVerifier } from '../auth/admin-password-verifier';
import { UserRepository } from '../auth/user-repository';
import { AuditWriter } from '../audit/audit-writer';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { ADMIN_AUDIT_ACTIONS } from './admin-auth-constants';
import { AdminChallengeRepository } from './admin-challenge-repository';
import { AdminCliError } from './admin-cli-errors';
import { AdminMembershipRepository } from './admin-membership-repository';
import { AdminSessionRepository } from './admin-session-repository';

export const SYSTEM_RECOVERY_VERIFICATION_MARK = 'LOCAL_SERVER_OPERATOR_TEST';

/**
 * Local/CI operator recovery of the existing SYSTEM password (M01-RESET). Not an HTTP path: the CLI imports it directly.
 * No OTP and no verification time are invented; the TOTP factor, roles, statuses and profile stay untouched.
 */
export class SystemRecoveryService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly users: UserRepository,
    private readonly memberships: AdminMembershipRepository,
    private readonly sessions: AdminSessionRevocationParticipant,
    private readonly adminSessions: AdminSessionRepository,
    private readonly challenges: AdminChallengeRepository,
    private readonly verifier: AdminPasswordVerifier,
    private readonly audit: AuditWriter,
  ) {}

  /** Read-only: the current version of the SYSTEM account with this phone. Not a permission to apply. */
  async check(phoneNormalized: string): Promise<{ version: number }> {
    return this.transactions.withTransaction(async (context) => {
      const target = await this.#find(context, phoneNormalized, 'read');
      if (target === undefined) {
        throw new AdminCliError('SYSTEM_TARGET_NOT_FOUND');
      }
      return { version: target.version };
    });
  }

  async apply(input: { phoneNormalized: string; password: string; expectedVersion: number }): Promise<{ version: number }> {
    // Argon2id is CPU work: done before the transaction.
    const passwordHash = await this.verifier.hash(input.password);
    const requestId = randomUUID();
    return this.transactions.withTransaction(async (context) => {
      const target = await this.#find(context, input.phoneNormalized, 'write');
      if (target === undefined) {
        throw new AdminCliError('SYSTEM_TARGET_NOT_FOUND');
      }
      if (target.version !== input.expectedVersion) {
        throw new AdminCliError('VERSION_CONFLICT');
      }
      const version = await this.users.setPasswordHash(context, { userId: target.userId, passwordHash });
      if (version === undefined) {
        throw new TechnicalError('internal', 'Locked account could not be updated');
      }
      await this.sessions.revokeAllForUser(context, target.userId);
      await this.adminSessions.revokeAllForUser(context, target.userId);
      await this.challenges.supersedeUnconsumed(context, target.userId);
      await this.audit.append(context, {
        requestId,
        actorType: 'SYSTEM',
        actorId: null,
        action: ADMIN_AUDIT_ACTIONS.systemPasswordRecovered,
        resourceType: 'user',
        resourceId: target.userId,
        resourceVersion: version,
        outcome: 'SUCCESS',
        metadata: {
          execution_context: 'LOCAL_OPERATOR',
          target_user_id: target.userId,
          version,
          verification: SYSTEM_RECOVERY_VERIFICATION_MARK,
        },
      });
      return { version };
    });
  }

  /**
   * The SYSTEM id is found without a lock, then the user root is locked and the membership after it (the module's
   * order); phone, origin and role are re-checked on the locked rows. The role never comes from the caller.
   */
  async #find(
    context: TransactionContext,
    phoneNormalized: string,
    mode: 'read' | 'write',
  ): Promise<{ userId: string; version: number } | undefined> {
    const systemUserId = await this.memberships.findSystemUserId(context);
    if (systemUserId === undefined) {
      return undefined;
    }
    const user =
      mode === 'write'
        ? await this.users.lockResetTarget(context, systemUserId)
        : await this.users.readResetTarget(context, systemUserId);
    if (user === undefined || user.phoneNormalized !== phoneNormalized || user.accountOrigin !== 'ADMIN_PROVISIONED') {
      return undefined;
    }
    const membership =
      mode === 'write' ? await this.memberships.lock(context, systemUserId) : await this.memberships.find(context, systemUserId);
    if (membership === undefined || membership.adminRole !== 'SYSTEM') {
      return undefined;
    }
    return { userId: user.userId, version: user.version };
  }
}
