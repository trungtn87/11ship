import { DynamicModule, Module } from '@nestjs/common';
import { DriverModule } from '../driver/driver.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { ShipperSettlementModule } from '../shipper-settlement/shipper-settlement.module';
import { TransactionModule } from '../transaction/transaction.module';
import { DeliveryCoreModule } from './delivery-core.module';
import { ORDER_DELIVERY_PORT } from './delivery-order-port';
import { OrdersCoreModule } from '../orders/orders-core.module';
import { OrderDeliveryAdapter } from '../orders/order-delivery-adapter';
import { DeliveryShipperController } from './delivery-shipper.controller';
import { DeliveryShipperService } from './delivery-shipper-service';
import { DeliveryShopController } from './delivery-shop.controller';
import { DeliveryShopService } from './delivery-shop-service';
import { DeliverySweeper, DeliverySweeperRunner } from './delivery-sweeper';
import { M14RoutingModule } from './m14-routing.module';

/**
 * M07, the delivery flow: the shop's routes under /v1/shop/me/deliveries, the Shipper's routes under /v1/driver/deliveries and /v1/driver/location, and the
 * timers (the search ends at 30 minutes, the reminders). The Administration routes are wired with the other Admin routes. `auth` must be the very same
 * object AppModule passes to its imports. The M10 order adapter (Orders core module, repository only) is bound to the port; a direct call (an outside order) never uses it.
 */
@Module({})
export class DeliveryModule {
  static register(auth: DynamicModule): DynamicModule {
    return {
      module: DeliveryModule,
      imports: [auth, DeliveryCoreModule.register(auth), OrdersCoreModule, M14RoutingModule, DriverModule, TransactionModule, IdempotencyModule, ShipperSettlementModule],
      controllers: [DeliveryShopController, DeliveryShipperController],
      providers: [DeliveryShopService, DeliveryShipperService, DeliverySweeper, DeliverySweeperRunner, { provide: ORDER_DELIVERY_PORT, useExisting: OrderDeliveryAdapter }],
      exports: [DeliverySweeper, DeliveryShopService],
    };
  }
}
