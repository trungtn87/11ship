import { DriverRepository } from '../driver/driver-repository';
import { ShipperWalletParametersReader } from '../driver/shipper-wallet-parameters';
import { Injectable } from '@nestjs/common';
import { DriverWalletPort, WalletFunding, WalletReadiness, WalletSettlement } from '../driver/driver-wallet-port';
import { TransactionContext } from '../transaction/transaction-context';
import { CommissionPolicyRepository } from './commission-policy-repository';
import { WalletReadRepository } from './wallet-read-repository';
import { WalletService } from './wallet-service';

/**
 * What M03 asks of the wallet (M04-C), answered from the wallet itself. Plain reads: no lock, no write, no wallet created.
 *  - readinessForOrders: the Shipper may turn "receiving deliveries" on only when the AVAILABLE money (balance - held) covers the commission in force (what accepting
 *    would set aside). A Shipper without a wallet has nothing available. No other balance rule exists: nothing is locked after the first activation.
 *  - settlementForClosure: a profile may be closed only when nothing is left to settle: no ACTIVE hold, no open withdrawal (PENDING / PROCESSING / RECONCILIATION) and a
 *    balance of exactly 0. Anything else is BALANCE_REMAINING: the money is paid out by a withdrawal first, never written off.
 */
/** The first-activation funding, ADR-004 6: 100.000 VND of real top-ups (a fixed rule of the Owner, not the configurable minimum top-up). */


@Injectable()
export class WalletDriverPort implements DriverWalletPort {
  constructor(
    private readonly wallets: WalletService,
    private readonly reads: WalletReadRepository,
    private readonly policies: CommissionPolicyRepository,
    private readonly limits: ShipperWalletParametersReader,
    private readonly drivers: DriverRepository,
  ) {}

  /** Confirmed top-ups of the Shipper >= 100.000 VND AND the money still available >= 100.000 VND (a withdrawal asked since counts against it). Nothing is credited here. */
  async fundingForActivation(context: TransactionContext, driverId: string): Promise<WalletFunding> {
    const funding = await this.reads.fundingOfDriver(context, driverId);
    const minimum = BigInt((await this.limits.limits(context)).topupMinVnd);
    return funding.confirmedTopupVnd >= minimum && funding.availableVnd >= minimum ? { funded: true } : { funded: false, reason: 'FUNDING_TOO_LOW' };
  }

  async readinessForOrders(context: TransactionContext, driverId: string): Promise<WalletReadiness> {
    const wallet = await this.wallets.readWallet(context, driverId);
    const driver = await this.drivers.findById(context, driverId);
    if (driver?.initialFundingRequired) {
      const funding = await this.reads.fundingOfDriver(context, driverId);
      const minimum = BigInt((await this.limits.limits(context)).topupMinVnd);
      if (funding.confirmedTopupVnd < minimum) return { ready: false, reason: 'FUNDING_TOO_LOW' };
    }
    const policy = await this.policies.current(context);
    return wallet.availableVnd > 0n && wallet.availableVnd >= policy.amountVnd ? { ready: true } : { ready: false, reason: 'BALANCE_TOO_LOW' };
  }

  async settlementForClosure(context: TransactionContext, driverId: string): Promise<WalletSettlement> {
    const wallet = await this.wallets.readWallet(context, driverId);
    if (!wallet.provisioned) {
      return { settled: true };
    }
    const holds = await this.wallets.holdSummary(context, driverId);
    const open = await this.reads.openWithdrawalCountOfDriver(context, driverId);
    const pending = await context.query(`SELECT 1 FROM app.wallet_topup_requests WHERE wallet_id = $1::uuid AND state = 'PENDING' LIMIT 1`, [wallet.walletId]);
    return pending.rows.length === 0 && wallet.balanceVnd === 0n && holds.activeHoldCount === 0 && open === 0 ? { settled: true } : { settled: false, reason: 'BALANCE_REMAINING' };
  }
}
