import { DynamicModule, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { OutboxModule } from '../outbox/outbox.module';
import { ShopModule } from '../shop/shop.module';
import { TransactionModule } from '../transaction/transaction.module';
import { ShopManagementController } from './shop-management.controller';
import { ShopManagementService } from './shop-management-service';

/**
 * Shop management coordinator (M02-A). Like Onboarding it sits ABOVE Auth (M01) and Shop (M02): it imports the
 * already built Auth dynamic module (for the session guard and the session-authorization participant) and ShopModule
 * (for the Shop repositories and the availability read port). Neither imports it, so the graph is acyclic and needs no
 * forwardRef, and M02 never imports Auth.
 *
 * The mutations run inside the transaction the M00 IdempotencyExecutor opens; the one read endpoint has no
 * idempotency record, so the service opens its own short read transaction through TransactionModule.
 *
 * `auth` must be the very same object AppModule passes to its own imports, so Nest sees one AuthModule.
 */
@Module({})
export class ShopManagementModule {
  static register(auth: DynamicModule): DynamicModule {
    return {
      module: ShopManagementModule,
      imports: [auth, ShopModule, TransactionModule, IdempotencyModule, AuditModule, OutboxModule],
      controllers: [ShopManagementController],
      providers: [ShopManagementService],
    };
  }
}
