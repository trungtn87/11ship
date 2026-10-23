import { describe, expect, it } from '@jest/globals';
import { evaluateBackup, evaluateDisk, evaluateErrorBurst, evaluateGateway, evaluateHttps, evaluateOtpQueue, evaluateQueue, evaluateRestoreTest, evaluateSustained, GatewayFacts } from './ops-monitors';
import { defaultSettings } from './ops-settings';

const s = defaultSettings();
const NOW = 1_800_000_000_000;
const MIN = 60_000;
const facts = (o: Partial<GatewayFacts> = {}): GatewayFacts => ({
  deviceId: 'dev1',
  label: 'Gateway 01',
  nowMs: NOW,
  lastSeenAtMs: NOW - 10_000,
  paused: false,
  smsPermission: true,
  telemetry: { reportedAtMs: NOW - 10_000, batteryPercent: 80, charging: true, powerChangedAtMs: NOW - 3_600_000, simState: 'READY' },
  recentResults: [{ status: 'SENT' }],
  ...o,
});
const by = (reports: ReturnType<typeof evaluateGateway>, facet: string) => reports.find((r) => r.checkKey === `gateway.dev1.${facet}`);

describe('M13 gateway rules (design section 3)', () => {
  it('healthy phone: every facet is OK', () => {
    const r = evaluateGateway(facts(), s);
    expect(r.map((x) => x.state)).toEqual(['OK', 'OK', 'OK', 'OK']);
  });

  it('contact: 3 minutes = warning, 5 minutes = critical, and the words name no cause', () => {
    expect(by(evaluateGateway(facts({ lastSeenAtMs: NOW - 2 * MIN }), s), 'contact')?.state).toBe('OK');
    const warn = by(evaluateGateway(facts({ lastSeenAtMs: NOW - 3 * MIN }), s), 'contact');
    expect(warn?.state).toBe('WARNING');
    const crit = by(evaluateGateway(facts({ lastSeenAtMs: NOW - 5 * MIN }), s), 'contact');
    expect(crit?.state).toBe('CRITICAL');
    const words = `${crit?.title} ${crit?.impact} ${crit?.evidenceCode}`.toLowerCase();
    expect(words).toContain('không nhận được tín hiệu');
    for (const guess of ['hết pin', 'mất mạng', 'tắt máy', 'sim', 'hết tiền']) expect(words).not.toContain(guess);
  });

  it('a phone that never contacted is "no data", not healthy and not an alarm', () => {
    expect(by(evaluateGateway(facts({ lastSeenAtMs: null, telemetry: null }), s), 'contact')?.state).toBe('UNKNOWN');
  });

  it('battery: <=20% not charging warns, <=10% is critical, charging is fine, unknown charging is not decided', () => {
    const t = (batteryPercent: number, charging: boolean | null) => ({ reportedAtMs: NOW - 5000, batteryPercent, charging, powerChangedAtMs: NOW - 4000_000, simState: 'READY' });
    expect(by(evaluateGateway(facts({ telemetry: t(20, false) }), s), 'battery')?.state).toBe('WARNING');
    expect(by(evaluateGateway(facts({ telemetry: t(21, false) }), s), 'battery')?.state).toBe('OK');
    expect(by(evaluateGateway(facts({ telemetry: t(10, false) }), s), 'battery')?.state).toBe('CRITICAL');
    expect(by(evaluateGateway(facts({ telemetry: t(5, true) }), s), 'battery')?.state).toBe('OK');
    expect(by(evaluateGateway(facts({ telemetry: t(5, null) }), s), 'battery')?.state).toBe('UNKNOWN');
  });

  it('stale telemetry is not evidence about the phone now', () => {
    const old = { reportedAtMs: NOW - 30 * MIN, batteryPercent: 5, charging: false, powerChangedAtMs: NOW - 40 * MIN, simState: 'READY' };
    const r = evaluateGateway(facts({ telemetry: old }), s);
    expect(by(r, 'battery')?.state).toBe('UNKNOWN');
    expect(by(r, 'power')?.state).toBe('UNKNOWN');
  });

  it('power: unplugged for 5 continuous minutes warns', () => {
    const t = (since: number) => ({ reportedAtMs: NOW - 5000, batteryPercent: 90, charging: false, powerChangedAtMs: since, simState: 'READY' });
    expect(by(evaluateGateway(facts({ telemetry: t(NOW - 4 * MIN) }), s), 'power')?.state).toBe('OK');
    expect(by(evaluateGateway(facts({ telemetry: t(NOW - 5 * MIN) }), s), 'power')?.state).toBe('WARNING');
    expect(by(evaluateGateway(facts({ telemetry: t(NOW - 5 * MIN) }), s), 'power')?.value).toMatchObject({ unplugged_minutes: 5 });
  });

  it('SMS failures: only 3 consecutive FAILED results; UNKNOWN is not a known failure; no cause is named', () => {
    const f = (...statuses: string[]) => by(evaluateGateway(facts({ recentResults: statuses.map((status) => ({ status })) }), s), 'sms_failures');
    expect(f('FAILED', 'FAILED', 'FAILED')?.state).toBe('CRITICAL');
    expect(f('FAILED', 'FAILED', 'SENT')?.state).toBe('OK');
    expect(f('FAILED', 'UNKNOWN', 'FAILED')?.state).toBe('OK');
    expect(f('SENT', 'FAILED', 'FAILED', 'FAILED')?.state).toBe('OK');
    expect(f()?.state).toBe('UNKNOWN');
    expect(`${f('FAILED', 'FAILED', 'FAILED')?.title}`.toLowerCase()).not.toMatch(/sim|hết tiền|số dư/);
  });

  it('valid OTP waiting more than 60 s is a slow-queue warning; an empty queue with no gateway is "no data"', () => {
    const q = (wait: number | null, devices = 1) => evaluateOtpQueue({ nowMs: NOW, activeDevices: devices, oldestValidQueuedAtMs: wait === null ? null : NOW - wait, queued: wait === null ? 0 : 1 }, s);
    expect(q(59_000).state).toBe('OK');
    expect(q(60_000).state).toBe('WARNING');
    expect(q(null).state).toBe('OK');
    expect(q(null, 0).state).toBe('UNKNOWN');
    expect(q(120_000, 0).state).toBe('WARNING');
  });
});

