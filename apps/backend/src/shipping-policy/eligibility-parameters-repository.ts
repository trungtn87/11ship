import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { toSafeInteger } from '../driver/driver-db';
import { TransactionContext } from '../transaction/transaction-context';

export interface EligibilityValues {
  readonly externalMaxDeliveries: number;
  readonly batchMaxDelaySeconds: number;
  readonly pickupServiceSeconds: number;
  readonly handoffServiceSeconds: number;
}

export interface EligibilityParameters extends EligibilityValues {
  readonly version: number;
  readonly updatedBy: string | null;
  readonly updatedAtMs: number;
}

export interface EligibilityChange {
  readonly versionAfter: number;
  readonly oldValues: EligibilityValues;
  readonly newValues: EligibilityValues;
  readonly changedBy: string;
  readonly changedAtMs: number;
}

interface Raw {
  external_max_deliveries: number;
  batch_max_delay_seconds: number;
  pickup_service_seconds: number;
  handoff_service_seconds: number;
  version: string;
  updated_by: string | null;
  updated_ms: string;
}

const COLUMNS = `external_max_deliveries, batch_max_delay_seconds, pickup_service_seconds, handoff_service_seconds, version::text AS version,
  updated_by::text AS updated_by, (extract(epoch FROM updated_at) * 1000)::bigint::text AS updated_ms`;

const toParameters = (row: Raw): EligibilityParameters => ({
  externalMaxDeliveries: row.external_max_deliveries,
  batchMaxDelaySeconds: row.batch_max_delay_seconds,
  pickupServiceSeconds: row.pickup_service_seconds,
  handoffServiceSeconds: row.handoff_service_seconds,
  version: toSafeInteger(row.version),
  updatedBy: row.updated_by,
  updatedAtMs: toSafeInteger(row.updated_ms),
});

export const valuesJson = (v: EligibilityValues): string =>
  JSON.stringify({ external_max_deliveries: v.externalMaxDeliveries, batch_max_delay_seconds: v.batchMaxDelaySeconds, pickup_service_seconds: v.pickupServiceSeconds, handoff_service_seconds: v.handoffServiceSeconds });

function fromJson(json: Record<string, unknown>): EligibilityValues {
  return {
    externalMaxDeliveries: toSafeInteger(json.external_max_deliveries),
    batchMaxDelaySeconds: toSafeInteger(json.batch_max_delay_seconds),
    pickupServiceSeconds: toSafeInteger(json.pickup_service_seconds),
    handoffServiceSeconds: toSafeInteger(json.handoff_service_seconds),
  };
}

/** SQL for the M06-B/C eligibility parameters (one seeded row) and their change log. Values are read from the database on every use. */
@Injectable()
export class EligibilityParametersRepository {
  async read(context: TransactionContext): Promise<EligibilityParameters> {
    const result = await context.query<Raw>(`SELECT ${COLUMNS} FROM app.shipping_eligibility_parameters`);
    return toParameters(this.#one(result.rows[0]));
  }

  async lock(context: TransactionContext): Promise<EligibilityParameters> {
    const result = await context.query<Raw>(`SELECT ${COLUMNS} FROM app.shipping_eligibility_parameters FOR UPDATE`);
    return toParameters(this.#one(result.rows[0]));
  }

  async write(context: TransactionContext, values: EligibilityValues, actorUserId: string): Promise<void> {
    await context.query(
      `UPDATE app.shipping_eligibility_parameters
          SET external_max_deliveries = $1::int, batch_max_delay_seconds = $2::int, pickup_service_seconds = $3::int, handoff_service_seconds = $4::int,
              version = version + 1, updated_by = $5::uuid, updated_at = date_trunc('milliseconds', clock_timestamp())`,
      [values.externalMaxDeliveries, values.batchMaxDelaySeconds, values.pickupServiceSeconds, values.handoffServiceSeconds, actorUserId],
    );
  }

  async appendChange(context: TransactionContext, input: { changeId: string; versionAfter: number; oldValues: EligibilityValues; newValues: EligibilityValues; actorUserId: string; requestId: string | undefined }): Promise<void> {
    await context.query(
      `INSERT INTO app.shipping_eligibility_parameter_changes (change_id, version_after, old_values, new_values, changed_by, changed_at, request_id)
       VALUES ($1::uuid, $2::bigint, $3::jsonb, $4::jsonb, $5::uuid, date_trunc('milliseconds', clock_timestamp()), $6::uuid)`,
      [input.changeId, input.versionAfter, valuesJson(input.oldValues), valuesJson(input.newValues), input.actorUserId, input.requestId ?? null],
    );
  }

  /** Newest first. */
  async recentChanges(context: TransactionContext, limit: number): Promise<EligibilityChange[]> {
    const result = await context.query<{ version_after: string; old_values: Record<string, unknown>; new_values: Record<string, unknown>; changed_by: string; changed_ms: string }>(
      `SELECT version_after::text AS version_after, old_values, new_values, changed_by::text AS changed_by, (extract(epoch FROM changed_at) * 1000)::bigint::text AS changed_ms
         FROM app.shipping_eligibility_parameter_changes ORDER BY version_after DESC LIMIT $1::int`,
      [limit],
    );
    return result.rows.map((row) => ({ versionAfter: toSafeInteger(row.version_after), oldValues: fromJson(row.old_values), newValues: fromJson(row.new_values), changedBy: row.changed_by, changedAtMs: toSafeInteger(row.changed_ms) }));
  }

  #one(row: Raw | undefined): Raw {
    if (row === undefined) {
      throw new TechnicalError('internal', 'Shipping eligibility parameters are missing');
    }
    return row;
  }
}
