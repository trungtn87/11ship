import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppError, TechnicalError } from '../common/app-errors';
import { DriverRepository } from '../driver/driver-repository';
import { TransactionContext } from '../transaction/transaction-context';
import { WalletRepository } from './wallet-repository';
import { HoldStatus, HoldSummary, unprovisionedView, viewOfRow, WalletHoldRow, WalletView } from './wallet-types';

/**
 * The M04-A1 participant: what other packages may ask of the Shipper wallet core, and nothing more.
 *
 *  - readWallet:       a plain read. NEVER creates a wallet (a GET has no side effect); a Shipper without one is reported as
 *                      "not provisioned" with zero amounts that mean "nothing here".
 *  - ensureZeroWallet: the one mutation. Under the driver lock (ADR-004 3.1: driver root first, then the wallet) it creates the
 *                      wallet at 0 VND if it does not exist, and returns it. It creates NO money and NO ledger row: opening money
 *                      without a source document is impossible (the database refuses it).
 *
 *  - listHolds / holdSummary (M04-A2.1): plain reads of the holds of a Shipper's wallet. Today the list is always empty: the database
 *                      refuses every hold until a source (M07 assignment, M04-C withdrawal) exists. They never create a wallet.
 *
 * All take the caller's TransactionContext: this class opens no transaction, commits nothing, holds no pool and calls no network,
 * so no database lock is ever held across a network call. There is no endpoint and no money command here (no top-up, withdrawal,
 * adjustment, hold or commission); those are M04-A2 / M04-B / M04-C / M07.
 */
@Injectable()
export class WalletService {
  constructor(
    private readonly wallets: WalletRepository,
    private readonly drivers: DriverRepository,
  ) {}

  /** The wallet of a Shipper as a read model. Locks nothing, writes nothing. */
  async readWallet(context: TransactionContext, driverId: string): Promise<WalletView> {
    const row = await this.wallets.findByDriverId(context, driverId);
    return row === undefined ? unprovisionedView(driverId) : viewOfRow(row);
  }

  /** Safe read for the delivery cancellation audit: no balance or bank information leaves Wallet. */
  async commissionHoldStatus(context: TransactionContext, assignmentId: string): Promise<HoldStatus | null> {
    return (await this.wallets.findHoldBySource(context, assignmentId))?.status ?? null;
  }

  /** The holds of a Shipper's wallet, oldest first (optionally one status). No wallet means no holds. Locks nothing, writes nothing. */
  async listHolds(context: TransactionContext, driverId: string, status?: HoldStatus): Promise<WalletHoldRow[]> {
    const wallet = await this.wallets.findByDriverId(context, driverId);
    return wallet === undefined ? [] : this.wallets.listHolds(context, wallet.walletId, status);
  }

  /** The held amount of a Shipper against the sum of its ACTIVE holds. Locks nothing, writes nothing. */
  async holdSummary(context: TransactionContext, driverId: string): Promise<HoldSummary> {
    const wallet = await this.wallets.findByDriverId(context, driverId);
    if (wallet === undefined) {
      return { provisioned: false, driverId, heldVnd: 0n, activeHoldCount: 0, activeHoldTotalVnd: 0n, consistent: true };
    }
    const totals = await this.wallets.activeTotals(context, wallet.walletId);
    return {
      provisioned: true,
      driverId,
      heldVnd: wallet.heldVnd,
      activeHoldCount: totals.count,
      activeHoldTotalVnd: totals.totalVnd,
      consistent: wallet.heldVnd === totals.totalVnd,
    };
  }

  /**
   * Creates the zero wallet of an existing Shipper once; a repeat (or a concurrent twin) returns the same wallet and creates nothing.
   * DRIVER_NOT_FOUND (404) when there is no such driver: no wallet is ever created for one. The driver row is locked FOR UPDATE first
   * (the guard root of everything money-related), so two provisioning requests for the same driver are serialised and the loser
   * simply reads the winner's wallet.
   */
  async ensureZeroWallet(context: TransactionContext, driverId: string): Promise<{ readonly wallet: Extract<WalletView, { provisioned: true }>; readonly created: boolean }> {
    const driver = await this.drivers.lockById(context, driverId);
    if (driver === undefined) {
      throw new AppError('DRIVER_NOT_FOUND');
    }
    const inserted = await this.wallets.insertZero(context, randomUUID(), driverId);
    if (inserted !== undefined) {
      return { wallet: provisioned(viewOfRow(inserted)), created: true };
    }
    const existing = await this.wallets.findByDriverId(context, driverId);
    if (existing === undefined) {
      // The conflict said a wallet exists and the read says it does not: never guess, roll the transaction back.
      throw new TechnicalError('internal', 'Wallet vanished between the conflict and the read');
    }
    return { wallet: provisioned(viewOfRow(existing)), created: false };
  }
}

function provisioned(view: WalletView): Extract<WalletView, { provisioned: true }> {
  if (!view.provisioned) {
    throw new TechnicalError('internal', 'A stored wallet was reported as not provisioned');
  }
  return view;
}
