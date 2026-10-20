import { Inject, Injectable } from '@nestjs/common';
import { DriverAdminQueryRepository } from './driver-admin-query-repository';
import { DriverBankRepository, DriverBankRow } from './driver-bank-repository';
import { DRIVER_WALLET_PORT, DriverWalletPort } from './driver-wallet-port';
import { DriverRow } from './driver-repository';
import { JsonObject } from '../idempotency/idempotency-executor';
import { TransactionContext } from '../transaction/transaction-context';

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

/** Why a Shipper cannot take orders right now. Stable codes the app turns into text; the order is the order of the checklist. */
export type ReadinessBlock =
  | 'PROFILE_NOT_APPROVED'
  | 'ACCOUNT_SUSPENDED'
  | 'CLOSURE_REQUESTED'
  | 'ACCOUNT_CLOSED'
  | 'BANK_MISSING'
  | 'BANK_NOT_VERIFIED'
  | 'WALLET_NOT_AVAILABLE'
  | 'BALANCE_TOO_LOW';

export interface Readiness {
  readonly profileApproved: boolean;
  readonly bankVerified: boolean;
  readonly walletReady: boolean;
  readonly blocks: readonly ReadinessBlock[];
  readonly canAccept: boolean;
}

/**
 * The owner's view of a Shipper (GET /v1/driver/me and the answer of every own command). The internal classification (driver_type) is
 * NEVER part of it. The readiness is computed on the server from the stored state and the wallet port; the app only shows it.
 */
@Injectable()
export class ShipperViewBuilder {
  constructor(
    private readonly banks: DriverBankRepository,
    private readonly queries: DriverAdminQueryRepository,
    @Inject(DRIVER_WALLET_PORT) private readonly wallet: DriverWalletPort,
  ) {}

  /** Readiness as the server decides it (also used by the accepting command, under the same locks). */
  async readiness(context: TransactionContext, driver: DriverRow, bank: DriverBankRow | undefined): Promise<Readiness> {
    const blocks: ReadinessBlock[] = [];
    const profileApproved = driver.status === 'ACTIVE' || driver.status === 'SUSPENDED' || driver.status === 'CLOSING';
    if (driver.status === 'SUSPENDED') {
      blocks.push('ACCOUNT_SUSPENDED');
    } else if (driver.status === 'CLOSING') {
      blocks.push('CLOSURE_REQUESTED');
    } else if (driver.status === 'CLOSED') {
      blocks.push('ACCOUNT_CLOSED');
    } else if (driver.status !== 'ACTIVE') {
      blocks.push('PROFILE_NOT_APPROVED');
    }
    const bankVerified = bank?.verificationState === 'VERIFIED';
    const wallet = await this.wallet.readinessForOrders(context, driver.driverId);
    if (!wallet.ready) {
      blocks.push(wallet.reason);
    }
    return { profileApproved, bankVerified, walletReady: wallet.ready, blocks, canAccept: driver.status === 'ACTIVE' && wallet.ready };
  }

  async build(context: TransactionContext, driver: DriverRow): Promise<JsonObject> {
    const bank = await this.banks.find(context, driver.driverId);
    const phone = await this.queries.phoneOf(context, driver.userId);
    const readiness = await this.readiness(context, driver, bank);
    const inReview = driver.status === 'PENDING';
    return {
      driver_id: driver.driverId,
      user_id: driver.userId,
      shipper_code: driver.shipperCode,
      full_name: driver.fullName,
      phone: phone ?? null,
      plate_number: driver.plateNumber,
      status: driver.status,
      review_state: driver.reviewState,
      rejection_reason: driver.rejectionReason,
      suspension_reason: driver.suspensionReason,
      submitted_at: iso(driver.submittedAtMs),
      reviewed_at: iso(driver.reviewedAtMs),
      accepting_deliveries: driver.acceptingDeliveries,
      version: driver.version,
      can_edit_profile: inReview && (driver.reviewState === 'DRAFT' || driver.reviewState === 'REJECTED'),
      can_submit: inReview && (driver.reviewState === 'DRAFT' || driver.reviewState === 'REJECTED'),
      bank:
        bank === undefined
          ? null
          : {
              bank_code: bank.bankCode,
              bank_name: bank.bankName,
              account_number: bank.accountNumber,
              account_holder: bank.accountHolder,
              verification_state: bank.verificationState,
              rejection_reason: bank.rejectionReason,
              verified_at: iso(bank.verifiedAtMs),
            },
      readiness: {
        profile_approved: readiness.profileApproved,
        bank_verified: readiness.bankVerified,
        wallet_ready: readiness.walletReady,
        blocks: [...readiness.blocks],
        can_accept: readiness.canAccept,
      },
      closure:
        driver.status === 'CLOSING'
          ? { requested_at: iso(driver.closureRequestedAtMs), note: driver.closureNote, can_cancel: true }
          : null,
    };
  }
}
