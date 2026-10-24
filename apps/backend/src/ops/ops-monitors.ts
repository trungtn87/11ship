import { CheckReport } from './ops-engine';
import { CHECK_BACKUP, CHECK_HTTPS, CHECK_OTP_SEND, CHECK_RESTORE_TEST, GatewayFacet, gatewayCheckKey } from './ops-constants';
import { OpsSettings } from './ops-settings';

// Pure evaluators: facts in, a verdict out. No clock, no database, no network, so each rule of the approved design can be tested by feeding it numbers.
// Three rules hold everywhere (design sections 3 and 5): a missing measurement is UNKNOWN ("Chưa có dữ liệu"), never OK; a cause is named only when the
// evidence proves it; every threshold comes from the settings (SYSTEM edits them), never from a literal here.

const num = (settings: OpsSettings, key: string): number => settings[key] as number;
const minutes = (ms: number): number => Math.max(0, Math.floor(ms / 60_000));

// ---- SMS gateway ---------------------------------------------------------------------------------------------------------------------

export interface GatewayFacts {
  readonly deviceId: string;
  readonly label: string;
  readonly nowMs: number;
  readonly lastSeenAtMs: number | null;
  readonly paused: boolean | null;
  readonly smsPermission: boolean | null;
  readonly telemetry: { readonly reportedAtMs: number; readonly batteryPercent: number | null; readonly charging: boolean | null; readonly powerChangedAtMs: number | null; readonly simState: string | null } | null;
  /** Latest final results of this device, newest first. */
  readonly recentResults: readonly { readonly status: string }[];
}

const GATEWAY_IMPACT = 'Mã OTP đăng ký / quên mật khẩu có thể chậm hoặc không gửi được';

function gatewayStale(f: GatewayFacts, settings: OpsSettings): boolean {
  // Telemetry older than the "warning" silence is not evidence about the phone now.
  return f.telemetry === null || f.nowMs - f.telemetry.reportedAtMs > num(settings, 'gateway.contact_warn_seconds') * 1000;
}

