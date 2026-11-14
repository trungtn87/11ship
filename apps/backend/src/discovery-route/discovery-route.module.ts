import { Module } from '@nestjs/common';
import { OtpClientIp } from '../auth/otp-client-ip';
import { M14RoutingModule } from '../delivery/m14-routing.module';
import { ShopSetupCoreModule } from '../shop-setup/shop-setup-core.module';
import { ShopModule } from '../shop/shop.module';
import { TransactionModule } from '../transaction/transaction.module';
import { DiscoveryRouteController } from './discovery-route.controller';
import { DiscoveryRouteService } from './discovery-route-service';

/**
 * Road distances for the discovery cards (issue #190). Imports no Auth: the route is public and reads only what customers may already see.
 * OtpClientIp is provided here (it needs only the global APP_CONFIG) to identify the caller for the per-address limit (P5-7c).
 */
@Module({
  imports: [ShopModule, ShopSetupCoreModule, M14RoutingModule, TransactionModule],
  controllers: [DiscoveryRouteController],
  providers: [DiscoveryRouteService, OtpClientIp],
})
export class DiscoveryRouteModule {}
