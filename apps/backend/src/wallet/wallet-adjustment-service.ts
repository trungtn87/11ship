import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { TopupSettlementRepository } from './topup-settlement-repository';
import { WalletAdjustmentRepository } from './wallet-adjustment-repository';
import { WalletRepository } from './wallet-repository';
import { MAX_WALLET_VND } from './wallet-types';

export interface PostAdjustmentInput {
  readonly driverId: string;
  readonly sourceType: 'COMPLAINT';
  /** What decided it (the M11 adjustment). The pair (sourceType, sourceId) is unique: a repeat posts nothing. */
  readonly sourceId: string;
  readonly direction: 'REFUND_TO_SHIPPER' | 'CHARGE_TO_SHIPPER';
  readonly amountVnd: bigint;
  readonly postedByUserId: string;
}

export type PostedAdjustment =
  | { readonly kind: 'POSTED'; readonly adjustmentId: string; readonly replay: boolean }
  | { readonly kind: 'INSUFFICIENT_BALANCE' };

/**
 * The M04 participant that posts a refund or an extra charge of a commission decided elsewhere (M11). The caller holds its own locks (the Shipper root
 * before this); this locks the wallet FOR UPDATE, then writes in order: the adjustment record, the ledger row (signed amount, sequence and balance_after
 * from the locked wallet) and the wallet balance. It takes the caller's TransactionContext, opens no transaction, commits nothing, calls no network.
 *
 *   - It never writes the ledger for anything but its own record, and the database proves it again at COMMIT: one ledger row per adjustment.
 *   - A repeat of the same source returns the first result and writes nothing, so a retried or doubled click cannot move the money twice.
 *   - A charge takes only AVAILABLE money (balance - held): when it is not there the answer is INSUFFICIENT_BALANCE and nothing is written; the wallet
 *     never goes negative and the money held for a delivery is never touched. The amount is never taken "partly".
 */
@Injectable()
export class WalletAdjustmentService {
  constructor(
    private readonly wallets: WalletRepository,
    private readonly settlement: TopupSettlementRepository,
    private readonly adjustments: WalletAdjustmentRepository,
  ) {}

  async post(context: TransactionContext, input: PostAdjustmentInput): Promise<PostedAdjustment> {
    if (input.amountVnd <= 0n || input.amountVnd > MAX_WALLET_VND) {
      throw new TechnicalError('internal', 'Invalid adjustment amount');
    }
    let wallet = await this.wallets.findByDriverId(context, input.driverId);
    if (wallet === undefined) {
      if (input.direction === 'CHARGE_TO_SHIPPER') {
        return { kind: 'INSUFFICIENT_BALANCE' };
      }
      // A refund to a Shipper who never had a wallet opens the zero wallet first (the same row M03 / M04-A1 would have made).
      wallet = await this.wallets.insertZero(context, randomUUID(), input.driverId);
      wallet ??= await this.wallets.findByDriverId(context, input.driverId);
      if (wallet === undefined) {
        throw new TechnicalError('internal', 'Wallet could not be opened');
      }
    }
    const locked = await this.settlement.lockWallet(context, wallet.walletId);
    if (locked === undefined || locked.driverId !== input.driverId) {
      throw new TechnicalError('internal', 'Wallet does not belong to the Shipper');
    }
    const existing = await this.adjustments.findBySource(context, input.sourceType, input.sourceId);
    if (existing !== undefined) {
      if (existing.walletId !== locked.walletId || existing.direction !== input.direction || existing.amountVnd !== input.amountVnd) {
        throw new TechnicalError('internal', 'An adjustment of this source already exists with other terms');
      }
      return { kind: 'POSTED', adjustmentId: existing.adjustmentId, replay: true };
    }
    const credit = input.direction === 'REFUND_TO_SHIPPER';
    if (!credit && locked.balanceVnd - locked.heldVnd < input.amountVnd) {
      return { kind: 'INSUFFICIENT_BALANCE' };
    }
    const balanceAfter = credit ? locked.balanceVnd + input.amountVnd : locked.balanceVnd - input.amountVnd;
    if (balanceAfter > MAX_WALLET_VND) {
      throw new TechnicalError('internal', 'Adjustment would pass the wallet limit');
    }
    const last = await this.settlement.lastLedger(context, locked.walletId);
    if ((last?.balanceAfterVnd ?? 0n) !== locked.balanceVnd) {
      // The ledger and the balance disagree before this adjustment: never post on top of a drift.
      throw new TechnicalError('internal', 'Wallet balance differs from its ledger');
    }
    const adjustmentId = randomUUID();
    await this.adjustments.insert(context, { adjustmentId, walletId: locked.walletId, sourceType: input.sourceType, sourceId: input.sourceId, direction: input.direction, amountVnd: input.amountVnd, postedBy: input.postedByUserId });
    await this.adjustments.insertLedger(context, {
      entryId: randomUUID(),
      walletId: locked.walletId,
      sequenceNo: (last?.sequenceNo ?? 0) + 1,
      kind: credit ? 'ADJUSTMENT_CREDIT' : 'ADJUSTMENT_DEBIT',
      deltaVnd: credit ? input.amountVnd : -input.amountVnd,
      balanceAfterVnd: balanceAfter,
      adjustmentId,
    });
    await this.settlement.addToBalance(context, { walletId: locked.walletId, expectedVersion: locked.version, newBalanceVnd: balanceAfter });
    return { kind: 'POSTED', adjustmentId, replay: false };
  }
}
