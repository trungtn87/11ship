// The thresholds and retention periods of M13: one registry, one place that knows the defaults of the approved design (section 3, 5, 8, 11) and the
// bounds SYSTEM may move them within. The database stores only the keys SYSTEM changed; an absent key is the default, so a default is never "lost".
// A few keys are not in the approved text (marked `impl`): they bound behaviour the design leaves open and are SYSTEM-editable like the rest.

export interface SettingDef {
  readonly key: string;
  readonly default: number;
  readonly min: number;
  readonly max: number;
  readonly unit: 'seconds' | 'minutes' | 'hours' | 'days' | 'percent' | 'count';
  readonly group: 'gateway' | 'server' | 'alert' | 'app' | 'retention';
  /** True when the value is an implementation default the approved text does not give. */
  readonly impl: boolean;
  readonly label: string;
}

const def = (key: string, group: SettingDef['group'], label: string, value: number, min: number, max: number, unit: SettingDef['unit'], impl = false): SettingDef => ({
  key,
  default: value,
  min,
  max,
  unit,
  group,
  impl,
  label,
});

export const SETTING_DEFS: readonly SettingDef[] = [
  // Gateway (design section 3)
  def('gateway.contact_warn_seconds', 'gateway', 'Vắng liên lạc: cảnh báo', 180, 60, 3600, 'seconds'),
  def('gateway.contact_critical_seconds', 'gateway', 'Vắng liên lạc: nghiêm trọng', 300, 120, 7200, 'seconds'),
  def('gateway.battery_warn_percent', 'gateway', 'Pin thấp, không sạc: cảnh báo', 20, 5, 50, 'percent'),
  def('gateway.battery_critical_percent', 'gateway', 'Pin thấp, không sạc: nghiêm trọng', 10, 1, 30, 'percent'),
  def('gateway.unplug_warn_seconds', 'gateway', 'Ngắt sạc liên tục: cảnh báo nguồn', 300, 60, 7200, 'seconds'),
  def('gateway.send_fail_count', 'gateway', 'Số SMS liên tiếp thất bại thành sự cố', 3, 2, 20, 'count'),
  def('gateway.queue_slow_seconds', 'gateway', 'OTP còn hiệu lực chờ quá', 60, 30, 600, 'seconds'),
  // Server (section 5)
  def('server.api_failures', 'server', 'API: số lần lỗi liên tiếp mở sự cố', 3, 2, 20, 'count'),
  def('server.db_failures', 'server', 'Database: số lần lỗi liên tiếp mở sự cố', 3, 2, 20, 'count'),
  def('server.disk_warn_percent', 'server', 'Đĩa: cảnh báo', 85, 50, 95, 'percent'),
  def('server.disk_critical_percent', 'server', 'Đĩa: nghiêm trọng', 95, 60, 99, 'percent'),
  def('server.cpu_percent', 'server', 'CPU: ngưỡng liên tục', 85, 50, 100, 'percent'),
  def('server.memory_percent', 'server', 'RAM: ngưỡng liên tục', 90, 50, 100, 'percent'),
  def('server.sustain_seconds', 'server', 'CPU/RAM: thời gian vượt ngưỡng liên tục', 300, 60, 3600, 'seconds'),
  def('server.worker_stale_seconds', 'server', 'Worker: không có nhịp quá', 180, 60, 3600, 'seconds'),
  def('server.outbox_lag_seconds', 'server', 'Hàng đợi sự kiện: tác vụ quá hạn', 300, 60, 7200, 'seconds', true),
  def('server.queue_growth_samples', 'server', 'Hàng đợi tăng liên tục qua số lần đo', 5, 3, 30, 'count', true),
  def('server.https_warn_days', 'server', 'HTTPS: còn ít hơn (cảnh báo)', 14, 3, 60, 'days'),
  def('server.https_critical_days', 'server', 'HTTPS: còn ít hơn (nâng mức)', 3, 1, 30, 'days'),
  def('server.backup_max_age_hours', 'server', 'Sao lưu: quá hạn sau', 26, 1, 720, 'hours'),
  // Alerts (section 8)
  def('alert.reminder_warning_minutes', 'alert', 'Nhắc cảnh báo chưa nhận xử lý', 30, 5, 1440, 'minutes'),
  def('alert.reminder_critical_minutes', 'alert', 'Nhắc nghiêm trọng chưa nhận xử lý', 10, 5, 1440, 'minutes'),
  def('alert.discord_retry_max', 'alert', 'Discord: số lần gửi lại tối đa', 5, 1, 10, 'count', true),
  def('alert.discord_retry_base_seconds', 'alert', 'Discord: giãn cách gửi lại cơ sở', 30, 5, 3600, 'seconds', true),
  def('alert.discord_max_per_run', 'alert', 'Discord: số tin tối đa mỗi lượt (chống dồn tin)', 5, 1, 20, 'count', true),
  def('alert.snooze_max_minutes', 'alert', 'Tạm hoãn tối đa', 1440, 10, 4320, 'minutes', true),
  def('alert.auto_close_hours', 'alert', 'Tự đóng sự cố đã phục hồi sau', 24, 1, 720, 'hours', true),
  // App / M08 / M14 (section 7; thresholds are implementation defaults)
  def('app.error_burst_count', 'app', 'Lỗi app: số lần trong cửa sổ mở sự cố', 5, 2, 200, 'count', true),
  def('app.error_burst_minutes', 'app', 'Lỗi app: cửa sổ đếm', 15, 5, 240, 'minutes', true),
  def('app.error_burst_reporters', 'app', 'Lỗi app: số thiết bị/tài khoản khác nhau tối thiểu', 2, 1, 50, 'count', true),
  def('notifications.failed_push_count', 'app', 'Thông báo đẩy lỗi (không tính chưa cấu hình) để cảnh báo', 5, 1, 500, 'count', true),
  // Retention (section 11)
  def('retention.tech_days', 'retention', 'Log kỹ thuật thường', 30, 7, 365, 'days'),
  def('retention.error_days', 'retention', 'Log lỗi', 90, 30, 730, 'days'),
  def('retention.metrics_detail_days', 'retention', 'Chỉ số chi tiết', 7, 1, 90, 'days'),
  def('retention.metrics_hourly_days', 'retention', 'Chỉ số tổng hợp theo giờ', 90, 30, 730, 'days'),
  def('retention.incident_days', 'retention', 'Sự cố và lịch sử cảnh báo', 365, 90, 1825, 'days'),
  // #191: how long the chat of an order stays readable AFTER its file closes (Owner 2026-10-25: 7 days by default; the old 30-day floor was only a proposal).
  def('chat.retention_days', 'retention', 'Trao đổi đơn hàng: số ngày xem lại sau khi hồ sơ đóng', 7, 1, 365, 'days'),
  def('retention.admin_days', 'retention', 'Nhật ký quản trị (tối thiểu 365 ngày)', 365, 365, 3650, 'days'),
];

