import { Module } from '@nestjs/common';
import { DriverModule } from '../driver/driver.module';
import { CommissionHoldService } from './commission-hold-service';
import { WalletAdjustmentRepository } from './wallet-adjustment-repository';
import { WalletAdjustmentService } from './wallet-adjustment-service';
import { WalletCommissionAdjustmentAdapter } from './wallet-commission-adjustment.adapter';
import { WalletRepository } from './wallet-repository';
import { SystemBankAccountRepository } from './system-bank-account-repository';
import { TopupPostingService } from './topup-posting-service';
import { TopupRequestRepository } from './topup-request-repository';
import { TopupSettlementRepository } from './topup-settlement-repository';
import { WalletService } from './wallet-service';

/**
 * M04 Shipper wallet core (M04-A1): the zero wallet and its read model. It exposes NO controller, NO route and NO money command; it is
 * a set of participants other packages bind to later (M04-A2 holds, M04-B top-ups, M04-C withdrawals, M07 commission, the M03 closure
 * and readiness ports). It depends on M03 only through the Driver module's exported repository (the driver lock), and M03 does not
 * depend on it: DRIVER_WALLET_PORT stays bound to NotIntegratedDriverWalletPort until the guards a "ready" or "settled" answer needs
 * exist, so having a wallet (even with 0 VND) never makes a Shipper ready for orders.
 */
@Module({
  imports: [DriverModule],
  providers: [WalletRepository, WalletService, TopupRequestRepository, SystemBankAccountRepository, TopupSettlementRepository, TopupPostingService, CommissionHoldService, WalletAdjustmentRepository, WalletAdjustmentService, WalletCommissionAdjustmentAdapter],
  exports: [WalletService, TopupRequestRepository, SystemBankAccountRepository, TopupPostingService, CommissionHoldService, WalletAdjustmentService, WalletCommissionAdjustmentAdapter],
})
export class WalletModule {}
