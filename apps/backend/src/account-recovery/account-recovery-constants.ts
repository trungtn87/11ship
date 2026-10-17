// M01-RESET (no-OTP test build). Scope namespace and operation names of the reset; the audit action equals the operation id.
export const RESET_TEST_SCOPE_TYPE = 'account_recovery_phone';
export const RESET_TEST_OPERATION_ID = 'account.password.reset_test.v1';
export const RESET_TEST_AUDIT_ACTION = 'account.password.reset_test.v1';
/** Audit marker: the phone number was NOT proven in this reset. */
export const RESET_TEST_VERIFICATION_MARK = 'TEST_NO_PHONE_VERIFICATION';
export const ACCOUNT_RECOVERY_ROUTE_PREFIX = 'account-recovery';

// Issue #102: password reset proven by an SMS OTP (ACCOUNT_RECOVERY_MODE=SMS_OTP). Its own scope, operation and audit action,
// so its idempotency records can never be confused with the no-OTP test reset.
export const RESET_OTP_SCOPE_TYPE = 'account_recovery_proof';
export const RESET_OTP_OPERATION_ID = 'account.password.reset_otp.v1';
export const RESET_OTP_AUDIT_ACTION = 'account.password.reset_otp.v1';
/** Audit marker: the phone number WAS proven by an SMS OTP of the RESET_PASSWORD purpose. */
export const RESET_OTP_VERIFICATION_MARK = 'SMS_OTP';

// Owner decision 2026-10-14: recovery of an APP_USER account that was locked at its owner's request (re-registering the same phone). Its own
// scope/operation/audit action so its idempotency records are never confused with a password reset. The OTP is ALWAYS required.
export const RECOVER_OPERATION_ID = 'account.recover_locked.v1';
export const RECOVER_AUDIT_ACTION = 'account.recover_locked.v1';
export const RECOVER_USER_UNLOCKED_EVENT = 'user.account.unlocked.v1';
