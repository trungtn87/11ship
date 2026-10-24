// Model of "Hệ thống › Tham số hệ thống › SMS & OTP" (issue #117): the six limits of the OTP SMS flow. PLAIN DATA, the strict parser of the server's
// answer, the validation (the server and PostgreSQL check again) and the HTTP client. The page holds no value of its own: every number is the server's.

import { ApiClient, ApiResult, record, str } from './api.js';

export const OTP_POLICY_PATH = '/admin/system-settings/otp-policy';

export type OtpPolicyKey = 'cooldown_seconds' | 'max_wrong_attempts' | 'phone_per_hour' | 'phone_per_day' | 'ip_per_hour' | 'global_per_day';

export interface OtpPolicyField {
  readonly key: OtpPolicyKey;
  readonly label: string;
  readonly unit: string;
  readonly help: string;
}

export const OTP_POLICY_FIELDS: readonly OtpPolicyField[] = [
  { key: 'cooldown_seconds', label: 'Chờ giữa hai lần yêu cầu OTP của cùng một số điện thoại', unit: 'giây', help: 'Dùng chung cho đăng ký, quên mật khẩu, khôi phục tài khoản và cả hai app 11Food / 11Ship. Vẫn tính khi người dùng nhập sai mã và quay về bước đầu.' },
  { key: 'max_wrong_attempts', label: 'Số lần nhập sai tối đa cho mỗi mã OTP', unit: 'lần', help: 'Sai đủ số lần này, mã bị khóa và luồng đăng ký / quên mật khẩu đang làm bị hủy. Tài khoản đã có không bị ảnh hưởng.' },
  { key: 'phone_per_hour', label: 'Số yêu cầu OTP tối đa của một số điện thoại trong 1 giờ', unit: 'lần', help: 'Cửa sổ trượt 1 giờ, tính chung mọi luồng và hai app.' },
  { key: 'phone_per_day', label: 'Số yêu cầu OTP tối đa của một số điện thoại trong 24 giờ', unit: 'lần', help: 'Cửa sổ trượt 24 giờ; không nhỏ hơn giới hạn theo giờ.' },
  { key: 'ip_per_hour', label: 'Số yêu cầu OTP tối đa của một địa chỉ IP trong 1 giờ', unit: 'lần', help: 'Mạng dùng chung (NAT) chia sẻ một hạn mức; IPv6 tính theo khối /64. Máy chủ chỉ tin địa chỉ do proxy tin cậy chuyển tới.' },
  { key: 'global_per_day', label: 'Tổng số SMS của toàn SMS Gateway trong 24 giờ', unit: 'SMS', help: 'Gồm cả SMS kích hoạt quản trị viên. Chạm mức này thì mọi yêu cầu OTP bị từ chối cho tới khi cửa sổ trượt.' },
];

export type OtpPolicyValues = Readonly<Record<OtpPolicyKey, number>>;
export type OtpPolicyBounds = Readonly<Record<OtpPolicyKey, { readonly min: number; readonly max: number }>>;

export interface OtpPolicyChange {
  readonly version: number;
  readonly oldValues: OtpPolicyValues;
  readonly newValues: OtpPolicyValues;
  readonly reason: string | null;
  readonly changedBy: string;
  readonly changedAt: string;
}

export interface OtpPolicyState {
  readonly version: number;
  readonly values: OtpPolicyValues;
  readonly defaults: OtpPolicyValues;
  readonly bounds: OtpPolicyBounds;
  readonly editable: boolean;
  readonly updatedAt: string;
  readonly history: readonly OtpPolicyChange[];
}

const KEYS: readonly OtpPolicyKey[] = OTP_POLICY_FIELDS.map((field) => field.key);
const isoOf = (value: unknown): string | undefined => {
  const text = str(value);
  return text !== undefined && !Number.isNaN(Date.parse(text)) ? text : undefined;
};

function valuesOf(value: unknown): OtpPolicyValues | undefined {
  const raw = record(value);
  if (raw === undefined) {
    return undefined;
  }
  const out: Partial<Record<OtpPolicyKey, number>> = {};
  for (const key of KEYS) {
    const item = raw[key];
    if (typeof item !== 'number' || !Number.isSafeInteger(item)) {
      return undefined;
    }
    out[key] = item;
  }
  return out as OtpPolicyValues;
}

