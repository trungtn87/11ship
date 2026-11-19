import { Injectable } from '@nestjs/common';
import { AuthPrincipal } from '../auth/auth-principal';
import { DriverWalletAccess } from '../driver-wallet/driver-wallet-access';
import { JsonObject } from '../idempotency/idempotency-executor';
import { TransactionManager } from '../transaction/transaction-manager';
import { WalletIncomeRepository } from '../wallet/wallet-income-repository';
import { buildIncomeSummary } from './driver-income-summary';
import { IncomePeriod } from './driver-income-validation';

/**
 * The Shipper's own income for a period (issue #395), read only. The Shipper is taken from the session through the same access rule as the wallet
 * (SHIP app, DRIVER hat and role); a LOCKED driver keeps read access to its own figures, as it keeps its wallet. No driver id comes from the client.
 */
@Injectable()
export class DriverIncomeService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly access: DriverWalletAccess,
    private readonly repository: WalletIncomeRepository,
  ) {}

  summary(principal: AuthPrincipal, period: IncomePeriod): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const { actor, driver } = await this.access.reader(context, principal);
      const { totals, days } = await this.repository.summary(context, driver.driverId, period);
      return buildIncomeSummary(period, totals, days, { driverStatus: driver.status, limitedAccess: actor.limited });
    });
  }
}
