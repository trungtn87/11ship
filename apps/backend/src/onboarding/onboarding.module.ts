import { WalletModule } from '../wallet/wallet.module';
import { DynamicModule, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DriverModule } from '../driver/driver.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { OutboxModule } from '../outbox/outbox.module';
import { ShopSetupCoreModule } from '../shop-setup/shop-setup-core.module';
import { ShopModule } from '../shop/shop.module';
import { TransactionModule } from '../transaction/transaction.module';
import { DriverOnboardingController } from './driver-onboarding.controller';
import { DriverOnboardingService } from './driver-onboarding-service';
import { ShopOnboardingController } from './shop-onboarding.controller';
import { ShopOnboardingService } from './shop-onboarding-service';
import { ShopProfileQueryService } from './shop-profile-query-service';
import { ShopServiceAreaQueryService } from './shop-service-area-query-service';

/**
 * Onboarding coordinator (M01-A2S, M01-A2D). It sits ABOVE Auth (M01), Shop (M02) and Driver (M03): it imports the
 * already built Auth dynamic module (for the session guard and the role-grant participant), ShopModule (for the
 * Shop repositories and the service-area lock port) and DriverModule (for the Driver repository). None of them
 * imports it, so the graph is acyclic and needs no forwardRef.
 *
 * Commands run inside the transaction the M00 IdempotencyExecutor opens. The read endpoints (resume, and the list of ACTIVE
 * service areas) have no idempotency record, so ShopProfileQueryService and ShopServiceAreaQueryService each open their own
 * short read transaction through TransactionModule.
 *
 * `auth` must be the very same object AppModule passes to its own imports, so Nest sees one AuthModule.
 */
@Module({})
export class OnboardingModule {
  static register(auth: DynamicModule): DynamicModule {
    return {
      module: OnboardingModule,
      imports: [auth, ShopModule, ShopSetupCoreModule, DriverModule, WalletModule, TransactionModule, IdempotencyModule, AuditModule, OutboxModule],
      controllers: [ShopOnboardingController, DriverOnboardingController],
      providers: [ShopOnboardingService, ShopProfileQueryService, ShopServiceAreaQueryService, DriverOnboardingService],
    };
  }
}
