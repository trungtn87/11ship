import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ChildProcess, execFileSync, spawn } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthApp, createServiceArea, randomPhone, startAuthApp } from './support/auth-fixtures';
import { freePort, repoRoot } from './support/admin-web-harness';
import { Browser, launchChrome, Page } from './support/cdp';
import { minimalChildEnv } from './support/test-helpers';

// M01 (11Food shop onboarding connection) — F20 -> F21 -> F22 -> F21 -> F23 in a REAL headless Chrome, through the REAL local https
// front (scripts/food-web-dev.mjs), against the REAL backend (real Nest application) and the REAL PostgreSQL of the integration job
// (TEST database only). The account is the one of the DISABLED_TEST registration (#82): it is registered through F11 in the page,
// so the session and identity the page shows come from the server's answer. The ACTIVE service area is a fixture row of the test
// database (never operating data).
//
// The ONE thing that is stubbed is the device position: the page calls navigator.geolocation.getCurrentPosition, which the test
// replaces (a headless Chrome has no GPS). Everything else - the three onboarding calls, the area list, the context switch - is real.
// A position taken on a real phone is NOT covered here (the Owner tries that on a device).
//
// Flow: save without a position -> read the draft back -> take a position (a refusal first) -> choose the ACTIVE area -> save ->
// complete -> refresh identity -> enter SHOP_OWNER -> back to CUSTOMER.

const TERMS = 'test-terms-20261011-v1';
const PRIVACY = 'test-privacy-20261011-v1';
const MOBILE = { width: 390, height: 844, mobile: true };
const PASSWORD = 'Mật khẩu thử 12345 ü';
const NAME = 'Nguyễn Văn An';
const SHOP_NAME = 'Quán Cơm Thử';
const SHOP_PHONE = '0912345678';
const SHOP_ADDRESS = '12 Đường Thử, Phường 1';
const LAT = 10.762622;
const LNG = 106.660172;

interface Shot {
  readonly name: string;
  readonly data: Buffer;
}

