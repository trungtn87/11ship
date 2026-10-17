import { DynamicModule, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DriverModule } from '../driver/driver.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { OutboxModule } from '../outbox/outbox.module';
import { TransactionModule } from '../transaction/transaction.module';
import { ShipperSelfController } from './shipper-self.controller';
import { ShipperSelfService } from './shipper-self-service';

/**
 * The Shipper's own M03 endpoints under /v1/driver (profile, bank account, submit for review, accepting switch, closure request,
 * and GET /v1/driver/me). It sits ABOVE Auth (session guard, ClientSessionAuthority) and Driver (M03 repositories and the wallet
 * port), like the other profile modules: nothing imports it. `auth` must be the very same object AppModule passes to its imports.
 */
@Module({})
export class ShipperSelfModule {
  static register(auth: DynamicModule): DynamicModule {
    return {
      module: ShipperSelfModule,
      imports: [auth, DriverModule, TransactionModule, IdempotencyModule, AuditModule, OutboxModule],
      controllers: [ShipperSelfController],
      providers: [ShipperSelfService],
    };
  }
}
