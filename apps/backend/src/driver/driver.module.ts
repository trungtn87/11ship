import { Module } from '@nestjs/common';
import { DriverActiveGuard } from './driver-active-guard';
import { DriverAdminQueryRepository } from './driver-admin-query-repository';
import { DriverBankRepository } from './driver-bank-repository';
import { DriverEventRepository } from './driver-event-repository';
import { DRIVER_WALLET_PORT, NotIntegratedDriverWalletPort } from './driver-wallet-port';
import { ShipperViewBuilder } from './shipper-view';
import { ShipperWalletParametersReader, ShipperWalletParametersRepository } from './shipper-wallet-parameters';
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
  providers: [
    DriverRepository,
    DriverEligibilityReader,
    DriverActiveGuard,
    DriverBankRepository,
    DriverEventRepository,
    DriverAdminQueryRepository,
    ShipperWalletParametersRepository,
    ShipperWalletParametersReader,
    ShipperViewBuilder,
    // M04 has not delivered a wallet yet: everything that depends on it is blocked (see driver-wallet-port.ts).
    { provide: DRIVER_WALLET_PORT, useClass: NotIntegratedDriverWalletPort },
  ],
  exports: [
    DriverRepository,
    DriverEligibilityReader,
    DriverActiveGuard,
    DriverBankRepository,
    DriverEventRepository,
    DriverAdminQueryRepository,
    ShipperWalletParametersRepository,
    ShipperWalletParametersReader,
    ShipperViewBuilder,
    DRIVER_WALLET_PORT,
  ],
})
export class DriverModule {}
