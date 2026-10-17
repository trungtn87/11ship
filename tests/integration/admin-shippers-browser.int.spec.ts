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
import { grantRole, Phone, randomPhone } from './support/auth-fixtures';
import { createInvitation, createPayload, systemSession, SystemSession } from './support/provisioning-fixtures';

// M03 on the Administration web in a REAL Chrome against the real front, backend and PostgreSQL: the Shipper list (search, filter), the
// detail (profile, bank, readiness, classification, history), the review commands with their popups (reason required, one request,
// the answer read back), the bank verification, the classification, and the SYSTEM-only wallet parameters page. Screenshots of the real
// pages go to .test-results/admin-shipper-shots.

const tag = randomBytes(2).toString('hex').toUpperCase();
const NAME_A = `Nguyễn Văn Duyệt ${tag}`;
const NAME_B = `Trần Thị Từ Chối ${tag}`;

interface Shot {
  readonly name: string;
  readonly data: Buffer;
}
interface Person {
  readonly phone: Phone;
  readonly userId: string;
  readonly secret: string;
}

describe('admin Shippers (real browser)', () => {
  let app: AdminApp;
  let system: SystemSession;
  let front: ChildProcess | undefined;
  let browser: Browser | undefined;
  let origin = '';
  let tlsDir = '';
  const shots: Shot[] = [];
  let driverAdmin: Person;
  let shopAdmin: Person;
  let hash = '';
  let idA = '';
  let idB = '';

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

  /** A Shipper account with a profile sent for review and a bank account of its own name — what the Android app produces. */
  async function seedShipper(fullName: string, holder: string): Promise<string> {
    const phone = randomPhone();
    app.track(phone.normalized);
    const userId = randomUUID();
    await app.pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, clock_timestamp(), 'PHONE_VERIFIED', 'ACTIVE', 1, clock_timestamp(), clock_timestamp())`,
      [userId, phone.normalized, hash],
    );
    await grantRole(app.pool, userId, 'DRIVER');
    const driverId = (await app.pool.query<{ driver_id: string }>('SELECT driver_id FROM app.drivers WHERE user_id = $1::uuid', [userId])).rows[0]?.driver_id as string;
    await app.pool.query(
      `UPDATE app.drivers SET full_name = $2, review_state = 'SUBMITTED', submitted_at = clock_timestamp() WHERE driver_id = $1::uuid`,
      [driverId, fullName],
    );
    await app.pool.query(
      `INSERT INTO app.driver_bank_accounts (driver_id, bank_code, bank_name, account_number, account_holder, created_at, updated_at)
       VALUES ($1::uuid, 'VCB', 'Vietcombank', '0123456789', $2, clock_timestamp(), clock_timestamp())`,
      [driverId, holder],
    );
    return driverId;
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
  const press = (page: Page, text: string, within = 'document'): Promise<boolean> =>
    page.evaluate<boolean>(`(() => { const b = [...${within}.querySelectorAll('button')].find((x) => (x.textContent ?? '').trim() === ${JSON.stringify(text)} && !x.disabled); if (!b) return false; b.click(); return true; })()`);
  const rowsText = (page: Page): Promise<string[]> =>
    page.evaluate<string[]>(`[...document.querySelectorAll('.table tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()).join(' | '))`);
  const waitRows = (page: Page, predicate: string): Promise<void> => page.waitFor(`(() => { const rows = [...document.querySelectorAll('.table tbody tr')].map((tr) => tr.textContent); return ${predicate}; })()`);
  const driverRow = async (id: string): Promise<Record<string, unknown>> => (await app.pool.query('SELECT * FROM app.drivers WHERE driver_id = $1::uuid', [id])).rows[0] as Record<string, unknown>;

  beforeAll(async () => {
    runScript('admin-web-build.mjs');
    tlsDir = mkdtempSync(join(tmpdir(), 'admin-shippers-tls-'));
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
    hash = await new Argon2idPasswordHasher().hash(ADMIN_PASSWORD);
    system = await systemSession(app);
    // The administrators exist before any browser login: a SYSTEM login in the page ends the earlier SYSTEM session.
    driverAdmin = await activatedAdmin([{ app: 'DRIVER', can_view: true, can_review_profile: true, can_lock: false }], `Quản trị Shipper ${tag}`);
    shopAdmin = await activatedAdmin([{ app: 'SHOP', can_view: true, can_review_profile: false, can_lock: false }], `Quản trị Quán ${tag}`);
    idA = await seedShipper(NAME_A, `NGUYEN VAN DUYET ${tag}`);
    idB = await seedShipper(NAME_B, `TRAN THI TU CHOI ${tag}`);
  }, 300_000);

  afterAll(async () => {
    const directory = join(repoRoot(), '.test-results', 'admin-shipper-shots');
    mkdirSync(directory, { recursive: true });
    for (const item of shots) {
      writeFileSync(join(directory, `${item.name}.webp`), item.data);
    }
    await browser?.close();
    front?.kill('SIGTERM');
    if (app !== undefined) {
      // Shippers (and their bank accounts / history) go with their accounts; then what points at the administrators.
      for (const table of ['driver_events', 'driver_bank_accounts']) {
        await app.pool.query(`DELETE FROM ${'app.' + table} WHERE driver_id = ANY($1::uuid[])`, [[idA, idB]]);
      }
      await app.pool.query('DELETE FROM app.drivers WHERE driver_id = ANY($1::uuid[])', [[idA, idB]]);
      await app.pool.query('DELETE FROM app.shipper_wallet_parameter_changes');
      await app.pool.query('UPDATE app.shipper_wallet_parameters SET updated_by = NULL');
      await app.close();
    }
    if (tlsDir !== '') {
      rmSync(tlsDir, { recursive: true, force: true });
    }
  });

  it('SYSTEM: list, search, filter, detail, approve, verify the bank, classify, reject with a reason; the history shows who did what', async () => {
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 900, false);
    await page.send('Network.clearBrowserCookies');
    await signIn(page, { phone: system.account.phone, password: system.account.password, userId: system.account.userId, secret: system.login.secret });

    // The menu entry and the list.
    expect(await page.evaluate<boolean>(`!!document.querySelector('a[href="/operations/shippers"]')`)).toBe(true);
    await page.goto(`${origin}/operations/shippers`);
    await page.waitFor(`document.querySelector('#shipper-title') && document.querySelectorAll('.table tbody tr').length >= 2`);
    await page.fill('#shipper-search', tag);
    await waitRows(page, `rows.length === 2 && rows.every((r) => r.includes('SH'))`);
    const listed = await rowsText(page);
    expect(listed.some((row) => row.includes(NAME_A) && row.includes('Chờ xét duyệt') && row.includes('EXTERNAL') && row.includes('Chờ xác minh'))).toBe(true);
    await shot(page, 'shippers-list-desktop');
    // Names are found without marks, like the dish groups.
    await page.fill('#shipper-search', `nguyen van duyet ${tag.toLowerCase()}`);
    await waitRows(page, `rows.length === 1 && rows[0].includes(${JSON.stringify(NAME_A)})`);
    await page.fill('#shipper-search', 'khong-co-shipper-nay');
    await page.waitFor(`document.body.innerText.includes('Không tìm thấy Shipper')`);
    await page.fill('#shipper-search', tag);
    await waitRows(page, `rows.length === 2`);
    await page.evaluate(`(() => { const s = document.querySelector('#shipper-status'); s.value = 'ACTIVE'; s.dispatchEvent(new Event('change')); return true; })()`);
    await page.waitFor(`document.body.innerText.includes('Không tìm thấy Shipper')`);
    await page.evaluate(`(() => { const s = document.querySelector('#shipper-status'); s.value = 'SUBMITTED'; s.dispatchEvent(new Event('change')); return true; })()`);
    await waitRows(page, `rows.length === 2`);

    // Detail of A: profile, bank (with the number to check), readiness, classification, history.
    await page.goto(`${origin}/operations/shippers/${idA}`);
    await page.waitFor(`document.querySelector('#shipper-detail-title') && document.body.innerText.includes('Lịch sử thao tác')`);
    const text = await page.evaluate<string>(`document.body.innerText`);
    for (const expected of [NAME_A, 'Tài khoản ngân hàng', 'Vietcombank', 'Chờ xác minh', 'Trạng thái nhận đơn', 'Ví chưa sẵn sàng', 'Phân loại nội bộ', 'EXTERNAL']) {
      expect(text).toContain(expected);
    }
    await page.reload();
    await page.waitFor(`document.querySelector('#shipper-detail-title') && document.body.innerText.includes('Lịch sử thao tác')`);
    await shot(page, 'shipper-detail-pending-desktop');

    // Approve: popup, one request, the answer read back.
    expect(await press(page, 'Duyệt hồ sơ')).toBe(true);
    await page.waitFor(`document.querySelector('.dialog')`);
    await shot(page, 'shipper-approve-popup-desktop');
    expect(await press(page, 'Duyệt', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`!document.querySelector('.dialog') && document.body.innerText.includes('Đã cập nhật.') && document.body.innerText.includes('Đã duyệt')`);
    expect(await driverRow(idA)).toMatchObject({ status: 'ACTIVE', review_state: 'APPROVED', accepting_deliveries: false });
    expect(await count(app.pool, "SELECT 1 FROM app.audit_logs WHERE resource_id = $1 AND action = 'admin.shipper.approve.v1'", [idA])).toBe(1);

    // Bank verification.
    expect(await press(page, 'Xác minh ngân hàng')).toBe(true);
    await page.waitFor(`document.querySelector('.dialog')`);
    expect(await press(page, 'Xác minh', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`!document.querySelector('.dialog') && document.body.innerText.includes('Đã xác minh')`);
    expect((await app.pool.query('SELECT verification_state FROM app.driver_bank_accounts WHERE driver_id = $1::uuid', [idA])).rows[0]).toEqual({ verification_state: 'VERIFIED' });

    // Classification: only here.
    expect(await press(page, 'Chuyển sang PLATFORM')).toBe(true);
    await page.waitFor(`document.querySelector('.dialog')`);
    expect(await press(page, 'Đổi phân loại', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`!document.querySelector('.dialog') && document.body.innerText.includes('PLATFORM · Shipper của nền tảng')`);
    expect((await driverRow(idA)).driver_type).toBe('PLATFORM');

    // The readiness still says what is missing (the wallet belongs to M04), and the history names the three actions.
    const after = await page.evaluate<string>(`document.body.innerText`);
    expect(after).toContain('Ví chưa sẵn sàng');
    for (const label of ['Admin duyệt hồ sơ', 'Admin xác minh ngân hàng', 'Admin đổi phân loại nội bộ']) {
      expect(after).toContain(label);
    }
    await shot(page, 'shipper-detail-approved-desktop');

    // Lock needs a reason: empty is refused on the page, nothing is sent.
    expect(await press(page, 'Khóa hoạt động')).toBe(true);
    await page.waitFor(`document.querySelector('.dialog')`);
    const before = await driverRow(idA);
    expect(await press(page, 'Khóa', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`document.querySelector('#shipper-reason-error').textContent.includes('Lý do là bắt buộc')`);
    expect(await driverRow(idA)).toEqual(before);
    await page.fill('#shipper-reason', 'Khiếu nại giao hàng');
    expect(await press(page, 'Khóa', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`!document.querySelector('.dialog') && document.body.innerText.includes('Tạm khóa')`);
    expect(await driverRow(idA)).toMatchObject({ status: 'SUSPENDED', suspension_reason: 'Khiếu nại giao hàng', accepting_deliveries: false });
    expect(await press(page, 'Mở lại hoạt động')).toBe(true);
    await page.waitFor(`document.querySelector('.dialog')`);
    expect(await press(page, 'Mở lại', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`!document.querySelector('.dialog') && document.body.innerText.includes('Đã duyệt · hoạt động')`);
    expect((await driverRow(idA)).status).toBe('ACTIVE');

    // Reject B: the reason is required and is what the Shipper sees.
    await page.goto(`${origin}/operations/shippers/${idB}`);
    await page.waitFor(`document.querySelector('#shipper-detail-title') && document.body.innerText.includes(${JSON.stringify(NAME_B)})`);
    expect(await press(page, 'Từ chối')).toBe(true);
    await page.waitFor(`document.querySelector('.dialog')`);
    await page.fill('#shipper-reason', 'Tên chủ tài khoản chưa rõ');
    await shot(page, 'shipper-reject-popup-desktop');
    expect(await press(page, 'Từ chối', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`!document.querySelector('.dialog') && document.body.innerText.includes('Đã từ chối: Tên chủ tài khoản chưa rõ')`);
    expect(await driverRow(idB)).toMatchObject({ status: 'PENDING', review_state: 'REJECTED', rejection_reason: 'Tên chủ tài khoản chưa rõ' });

    // A phone-sized layout keeps the page usable and does not scroll sideways.
    await page.viewport(390, 844, true);
    await page.goto(`${origin}/operations/shippers/${idA}`);
    await page.waitFor(`document.querySelector('#shipper-detail-title')`);
    expect(await page.evaluate<boolean>(`document.documentElement.scrollWidth <= window.innerWidth`)).toBe(true);
    await shot(page, 'shipper-detail-phone');
    await page.close();
  }, 240_000);

  it('SYSTEM: the wallet parameters page reads the stored values, validates what is typed, saves once and shows the history', async () => {
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 900, false);
    await page.send('Network.clearBrowserCookies');
    // The earlier test's page ended the SYSTEM login's session; sign in again through the page.
    await signIn(page, { phone: system.account.phone, password: system.account.password, userId: system.account.userId, secret: system.login.secret });
    expect(await page.evaluate<boolean>(`!!document.querySelector('a[href="/system/parameters/shipper-wallet"]')`)).toBe(true);
    await page.goto(`${origin}/system/parameters/shipper-wallet`);
    await page.waitFor(`document.querySelector('#wallet-topup') && document.querySelector('#wallet-topup').value === '100000'`);
    expect(await page.evaluate<string>(`document.querySelector('#wallet-withdraw').value`)).toBe('10000');
    // SYSTEM edits: there is a Save button and the fields are not read-only. A direct reload of the route is served.
    expect(await page.evaluate<boolean>(`!document.querySelector('#wallet-topup').readOnly && !document.querySelector('#wallet-readonly')`)).toBe(true);
    await page.reload();
    await page.waitFor(`document.querySelector('#wallet-topup') && document.querySelector('#wallet-topup').value === '100000'`);
    await shot(page, 'wallet-parameters-desktop');

    // Nothing but a whole positive VND is sent.
    await page.fill('#wallet-topup', '0');
    expect(await press(page, 'Lưu')).toBe(true);
    await page.waitFor(`document.querySelector('#wallet-topup-error').textContent.includes('số nguyên VND dương')`);
    await page.fill('#wallet-topup', '1,5');
    expect(await press(page, 'Lưu')).toBe(true);
    await page.waitFor(`document.querySelector('#wallet-topup-error').textContent.includes('số nguyên VND dương')`);
    expect(await count(app.pool, 'SELECT 1 FROM app.shipper_wallet_parameter_changes')).toBe(0);

    await page.fill('#wallet-topup', '150.000');
    await page.fill('#wallet-withdraw', '20000');
    expect(await press(page, 'Lưu')).toBe(true);
    await page.waitFor(`document.querySelector('#wallet-topup').value === '150000' && document.body.innerText.includes('Lịch sử chỉnh sửa') && document.body.innerText.includes('→')`);
    expect((await app.pool.query('SELECT param_key, int_value::int AS v FROM app.shipper_wallet_parameters ORDER BY param_key')).rows).toEqual([
      { param_key: 'topup_min_vnd', v: 150000 },
      { param_key: 'withdraw_min_vnd', v: 20000 },
    ]);
    expect(await count(app.pool, 'SELECT 1 FROM app.shipper_wallet_parameter_changes')).toBe(2);
    await shot(page, 'wallet-parameters-saved-desktop');
    // Back to the defaults.
    await page.fill('#wallet-topup', '100000');
    await page.fill('#wallet-withdraw', '10000');
    expect(await press(page, 'Lưu')).toBe(true);
    await page.waitFor(`document.querySelector('#wallet-topup').value === '100000' && document.querySelector('#wallet-withdraw').value === '10000'`);
    await page.close();
  }, 240_000);

  it('an ADMIN without the DRIVER right has no Shipper entries but reads the parameters (read-only); reload of both routes is served', async () => {
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 900, false);
    await page.send('Network.clearBrowserCookies');
    await signIn(page, { phone: shopAdmin.phone, password: ADMIN_PASSWORD, userId: shopAdmin.userId, secret: shopAdmin.secret });
    expect(await page.evaluate<boolean>(`!document.querySelector('a[href="/operations/shippers"]') && !!document.querySelector('a[href="/system/parameters/shipper-wallet"]')`)).toBe(true);
    await page.goto(`${origin}/operations/shippers`);
    await page.waitFor(`document.body.innerText.includes('Không có quyền')`);
    await page.goto(`${origin}/system/parameters/shipper-wallet`);
    await page.waitFor(`document.querySelector('#wallet-topup') && document.querySelector('#wallet-topup').value.includes('100')`);
    expect(await page.evaluate<boolean>(`document.querySelector('#wallet-topup').readOnly && document.querySelector('#wallet-withdraw').readOnly`)).toBe(true);
    expect(await page.evaluate<boolean>(`![...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Lưu') && !!document.querySelector('#wallet-readonly')`)).toBe(true);
    await shot(page, 'wallet-parameters-admin-readonly');
    await page.reload();
    await page.waitFor(`document.querySelector('#wallet-topup')`);
    await page.close();
  }, 120_000);

  it('an ADMIN with the DRIVER review right sees the Shipper pages and reads (not edits) the parameters; reload of a Shipper page is served', async () => {
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 900, false);
    await page.send('Network.clearBrowserCookies');
    await signIn(page, { phone: driverAdmin.phone, password: ADMIN_PASSWORD, userId: driverAdmin.userId, secret: driverAdmin.secret });
    expect(await page.evaluate<boolean>(`!!document.querySelector('a[href="/operations/shippers"]') && !!document.querySelector('a[href="/system/parameters/shipper-wallet"]')`)).toBe(true);
    await page.goto(`${origin}/operations/shippers`);
    await page.waitFor(`document.querySelector('#shipper-title') && document.querySelectorAll('.table tbody tr').length >= 1`);
    await page.reload();
    await page.waitFor(`document.querySelector('#shipper-title')`);
    await page.goto(`${origin}/operations/shippers/${idA}`);
    await page.waitFor(`document.querySelector('#shipper-detail-title')`);
    await page.reload();
    await page.waitFor(`document.querySelector('#shipper-detail-title')`);
    await page.goto(`${origin}/system/parameters/shipper-wallet`);
    await page.waitFor(`document.querySelector('#wallet-readonly')`);
    await page.close();
  }, 120_000);
});
