import { DynamicModule, Module } from '@nestjs/common';
import { DeliveryCoreModule } from '../delivery/delivery-core.module';
import { OpsCoreModule } from '../ops/ops-core.module';
import { OrdersCoreModule } from '../orders/orders-core.module';
import { OutboxModule } from '../outbox/outbox.module';
import { TransactionModule } from '../transaction/transaction.module';
import { OrderChatCoreModule } from './order-chat-core.module';
import { OrderChatRetention, OrderChatRuntime } from './order-chat-retention';
import { OrderChatService } from './order-chat-service';

/**
 * The order chat's service (read / send for the apps AND for the Administration web) and its retention worker. It sits above Auth (the very same object
 * AppModule passes to its imports) and is imported by the app routes (OrderChatModule) and by the Administration routes (AdminAuthModule): one instance each.
 */
@Module({})
export class OrderChatServiceModule {
  static register(auth: DynamicModule): DynamicModule {
    return {
      module: OrderChatServiceModule,
      imports: [auth, TransactionModule, OutboxModule, OrdersCoreModule, DeliveryCoreModule.register(auth), OrderChatCoreModule, OpsCoreModule],
      providers: [OrderChatService, OrderChatRetention, OrderChatRuntime],
      exports: [OrderChatService, OrderChatRetention, OrderChatCoreModule],
    };
  }
}
