import { Injectable } from '@nestjs/common';
import { epochMs, toSafeInteger } from '../auth/auth-db';
import { TransactionContext } from '../transaction/transaction-context';
import { SmsJobStatus, SmsPurpose } from './sms-gateway-constants';

// Read-only view of the SMS gateway tables for M13 monitoring (the owner of these tables stays the gateway module). It reads what the phone and the queue
// already recorded: it changes no job, creates no OTP, sends nothing and never opens the sealed payload; a recipient is returned masked (last three digits).

export interface GatewayDeviceSnapshot {
  readonly deviceId: string;
  readonly label: string;
  readonly createdAtMs: number;
  readonly lastSeenAtMs: number | null;
  readonly appVersion: string | null;
  readonly smsPermission: boolean | null;
  readonly paused: boolean | null;
}

export interface OtpQueueJob {
  readonly jobId: string;
  readonly purpose: SmsPurpose;
  readonly status: SmsJobStatus;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly claimedAtMs: number | null;
  readonly finishedAtMs: number | null;
  readonly resultCode: string | null;
  readonly phoneTail: string;
  readonly claimedBy: string | null;
}

export interface OtpQueueSummary {
  readonly queued: number;
  readonly claimed: number;
  readonly failedLastHour: number;
  /** The oldest job that is still QUEUED and whose OTP has not expired yet (how long a valid OTP has been waiting); null when none waits. */
  readonly oldestValidQueuedAtMs: number | null;
}

@Injectable()
export class SmsGatewayOpsReader {
  async devices(context: TransactionContext): Promise<GatewayDeviceSnapshot[]> {
    const result = await context.query<{ device_id: string; label: string; created_ms: string; seen_ms: string | null; app_version: string | null; sms_permission: boolean | null; paused: boolean | null }>(
      `SELECT device_id, label, ${epochMs('created_at')} AS created_ms, CASE WHEN last_seen_at IS NULL THEN NULL ELSE ${epochMs('last_seen_at')} END AS seen_ms, app_version, sms_permission, paused
         FROM app.sms_gateway_devices WHERE status = 'ACTIVE' ORDER BY created_at`,
    );
    return result.rows.map((r) => ({
      deviceId: r.device_id,
      label: r.label,
      createdAtMs: toSafeInteger(r.created_ms),
      lastSeenAtMs: r.seen_ms === null ? null : toSafeInteger(r.seen_ms),
      appVersion: r.app_version,
      smsPermission: r.sms_permission,
      paused: r.paused,
    }));
  }

  async summary(context: TransactionContext): Promise<OtpQueueSummary> {
    const result = await context.query<{ queued: string; claimed: string; failed: string; oldest_ms: string | null }>(
      `SELECT count(*) FILTER (WHERE status = 'QUEUED')::text AS queued, count(*) FILTER (WHERE status = 'CLAIMED')::text AS claimed,
              count(*) FILTER (WHERE status = 'FAILED' AND finished_at > clock_timestamp() - interval '1 hour')::text AS failed,
              CASE WHEN min(created_at) FILTER (WHERE status = 'QUEUED' AND expires_at > clock_timestamp()) IS NULL THEN NULL
                   ELSE ${epochMs("min(created_at) FILTER (WHERE status = 'QUEUED' AND expires_at > clock_timestamp())")} END AS oldest_ms
         FROM app.sms_jobs WHERE status IN ('QUEUED', 'CLAIMED') OR finished_at > clock_timestamp() - interval '1 hour'`,
    );
    const r = result.rows[0];
    return {
      queued: toSafeInteger(r?.queued ?? '0'),
      claimed: toSafeInteger(r?.claimed ?? '0'),
      failedLastHour: toSafeInteger(r?.failed ?? '0'),
      oldestValidQueuedAtMs: r === undefined || r.oldest_ms === null ? null : toSafeInteger(r.oldest_ms),
    };
  }

  /** Whether this phone holds a job it has not reported yet (it must not update, or be told to, while it does). */
  async hasClaimedJob(context: TransactionContext, deviceId: string): Promise<boolean> {
    const result = await context.query(`SELECT 1 FROM app.sms_jobs WHERE claimed_by = $1::uuid AND status = 'CLAIMED' LIMIT 1`, [deviceId]);
    return (result.rowCount ?? 0) > 0;
  }

  /** The latest final results of a device, newest first (only FAILED counts as a failure; UNKNOWN is not known to have failed). */
  async recentResults(context: TransactionContext, deviceId: string, limit: number): Promise<{ status: SmsJobStatus; finishedAtMs: number }[]> {
    const result = await context.query<{ status: SmsJobStatus; finished_ms: string }>(
      `SELECT status, ${epochMs('finished_at')} AS finished_ms FROM app.sms_jobs WHERE claimed_by = $1::uuid AND status IN ('SENT', 'FAILED', 'UNKNOWN') AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT $2`,
      [deviceId, limit],
    );
    return result.rows.map((r) => ({ status: r.status, finishedAtMs: toSafeInteger(r.finished_ms) }));
  }

  /** The newest jobs for the Administration queue table. The recipient is the last three digits only; the sealed payload is never selected. */
  async recentJobs(context: TransactionContext, limit: number): Promise<OtpQueueJob[]> {
    const result = await context.query<{
      job_id: string;
      purpose: SmsPurpose;
      status: SmsJobStatus;
      created_ms: string;
      expires_ms: string;
      claimed_ms: string | null;
      finished_ms: string | null;
      result_code: string | null;
      phone_tail: string;
      claimed_by: string | null;
    }>(
      `SELECT job_id, purpose, status, ${epochMs('created_at')} AS created_ms, ${epochMs('expires_at')} AS expires_ms,
              CASE WHEN claimed_at IS NULL THEN NULL ELSE ${epochMs('claimed_at')} END AS claimed_ms, CASE WHEN finished_at IS NULL THEN NULL ELSE ${epochMs('finished_at')} END AS finished_ms,
              result_code, right(phone_normalized, 3) AS phone_tail, claimed_by
         FROM app.sms_jobs ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return result.rows.map((r) => ({
      jobId: r.job_id,
      purpose: r.purpose,
      status: r.status,
      createdAtMs: toSafeInteger(r.created_ms),
      expiresAtMs: toSafeInteger(r.expires_ms),
      claimedAtMs: r.claimed_ms === null ? null : toSafeInteger(r.claimed_ms),
      finishedAtMs: r.finished_ms === null ? null : toSafeInteger(r.finished_ms),
      resultCode: r.result_code,
      phoneTail: r.phone_tail,
      claimedBy: r.claimed_by,
    }));
  }
}
