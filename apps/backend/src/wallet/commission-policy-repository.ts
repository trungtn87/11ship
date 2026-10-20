import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';

// SQL of app.wallet_commission_policies (M04-C): the commission per successful delivery, as append-only versions. The CURRENT policy is the highest version.
// An assignment snapshots {amount, label} when it is accepted (M07), so reading the current policy here never changes a hold, a capture or a release that already exists.

export interface CommissionPolicy {
  readonly version: number;
  readonly amountVnd: bigint;
  /** The label snapshotted on an assignment: COMMISSION_V<version> (version 1 is the COMMISSION_V1 M07 has always used). */
  readonly label: string;
  readonly createdAtMs: number;
  readonly createdByUserId: string | null;
}

export const COMMISSION_POLICY_MAX_VND = 1_000_000_000;

interface Raw {
  policy_version: string;
  commission_vnd: string;
  created_ms: string;
  created_by_user_id: string | null;
}

const COLUMNS = `p.policy_version::text AS policy_version, p.commission_vnd::text AS commission_vnd, (extract(epoch FROM p.created_at) * 1000)::bigint::text AS created_ms,
  p.created_by_user_id::text AS created_by_user_id`;

function toPolicy(row: Raw): CommissionPolicy {
  if (!/^[0-9]{1,9}$/.test(row.policy_version) || !/^[0-9]{1,10}$/.test(row.commission_vnd) || !/^[0-9]{1,16}$/.test(row.created_ms)) {
    throw new TechnicalError('internal', 'Database returned an unexpected commission policy');
  }
  const version = Number(row.policy_version);
  return { version, amountVnd: BigInt(row.commission_vnd), label: `COMMISSION_V${version}`, createdAtMs: Number(row.created_ms), createdByUserId: row.created_by_user_id };
}

@Injectable()
export class CommissionPolicyRepository {
  /** The policy in force now (the highest version). A missing row is a broken installation, never a guess. */
  async current(context: TransactionContext): Promise<CommissionPolicy> {
    const result = await context.query<Raw>(`SELECT ${COLUMNS} FROM app.wallet_commission_policies p ORDER BY p.policy_version DESC LIMIT 1`);
    const row = result.rows[0];
    if (row === undefined) {
      throw new TechnicalError('internal', 'The commission policy is missing');
    }
    return toPolicy(row);
  }

  /** The current policy row, locked FOR UPDATE: the administration serialises a change on it. */
  async lockCurrent(context: TransactionContext): Promise<CommissionPolicy> {
    const result = await context.query<Raw>(`SELECT ${COLUMNS} FROM app.wallet_commission_policies p WHERE p.policy_version = (SELECT MAX(policy_version) FROM app.wallet_commission_policies) FOR UPDATE`);
    const row = result.rows[0];
    if (row === undefined) {
      throw new TechnicalError('internal', 'The commission policy is missing');
    }
    return toPolicy(row);
  }

  async list(context: TransactionContext, limit: number): Promise<CommissionPolicy[]> {
    const result = await context.query<Raw>(`SELECT ${COLUMNS} FROM app.wallet_commission_policies p ORDER BY p.policy_version DESC LIMIT $1::int`, [limit]);
    return result.rows.map(toPolicy);
  }

  /** Appends version `version` (the database refuses anything but last + 1 and any amount outside 1..1.000.000.000). */
  async insertNext(context: TransactionContext, version: number, amountVnd: number, actorUserId: string): Promise<CommissionPolicy> {
    const result = await context.query<Raw>(
      `WITH inserted AS (
         INSERT INTO app.wallet_commission_policies (policy_version, commission_vnd, created_by_user_id, created_at)
         VALUES ($1::int, $2::bigint, $3::uuid, date_trunc('milliseconds', clock_timestamp())) RETURNING *
       ) SELECT ${COLUMNS} FROM inserted p`,
      [version, amountVnd, actorUserId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new TechnicalError('internal', 'The commission policy was not written');
    }
    return toPolicy(row);
  }
}
