import { DynamicModule, Module } from '@nestjs/common';
import { DeliveryCoreModule } from '../delivery/delivery-core.module';
import { M14RoutingModule } from '../delivery/m14-routing.module';
import { DriverModule } from '../driver/driver.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { OrdersCoreModule } from '../orders/orders-core.module';
import { ShippingEligibilityModule } from '../shipping-policy/shipping-eligibility.module';
import { ShopModule } from '../shop/shop.module';
import { TransactionModule } from '../transaction/transaction.module';
import { AddressChangeReadModule } from './address-change-read.module';
import { AddressChangeService } from './address-change-service';

@Module({})
export class AddressChangeModule {
  static register(auth: DynamicModule): DynamicModule {
    return {
      module: AddressChangeModule,
      imports: [
        auth,
        TransactionModule,
        IdempotencyModule,
        OrdersCoreModule,
        DeliveryCoreModule.register(auth),
        M14RoutingModule,
        DriverModule,
        ShopModule,
        ShippingEligibilityModule,
        AddressChangeReadModule,
      ],
      providers: [AddressChangeService],
      exports: [AddressChangeReadModule, AddressChangeService],
    };
  }
}