/** The checks of one paired phone. Keys are `gateway.<device id>.<facet>`. */
export function evaluateGateway(f: GatewayFacts, settings: OpsSettings): CheckReport[] {
  const out: CheckReport[] = [];
  const key = (facet: GatewayFacet): string => gatewayCheckKey(f.deviceId, facet);
  const base = { source: 'SMS_GATEWAY' as const, staleAfterSeconds: 300 };
  const name = f.label;

  // Contact: the one fact is "when did the server last hear from it".
  if (f.lastSeenAtMs === null) {
    out.push({ ...base, checkKey: key('contact'), state: 'UNKNOWN', value: { last_contact_at: null }, evidenceCode: 'NEVER_CONTACTED', title: `Gateway ${name} chưa từng liên lạc`, impact: GATEWAY_IMPACT });
  } else {
    const silent = f.nowMs - f.lastSeenAtMs;
    const state = silent >= num(settings, 'gateway.contact_critical_seconds') * 1000 ? 'CRITICAL' : silent >= num(settings, 'gateway.contact_warn_seconds') * 1000 ? 'WARNING' : 'OK';
    out.push({
      ...base,
      checkKey: key('contact'),
      state,
      value: { last_contact_at: new Date(f.lastSeenAtMs).toISOString(), silent_seconds: Math.floor(silent / 1000), last_reported_paused: f.paused, sms_permission: f.smsPermission },
      evidenceCode: state === 'OK' ? 'CONTACT_OK' : 'NO_SIGNAL',
      // The text says only what is known: no signal. It never says the phone is off, offline or out of battery.
      title: `Gateway ${name}: không nhận được tín hiệu từ Gateway`,
      impact: GATEWAY_IMPACT,
    });
  }

  // Battery: only "low AND not charging" is a problem; low with unknown charging is "not determined".
  const t = f.telemetry;
  if (t === null || t.batteryPercent === null || gatewayStale(f, settings)) {
    out.push({ ...base, checkKey: key('battery'), state: 'UNKNOWN', value: { battery_percent: t?.batteryPercent ?? null }, evidenceCode: 'NO_RECENT_REPORT', title: `Gateway ${name}: pin`, impact: GATEWAY_IMPACT });
  } else {
    const low = t.batteryPercent <= num(settings, 'gateway.battery_warn_percent');
    const state = t.charging === true || !low ? 'OK' : t.charging === null ? 'UNKNOWN' : t.batteryPercent <= num(settings, 'gateway.battery_critical_percent') ? 'CRITICAL' : 'WARNING';
    out.push({
      ...base,
      checkKey: key('battery'),
      state,
      value: { battery_percent: t.batteryPercent, charging: t.charging },
      evidenceCode: state === 'OK' ? 'BATTERY_OK' : state === 'UNKNOWN' ? 'CHARGING_UNKNOWN' : 'BATTERY_LOW',
      title: `Gateway ${name}: pin ${t.batteryPercent}% và không sạc`,
      impact: GATEWAY_IMPACT,
    });
  }

  // Power: unplugged continuously for the configured time.
  if (t === null || t.charging === null || gatewayStale(f, settings)) {
    out.push({ ...base, checkKey: key('power'), state: 'UNKNOWN', value: { charging: t?.charging ?? null }, evidenceCode: 'NO_RECENT_REPORT', title: `Gateway ${name}: nguồn`, impact: GATEWAY_IMPACT });
  } else if (t.charging) {
    out.push({ ...base, checkKey: key('power'), state: 'OK', value: { charging: true }, evidenceCode: 'CHARGING', title: `Gateway ${name}: nguồn`, impact: GATEWAY_IMPACT });
  } else {
    const since = t.powerChangedAtMs;
    const unplugged = since === null ? null : f.nowMs - since;
    const state = unplugged === null ? 'UNKNOWN' : unplugged >= num(settings, 'gateway.unplug_warn_seconds') * 1000 ? 'WARNING' : 'OK';
    out.push({
      ...base,
      checkKey: key('power'),
      state,
      value: { charging: false, unplugged_minutes: unplugged === null ? null : minutes(unplugged) },
      evidenceCode: state === 'WARNING' ? 'UNPLUGGED' : 'POWER_OK',
      title: `Gateway ${name}: ngắt sạc liên tục ${unplugged === null ? '' : `${minutes(unplugged)} phút`}`.trim(),
      impact: GATEWAY_IMPACT,
    });
  }

  // Consecutive failed sends. Only a FAILED the phone reported counts; UNKNOWN (no acknowledgement) is not known to have failed, and no cause is named.
  const need = num(settings, 'gateway.send_fail_count');
  const results = f.recentResults;
  if (results.length === 0) {
    out.push({ ...base, checkKey: key('sms_failures'), state: 'UNKNOWN', value: { recent: 0 }, evidenceCode: 'NO_SENDS_YET', title: `Gateway ${name}: gửi SMS`, impact: GATEWAY_IMPACT });
  } else {
    let streak = 0;
    for (const r of results) {
      if (r.status !== 'FAILED') break;
      streak += 1;
    }
    out.push({
      ...base,
      checkKey: key('sms_failures'),
      state: streak >= need ? 'CRITICAL' : 'OK',
      value: { consecutive_failed: streak, threshold: need },
      evidenceCode: streak >= need ? 'SEND_FAILED_STREAK' : 'SEND_OK',
      title: `Gateway ${name}: ${need} SMS liên tiếp gửi thất bại`,
      impact: GATEWAY_IMPACT,
    });
  }
  return out;
}

export interface OtpQueueFacts {
  readonly nowMs: number;
  readonly activeDevices: number;
  /** When the oldest still-valid queued OTP was created; null = none waits. */
  readonly oldestValidQueuedAtMs: number | null;
  readonly queued: number;
}

/** A valid OTP that has been waiting longer than the setting (design section 3). With no gateway paired and nothing waiting there is nothing to judge. */
export function evaluateOtpQueue(f: OtpQueueFacts, settings: OpsSettings): CheckReport {
  const base = { source: 'SMS_GATEWAY' as const, checkKey: CHECK_OTP_SEND, staleAfterSeconds: 300, title: 'Hàng đợi OTP chậm', impact: 'Người dùng chờ mã OTP lâu hơn bình thường khi đăng ký / quên mật khẩu' };
  if (f.oldestValidQueuedAtMs === null) {
    return f.activeDevices === 0 ? { ...base, state: 'UNKNOWN', value: { queued: f.queued, devices: 0 }, evidenceCode: 'NO_GATEWAY_PAIRED' } : { ...base, state: 'OK', value: { queued: f.queued }, evidenceCode: 'QUEUE_EMPTY' };
  }
  const waited = f.nowMs - f.oldestValidQueuedAtMs;
  const slow = waited >= num(settings, 'gateway.queue_slow_seconds') * 1000;
  return { ...base, state: slow ? 'WARNING' : 'OK', value: { queued: f.queued, oldest_wait_seconds: Math.floor(waited / 1000), devices: f.activeDevices }, evidenceCode: slow ? 'OTP_WAITING' : 'QUEUE_OK' };
}

