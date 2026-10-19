import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';

// The money part of an outcome adjustment belongs to M04 (the wallet package): M11 never writes a ledger row or a hold. M04's ledger gate today opens
// only for TOPUP and COMMISSION_DEBIT, so there is no posting of a refund or an extra charge yet. The default binding says so (UNAVAILABLE) and the
// adjustment stays PENDING_FINANCE with its reason; when M04 opens an adjustment posting it binds this port and nothing in M11 changes. A missing
// balance is a result of the port (INSUFFICIENT_BALANCE), never a negative wallet and never the money held for another delivery.

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

@Injectable()
export class NotIntegratedCommissionAdjustmentPort implements CommissionAdjustmentPort {
  readonly integrated = false;

  post(): Promise<CommissionAdjustmentResult> {
    return Promise.resolve({ kind: 'UNAVAILABLE' });
  }
}
