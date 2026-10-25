import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppError, TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { TopupSettlementRepository } from './topup-settlement-repository';
import { MAX_WALLET_VND } from './wallet-types';

export interface CreditTopupInput {
  readonly walletId: string;
  readonly driverId: string;
  /** The PENDING request this money settles (locked and checked by the caller). */
  readonly requestId: string;
  /** The identity of the bank transaction, exactly as the bank statement gives it (edges trimmed by the caller, nothing else). */
  readonly bankId: string;
  readonly systemAccountId: string;
  readonly canonicalTransactionId: string;
  readonly actualAmountVnd: bigint;
  readonly receivedAtIso: string;
  readonly confirmedByUserId: string;
}

export interface CreditedTopup {
  readonly topupId: string;
  readonly sequenceNo: number;
  readonly balanceAfterVnd: bigint;
}

/**
 * The M04-B2.2b participant that posts money RECEIVED: the one place a wallet balance goes up. It takes the caller's TransactionContext, opens no
 * transaction, commits nothing and calls no network. The caller has already locked, in ADR-004 order, the idempotency record, the administrator
 * (and its finance right), the Shipper root and the request; this class locks the wallet FOR UPDATE, then the receiving account FOR SHARE, and
 * writes, in this order: the bank record (IN), the topup, the ledger credit (signed +actual, sequence and balance_after from the locked wallet) and
 * the wallet balance (+actual, version +1; held is untouched). The database then proves it all again at COMMIT: one credit per topup, the topup and
 * its bank record pointing at each other with the same amount, balance = SUM(ledger), a CONFIRMED request. A bank transaction already recorded by anyone,
 * on any wallet, is BANK_TRANSACTION_ALREADY_RECORDED and the caller's transaction rolls back whole.
 */
@Injectable()
export class TopupPostingService {
  constructor(private readonly repository: TopupSettlementRepository) {}

  /**
   * ADR-004 3.1 step 4: the wallet root FOR UPDATE, taken by the caller right after the Shipper root and BEFORE any topup source row (the request).
   * Returns false when the wallet does not exist or is not this Shipper's. Taking it again inside creditTopup is a no-op on a lock already held.
   */
  async lockWalletOf(context: TransactionContext, walletId: string, driverId: string): Promise<boolean> {
    const wallet = await this.repository.lockWallet(context, walletId);
    return wallet !== undefined && wallet.driverId === driverId;
  }

  async creditTopup(context: TransactionContext, input: CreditTopupInput): Promise<CreditedTopup> {
    if (input.actualAmountVnd <= 0n || input.actualAmountVnd > MAX_WALLET_VND) {
      throw new TechnicalError('internal', 'Invalid top-up amount');
    }
    const wallet = await this.repository.lockWallet(context, input.walletId);
    if (wallet === undefined || wallet.driverId !== input.driverId) {
      throw new TechnicalError('internal', 'Wallet does not belong to the request owner');
    }
    const account = await this.repository.lockAccountShared(context, input.systemAccountId);
    if (account === undefined || account.bankId !== input.bankId || !account.canReceive) {
      throw new AppError('TOPUP_ACCOUNT_NOT_RECEIVING');
    }
    const balanceAfter = wallet.balanceVnd + input.actualAmountVnd;
    if (balanceAfter > MAX_WALLET_VND) {
      throw new AppError('TOPUP_WALLET_LIMIT_EXCEEDED');
    }
    const last = await this.repository.lastLedger(context, input.walletId);
    if ((last?.balanceAfterVnd ?? 0n) !== wallet.balanceVnd) {
      // The ledger and the balance disagree before this credit: never post on top of a drift.
      throw new TechnicalError('internal', 'Wallet balance differs from its ledger');
    }
    if (await this.repository.usedByShopPayment(context, input.bankId, input.systemAccountId, input.canonicalTransactionId)) {
      // The same bank transaction already settled a payment of a shop: one transfer is never counted twice, whatever it was for.
      throw new AppError('BANK_TRANSACTION_ALREADY_RECORDED');
    }
    const topupId = randomUUID();
    const bankRecordId = randomUUID();
    const recorded = await this.repository.insertBankRecord(context, {
      bankRecordId,
      bankId: input.bankId,
      systemAccountId: input.systemAccountId,
      canonicalTransactionId: input.canonicalTransactionId,
      amountVnd: input.actualAmountVnd,
      occurredAtIso: input.receivedAtIso,
      topupId,
    });
    if (!recorded) {
      throw new AppError('BANK_TRANSACTION_ALREADY_RECORDED');
    }
    await this.repository.insertTopup(context, {
      topupId,
      walletId: input.walletId,
      requestId: input.requestId,
      bankRecordId,
      amountVnd: input.actualAmountVnd,
      receivedAtIso: input.receivedAtIso,
      confirmedByUserId: input.confirmedByUserId,
    });
    const sequenceNo = (last?.sequenceNo ?? 0) + 1;
    await this.repository.insertTopupLedger(context, { entryId: randomUUID(), walletId: input.walletId, sequenceNo, deltaVnd: input.actualAmountVnd, balanceAfterVnd: balanceAfter, topupId });
    await this.repository.addToBalance(context, { walletId: input.walletId, expectedVersion: wallet.version, newBalanceVnd: balanceAfter });
    return { topupId, sequenceNo, balanceAfterVnd: balanceAfter };
  }
}
