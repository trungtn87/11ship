import { Injectable } from '@nestjs/common';
import { AuthPrincipal } from '../auth/auth-principal';
import { DriverBankRepository } from '../driver/driver-bank-repository';
import { ShipperWalletParametersReader } from '../driver/shipper-wallet-parameters';
import { JsonObject } from '../idempotency/idempotency-executor';
import { TransactionManager } from '../transaction/transaction-manager';
import { CommissionPolicyRepository } from '../wallet/commission-policy-repository';
import { WalletReadRepository } from '../wallet/wallet-read-repository';
import { WalletService } from '../wallet/wallet-service';
import { encodeFeedCursor, FeedQuery, safeJsonNumber } from './driver-wallet-validation';
import { DriverWalletAccess } from './driver-wallet-access';

/**
 * The Shipper's own wallet, read only (M04-C): the summary (B / H / A = B - H), the holds, the history and the bank account a withdrawal would pay to. Every
 * route is a plain GET: it takes shared locks, writes nothing, never creates a wallet and never reads another Shipper's wallet (the wallet is found through
 * the session's own driver). A Shipper without a wallet is told "not provisioned" with zeros that mean "nothing here".
 */
@Injectable()
export class DriverWalletService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly access: DriverWalletAccess,
    private readonly wallets: WalletService,
    private readonly reads: WalletReadRepository,
    private readonly banks: DriverBankRepository,
    private readonly limits: ShipperWalletParametersReader,
    private readonly commission: CommissionPolicyRepository,
  ) {}

  summary(principal: AuthPrincipal): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const { actor, driver } = await this.access.reader(context, principal);
      const wallet = await this.wallets.readWallet(context, driver.driverId);
      const limits = await this.limits.limits(context);
      const policy = await this.commission.current(context);
      const open = await this.reads.openWithdrawalCountOfDriver(context, driver.driverId);
      return {
        wallet: {
          provisioned: wallet.provisioned,
          balance_vnd: safeJsonNumber(wallet.balanceVnd),
          held_vnd: safeJsonNumber(wallet.heldVnd),
          available_vnd: safeJsonNumber(wallet.availableVnd),
        },
        limits: { topup_min_vnd: limits.topupMinVnd, withdraw_min_vnd: limits.withdrawMinVnd },
        commission_vnd: safeJsonNumber(policy.amountVnd),
        open_withdrawals: open,
        driver_status: driver.status,
        limited_access: actor.limited,
      };
    });
  }

  holds(principal: AuthPrincipal, status: 'ACTIVE' | 'CAPTURED' | 'RELEASED' | undefined): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const { driver } = await this.access.reader(context, principal);
      const wallet = await this.wallets.readWallet(context, driver.driverId);
      if (!wallet.provisioned) {
        return { items: [] };
      }
      const rows = await this.reads.holds(context, wallet.walletId, { status, limit: 50 });
      return {
        items: rows.map((row) => ({
          hold_id: row.holdId,
          purpose: row.purpose,
          amount_vnd: safeJsonNumber(row.amountVnd),
          status: row.status,
          created_at: new Date(row.createdAtMs).toISOString(),
          resolved_at: row.resolvedAtMs === null ? null : new Date(row.resolvedAtMs).toISOString(),
          order_ref: row.orderRef,
          withdrawal_id: row.withdrawalId,
        })),
      };
    });
  }

  history(principal: AuthPrincipal, query: FeedQuery): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const { driver } = await this.access.reader(context, principal);
      const wallet = await this.wallets.readWallet(context, driver.driverId);
      if (!wallet.provisioned) {
        return { items: [], next_cursor: null };
      }
      const rows = await this.reads.feed(context, wallet.walletId, { filter: query.filter, limit: query.limit + 1, after: query.after });
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      return {
        items: page.map((row) => ({
          id: row.rowId,
          type: row.type,
          amount_vnd: safeJsonNumber(row.amountVnd),
          at: new Date(row.atMs).toISOString(),
          status: row.status,
          order_ref: row.orderRef,
          request_id: row.requestId,
          request_kind: row.requestKind,
        })),
        next_cursor: rows.length > query.limit && last !== undefined ? encodeFeedCursor(last.atMs, last.rowId) : null,
      };
    });
  }

  /** The Shipper's own bank account as a withdrawal would use it: the number is MASKED; only the holder's name (their own) is shown whole. */
  withdrawalAccount(principal: AuthPrincipal): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const { driver } = await this.access.reader(context, principal);
      const bank = await this.banks.find(context, driver.driverId);
      if (bank === undefined) {
        return { account: null };
      }
      return {
        account: {
          bank_code: bank.bankCode,
          bank_name: bank.bankName,
          account_number_masked: maskAccount(bank.accountNumber),
          account_holder: bank.accountHolder,
          verification_state: bank.verificationState,
          can_withdraw: bank.verificationState === 'VERIFIED',
        },
      };
    });
  }
}

export function maskAccount(accountNumber: string): string {
  return `****${accountNumber.slice(-4)}`;
}
