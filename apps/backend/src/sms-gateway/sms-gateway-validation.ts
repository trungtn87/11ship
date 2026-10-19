import { BadRequestException } from '@nestjs/common';
import { isCanonicalUuid } from '../shared/identifiers';
import { SMS_ACK_RESULTS, SMS_APP_VERSION_PATTERN, SMS_ERROR_CODE_PATTERN, SmsAckResult } from './sms-gateway-constants';

function optionalBoolean(value: unknown): boolean | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'boolean') {
    throw new BadRequestException();
  }
  return value;
}

function objectWithOnly(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !Object.keys(value).every((key) => allowed.includes(key))) {
    throw new BadRequestException();
  }
  return value as Record<string, unknown>;
}

/** What a phone may tell about itself besides the OTP work (M13). Every field is optional: a field the phone does not send is "not reported", never guessed. */
export interface HeartbeatTelemetry {
  readonly batteryPercent: number | null;
  readonly charging: boolean | null;
  readonly simState: 'READY' | 'ABSENT' | 'LOCKED' | 'UNKNOWN' | null;
  readonly pendingReports: number | null;
  readonly currentTask: 'IDLE' | 'SENDING' | 'REPORTING' | null;
  readonly lastErrorCode: string | null;
}

export interface HeartbeatInput {
  readonly appVersion: string | null;
  /** The installed versionCode, when the phone sends it (the update offer compares it). */
  readonly appVersionCode: number | null;
  readonly smsPermission: boolean | null;
  readonly paused: boolean | null;
  readonly telemetry: HeartbeatTelemetry;
}

function optionalInt(value: unknown, min: number, max: number): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new BadRequestException();
  }
  return value;
}

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new BadRequestException();
  }
  return value as T;
}

export function parseHeartbeatBody(body: unknown): HeartbeatInput {
  const parsed = objectWithOnly(body, ['app_version', 'sms_permission', 'paused', 'battery_percent', 'charging', 'sim_state', 'pending_reports', 'current_task', 'last_error_code', 'app_version_code']);
  const version = parsed.app_version;
  const errorCode = parsed.last_error_code;
  if (errorCode !== undefined && errorCode !== null && (typeof errorCode !== 'string' || !SMS_ERROR_CODE_PATTERN.test(errorCode))) {
    throw new BadRequestException();
  }
  if (version !== undefined && (typeof version !== 'string' || !SMS_APP_VERSION_PATTERN.test(version))) {
    throw new BadRequestException();
  }
  return {
    appVersion: version === undefined ? null : version,
    appVersionCode: optionalInt(parsed.app_version_code, 1, 2_000_000_000),
    smsPermission: optionalBoolean(parsed.sms_permission),
    paused: optionalBoolean(parsed.paused),
    telemetry: {
      batteryPercent: optionalInt(parsed.battery_percent, 0, 100),
      charging: optionalBoolean(parsed.charging),
      simState: optionalEnum(parsed.sim_state, ['READY', 'ABSENT', 'LOCKED', 'UNKNOWN'] as const),
      pendingReports: optionalInt(parsed.pending_reports, 0, 100),
      currentTask: optionalEnum(parsed.current_task, ['IDLE', 'SENDING', 'REPORTING'] as const),
      lastErrorCode: typeof errorCode === 'string' ? errorCode : null,
    },
  };
}

export function parseClaimBody(body: unknown): { readonly smsPermission: boolean | null; readonly paused: boolean | null } {
  const parsed = objectWithOnly(body, ['sms_permission', 'paused']);
  return { smsPermission: optionalBoolean(parsed.sms_permission), paused: optionalBoolean(parsed.paused) };
}

export interface AckInput {
  readonly attemptId: string;
  readonly result: SmsAckResult;
  readonly errorCode: string | null;
}

export function parseAckBody(body: unknown): AckInput {
  const parsed = objectWithOnly(body, ['attempt_id', 'result', 'error_code']);
  const { attempt_id: attemptId, result, error_code: errorCode } = parsed;
  if (
    typeof attemptId !== 'string' ||
    !isCanonicalUuid(attemptId) ||
    typeof result !== 'string' ||
    !(SMS_ACK_RESULTS as readonly string[]).includes(result) ||
    (errorCode !== undefined && (typeof errorCode !== 'string' || !SMS_ERROR_CODE_PATTERN.test(errorCode)))
  ) {
    throw new BadRequestException();
  }
  return { attemptId, result: result as SmsAckResult, errorCode: errorCode === undefined ? null : (errorCode as string) };
}

export function parseJobId(value: string): string {
  if (!isCanonicalUuid(value)) {
    throw new BadRequestException();
  }
  return value;
}

