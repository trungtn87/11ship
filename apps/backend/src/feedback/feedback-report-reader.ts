import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { FeedbackScope } from './feedback-constants';
import { complaintScopeSql } from './complaint-repository';

// M11's read side for the administration overview (M12): how many complaints still wait for the administration. A complaint is handled when it is RESOLVED or closed with no action.
// The count is ALWAYS taken inside the caller's scope (issue #261, M08-R-12): there is no unscoped total. SYSTEM passes both parts and counts everything.

@Injectable()
export class FeedbackReportReader {
  async unhandledComplaints(context: TransactionContext, scope: FeedbackScope): Promise<number> {
    const result = await context.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM app.complaints c WHERE c.status IN ('PENDING', 'IN_PROGRESS', 'AWAITING_INFO') AND ${complaintScopeSql('c', 1, 2)}`,
      [scope.shop, scope.driver],
    );
    const value = Number(result.rows[0]?.n);
    if (!Number.isSafeInteger(value)) {
      throw new TechnicalError('internal', 'Database returned an unexpected number');
    }
    return value;
  }
}
