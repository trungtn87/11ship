import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { TransactionModule } from '../transaction/transaction.module';
import { TransactionManager } from '../transaction/transaction-manager';
import { IdempotencyCleanup } from './idempotency-cleanup';
import { IdempotencyExecutor } from './idempotency-executor';
import { IdempotencyOperationRegistry } from './idempotency-operation-registry';

@Module({
  imports: [TransactionModule],
  providers: [
    {
      provide: IdempotencyOperationRegistry,
      useFactory: () => new IdempotencyOperationRegistry(),
    },
    {
      provide: IdempotencyExecutor,
      inject: [TransactionManager, APP_CONFIG, IdempotencyOperationRegistry],
      useFactory: (
        transactions: TransactionManager,
        config: AppConfig,
        operationRegistry: IdempotencyOperationRegistry,
      ) => {
        if (config.crypto === undefined) {
          throw new Error('IdempotencyExecutor requires configured crypto keyring');
        }
        return new IdempotencyExecutor(
          transactions,
          config.crypto,
          config.idempotency,
          operationRegistry,
        );
      },
    },
    {
      provide: IdempotencyCleanup,
      inject: [TransactionManager],
      useFactory: (transactions: TransactionManager) => new IdempotencyCleanup(transactions),
    },
  ],
  exports: [IdempotencyExecutor, IdempotencyCleanup, IdempotencyOperationRegistry],
})
export class IdempotencyModule {}