describe('M01 — 11Food shop onboarding in a real browser against the real backend and PostgreSQL', () => {
  let app: AuthApp;
  let browser: Browser;
  let front: ChildProcess;
  let origin: string;
  let work: string;
  const shots: Shot[] = [];

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), '11ship-food-shop-'));
    const root = repoRoot();
    const dist = join(work, 'food-web');
    execFileSync(process.execPath, [join(root, 'scripts', 'client-web-build.mjs'), 'food-web', '--out', dist], { cwd: root, stdio: 'pipe', timeout: 120_000 });
    execFileSync(process.execPath, [join(root, 'scripts', 'admin-web-cert.mjs'), join(work, 'tls'), '1'], { cwd: root, stdio: 'pipe' });
    const certPath = join(work, 'tls', 'cert.pem');
    const spki = new X509Certificate(readFileSync(certPath)).publicKey.export({ type: 'spki', format: 'der' });
    const spkiHash = createHash('sha256').update(spki).digest('base64');

    // The no-OTP test registration (#82) is how the Owner's local account is made.
    app = await startAuthApp({}, { relaxTimeouts: true, configOverride: { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY }, clientPhoneVerificationMode: 'DISABLED_TEST' } });

    const port = await freePort();
    front = spawn(process.execPath, [join(root, 'scripts', 'food-web-dev.mjs')], {
      cwd: root,
      env: minimalChildEnv({ CLIENT_WEB_PORT: String(port), CLIENT_WEB_DIST: dist, CLIENT_WEB_BACKEND: app.running.baseUrl, CLIENT_WEB_TLS_CERT: certPath, CLIENT_WEB_TLS_KEY: join(work, 'tls', 'key.pem') }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    front.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`the front did not start in time: ${stderr}`)), 20_000);
      front.stdout?.once('data', () => {
        clearTimeout(timer);
        resolve();
      });
      front.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`the front exited with ${String(code)}: ${stderr}`));
      });
    });
    origin = `https://localhost:${String(port)}`;
    browser = await launchChrome(spkiHash);
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    front?.kill('SIGTERM');
    await app?.close();
    rmSync(work, { recursive: true, force: true });
    publishShots(shots);
  });

  async function shot(page: Page, name: string): Promise<void> {
    await page.evaluate('document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))');
    shots.push({ name, data: await page.screenshot() });
  }

  const mainText = (page: Page): Promise<string> => page.evaluate<string>(`document.querySelector('main')?.innerText ?? ''`);

  /** Clicks the list row (a button) of the page whose title is `title`. */
  async function clickRow(page: Page, title: string): Promise<void> {
    await page.evaluate(`(() => { const row = [...document.querySelectorAll('.c-item')].find((e) => e.querySelector('.c-item__title')?.textContent.trim() === ${JSON.stringify(title)}); if (!row) throw new Error('no row ${title}'); row.click(); })()`);
  }

  /** The device position is the only stub: the answer of navigator.geolocation.getCurrentPosition. `calls` proves when it was asked. */
  async function stubGeolocation(page: Page): Promise<void> {
    await page.evaluate(`(() => {
      window.__geo = { calls: 0, mode: 'ok' };
      navigator.geolocation.getCurrentPosition = (success, failure) => {
        window.__geo.calls += 1;
        if (window.__geo.mode === 'denied') { failure({ code: 1, message: 'User denied Geolocation' }); return; }
        success({ coords: { latitude: ${LAT}, longitude: ${LNG}, accuracy: 12.4 }, timestamp: Date.now() });
      };
    })()`);
  }

  const geoCalls = (page: Page): Promise<number> => page.evaluate<number>('window.__geo.calls');

  async function shopRows(userId: string): Promise<Array<{ shop_id: string; status: string; accepting_orders: boolean; version: string; pickup_lat: number | null; pickup_lng: number | null; service_area_id: string | null; name: string; contact_phone_normalized: string }>> {
    const result = await app.pool.query(
      `SELECT s.shop_id, s.status, s.accepting_orders, s.version::text AS version, s.pickup_lat::float8 AS pickup_lat, s.pickup_lng::float8 AS pickup_lng,
              s.service_area_id, s.name, s.contact_phone_normalized
         FROM app.shops s JOIN app.shop_members m ON m.shop_id = s.shop_id
        WHERE m.user_id = $1::uuid AND m.member_role = 'OWNER'`,
      [userId],
    );
    return result.rows;
  }

  const rolesOf = async (userId: string): Promise<string[]> => (await app.pool.query<{ role: string }>('SELECT role FROM app.user_roles WHERE user_id = $1::uuid ORDER BY role', [userId])).rows.map((row) => row.role);

  it('a CUSTOMER saves a draft without a position, resumes it, takes a position and an ACTIVE area, completes, enters SHOP_OWNER and returns to CUSTOMER', async () => {
    const areaId = await createServiceArea(app.pool);
    const phone = randomPhone();
    app.track(phone.normalized);
    const page = await browser.newPage();
    await page.viewport(MOBILE.width, MOBILE.height, MOBILE.mobile);
    try {
      // ---- #82: the account, registered through the page (no OTP in this server mode) ---------------------------------
      await page.goto(`${origin}/register`);
      await page.waitFor(`document.querySelector('#register-submit')?.disabled === false`);
      await page.fill('#full-name', NAME);
      await page.fill('#phone', phone.local);
      await page.fill('#password', PASSWORD);
      await page.fill('#password-confirm', PASSWORD);
      await page.click('#consent');
      await page.click('#register-submit');
      await page.waitFor(`location.pathname === '/' && document.body.innerText.includes(${JSON.stringify(NAME)})`);
      const user = await app.pool.query<{ user_id: string }>('SELECT user_id FROM app.users WHERE phone_normalized = $1', [phone.normalized]);
      const userId = String(user.rows[0]?.user_id);
      expect(await rolesOf(userId)).toEqual(['CUSTOMER']);
      await stubGeolocation(page);

      // ---- F20: the entry from the account screen ---------------------------------------------------------------------
      await page.click('a[href="/account"]');
      await page.waitFor(`location.pathname === '/account'`);
      await clickRow(page, 'Quản lý cửa hàng');
      await page.waitFor(`location.pathname === '/shop/start'`);
      await page.waitFor(`document.querySelector('#shop-start-cta')?.textContent.trim() === 'Đăng ký cửa hàng'`);
      await shot(page, 'f20-no-shop');
      await page.click('#shop-start-cta');
      await page.waitFor(`location.pathname === '/shop/onboarding'`);

      // ---- F21: the form, the areas from the server, completion locked with its reason ---------------------------------
      await page.waitFor(`document.querySelector('#shop-name') && !document.querySelector('#shop-name').disabled`);
      expect(await page.evaluate<boolean>(`[...document.querySelectorAll('#shop-area option')].some((option) => option.value === ${JSON.stringify(areaId)})`)).toBe(true);
      expect(await page.evaluate<string>(`document.querySelector('#shop-area').value`)).toBe('');
      expect(await page.evaluate<string>(`document.querySelector('#shop-complete').getAttribute('aria-disabled')`)).toBe('true');
      expect(await page.text('#shop-complete-reason')).toContain('Lưu hồ sơ trước');
      await page.fill('#shop-name', SHOP_NAME);
      await page.fill('#shop-phone', SHOP_PHONE);
      await page.fill('#shop-address', SHOP_ADDRESS);
      await shot(page, 'f21-filled');

      // ---- save WITHOUT a position -------------------------------------------------------------------------------------
      await page.click('#shop-save');
      await page.waitFor(`document.body.innerText.includes('Đã lưu hồ sơ')`);
      let rows = await shopRows(userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'INCOMPLETE', accepting_orders: false, version: '1', pickup_lat: null, pickup_lng: null, service_area_id: null, name: SHOP_NAME, contact_phone_normalized: '+84912345678' });
      expect(await rolesOf(userId)).toEqual(['CUSTOMER']);
      expect(await geoCalls(page)).toBe(0);
      expect(page.requests.filter((request) => request.method === 'PUT' && new URL(request.url).pathname === '/v1/onboarding/shop/profile')).toHaveLength(1);
      expect(await page.text('#shop-complete-reason')).toContain('vị trí');

      // ---- the draft is readable again: a new page load is a new session, so sign in again would be needed; the draft is read
      // through the API by leaving F21 and coming back (F20 reads the server, then "Tiếp tục hồ sơ" opens F21 from it).
      await page.click('button[aria-label="Quay lại"], header button');
      await page.waitFor(`location.pathname === '/shop/start'`);
      await page.waitFor(`document.querySelector('#shop-start-cta')?.textContent.trim() === 'Tiếp tục hồ sơ'`);
      await shot(page, 'f20-draft');
      await page.click('#shop-start-cta');
      await page.waitFor(`location.pathname === '/shop/onboarding' && document.querySelector('#shop-name') && !document.querySelector('#shop-name').disabled`);
      expect(await page.evaluate<string>(`document.querySelector('#shop-name').value`)).toBe(SHOP_NAME);
      expect(await page.evaluate<string>(`document.querySelector('#shop-phone').value`)).toBe('+84912345678');
      expect(await page.evaluate<string>(`document.querySelector('#shop-address').value`)).toBe(SHOP_ADDRESS);

      // ---- F22: nothing is asked of the device until the button is pressed; a refusal produces no position ----------------
      await page.fill('#shop-address', `${SHOP_ADDRESS} (sửa chưa lưu)`);
      await page.click('#shop-gps');
      await page.waitFor(`location.pathname === '/shop/location'`);
      expect(await page.evaluate<boolean>(`document.querySelector('.c-dialog, [role="dialog"]') === null`)).toBe(true);
      expect(await geoCalls(page)).toBe(0);
      await shot(page, 'f22-before');
      await page.evaluate(`window.__geo.mode = 'denied'`);
      await page.click('#location-get');
      await page.waitFor(`document.body.innerText.includes('Chưa được cấp quyền vị trí')`);
      expect(await geoCalls(page)).toBe(1);
      expect(await page.evaluate<boolean>(`document.querySelector('#location-details') === null`)).toBe(true);
      expect(await page.evaluate<string>(`document.querySelector('#location-confirm').getAttribute('aria-disabled')`)).toBe('true');
      await shot(page, 'f22-denied');

      await page.evaluate(`window.__geo.mode = 'ok'`);
      await page.click('#location-get');
      await page.waitFor(`document.querySelector('#location-lat') !== null`);
      expect(await geoCalls(page)).toBe(2);
      expect(await page.text('#location-lat')).toBe(LAT.toFixed(6));
      expect(await page.text('#location-lng')).toBe(LNG.toFixed(6));
      expect(await page.text('#location-accuracy')).toContain('12');
      expect(await page.evaluate<string>(`document.querySelector('#location-confirm').getAttribute('aria-disabled')`)).toBe('false');
      await shot(page, 'f22-measured');
      await page.click('#location-confirm');
      await page.waitFor(`location.pathname === '/shop/onboarding' && document.querySelector('#shop-name') && !document.querySelector('#shop-name').disabled`);

      // ---- back in F21: what was typed (even unsaved) is still there; the position is shown but not yet saved -----------------
      expect(await page.evaluate<string>(`document.querySelector('#shop-address').value`)).toBe(`${SHOP_ADDRESS} (sửa chưa lưu)`);
      expect(await page.text('#location-lat')).toBe(LAT.toFixed(6));
      expect((await shopRows(userId))[0]?.pickup_lat).toBeNull();
      expect(await page.text('#shop-complete-reason')).toContain('chưa lưu');

      // ---- the area comes from the server's list ----------------------------------------------------------------------
      await page.evaluate(`(() => { const select = document.querySelector('#shop-area'); select.value = ${JSON.stringify(areaId)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await page.click('#shop-save');
      await page.waitFor(`document.body.innerText.includes('Đã lưu hồ sơ')`);
      rows = await shopRows(userId);
      expect(rows[0]).toMatchObject({ status: 'INCOMPLETE', version: '2', service_area_id: areaId });
      expect(rows[0]?.pickup_lat).toBeCloseTo(LAT, 6);
      expect(rows[0]?.pickup_lng).toBeCloseTo(LNG, 6);
      await page.waitFor(`document.querySelector('#shop-complete').getAttribute('aria-disabled') === 'false'`);
      await shot(page, 'f21-ready-to-complete');

      // ---- complete: ACTIVE, not accepting orders, SHOP role granted, CUSTOMER kept ------------------------------------------
      await page.click('#shop-complete');
      await page.waitFor(`document.querySelector('#shop-open-home') !== null`);
      rows = await shopRows(userId);
      expect(rows[0]).toMatchObject({ status: 'ACTIVE', accepting_orders: false, version: '3' });
      expect(await rolesOf(userId)).toEqual(['CUSTOMER', 'SHOP']);
      expect(page.requests.some((request) => request.method === 'GET' && new URL(request.url).pathname === '/v1/client-auth/me')).toBe(true);
      expect(page.requests.filter((request) => request.method === 'POST' && new URL(request.url).pathname === '/v1/onboarding/shop/complete')).toHaveLength(1);
      await shot(page, 'f21-completed');

      // ---- enter SHOP_OWNER (the server selects it), see the real state, go back to CUSTOMER --------------------------------
      await page.click('#shop-open-home');
      await page.waitFor(`location.pathname === '/shop/home' && document.querySelector('#shop-home-name')`);
      expect(await page.text('#shop-home-name')).toBe(SHOP_NAME);
      const home = await mainText(page);
      expect(home).toContain('Đang ở: Chủ quán');
      expect(home).toContain('Chưa nhận đơn');
      expect(home).toContain('Hồ sơ hoàn tất');
      await shot(page, 'f23-shop-owner');
      await clickRow(page, 'Về giao diện khách hàng');
      await page.waitFor(`location.pathname === '/account'`);
      const contexts = page.requests.filter((request) => request.method === 'POST' && new URL(request.url).pathname === '/v1/client-auth/context');
      expect(contexts).toHaveLength(2);
      const account = await mainText(page);
      expect(account).toContain('Khách hàng');
      expect(account).toContain('Chủ quán');
      expect(await rolesOf(userId)).toEqual(['CUSTOMER', 'SHOP']);
      await shot(page, 'f04-account-after');

      // One shop, nothing created twice; no secret or draft in the URL, history or storage.
      expect(await shopRows(userId)).toHaveLength(1);
      const leaks = await page.evaluate<string[]>(`(() => {
        const haystack = [location.href, JSON.stringify(history.state), JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage }), document.cookie].join('\\n');
        return [${JSON.stringify(PASSWORD)}, ${JSON.stringify(SHOP_NAME)}, ${JSON.stringify(SHOP_ADDRESS)}, '${LAT.toFixed(4)}'].filter((secret) => haystack.includes(secret));
      })()`);
      expect(leaks).toEqual([]);
      expect(await page.evaluate<number>('localStorage.length + sessionStorage.length')).toBe(0);
      expect(page.consoleErrors).toEqual([]);
    } finally {
      await page.close();
    }
  }, 180_000);
});

/** Writes the screenshots to .test-results/food-shop-shots (CI uploads them as an artifact). */
function publishShots(shots: readonly Shot[]): void {
  if (shots.length === 0) {
    return;
  }
  const directory = join(repoRoot(), '.test-results', 'food-shop-shots');
  mkdirSync(directory, { recursive: true });
  for (const item of shots) {
    writeFileSync(join(directory, `${item.name}.webp`), item.data);
  }
}