// ---- machine -------------------------------------------------------------------------------------------------------------------------

export function evaluateDisk(label: string, usedPercent: number | null, settings: OpsSettings): CheckReport {
  const base = { source: 'SERVER' as const, checkKey: `disk.${label}`, staleAfterSeconds: 300, title: `Đĩa ${label} gần đầy`, impact: 'Cơ sở dữ liệu, log hoặc sao lưu có thể ngừng ghi được' };
  if (usedPercent === null) {
    return { ...base, state: 'UNKNOWN', value: {}, evidenceCode: 'NO_DATA' };
  }
  const state = usedPercent >= num(settings, 'server.disk_critical_percent') ? 'CRITICAL' : usedPercent >= num(settings, 'server.disk_warn_percent') ? 'WARNING' : 'OK';
  return { ...base, state, value: { used_percent: Math.round(usedPercent * 10) / 10 }, evidenceCode: state === 'OK' ? 'DISK_OK' : 'DISK_HIGH' };
}

/**
 * CPU or RAM "at or above the threshold continuously for the sustain time". The samples must really cover that time (a window with too few points is "no
 * data", not "fine"), and one sample below the threshold ends the run.
 */
export function evaluateSustained(
  kind: 'cpu' | 'memory',
  points: readonly { atMs: number; value: number }[],
  nowMs: number,
  settings: OpsSettings,
): CheckReport {
  const key = kind === 'cpu' ? 'server.cpu_percent' : 'server.memory_percent';
  const base = {
    source: 'SERVER' as const,
    checkKey: kind,
    staleAfterSeconds: 300,
    title: kind === 'cpu' ? 'CPU máy chủ cao liên tục' : 'RAM máy chủ cao liên tục',
    impact: 'API và worker có thể chậm hoặc bị hệ điều hành dừng',
  };
  const threshold = num(settings, key);
  const window = num(settings, 'server.sustain_seconds') * 1000;
  const latest = points[points.length - 1];
  if (latest === undefined || nowMs - latest.atMs > 5 * 60_000) {
    return { ...base, state: 'UNKNOWN', value: {}, evidenceCode: 'NO_DATA' };
  }
  const recent = points.filter((p) => nowMs - p.atMs <= window);
  const covers = recent.length >= 2 && (recent[recent.length - 1] as { atMs: number }).atMs - (recent[0] as { atMs: number }).atMs >= window * 0.8;
  const sustained = covers && recent.every((p) => p.value >= threshold);
  if (!covers && latest.value < threshold) {
    return { ...base, state: points.length < 2 ? 'UNKNOWN' : 'OK', value: { percent: Math.round(latest.value * 10) / 10, threshold }, evidenceCode: 'BELOW_THRESHOLD' };
  }
  return { ...base, state: sustained ? 'WARNING' : 'OK', value: { percent: Math.round(latest.value * 10) / 10, threshold, sustained_seconds: sustained ? Math.floor(((recent[recent.length - 1] as { atMs: number }).atMs - (recent[0] as { atMs: number }).atMs) / 1000) : 0 }, evidenceCode: sustained ? 'SUSTAINED_HIGH' : 'NOT_SUSTAINED' };
}

export function evaluateHttps(daysLeft: number | null, settings: OpsSettings): CheckReport {
  const base = { source: 'HTTPS' as const, checkKey: CHECK_HTTPS, staleAfterSeconds: 2 * 3600, title: 'Chứng chỉ HTTPS sắp hết hạn', impact: 'App và Web Admin sẽ không kết nối được khi chứng chỉ hết hạn' };
  if (daysLeft === null) {
    return { ...base, state: 'UNKNOWN', value: {}, evidenceCode: 'NO_DATA' };
  }
  const state = daysLeft <= num(settings, 'server.https_critical_days') ? 'CRITICAL' : daysLeft <= num(settings, 'server.https_warn_days') ? 'WARNING' : 'OK';
  return { ...base, state, value: { days_left: Math.floor(daysLeft) }, evidenceCode: state === 'OK' ? 'CERT_OK' : 'CERT_EXPIRING' };
}

