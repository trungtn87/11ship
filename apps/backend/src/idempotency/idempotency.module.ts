import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { TransactionModule } from '../transaction/transaction.module';
import { TransactionManager } from '../transaction/transaction-manager';
import { IdempotencyCleanup } from './idempotency-cleanup';
import { IdempotencyExecutor } from './idempotency-executor';

@Module({
  imports: [TransactionModule],
  providers: [
    {
      provide: IdempotencyExecutor,
      inject: [TransactionManager, APP_CONFIG],
      useFactory: (transactions: TransactionManager, config: AppConfig) => {
        if (config.crypto === undefined) {
          throw new Error('IdempotencyExecutor requires configured crypto keyring');
        }
        return new IdempotencyExecutor(transactions, config.crypto, config.idempotency);
      },
    },
    {
      provide: IdempotencyCleanup,
      inject: [TransactionManager],
      useFactory: (transactions: TransactionManager) => new IdempotencyCleanup(transactions),
    },
  ],
  exports: [IdempotencyExecutor, IdempotencyCleanup],
})
export class IdempotencyModule {}
