// Administration account activation configuration (M01-D-ADMIN-1C, contract section 16 / OD-9). Pure data and
// validation: nothing here reads the environment by itself. The TTLs and thresholds of section 7 are constants of the
// admin-activation module (like those of 1A/1B), so no variable can loosen a gate; only the three settings below are
// configurable. Only the NAMES of invalid variables are ever reported, never their values.
import { EnvSource } from './admin-auth-config';

export const ACTIVATION_OTP_MODES = ['FAKE', 'TEST_DISPLAY', 'SMS'] as const;
export type ActivationOtpMode = (typeof ACTIVATION_OTP_MODES)[number];

export const DEFAULT_PROVIDER_TIMEOUT_MS = 8000;
export const MIN_PROVIDER_TIMEOUT_MS = 500;
export const MAX_PROVIDER_TIMEOUT_MS = 30_000;
export const DEFAULT_PROMOTE_GRACE_MS = 10_000;
export const MIN_PROMOTE_GRACE_MS = 1000;
export const MAX_PROMOTE_GRACE_MS = 60_000;

export interface AdminActivationConfig {
  /**
   * ADMIN_ACTIVATION_OTP_MODE. FAKE / TEST_DISPLAY are for a non-production test or development environment ONLY and are
   * never a default or a fallback: the mode must be named explicitly. SMS has no provider yet (a later task), so it
   * refuses startup instead of delivering codes nowhere.
   */
  readonly otpMode: ActivationOtpMode;
  /** ADMIN_ACTIVATION_OTP_PROVIDER_TIMEOUT_MS: hard timeout of one provider call; a timeout is UNKNOWN, never a retry. */
  readonly providerTimeoutMs: number;
  /** ADMIN_ACTIVATION_OTP_PROMOTE_GRACE_MS: how long PENDING_DELIVERY is left alone before verify promotes it. */
  readonly promoteGraceMs: number;
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
 * ADMIN_ACTIVATION_OTP_MODE, and in a staging/production environment no test mode (FAKE/TEST_DISPLAY) is accepted.
 */
export function loadAdminActivationConfig(
  env: EnvSource,
  appEnv: string | undefined,
  adminAuthEnabled: boolean,
): { ok: true; config: AdminActivationConfig | undefined } | { ok: false; invalid: readonly string[] } {
  const rawEnabled = env.ADMIN_ACTIVATION_ENABLED;
  if (rawEnabled === undefined || rawEnabled === 'false') {
    return { ok: true, config: undefined };
  }
  if (rawEnabled !== 'true' || !adminAuthEnabled) {
    return { ok: false, invalid: ['ADMIN_ACTIVATION_ENABLED'] };
  }
  const invalid: string[] = [];
  const rawMode = env.ADMIN_ACTIVATION_OTP_MODE;
  const otpMode = ACTIVATION_OTP_MODES.find((mode) => mode === rawMode);
  const testMode = otpMode === 'FAKE' || otpMode === 'TEST_DISPLAY';
  if (otpMode === undefined || (testMode && appEnv !== 'development' && appEnv !== 'test')) {
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
  if (invalid.length > 0 || otpMode === undefined || providerTimeoutMs === undefined || promoteGraceMs === undefined) {
    return { ok: false, invalid };
  }
  return { ok: true, config: { otpMode, providerTimeoutMs, promoteGraceMs } };
}
