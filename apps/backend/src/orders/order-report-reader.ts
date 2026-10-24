import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';

// M10's read side for the administration overview and reports (M12). Plain counts over the owner's own table; nothing is written. An Order is counted by the moment it was
// CREATED (a customer sending it) or the moment it ENDED, never mixed with its deliveries: a recall creates a new delivery and never a new Order.

export interface OrderSummary {
  readonly total: number;
  readonly completed: number;
  /** Cancelled by the customer, cancelled by the shop or rejected by the shop. */
  readonly cancelled: number;
  readonly notCompleted: number;
  readonly open: number;
}

function whole(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new TechnicalError('internal', 'Database returned an unexpected number');
  }
  return value;
}

@Injectable()
export class OrderReportReader {
  async summary(context: TransactionContext, basis: 'created' | 'ended', fromMs: number, toMs: number): Promise<OrderSummary> {
    const column = basis === 'created' ? 'created_at' : 'ended_at';
    const result = await context.query<Record<string, string>>(
      `SELECT count(*)::text AS total, count(*) FILTER (WHERE status = 'COMPLETED')::text AS completed,
              count(*) FILTER (WHERE status IN ('CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SHOP', 'REJECTED_BY_SHOP'))::text AS cancelled,
              count(*) FILTER (WHERE status = 'NOT_COMPLETED')::text AS not_completed,
              count(*) FILTER (WHERE ended_at IS NULL)::text AS open
         FROM app.orders WHERE ${column} >= to_timestamp($1::bigint / 1000.0) AND ${column} < to_timestamp($2::bigint / 1000.0)`,
      [fromMs, toMs],
    );
    const row = result.rows[0] as Record<string, string>;
    return { total: whole(row.total), completed: whole(row.completed), cancelled: whole(row.cancelled), notCompleted: whole(row.not_completed), open: whole(row.open) };
  }

  /** Orders waiting for the shop to confirm RIGHT NOW. */
  async awaitingConfirmation(context: TransactionContext): Promise<number> {
    const result = await context.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.orders WHERE status = 'PENDING_CONFIRMATION'`);
    return whole(result.rows[0]?.n);
  }
}
