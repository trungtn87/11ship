import { describe, expect, it } from '@jest/globals';
import { checkSettingsPatch, defaultSettings, overridesOf, resolveSettings, SETTING_DEFS } from './ops-settings';

describe('M13 settings registry (defaults of the approved design)', () => {
  const d = defaultSettings();
  it('carries the defaults of design sections 3, 5, 8 and 11', () => {
    expect(d['gateway.contact_warn_seconds']).toBe(180);
    expect(d['gateway.contact_critical_seconds']).toBe(300);
    expect(d['gateway.battery_warn_percent']).toBe(20);
    expect(d['gateway.battery_critical_percent']).toBe(10);
    expect(d['gateway.unplug_warn_seconds']).toBe(300);
    expect(d['gateway.send_fail_count']).toBe(3);
    expect(d['gateway.queue_slow_seconds']).toBe(60);
    expect(d['server.disk_warn_percent']).toBe(85);
    expect(d['server.disk_critical_percent']).toBe(95);
    expect(d['server.cpu_percent']).toBe(85);
    expect(d['server.sustain_seconds']).toBe(300);
    expect(d['server.https_warn_days']).toBe(14);
    expect(d['server.https_critical_days']).toBe(3);
    expect(d['alert.reminder_warning_minutes']).toBe(30);
    expect(d['alert.reminder_critical_minutes']).toBe(10);
    expect(d['retention.tech_days']).toBe(30);
    expect(d['retention.error_days']).toBe(90);
    expect(d['retention.metrics_detail_days']).toBe(7);
    expect(d['retention.metrics_hourly_days']).toBe(90);
    expect(d['retention.incident_days']).toBe(365);
    expect(d['retention.admin_days']).toBe(365);
  });

  it('every default is inside its own bounds and keys are unique', () => {
    expect(new Set(SETTING_DEFS.map((s) => s.key)).size).toBe(SETTING_DEFS.length);
    for (const s of SETTING_DEFS) expect(s.default >= s.min && s.default <= s.max).toBe(true);
  });

  it('rejects unknown keys, non-integers, out-of-range values and broken order', () => {
    expect(checkSettingsPatch({ nope: 1 }, d)).toMatchObject({ ok: false, problem: 'UNKNOWN_KEY' });
    expect(checkSettingsPatch({ 'server.cpu_percent': 90.5 }, d)).toMatchObject({ ok: false, problem: 'NOT_INTEGER' });
    expect(checkSettingsPatch({ 'server.cpu_percent': 10 }, d)).toMatchObject({ ok: false, problem: 'OUT_OF_RANGE' });
    expect(checkSettingsPatch({ 'gateway.contact_warn_seconds': 400 }, d)).toMatchObject({ ok: false, problem: 'ORDER' });
    expect(checkSettingsPatch({ 'gateway.battery_critical_percent': 25 }, d)).toMatchObject({ ok: false, problem: 'ORDER' });
    expect(checkSettingsPatch({ 'retention.tech_days': 100 }, d)).toMatchObject({ ok: false, problem: 'ORDER' });
    expect(checkSettingsPatch({ 'gateway.contact_warn_seconds': 120, 'gateway.contact_critical_seconds': 240 }, d)).toEqual({ ok: true });
  });

  it('stores only differences, and a stored out-of-bounds or unknown key never wins over the default', () => {
    const merged = resolveSettings({ 'gateway.contact_warn_seconds': 120, 'server.cpu_percent': 5, ghost: 1 });
    expect(merged['gateway.contact_warn_seconds']).toBe(120);
    expect(merged['server.cpu_percent']).toBe(85);
    expect(overridesOf(merged)).toEqual({ 'gateway.contact_warn_seconds': 120 });
    expect(overridesOf(d)).toEqual({});
  });
});
