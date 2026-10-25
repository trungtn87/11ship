import { DynamicModule, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DeliveryCoreModule } from '../delivery/delivery-core.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { OutboxModule } from '../outbox/outbox.module';
import { TransactionModule } from '../transaction/transaction.module';
import { PaymentChatCoreModule } from './payment-chat-core.module';
import { ShipperPaymentChatController, ShopPaymentChatController } from './payment-chat.controller';
import { PaymentChatService } from './payment-chat-service';
import { TopupReportService } from './topup-report-service';

/**
 * The payment conversation (#199): the Shipper's and the shop owner's routes. The service is also exported for the Administration routes (AdminAuthModule). It sits
 * ABOVE Auth (the very same object AppModule passes to its imports) and nothing imports it back. It has no money path: the ledger source gate is untouched.
 */
@Module({})
export class PaymentChatModule {
  static register(auth: DynamicModule): DynamicModule {
    return {
      module: PaymentChatModule,
      imports: [auth, DeliveryCoreModule.register(auth), PaymentChatCoreModule, TransactionModule, IdempotencyModule, AuditModule, OutboxModule],
      controllers: [ShipperPaymentChatController, ShopPaymentChatController],
      providers: [PaymentChatService, TopupReportService],
      exports: [PaymentChatService],
    };
  }
}
