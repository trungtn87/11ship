import { Injectable } from '@nestjs/common';
import { CommissionAdjustmentPort, CommissionAdjustmentRequest, CommissionAdjustmentResult } from '../feedback/feedback-finance-port';
import { TransactionContext } from '../transaction/transaction-context';
import { WalletAdjustmentService } from './wallet-adjustment-service';

/**
 * What M11 (ratings and complaints) may ask of the wallet package (the port it owns): post the refund or the extra charge of a commission that an
 * administrator with the money right decided. It runs inside the caller's transaction and writes through the wallet package only; M11 never touches the
 * ledger. The amount is whole VND. A repeat of the same adjustment answers POSTED and writes nothing.
 */
@Injectable()
export class WalletCommissionAdjustmentAdapter implements CommissionAdjustmentPort {
  readonly integrated = true;

  constructor(private readonly adjustments: WalletAdjustmentService) {}

  async post(context: TransactionContext, request: CommissionAdjustmentRequest): Promise<CommissionAdjustmentResult> {
    const result = await this.adjustments.post(context, {
      driverId: request.driverId,
      sourceType: 'COMPLAINT',
      sourceId: request.adjustmentId,
      direction: request.direction,
      amountVnd: BigInt(request.amountVnd),
      postedByUserId: request.actorUserId,
    });
    return result.kind === 'POSTED' ? { kind: 'POSTED' } : { kind: 'INSUFFICIENT_BALANCE' };
  }
}
