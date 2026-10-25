import { DynamicModule, Module } from '@nestjs/common';
import { DeliveryCoreModule } from '../delivery/delivery-core.module';
import { OutboxModule } from '../outbox/outbox.module';
import { OrdersCoreModule } from '../orders/orders-core.module';
import { TransactionModule } from '../transaction/transaction.module';
import { CustomerOrderChatController, ShipperOrderChatController, ShopOrderChatController } from './order-chat.controller';
import { OrderChatCoreModule } from './order-chat-core.module';
import { OrderChatService } from './order-chat-service';

/**
 * The order chat ("Trao đổi đơn hàng", #191): the customer's, the shop's and the Shipper's routes. It sits ABOVE Auth (the very same object AppModule passes to its
 * imports), the delivery core (who is calling, the milestone readers) and the Order tables, and nothing imports it back.
 */
@Module({})
export class OrderChatModule {
  static register(auth: DynamicModule): DynamicModule {
    return {
      module: OrderChatModule,
      imports: [auth, TransactionModule, OutboxModule, OrdersCoreModule, DeliveryCoreModule.register(auth), OrderChatCoreModule],
      controllers: [CustomerOrderChatController, ShopOrderChatController, ShipperOrderChatController],
      providers: [OrderChatService],
    };
  }
}
