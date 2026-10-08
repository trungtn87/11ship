import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { BusinessInterval } from './business-hours';

/**
 * SQL for app.shop_business_hours (M02-A). M02 owns the table; no other module issues SQL against it. Every method
 * takes the caller's TransactionContext: none of them begins, commits or rolls back anything.
 *
 * The caller holds the shop row FOR UPDATE (after the user and session locks), so two replacements of one shop never
 * interleave, and it has already validated and canonicalized the schedule (business-hours.ts). The table's CHECK
 * constraints and its primary key are the last line of defence, not the validator.
 */
@Injectable()
export class ShopBusinessHoursRepository {
  /**
   * Replaces the WHOLE weekly schedule: removes every row of the shop, then inserts the given intervals (none at all
   * is the legal "closed all week" schedule). Two statements in the caller's transaction; if either fails the
   * caller's transaction rolls back and the previous schedule is untouched. Nothing is merged or repaired.
   */
  async replaceAll(
    context: TransactionContext,
    shopId: string,
    intervals: readonly BusinessInterval[],
  ): Promise<void> {
    await context.query('DELETE FROM app.shop_business_hours WHERE shop_id = $1::uuid', [shopId]);
    if (intervals.length === 0) {
      return;
    }
    const result = await context.query(
      `INSERT INTO app.shop_business_hours (shop_id, weekday, start_minute, end_minute, end_day_offset)
       SELECT $1::uuid, v.weekday, v.start_minute, v.end_minute, v.end_day_offset
         FROM unnest($2::smallint[], $3::smallint[], $4::smallint[], $5::smallint[])
              AS v(weekday, start_minute, end_minute, end_day_offset)`,
      [
        shopId,
        intervals.map((interval) => interval.weekday),
        intervals.map((interval) => interval.startMinute),
        intervals.map((interval) => interval.endMinute),
        intervals.map((interval) => interval.endDayOffset),
      ],
    );
    if (result.rowCount !== intervals.length) {
      // A single INSERT ... SELECT that did not fail wrote every row; refuse to continue on a guess.
      throw new TechnicalError('internal', 'Business hours were not written');
    }
  }
}
