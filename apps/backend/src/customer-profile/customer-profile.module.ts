import { DynamicModule, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DriverModule } from '../driver/driver.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { TransactionModule } from '../transaction/transaction.module';
import { CustomerProfileController } from './customer-profile.controller';
import { CustomerProfileService } from './customer-profile-service';
import { DriverMeController } from './driver-me.controller';
import { DriverMeService } from './driver-me-service';

/**
 * Own-profile read model (M01.05): GET/PUT /v1/customer/me/profile and GET /v1/driver/me. Like ShopManagement it sits ABOVE
 * Auth (M01) and Driver (M03): it imports the already built Auth dynamic module (session guard, ClientSessionAuthority,
 * UserRepository, CustomerProfileRepository) and DriverModule (the driver repository). Neither imports it, so the graph is
 * acyclic. `auth` must be the very same object AppModule passes to its own imports, so Nest sees one AuthModule.
 */
@Module({})
export class CustomerProfileModule {
  static register(auth: DynamicModule): DynamicModule {
    return {
      module: CustomerProfileModule,
      imports: [auth, DriverModule, TransactionModule, IdempotencyModule, AuditModule],
      controllers: [CustomerProfileController, DriverMeController],
      providers: [CustomerProfileService, DriverMeService],
    };
  }
}