// ---- backup --------------------------------------------------------------------------------------------------------------------------

export interface BackupFacts {
  readonly nowMs: number;
  readonly latest: { readonly ok: boolean; readonly finishedAtMs: number; readonly detailCode: string | null } | null;
  readonly lastOkAtMs: number | null;
}

/**
 * What the backup job (ops/backup/backup.sh) can say when it fails. Only these codes become words; any other code is shown as the generic failure. They are causes the job
 * measured itself (a command's exit status), never a guess, and none of them carries a secret or customer data.
 */
export const BACKUP_FAILURE_TEXT: Readonly<Record<string, string>> = {
  DRIVE_NOT_CONFIGURED: 'Sao lưu chưa được nối với Google Drive',
  DRIVE_AUTH: 'Google Drive từ chối quyền truy cập (cần kết nối lại)',
  DRIVE_QUOTA: 'Google Drive đã đầy dung lượng',
  UPLOAD_FAILED: 'Tải bản sao lưu lên Google Drive thất bại',
  UPLOAD_VERIFY: 'Bản sao trên Google Drive không khớp với bản gốc',
  ENCRYPT_FAILED: 'Mã hóa bản sao lưu thất bại',
  DUMP_FAILED: 'Sao lưu cơ sở dữ liệu thất bại',
  PG_TOOL_OLD: 'Công cụ sao lưu PostgreSQL cũ hơn máy chủ cơ sở dữ liệu',
  VERIFY_RESTORE: 'Khôi phục thử bản sao lưu thất bại',
  SPOOL_FULL: 'Thư mục sao lưu trên VPS đã đầy',
  DISK_LOW: 'Dung lượng trống trên VPS không đủ để sao lưu',
  PASSPHRASE_MISSING: 'Thiếu khóa mã hóa bản sao lưu',
  FILES_FAILED: 'Sao lưu tệp ảnh thất bại',
};

/** A successful backup and a successful restore test are two facts. This is the backup: failed, or older than the configured schedule. */
export function evaluateBackup(f: BackupFacts, settings: OpsSettings): CheckReport {
  const base = { source: 'BACKUP' as const, checkKey: CHECK_BACKUP, staleAfterSeconds: 7 * 86400, title: 'Sao lưu cơ sở dữ liệu có vấn đề', impact: 'Nếu máy chủ hỏng sẽ khó khôi phục dữ liệu gần nhất' };
  if (f.latest === null) {
    return { ...base, state: 'UNKNOWN', value: {}, evidenceCode: 'NO_REPORT' };
  }
  const maxAge = num(settings, 'server.backup_max_age_hours') * 3_600_000;
  if (!f.latest.ok) {
    return { ...base, state: 'WARNING', value: { last_result: 'FAILED', last_ok_at: f.lastOkAtMs === null ? null : new Date(f.lastOkAtMs).toISOString(), detail: f.latest.detailCode }, evidenceCode: 'BACKUP_FAILED', title: `Sao lưu thất bại: ${BACKUP_FAILURE_TEXT[f.latest.detailCode ?? ''] ?? 'cơ sở dữ liệu chưa được sao lưu'}` };
  }
  const age = f.nowMs - (f.lastOkAtMs ?? f.latest.finishedAtMs);
  if (age > maxAge) {
    return { ...base, state: 'WARNING', value: { last_ok_at: new Date(f.lastOkAtMs ?? f.latest.finishedAtMs).toISOString(), age_hours: Math.floor(age / 3_600_000) }, evidenceCode: 'BACKUP_OVERDUE', title: `Quá ${String(num(settings, 'server.backup_max_age_hours'))} giờ chưa có bản sao lưu ngoài VPS thành công` };
  }
  return { ...base, state: 'OK', value: { last_ok_at: new Date(f.lastOkAtMs ?? f.latest.finishedAtMs).toISOString(), age_hours: Math.floor(age / 3_600_000) }, evidenceCode: 'BACKUP_OK' };
}

