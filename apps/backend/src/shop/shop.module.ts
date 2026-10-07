import { Module } from '@nestjs/common';
import { ServiceAreaRepository } from './service-area-repository';
import { ShopEligibilityReader } from './shop-eligibility-reader';
import { ShopRepository } from './shop-repository';

/**
 * M02 Shop owner module (M01-A2S): the SQL of service_areas, shops and shop_members, plus the read-only
 * eligibility port Auth consumes.
 *
 * It imports NOTHING: its providers are participants that receive a TransactionContext per call, so they need
 * no pool, no transaction manager and no other module. In particular it never imports Auth. The dependency
 * runs one way (Auth -> Shop for the read port; Onboarding -> Auth + Shop to coordinate), so there is no
 * module cycle and no forwardRef.
 */
@Module({
  providers: [ServiceAreaRepository, ShopRepository, ShopEligibilityReader],
  exports: [ServiceAreaRepository, ShopRepository, ShopEligibilityReader],
})
export class ShopModule {}
