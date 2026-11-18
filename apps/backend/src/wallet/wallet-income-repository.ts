import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { bigintOf } from './wallet-read-repository';
import { TransactionContext } from '../transaction/transaction-context';


export const INCOME_TIME_ZONE = 'Asia/Ho_Chi_Minh';

export interface IncomeTotalsRow {
  /** Completed assignments of the Shipper in the period (one per assignment; a delivery completes at most once). */
  readonly completedCount: bigint;
  /** Sum of the final fee (deliveries.fee_vnd) of those assignments. */
  readonly feeVnd: bigint;
  /** Sum of the COMMISSION_DEBIT ledger rows of those assignments: NEGATIVE, or 0 when none. */
  readonly commissionVnd: bigint;
  /** Completed assignments with no commission debit yet (the figure is provisional). */
  readonly provisionalCount: bigint;
  /** Completed assignments whose debit differs from the commission snapshot of the assignment (the figure is provisional). */
  readonly mismatchCount: bigint;
}

export interface IncomeDayRow extends IncomeTotalsRow {
  /** Vietnam calendar day, YYYY-MM-DD. Days with no completed assignment are present with zeros. */
  readonly day: string;
}

interface RawTotals {
  completed: string;
  fee: string;
  commission: string;
  provisional: string;
  mismatch: string;
}

interface RawDay extends RawTotals {
  date: string;
}

function totalsOf(raw: RawTotals): IncomeTotalsRow {
  return {
    completedCount: bigintOf(raw.completed),
    feeVnd: bigintOf(raw.fee),
    commissionVnd: bigintOf(raw.commission),
    provisionalCount: bigintOf(raw.provisional),
    mismatchCount: bigintOf(raw.mismatch),
  };
}

/**
 * Income of ONE Shipper over a Vietnam calendar period (issue #395). Read only: one statement, so the totals and the per-day rows are one snapshot and
 * always agree. Only COMPLETED assignments of the given driver count, dated by the moment the assignment ended (delivery_assignments.ended_at). The
 * commission is the real COMMISSION_DEBIT ledger row of each assignment (linked by commission_assignment_id, unique), never a per-order constant.
 * Money stays in integer VND; sums are done in the database.
 */
@Injectable()
export class WalletIncomeRepository {
  async summary(context: TransactionContext, driverId: string, period: { readonly from: string; readonly to: string }): Promise<{ totals: IncomeTotalsRow; days: IncomeDayRow[] }> {
    const result = await context.query<{ totals: RawTotals; days: RawDay[] }>(
      `WITH bounds AS (
         SELECT ($2::date)::timestamp AT TIME ZONE '${INCOME_TIME_ZONE}' AS start_at,
                (($3::date) + 1)::timestamp AT TIME ZONE '${INCOME_TIME_ZONE}' AS end_at
       ),
       base AS (
         SELECT (a.ended_at AT TIME ZONE '${INCOME_TIME_ZONE}')::date AS day, d.fee_vnd, a.commission_vnd AS snapshot_vnd, l.delta_vnd AS debit_delta
           FROM app.delivery_assignments a
           CROSS JOIN bounds b
           JOIN app.deliveries d ON d.delivery_id = a.delivery_id
           LEFT JOIN app.wallet_ledger_entries l ON l.commission_assignment_id = a.assignment_id AND l.entry_kind = 'COMMISSION_DEBIT'
          WHERE a.driver_id = $1::uuid
            AND a.status = 'COMPLETED'
            AND a.ended_at >= b.start_at
            AND a.ended_at < b.end_at
       ),
       totals AS (
         SELECT count(*)::text AS completed,
                COALESCE(SUM(fee_vnd), 0)::text AS fee,
                COALESCE(SUM(debit_delta), 0)::text AS commission,
                (count(*) FILTER (WHERE debit_delta IS NULL))::text AS provisional,
                (count(*) FILTER (WHERE debit_delta IS NOT NULL AND -debit_delta <> snapshot_vnd))::text AS mismatch
           FROM base
       ),
       per_day AS (
         SELECT day,
                count(*) AS completed,
                COALESCE(SUM(fee_vnd), 0) AS fee,
                COALESCE(SUM(debit_delta), 0) AS commission,
                count(*) FILTER (WHERE debit_delta IS NULL) AS provisional,
                count(*) FILTER (WHERE debit_delta IS NOT NULL AND -debit_delta <> snapshot_vnd) AS mismatch
           FROM base
          GROUP BY day
       ),
       days AS (
         SELECT g::date AS day FROM generate_series($2::date, $3::date, interval '1 day') AS g
       )
       SELECT
         (SELECT row_to_json(t) FROM totals t) AS totals,
         (SELECT COALESCE(json_agg(json_build_object(
                   'date', to_char(x.day, 'YYYY-MM-DD'),
                   'completed', COALESCE(p.completed, 0)::text,
                   'fee', COALESCE(p.fee, 0)::text,
                   'commission', COALESCE(p.commission, 0)::text,
                   'provisional', COALESCE(p.provisional, 0)::text,
                   'mismatch', COALESCE(p.mismatch, 0)::text
                 ) ORDER BY x.day), '[]'::json)
            FROM days x LEFT JOIN per_day p ON p.day = x.day) AS days`,
      [driverId, period.from, period.to],
    );
    const row = result.rows[0];
    if (row === undefined || row.totals === null || !Array.isArray(row.days)) {
      throw new TechnicalError('internal', 'Income query returned no totals');
    }
    return {
      totals: totalsOf(row.totals),
      days: row.days.map((day) => ({ day: day.date, ...totalsOf(day) })),
    };
  }
}
