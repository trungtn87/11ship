import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';
import { TopupSettlementRepository } from './topup-settlement-repository';

/**
 * #198: what the shop payment confirmation needs from the wallet package without touching its tables: the receiving account (locked FOR SHARE, so a switch-off
 * waits) and the check that a bank transaction was not already recorded as a Shipper top-up. The tables stay the wallet package's; this class only reads them.
 */
@Injectable()
export class BankIdentityGuard {
  constructor(private readonly repository: TopupSettlementRepository) {}

  lockReceivingAccount(context: TransactionContext, accountId: string): Promise<{ readonly bankId: string; readonly canReceive: boolean } | undefined> {
    return this.repository.lockAccountShared(context, accountId);
  }

  /** True when a Shipper top-up already recorded this bank transaction. Takes the identity's advisory lock first (held to the end of the transaction). */
  usedByTopup(context: TransactionContext, bankId: string, systemAccountId: string, canonicalTransactionId: string): Promise<boolean> {
    return this.repository.usedByTopup(context, bankId, systemAccountId, canonicalTransactionId);
  }
}
