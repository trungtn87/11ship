import { DynamicModule, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { TransactionModule } from '../transaction/transaction.module';
import { CustomersController } from './customers.controller';
import { CustomersRepository } from './customers-repository';
import { CustomersService } from './customers-service';

/**
 * Customer record and delivery address book (M05): GET /v1/customers/me and /v1/customers/me/addresses. Like CustomerProfile it
 * sits ABOVE Auth (M01): it imports the already built Auth dynamic module (session guard, ClientSessionAuthority, UserRepository)
 * and nothing imports it, so the graph is acyclic. `auth` must be the very same object AppModule passes to its own imports, so Nest
 * sees one AuthModule. CustomersService is exported for the later checkout module (M10), which reads the address book through it
 * and never through SQL of its own.
 */
@Module({})
export class CustomersModule {
  static register(auth: DynamicModule): DynamicModule {
    return {
      module: CustomersModule,
      imports: [auth, TransactionModule, IdempotencyModule, AuditModule],
      controllers: [CustomersController],
      providers: [CustomersService, CustomersRepository],
      exports: [CustomersService],
    };
  }
}
