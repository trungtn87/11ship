import { TransactionContext } from '../transaction/transaction-context';

// The money part of an outcome adjustment belongs to M04 (the wallet package): M11 never writes a ledger row or a hold. M04 posts a refund or an extra charge of
// a commission through its adjustment gate (wallet/wallet-adjustment-service.ts), bound to this port by the wallet package's adapter. A missing balance is a result
// of the port (INSUFFICIENT_BALANCE), never a negative wallet and never the money held for another delivery. The wallet adapter is the only production binding
// (admin-auth.module.ts); a port that answers UNAVAILABLE keeps the adjustment PENDING_FINANCE with its reason.

export type CommissionAdjustmentRequest = {
  readonly adjustmentId: string;
  readonly complaintId: string;
  readonly driverId: string;
  readonly assignmentId: string;
  readonly direction: 'REFUND_TO_SHIPPER' | 'CHARGE_TO_SHIPPER';
  readonly amountVnd: number;
  readonly actorUserId: string;
};

export type CommissionAdjustmentResult = { readonly kind: 'POSTED' } | { readonly kind: 'INSUFFICIENT_BALANCE' } | { readonly kind: 'UNAVAILABLE' };

export interface CommissionAdjustmentPort {
  readonly integrated: boolean;
  /** Idempotent on adjustmentId. Runs inside the caller's transaction. */
  post(context: TransactionContext, request: CommissionAdjustmentRequest): Promise<CommissionAdjustmentResult>;
}

export const COMMISSION_ADJUSTMENT_PORT = Symbol('COMMISSION_ADJUSTMENT_PORT');
