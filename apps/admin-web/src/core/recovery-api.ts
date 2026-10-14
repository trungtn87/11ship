// HTTP client of the SMS-verified password reset of USER / ADMIN accounts (M01-RESET; issue #102): GET /v1/account-recovery/config,
// POST /otp {phone}, POST /otp/{id}/verify {otp}, POST /reset {verification_token, password}. Public routes: the admin front forwards
// neither the admin cookie nor the CSRF token to them, and this client sends no CSRF. The no-OTP route of the old test build is not
// used any more (the server refuses it outside development/test).

import { ApiClient, ApiResult } from './api.js';

export const RECOVERY_BASE = '/v1/account-recovery';

/** Only SMS_OTP opens the page; UNAVAILABLE keeps it closed. Anything else is "no usable answer". */
export type RecoveryMode = 'SMS_OTP' | 'UNAVAILABLE';

export interface OtpRequested {
  readonly verificationId: string;
  readonly resendAfterSeconds: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class AdminRecoveryApi extends ApiClient {
  config(): Promise<ApiResult<RecoveryMode>> {
    return this.call({ method: 'GET', path: '/config' }, (data) => {
      const keys = Object.keys(data);
      return keys.length === 1 && (data.mode === 'SMS_OTP' || data.mode === 'UNAVAILABLE') ? data.mode : undefined;
    });
  }

  /** The answer is the same for every phone: it never says whether the number has an account. */
  requestOtp(phone: string): Promise<ApiResult<OtpRequested>> {
    return this.call({ method: 'POST', path: '/otp', body: { phone } }, (data) => {
      const id = data.verification_id;
      const resend = data.resend_after_seconds;
      if (typeof id !== 'string' || !UUID.test(id)) {
        return undefined;
      }
      return { verificationId: id, resendAfterSeconds: typeof resend === 'number' && Number.isSafeInteger(resend) && resend >= 0 ? resend : 60 };
    });
  }

  /** The one-use proof of the number that received the code. */
  verifyOtp(verificationId: string, otp: string): Promise<ApiResult<string>> {
    return this.call({ method: 'POST', path: `/otp/${verificationId}/verify`, body: { otp } }, (data) =>
      typeof data.verification_token === 'string' && data.verification_token.length > 0 ? data.verification_token : undefined,
    );
  }

  /** {next:"LOGIN"} means "processed"; it never signs anybody in. */
  reset(verificationToken: string, password: string, idempotencyKey: string): Promise<ApiResult<'LOGIN'>> {
    return this.call({ method: 'POST', path: '/reset', body: { verification_token: verificationToken, password }, idempotencyKey }, (data) =>
      data.next === 'LOGIN' ? 'LOGIN' : undefined,
    );
  }
}
