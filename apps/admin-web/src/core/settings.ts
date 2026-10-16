// Model of the "Cài đặt hệ thống" page (Owner decision 2026-10-14): the SYSTEM account's switches. The first group is "Xác thực số điện
// thoại": two independent OTP switches. They are PLAIN DATA: dom/settings-view.ts draws them, and `SettingsSource` supplies them. The real
// source (core/settings-api.ts) talks to /v1/admin/system-settings; NOT_WIRED_SETTINGS answers "not wired" and never invents a value.
// The page only ever shows what the server said; whether the signed-in administrator may open it is decided by the server too (SYSTEM only).

import { Failure } from './accounts.js';

export type SettingKey = 'otp_registration_enabled' | 'otp_password_reset_enabled';

export const SETTING_LABEL: Record<SettingKey, string> = {
  otp_registration_enabled: 'Xác minh số điện thoại khi đăng ký',
  otp_password_reset_enabled: 'Xác minh số điện thoại khi quên mật khẩu',
};

export interface SettingChange {
  readonly id: string;
  readonly key: SettingKey;
  readonly oldValue: boolean;
  readonly newValue: boolean;
  /** The id of the SYSTEM account that saved it (the page never shows a phone number or a name it did not receive). */
  readonly changedBy: string;
  /** ISO timestamp. */
  readonly changedAt: string;
}

export interface PhoneVerificationSettings {
  /** The version of the whole group; sent back with a save so a stale screen cannot overwrite a newer change. */
  readonly version: number;
  readonly otpRegistrationEnabled: boolean;
  readonly otpPasswordResetEnabled: boolean;
  /** ISO timestamp of the last change, or null when the defaults were never changed. */
  readonly updatedAt: string | null;
  /** Newest first. */
  readonly history: readonly SettingChange[];
}

export type SettingsState =
  | { readonly kind: 'not-wired'; readonly reason: string }
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly failure: Failure; readonly retryAfterSec?: number }
  | { readonly kind: 'ready'; readonly settings: PhoneVerificationSettings };

/** The edit in progress: what the switches show now, before "Lưu". "Hủy" goes back to what the server last said. */
export interface SettingsDraft {
  readonly otpRegistrationEnabled: boolean;
  readonly otpPasswordResetEnabled: boolean;
}

export type SettingsPhase = 'idle' | 'working' | 'unknown' | 'conflict' | 'failed' | 'saved';

export interface SettingsScreen {
  readonly name: 'settings';
  readonly state: SettingsState;
  readonly draft?: SettingsDraft;
  readonly phase: SettingsPhase;
  /** Shown in the status area (the server answer), never as a toast. */
  readonly error?: string;
}

export const NOT_WIRED_SETTINGS_REASON = 'Cài đặt hệ thống chưa được nối với máy chủ. Không có giá trị nào được hiển thị.';

export interface SaveCommand {
  /** The version of the settings the admin looked at. */
  readonly version: number;
  readonly otpRegistrationEnabled: boolean;
  readonly otpPasswordResetEnabled: boolean;
  /** Idempotency-Key of THIS intent. A retry after an unknown outcome sends the same one. */
  readonly key: string;
}

export type SaveResult =
  | { readonly kind: 'ok' }
  /** SYSTEM_SETTING_VERSION_CONFLICT: somebody saved in between. Nothing was changed. */
  | { readonly kind: 'conflict' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'session-expired' }
  | { readonly kind: 'rate-limited'; readonly retryAfterSec?: number }
  | { readonly kind: 'rejected' }
  /** The answer was lost: the save MAY have been executed. Retry with the same key only. */
  | { readonly kind: 'unknown' }
  | { readonly kind: 'not-wired' };

export const SETTINGS_MESSAGE = {
  forbidden: 'Chỉ tài khoản SYSTEM được xem và sửa cài đặt hệ thống.',
  rateLimited: 'Thao tác quá nhanh. Vui lòng thử lại sau ít phút.',
  rejected: 'Yêu cầu không hợp lệ. Hãy tải lại trang và thử lại.',
  notWired: 'Cài đặt hệ thống chưa được nối với máy chủ.',
  unknown: 'Chưa xác nhận được kết quả. Hãy kiểm tra lại giá trị hiện tại; yêu cầu này không bị gửi lại tự động. “Thử lại” gửi đúng yêu cầu cũ, không tạo thêm thay đổi.',
  conflict: 'Cài đặt đã được thay đổi ở nơi khác. Hãy tải lại để xem giá trị hiện tại trước khi sửa.',
} as const;

export interface SettingsSource {
  read(): Promise<SettingsState>;
  /** Saves the group. Sends exactly one request per call and never repeats it by itself. */
  save(command: SaveCommand): Promise<SaveResult>;
}

export const NOT_WIRED_SETTINGS: SettingsSource = {
  read: () => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_SETTINGS_REASON }),
  save: () => Promise.resolve({ kind: 'not-wired' }),
};
