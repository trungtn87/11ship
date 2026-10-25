import { DynamicModule, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DeliveryCoreModule } from '../delivery/delivery-core.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { OutboxModule } from '../outbox/outbox.module';
import { WalletModule } from '../wallet/wallet.module';
import { TransactionModule } from '../transaction/transaction.module';
import { ShopPaymentCoreModule } from './shop-payment-core.module';
import { ShopPaymentController } from './shop-payment.controller';
import { ShopPaymentService } from './shop-payment-service';

/**
 * The shop owner's payment requests under /v1/shop/me (#198). It sits ABOVE Auth (the very same object AppModule passes to its imports) and nothing imports it.
 * It opens no money path: there is no wallet, ledger or subscription in it.
 */
@Module({})
export class ShopPaymentModule {
  static register(auth: DynamicModule): DynamicModule {
    return {
      module: ShopPaymentModule,
      imports: [auth, DeliveryCoreModule.register(auth), ShopPaymentCoreModule, WalletModule, TransactionModule, IdempotencyModule, AuditModule, OutboxModule],
      controllers: [ShopPaymentController],
      providers: [ShopPaymentService],
      exports: [ShopPaymentService],
    };
  }
}
