import { DynamicModule, Module } from '@nestjs/common';
import { AdminChallengeRepository } from '../admin-auth/admin-challenge-repository';
import { AdminMembershipRepository } from '../admin-auth/admin-membership-repository';
import { AdminSessionRepository } from '../admin-auth/admin-session-repository';
import { AuditModule } from '../audit/audit.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { TransactionModule } from '../transaction/transaction.module';
import { AccountRecoveryController } from './account-recovery.controller';
import { AccountRecoveryService } from './account-recovery-service';

/**
 * No-OTP test password reset (M01-RESET). It sits on top of the one Auth module object (user, session repositories, hasher, origin
 * policy) and reuses the administration repositories, which are plain SQL classes without dependencies, so it works whether or
 * not the administration web is enabled. The routes always exist; GET config reports UNAVAILABLE and the reset answers 503 unless
 * ACCOUNT_RECOVERY_MODE=DISABLED_TEST was validated at startup.
 */
@Module({})
export class AccountRecoveryModule {
  static register(auth: DynamicModule): DynamicModule {
    return {
      module: AccountRecoveryModule,
      imports: [auth, TransactionModule, AuditModule, IdempotencyModule],
      controllers: [AccountRecoveryController],
      providers: [AccountRecoveryService, AdminMembershipRepository, AdminSessionRepository, AdminChallengeRepository],
    };
  }
}
