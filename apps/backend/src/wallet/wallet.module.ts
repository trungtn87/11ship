import { Module } from '@nestjs/common';
import { DriverModule } from '../driver/driver.module';
import { CommissionHoldService } from './commission-hold-service';
import { WalletRepository } from './wallet-repository';
import { SystemBankAccountRepository } from './system-bank-account-repository';
import { TopupRequestRepository } from './topup-request-repository';
import { WalletService } from './wallet-service';

/**
 * M04 Shipper wallet core (M04-A1) and the commission hold (M04-A2.2, used by M07): the zero wallet, its read model and reserve / capture /
 * release of the commission of one delivery assignment. It exposes NO controller and NO route; it is
 * a set of participants other packages bind to later (M04-A2 holds, M04-B top-ups, M04-C withdrawals, M07 commission, the M03 closure
 * and readiness ports). It depends on M03 only through the Driver module's exported repository (the driver lock), and M03 does not
 * depend on it: DRIVER_WALLET_PORT stays bound to NotIntegratedDriverWalletPort until the guards a "ready" or "settled" answer needs
 * exist, so having a wallet (even with 0 VND) never makes a Shipper ready for orders.
 */
@Module({
  imports: [DriverModule],
  providers: [WalletRepository, WalletService, TopupRequestRepository, SystemBankAccountRepository, CommissionHoldService],
  exports: [WalletService, TopupRequestRepository, SystemBankAccountRepository, CommissionHoldService],
})
export class WalletModule {}
