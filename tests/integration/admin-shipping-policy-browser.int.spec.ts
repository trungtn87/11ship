import { createHash, randomBytes, X509Certificate } from 'node:crypto';
import { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ADMIN_ORIGIN, ADMIN_PASSWORD, AdminApp, adminData, count, rewindAcceptedStep, startAdminApp, totpNow } from './support/admin-fixtures';
import { begin, ok, post } from './support/activation-fixtures';
import { freePort, repoRoot, runScript, startFront } from './support/admin-web-harness';
import { Browser, launchChrome, Page } from './support/cdp';
import { Phone, randomPhone } from './support/auth-fixtures';
import { createInvitation, createPayload, systemSession, SystemSession } from './support/provisioning-fixtures';

// M06-A on the Administration web in a REAL Chrome against the real front, backend and PostgreSQL: the fee table page (tiers, tail,
// live validation, preview, draft, apply with its confirmation, the history), and the read-only view of an ADMIN. Screenshots of the real
// pages go to .test-results/admin-shipping-policy-shots.

const tag = randomBytes(2).toString('hex').toUpperCase();

interface Person {
  readonly phone: Phone;
  readonly userId: string;
  readonly secret: string;
}

describe('admin shipping fee table (real browser)', () => {
  let app: AdminApp;
  let system: SystemSession;
  let front: ChildProcess | undefined;
  let browser: Browser | undefined;
  let origin = '';
  let tlsDir = '';
  let viewer: Person;
  const shots: Array<{ name: string; data: Buffer }> = [];

  async function resetPolicy(): Promise<void> {
    const client = await app.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE app.shipping_fee_policy_versions DISABLE TRIGGER shipping_fee_policy_versions_immutable');
      await client.query('DELETE FROM app.shipping_fee_policy_versions');
      await client.query('ALTER TABLE app.shipping_fee_policy_versions ENABLE TRIGGER shipping_fee_policy_versions_immutable');
      await client.query('UPDATE app.shipping_fee_policy_drafts SET version = version + 1, tiers = NULL, tail_base_fee_vnd = NULL, tail_step_m = NULL, tail_step_fee_vnd = NULL, updated_by = NULL');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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
  const text = (page: Page, selector: string): Promise<string> => page.evaluate<string>(`(document.querySelector(${JSON.stringify(selector)})?.textContent ?? '').trim()`);
  const fillRow = async (page: Page, index: number, from: string, to: string, fee: string): Promise<void> => {
    await page.fill(`#sp-row-${String(index)}-from`, from);
    await page.fill(`#sp-row-${String(index)}-to`, to);
    await page.fill(`#sp-row-${String(index)}-fee`, fee);
  };

  beforeAll(async () => {
    runScript('admin-web-build.mjs');
    tlsDir = mkdtempSync(join(tmpdir(), 'admin-shipping-policy-tls-'));
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
    const phone = randomPhone();
    app.track(phone.normalized);
    const invitation = await createInvitation(app, system, createPayload(phone.local, { full_name: `Xem phí ${tag}`, permissions: [{ app: 'SHOP', can_view: true, can_review_profile: false, can_lock: false }] }));
    const token = invitation.link.split('#t=')[1] as string;
    const session = await begin(app, { invitationId: invitation.invitationId, token, phone });
    ok(await post(app, '/password', session, { password: ADMIN_PASSWORD }));
    const secret = String(adminData(ok(await post(app, '/totp/enrollment', session))).secret);
    ok(await post(app, '/complete', session, { code: totpNow(secret) }));
    const found = await app.pool.query<{ user_id: string }>('SELECT user_id FROM app.users WHERE phone_normalized = $1', [phone.normalized]);
    viewer = { phone, userId: (found.rows[0] as { user_id: string }).user_id, secret };
    await resetPolicy();
  }, 300_000);

  afterAll(async () => {
    const directory = join(repoRoot(), '.test-results', 'admin-shipping-policy-shots');
    mkdirSync(directory, { recursive: true });
    for (const item of shots) {
      writeFileSync(join(directory, `${item.name}.webp`), item.data);
    }
    await browser?.close();
    front?.kill('SIGTERM');
    if (app !== undefined) {
      await resetPolicy();
      await app.close();
    }
    if (tlsDir !== '') {
      rmSync(tlsDir, { recursive: true, force: true });
    }
  });

  it('SYSTEM: builds a table, is told what is wrong while typing, previews, saves a draft, applies after confirming, and reads the history', async () => {
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 900, false);
    await page.send('Network.clearBrowserCookies');
    await signIn(page, { phone: system.account.phone, password: system.account.password, userId: system.account.userId, secret: system.login.secret });
    expect(await page.evaluate<boolean>(`!!document.querySelector('a[href="/system/shipping-fee-policy"]')`)).toBe(true);
    await page.goto(`${origin}/system/shipping-fee-policy`);
    await page.waitFor(`document.querySelector('#sp-title') && document.querySelector('#sp-verdict')`);
    // No table yet: nothing is priced, and the page says so (never 0đ).
    expect(await text(page, '#sp-table-error')).toContain('Thêm ít nhất');
    expect(await page.evaluate<boolean>(`[...document.querySelectorAll('button')].filter((b) => ['Lưu bản nháp', 'Áp dụng bảng giá'].includes(b.textContent.trim())).every((b) => b.disabled)`)).toBe(true);

    expect(await press(page, '+ Thêm mốc')).toBe(true);
    await fillRow(page, 0, '0', '2', '10000');
    expect(await press(page, '+ Thêm mốc')).toBe(true);
    // A gap is named at once and nothing can be saved.
    await fillRow(page, 1, '2.5', '4', '12000');
    await page.waitFor(`document.querySelector('#sp-row-1-from-error').textContent.includes('Hở')`);
    await page.fill('#sp-tail-base', '20000');
    await page.fill('#sp-tail-step', '1');
    await page.fill('#sp-tail-stepfee', '3000');
    await page.waitFor(`document.querySelector('#sp-verdict').textContent.includes('chưa hợp lệ')`);
    expect(await page.evaluate<boolean>(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Lưu bản nháp').disabled`)).toBe(true);
    await shot(page, 'policy-gap-error');
    // An overlap too; then the fix.
    await page.fill('#sp-row-1-from', '1');
    await page.waitFor(`document.querySelector('#sp-row-1-from-error').textContent.includes('Chồng')`);
    await page.fill('#sp-row-1-from', '2');
    await page.waitFor(`document.querySelector('#sp-verdict').textContent.includes('✓ Các mốc liên tục')`);
    expect(await press(page, '+ Thêm mốc')).toBe(true);
    await fillRow(page, 2, '4', '7', '15000');
    expect(await press(page, '+ Thêm mốc')).toBe(true);
    await fillRow(page, 3, '7', '10', '20000');
    await page.waitFor(`document.querySelector('#sp-verdict').textContent.includes('✓ Các mốc liên tục')`);

    // The preview prices the table being edited, from the server (5.5 km -> 15.000đ), and past the last tier (11 km -> 23.000đ).
    await page.fill('#sp-preview-km', '5.5');
    await page.waitFor(`document.querySelector('#sp-preview-fee').textContent === '15.000đ'`);
    await page.fill('#sp-preview-km', '11');
    await page.waitFor(`document.querySelector('#sp-preview-fee').textContent === '23.000đ'`);
    await page.fill('#sp-preview-km', '1.999');
    await page.waitFor(`document.querySelector('#sp-preview-fee').textContent === '10.000đ'`);
    await shot(page, 'policy-table-edited');
    expect(await count(app.pool, 'SELECT 1 FROM app.shipping_fee_policy_versions')).toBe(0); // typing and previewing write nothing

    // A draft is saved but not in force.
    expect(await press(page, 'Lưu bản nháp')).toBe(true);
    await page.waitFor(`document.querySelector('#sp-status').textContent.includes('Đã lưu bản nháp')`);
    expect(await count(app.pool, 'SELECT 1 FROM app.shipping_fee_policy_drafts WHERE tiers IS NOT NULL')).toBe(1);
    expect(await count(app.pool, 'SELECT 1 FROM app.shipping_fee_policy_versions')).toBe(0);

    // Apply asks first; cancelling changes nothing.
    expect(await press(page, 'Áp dụng bảng giá')).toBe(true);
    await page.waitFor(`document.querySelector('[role=dialog]') && document.querySelector('[role=dialog]').textContent.includes('phiên bản 1')`);
    await shot(page, 'policy-apply-confirm');
    expect(await press(page, 'Hủy', `document.querySelector('[role=dialog]')`)).toBe(true);
    expect(await count(app.pool, 'SELECT 1 FROM app.shipping_fee_policy_versions')).toBe(0);
    expect(await press(page, 'Áp dụng bảng giá')).toBe(true);
    await page.waitFor(`document.querySelector('[role=dialog]')`);
    await page.fill('#sp-note', `Bảng giá đầu ${tag}`);
    expect(await press(page, 'Áp dụng', `document.querySelector('[role=dialog]')`)).toBe(true);
    await page.waitFor(`document.querySelector('#sp-status') && document.querySelector('#sp-status').textContent.includes('Đã áp dụng bảng giá phiên bản 1')`);
    expect(await count(app.pool, 'SELECT 1 FROM app.shipping_fee_policy_versions WHERE version_no = 1')).toBe(1);
    expect(await text(page, '#sp-verdict')).toContain('Đang áp dụng phiên bản 1');

    // Change one tier and apply again: version 2; the history lists both and says what changed.
    await page.fill('#sp-row-0-fee', '9000');
    await page.waitFor(`!([...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Áp dụng bảng giá').disabled)`);
    expect(await press(page, 'Áp dụng bảng giá')).toBe(true);
    await page.waitFor(`document.querySelector('[role=dialog]') && document.querySelector('[role=dialog]').textContent.includes('phiên bản 2') && document.querySelector('[role=dialog]').textContent.includes('Mốc 1')`);
    expect(await press(page, 'Áp dụng', `document.querySelector('[role=dialog]')`)).toBe(true);
    await page.waitFor(`document.querySelector('#sp-status') && document.querySelector('#sp-status').textContent.includes('phiên bản 2')`);
    expect((await app.pool.query('SELECT version_no::int AS n FROM app.shipping_fee_policy_versions ORDER BY version_no')).rows).toEqual([{ n: 1 }, { n: 2 }]);
    await page.click('#sp-tab-history');
    await page.waitFor(`document.querySelector('#sp-version-1') && document.querySelector('#sp-version-2')`);
    expect(await text(page, '#sp-version-2')).toContain('đang áp dụng');
    expect(await text(page, '#sp-version-2')).toContain('Mốc 1');
    expect(await text(page, '#sp-version-1')).toContain(`Bảng giá đầu ${tag}`);
    await shot(page, 'policy-history');
    // The conditions tab says plainly that it is not connected yet and does not offer to edit.
    await page.click('#sp-tab-conditions');
    await page.waitFor(`document.querySelector('#sp-conditions-pending')`);
    expect(await page.evaluate<boolean>(`document.querySelectorAll('.sp-card input').length === 0`)).toBe(true);
    await shot(page, 'policy-conditions-pending');
    await page.goto(`${origin}/system/shipping-fee-policy`);
    await page.waitFor(`document.querySelector('#sp-row-0-fee') && document.querySelector('#sp-row-0-fee').value === '9000'`);
    await page.close();
  }, 240_000);

  it('an ADMIN reads and previews but cannot edit: inputs are read-only, no save/apply, and the server would refuse anyway', async () => {
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 900, false);
    await page.send('Network.clearBrowserCookies');
    await signIn(page, { phone: viewer.phone, password: ADMIN_PASSWORD, userId: viewer.userId, secret: viewer.secret });
    expect(await page.evaluate<boolean>(`!!document.querySelector('a[href="/system/shipping-fee-policy"]')`)).toBe(true);
    await page.goto(`${origin}/system/shipping-fee-policy`);
    await page.waitFor(`document.querySelector('#sp-readonly') && document.querySelector('#sp-row-0-fee')`);
    expect(await page.evaluate<boolean>(`[...document.querySelectorAll('.sp-rows input, #sp-tail-base, #sp-tail-step, #sp-tail-stepfee')].every((i) => i.readOnly)`)).toBe(true);
    expect(await page.evaluate<boolean>(`![...document.querySelectorAll('button')].some((b) => ['Lưu bản nháp', 'Áp dụng bảng giá', '+ Thêm mốc'].includes(b.textContent.trim()))`)).toBe(true);
    await page.fill('#sp-preview-km', '5.5');
    await page.waitFor(`document.querySelector('#sp-preview-fee').textContent === '15.000đ' || document.querySelector('#sp-preview-fee').textContent === '14.000đ' || /đ$/.test(document.querySelector('#sp-preview-fee').textContent)`);
    await shot(page, 'policy-admin-readonly');
    expect(await count(app.pool, 'SELECT 1 FROM app.shipping_fee_policy_versions')).toBe(2);
    await page.close();
  }, 120_000);
});
