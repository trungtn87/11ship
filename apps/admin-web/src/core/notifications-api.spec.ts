import { describe, expect, it } from '@jest/globals';
import { Transport, TransportRequest, TransportResponse } from './api';
import { canOpenRoute, grantsFromPermissions, visibleMenu } from './menu';
import { AdminNotificationApi, createNotificationSource, parseConfig, parseDetail, parsePage, parseWorkQueue } from './notifications-api';
import { NOT_WIRED_NOTIFICATIONS, NotificationQuery } from './notifications';
import { formatRoute, parseRoute } from './routes';

const ID = '11111111-1111-4111-8111-111111111111';
const reply = (status: number, body: unknown, headers: Record<string, string> = {}): TransportResponse => ({ status, header: (name) => headers[name.toLowerCase()] ?? null, json: () => Promise.resolve(body) });
const errorBody = (code: string) => ({ error: { code, message: 'x', request_id: 'r', details: {} } });
const item = (over: Record<string, unknown> = {}) => ({
  notification_id: ID, created_at: '2026-10-18T09:00:00.000Z', kind: 'PICKUP_REMINDER', title: 'Bạn còn đơn chưa lấy hàng', body: 'Chạm để xem', app: 'SHIP', recipient_user_id: ID, delivery_code: null,
  channels: ['PUSH', 'APP'], push_status: 'PENDING', attempts: 1, expired: false, ...over,
});
const config = (over: Record<string, unknown> = {}) => ({
  version: 1, push_enabled: true, default_sound: true, visible_days: 90, purge_days: 365, retry_max_attempts: 5, retry_base_seconds: 30, provider_configured: false, updated_at: null,
  timers: { shop_reminder_minutes: [5, 15], search_stop_minutes: 30, pickup_reminder_minutes: 5 }, ...over,
});
const query: NotificationQuery = { query: ' DG-1 ', kind: 'ALL', status: 'FAILED', app: 'SHIP', from: '2026-10-18', to: '', page: 2 };

function scripted(...answers: (TransportResponse | 'throw')[]): { transport: Transport; requests: TransportRequest[] } {
  const requests: TransportRequest[] = [];
  const queue = [...answers];
  const transport: Transport = (request) => {
    requests.push(request);
    const next = queue.shift();
    return next === 'throw' || next === undefined ? Promise.reject(new Error('down')) : Promise.resolve(next);
  };
  return { transport, requests };
}