/**
 * The restore test, reported by the job that did it. "Never tested" is UNKNOWN (shown as "chưa thử khôi phục"), never green; a failed test is a warning,
 * because a backup nobody could restore is not a backup.
 */
export function evaluateRestoreTest(f: BackupFacts): CheckReport {
  const base = { source: 'BACKUP' as const, checkKey: CHECK_RESTORE_TEST, staleAfterSeconds: 90 * 86400, title: 'Thử khôi phục sao lưu thất bại', impact: 'Chưa chắc bản sao lưu dùng được khi cần khôi phục' };
  if (f.latest === null) {
    return { ...base, state: 'UNKNOWN', value: {}, evidenceCode: 'NEVER_TESTED' };
  }
  return f.latest.ok
    ? { ...base, state: 'OK', value: { last_ok_at: new Date(f.lastOkAtMs ?? f.latest.finishedAtMs).toISOString() }, evidenceCode: 'RESTORE_OK' }
    : { ...base, state: 'WARNING', value: { last_result: 'FAILED', detail: f.latest.detailCode }, evidenceCode: 'RESTORE_FAILED' };
}

// ---- worker / queue ------------------------------------------------------------------------------------------------------------------

export interface QueueFacts {
  readonly pending: number;
  /** Age of the oldest event that is already due and still unpublished; null = nothing is due. */
  readonly oldestDueAgeMs: number | null;
  /** The last measurements of `pending`, oldest first. */
  readonly history: readonly number[];
}

/** Overdue work, or a queue that keeps growing (strictly, over the configured number of samples) and is not tiny. */
export function evaluateQueue(f: QueueFacts, settings: OpsSettings): CheckReport {
  const base = { source: 'WORKER' as const, checkKey: 'outbox', staleAfterSeconds: 300, title: 'Hàng đợi sự kiện bị tồn', impact: 'Thông báo và các việc nền có thể bị chậm' };
  const samples = num(settings, 'server.queue_growth_samples');
  const tail = f.history.slice(-samples);
  let growing = tail.length >= samples && (tail[tail.length - 1] as number) >= 20;
  for (let i = 1; i < tail.length && growing; i += 1) {
    growing = (tail[i] as number) > (tail[i - 1] as number);
  }
  const overdue = f.oldestDueAgeMs !== null && f.oldestDueAgeMs >= num(settings, 'server.outbox_lag_seconds') * 1000;
  const state = overdue || growing ? 'WARNING' : 'OK';
  return {
    ...base,
    state,
    value: { pending: f.pending, oldest_due_seconds: f.oldestDueAgeMs === null ? null : Math.floor(f.oldestDueAgeMs / 1000), growing },
    evidenceCode: overdue ? 'QUEUE_OVERDUE' : growing ? 'QUEUE_GROWING' : 'QUEUE_OK',
  };
}

// ---- app / M08 / M14 -----------------------------------------------------------------------------------------------------------------

/** Errors an app (or a service) reported, grouped by version: enough of them from enough different reporters opens an incident. A single crash does not. */
export function evaluateErrorBurst(
  o: { source: 'APP_FOOD' | 'APP_SHIP' | 'M14' | 'NOTIFICATIONS'; label: string; version: string | null; errors: number; reporters: number },
  settings: OpsSettings,
): CheckReport {
  const need = num(settings, 'app.error_burst_count');
  const reporters = num(settings, 'app.error_burst_reporters');
  const breach = o.errors >= need && o.reporters >= reporters;
  const safe = (o.version ?? 'all').toLowerCase().replace(/[^a-z0-9._-]/g, '_');
  return {
    source: o.source,
    checkKey: `client.${o.source.toLowerCase()}.${safe}`.slice(0, 64),
    state: breach ? 'WARNING' : 'OK',
    value: { errors: o.errors, reporters: o.reporters, window_threshold: need, version: o.version },
    evidenceCode: breach ? 'ERROR_BURST' : 'ERRORS_BELOW_THRESHOLD',
    staleAfterSeconds: 600,
    title: `${o.label}${o.version === null ? '' : ` ${o.version}`}: nhiều lỗi được báo về`,
    impact: 'Một số người dùng có thể gặp lỗi thao tác trong app. Chưa chứng minh toàn hệ thống lỗi (app tắt hay chưa nhận push không được tính)',
  };
}
