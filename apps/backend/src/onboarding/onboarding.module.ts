import { DynamicModule, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { OutboxModule } from '../outbox/outbox.module';
import { ShopModule } from '../shop/shop.module';
import { TransactionModule } from '../transaction/transaction.module';
import { ShopOnboardingController } from './shop-onboarding.controller';
import { ShopOnboardingService } from './shop-onboarding-service';

/**
 * Onboarding coordinator (M01-A2S). It sits ABOVE Auth (M01) and Shop (M02): it imports the already built
 * Auth dynamic module (for the session guard and the role-grant participant) and ShopModule (for the
 * repositories). Neither Auth nor Shop imports it, so the graph is acyclic and needs no forwardRef.
 *
 * `auth` must be the very same object AppModule passes to its own imports, so Nest sees one AuthModule.
 */
@Module({})
export class OnboardingModule {
  static register(auth: DynamicModule): DynamicModule {
    return {
      module: OnboardingModule,
      imports: [auth, ShopModule, TransactionModule, IdempotencyModule, AuditModule, OutboxModule],
      controllers: [ShopOnboardingController],
      providers: [ShopOnboardingService],
    };
  }
}
