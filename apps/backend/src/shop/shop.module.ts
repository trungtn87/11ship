import { Module } from '@nestjs/common';
import { ServiceAreaRepository } from './service-area-repository';
import { ShopAvailabilityReader } from './shop-availability-reader';
import { ShopBusinessHoursRepository } from './shop-business-hours-repository';
import { ShopEligibilityReader } from './shop-eligibility-reader';
import { ShopRepository } from './shop-repository';

/**
 * M02 Shop owner module (M01-A2S, M02-A): the SQL of service_areas, shops, shop_members and shop_business_hours, plus
 * the read-only eligibility port Auth consumes and the availability read port (profile, schedule and availability in
 * one statement) a shop-management coordinator and, later, Order consume.
 *
 * It imports NOTHING: its providers are participants that receive a TransactionContext per call, so they need
 * no pool, no transaction manager and no other module. In particular it never imports Auth. The dependency
 * runs one way (Auth -> Shop for the read port; Onboarding -> Auth + Shop to coordinate), so there is no
 * module cycle and no forwardRef.
 */
@Module({
  providers: [
    ServiceAreaRepository,
    ShopRepository,
    ShopBusinessHoursRepository,
    ShopEligibilityReader,
    ShopAvailabilityReader,
  ],
  exports: [
    ServiceAreaRepository,
    ShopRepository,
    ShopBusinessHoursRepository,
    ShopEligibilityReader,
    ShopAvailabilityReader,
  ],
})
export class ShopModule {}
