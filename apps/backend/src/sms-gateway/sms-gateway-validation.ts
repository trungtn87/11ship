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

export interface HeartbeatInput {
  readonly appVersion: string | null;
  readonly smsPermission: boolean | null;
  readonly paused: boolean | null;
}

export function parseHeartbeatBody(body: unknown): HeartbeatInput {
  const parsed = objectWithOnly(body, ['app_version', 'sms_permission', 'paused']);
  const version = parsed.app_version;
  if (version !== undefined && (typeof version !== 'string' || !SMS_APP_VERSION_PATTERN.test(version))) {
    throw new BadRequestException();
  }
  return {
    appVersion: version === undefined ? null : version,
    smsPermission: optionalBoolean(parsed.sms_permission),
    paused: optionalBoolean(parsed.paused),
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

