import { DynamicModule, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DriverModule } from '../driver/driver.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { OutboxModule } from '../outbox/outbox.module';
import { TransactionModule } from '../transaction/transaction.module';
import { WalletModule } from '../wallet/wallet.module';
import { TopupRequestService } from './topup-request-service';
import { WalletTopupController } from './wallet-topup.controller';

/**
 * The Shipper's top-up request endpoints under /v1/driver/wallet (M04-B2.1). It sits ABOVE Auth (session guard, ClientSessionAuthority),
 * Driver (M03 repositories, the wallet parameters) and the Wallet core (zero wallet, request SQL): nothing imports it. `auth` must be
 * the very same object AppModule passes to its imports. It opens no money path: the ledger source gate of M04-A1 is untouched.
 */
@Module({})
export class WalletTopupModule {
  static register(auth: DynamicModule): DynamicModule {
    return {
      module: WalletTopupModule,
      imports: [auth, DriverModule, WalletModule, TransactionModule, IdempotencyModule, AuditModule, OutboxModule],
      controllers: [WalletTopupController],
      providers: [TopupRequestService],
    };
  }
}
