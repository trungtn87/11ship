import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';

// M11's read side for the administration overview (M12): how many complaints still wait for the administration. A complaint is handled when it is RESOLVED or closed with no action.

@Injectable()
export class FeedbackReportReader {
  async unhandledComplaints(context: TransactionContext): Promise<number> {
    const result = await context.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.complaints WHERE status IN ('PENDING', 'IN_PROGRESS', 'AWAITING_INFO')`);
    const value = Number(result.rows[0]?.n);
    if (!Number.isSafeInteger(value)) {
      throw new TechnicalError('internal', 'Database returned an unexpected number');
    }
    return value;
  }
}
