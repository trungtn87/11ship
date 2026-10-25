import { DynamicModule, Module } from '@nestjs/common';
import { OrderChatCoreModule } from '../order-chat/order-chat-core.module';
import { PaymentChatCoreModule } from '../payment-chat/payment-chat-core.module';
import { OrdersCoreModule } from '../orders/orders-core.module';
import { DeliveryReadModule } from '../delivery/delivery-read.module';
import { ShipperLocationModule } from '../delivery/shipper-location.module';
import { DriverModule } from '../driver/driver.module';
import { FeedbackReadModule } from '../feedback/feedback-read.module';
import { ShopModule } from '../shop/shop.module';
import { WalletModule } from '../wallet/wallet.module';
import { NotificationRecipients } from './notification-recipients';
import { ShippingEligibilityModule } from '../shipping-policy/shipping-eligibility.module';
import { TransactionModule } from '../transaction/transaction.module';
import { NotificationController } from './notification.controller';
import { NotificationEventService } from './notification-event-service';
import { NotificationInboxService } from './notification-inbox-service';
import { NotificationPushQueue } from './notification-push-queue';
import { NotificationsReadModule } from './notifications-read.module';
import { NotificationRetention, NotificationRuntime } from './notification-runtime';
import { NotificationSignal } from './notification-signal';
import { PushDispatcher } from './push-dispatcher';
import { ReminderBatcher } from './reminder-batcher';

/**
 * M08: the account's inbox, settings and push link (routes under /v1/notifications) and the background worker (outbox consumer, reminder batching, push
 * sending, retention). `auth` must be the very same object AppModule passes to its imports. The push provider is the real FCM client when the operator
 * configured it, and an explicit "not configured" provider otherwise (every push is then recorded as skipped, never as sent). The Administration routes
 * are wired with the other Admin routes and use the exports below.
 */
@Module({})
export class NotificationsModule {
  static register(auth: DynamicModule): DynamicModule {
    return {
      module: NotificationsModule,
      imports: [auth, TransactionModule, ShippingEligibilityModule, NotificationsReadModule, ShopModule, DriverModule, WalletModule, DeliveryReadModule, ShipperLocationModule, OrdersCoreModule, OrderChatCoreModule, PaymentChatCoreModule, FeedbackReadModule],
      controllers: [NotificationController],
      providers: [
        NotificationRecipients,
        NotificationSignal,
        NotificationPushQueue,
        NotificationEventService,
        NotificationInboxService,
        ReminderBatcher,
        PushDispatcher,
        NotificationRetention,
        NotificationRuntime,
      ],
      exports: [NotificationRuntime, NotificationEventService, PushDispatcher, ReminderBatcher, NotificationRetention],
    };
  }
}
