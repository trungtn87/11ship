import { DriverModule } from '../driver/driver.module';
import { OrderTimeoutSweeper } from '../order-timeouts/order-timeout-sweeper';
import { DynamicModule, Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { DeliveryCoreModule } from '../delivery/delivery-core.module';
import { M14RoutingModule } from '../delivery/m14-routing.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { MenuModule } from '../menu/menu.module';
import { ShopModule } from '../shop/shop.module';
import { TransactionModule } from '../transaction/transaction.module';
import { OrderCustomerController } from './order-customer.controller';
import { OrderCustomerDeliveryService } from './order-customer-delivery-service';
import { OrderCustomerService } from './order-customer-service';
import { OrderShopController } from './order-shop.controller';
import { OrderShopService } from './order-shop-service';
import { OrderSweeper, OrderSweeperRunner } from './order-sweeper';
import { OrderViews } from './order-views';
import { OrdersCoreModule } from './orders-core.module';

/**
 * M10, food orders: the customer's routes under /v1/customers/me (cart, checkout, orders) and the shop's under /v1/shop/me/orders, plus the schedule reminder.
 * It sits ABOVE Auth, the Delivery module (which it uses to call, cancel and follow deliveries) and the owners it reads through their participants (Menu, Shop,
 * Customers, the M06 fee agreements, the M14 route client). `auth` and `delivery` must be the very same objects AppModule passes to its own imports. The
 * Administration routes are wired with the other Admin routes (AdminAuthModule).
 */
@Module({})
export class OrdersModule {
  static register(auth: DynamicModule, delivery: DynamicModule): DynamicModule {
    return {
      module: OrdersModule,
      imports: [DriverModule, auth, delivery, DeliveryCoreModule.register(auth), OrdersCoreModule, MenuModule.register(auth), CustomersModule.register(auth), ShopModule, M14RoutingModule, TransactionModule, IdempotencyModule],
      controllers: [OrderCustomerController, OrderShopController],
      providers: [OrderTimeoutSweeper, OrderCustomerService, OrderCustomerDeliveryService, OrderShopService, OrderViews, OrderSweeper, OrderSweeperRunner],
      exports: [OrderSweeper],
    };
  }
}
