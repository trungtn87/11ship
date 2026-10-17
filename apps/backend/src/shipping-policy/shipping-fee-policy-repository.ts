import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { toSafeInteger } from '../driver/driver-db';
import { TransactionContext } from '../transaction/transaction-context';
import { FeePolicy } from './shipping-fee-policy';

export interface PolicyVersion {
  readonly versionId: string;
  readonly versionNo: number;
  readonly policy: FeePolicy;
  readonly note: string | null;
  readonly appliedBy: string;
  readonly appliedAtMs: number;
}

export interface PolicyDraft {
  readonly version: number;
  /** Null while the draft is empty (nothing saved since the last "apply"). */
  readonly policy: FeePolicy | null;
  readonly updatedBy: string | null;
  readonly updatedAtMs: number;
}

interface RawTier {
  from_m: number;
  to_m: number;
  fee_vnd: number;
}

interface RawVersion {
  version_id: string;
  version_no: string;
  tiers: RawTier[];
  tail_base_fee_vnd: string;
  tail_step_m: string;
  tail_step_fee_vnd: string;
  note: string | null;
  applied_by: string;
  applied_ms: string;
}

interface RawDraft {
  version: string;
  tiers: RawTier[] | null;
  tail_base_fee_vnd: string | null;
  tail_step_m: string | null;
  tail_step_fee_vnd: string | null;
  updated_by: string | null;
  updated_ms: string;
}

const VERSION_COLUMNS = `version_id::text AS version_id, version_no::text AS version_no, tiers, tail_base_fee_vnd::text AS tail_base_fee_vnd,
  tail_step_m::text AS tail_step_m, tail_step_fee_vnd::text AS tail_step_fee_vnd, note, applied_by::text AS applied_by,
  (extract(epoch FROM applied_at) * 1000)::bigint::text AS applied_ms`;

const toTiers = (tiers: readonly RawTier[]): FeePolicy['tiers'] => tiers.map((t) => ({ fromM: toSafeInteger(t.from_m), toM: toSafeInteger(t.to_m), feeVnd: toSafeInteger(t.fee_vnd) }));
const tiersJson = (policy: FeePolicy): string => JSON.stringify(policy.tiers.map((t) => ({ from_m: t.fromM, to_m: t.toM, fee_vnd: t.feeVnd })));

function toVersion(row: RawVersion): PolicyVersion {
  return {
    versionId: row.version_id,
    versionNo: toSafeInteger(row.version_no),
    policy: {
      tiers: toTiers(row.tiers),
      tail: { baseFeeVnd: toSafeInteger(row.tail_base_fee_vnd), stepM: toSafeInteger(row.tail_step_m), stepFeeVnd: toSafeInteger(row.tail_step_fee_vnd) },
    },
    note: row.note,
    appliedBy: row.applied_by,
    appliedAtMs: toSafeInteger(row.applied_ms),
  };
}

function toDraft(row: RawDraft): PolicyDraft {
  const policy: FeePolicy | null =
    row.tiers === null || row.tail_base_fee_vnd === null || row.tail_step_m === null || row.tail_step_fee_vnd === null
      ? null
      : { tiers: toTiers(row.tiers), tail: { baseFeeVnd: toSafeInteger(row.tail_base_fee_vnd), stepM: toSafeInteger(row.tail_step_m), stepFeeVnd: toSafeInteger(row.tail_step_fee_vnd) } };
  return { version: toSafeInteger(row.version), policy, updatedBy: row.updated_by, updatedAtMs: toSafeInteger(row.updated_ms) };
}

const DRAFT_COLUMNS = `version::text AS version, tiers, tail_base_fee_vnd::text AS tail_base_fee_vnd, tail_step_m::text AS tail_step_m,
  tail_step_fee_vnd::text AS tail_step_fee_vnd, updated_by::text AS updated_by, (extract(epoch FROM updated_at) * 1000)::bigint::text AS updated_ms`;

