import { describe, expect, it } from '@jest/globals';
import { parseActionBody, parseAnalyticsQuery, parseAnomalyListQuery, parseDrilldownQuery, parseSettingsBody } from './ops-analytics-validation';

describe('operations analytics and anomaly parsers (issues #241/#242)', () => {
  it('reads the analytics query strictly: today / 7d / 30d / custom, source ALL / ORDER / DIRECT, nothing unknown', () => {
    expect(parseAnalyticsQuery({})).toEqual({ range: 'today', source: 'ALL' });
    expect(parseAnalyticsQuery({ range: '30d', source: 'DIRECT' })).toEqual({ range: '30d', source: 'DIRECT' });
    expect(parseAnalyticsQuery({ range: 'custom', from: '2026-10-01', to: '2026-10-07' })).toEqual({ range: 'custom', from: '2026-10-01', to: '2026-10-07', source: 'ALL' });
    for (const bad of [{ range: 'year' }, { range: 'custom' }, { range: 'custom', from: '1/10', to: '2/10' }, { range: '7d', from: '2026-10-01' }, { source: 'CUSTOMER' }, { surprise: 1 }, 'x']) {
      expect(() => parseAnalyticsQuery(bad)).toThrow();
    }
  });

  it('drill-down needs a known kind, a step only for cancelled_at_step, and a bounded page', () => {
    expect(parseDrilldownQuery({ kind: 'search_failed' })).toMatchObject({ kind: 'search_failed', step: null, limit: 20, offset: 0 });
    expect(parseDrilldownQuery({ kind: 'cancelled_at_step', step: 'SEARCHING', limit: '5', offset: '10' })).toMatchObject({ step: 'SEARCHING', limit: 5, offset: 10 });
    for (const bad of [{}, { kind: 'cancelled_at_step' }, { kind: 'search_failed', step: 'SEARCHING' }, { kind: 'search_failed', limit: 500 }, { kind: 'search_failed', offset: -1 }, { kind: 'nothing' }]) {
      expect(() => parseDrilldownQuery(bad)).toThrow();
    }
  });

  it('the case list defaults to the open cases; a search is a UUID prefix only', () => {
    expect(parseAnomalyListQuery({})).toEqual({ status: 'OPEN', rule: null, q: '', limit: 20, offset: 0 });
    expect(parseAnomalyListQuery({ status: 'ALL', rule: 'SHIPPER_ABANDONS', q: 'ab12' })).toMatchObject({ status: null, rule: 'SHIPPER_ABANDONS', q: 'ab12' });
    for (const bad of [{ status: 'DELETED' }, { rule: 'AUTO_BAN' }, { q: "x'; drop" }, { limit: 0 }]) expect(() => parseAnomalyListQuery(bad)).toThrow();
  });

  it('an action is one of the review verbs with a version; the note is trimmed, bounded and may be absent; there is no verb that changes an account', () => {
    expect(parseActionBody({ action: 'review', expected_version: 1 })).toEqual({ action: 'review', expectedVersion: 1, note: null });
    expect(parseActionBody({ action: 'dismiss', expected_version: 3, note: '  Đã   gọi hỏi  ' })).toEqual({ action: 'dismiss', expectedVersion: 3, note: 'Đã gọi hỏi' });
    for (const bad of [{ action: 'lock', expected_version: 1 }, { action: 'suspend', expected_version: 1 }, { action: 'ban', expected_version: 1 }, { action: 'review' }, { action: 'review', expected_version: 0 }, { action: 'note', expected_version: 1, note: 'x'.repeat(501) }, { action: 'review', expected_version: 1, extra: true }]) {
      expect(() => parseActionBody(bad)).toThrow();
    }
  });

  it('the settings keep the Owner bounds and always carry a reason', () => {
    const ok = { window_days: 7, min_samples: 5, rate_pct: 40, repeat_per_day: 3, expected_version: 1, reason: 'Pilot' };
    expect(parseSettingsBody(ok)).toEqual({ windowDays: 7, minSamples: 5, ratePct: 40, repeatPerDay: 3, expectedVersion: 1, reason: 'Pilot' });
    for (const bad of [{ ...ok, window_days: 0 }, { ...ok, window_days: 31 }, { ...ok, min_samples: 1 }, { ...ok, rate_pct: 101 }, { ...ok, repeat_per_day: 1 }, { ...ok, reason: '  ' }, { ...ok, extra: 1 }]) {
      expect(() => parseSettingsBody(bad)).toThrow();
    }
  });
});
