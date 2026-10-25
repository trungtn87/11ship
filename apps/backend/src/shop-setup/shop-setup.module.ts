import { DynamicModule, Module } from '@nestjs/common';
import { TransactionModule } from '../transaction/transaction.module';
import { ShopModule } from '../shop/shop.module';
import { ShopSetupController } from './shop-setup.controller';
import { ShopSetupCoreModule } from './shop-setup-core.module';
import { ShopSetupQueryService } from './shop-setup-query-service';

/**
 * The owner's setup checklist endpoint (issue #190). Like Onboarding it sits ABOVE Auth: it imports the already built Auth dynamic module for the session
 * guard and the session-authorization participant. `auth` must be the very same object AppModule passes to its own imports.
 */
@Module({})
export class ShopSetupModule {
  static register(auth: DynamicModule): DynamicModule {
    return {
      module: ShopSetupModule,
      imports: [auth, ShopModule, ShopSetupCoreModule, TransactionModule],
      controllers: [ShopSetupController],
      providers: [ShopSetupQueryService],
    };
  }
}
