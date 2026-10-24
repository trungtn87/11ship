import { DynamicModule, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DriverModule } from '../driver/driver.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { OutboxModule } from '../outbox/outbox.module';
import { ShippingEligibilityModule } from '../shipping-policy/shipping-eligibility.module';
import { ShopModule } from '../shop/shop.module';
import { TransactionModule } from '../transaction/transaction.module';
import { WalletModule } from '../wallet/wallet.module';
import { DeliveryActors } from './delivery-actors';
import { DeliveryCancel } from './delivery-cancel';
import { DeliveryHandback } from './delivery-handback';
import { DeliveryReadModule } from './delivery-read.module';
import { DeliveryRecorder } from './delivery-recorder';
import { DeliveryViews } from './delivery-views';
import { FeeAnswerExpiry } from './fee-answer-expiry';
import { ShipperLocationModule } from './shipper-location.module';

/**
 * What the delivery routes of the apps AND of the administration web share: who is calling (re-checked under the locks), the views each reader gets and
 * the three records every change leaves. It sits above Auth (the very same object AppModule passes to its imports) and the owners it reads through
 * their participants (Driver, Shop, Wallet, the M06 agreements, the Shipper's latest position). Nothing imports it back, so the graph is acyclic.
 */
@Module({})
export class DeliveryCoreModule {
  static register(auth: DynamicModule): DynamicModule {
    return {
      module: DeliveryCoreModule,
      imports: [auth, TransactionModule, IdempotencyModule, AuditModule, OutboxModule, DriverModule, ShopModule, WalletModule, ShippingEligibilityModule, DeliveryReadModule, ShipperLocationModule],
      providers: [DeliveryActors, DeliveryViews, DeliveryRecorder, DeliveryCancel, DeliveryHandback, FeeAnswerExpiry],
      exports: [DeliveryActors, DeliveryViews, DeliveryRecorder, DeliveryCancel, DeliveryHandback, FeeAnswerExpiry, DeliveryReadModule, ShipperLocationModule, WalletModule, ShippingEligibilityModule],
    };
  }
}
