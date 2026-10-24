import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { toSafeInteger } from '../driver/driver-db';
import { TransactionContext } from '../transaction/transaction-context';

// "Thời gian trả lời đề xuất phí" (Cài đặt › Đơn hàng): how many minutes the payer has to answer a fee a Shipper proposed. SYSTEM changes it, an ADMIN reads it.
// The value lives in app.order_parameters and is read from the database on every use (no cache, no default in code): a change applies to the counter-offers made
// AFTER it and never moves the deadline of one already waiting, because each offer stores its own deadline when it is made.

export const FEE_ANSWER_MINUTES_KEY = 'fee_answer_minutes';
export const ORDER_PARAMETER_KEYS = [FEE_ANSWER_MINUTES_KEY] as const;
export type OrderParameterKey = (typeof ORDER_PARAMETER_KEYS)[number];
/** A whole, positive number of minutes. The upper bound only guards against a typo (one day, like the order timeouts). */
export const FEE_ANSWER_MINUTES_MIN = 1;
export const FEE_ANSWER_MINUTES_MAX = 1440;

export interface OrderParameter {
  readonly key: OrderParameterKey;
  readonly value: number;
  readonly version: number;
  readonly updatedAtMs: number;
  readonly updatedBy: string | null;
}

export interface OrderParameterChange {
  readonly changeId: string;
  readonly key: OrderParameterKey;
  readonly oldValue: number;
  readonly newValue: number;
  readonly changedBy: string;
  readonly changedAtMs: number;
}

interface RawParameter {
  param_key: OrderParameterKey;
  int_value: string;
  version: string;
  updated_ms: string;
  updated_by: string | null;
}

const COLUMNS = `param_key, int_value::text AS int_value, version::text AS version, (extract(epoch FROM updated_at) * 1000)::bigint::text AS updated_ms, updated_by::text AS updated_by`;

const toParameter = (row: RawParameter): OrderParameter => ({
  key: row.param_key,
  value: toSafeInteger(row.int_value),
  version: toSafeInteger(row.version),
  updatedAtMs: toSafeInteger(row.updated_ms),
  updatedBy: row.updated_by,
});

/** SQL for app.order_parameters and its change log. */
@Injectable()
export class OrderParametersRepository {
  async readAll(context: TransactionContext): Promise<OrderParameter[]> {
    const result = await context.query<RawParameter>(`SELECT ${COLUMNS} FROM app.order_parameters ORDER BY param_key`);
    return result.rows.map(toParameter);
  }

  async lockAll(context: TransactionContext): Promise<OrderParameter[]> {
    const result = await context.query<RawParameter>(`SELECT ${COLUMNS} FROM app.order_parameters ORDER BY param_key FOR UPDATE`);
    return result.rows.map(toParameter);
  }

  async write(context: TransactionContext, key: OrderParameterKey, value: number, actorUserId: string): Promise<void> {
    await context.query(
      `UPDATE app.order_parameters
          SET int_value = $2::bigint, version = version + 1, updated_by = $3::uuid, updated_at = date_trunc('milliseconds', clock_timestamp())
        WHERE param_key = $1`,
      [key, value, actorUserId],
    );
  }

  async appendChange(
    context: TransactionContext,
    input: { changeId: string; key: OrderParameterKey; oldValue: number; newValue: number; actorUserId: string; requestId: string | undefined },
  ): Promise<void> {
    await context.query(
      `INSERT INTO app.order_parameter_changes (change_id, param_key, old_value, new_value, changed_by, changed_at, request_id)
       VALUES ($1::uuid, $2, $3::bigint, $4::bigint, $5::uuid, date_trunc('milliseconds', clock_timestamp()), $6::uuid)`,
      [input.changeId, input.key, input.oldValue, input.newValue, input.actorUserId, input.requestId ?? null],
    );
  }

  /** Newest first. */
  async recentChanges(context: TransactionContext, limit: number): Promise<OrderParameterChange[]> {
    const result = await context.query<{ change_id: string; param_key: OrderParameterKey; old_value: string; new_value: string; changed_by: string; changed_ms: string }>(
      `SELECT change_id::text AS change_id, param_key, old_value::text AS old_value, new_value::text AS new_value, changed_by::text AS changed_by,
              (extract(epoch FROM changed_at) * 1000)::bigint::text AS changed_ms
         FROM app.order_parameter_changes ORDER BY changed_at DESC, change_id LIMIT $1::int`,
      [limit],
    );
    return result.rows.map((row) => ({
      changeId: row.change_id,
      key: row.param_key,
      oldValue: toSafeInteger(row.old_value),
      newValue: toSafeInteger(row.new_value),
      changedBy: row.changed_by,
      changedAtMs: toSafeInteger(row.changed_ms),
    }));
  }
}

/** The in-process API of the agreement: the minutes configured NOW, read inside the transaction that makes the counter-offer. A missing row is a broken installation. */
@Injectable()
export class FeeAnswerParameterReader {
  constructor(private readonly parameters: OrderParametersRepository) {}

  async minutes(context: TransactionContext): Promise<number> {
    const row = (await this.parameters.readAll(context)).find((parameter) => parameter.key === FEE_ANSWER_MINUTES_KEY);
    if (row === undefined) {
      throw new TechnicalError('internal', 'The fee answer time parameter is missing');
    }
    return row.value;
  }
}
