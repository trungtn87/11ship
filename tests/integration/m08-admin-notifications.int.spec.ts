import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ADMIN_SESSION_COOKIE } from '../../apps/backend/src/admin-auth/admin-auth-constants';
import { ADMIN_PASSWORD, AdminApp, adminData, adminErrorCode, AdminResponse, cookieFrom, loginStep, preauthCookies, rewindAcceptedStep, sessionCookies, startAdminApp, totpNow } from './support/admin-fixtures';
import { begin, ok, post } from './support/activation-fixtures';
import { countRows, Phone, randomPhone } from './support/auth-fixtures';
import { createInvitation, createPayload, systemSession, SystemSession } from './support/provisioning-fixtures';

// M08.06 on a REAL PostgreSQL and the real administration pipeline: who sees which notifications (SYSTEM both apps, an ADMIN only the apps it may VIEW),
// the search filters, the detail with its push attempts and the evidence, the settings (SYSTEM writes, an ADMIN reads, versions, bounds, audit), and the
// absence of any route that sends or replays. The rows are written by SQL because the producers are M07/M04 (covered by m08-notifications).

const tag = randomBytes(3).toString('hex').toUpperCase();
interface AdminLogin {
  readonly cookie: string;
  readonly csrf: string;
}
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('M08.06 — notification administration', () => {
  let admin: AdminApp;
  let system: SystemSession;
  let driverViewer: AdminLogin;
  let shopViewer: AdminLogin;
  const ids = { ship: randomUUID(), food: randomUUID(), failed: randomUUID() };

  async function viewerWith(app: 'DRIVER' | 'SHOP'): Promise<AdminLogin> {
    const phone = randomPhone();
    admin.track(phone.normalized);
    const invitation = await createInvitation(admin, system, createPayload(phone.local, { full_name: `Xem thông báo ${tag}`, permissions: [{ app, can_view: true, can_review_profile: false, can_lock: false }] }));
    const token = invitation.link.split('#t=')[1] as string;
    const session = await begin(admin, { invitationId: invitation.invitationId, token, phone });
    ok(await post(admin, '/password', session, { password: ADMIN_PASSWORD }));
    const secret = String(adminData(ok(await post(admin, '/totp/enrollment', session))).secret);
    ok(await post(admin, '/complete', session, { code: totpNow(secret) }));
    const found = await admin.pool.query<{ user_id: string }>('SELECT user_id FROM app.users WHERE phone_normalized = $1', [phone.normalized]);
    return login({ phone, userId: (found.rows[0] as { user_id: string }).user_id, secret });
  }

  async function login(who: { phone: Phone; userId: string; secret: string }): Promise<AdminLogin> {
    const preauth = await loginStep(admin, { phone: who.phone, password: ADMIN_PASSWORD, userId: who.userId });
    await rewindAcceptedStep(admin, who.userId);
    const verified = await admin.call('POST', '/totp/verify', { body: { code: totpNow(who.secret) }, cookies: preauthCookies(preauth), csrf: preauth.csrf });
    if (verified.status !== 200) {
      throw new Error(`admin login failed: ${verified.status} ${verified.text}`);
    }
    return { cookie: String(cookieFrom(verified, ADMIN_SESSION_COOKIE)), csrf: String(adminData(verified).csrf_token) };
  }

  const systemLogin = (): AdminLogin => ({ cookie: system.login.cookie, csrf: system.login.csrf });
  const get = (who: AdminLogin | undefined, path: string): Promise<AdminResponse> => admin.call('GET', path, { basePath: '/v1/admin', ...(who === undefined ? {} : { cookies: sessionCookies(who) }) });
  async function putConfig(who: AdminLogin, path: string, body: unknown, key: string = randomUUID()): Promise<AdminResponse> {
    await admin.clearLimits();
    return admin.call('POST', path, { basePath: '/v1/admin', body, cookies: sessionCookies(who), csrf: who.csrf, headers: { 'idempotency-key': key } });
  }
  const codeOf = (r: AdminResponse): { status: number; code: string | undefined } => ({ status: r.status, code: adminErrorCode(r) });

  async function seed(): Promise<void> {
    const user = system.account.userId;
    const insert = `INSERT INTO app.notifications (notification_id, recipient_user_id, app, kind, category, title, body, target_type, target_id, target_version, dedupe_key, created_at, updated_at, purge_after)
                    VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, 'NONE', NULL, 0, $8, now(), now(), now() + interval '365 days')`;
    await admin.pool.query(insert, [ids.ship, user, 'SHIP', 'PICKUP_REMINDER', 'REMINDERS', 'Bạn còn đơn chưa lấy hàng', 'Chạm để xem', `m08a:${tag}:ship`]);
    await admin.pool.query(insert, [ids.food, user, 'FOOD', 'DELIVERY_COMPLETED', 'ORDERS', 'Giao hàng thành công', 'Đơn đã giao', `m08a:${tag}:food`]);
    await admin.pool.query(insert, [ids.failed, user, 'SHIP', 'TOPUP_CONFIRMED', 'WALLET_PROFILE', 'Nạp tiền thành công', 'Mở ví', `m08a:${tag}:topup`]);
    const push = `INSERT INTO app.notification_pushes (push_id, notification_id, recipient_user_id, app, token_id, push_key, status, skip_reason, attempt_count, next_attempt_at, expires_at, created_at, last_error_code, last_error_evidence, sent_at)
                  VALUES ($1::uuid, $2::uuid, $3::uuid, $4, NULL, $5, $6, $7, $8, now(), now() + interval '1 hour', now(), $9, $10, $11)`;
    await admin.pool.query(push, [randomUUID(), ids.ship, user, 'SHIP', `m08a:${tag}:p1`, 'SKIPPED', 'NO_TOKEN', 0, null, null, null]);
    await admin.pool.query(push, [randomUUID(), ids.food, user, 'FOOD', `m08a:${tag}:p2`, 'SENT', null, 1, null, null, new Date().toISOString()]);
    await admin.pool.query(push, [randomUUID(), ids.failed, user, 'SHIP', `m08a:${tag}:p3`, 'FAILED', null, 5, 'HTTP_503', 'Dịch vụ đẩy thông báo trả mã 503 (UNAVAILABLE)', null]);
  }

  beforeAll(async () => {
    admin = await startAdminApp({ activationDisabledTest: true });
    system = await systemSession(admin);
    driverViewer = await viewerWith('DRIVER');
    shopViewer = await viewerWith('SHOP');
    await seed();
  });

  afterAll(async () => {
    await admin.pool.query('DELETE FROM app.notification_pushes WHERE push_key LIKE $1', [`m08a:${tag}:%`]);
    await admin.pool.query('DELETE FROM app.notifications WHERE dedupe_key LIKE $1', [`m08a:${tag}:%`]);
    await admin.pool.query('DELETE FROM app.notification_config');
    await admin.close();
  });

  const items = async (who: AdminLogin, query = ''): Promise<Json[]> => {
    const r = await get(who, `/notifications?limit=100${query}`);
    expect([r.status, r.text.slice(0, 200)]).toEqual([200, r.text.slice(0, 200)]);
    return ((adminData(r) as Json).items as Json[]).filter((i) => String(i.title).length > 0 && ([ids.ship, ids.food, ids.failed] as string[]).includes(String(i.notification_id)));
  };

  it('scope: SYSTEM sees both apps; an ADMIN with DRIVER view sees only the Shipper app, one with SHOP view only the Food app; the rest is forbidden or not found', async () => {
    expect((await items(systemLogin())).map((i) => i.notification_id).sort()).toEqual([ids.ship, ids.food, ids.failed].sort());
    expect((await items(driverViewer)).map((i) => i.app)).toEqual(['SHIP', 'SHIP']);
    expect((await items(shopViewer)).map((i) => i.notification_id)).toEqual([ids.food]);
    expect(codeOf(await get(driverViewer, '/notifications?app=FOOD'))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect(codeOf(await get(driverViewer, `/notifications/${ids.food}`))).toEqual({ status: 404, code: 'NOTIFICATION_NOT_FOUND' });
    expect((await get(driverViewer, `/notifications/${ids.ship}`)).status).toBe(200);
    expect(codeOf(await get(undefined, '/notifications'))).toEqual({ status: 401, code: 'ADMIN_SESSION_INVALID' });
  });

  it('search filters by kind, send status and delivery code, and rejects unknown filters', async () => {
    expect((await items(systemLogin(), '&kind=PICKUP_REMINDER')).map((i) => i.notification_id)).toEqual([ids.ship]);
    expect((await items(systemLogin(), '&send_status=FAILED')).map((i) => i.notification_id)).toEqual([ids.failed]);
    expect((await items(systemLogin(), '&send_status=SENT')).map((i) => i.notification_id)).toEqual([ids.food]);
    expect((await items(systemLogin(), `&q=${system.account.userId}`)).length).toBe(3);
    expect((await get(systemLogin(), '/notifications?kind=NOPE')).status).toBe(400);
    expect((await get(systemLogin(), '/notifications?bogus=1')).status).toBe(400);
  });

  it('the detail shows the channels, the attempts, the deadline and only evidence the row holds; "sent" is not "read"', async () => {
    const failed = adminData(await get(systemLogin(), `/notifications/${ids.failed}`)) as Json;
    expect(failed.channels).toHaveLength(2);
    expect(failed.channels[1]).toMatchObject({ channel: 'PUSH', status: 'FAILED', attempt_count: 5, last_error_code: 'HTTP_503', last_error_evidence: 'Dịch vụ đẩy thông báo trả mã 503 (UNAVAILABLE)' });
    expect(failed.channels[1].expires_at).toEqual(expect.any(String));
    expect(failed.note).toContain('không có nghĩa');
    const skipped = adminData(await get(systemLogin(), `/notifications/${ids.ship}`)) as Json;
    expect(skipped.channels[1]).toMatchObject({ status: 'SKIPPED', skip_reason: 'NO_TOKEN', reason_text: 'Tài khoản chưa có thiết bị nhận thông báo đẩy' });
    // No reason is ever invented from the absence of a push: a SENT row has none.
    const sent = adminData(await get(systemLogin(), `/notifications/${ids.food}`)) as Json;
    expect(sent.channels[1]).toMatchObject({ status: 'SENT', reason_text: null, last_error_code: null });
  });

  it('the work queue counts failures with evidence, and an ADMIN only gets its own apps', async () => {
    const all = adminData(await get(systemLogin(), '/notifications/work-queue')) as Json;
    expect(all.counters.failed_pushes).toBeGreaterThanOrEqual(1);
    expect((all.failures as Json[]).some((f) => f.notification_id === ids.failed && f.error_code === 'HTTP_503')).toBe(true);
    const shopOnly = adminData(await get(shopViewer, '/notifications/work-queue')) as Json;
    expect((shopOnly.failures as Json[]).some((f) => f.notification_id === ids.failed)).toBe(false);
    expect(all.push_provider_configured).toBe(false);
  });

  it('the settings: defaults, any ADMIN reads, only SYSTEM writes with the right version and within bounds; the timers are shown read-only; one audit row', async () => {
    const start = adminData(await get(driverViewer, '/notifications/config')) as Json;
    expect(start).toMatchObject({ version: 0, push_enabled: true, default_sound: true, visible_days: 90, purge_days: 365, retry_max_attempts: 5, retry_base_seconds: 30, timers: { shop_reminder_minutes: [5, 15], search_stop_minutes: 30, pickup_reminder_minutes: 5 } });
    const body = { expected_version: 0, push_enabled: true, default_sound: false, visible_days: 60, purge_days: 300, retry_max_attempts: 4, retry_base_seconds: 20 };
    expect(codeOf(await putConfig(driverViewer, '/notifications/config', body))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect((adminData(await get(systemLogin(), '/notifications/config')) as Json).version).toBe(0);
    const written = await putConfig(systemLogin(), '/notifications/config', body);
    expect([written.status, written.text.slice(0, 200)]).toEqual([200, written.text.slice(0, 200)]);
    expect(adminData(written)).toMatchObject({ version: 1, default_sound: false, visible_days: 60, purge_days: 300, retry_max_attempts: 4 });
    // A stale version is refused; a bound is refused; the timers are not accepted as settings.
    expect((await putConfig(systemLogin(), '/notifications/config', body)).status).toBe(409);
    for (const bad of [{ ...body, expected_version: 1, visible_days: 6 }, { ...body, expected_version: 1, purge_days: 30 }, { ...body, expected_version: 1, retry_max_attempts: 11 }, { ...body, expected_version: 1, search_stop_minutes: 10 }]) {
      expect((await putConfig(systemLogin(), '/notifications/config', bad)).status).toBe(400);
    }
    expect(await countRows(admin.pool, `SELECT 1 FROM app.audit_logs WHERE action = 'admin.notification_config.update.v1'`)).toBe(1);
  });

  it('there is no route that sends, replays or broadcasts', async () => {
    for (const [method, path] of [['POST', '/notifications'], ['POST', `/notifications/${ids.ship}/resend`], ['POST', '/notifications/replay'], ['POST', `/notifications/${ids.ship}`]] as const) {
      const r = await admin.call(method, path, { basePath: '/v1/admin', body: {}, cookies: sessionCookies(systemLogin()), csrf: systemLogin().csrf, headers: { 'idempotency-key': randomUUID() } });
      expect([404, 405]).toContain(r.status);
    }
  });
});
