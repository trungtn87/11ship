import { DynamicModule, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { OutboxModule } from '../outbox/outbox.module';
import { TransactionModule } from '../transaction/transaction.module';
import { AccountDeletionController, DeleteAccountPageController } from './account-deletion.controller';
import { AccountDeletionLimiter } from './account-deletion-limiter';
import { AccountDeletionService } from './account-deletion-service';
import { AccountDeletionSweeper, AccountDeletionSweeperRunner } from './account-deletion-sweeper';

/**
 * The owner's public account deletion (P5-6a, OD-26): POST /v1/account-deletion/confirm, the page /delete-account and the sweeper that finishes
 * the requests that had work in progress. It sits on top of the one Auth module object (user repository, hasher, origin policy, the shared
 * AccountDeletionFinalizer and the participant that locks an ordinary account); `auth` must be the very same object AppModule passes to its own
 * imports.
 */
@Module({})
export class AccountDeletionModule {
  static register(auth: DynamicModule): DynamicModule {
    return {
      module: AccountDeletionModule,
      imports: [auth, TransactionModule, AuditModule, IdempotencyModule, OutboxModule],
      controllers: [AccountDeletionController, DeleteAccountPageController],
      providers: [AccountDeletionLimiter, AccountDeletionService, AccountDeletionSweeper, AccountDeletionSweeperRunner],
    };
  }
}
