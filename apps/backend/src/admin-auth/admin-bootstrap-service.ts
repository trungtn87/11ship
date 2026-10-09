import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AdminIdentityParticipant } from '../auth/admin-identity-participant';
import { AdminPasswordVerifier } from '../auth/admin-password-verifier';
import { AuditWriter } from '../audit/audit-writer';
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

      const system = await this.memberships.lockSystem(context);
      if (system !== undefined) {
        const holder = await this.identities.lockById(context, system.userId);
        if (holder !== undefined && holder.phoneNormalized === input.phoneNormalized) {
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
