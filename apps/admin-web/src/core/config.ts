// Model of "Cài đặt › Cấu hình tập trung" (M12-D). PLAIN DATA plus the port the page talks to (dom/config-view.ts draws it, core/config-api.ts is the real source).
// The page holds NO value of its own: every number is read from the module that owns it, and a change goes through that owner's own command (which checks the version,
// writes its history and its audit row). What the approved rules fix is shown as FIXED and has no edit. The page decides no right: SYSTEM changes, every administrator reads.

import { Failure } from './accounts.js';
import { CommandResult } from './commands.js';
import { OTP_POLICY_FIELDS } from './otp-policy.js';

export type ConfigKind = 'OTP' | 'WALLET' | 'ELIGIBILITY' | 'ORDER' | 'NOTIFICATION';
export type ConfigGroupKey = 'security' | 'shipper_wallet' | 'delivery_policy' | 'orders' | 'notifications' | 'map_gps' | 'storage_backup';

export interface ConfigValue {
  readonly key: string;
  readonly label: string;
  readonly value: number | boolean | string;
  readonly unit?: string;
}

export interface ConfigGroup {
  readonly key: ConfigGroupKey;
  readonly title: string;
  readonly owner: string;
  readonly version: number | null;
  readonly updatedAt: string | null;
  readonly values: readonly ConfigValue[];
  readonly fixedRules: readonly ConfigValue[];
  /** The kind of edit the owner offers; null = nothing to edit (fixed rules only, or owned by another package). */
  readonly edit: { readonly kind: ConfigKind; readonly note: string | null } | null;
}

export interface ConfigChange {
  readonly at: string;
  readonly group: ConfigGroupKey;
  readonly action: string;
  readonly actorName: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export type ConfigRead =
  | { readonly kind: 'ready'; readonly groups: readonly ConfigGroup[]; readonly editable: boolean; readonly generatedAt: string }
  | { readonly kind: 'not-wired'; readonly reason: string }
  | { readonly kind: 'failed'; readonly failure: Failure; readonly retryAfterSec?: number };

export type HistoryRead = { readonly kind: 'ready'; readonly items: readonly ConfigChange[] } | { readonly kind: 'not-wired'; readonly reason: string } | { readonly kind: 'failed'; readonly failure: Failure; readonly retryAfterSec?: number };

export interface ConfigSave {
  readonly kind: ConfigKind;
  /** The group version the screen was loaded with (the owner's own concurrency token). */
  readonly version: number;
  readonly values: Readonly<Record<string, number | boolean>>;
  readonly reason: string;
  /** Idempotency-Key of THIS intent. A retry after an unknown outcome sends the same one. */
  readonly key: string;
}

export interface ConfigSource {
  read(): Promise<ConfigRead>;
  history(group: ConfigGroupKey | null): Promise<HistoryRead>;
  /** Sends exactly one request per call and never repeats it by itself. */
  save(save: ConfigSave): Promise<CommandResult>;
}

export const NOT_WIRED_CONFIG_REASON = 'Cấu hình tập trung chưa được nối với máy chủ. Không có giá trị nào được hiển thị.';

export const NOT_WIRED_CONFIG: ConfigSource = {
  read: () => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_CONFIG_REASON }),
  history: () => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_CONFIG_REASON }),
  save: () => Promise.resolve({ kind: 'not-wired' }),
};

/** The fields of each editable kind, with the bounds the owner's parser enforces (the owner checks again; these only keep an impossible value from being sent). */
export interface FieldSpec {
  readonly key: string;
  readonly label: string;
  readonly type: 'boolean' | 'integer';
  readonly min?: number;
  readonly max?: number;
  readonly unit?: string;
}

export const CONFIG_FIELDS: Record<ConfigKind, readonly FieldSpec[]> = {
  OTP: [
    { key: 'otp_registration_enabled', label: 'OTP khi đăng ký', type: 'boolean' },
    { key: 'otp_password_reset_enabled', label: 'OTP khi quên mật khẩu', type: 'boolean' },
  ],
  WALLET: [
    { key: 'topup_min_vnd', label: 'Nạp tối thiểu mỗi yêu cầu', type: 'integer', min: 1, max: 1_000_000_000, unit: 'đ' },
    { key: 'withdraw_min_vnd', label: 'Rút tối thiểu mỗi yêu cầu', type: 'integer', min: 1, max: 1_000_000_000, unit: 'đ' },
  ],
  ELIGIBILITY: [
    { key: 'external_max_deliveries', label: 'Số đơn tối đa shipper ngoài giữ cùng lúc', type: 'integer', min: 1, max: 20, unit: 'đơn' },
    { key: 'batch_max_delay_seconds', label: 'Chậm tối đa khi ghép đơn', type: 'integer', min: 0, max: 3600, unit: 'giây' },
    { key: 'pickup_service_seconds', label: 'Thời gian phục vụ lấy hàng', type: 'integer', min: 0, max: 1800, unit: 'giây' },
    { key: 'handoff_service_seconds', label: 'Thời gian phục vụ giao hàng', type: 'integer', min: 0, max: 1800, unit: 'giây' },
  ],
  ORDER: [{ key: 'fee_answer_minutes', label: 'Thời gian trả lời đề xuất phí', type: 'integer', min: 1, max: 1440, unit: 'phút' }],
  NOTIFICATION: [
    { key: 'push_enabled', label: 'Bật thông báo đẩy', type: 'boolean' },
    { key: 'default_sound', label: 'Âm thanh mặc định', type: 'boolean' },
    { key: 'visible_days', label: 'Số ngày hiển thị trong hộp thư', type: 'integer', min: 7, max: 365, unit: 'ngày' },
    { key: 'purge_days', label: 'Số ngày giữ trước khi dọn', type: 'integer', min: 7, max: 1095, unit: 'ngày' },
    { key: 'retry_max_attempts', label: 'Số lần thử gửi lại tối đa', type: 'integer', min: 1, max: 10, unit: 'lần' },
    { key: 'retry_base_seconds', label: 'Chờ giữa các lần thử', type: 'integer', min: 5, max: 3600, unit: 'giây' },
  ],
};

