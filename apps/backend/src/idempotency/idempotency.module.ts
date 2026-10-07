import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { StartupConfigError } from '../config/startup-config-error';
import { Keyring } from '../crypto/keyring';
import { TransactionManager } from '../transaction/transaction-manager';
import { TransactionModule } from '../transaction/transaction.module';
import { IdempotencyCleanup } from './idempotency-cleanup';
import { IdempotencyExecutor } from './idempotency-executor';

/**
 * The crypto keyring is REQUIRED wherever the executor is wired. A missing keyring stops startup with
 * an error that names only the two variables (never a value).
 */
export function requireKeyring(config: AppConfig): Keyring {
  if (config.crypto === undefined) {
    throw new StartupConfigError(['CRYPTO_KEYRING', 'CRYPTO_ACTIVE_KEY_ID']);
  }
  return config.crypto;
}

// Not imported by AppModule in M00-C1A1: there is no production consumer yet (M01 imports it). A module
// that imports this one gets the executor and the cleanup primitive and inherits the startup check.
@Module({
  imports: [TransactionModule],
  providers: [
    {
      provide: IdempotencyExecutor,
      inject: [TransactionManager, APP_CONFIG],
      useFactory: (manager: TransactionManager, config: AppConfig) =>
        new IdempotencyExecutor(manager, requireKeyring(config), config.idempotency),
    },
    {
      provide: IdempotencyCleanup,
      inject: [TransactionManager],
      useFactory: (manager: TransactionManager) => new IdempotencyCleanup(manager),
    },
  ],
  exports: [IdempotencyExecutor, IdempotencyCleanup],
})
export class IdempotencyModule {}
