// SYSTEM-managed settings (Owner decision 2026-10-14). Boolean settings stored in app.system_settings; an absent row means the
// default. The values are read from the database on every use (no cache, no restart): a change is in effect at the next request.

/** The first group of settings: phone verification (OTP). Two independent switches. */
export const OTP_REGISTRATION_ENABLED = 'otp_registration_enabled';
export const OTP_PASSWORD_RESET_ENABLED = 'otp_password_reset_enabled';

export const SYSTEM_SETTING_KEYS = [OTP_REGISTRATION_ENABLED, OTP_PASSWORD_RESET_ENABLED] as const;
export type SystemSettingKey = (typeof SYSTEM_SETTING_KEYS)[number];

/** Both switches default to ON: phone verification is required unless the SYSTEM account turned it off. */
export const SYSTEM_SETTING_DEFAULTS: Readonly<Record<SystemSettingKey, boolean>> = Object.freeze({
  [OTP_REGISTRATION_ENABLED]: true,
  [OTP_PASSWORD_RESET_ENABLED]: true,
});

export const SYSTEM_SETTING_AUDIT_ACTION = 'admin.system_setting.update.v1';
export const SYSTEM_SETTING_OPERATION_ID = 'admin.system_setting.update.v1';
export const SYSTEM_SETTING_RESOURCE = 'system_setting';
export const SYSTEM_SETTING_HISTORY_LIMIT = 20;