export function parseOtpPolicy(data: Record<string, unknown>): OtpPolicyState | undefined {
  const values = valuesOf(data);
  const defaults = valuesOf(data.defaults);
  const boundsRaw = record(data.bounds);
  const updatedAt = isoOf(data.updated_at);
  if (values === undefined || defaults === undefined || boundsRaw === undefined || updatedAt === undefined || typeof data.editable !== 'boolean' || !Array.isArray(data.history)) {
    return undefined;
  }
  if (typeof data.version !== 'number' || !Number.isSafeInteger(data.version) || data.version < 1) {
    return undefined;
  }
  const bounds: Partial<Record<OtpPolicyKey, { min: number; max: number }>> = {};
  for (const key of KEYS) {
    const entry = record(boundsRaw[key]);
    if (entry === undefined || !Number.isSafeInteger(entry.min) || !Number.isSafeInteger(entry.max)) {
      return undefined;
    }
    bounds[key] = { min: entry.min as number, max: entry.max as number };
  }
  const history: OtpPolicyChange[] = [];
  for (const entry of data.history) {
    const raw = record(entry);
    const oldValues = valuesOf(raw?.old_values);
    const newValues = valuesOf(raw?.new_values);
    const changedAt = isoOf(raw?.changed_at);
    const changedBy = str(raw?.changed_by);
    if (raw === undefined || oldValues === undefined || newValues === undefined || changedAt === undefined || changedBy === undefined || typeof raw.version !== 'number' || (raw.reason !== null && typeof raw.reason !== 'string')) {
      return undefined;
    }
    history.push({ version: raw.version, oldValues, newValues, reason: raw.reason, changedBy, changedAt });
  }
  return { version: data.version, values, defaults, bounds: bounds as OtpPolicyBounds, editable: data.editable, updatedAt, history };
}

/** Why the draft is refused before anything is sent (undefined = acceptable). The first problem only; the server and the database repeat every rule. */
export function validateOtpPolicy(draft: Readonly<Record<OtpPolicyKey, unknown>>, bounds: OtpPolicyBounds): string | undefined {
  for (const field of OTP_POLICY_FIELDS) {
    const value = draft[field.key];
    const { min, max } = bounds[field.key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
      return `${field.label}: nhập số nguyên từ ${min.toLocaleString('vi-VN')} đến ${max.toLocaleString('vi-VN')}.`;
    }
  }
  if ((draft.phone_per_hour as number) > (draft.phone_per_day as number)) {
    return 'Giới hạn theo 24 giờ của một số điện thoại phải không nhỏ hơn giới hạn theo giờ.';
  }
  return undefined;
}

export type OtpPolicyRefusal = 'forbidden' | 'conflict' | 'invalid' | 'session' | 'unknown';

/** What a failed save means for the person: the code of the server decides, never its text. */
export function refusalOf(result: Exclude<ApiResult<unknown>, { kind: 'ok' }>): OtpPolicyRefusal {
  if (result.kind === 'network') {
    return 'unknown';
  }
  if (result.status === 401) {
    return 'session';
  }
  if (result.status === 403) {
    return result.code === 'ADMIN_FORBIDDEN' ? 'forbidden' : 'session';
  }
  if (result.code === 'OTP_POLICY_VERSION_CONFLICT') {
    return 'conflict';
  }
  if (result.code === 'ADMIN_INPUT_INVALID') {
    return 'invalid';
  }
  return 'unknown';
}

export const OTP_POLICY_MESSAGE: Readonly<Record<OtpPolicyRefusal | 'saved', string>> = {
  saved: 'Đã lưu. Giới hạn mới có hiệu lực ngay cho yêu cầu OTP tiếp theo, không cần khởi động lại máy chủ.',
  forbidden: 'Chỉ tài khoản SYSTEM được sửa giới hạn SMS & OTP.',
  conflict: 'Giới hạn vừa được người khác thay đổi. Hãy tải lại để xem giá trị mới nhất rồi sửa lại.',
  invalid: 'Máy chủ từ chối giá trị này. Kiểm tra khoảng cho phép và lý do (tối đa 500 ký tự).',
  session: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.',
  unknown: 'Chưa xác nhận được kết quả. Bấm Lưu để thử lại đúng yêu cầu cũ, hoặc tải lại giá trị hiện tại.',
};

export interface OtpPolicySave {
  readonly expectedVersion: number;
  readonly values: OtpPolicyValues;
  readonly reason: string;
}

export class OtpPolicyApi extends ApiClient {
  read(): Promise<ApiResult<OtpPolicyState>> {
    return this.call({ method: 'GET', path: OTP_POLICY_PATH }, parseOtpPolicy);
  }

  /** Sends exactly one request per call; the caller keeps the Idempotency-Key of one intent, so an unknown outcome is retried with the same key. */
  save(csrf: string, save: OtpPolicySave, key: string): Promise<ApiResult<OtpPolicyState>> {
    const reason = save.reason.trim();
    return this.call(
      { method: 'POST', path: OTP_POLICY_PATH, csrf, idempotencyKey: key, body: { expected_version: save.expectedVersion, ...save.values, ...(reason === '' ? {} : { reason }) } },
      parseOtpPolicy,
    );
  }
}
