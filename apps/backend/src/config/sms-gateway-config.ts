import { normalizeVietnamPhone } from '../auth/phone';

// Configuration of the SMS gateway (issue #102). Pure validation: nothing here reads the environment by itself and only the
// NAMES of invalid variables are ever reported, never their values (the allowlist holds phone numbers).
//
//   SMS_GATEWAY_ENABLED                  unset | false (default, nothing is wired) | true
//   SMS_GATEWAY_RECIPIENT_MODE           ALLOWLIST (default) | OPEN
//   SMS_GATEWAY_ALLOWLIST                comma separated Vietnamese mobile numbers; REQUIRED (non-empty) in ALLOWLIST mode
//   SMS_GATEWAY_LIMIT_PHONE_PER_HOUR     default 3   (OTP challenges per phone, rolling hour)
//   SMS_GATEWAY_LIMIT_PHONE_PER_DAY      default 5   (OTP challenges per phone, rolling 24 hours)
//   SMS_GATEWAY_LIMIT_GLOBAL_PER_DAY     default 30  (SMS jobs of the whole gateway, rolling 24 hours)
//   SMS_GATEWAY_ONLINE_WINDOW_SECONDS    default 90  (a gateway counts as online if its last heartbeat/poll is this recent)
//   SMS_GATEWAY_LEASE_SECONDS            default 60  (after a claim the gateway has this long to acknowledge)
//   SMS_GATEWAY_POLL_SECONDS             default 5   (poll interval suggested to the device)
//
// ALLOWLIST is the default so that, until the Owner has confirmed the SIM / carrier terms, only the Owner's test numbers can
// ever receive an automatic SMS. OPEN (real customers) needs an explicit, separate decision.

export const SMS_GATEWAY_ENABLED_ENV = 'SMS_GATEWAY_ENABLED';

export type SmsRecipientMode = 'ALLOWLIST' | 'OPEN';

export interface SmsGatewayConfig {
  readonly recipientMode: SmsRecipientMode;
  /** Normalized +84XXXXXXXXX numbers; empty only in OPEN mode. */
  readonly allowlist: ReadonlySet<string>;
  readonly limitPhonePerHour: number;
  readonly limitPhonePerDay: number;
  readonly limitGlobalPerDay: number;
  readonly onlineWindowSeconds: number;
  readonly leaseSeconds: number;
  readonly pollSeconds: number;
}

export type SmsGatewayConfigResult =
  | { readonly ok: true; readonly config: SmsGatewayConfig | undefined }
  | { readonly ok: false; readonly invalid: readonly string[] };

export interface SmsGatewayConfigInput {
  readonly env: Readonly<Record<string, string | undefined>>;
}

function readBoundedInteger(
  env: SmsGatewayConfigInput['env'],
  name: string,
  fallback: number,
  min: number,
  max: number,
  invalid: string[],
): number {
  const raw = env[name];
  if (raw === undefined) {
    return fallback;
  }
  const value = /^\d{1,9}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    invalid.push(name);
    return fallback;
  }
  return value;
}

export function parseSmsGateway(input: SmsGatewayConfigInput): SmsGatewayConfigResult {
  const { env } = input;
  const enabledRaw = env[SMS_GATEWAY_ENABLED_ENV];
  if (enabledRaw === undefined || enabledRaw === 'false') {
    return { ok: true, config: undefined };
  }
  if (enabledRaw !== 'true') {
    return { ok: false, invalid: [SMS_GATEWAY_ENABLED_ENV] };
  }

  const invalid: string[] = [];
  const modeRaw = env.SMS_GATEWAY_RECIPIENT_MODE;
  let recipientMode: SmsRecipientMode = 'ALLOWLIST';
  if (modeRaw === 'OPEN') {
    recipientMode = 'OPEN';
  } else if (modeRaw !== undefined && modeRaw !== 'ALLOWLIST') {
    invalid.push('SMS_GATEWAY_RECIPIENT_MODE');
  }

  const allowlist = new Set<string>();
  const allowlistRaw = env.SMS_GATEWAY_ALLOWLIST;
  if (allowlistRaw !== undefined) {
    for (const item of allowlistRaw.split(',')) {
      const phone = normalizeVietnamPhone(item);
      if (phone === undefined) {
        invalid.push('SMS_GATEWAY_ALLOWLIST');
        break;
      }
      allowlist.add(phone);
    }
  }
  if (recipientMode === 'ALLOWLIST' && allowlist.size === 0 && !invalid.includes('SMS_GATEWAY_ALLOWLIST')) {
    invalid.push('SMS_GATEWAY_ALLOWLIST');
  }

  const config: SmsGatewayConfig = {
    recipientMode,
    allowlist,
    limitPhonePerHour: readBoundedInteger(env, 'SMS_GATEWAY_LIMIT_PHONE_PER_HOUR', 3, 1, 100, invalid),
    limitPhonePerDay: readBoundedInteger(env, 'SMS_GATEWAY_LIMIT_PHONE_PER_DAY', 5, 1, 500, invalid),
    limitGlobalPerDay: readBoundedInteger(env, 'SMS_GATEWAY_LIMIT_GLOBAL_PER_DAY', 30, 1, 10_000, invalid),
    onlineWindowSeconds: readBoundedInteger(env, 'SMS_GATEWAY_ONLINE_WINDOW_SECONDS', 90, 15, 600, invalid),
    leaseSeconds: readBoundedInteger(env, 'SMS_GATEWAY_LEASE_SECONDS', 60, 15, 300, invalid),
    pollSeconds: readBoundedInteger(env, 'SMS_GATEWAY_POLL_SECONDS', 5, 2, 60, invalid),
  };
  if (invalid.length > 0) {
    return { ok: false, invalid };
  }
  return { ok: true, config };
}
