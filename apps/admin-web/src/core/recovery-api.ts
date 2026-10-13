// HTTP client of the no-OTP test password reset (M01-RESET, Owner decision 2026-10-13): GET /v1/account-recovery/config and
// POST /v1/account-recovery/reset-test. Public routes: the admin front forwards neither the admin cookie nor the CSRF token to them,
// and this client sends no CSRF. The body is exactly {phone, password}; there is no code, proof, token or role.

import { ApiClient, ApiResult } from './api.js';

export const RECOVERY_BASE = '/v1/account-recovery';

export type RecoveryMode = 'DISABLED_TEST' | 'UNAVAILABLE';

export class AdminRecoveryApi extends ApiClient {
  /** Only the two known values are accepted; anything else is "no usable answer" and the page stays locked. */
  config(): Promise<ApiResult<RecoveryMode>> {
    return this.call({ method: 'GET', path: '/config' }, (data) => {
      const keys = Object.keys(data);
      return keys.length === 1 && (data.mode === 'DISABLED_TEST' || data.mode === 'UNAVAILABLE') ? data.mode : undefined;
    });
  }

  /** The answer is the same for every phone: {next:"LOGIN"} means "processed", never "this account was reset". */
  reset(phone: string, password: string, idempotencyKey: string): Promise<ApiResult<'LOGIN'>> {
    return this.call({ method: 'POST', path: '/reset-test', body: { phone, password }, idempotencyKey }, (data) =>
      Object.keys(data).length === 1 && data.next === 'LOGIN' ? 'LOGIN' : undefined,
    );
  }
}
