// HTTP client of M01-D-ADMIN-1C (/v1/admin-activation): the invited ADMIN activates the account. Routes, bodies and
// response keys are the ones in docs/tasks/M01-D-ADMIN-WEB-api-inventory.md (taken from the backend controller/views).
//
// This family has its OWN cookie (__Host-11admin-act) and its OWN CSRF token. The page never sees the cookie; it holds
// the CSRF token of the latest answer in memory. The invitation token is sent once, in the body of `start`, and is
// never part of any path, query or header.

import { ApiClient, ApiResult, record, str } from './api.js';

export const ACTIVATION_BASE = '/v1/admin-activation';

export type OtpStatus = 'NONE' | 'SUBMITTED' | 'EXPIRED' | 'LOCKED' | 'FAILED';
const OTP_STATUSES: readonly string[] = ['NONE', 'SUBMITTED', 'EXPIRED', 'LOCKED', 'FAILED'];

export type InvalidatedReason = 'REPLACED' | 'LINK_UNAVAILABLE' | 'PHONE_CONFLICT' | 'ATTEMPTS_EXHAUSTED';
const INVALIDATED_REASONS: readonly string[] = ['REPLACED', 'LINK_UNAVAILABLE', 'PHONE_CONFLICT', 'ATTEMPTS_EXHAUSTED'];

export interface OtpInfo {
  readonly status: OtpStatus;
  readonly resendAt?: string;
  readonly attemptsLeft?: number;
}

/** What `GET /state` (and the richer start/restart answers, and STEP_INVALID details) say. Never a phone, name or id. */
export type ActivationView =
  | { readonly state: 'STARTED'; readonly expiresAt: string; readonly csrfToken?: string; readonly otp?: OtpInfo }
  | {
      readonly state: 'OTP_VERIFIED';
      readonly expiresAt: string;
      readonly csrfToken?: string;
      readonly passwordDeadline?: string;
      readonly restartRequired: boolean;
    }
  | { readonly state: 'PASSWORD_SET'; readonly expiresAt: string; readonly csrfToken?: string }
  | { readonly state: 'TOTP_ISSUED'; readonly expiresAt: string; readonly csrfToken?: string; readonly totpAttemptsLeft?: number }
  | { readonly state: 'COMPLETED' }
  | { readonly state: 'INVALIDATED'; readonly reason: InvalidatedReason; readonly canRestart: boolean; readonly csrfToken?: string };

export interface OtpRequested {
  readonly resendAt: string;
  /** Present ONLY with the TEST_DISPLAY provider (non-production). Never persisted, never logged. */
  readonly displayedCode?: string;
}

export interface Enrollment {
  /** `otpauth://totp/...`: a secret. Rendered as a QR in the page, never stored. */
  readonly otpauthUri: string;
  /** The manual-entry key: the same secret. */
  readonly secret: string;
}

function posInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function otpOf(value: unknown): OtpInfo | undefined {
  const otp = record(value);
  if (otp === undefined || typeof otp.status !== 'string' || !OTP_STATUSES.includes(otp.status)) {
    return undefined;
  }
  const resendAt = str(otp.resend_at);
  const attemptsLeft = posInt(otp.attempts_left);
  return {
    status: otp.status as OtpStatus,
    ...(resendAt === undefined ? {} : { resendAt }),
    ...(attemptsLeft === undefined ? {} : { attemptsLeft }),
  };
}

/**
 * Parses the shared state shape. `csrf_token` is optional here because STEP_INVALID details do not carry one (the page
 * then reads GET /state); every success answer of the backend does.
 */
