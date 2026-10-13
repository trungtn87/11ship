// Administration account activation configuration (M01-D-ADMIN-1C, contract section 16 / OD-9). Pure data and
// validation: nothing here reads the environment by itself. Section 16 makes the TTLs and thresholds of section 7
// configurable with the section 7 values as defaults and the database CHECKs as the ceiling; the variable NAMES and the
// accepted ranges below are an implementation choice that ChatGPT/Owner still have to confirm (docs, section "cấu hình").
// The two per-attempt wrong-code limits (OTP 5, TOTP 5) and the TOTP bucket limit (5) are NOT configurable: the schema
// fixes them (CHECK attempt_count <= 5, totp_attempt_count <= 5). Only the NAMES of invalid variables are ever reported,
// never their values.
import { isLoopbackHost } from '../test-sms/test-sms-config';
import { EnvSource } from './admin-auth-config';

export const ACTIVATION_OTP_MODES = ['FAKE', 'TEST_DISPLAY', 'TEST_INBOX', 'SMS'] as const;
export type ActivationOtpMode = (typeof ACTIVATION_OTP_MODES)[number];

// ADMIN_ACTIVATION_PHONE_VERIFICATION_MODE (local test contract of 2026-10-13): REQUIRED (default when unset) keeps the
// SMS OTP step of the activation. DISABLED_TEST skips it - no OTP is requested, verified or faked, and the attempt never
// gets an otp_verified_at - and exists for a local development/test process ONLY: APP_ENV development/test AND a loopback
// bind (activation and administration authentication are enabled by then, because nothing is validated otherwise). An
// unknown value and DISABLED_TEST anywhere else stop startup naming only the variable. Nothing in a request can switch it.
export const ACTIVATION_PHONE_VERIFICATION_MODE_ENV = 'ADMIN_ACTIVATION_PHONE_VERIFICATION_MODE';
export const ACTIVATION_PHONE_VERIFICATION_MODES = ['REQUIRED', 'DISABLED_TEST'] as const;
export type ActivationPhoneVerificationMode = (typeof ACTIVATION_PHONE_VERIFICATION_MODES)[number];

export const DEFAULT_PROVIDER_TIMEOUT_MS = 8000;
export const MIN_PROVIDER_TIMEOUT_MS = 500;
export const MAX_PROVIDER_TIMEOUT_MS = 30_000;
export const DEFAULT_PROMOTE_GRACE_MS = 10_000;
export const MIN_PROMOTE_GRACE_MS = 1000;
export const MAX_PROMOTE_GRACE_MS = 60_000;

/** One configurable section 7 value: its variable, default (= section 7) and accepted inclusive range. */
export interface LimitSpec {
  readonly key: keyof ActivationLimits;
  readonly env: string;
  readonly fallback: number;
  readonly min: number;
  readonly max: number;
  /** Where the ceiling comes from. */
  readonly ceiling: 'SCHEMA' | 'TECHNICAL';
}

/** Section 7 values in seconds (counts for the limits). Defaults are the Owner-approved table (OD-7). */
export interface ActivationLimits {
  readonly attemptTtlSeconds: number;
  readonly otpTtlSeconds: number;
  readonly otpResendCooldownSeconds: number;
  readonly passwordDeadlineSeconds: number;
  readonly otpSendLimit: number;
  readonly otpSendWindowSeconds: number;
  readonly requestLimit: number;
  readonly requestWindowSeconds: number;
  readonly linkFailureLimit: number;
  readonly linkFailureWindowSeconds: number;
  readonly linkFailureLockSeconds: number;
  readonly totpFailureWindowSeconds: number;
  readonly totpFailureLockSeconds: number;
}

/**
 * SCHEMA ceilings are the database CHECKs (attempt lifetime <= 1 hour, OTP lifetime <= 10 minutes). TECHNICAL ceilings
 * (counts <= 1000, seconds <= 86400) only reject absurd values; they are NOT contract values.
 */
