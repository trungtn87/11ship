import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MenuReadinessModule } from '../menu/menu-readiness.module';
import { OutboxModule } from '../outbox/outbox.module';
import { ShopModule } from '../shop/shop.module';
import { ShopActivation } from './shop-activation';
import { ShopSetupGate } from './shop-setup-gate';

/**
 * The setup gate and the automatic activation (issue #190). It sits ABOVE Shop and the menu readiness port and BELOW everything that serves
 * customers or changes a shop (Menu, Shop management, Orders, Reviews, Administration): none of those is imported here, so the graph is acyclic.
 */
@Module({
  imports: [ShopModule, MenuReadinessModule, AuditModule, OutboxModule],
  providers: [ShopSetupGate, ShopActivation],
  exports: [ShopSetupGate, ShopActivation],
})
export class ShopSetupCoreModule {}
