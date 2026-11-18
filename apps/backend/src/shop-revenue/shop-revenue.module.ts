import { DynamicModule, Module } from '@nestjs/common';
import { ShopModule } from '../shop/shop.module';
import { ShopRevenueReader } from '../orders/shop-revenue-reader';
import { TransactionModule } from '../transaction/transaction.module';
import { ShopRevenueController } from './shop-revenue-controller';
import { ShopRevenueService } from './shop-revenue-service';

/**
 * The owner's shop revenue under /v1/shop/revenue (issue #391): read only. It sits above Auth (session guard and the session-authorization participant), the
 * Shop module (the owned shop snapshot) and Transaction. `auth` must be the very same object AppModule passes to its imports.
 */
@Module({})
export class ShopRevenueModule {
  static register(auth: DynamicModule): DynamicModule {
    return {
      module: ShopRevenueModule,
      imports: [auth, ShopModule, TransactionModule],
      controllers: [ShopRevenueController],
      providers: [ShopRevenueReader, ShopRevenueService],
    };
  }
}
