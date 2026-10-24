import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { LockKey } from '../shared/lock-key';
import { TransactionContext } from '../transaction/transaction-context';
import { epochMs, toSafeInteger } from './auth-db';

/** The six SYSTEM-configurable SMS OTP limits (issue #117). Keys are the API names; bounds mirror the CHECKs of app.otp_policy. */
export const OTP_POLICY_KEYS = ['cooldown_seconds', 'max_wrong_attempts', 'phone_per_hour', 'phone_per_day', 'ip_per_hour', 'global_per_day'] as const;
export type OtpPolicyKey = (typeof OTP_POLICY_KEYS)[number];
export type OtpPolicyValues = Readonly<Record<OtpPolicyKey, number>>;

export const OTP_POLICY_BOUNDS: Readonly<Record<OtpPolicyKey, { readonly min: number; readonly max: number; readonly default: number }>> = Object.freeze({
  cooldown_seconds: { min: 10, max: 600, default: 60 },
  max_wrong_attempts: { min: 1, max: 10, default: 3 },
  phone_per_hour: { min: 1, max: 20, default: 3 },
  phone_per_day: { min: 1, max: 100, default: 5 },
  ip_per_hour: { min: 1, max: 1000, default: 10 },
  global_per_day: { min: 1, max: 10_000, default: 30 },
});

export interface OtpPolicy {
  readonly values: OtpPolicyValues;
  readonly version: number;
  readonly updatedAtMs: number;
  readonly updatedBy: string | null;
}

export interface OtpPolicyChange {
  readonly changeId: string;
  readonly version: number;
  readonly oldValues: OtpPolicyValues;
  readonly newValues: OtpPolicyValues;
  readonly reason: string | null;
  readonly changedBy: string;
  readonly changedAtMs: number;
}

interface RawPolicy {
  cooldown_seconds: number;
  max_wrong_attempts: number;
  phone_per_hour: number;
  phone_per_day: number;
  ip_per_hour: number;
  global_per_day: number;
  version: string;
  updated_ms: string;
  updated_by: string | null;
}

function toPolicy(row: RawPolicy): OtpPolicy {
  return {
    values: {
      cooldown_seconds: row.cooldown_seconds,
      max_wrong_attempts: row.max_wrong_attempts,
      phone_per_hour: row.phone_per_hour,
      phone_per_day: row.phone_per_day,
      ip_per_hour: row.ip_per_hour,
      global_per_day: row.global_per_day,
    },
    version: toSafeInteger(row.version),
    updatedAtMs: toSafeInteger(row.updated_ms),
    updatedBy: row.updated_by,
  };
}

function valuesOf(raw: unknown): OtpPolicyValues {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const out: Partial<Record<OtpPolicyKey, number>> = {};
  for (const key of OTP_POLICY_KEYS) {
    const value = source[key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
      throw new TechnicalError('internal', 'OTP policy history is malformed');
    }
    out[key] = value;
  }
  return out as OtpPolicyValues;
}

/** SQL for app.otp_policy, its history and the per-IP counter app.otp_ip_requests. Nothing else touches them. */
@Injectable()
export class OtpPolicyRepository {
  /** The current limits. A missing row is a broken installation, never a guess (the request is refused with a 5xx). */
  async read(context: TransactionContext): Promise<OtpPolicy> {
    const result = await context.query<RawPolicy>(
      `SELECT cooldown_seconds, max_wrong_attempts, phone_per_hour, phone_per_day, ip_per_hour, global_per_day, version::text AS version,
              ${epochMs('updated_at')}::text AS updated_ms, updated_by::text AS updated_by
         FROM app.otp_policy WHERE policy_id = 1`,
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new TechnicalError('internal', 'OTP policy is missing');
    }
    return toPolicy(row);
  }

  async lock(context: TransactionContext): Promise<OtpPolicy> {
    const result = await context.query<RawPolicy>(
      `SELECT cooldown_seconds, max_wrong_attempts, phone_per_hour, phone_per_day, ip_per_hour, global_per_day, version::text AS version,
              ${epochMs('updated_at')}::text AS updated_ms, updated_by::text AS updated_by
         FROM app.otp_policy WHERE policy_id = 1 FOR UPDATE`,
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new TechnicalError('internal', 'OTP policy is missing');
    }
    return toPolicy(row);
  }