export const LIMIT_SPECS: readonly LimitSpec[] = Object.freeze([
  { key: 'attemptTtlSeconds', env: 'ADMIN_ACTIVATION_ATTEMPT_TTL_SECONDS', fallback: 1800, min: 1, max: 3600, ceiling: 'SCHEMA' },
  { key: 'otpTtlSeconds', env: 'ADMIN_ACTIVATION_OTP_TTL_SECONDS', fallback: 300, min: 1, max: 600, ceiling: 'SCHEMA' },
  { key: 'otpResendCooldownSeconds', env: 'ADMIN_ACTIVATION_OTP_RESEND_COOLDOWN_SECONDS', fallback: 60, min: 1, max: 86_400, ceiling: 'TECHNICAL' },
  { key: 'passwordDeadlineSeconds', env: 'ADMIN_ACTIVATION_PASSWORD_DEADLINE_SECONDS', fallback: 600, min: 1, max: 86_400, ceiling: 'TECHNICAL' },
  { key: 'otpSendLimit', env: 'ADMIN_ACTIVATION_OTP_SEND_LIMIT', fallback: 5, min: 1, max: 1000, ceiling: 'TECHNICAL' },
  { key: 'otpSendWindowSeconds', env: 'ADMIN_ACTIVATION_OTP_SEND_WINDOW_SECONDS', fallback: 3600, min: 1, max: 86_400, ceiling: 'TECHNICAL' },
  { key: 'requestLimit', env: 'ADMIN_ACTIVATION_REQUEST_LIMIT', fallback: 30, min: 1, max: 1000, ceiling: 'TECHNICAL' },
  { key: 'requestWindowSeconds', env: 'ADMIN_ACTIVATION_REQUEST_WINDOW_SECONDS', fallback: 60, min: 1, max: 86_400, ceiling: 'TECHNICAL' },
  { key: 'linkFailureLimit', env: 'ADMIN_ACTIVATION_LINK_FAILURE_LIMIT', fallback: 10, min: 1, max: 1000, ceiling: 'TECHNICAL' },
  { key: 'linkFailureWindowSeconds', env: 'ADMIN_ACTIVATION_LINK_FAILURE_WINDOW_SECONDS', fallback: 900, min: 1, max: 86_400, ceiling: 'TECHNICAL' },
  { key: 'linkFailureLockSeconds', env: 'ADMIN_ACTIVATION_LINK_FAILURE_LOCK_SECONDS', fallback: 900, min: 1, max: 86_400, ceiling: 'TECHNICAL' },
  { key: 'totpFailureWindowSeconds', env: 'ADMIN_ACTIVATION_TOTP_FAILURE_WINDOW_SECONDS', fallback: 900, min: 1, max: 86_400, ceiling: 'TECHNICAL' },
  { key: 'totpFailureLockSeconds', env: 'ADMIN_ACTIVATION_TOTP_FAILURE_LOCK_SECONDS', fallback: 900, min: 1, max: 86_400, ceiling: 'TECHNICAL' },
]);

export const DEFAULT_ACTIVATION_LIMITS: ActivationLimits = Object.freeze(
  Object.fromEntries(LIMIT_SPECS.map((spec) => [spec.key, spec.fallback])) as unknown as ActivationLimits,
);

export interface AdminActivationConfig {
  /**
   * ADMIN_ACTIVATION_PHONE_VERIFICATION_MODE, decided once at startup. REQUIRED: the OTP step exists. DISABLED_TEST: it does
   * not (local development/test on loopback only). Every new attempt records the value of the running process.
   */
  readonly phoneVerificationMode: ActivationPhoneVerificationMode;
  /**
   * ADMIN_ACTIVATION_OTP_MODE. FAKE / TEST_DISPLAY / TEST_INBOX are for a non-production test or development environment ONLY and are
   * never a default or a fallback: the mode must be named explicitly. SMS has no provider yet (a later task), so it
   * refuses startup instead of delivering codes nowhere. Present exactly when phoneVerificationMode is REQUIRED: with
   * DISABLED_TEST the activation has no OTP provider at all, so the variable is not read.
   */
  readonly otpMode: ActivationOtpMode | undefined;
  /** ADMIN_ACTIVATION_OTP_PROVIDER_TIMEOUT_MS: hard timeout of one provider call; a timeout is UNKNOWN, never a retry. */
  readonly providerTimeoutMs: number;
  /** ADMIN_ACTIVATION_OTP_PROMOTE_GRACE_MS: how long PENDING_DELIVERY is left alone before verify promotes it. */
  readonly promoteGraceMs: number;
  /** The section 7 TTLs and thresholds (defaults = section 7). */
  readonly limits: ActivationLimits;
}

const INTEGER_SHAPE = /^[1-9][0-9]{0,8}$/;

function readBoundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number | undefined {
  if (raw === undefined) {
    return fallback;
  }
  if (!INTEGER_SHAPE.test(raw)) {
    return undefined;
  }
  const value = Number(raw);
  return value >= min && value <= max ? value : undefined;
}

