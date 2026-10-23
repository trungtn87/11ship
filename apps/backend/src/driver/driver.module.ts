import { Module } from '@nestjs/common';
import { DriverActiveGuard } from './driver-active-guard';
import { DriverAdminQueryRepository } from './driver-admin-query-repository';
import { DriverBankRepository } from './driver-bank-repository';
import { DriverEventRepository } from './driver-event-repository';
import { DelegatingDriverWalletPort, DRIVER_WALLET_PORT } from './driver-wallet-port';
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
    // The wallet answers through a delegate the Wallet module binds at start-up; without it everything that depends on the wallet stays blocked (driver-wallet-port.ts).
    DelegatingDriverWalletPort,
    { provide: DRIVER_WALLET_PORT, useExisting: DelegatingDriverWalletPort },
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
    DelegatingDriverWalletPort,
  ],
})
export class DriverModule {}
