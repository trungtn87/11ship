import { Module } from '@nestjs/common';
import { DeliveryReadModule } from '../delivery/delivery-read.module';
import { DriverModule } from '../driver/driver.module';
import { OrdersCoreModule } from '../orders/orders-core.module';
import { ShopModule } from '../shop/shop.module';
import { OrderChatParticipants } from './order-chat-participants';
import { OrderChatRepository } from './order-chat-repository';

/** What M08 may depend on: who belongs to an order chat room, decided from the owners' tables. It imports no notification code, so the graph stays acyclic. */
@Module({
  imports: [OrdersCoreModule, DeliveryReadModule, ShopModule, DriverModule],
  providers: [OrderChatParticipants, OrderChatRepository],
  exports: [OrderChatParticipants, OrderChatRepository],
})
export class OrderChatCoreModule {}