/** SQL for the M06-A fee policy tables. The policy in force is the version with the highest number. */
@Injectable()
export class ShippingFeePolicyRepository {
  /** The policy in force, or undefined when no version was ever applied (then nothing can be priced). */
  async active(context: TransactionContext): Promise<PolicyVersion | undefined> {
    const result = await context.query<RawVersion>(`SELECT ${VERSION_COLUMNS} FROM app.shipping_fee_policy_versions ORDER BY version_no DESC LIMIT 1`);
    return result.rows[0] === undefined ? undefined : toVersion(result.rows[0]);
  }

  /** Newest first. */
  async history(context: TransactionContext, limit: number): Promise<PolicyVersion[]> {
    const result = await context.query<RawVersion>(`SELECT ${VERSION_COLUMNS} FROM app.shipping_fee_policy_versions ORDER BY version_no DESC LIMIT $1::int`, [limit]);
    return result.rows.map(toVersion);
  }

  async readDraft(context: TransactionContext): Promise<PolicyDraft> {
    const result = await context.query<RawDraft>(`SELECT ${DRAFT_COLUMNS} FROM app.shipping_fee_policy_drafts`);
    return toDraft(requireRow(result.rows[0]));
  }

  async lockDraft(context: TransactionContext): Promise<PolicyDraft> {
    const result = await context.query<RawDraft>(`SELECT ${DRAFT_COLUMNS} FROM app.shipping_fee_policy_drafts FOR UPDATE`);
    return toDraft(requireRow(result.rows[0]));
  }

  /** Writes (or, with null, empties) the draft and advances its version by one. The draft row must be locked by the caller. */
  async writeDraft(context: TransactionContext, policy: FeePolicy | null, actorUserId: string): Promise<void> {
    await context.query(
      `UPDATE app.shipping_fee_policy_drafts
          SET version = version + 1, tiers = $1::jsonb, tail_base_fee_vnd = $2::bigint, tail_step_m = $3::bigint, tail_step_fee_vnd = $4::bigint,
              updated_by = $5::uuid, updated_at = date_trunc('milliseconds', clock_timestamp())`,
      [
        policy === null ? null : tiersJson(policy),
        policy?.tail.baseFeeVnd ?? null,
        policy?.tail.stepM ?? null,
        policy?.tail.stepFeeVnd ?? null,
        actorUserId,
      ],
    );
  }

  /** Appends the next version. The draft row must be locked: that lock serializes every apply, so numbers have no gap. */
  async insertVersion(context: TransactionContext, input: { versionId: string; policy: FeePolicy; note: string | null; actorUserId: string; requestId: string | undefined }): Promise<PolicyVersion> {
    const result = await context.query<RawVersion>(
      `INSERT INTO app.shipping_fee_policy_versions (version_id, version_no, tiers, tail_base_fee_vnd, tail_step_m, tail_step_fee_vnd, note, applied_by, applied_at, request_id)
       VALUES ($1::uuid, (SELECT COALESCE(MAX(version_no), 0) + 1 FROM app.shipping_fee_policy_versions), $2::jsonb, $3::bigint, $4::bigint, $5::bigint, $6, $7::uuid,
               date_trunc('milliseconds', clock_timestamp()), $8::uuid)
       RETURNING ${VERSION_COLUMNS}`,
      [input.versionId, tiersJson(input.policy), input.policy.tail.baseFeeVnd, input.policy.tail.stepM, input.policy.tail.stepFeeVnd, input.note, input.actorUserId, input.requestId ?? null],
    );
    return toVersion(requireRow(result.rows[0]));
  }
}

function requireRow<T>(row: T | undefined): T {
  if (row === undefined) {
    throw new TechnicalError('internal', 'Shipping fee policy tables are not in the expected state');
  }
  return row;
}

/**
 * The in-process API other modules (M06-B/D quote, M07) use: the policy in force, read from the database on every call (no cache), inside
 * the transaction that prices the order. A change reaches the NEXT quote only; a quote already stored keeps its own snapshot.
 */
@Injectable()
export class ShippingFeePolicyReader {
  constructor(private readonly policies: ShippingFeePolicyRepository) {}

  async active(context: TransactionContext): Promise<{ versionNo: number; policy: FeePolicy } | null> {
    const version = await this.policies.active(context);
    return version === undefined ? null : { versionNo: version.versionNo, policy: version.policy };
  }
}