describe('M13 server rules (design section 5)', () => {
  it('disk: 80% warns, 90% critical, missing is no data', () => {
    expect(evaluateDisk('root', 79.9, s).state).toBe('OK');
    expect(evaluateDisk('root', 80, s).state).toBe('WARNING');
    expect(evaluateDisk('root', 90, s).state).toBe('CRITICAL');
    expect(evaluateDisk('root', null, s).state).toBe('UNKNOWN');
  });

  it('CPU/RAM: at or above 90% CONTINUOUSLY for 5 minutes; one dip, a short run or a thin window is not enough', () => {
    const run = (values: number[], stepMs = MIN) => values.map((value, i) => ({ atMs: NOW - (values.length - 1 - i) * stepMs, value }));
    expect(evaluateSustained('cpu', run([95, 95, 95, 95, 95, 95]), NOW, s).state).toBe('WARNING');
    expect(evaluateSustained('cpu', run([95, 95, 40, 95, 95, 95]), NOW, s).state).toBe('OK');
    expect(evaluateSustained('cpu', run([95, 95]), NOW, s).state).toBe('OK');
    expect(evaluateSustained('cpu', run([95]), NOW, s).state).toBe('OK');
    expect(evaluateSustained('cpu', [], NOW, s).state).toBe('UNKNOWN');
    expect(evaluateSustained('memory', [{ atMs: NOW - 20 * MIN, value: 99 }], NOW, s).state).toBe('UNKNOWN');
  });

  it('HTTPS: 14 days warns, 3 days critical, unknown is no data', () => {
    expect(evaluateHttps(15, s).state).toBe('OK');
    expect(evaluateHttps(14, s).state).toBe('WARNING');
    expect(evaluateHttps(3, s).state).toBe('CRITICAL');
    expect(evaluateHttps(null, s).state).toBe('UNKNOWN');
  });

  it('backup: failed or overdue warns; a restore test is a separate fact and "never tested" is not green', () => {
    const hours = (h: number) => NOW - h * 3_600_000;
    expect(evaluateBackup({ nowMs: NOW, latest: null, lastOkAtMs: null }, s).state).toBe('UNKNOWN');
    expect(evaluateBackup({ nowMs: NOW, latest: { ok: true, finishedAtMs: hours(2), detailCode: null }, lastOkAtMs: hours(2) }, s).state).toBe('OK');
    expect(evaluateBackup({ nowMs: NOW, latest: { ok: true, finishedAtMs: hours(30), detailCode: null }, lastOkAtMs: hours(30) }, s)).toMatchObject({ state: 'WARNING', evidenceCode: 'BACKUP_OVERDUE' });
    expect(evaluateBackup({ nowMs: NOW, latest: { ok: false, finishedAtMs: hours(1), detailCode: 'DISK' }, lastOkAtMs: hours(5) }, s)).toMatchObject({ state: 'WARNING', evidenceCode: 'BACKUP_FAILED' });
    expect(evaluateRestoreTest({ nowMs: NOW, latest: null, lastOkAtMs: null })).toMatchObject({ state: 'UNKNOWN', evidenceCode: 'NEVER_TESTED' });
    expect(evaluateRestoreTest({ nowMs: NOW, latest: { ok: false, finishedAtMs: hours(1), detailCode: null }, lastOkAtMs: null }).state).toBe('WARNING');
    expect(evaluateRestoreTest({ nowMs: NOW, latest: { ok: true, finishedAtMs: hours(1), detailCode: null }, lastOkAtMs: hours(1) }).state).toBe('OK');
  });

  it('queue: overdue work or a strictly growing queue warns; a flat or small queue does not', () => {
    expect(evaluateQueue({ pending: 3, oldestDueAgeMs: 400_000, history: [] }, s).state).toBe('WARNING');
    expect(evaluateQueue({ pending: 3, oldestDueAgeMs: 10_000, history: [] }, s).state).toBe('OK');
    expect(evaluateQueue({ pending: 60, oldestDueAgeMs: null, history: [20, 30, 40, 50, 60] }, s).state).toBe('WARNING');
    expect(evaluateQueue({ pending: 60, oldestDueAgeMs: null, history: [20, 30, 30, 50, 60] }, s).state).toBe('OK');
    expect(evaluateQueue({ pending: 9, oldestDueAgeMs: null, history: [1, 3, 5, 7, 9] }, s).state).toBe('OK');
  });

  it('error bursts need enough errors from enough different reporters; a lone crash is not an incident', () => {
    const e = (errors: number, reporters: number) => evaluateErrorBurst({ source: 'APP_SHIP', label: 'App 11Ship', version: '1.0.1', errors, reporters }, s);
    expect(e(5, 2).state).toBe('WARNING');
    expect(e(50, 1).state).toBe('OK');
    expect(e(4, 4).state).toBe('OK');
    expect(e(5, 2).checkKey).toBe('client.app_ship.1.0.1');
    expect(e(5, 2).impact).toContain('Chưa chứng minh toàn hệ thống lỗi');
  });
});