export type SettingKey = string;
export type OpsSettings = Readonly<Record<SettingKey, number>>;

const BY_KEY: ReadonlyMap<string, SettingDef> = new Map(SETTING_DEFS.map((d) => [d.key, d]));

export function defaultSettings(): OpsSettings {
  return Object.freeze(Object.fromEntries(SETTING_DEFS.map((d) => [d.key, d.default])));
}

/** Effective values: the defaults with the stored overrides on top. A stored key that no longer exists, or is out of bounds, is ignored (default wins): never a crash. */
export function resolveSettings(overrides: unknown): OpsSettings {
  const result: Record<string, number> = { ...defaultSettings() };
  if (typeof overrides === 'object' && overrides !== null && !Array.isArray(overrides)) {
    for (const [key, value] of Object.entries(overrides)) {
      const d = BY_KEY.get(key);
      if (d !== undefined && typeof value === 'number' && Number.isInteger(value) && value >= d.min && value <= d.max) {
        result[key] = value;
      }
    }
  }
  return Object.freeze(result);
}

export type SettingsProblem = 'UNKNOWN_KEY' | 'NOT_INTEGER' | 'OUT_OF_RANGE' | 'ORDER';

export interface SettingsCheck {
  readonly ok: boolean;
  readonly problem?: SettingsProblem;
  readonly key?: string;
}

/** Pairs that must keep their order after the change: [lower, higher]. */
const ORDER: readonly (readonly [string, string])[] = [
  ['gateway.contact_warn_seconds', 'gateway.contact_critical_seconds'],
  ['gateway.battery_critical_percent', 'gateway.battery_warn_percent'],
  ['server.disk_warn_percent', 'server.disk_critical_percent'],
  ['server.https_critical_days', 'server.https_warn_days'],
  ['retention.tech_days', 'retention.error_days'],
  ['retention.metrics_detail_days', 'retention.metrics_hourly_days'],
];

/** Validates a PATCH of values (keys not in the patch keep their current value) and the order rules on the merged result. */
export function checkSettingsPatch(patch: Readonly<Record<string, unknown>>, current: OpsSettings): SettingsCheck {
  for (const [key, value] of Object.entries(patch)) {
    const d = BY_KEY.get(key);
    if (d === undefined) {
      return { ok: false, problem: 'UNKNOWN_KEY', key };
    }
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      return { ok: false, problem: 'NOT_INTEGER', key };
    }
    if (value < d.min || value > d.max) {
      return { ok: false, problem: 'OUT_OF_RANGE', key };
    }
  }
  const merged = { ...current, ...(patch as Record<string, number>) };
  for (const [lower, higher] of ORDER) {
    if ((merged[lower] as number) >= (merged[higher] as number)) {
      return { ok: false, problem: 'ORDER', key: higher };
    }
  }
  return { ok: true };
}

/** The overrides to store: only values that differ from the default (so "reset to default" is simply the same value again). */
export function overridesOf(values: OpsSettings): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of SETTING_DEFS) {
    const v = values[d.key];
    if (v !== undefined && v !== d.default) {
      out[d.key] = v;
    }
  }
  return out;
}
