import { DynamicModule, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { OutboxModule } from '../outbox/outbox.module';
import { ShopModule } from '../shop/shop.module';
import { TransactionModule } from '../transaction/transaction.module';
import { DiscoveryController, MenuOwnerController, MenuPublicController } from './menu.controller';
import { DiscoveryService } from './discovery-service';
import { MenuRepository } from './menu-repository';
import { MenuService } from './menu-service';

/**
 * Menu (M02-MON). Like Shop management it sits ABOVE Auth (M01) and Shop (M02): it imports the already built Auth dynamic module
 * (session guard + session-authorization participant) and ShopModule. Neither imports it, so the graph is acyclic.
 * `auth` must be the very same object AppModule passes to its own imports.
 */
@Module({})
export class MenuModule {
  static register(auth: DynamicModule): DynamicModule {
    return {
      module: MenuModule,
      imports: [auth, ShopModule, TransactionModule, IdempotencyModule, AuditModule, OutboxModule],
      controllers: [MenuOwnerController, MenuPublicController, DiscoveryController],
      providers: [MenuService, MenuRepository, DiscoveryService],
    };
  }
}
