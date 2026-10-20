import { DynamicModule, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DriverModule } from '../driver/driver.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { OutboxModule } from '../outbox/outbox.module';
import { TransactionModule } from '../transaction/transaction.module';
import { WalletModule } from '../wallet/wallet.module';
import { DriverWalletAccess } from './driver-wallet-access';
import { DriverWalletController } from './driver-wallet.controller';
import { DriverWalletService } from './driver-wallet-service';
import { DriverWithdrawalService } from './driver-withdrawal-service';

/**
 * The Shipper's own wallet endpoints under /v1/driver/wallet (M04-C): summary, holds, history, the bank account a withdrawal pays to, and the withdrawal requests.
 * It sits ABOVE Auth (session guard, ClientSessionAuthority), Driver (M03 repositories, the wallet parameters) and the Wallet core (SQL and the money participants):
 * nothing imports it. `auth` must be the very same object AppModule passes to its imports.
 */
@Module({})
export class DriverWalletModule {
  static register(auth: DynamicModule): DynamicModule {
    return {
      module: DriverWalletModule,
      imports: [auth, DriverModule, WalletModule, TransactionModule, IdempotencyModule, AuditModule, OutboxModule],
      controllers: [DriverWalletController],
      providers: [DriverWalletAccess, DriverWalletService, DriverWithdrawalService],
    };
  }
}