/** Why a value is refused before anything is sent (null = acceptable). A cross-field rule of the owner (purge >= visible) is checked here too. */
export function validateConfig(kind: ConfigKind, values: Readonly<Record<string, number | boolean>>): string | undefined {
  for (const field of CONFIG_FIELDS[kind]) {
    const value = values[field.key];
    if (field.type === 'boolean') {
      if (typeof value !== 'boolean') {
        return `${field.label}: chọn bật hoặc tắt.`;
      }
    } else if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (field.min ?? 0) || value > (field.max ?? Number.MAX_SAFE_INTEGER)) {
      return `${field.label}: nhập số nguyên từ ${String(field.min ?? 0)} đến ${(field.max ?? 0).toLocaleString('vi-VN')}.`;
    }
  }
  if (kind === 'NOTIFICATION' && (values.purge_days as number) < (values.visible_days as number)) {
    return 'Số ngày giữ trước khi dọn phải không nhỏ hơn số ngày hiển thị.';
  }
  return undefined;
}

export const CONFIG_REFUSAL: Record<string, string> = {
  SYSTEM_SETTING_VERSION_CONFLICT: 'Cấu hình vừa được người khác thay đổi. Hãy tải lại.',
  ORDER_PARAMETER_VERSION_CONFLICT: 'Cấu hình vừa được người khác thay đổi. Hãy tải lại.',
  OTP_POLICY_VERSION_CONFLICT: 'Cấu hình vừa được người khác thay đổi. Hãy tải lại.',
  ADMIN_INPUT_INVALID: 'Giá trị hoặc lý do không hợp lệ (lý do bắt buộc, tối đa 500 ký tự).',
};

export const GROUP_ORDER: readonly ConfigGroupKey[] = ['security', 'shipper_wallet', 'delivery_policy', 'orders', 'notifications', 'map_gps', 'storage_backup'];

/** One line of the history in words: who changed which value from what to what. Unknown shapes are shown as "Đã thay đổi cấu hình" rather than guessed. */
export function describeChange(change: ConfigChange): string {
  const m = change.metadata;
  const yesNo = (value: unknown): string => (value === true ? 'bật' : value === false ? 'tắt' : String(value));
  if ('to_values' in m && typeof m.to_values === 'object' && m.to_values !== null && typeof m.from_values === 'object' && m.from_values !== null) {
    // Issue #117: the SMS OTP limits (before / after of every value that changed).
    const from = m.from_values as Record<string, unknown>;
    const to = m.to_values as Record<string, unknown>;
    const lines = OTP_POLICY_FIELDS.filter((field) => from[field.key] !== to[field.key]).map((field) => `${field.label}: ${String(from[field.key])} → ${String(to[field.key])} ${field.unit}`);
    return lines.length === 0 ? 'Đã thay đổi giới hạn SMS & OTP' : lines.join('; ');
  }
  if ('setting_key' in m) {
    return `${m.setting_key === 'otp_registration_enabled' ? 'OTP khi đăng ký' : 'OTP khi quên mật khẩu'}: ${yesNo(m.old_value)} → ${yesNo(m.new_value)}`;
  }
  if ('param_key' in m) {
    if (m.param_key === 'fee_answer_minutes') {
      return `Thời gian trả lời đề xuất phí: ${Number(m.old_value).toLocaleString('vi-VN')} phút → ${Number(m.new_value).toLocaleString('vi-VN')} phút`;
    }
    return `${m.param_key === 'topup_min_vnd' ? 'Nạp tối thiểu' : 'Rút tối thiểu'}: ${Number(m.old_value).toLocaleString('vi-VN')} đ → ${Number(m.new_value).toLocaleString('vi-VN')} đ`;
  }
  const pairs: string[] = [];
  for (const key of Object.keys(m)) {
    if (key.startsWith('from_')) {
      const to = m[`to_${key.slice(5)}`];
      if (to !== undefined && to !== m[key]) {
        pairs.push(`${key.slice(5)}: ${String(m[key])} → ${String(to)}`);
      }
    }
  }
  return pairs.length === 0 ? 'Đã thay đổi cấu hình' : pairs.join('; ');
}