/**
 * ADMIN_ACTIVATION_ENABLED (default false). Disabled: nothing is wired, nothing else is validated. Enabled: it needs
 * ADMIN_AUTH_ENABLED=true (the activation reuses its limiter key, origins and activation origin), an explicit
 * ADMIN_ACTIVATION_OTP_MODE (REQUIRED phone verification), and in a staging/production environment no test mode
 * (FAKE/TEST_DISPLAY) and no DISABLED_TEST phone verification is accepted.
 */
export function loadAdminActivationConfig(
  env: EnvSource,
  appEnv: string | undefined,
  adminAuthEnabled: boolean,
  host: string,
): { ok: true; config: AdminActivationConfig | undefined } | { ok: false; invalid: readonly string[] } {
  const rawEnabled = env.ADMIN_ACTIVATION_ENABLED;
  if (rawEnabled === undefined || rawEnabled === 'false') {
    return { ok: true, config: undefined };
  }
  if (rawEnabled !== 'true' || !adminAuthEnabled) {
    return { ok: false, invalid: ['ADMIN_ACTIVATION_ENABLED'] };
  }
  const invalid: string[] = [];
  const rawPhoneMode = env[ACTIVATION_PHONE_VERIFICATION_MODE_ENV];
  const phoneVerificationMode = ACTIVATION_PHONE_VERIFICATION_MODES.find((mode) => mode === rawPhoneMode) ?? (rawPhoneMode === undefined ? 'REQUIRED' : undefined);
  // An invalid APP_ENV is reported by its own name; DISABLED_TEST is only judged against a known environment.
  const disabledTestAllowed = (appEnv === 'development' || appEnv === 'test') && isLoopbackHost(host);
  if (phoneVerificationMode === undefined || (phoneVerificationMode === 'DISABLED_TEST' && appEnv !== undefined && !disabledTestAllowed)) {
    invalid.push(ACTIVATION_PHONE_VERIFICATION_MODE_ENV);
  }
  const phoneRequired = phoneVerificationMode !== 'DISABLED_TEST';
  const rawMode = env.ADMIN_ACTIVATION_OTP_MODE;
  const otpMode = ACTIVATION_OTP_MODES.find((mode) => mode === rawMode);
  const testMode = otpMode === 'FAKE' || otpMode === 'TEST_DISPLAY' || otpMode === 'TEST_INBOX';
  // DISABLED_TEST has no OTP step, so no provider is needed (nor read): only a REQUIRED activation names its OTP mode.
  if (phoneRequired && (otpMode === undefined || (testMode && appEnv !== 'development' && appEnv !== 'test'))) {
    invalid.push('ADMIN_ACTIVATION_OTP_MODE');
  }
  const providerTimeoutMs = readBoundedInteger(
    env.ADMIN_ACTIVATION_OTP_PROVIDER_TIMEOUT_MS,
    DEFAULT_PROVIDER_TIMEOUT_MS,
    MIN_PROVIDER_TIMEOUT_MS,
    MAX_PROVIDER_TIMEOUT_MS,
  );
  if (providerTimeoutMs === undefined) {
    invalid.push('ADMIN_ACTIVATION_OTP_PROVIDER_TIMEOUT_MS');
  }
  const promoteGraceMs = readBoundedInteger(
    env.ADMIN_ACTIVATION_OTP_PROMOTE_GRACE_MS,
    DEFAULT_PROMOTE_GRACE_MS,
    MIN_PROMOTE_GRACE_MS,
    MAX_PROMOTE_GRACE_MS,
  );
  if (promoteGraceMs === undefined) {
    invalid.push('ADMIN_ACTIVATION_OTP_PROMOTE_GRACE_MS');
  }
  const limits: Record<string, number> = {};
  for (const spec of LIMIT_SPECS) {
    const value = readBoundedInteger(env[spec.env], spec.fallback, spec.min, spec.max);
    if (value === undefined) {
      invalid.push(spec.env);
    } else {
      limits[spec.key] = value;
    }
  }
  if (
    invalid.length > 0 ||
    phoneVerificationMode === undefined ||
    (phoneRequired && otpMode === undefined) ||
    providerTimeoutMs === undefined ||
    promoteGraceMs === undefined
  ) {
    return { ok: false, invalid };
  }
  return {
    ok: true,
    config: {
      phoneVerificationMode,
      otpMode: phoneRequired ? otpMode : undefined,
      providerTimeoutMs,
      promoteGraceMs,
      limits: Object.freeze(limits) as unknown as ActivationLimits,
    },
  };
}
