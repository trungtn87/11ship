import { createHash, randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import { ADMIN_ORIGIN, ADMIN_PASSWORD, AdminApp, adminData, count, rewindAcceptedStep, startAdminApp, totpNow } from './support/admin-fixtures';
import { begin, ok, post } from './support/activation-fixtures';
import { freePort, repoRoot, runScript, startFront } from './support/admin-web-harness';
import { Browser, launchChrome, Page } from './support/cdp';
import { createActiveShopFor, Phone, randomPhone } from './support/auth-fixtures';
import { createInvitation, createPayload, systemSession, SystemSession } from './support/provisioning-fixtures';

// Issue #253 — Hệ thống › Vùng hoạt động in a REAL Chrome against the real front, backend and PostgreSQL: the menu entry is live (no "Sắp có"), the list and the
// detail open by direct URL and survive a reload, SYSTEM creates / edits / switches an area through the impact preview and its confirmation, an ADMIN only
// reads, and nothing scrolls sideways at 390 px. Screenshots go to .test-results/admin-zone-shots.

const tag = `VH${randomBytes(3).toString('hex').toUpperCase()}`;

interface Person {
  readonly phone: Phone;
  readonly userId: string;
  readonly secret: string;
}

describe('admin service areas (real browser)', () => {
  let app: AdminApp;
  let system: SystemSession;
  let front: ChildProcess | undefined;
  let browser: Browser | undefined;
  let origin = '';
  let tlsDir = '';
  let viewerAdmin: Person;
  const shots: { name: string; data: Buffer }[] = [];
  const areaIds: string[] = [];

  async function activatedAdmin(permissions: Record<string, unknown>[], fullName: string): Promise<Person> {
    const phone = randomPhone();
    app.track(phone.normalized);
    const invitation = await createInvitation(app, system, createPayload(phone.local, { full_name: fullName, permissions }));
    const token = invitation.link.split('#t=')[1] as string;
    const session = await begin(app, { invitationId: invitation.invitationId, token, phone });
    ok(await post(app, '/password', session, { password: ADMIN_PASSWORD }));
    const secret = String(adminData(ok(await post(app, '/totp/enrollment', session))).secret);
    ok(await post(app, '/complete', session, { code: totpNow(secret) }));
    const found = await app.pool.query<{ user_id: string }>('SELECT user_id FROM app.users WHERE phone_normalized = $1', [phone.normalized]);
    return { phone, userId: (found.rows[0] as { user_id: string }).user_id, secret };
  }

  async function signIn(page: Page, who: { phone: { local: string }; password: string; userId: string; secret: string }): Promise<void> {
    await app.clearLimits();
    await page.goto(`${origin}/`);
    await page.waitFor(`document.querySelector('#login-title')`);
    await page.fill('#phone', who.phone.local);
    await page.fill('#password', who.password);
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#verify-title')`);
    await rewindAcceptedStep(app, who.userId);
    await page.fill('#verify-code', totpNow(who.secret));
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#shell-title')`);
  }

  const shot = async (page: Page, name: string): Promise<void> => {
    shots.push({ name, data: await page.screenshot() });
  };
  const press = (page: Page, text: string): Promise<boolean> =>
    page.evaluate<boolean>(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent ?? '').trim() === ${JSON.stringify(text)} && !x.disabled); if (!b) return false; b.click(); return true; })()`);
  const noSideways = (page: Page): Promise<boolean> => page.evaluate<boolean>(`document.documentElement.scrollWidth <= window.innerWidth`);
  const areaRow = async (id: string) => (await app.pool.query<{ name: string; status: string; version: string; coverage_radius_m: number | null }>('SELECT name, status, version::text AS version, coverage_radius_m FROM app.service_areas WHERE service_area_id = $1::uuid', [id])).rows[0]!;

  beforeAll(async () => {
    runScript('admin-web-build.mjs');
    tlsDir = mkdtempSync(join(tmpdir(), 'admin-zones-tls-'));
    runScript('admin-web-cert.mjs', [tlsDir, '1']);
    const certPath = join(tlsDir, 'cert.pem');
    const spki = new X509Certificate(readFileSync(certPath)).publicKey.export({ type: 'spki', format: 'der' });
    const spkiHash = createHash('sha256').update(spki).digest('base64');
    const port = await freePort();
    origin = `https://localhost:${String(port)}`;
    app = await startAdminApp({ allowedOrigins: [origin, ADMIN_ORIGIN], activationDisabledTest: true });
    front = await startFront({
      ADMIN_WEB_PORT: String(port),
      ADMIN_WEB_HOST: 'localhost',
      ADMIN_WEB_BACKEND: app.running.baseUrl,
      ADMIN_WEB_TLS_CERT: certPath,
      ADMIN_WEB_TLS_KEY: join(tlsDir, 'key.pem'),
    });
    browser = await launchChrome(spkiHash);
    system = await systemSession(app);
    viewerAdmin = await activatedAdmin([{ app: 'SHOP', can_view: true, can_review_profile: false, can_lock: false }], `Quản trị xem vùng ${tag}`);
  }, 300_000);

  afterAll(async () => {
    const directory = join(repoRoot(), '.test-results', 'admin-zone-shots');
    mkdirSync(directory, { recursive: true });
    for (const item of shots) writeFileSync(join(directory, `${item.name}.png`), item.data);
    await browser?.close();
    front?.kill('SIGTERM');
    if (app !== undefined) {
      const client = await app.pool.connect();
      try {
        await client.query('ALTER TABLE app.deliveries DISABLE TRIGGER USER');
        await client.query('DELETE FROM app.deliveries WHERE shop_id IN (SELECT shop_id FROM app.shops WHERE service_area_id = ANY($1::uuid[]))', [areaIds]);
        await client.query('ALTER TABLE app.deliveries ENABLE TRIGGER USER');
      } finally {
        client.release();
      }
      await app.close();
      await app.pool.query('DELETE FROM app.service_areas WHERE service_area_id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM app.shops s WHERE s.service_area_id = service_areas.service_area_id)', [areaIds]).catch(() => undefined);
    }
    if (tlsDir !== '') rmSync(tlsDir, { recursive: true, force: true });
  });

  it('SYSTEM: the menu entry is live, create → open → reload → preview → confirm → save, switch off; 1280 px and 390 px', async () => {
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 900, false);
    await page.send('Network.clearBrowserCookies');
    await signIn(page, { phone: system.account.phone, password: system.account.password, userId: system.account.userId, secret: system.login.secret });
    expect(await page.evaluate<boolean>(`!!document.querySelector('a[href="/system/zones"]')`)).toBe(true);
    await page.goto(`${origin}/system/zones`);
    await page.waitFor(`document.querySelector('[data-testid="zone-create"]')`);
    expect(await page.evaluate<string>(`document.querySelector('h1').textContent`)).toBe('Vùng hoạt động');

    // Create: no geometry is invented; the area starts switched off.
    const code = `ZW-${tag}`;
    await page.fill('#zone-code', code);
    await page.fill('#zone-name', `Vùng Chrome ${tag}`);
    await page.fill('#zone-new-lat', '21');
    await page.fill('#zone-new-lng', '105');
    await page.fill('#zone-new-radius', '5000');
    await page.fill('#zone-reason', 'Tạo vùng thử trên trình duyệt');
    expect(await press(page, 'Tạo vùng (đang tắt)')).toBe(true);
    await page.waitFor(`location.pathname.startsWith('/system/zones/') && document.querySelector('[data-testid="zone-edit"]')`);
    const id = await page.evaluate<string>(`location.pathname.split('/').pop()`);
    areaIds.push(id);
    expect(await areaRow(id)).toMatchObject({ status: 'INACTIVE', version: '1', coverage_radius_m: 5000 });
    await shot(page, 'zone-detail-1280');

    // A public shop sits 4.4 km from the centre; a reload of the detail keeps the page.
    const ownerId = randomUUID();
    const phone = randomPhone();
    app.track(phone.normalized);
    await app.pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, clock_timestamp(), 'PHONE_VERIFIED', 'ACTIVE', 1, clock_timestamp(), clock_timestamp())`,
      [ownerId, phone.normalized, await new Argon2idPasswordHasher().hash(ADMIN_PASSWORD)],
    );
    const shopId = await createActiveShopFor(app.pool, ownerId, id);
    await app.pool.query(`UPDATE app.shops SET pickup_lat = 21.04, pickup_lng = 105, activated_at = clock_timestamp() WHERE shop_id = $1::uuid`, [shopId]);
    await page.goto(`${origin}/system/zones/${id}`);
    await page.waitFor(`document.querySelector('[data-testid="zone-edit"]')`);

    // Shrinking the circle drops the public shop out of it: the preview says so and the save needs the confirmation.
    await page.fill('#zone-edit-radius', '1000');
    await page.fill('#zone-edit-reason', 'Thu hẹp vòng phủ');
    expect(await press(page, 'Xem tác động')).toBe(true);
    await page.waitFor(`document.querySelector('[data-testid="zone-impact"]')`);
    expect(await page.evaluate<string>(`document.querySelector('[data-testid="zone-impact"]').textContent`)).toContain('(ghim lọt ra ngoài vòng mới): 1');
    await shot(page, 'zone-impact-1280');
    expect(await press(page, 'Lưu thay đổi')).toBe(true);
    await page.waitFor(`document.querySelector('#status') || document.querySelector('#zones-status').textContent.includes('xác nhận')`);
    expect((await areaRow(id)).coverage_radius_m).toBe(5000);
    await page.evaluate(`(() => { const c = document.querySelector('[data-testid="zone-edit"] input[type="checkbox"]'); c.click(); })()`);
    expect(await press(page, 'Lưu thay đổi')).toBe(true);
    await page.waitFor(`document.querySelector('#zones-status').textContent === 'Đã lưu.'`);
    expect(await areaRow(id)).toMatchObject({ coverage_radius_m: 1000, version: '2' });
    expect(await count(app.pool, `SELECT 1 FROM app.audit_logs WHERE resource_id = $1 AND action = 'admin.service_area.update.v1'`, [id])).toBe(1);
    // The shop itself was not touched.
    expect((await app.pool.query('SELECT pickup_lat, service_area_id FROM app.shops WHERE shop_id = $1::uuid', [shopId])).rows[0]).toEqual({ pickup_lat: 21.04, service_area_id: id });

    // Switch on (no public shop is lost by turning on), then the list shows both facts and "Đang bật".
    await page.fill('#zone-status-reason', 'Bật vùng');
    expect(await press(page, 'Bật vùng')).toBe(true);
    await page.waitFor(`document.querySelector('dl.kvs').textContent.includes('Đang bật')`);
    expect((await areaRow(id)).status).toBe('ACTIVE');
    await page.goto(`${origin}/system/zones`);
    await page.waitFor(`document.querySelector('.table tbody tr')`);
    const rows = await page.evaluate<string[]>(`[...document.querySelectorAll('.table tbody tr')].map((tr) => tr.textContent)`);
    expect(rows.some((row) => row.includes(code) && row.includes('Đang bật') && row.includes('ghim ngoài vùng 1'))).toBe(true);
    await shot(page, 'zone-list-1280');

    await page.viewport(390, 844, true);
    await page.goto(`${origin}/system/zones/${id}`);
    await page.waitFor(`document.querySelector('[data-testid="zone-edit"]')`);
    expect(await noSideways(page)).toBe(true);
    await shot(page, 'zone-detail-390');
    await page.goto(`${origin}/system/zones`);
    await page.waitFor(`document.querySelector('.table tbody tr')`);
    expect(await noSideways(page)).toBe(true);
    await shot(page, 'zone-list-390');
    await page.close();
  }, 240_000);

  it('ADMIN: reads the list and the detail, sees no form to change anything', async () => {
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 900, false);
    await page.send('Network.clearBrowserCookies');
    await signIn(page, { phone: viewerAdmin.phone, password: ADMIN_PASSWORD, userId: viewerAdmin.userId, secret: viewerAdmin.secret });
    await page.goto(`${origin}/system/zones`);
    await page.waitFor(`document.querySelector('.table tbody tr')`);
    expect(await page.evaluate<boolean>(`!document.querySelector('[data-testid="zone-create"]')`)).toBe(true);
    await page.evaluate(`document.querySelector('.table tbody a').click()`);
    await page.waitFor(`location.pathname.startsWith('/system/zones/') && document.querySelector('dl.kvs')`);
    expect(await page.evaluate<boolean>(`!document.querySelector('[data-testid="zone-edit"]') && !document.querySelector('[data-testid="zone-status"]')`)).toBe(true);
    await page.close();
  }, 120_000);
});
