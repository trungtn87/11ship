import { Module } from '@nestjs/common';
import { DriverActiveGuard } from './driver-active-guard';
import { DriverEligibilityReader } from './driver-eligibility-reader';
import { DriverRepository } from './driver-repository';

/**
 * M03 Driver owner module (M01-A2D): the SQL of drivers, the read-only eligibility port
 * Auth consumes and the active-driver guard.
 *
 * It imports NOTHING: its providers are participants that receive a TransactionContext per call, so they need no
 * pool, no transaction manager and no other module. In particular it never imports Auth, Onboarding or Shop. The dependency runs one way
 * (Auth -> Driver for the read port; Onboarding -> Auth + Shop + Driver to coordinate), so there is no module
 * cycle and no forwardRef.
 */
@Module({
  providers: [DriverRepository, DriverEligibilityReader, DriverActiveGuard],
  exports: [DriverRepository, DriverEligibilityReader, DriverActiveGuard],
})
export class DriverModule {}
