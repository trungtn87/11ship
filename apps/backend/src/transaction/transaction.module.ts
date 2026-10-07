import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DATABASE_POOL } from '../database/database.constants';
import { poolClientSource } from './pg-client-source';
import { TransactionManager } from './transaction-manager';

// Only a coordinator injects the manager. A participant (repository/service) receives a
// TransactionContext as an argument and never the manager or the pool.
@Module({
  providers: [
    {
      provide: TransactionManager,
      inject: [DATABASE_POOL, APP_CONFIG],
      useFactory: (pool: Pool, config: AppConfig) =>
        new TransactionManager(poolClientSource(pool), {
          timeoutMs: config.transaction.timeoutMs,
          idleInTransactionTimeoutMs: config.transaction.idleInTransactionTimeoutMs,
        }),
    },
  ],
  exports: [TransactionManager],
})
export class TransactionModule {}