  async write(context: TransactionContext, values: OtpPolicyValues, actorUserId: string): Promise<void> {
    await context.query(
      `UPDATE app.otp_policy
          SET cooldown_seconds = $1::int, max_wrong_attempts = $2::int, phone_per_hour = $3::int, phone_per_day = $4::int,
              ip_per_hour = $5::int, global_per_day = $6::int, version = version + 1, updated_by = $7::uuid,
              updated_at = date_trunc('milliseconds', clock_timestamp())
        WHERE policy_id = 1`,
      [values.cooldown_seconds, values.max_wrong_attempts, values.phone_per_hour, values.phone_per_day, values.ip_per_hour, values.global_per_day, actorUserId],
    );
  }

  async appendChange(
    context: TransactionContext,
    input: { changeId: string; version: number; oldValues: OtpPolicyValues; newValues: OtpPolicyValues; reason: string | null; actorUserId: string; requestId: string | undefined },
  ): Promise<void> {
    await context.query(
      `INSERT INTO app.otp_policy_changes (change_id, version, old_values, new_values, reason, changed_by, changed_at, request_id)
       VALUES ($1::uuid, $2::bigint, $3::jsonb, $4::jsonb, $5, $6::uuid, date_trunc('milliseconds', clock_timestamp()), $7::uuid)`,
      [input.changeId, input.version, JSON.stringify(input.oldValues), JSON.stringify(input.newValues), input.reason, input.actorUserId, input.requestId ?? null],
    );
  }

  /** Newest first. */
  async recentChanges(context: TransactionContext, limit: number): Promise<OtpPolicyChange[]> {
    const result = await context.query<{
      change_id: string;
      version: string;
      old_values: unknown;
      new_values: unknown;
      reason: string | null;
      changed_by: string;
      changed_ms: string;
    }>(
      `SELECT change_id::text AS change_id, version::text AS version, old_values, new_values, reason, changed_by::text AS changed_by,
              ${epochMs('changed_at')}::text AS changed_ms
         FROM app.otp_policy_changes ORDER BY changed_at DESC, change_id LIMIT $1::int`,
      [limit],
    );
    return result.rows.map((row) => ({
      changeId: row.change_id,
      version: toSafeInteger(row.version),
      oldValues: valuesOf(row.old_values),
      newValues: valuesOf(row.new_values),
      reason: row.reason,
      changedBy: row.changed_by,
      changedAtMs: toSafeInteger(row.changed_ms),
    }));
  }

  // --- per-IP counter -----------------------------------------------------------------------------------------------

  /** Serializes the check-then-insert of one IP identity until the transaction ends (always taken AFTER the phone lock). */
  async lockIp(context: TransactionContext, key: LockKey): Promise<void> {
    await context.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [key[0], key[1]]);
  }

  async countIpSince(context: TransactionContext, ipHmac: string, windowSeconds: number): Promise<number> {
    const result = await context.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM app.otp_ip_requests
        WHERE ip_hmac = $1 AND created_at > clock_timestamp() - make_interval(secs => $2::double precision)`,
      [ipHmac, windowSeconds],
    );
    return toSafeInteger(result.rows[0]?.n ?? '0');
  }

  /** Seconds until enough rows leave the window for one more request to fit (>= 1). */
  async ipRetryAfter(context: TransactionContext, ipHmac: string, windowSeconds: number, count: number, limit: number): Promise<number> {
    const result = await context.query<{ seconds: string | null }>(
      `SELECT ceil(extract(epoch FROM (created_at + make_interval(secs => $2::double precision) - clock_timestamp())))::text AS seconds
         FROM app.otp_ip_requests
        WHERE ip_hmac = $1 AND created_at > clock_timestamp() - make_interval(secs => $2::double precision)
        ORDER BY created_at ASC OFFSET $3::int LIMIT 1`,
      [ipHmac, windowSeconds, Math.max(0, count - limit)],
    );
    const seconds = Number(result.rows[0]?.seconds ?? '1');
    return Number.isSafeInteger(seconds) && seconds >= 1 ? seconds : 1;
  }

  async insertIpRequest(context: TransactionContext, requestId: string, ipHmac: string): Promise<void> {
    await context.query(
      `INSERT INTO app.otp_ip_requests (request_id, ip_hmac, created_at)
       VALUES ($1::uuid, $2, date_trunc('milliseconds', clock_timestamp()))`,
      [requestId, ipHmac],
    );
  }

  /** Housekeeping done by the requests themselves: a bounded batch of rows older than the longest window (1 hour) plus a margin. */
  async pruneIpRequests(context: TransactionContext): Promise<void> {
    await context.query(
      `DELETE FROM app.otp_ip_requests
        WHERE request_id IN (
          SELECT request_id FROM app.otp_ip_requests WHERE created_at < clock_timestamp() - interval '3 hours' ORDER BY created_at LIMIT 100
        )`,
    );
  }
}
