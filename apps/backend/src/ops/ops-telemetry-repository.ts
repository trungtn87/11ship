import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';
import { CLOCK, ms, num, numOrNull } from './ops-sql';

// SQL of what the gateway phone reports besides its heartbeat (M13). Kept apart so the SMS gateway module can record it without importing the rest of M13.

export interface TelemetryRow {
  readonly deviceId: string;
  readonly reportedAtMs: number;
  readonly batteryPercent: number | null;
  readonly charging: boolean | null;
  readonly powerChangedAtMs: number | null;
  readonly simState: 'READY' | 'ABSENT' | 'LOCKED' | 'UNKNOWN' | null;
  readonly pendingReports: number | null;
  readonly currentTask: 'IDLE' | 'SENDING' | 'REPORTING' | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorAtMs: number | null;
  readonly topupNotedOn: string | null;
}

export interface TelemetryInput {
  readonly batteryPercent: number | null;
  readonly charging: boolean | null;
  readonly simState: 'READY' | 'ABSENT' | 'LOCKED' | 'UNKNOWN' | null;
  readonly pendingReports: number | null;
  readonly currentTask: 'IDLE' | 'SENDING' | 'REPORTING' | null;
  readonly lastErrorCode: string | null;
}

@Injectable()
export class OpsTelemetryRepository {
  /**
   * Stores what the phone reported. A field the phone did not send keeps its previous value (a null input never erases a known fact), except that a CHANGE of the
   * charging state restarts the unplugged clock: power_changed_at moves only when the reported charging value differs from the stored one.
   */
  async recordTelemetry(context: TransactionContext, deviceId: string, t: TelemetryInput): Promise<void> {
    await context.query(
      `INSERT INTO app.ops_gateway_telemetry (device_id, reported_at, battery_percent, charging, power_changed_at, sim_state, pending_reports, current_task, last_error_code, last_error_at)
       VALUES ($1::uuid, ${CLOCK}, $2, $3, CASE WHEN $3::boolean IS NULL THEN NULL ELSE ${CLOCK} END, $4, $5, $6, $7, CASE WHEN $7::text IS NULL THEN NULL ELSE ${CLOCK} END)
       ON CONFLICT (device_id) DO UPDATE SET
         reported_at = ${CLOCK},
         battery_percent = COALESCE($2, app.ops_gateway_telemetry.battery_percent),
         power_changed_at = CASE WHEN $3::boolean IS NOT NULL AND (app.ops_gateway_telemetry.charging IS DISTINCT FROM $3::boolean) THEN ${CLOCK} ELSE app.ops_gateway_telemetry.power_changed_at END,
         charging = COALESCE($3, app.ops_gateway_telemetry.charging),
         sim_state = COALESCE($4, app.ops_gateway_telemetry.sim_state),
         pending_reports = COALESCE($5, app.ops_gateway_telemetry.pending_reports),
         current_task = COALESCE($6, app.ops_gateway_telemetry.current_task),
         last_error_at = CASE WHEN $7::text IS NOT NULL AND (app.ops_gateway_telemetry.last_error_code IS DISTINCT FROM $7::text OR app.ops_gateway_telemetry.last_error_at IS NULL) THEN ${CLOCK} ELSE app.ops_gateway_telemetry.last_error_at END,
         last_error_code = COALESCE($7, app.ops_gateway_telemetry.last_error_code)`,
      [deviceId, t.batteryPercent, t.charging, t.simState, t.pendingReports, t.currentTask, t.lastErrorCode],
    );
  }

  async listTelemetry(context: TransactionContext): Promise<TelemetryRow[]> {
    const result = await context.query<{
      device_id: string;
      reported_ms: string;
      battery_percent: number | null;
      charging: boolean | null;
      power_ms: string | null;
      sim_state: TelemetryRow['simState'];
      pending_reports: number | null;
      current_task: TelemetryRow['currentTask'];
      last_error_code: string | null;
      error_ms: string | null;
      topup_on: string | null;
    }>(
      `SELECT device_id, ${ms('reported_at', 'reported_ms')}, battery_percent, charging,
              CASE WHEN power_changed_at IS NULL THEN NULL ELSE (extract(epoch FROM power_changed_at) * 1000)::bigint::text END AS power_ms, sim_state, pending_reports, current_task, last_error_code,
              CASE WHEN last_error_at IS NULL THEN NULL ELSE (extract(epoch FROM last_error_at) * 1000)::bigint::text END AS error_ms, to_char(topup_noted_on, 'YYYY-MM-DD') AS topup_on
         FROM app.ops_gateway_telemetry`,
    );
    return result.rows.map((r) => ({
      deviceId: r.device_id,
      reportedAtMs: num(r.reported_ms),
      batteryPercent: r.battery_percent,
      charging: r.charging,
      powerChangedAtMs: numOrNull(r.power_ms),
      simState: r.sim_state,
      pendingReports: r.pending_reports,
      currentTask: r.current_task,
      lastErrorCode: r.last_error_code,
      lastErrorAtMs: numOrNull(r.error_ms),
      topupNotedOn: r.topup_on,
    }));
  }

  /** SYSTEM writes the last SIM top-up date by hand (Android cannot read the balance). Creates the telemetry row if the phone has not reported yet. */
  async setTopupNote(context: TransactionContext, deviceId: string, date: string | null, userId: string): Promise<boolean> {
    const exists = await context.query(`SELECT 1 FROM app.sms_gateway_devices WHERE device_id = $1::uuid`, [deviceId]);
    if (exists.rowCount !== 1) {
      return false;
    }
    await context.query(
      `INSERT INTO app.ops_gateway_telemetry (device_id, reported_at, topup_noted_on, topup_noted_by) VALUES ($1::uuid, ${CLOCK}, $2::date, $3::uuid)
       ON CONFLICT (device_id) DO UPDATE SET topup_noted_on = $2::date, topup_noted_by = $3::uuid`,
      [deviceId, date, userId],
    );
    return true;
  }
}