describe('M08.06 notification administration client', () => {
  it('parses a row strictly: an unknown kind, status or a malformed row is refused, never half-shown', () => {
    expect(parsePage({ items: [item()], total: 1 })).toMatchObject({ total: 1, rows: [{ kind: 'PICKUP_REMINDER', pushStatus: 'PENDING', attempts: 1 }] });
    expect(parsePage({ items: [item({ kind: 'NOPE' })], total: 1 })).toBeUndefined();
    expect(parsePage({ items: [item({ push_status: 'WEIRD' })], total: 1 })).toBeUndefined();
    expect(parsePage({ items: [item({ notification_id: 'x' })], total: 1 })).toBeUndefined();
    expect(parsePage({ items: [{}], total: 1 })).toBeUndefined();
  });

  it('parses the detail with its channels and keeps only the evidence the row holds', () => {
    const detail = {
      notification_id: ID, kind: 'PICKUP_REMINDER', title: 'T', app: 'SHIP', recipient_user_id: ID, created_at: '2026-10-18T09:00:00.000Z', read_at: null, valid_until: null, archived_at: null, delete_after: '2027-10-18T09:00:00.000Z',
      target: { type: 'DELIVERY', id: ID, code: 'DG-1' }, note: 'n',
      channels: [{ channel: 'APP', status: 'STORED', at: '2026-10-18T09:00:00.000Z' }, { channel: 'PUSH', status: 'FAILED', attempt_count: 5, last_error_code: 'HTTP_503', last_error_evidence: 'e', created_at: '2026-10-18T09:00:00.000Z', expires_at: '2026-10-18T10:00:00.000Z' }],
    };
    const parsed = parseDetail(detail);
    expect(parsed?.channels[1]).toMatchObject({ channel: 'PUSH', attempts: 5, errorCode: 'HTTP_503', evidence: 'e', reasonText: null });
    expect(parseDetail({ ...detail, channels: [{ channel: 'SMS', status: 'SENT' }] })).toBeUndefined();
  });

  it('parses the work queue and the settings, and refuses a settings body without the read-only timers', () => {
    const queue = {
      counters: { failed_pushes: 1, late_pushes: 0, no_device: 2, dead_events: 0, late_reminders: 0, goods_cases: 1 }, push_provider_configured: false,
      failures: [{ notification_id: ID, kind: 'NEW_OFFERS', app: 'SHIP', status: 'FAILED', error_code: 'HTTP_503', evidence: null, at: '2026-10-18T09:00:00.000Z' }],
      goods_cases: [{ delivery_id: ID, code: 'DG-1', shop_name: 'Quán', opened_at: '2026-10-18T09:00:00.000Z' }],
    };
    expect(parseWorkQueue(queue)).toMatchObject({ providerConfigured: false, counters: { failedPushes: 1, goodsCases: 1 } });
    expect(parseConfig(config())).toMatchObject({ visibleDays: 90, shopReminderMinutes: [5, 15], searchStopMinutes: 30 });
    expect(parseConfig({ ...config(), timers: undefined })).toBeUndefined();
  });

  it('sends one GET per read with the filters encoded, and POSTs the settings with the CSRF token and the caller\'s key', async () => {
    const { transport, requests } = scripted(reply(200, { data: { items: [], total: 0 } }), reply(200, { data: config({ version: 2 }) }));
    const source = createNotificationSource(new AdminNotificationApi(transport), { csrf: () => 'csrf-1', refresh: () => Promise.resolve(true) });
    expect(await source.list(query)).toEqual({ kind: 'ready', rows: [], total: 0 });
    expect(requests[0]?.path).toBe('/admin/notifications?q=DG-1&send_status=FAILED&app=SHIP&from=2026-10-18&limit=20&offset=20');
    const saved = await source.saveConfig({ version: 1, pushEnabled: true, defaultSound: false, visibleDays: 60, purgeDays: 300, retryMaxAttempts: 4, retryBaseSeconds: 20, key: 'key-1' });
    expect(saved).toMatchObject({ kind: 'ok', config: { version: 2 } });
    expect(requests[1]).toMatchObject({ method: 'POST', path: '/admin/notifications/config', csrf: 'csrf-1', idempotencyKey: 'key-1', body: { expected_version: 1, default_sound: false, visible_days: 60, retry_max_attempts: 4 } });
  });

  it('maps outcomes: conflict, forbidden, a lost answer is "unknown" (same key only), a refusal is "invalid"', async () => {
    const request = { version: 1, pushEnabled: true, defaultSound: true, visibleDays: 90, purgeDays: 365, retryMaxAttempts: 5, retryBaseSeconds: 30, key: 'k' };
    const cases: [TransportResponse | 'throw', string][] = [
      [reply(409, errorBody('VERSION_CONFLICT')), 'conflict'],
      [reply(403, errorBody('ADMIN_FORBIDDEN')), 'forbidden'],
      [reply(401, errorBody('ADMIN_SESSION_INVALID')), 'session-expired'],
      [reply(500, {}), 'unknown'],
      ['throw', 'unknown'],
      [reply(400, errorBody('ADMIN_INPUT_INVALID')), 'invalid'],
    ];
    for (const [answer, kind] of cases) {
      const source = createNotificationSource(new AdminNotificationApi(scripted(answer).transport), { csrf: () => 'c', refresh: () => Promise.resolve(true) });
      expect([kind, (await source.saveConfig(request)).kind]).toEqual([kind, kind]);
    }
    expect(await NOT_WIRED_NOTIFICATIONS.saveConfig(request)).toEqual({ kind: 'not-wired' });
  });

  it('a 404 detail is "not-found"; the route, the menu and the grants are wired', async () => {
    const source = createNotificationSource(new AdminNotificationApi(scripted(reply(404, errorBody('NOTIFICATION_NOT_FOUND'))).transport));
    expect(await source.detail(ID)).toEqual({ kind: 'not-found' });
    expect(parseRoute('/operations/notifications')).toEqual({ name: 'notifications' });
    expect(formatRoute({ name: 'notifications' })).toBe('/operations/notifications');
    const grants = grantsFromPermissions([{ app: 'DRIVER', canView: true, canReviewProfile: false, canLock: false }]);
    expect(canOpenRoute('ADMIN', grants, { name: 'notifications' })).toBe(true);
    expect(canOpenRoute('ADMIN', new Set(), { name: 'notifications' })).toBe(false);
    expect(visibleMenu('SYSTEM').flatMap((g) => g.items.map((i) => i.id))).toContain('notifications');
  });
});
