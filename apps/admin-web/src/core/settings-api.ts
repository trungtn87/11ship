// HTTP client of the SYSTEM settings (Owner decision 2026-10-14): GET and POST /v1/admin/system-settings/phone-verification. Cookie-only
// (HttpOnly session, same origin); the CSRF token is passed in from memory. Every answer is parsed strictly: a body that does not have the
// documented shape is "unknown", never half-shown data. Nothing is stored here.

import { Failure } from './accounts.js';
import { CsrfPort, failureOf } from './accounts-api.js';
import { ApiClient, ApiResult, record, str } from './api.js';
import { PhoneVerificationSettings, SaveCommand, SaveResult, SettingChange, SettingKey, SettingsSource, SettingsState } from './settings.js';

/** The transport's base: this client's paths start with /admin. */
export const SETTINGS_BASE = '/v1';

const KEYS: readonly SettingKey[] = ['otp_registration_enabled', 'otp_password_reset_enabled'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH = '/admin/system-settings/phone-verification';

function isoOf(value: unknown): string | undefined {
  const text = str(value);
  return text !== undefined && !Number.isNaN(Date.parse(text)) ? text : undefined;
}

function changeOf(value: unknown): SettingChange | undefined {
  const raw = record(value);
  if (raw === undefined) {
    return undefined;
  }
  const id = str(raw.change_id);
  const changedBy = str(raw.changed_by);
  const changedAt = isoOf(raw.changed_at);
  const key = KEYS.find((candidate) => candidate === raw.setting_key);
  if (id === undefined || !UUID_RE.test(id) || changedBy === undefined || changedAt === undefined || key === undefined || typeof raw.old_value !== 'boolean' || typeof raw.new_value !== 'boolean') {
    return undefined;
  }
  return { id, key, oldValue: raw.old_value, newValue: raw.new_value, changedBy, changedAt };
}

export function parsePhoneVerificationSettings(data: Record<string, unknown>): PhoneVerificationSettings | undefined {
  const version = data.version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
    return undefined;
  }
  if (typeof data.otp_registration_enabled !== 'boolean' || typeof data.otp_password_reset_enabled !== 'boolean') {
    return undefined;
  }
  const updatedAt = data.updated_at === null ? null : isoOf(data.updated_at);
  if (updatedAt === undefined || !Array.isArray(data.history)) {
    return undefined;
  }
  const history: SettingChange[] = [];
  for (const entry of data.history) {
    const change = changeOf(entry);
    if (change === undefined) {
      return undefined;
    }
    history.push(change);
  }
  return { version, otpRegistrationEnabled: data.otp_registration_enabled, otpPasswordResetEnabled: data.otp_password_reset_enabled, updatedAt, history };
}

export class AdminSettingsApi extends ApiClient {
  read(): Promise<ApiResult<PhoneVerificationSettings>> {
    return this.call({ method: 'GET', path: PATH }, parsePhoneVerificationSettings);
  }

  /** One request; the caller owns the key and never repeats the call by itself. */
  save(csrf: string, command: SaveCommand): Promise<ApiResult<PhoneVerificationSettings>> {
    return this.call(
      {
        method: 'POST',
        path: PATH,
        body: { expected_version: command.version, otp_registration_enabled: command.otpRegistrationEnabled, otp_password_reset_enabled: command.otpPasswordResetEnabled },
        csrf,
        idempotencyKey: command.key,
      },
      // The save answers with the current settings plus the list of what changed.
      (data) => parsePhoneVerificationSettings(data),
    );
  }
}

type Failed = { readonly kind: 'failed'; readonly failure: Failure; readonly retryAfterSec?: number };

/** The real SettingsSource. It keeps nothing: no values, no history. */
export function createSettingsSource(api: AdminSettingsApi, session?: CsrfPort): SettingsSource {
  return {
    async read(): Promise<SettingsState> {
      const result = await api.read();
      if (result.kind === 'ok') {
        return { kind: 'ready', settings: result.data };
      }
      const failed: Failed = failureOf(result);
      return failed;
    },
    async save(command): Promise<SaveResult> {
      if (session === undefined) {
        return { kind: 'not-wired' };
      }
      const csrf = session.csrf();
      if (csrf === undefined) {
        return { kind: 'session-expired' };
      }
      const result = await api.save(csrf, command);
      if (result.kind === 'ok') {
        return { kind: 'ok' };
      }
      // No usable answer, or a server fault (503 TRANSACTION_OUTCOME_UNKNOWN included): the save may have been executed.
      if (result.kind === 'network' || result.status >= 500) {
        return { kind: 'unknown' };
      }
      switch (result.code) {
        case 'ADMIN_CSRF_INVALID':
          // Refused before anything ran; a fresh token is read and the admin retries with the SAME key.
          await session.refresh();
          return { kind: 'unknown' };
        case 'ADMIN_SESSION_INVALID':
          return { kind: 'session-expired' };
        case 'ADMIN_FORBIDDEN':
          return { kind: 'forbidden' };
        case 'SYSTEM_SETTING_VERSION_CONFLICT':
          return { kind: 'conflict' };
        case 'IDEMPOTENCY_BUSY':
          return { kind: 'unknown' };
        case 'ADMIN_AUTH_RATE_LIMITED':
          return { kind: 'rate-limited', ...(result.retryAfterSeconds === undefined ? {} : { retryAfterSec: result.retryAfterSeconds }) };
        default:
          return { kind: 'rejected' };
      }
    },
  };
}