export function parseActivationView(data: Record<string, unknown>): ActivationView | undefined {
  const csrf = str(data.csrf_token);
  const withCsrf = csrf === undefined ? {} : { csrfToken: csrf };
  const expiresAt = str(data.expires_at);
  switch (data.state) {
    case 'STARTED': {
      if (expiresAt === undefined) {
        return undefined;
      }
      // The 201 of start/restart carries no `otp`; GET state does.
      const otp = data.otp === undefined ? undefined : otpOf(data.otp);
      if (data.otp !== undefined && otp === undefined) {
        return undefined;
      }
      return { state: 'STARTED', expiresAt, ...withCsrf, ...(otp === undefined ? {} : { otp }) };
    }
    case 'OTP_VERIFIED': {
      if (expiresAt === undefined) {
        return undefined;
      }
      const passwordDeadline = str(data.password_deadline);
      return {
        state: 'OTP_VERIFIED',
        expiresAt,
        ...withCsrf,
        ...(passwordDeadline === undefined ? {} : { passwordDeadline }),
        restartRequired: data.restart_required === true,
      };
    }
    case 'PASSWORD_SET':
      return expiresAt === undefined ? undefined : { state: 'PASSWORD_SET', expiresAt, ...withCsrf };
    case 'TOTP_ISSUED': {
      if (expiresAt === undefined) {
        return undefined;
      }
      const totpAttemptsLeft = posInt(data.totp_attempts_left);
      return { state: 'TOTP_ISSUED', expiresAt, ...withCsrf, ...(totpAttemptsLeft === undefined ? {} : { totpAttemptsLeft }) };
    }
    case 'COMPLETED':
      return { state: 'COMPLETED' };
    case 'INVALIDATED': {
      if (typeof data.reason !== 'string' || !INVALIDATED_REASONS.includes(data.reason)) {
        return undefined;
      }
      return { state: 'INVALIDATED', reason: data.reason as InvalidatedReason, canRestart: data.can_restart === true, ...withCsrf };
    }
    default:
      return undefined;
  }
}

/** The view carried by an `ADMIN_ACTIVATION_STEP_INVALID` error (409): where the attempt really is. */
export function viewFromStepInvalid(details: Readonly<Record<string, unknown>> | undefined): ActivationView | undefined {
  return details === undefined ? undefined : parseActivationView({ ...details });
}

export class AdminActivationApi extends ApiClient {
  /** Opens (or continues) the attempt. The ONLY call that carries the invitation token, in the body. No CSRF yet. */
  start(token: string): Promise<ApiResult<ActivationView>> {
    return this.call({ method: 'POST', path: '/start', body: { token } }, parseActivationView, [200, 201]);
  }

  /** Reload: a pure read of where the attempt is. Never sends an SMS and never changes anything. */
  state(): Promise<ApiResult<ActivationView>> {
    return this.call({ method: 'GET', path: '/state' }, parseActivationView);
  }

  /** New attempt from the same link when the state allows it (`can_restart` / `restart_required`). Uses the CSRF, not the token. */
  restart(csrf: string): Promise<ApiResult<ActivationView>> {
    return this.call({ method: 'POST', path: '/restart', body: {}, csrf }, parseActivationView, [200, 201]);
  }

  /** Sends ONE SMS. Never repeated automatically: a lost answer is read with `state()` (otp.status / resend_at). */
  requestOtp(csrf: string): Promise<ApiResult<OtpRequested>> {
    return this.call(
      { method: 'POST', path: '/otp/request', body: {}, csrf },
      (data) => {
        const resendAt = str(data.resend_at);
        if (resendAt === undefined || data.delivery !== 'SUBMITTED') {
          return undefined;
        }
        const displayedCode = str(data.displayed_code);
        return { resendAt, ...(displayedCode === undefined ? {} : { displayedCode }) };
      },
      [202],
    );
  }

  verifyOtp(csrf: string, code: string): Promise<ApiResult<ActivationView>> {
    return this.call({ method: 'POST', path: '/otp/verify', body: { code }, csrf }, parseActivationView);
  }

  setPassword(csrf: string, password: string): Promise<ApiResult<ActivationView>> {
    return this.call({ method: 'POST', path: '/password', body: { password }, csrf }, parseActivationView);
  }

  /** Replayable: asking again returns the same secret. */
  enrollment(csrf: string): Promise<ApiResult<Enrollment>> {
    return this.call({ method: 'POST', path: '/totp/enrollment', body: {}, csrf }, (data) => {
      const otpauthUri = str(data.otpauth_uri);
      const secret = str(data.secret);
      if (data.state !== 'TOTP_ISSUED' || otpauthUri === undefined || !otpauthUri.startsWith('otpauth://totp/') || secret === undefined) {
        return undefined;
      }
      return { otpauthUri, secret };
    });
  }

  /** Confirms the first Authenticator code. Never repeated automatically. Does NOT create an admin session. */
  complete(csrf: string, code: string): Promise<ApiResult<ActivationView>> {
    return this.call({ method: 'POST', path: '/complete', body: { code }, csrf }, parseActivationView);
  }
}
