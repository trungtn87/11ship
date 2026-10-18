import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { toSafeInteger } from './driver-db';

// Shipper wallet parameters (M03 setting, read by M04). Minimum top-up and withdrawal per request in whole VND. The values live in
// app.shipper_wallet_parameters; this module never carries a default of its own.

export const WALLET_PARAMETER_KEYS = ['topup_min_vnd', 'withdraw_min_vnd'] as const;
export type WalletParameterKey = (typeof WALLET_PARAMETER_KEYS)[number];
export const WALLET_PARAMETER_MAX_VND = 1_000_000_000;

export interface WalletParameter {
  readonly key: WalletParameterKey;
  readonly valueVnd: number;
  readonly version: number;
  readonly updatedAtMs: number;
  readonly updatedBy: string | null;
}

export interface WalletParameterChange {
  readonly changeId: string;
  readonly key: WalletParameterKey;
  readonly oldValue: number;
  readonly newValue: number;
  readonly changedBy: string;
  readonly changedAtMs: number;
}

interface RawParameter {
  param_key: WalletParameterKey;
  int_value: string;
  version: string;
  updated_ms: string;
  updated_by: string | null;
}

const COLUMNS = `param_key, int_value::text AS int_value, version::text AS version, (extract(epoch FROM updated_at) * 1000)::bigint::text AS updated_ms, updated_by::text AS updated_by`;

function toParameter(row: RawParameter): WalletParameter {
  return { key: row.param_key, valueVnd: toSafeInteger(row.int_value), version: toSafeInteger(row.version), updatedAtMs: toSafeInteger(row.updated_ms), updatedBy: row.updated_by };
}

/** SQL for app.shipper_wallet_parameters and its change log. Exported to M04 through the Driver module. */
@Injectable()
export class ShipperWalletParametersRepository {
  /** Both parameters in key order. A missing row is a broken installation, never a guess. */
  async readAll(context: TransactionContext): Promise<WalletParameter[]> {
    const result = await context.query<RawParameter>(`SELECT ${COLUMNS} FROM app.shipper_wallet_parameters ORDER BY param_key`);
    return result.rows.map(toParameter);
  }

  async lockAll(context: TransactionContext): Promise<WalletParameter[]> {
    const result = await context.query<RawParameter>(`SELECT ${COLUMNS} FROM app.shipper_wallet_parameters ORDER BY param_key FOR UPDATE`);
    return result.rows.map(toParameter);
  }

  async write(context: TransactionContext, key: WalletParameterKey, valueVnd: number, actorUserId: string): Promise<void> {
    await context.query(
      `UPDATE app.shipper_wallet_parameters
          SET int_value = $2::bigint, version = version + 1, updated_by = $3::uuid, updated_at = date_trunc('milliseconds', clock_timestamp())
        WHERE param_key = $1`,
      [key, valueVnd, actorUserId],
    );
  }

  async appendChange(
    context: TransactionContext,
    input: { changeId: string; key: WalletParameterKey; oldValue: number; newValue: number; actorUserId: string; requestId: string | undefined },
  ): Promise<void> {
    await context.query(
      `INSERT INTO app.shipper_wallet_parameter_changes (change_id, param_key, old_value, new_value, changed_by, changed_at, request_id)
       VALUES ($1::uuid, $2, $3::bigint, $4::bigint, $5::uuid, date_trunc('milliseconds', clock_timestamp()), $6::uuid)`,
      [input.changeId, input.key, input.oldValue, input.newValue, input.actorUserId, input.requestId ?? null],
    );
  }

  /** Newest first. */
  async recentChanges(context: TransactionContext, limit: number): Promise<WalletParameterChange[]> {
    const result = await context.query<{
      change_id: string;
      param_key: WalletParameterKey;
      old_value: string;
      new_value: string;
      changed_by: string;
      changed_ms: string;
    }>(
      `SELECT change_id::text AS change_id, param_key, old_value::text AS old_value, new_value::text AS new_value, changed_by::text AS changed_by,
              (extract(epoch FROM changed_at) * 1000)::bigint::text AS changed_ms
         FROM app.shipper_wallet_parameter_changes ORDER BY changed_at DESC, change_id LIMIT $1::int`,
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

/** The amounts M04 (and the Shipper app, as a hint) use for NEW requests. */
export interface ShipperWalletLimits {
  readonly topupMinVnd: number;
  readonly withdrawMinVnd: number;
}

/**
 * The in-process API M04 uses: the current minimum top-up and withdrawal, read from the database on every call (no cache, so a change
 * is in force for the next request). Call it inside the transaction that validates the request.
 */
@Injectable()
export class ShipperWalletParametersReader {
  constructor(private readonly parameters: ShipperWalletParametersRepository) {}

  async limits(context: TransactionContext): Promise<ShipperWalletLimits> {
    const rows = await this.parameters.readAll(context);
    const top = rows.find((row) => row.key === 'topup_min_vnd');
    const withdraw = rows.find((row) => row.key === 'withdraw_min_vnd');
    if (top === undefined || withdraw === undefined) {
      throw new TechnicalError('internal', 'Shipper wallet parameters are missing');
    }
    return { topupMinVnd: top.valueVnd, withdrawMinVnd: withdraw.valueVnd };
  }
}
