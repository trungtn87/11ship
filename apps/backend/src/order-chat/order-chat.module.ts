import { DynamicModule, Module } from '@nestjs/common';
import { CustomerOrderChatController, ShipperOrderChatController, ShopOrderChatController } from './order-chat.controller';
import { OrderChatServiceModule } from './order-chat-service.module';

/**
 * The order chat ("Trao đổi đơn hàng", #191): the customer's, the shop's and the Shipper's routes. The service itself lives in OrderChatServiceModule, which
 * the Administration routes share. It sits ABOVE Auth (the very same object AppModule passes to its imports) and nothing imports it back.
 */
@Module({})
export class OrderChatModule {
  static register(auth: DynamicModule): DynamicModule {
    return {
      module: OrderChatModule,
      imports: [auth, OrderChatServiceModule.register(auth)],
      controllers: [CustomerOrderChatController, ShipperOrderChatController, ShopOrderChatController],
    };
  }
}
