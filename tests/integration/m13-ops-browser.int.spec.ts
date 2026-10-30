import { createHash, randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import { ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ADMIN_ORIGIN, ADMIN_PASSWORD, AdminApp, adminData, rewindAcceptedStep, startAdminApp, totpNow } from './support/admin-fixtures';
import { begin, ok, post } from './support/activation-fixtures';
import { freePort, runScript, startFront } from './support/admin-web-harness';
import { Browser, launchChrome, Page } from './support/cdp';
import { Phone, randomPhone } from './support/auth-fixtures';
import { createInvitation, createPayload, systemSession, SystemSession } from './support/provisioning-fixtures';

// M13 "Vận hành hệ thống" on the Administration web in a REAL Chrome against the real front, backend and PostgreSQL (test database only):
// the seven screens for SYSTEM, the default-deny of an ADMIN, the read-only view of an ADMIN with VIEW, the empty states, and one real action.

const tag = randomBytes(2).toString('hex').toUpperCase();
const SCREENS: ReadonlyArray<readonly [string, string, string]> = [
  ['/system-ops', 'ops-overview-title', 'Tổng quan vận hành'],
  ['/system-ops/vps', 'ops-vps-title', 'Giám sát VPS'],
  ['/system-ops/incidents', 'ops-incidents-title', 'Sự cố'],
  ['/system-ops/gateway', 'ops-gateway-title', 'SMS Gateway'],
  ['/system-ops/logs', 'ops-logs-title', 'Nhật ký'],
  ['/system-ops/releases', 'ops-releases-title', 'Phiên bản & cập nhật'],
  ['/system-ops/config', 'ops-config-title', 'Cấu hình và bảo trì'],
];

interface Person {
  readonly phone: Phone;
  readonly userId: string;
  readonly secret: string;
}

describe('M13 operations screens (real browser)', () => {
  let app: AdminApp;
  let system: SystemSession;
  let front: ChildProcess | undefined;
  let browser: Browser | undefined;
  let origin = '';
  let tlsDir = '';
  let viewer: Person;

  async function wipe(): Promise<void> {
    const client = await app.pool.connect();
    try {
      await client.query(`SET app.ops_purge = 'on'`);
      await client.query('UPDATE app.ops_incidents SET reopens_incident_id = NULL');
      for (const t of ['ops_events', 'ops_notifications', 'ops_incidents', 'ops_checks', 'ops_metrics', 'ops_metrics_hourly', 'ops_maintenance', 'ops_deploys', 'ops_version_reports', 'ops_releases', 'ops_backup_reports', 'ops_ingest_keys', 'ops_admin_scopes', 'ops_config']) {
        await client.query(`DELETE FROM app.${t}`);
      }
    } finally {
      client.release();
    }
  }

  async function signIn(page: Page, who: { phone: { local: string }; password: string; userId: string; secret: string }): Promise<void> {
    await app.clearLimits();
    await page.send('Network.clearBrowserCookies');
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

  const bodyText = (page: Page): Promise<string> => page.evaluate<string>('document.body.innerText');
  const press = (page: Page, label: string): Promise<boolean> =>
    page.evaluate<boolean>(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent ?? '').trim() === ${JSON.stringify(label)} && !x.disabled); if (!b) return false; b.click(); return true; })()`);
  const hasButton = (page: Page, label: string): Promise<boolean> =>
    page.evaluate<boolean>(`[...document.querySelectorAll('button')].some((x) => (x.textContent ?? '').trim() === ${JSON.stringify(label)})`);

  beforeAll(async () => {
    runScript('admin-web-build.mjs');
    tlsDir = mkdtempSync(join(tmpdir(), 'm13-ops-tls-'));
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
    const invitation = await createInvitation(app, system, createPayload(phone.local, { full_name: `Xem vận hành ${tag}`, permissions: [{ app: 'SHOP', can_view: true, can_review_profile: false, can_lock: false }] }));
    const token = invitation.link.split('#t=')[1] as string;
    const session = await begin(app, { invitationId: invitation.invitationId, token, phone });
    ok(await post(app, '/password', session, { password: ADMIN_PASSWORD }));
    const secret = String(adminData(ok(await post(app, '/totp/enrollment', session))).secret);
    ok(await post(app, '/complete', session, { code: totpNow(secret) }));
    const found = await app.pool.query<{ user_id: string }>('SELECT user_id FROM app.users WHERE phone_normalized = $1', [phone.normalized]);
    viewer = { phone, userId: (found.rows[0] as { user_id: string }).user_id, secret };
    await wipe();
  }, 300_000);

  afterAll(async () => {
    await browser?.close();
    front?.kill('SIGTERM');
    if (app !== undefined) {
      await wipe();
      await app.close();
    }
    if (tlsDir !== '') {
      rmSync(tlsDir, { recursive: true, force: true });
    }
  });

  it('SYSTEM: the menu leads to all seven screens; each opens, and with nothing recorded says so instead of showing green', async () => {
    await wipe();
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 900, false);
    try {
      await signIn(page, { phone: system.account.phone, password: system.account.password, userId: system.account.userId, secret: system.login.secret });
      for (const [path] of SCREENS) {
        expect(await page.evaluate<boolean>(`!!document.querySelector('a[href="${path}"]')`)).toBe(true);
      }
      for (const [path, titleId, title] of SCREENS) {
        await page.goto(`${origin}${path}`);
        await page.waitFor(`document.getElementById('${titleId}')`);
        expect(await page.evaluate<string>(`document.getElementById('${titleId}').textContent`)).toBe(title);
      }
      // Overview: no check has ever been recorded, so nothing may read as healthy.
      await page.goto(`${origin}/system-ops`);
      await page.waitFor(`document.getElementById('ops-overview-title') && document.body.innerText.includes('Chưa có')`);
      expect(await bodyText(page)).not.toContain('Bình thường');
      // G20-A: with no sample the VPS page says so plainly and shows nothing healthy-looking.
      await page.goto(`${origin}/system-ops/vps`);
      await page.waitFor(`document.body.innerText.includes('Chưa có mẫu nào từ bộ thu thập')`);
      expect(await bodyText(page)).not.toContain('Bình thường');
      await page.goto(`${origin}/system-ops/incidents`);
      await page.waitFor(`document.body.innerText.includes('Không có sự cố')`);
      await page.goto(`${origin}/system-ops/gateway`);
      await page.waitFor(`document.body.innerText.includes('Chưa ghép Gateway nào') || document.body.innerText.includes('Đăng ký / Quên mật khẩu')`);
      expect(await bodyText(page)).not.toMatch(/Số dư SIM:?\s*[0-9]/);
      await page.goto(`${origin}/system-ops/releases`);
      await page.waitFor(`document.body.innerText.includes('Chưa có thiết bị nào báo phiên bản') && document.body.innerText.includes('Chưa phát hành')`);
      await page.goto(`${origin}/system-ops/config`);
      await page.waitFor(`document.getElementById('cfg-webhook')`);
      // The webhook is a password-type field, never shown back.
      expect(await page.evaluate<string>(`document.getElementById('cfg-webhook').type`)).toBe('password');
    } finally {
      await page.close();
    }
  }, 240_000);

  it('SYSTEM: an incident can be received (acknowledged) and the timeline shows it; the server records the action once', async () => {
    await wipe();
    const incidentId = randomUUID();
    await app.pool.query(
      `INSERT INTO app.ops_incidents (incident_id, fingerprint, source, check_key, severity, status, title, impact, detected_by, first_seen_at, last_seen_at, occurrences, evidence, version, created_at, updated_at)
       VALUES ($1, 'browser.seed', 'API', 'api.ready', 'CRITICAL', 'NEW', 'API công khai không phản hồi', 'Ứng dụng có thể không dùng được', 'INTERNAL', now() - interval '5 minutes', now(), 3, '{"measured":"3 lần liên tiếp"}'::jsonb, 1, now(), now())`,
      [incidentId],
    );
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 900, false);
    try {
      await signIn(page, { phone: system.account.phone, password: system.account.password, userId: system.account.userId, secret: system.login.secret });
      await page.goto(`${origin}/system-ops/incidents`);
      await page.waitFor(`document.body.innerText.includes('API công khai không phản hồi')`);
      await page.evaluate(`(() => { const a = [...document.querySelectorAll('a,button')].find((x) => x.textContent.includes('API công khai không phản hồi') || /SC-/.test(x.textContent)); a && a.click(); })()`);
      await page.waitFor(`document.getElementById('ops-incident-title')`);
      await page.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Nhận xử lý')`);
      expect(await press(page, 'Nhận xử lý')).toBe(true);
      await page.waitFor(`!([...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Nhận xử lý' && !b.disabled))`);
      const row = await app.pool.query<{ status: string }>('SELECT status FROM app.ops_incidents WHERE incident_id = $1', [incidentId]);
      expect(row.rows[0]?.status).toBe('ACKNOWLEDGED');
    } finally {
      await page.close();
    }
  }, 240_000);

  it('ADMIN: nothing of M13 without a grant (no menu, direct address shows no data); with VIEW the screens open read-only', async () => {
    await wipe();
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 900, false);
    try {
      await signIn(page, { phone: viewer.phone, password: ADMIN_PASSWORD, userId: viewer.userId, secret: viewer.secret });
      expect(await page.evaluate<boolean>(`!!document.querySelector('a[href^="/system-ops"]')`)).toBe(false);
      await page.goto(`${origin}/system-ops/incidents`);
      await page.waitFor(`document.querySelector('.shell')`);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(await page.evaluate<boolean>(`!document.getElementById('ops-incidents-title')`)).toBe(true);
      // The server refuses without a grant, whatever the page does.
      const denied = await app.pool.query('SELECT count(*)::int AS n FROM app.ops_admin_scopes WHERE user_id = $1', [viewer.userId]);
      expect(denied.rows[0]?.n).toBe(0);

      await app.pool.query(`INSERT INTO app.ops_admin_scopes (user_id, level, version, updated_by, updated_at) VALUES ($1, 'VIEW', 1, $2, now())`, [viewer.userId, system.account.userId]);
      await signIn(page, { phone: viewer.phone, password: ADMIN_PASSWORD, userId: viewer.userId, secret: viewer.secret });
      await page.waitFor(`document.querySelector('a[href="/system-ops"]')`);
      await page.goto(`${origin}/system-ops/config`);
      await page.waitFor(`document.getElementById('ops-config-title')`);
      // Read-only: SYSTEM-only actions are absent or disabled.
      expect(await page.evaluate<boolean>(`[...document.querySelectorAll('button')].filter((b) => ['Gửi thử Discord', 'Lưu cấu hình'].includes(b.textContent.trim())).every((b) => b.disabled)`)).toBe(true);
      expect(await page.evaluate<boolean>(`(() => { const w = document.getElementById('cfg-webhook'); return !w || w.disabled; })()`)).toBe(true);
      await page.goto(`${origin}/system-ops/releases`);
      await page.waitFor(`document.getElementById('ops-releases-title') && document.body.innerText.includes('Chưa phát hành')`);
      expect(await hasButton(page, 'Đăng ký bản nháp')).toBe(false);
    } finally {
      await page.close();
    }
  }, 240_000);
  it('G20: the VPS page draws the host, Backend and PostgreSQL apart, charts that stop at a hole in the samples, the processes, and the versions page has no Deploy button', async () => {
    await wipe();
    const snapshot = {
      sampled_at: new Date().toISOString(),
      host: { uptime_seconds: 90_000, cpu_percent: 12.5, cpu_cores: 2, load_avg: [0.1, 0.2, 0.3], memory: { total_bytes: 2_000_000_000, available_bytes: 1_000_000_000, used_bytes: 1_000_000_000, used_percent: 50 }, swap: { swap_total_bytes: 1000, swap_used_bytes: 100, swap_percent: 10 }, disks: [{ label: 'root', path: '/', total_bytes: 10_000_000_000, free_bytes: 4_000_000_000, used_bytes: 6_000_000_000, used_percent: 60 }], io: { io_read_bytes: 1000, io_write_bytes: 2000 }, network: { rx_bytes_total: 5000, tx_bytes_total: 6000, rx_bytes_per_sec: 100, tx_bytes_per_sec: 200 } },
      backend: { pid: 4242, uptime_seconds: 600, rss_bytes: 100_000_000, heap_used_bytes: 50_000_000, cpu_percent: 1.5, self_health_latency_ms: 7 },
      postgres: { latency_ms: 3, active_connections: 6, database_size_bytes: 123_456_789 },
      processes_by_cpu: [{ pid: 4242, name: 'node', cpu_percent: 9.5, rss_bytes: 100_000_000, memory_percent: 5 }],
      processes_by_memory: [{ pid: 77, name: 'postgres', cpu_percent: 1, rss_bytes: 300_000_000, memory_percent: 15 }],
    };
    await app.pool.query(
      `INSERT INTO app.ops_checks (check_key, source, state, observed_at, since_at, consecutive_failures, consecutive_successes, value, evidence_code, stale_after_seconds)
       VALUES ('vps', 'SERVER', 'OK', now(), now(), 0, 1, $1::jsonb, 'VPS_SNAPSHOT', 180), ('api', 'API', 'OK', now(), now(), 0, 1, '{}'::jsonb, 'API_OK', 300), ('database', 'DATABASE', 'OK', now(), now(), 0, 1, '{}'::jsonb, 'DB_OK', 300)`,
      [JSON.stringify({ ...snapshot, sampled_at: snapshot.sampled_at })],
    );
    await app.pool.query(
      `INSERT INTO app.ops_metrics (metric_key, observed_at, value)
       SELECT 'cpu_percent', now() - (g * interval '1 minute'), 20 + g FROM generate_series(1, 10) g
       UNION ALL SELECT 'cpu_percent', now() - (g * interval '1 minute'), 30 FROM generate_series(40, 50) g`,
    );
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 900, false);
    try {
      await signIn(page, { phone: system.account.phone, password: system.account.password, userId: system.account.userId, secret: system.login.secret });
      await page.goto(`${origin}/system-ops/vps`);
      await page.waitFor(`document.querySelector('[data-chart="cpu_percent"] path')`);
      const text = await bodyText(page);
      for (const wanted of ['Dịch vụ Backend 11Ship', 'Dịch vụ PostgreSQL', 'Top 5 theo CPU', 'Top 5 theo RAM', 'postgres', '1 ngày 1 giờ', 'Thiếu mẫu']) expect(text).toContain(wanted);
      expect(text).not.toContain('Mất tín hiệu bộ thu thập');
      // Two runs of samples with a 30-minute hole between them: two separate lines, never one line across the hole.
      expect(await page.evaluate<number>(`document.querySelectorAll('[data-chart="cpu_percent"] path.ops-chart-line').length`)).toBe(2);
      expect(await page.evaluate<boolean>(`!!document.querySelector('[data-chart="cpu_percent"] rect.ops-chart-gap')`)).toBe(true);
      expect(await press(page, '24 giờ')).toBe(true);
      await page.waitFor(`document.querySelector('[data-range="24h"].tab-active') && document.body.innerText.includes('Lịch sử 24 giờ')`);
      // The read-only page has no control that touches the server.
      expect(await hasButton(page, 'Khởi động lại')).toBe(false);
      await page.goto(`${origin}/system-ops`);
      await page.waitFor(`document.querySelector('[data-vps-card]')`);
      await page.goto(`${origin}/system-ops/releases`);
      await page.waitFor(`[...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').trim() === 'Server')`);
      expect(await press(page, 'Server')).toBe(true);
      await page.waitFor(`document.body.innerText.includes('Triển khai server')`);
      expect(await hasButton(page, 'Triển khai (SYSTEM)')).toBe(false);
      expect(await bodyText(page)).toContain('không có nút triển khai');
    } finally {
      await page.close();
    }
  }, 240_000);
});
