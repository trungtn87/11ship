import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AdminIdentityParticipant } from '../auth/admin-identity-participant';
import { AdminPasswordVerifier } from '../auth/admin-password-verifier';
import { AuditWriter } from '../audit/audit-writer';
import { TechnicalError } from '../common/app-errors';
import { AdminLimiterConfig } from '../config/admin-auth-config';
import { TransactionManager } from '../transaction/transaction-manager';
import { ADMIN_AUDIT_ACTIONS, BOOTSTRAP_LOCK_KEY } from './admin-auth-constants';
import { AdminCliError } from './admin-cli-errors';
import { AdminLimitConfigService } from './admin-limit-config-service';
import { AdminMembershipRepository } from './admin-membership-repository';

/**
 * Operator bootstrap of the one SYSTEM administrator. Not an HTTP path and not a registration: no OTP, no proof and no
 * verification time are ever invented. One transaction, serialized by an advisory lock, creates the ADMIN_PROVISIONED
 * account, its SYSTEM membership and the audit row together; the same SYSTEM phone again is a no-op that never touches
 * the stored password, anything else is refused. It runs only after the limiter configuration was initialized.
 */
@Injectable()
export class AdminBootstrapService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly identities: AdminIdentityParticipant,
    private readonly memberships: AdminMembershipRepository,
    private readonly limitConfig: AdminLimitConfigService,
    private readonly verifier: AdminPasswordVerifier,
    private readonly audit: AuditWriter,
  ) {}

  async bootstrapSystem(
    input: { phoneNormalized: string; password: string },
    limiter: AdminLimiterConfig,
  ): Promise<'CREATED' | 'UNCHANGED'> {
    // Argon2id is CPU work: done before the transaction, never inside it.
    const passwordHash = await this.verifier.hash(input.password);
    const requestId = randomUUID();

    return this.transactions.withTransaction(async (context) => {
      await context.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [BOOTSTRAP_LOCK_KEY]);

      const configState = await this.limitConfig.checkIn(context, limiter);
      if (configState === 'MISSING') {
        throw new AdminCliError('LIMIT_CONFIG_MISSING');
      }
      if (configState === 'MISMATCH') {
        throw new AdminCliError('LIMIT_CONFIG_MISMATCH');
      }

      // Lock order of the whole administration module: user, THEN membership (as login, TOTP and session do). The
      // SYSTEM user id is read without a lock only to know which account to lock; the role is re-checked under the
      // locks, so a concurrent writer of that account can never meet this transaction in the opposite order.
      const systemUserId = await this.memberships.findSystemUserId(context);
      if (systemUserId !== undefined) {
        const holder = await this.identities.lockById(context, systemUserId);
        const system = holder === undefined ? undefined : await this.memberships.lock(context, systemUserId);
        if (holder === undefined || system === undefined || system.adminRole !== 'SYSTEM') {
          // Not reachable while memberships are never deleted and a role never changes; fail closed, write nothing.
          throw new TechnicalError('internal', 'SYSTEM membership changed during bootstrap');
        }
        if (holder.phoneNormalized === input.phoneNormalized) {
          return 'UNCHANGED';
        }
        throw new AdminCliError('SYSTEM_ACCOUNT_DIFFERENT');
      }

      const userId = randomUUID();
      const created = await this.identities.insertProvisioned(context, {
        userId,
        phoneNormalized: input.phoneNormalized,
        passwordHash,
      });
      if (!created) {
        throw new AdminCliError('PHONE_ALREADY_REGISTERED');
      }
      await this.memberships.insertSystem(context, userId);
      await this.audit.append(context, {
        requestId,
        actorType: 'SYSTEM',
        action: ADMIN_AUDIT_ACTIONS.systemBootstrapped,
        resourceType: 'user',
        resourceId: userId,
        outcome: 'SUCCESS',
        metadata: { admin_role: 'SYSTEM' },
      });
      return 'CREATED';
    });
  }
}
