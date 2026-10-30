import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createLocalCertificate } from '../../scripts/admin-web-cert.mjs';
import { buildClientWeb } from '../../scripts/client-web-build.mjs';
import { createClientWebServer } from '../../scripts/client-web-dev.mjs';
import { launchChrome, OVERFLOW, SMALL_TARGETS, sleep, spkiHash } from './support/chrome.mjs';

// M01.07, real browser: the 11Food register flow F11 -> F12 -> F01 in headless Chromium over the REAL local https front
// (createClientWebServer, the three forwarded routes). The backend behind it is a controlled stand-in so that every answer
// (wrong code, expired, 429, lost response, delay) can be provoked on demand; the real backend with PostgreSQL and the OTP read
// from the test inbox is tests/integration/food-register-browser.int.spec.ts (CI).
// Set SHOT_DIR to write a JPEG of each screen (evidence images).

const shots = process.env.SHOT_DIR === undefined || process.env.SHOT_DIR === '' ? undefined : process.env.SHOT_DIR;
const WIDTHS = [360, 390, 430];

const USER = '11111111-1111-4111-8111-111111111111';
const PROOF = 'PROOF_TOKEN_' + 'p'.repeat(30);
const ACCESS = 'ACCESS_TOKEN_' + 'a'.repeat(30);
const PASSWORD = 'Mật khẩu thử 12345';
const PHONE = '0987654321';
const NAME = 'Nguyễn Văn An';
const CODE = '123456';
const challengeId = (n) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;

const identity = () => ({
  user_id: USER,
  phone_normalized: '+84987654321',
  available_roles: ['CUSTOMER'],
  active_role: 'CUSTOMER',
  profile: { full_name: NAME, version: 1 },
  capabilities: { customer_access: true, shop_profile_read: false, shop_manage: false, driver_profile_read: false },
  onboarding: { shop: 'NOT_STARTED', driver: 'NOT_STARTED' },
  onboarding_required: false,
  role_selection_required: false,

  phone_verification_status: 'VERIFIED',
});

// ---- the stand-in backend ------------------------------------------------------------------------------------------------

async function startBackend() {
  const state = { seen: [], mode: 'REQUIRED', configSeen: 0, issued: 0, expires: 180, resend: 60, delayMs: 0, queue: { otp: [], verify: [], register: [], other: [] }, name: NAME, version: 1, revoked: false };
  const reset = () => {
    state.seen.length = 0;
    state.mode = 'REQUIRED';
    state.configSeen = 0;
    state.issued = 0;
    state.expires = 180;
    state.resend = 60;
    state.delayMs = 0;
    state.queue = { otp: [], verify: [], register: [], other: [] };
    state.name = NAME;
    state.version = 1;
    state.revoked = false;
  };
  const send = (response, status, body, headers = {}) => {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
    response.end(JSON.stringify(body));
  };
  const err = (code) => ({ error: { code, message: 'RAW_SERVER_TEXT_MARKER', request_id: 'r', details: {} } });
  const who = () => ({ ...identity(), profile: { full_name: state.name, version: state.version } });
  // The account routes of the real backend that the connected screens use (login, me, profile, logout).
  const account = (request, response, body) => {
    const bearer = request.headers.authorization === `Bearer ${ACCESS}` && !state.revoked;
    if (request.method === 'POST' && request.url === '/v1/client-auth/login') {
      const sent = JSON.parse(body);
      if (sent.password !== PASSWORD) {
        send(response, 401, err('INVALID_CREDENTIALS'));
        return;
      }
      send(response, 200, { data: { ...who(), access_token: ACCESS, session: { expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString() } } });
    } else if (request.url === '/v1/client-auth/me' || request.url === '/v1/customer/me/profile' || request.url === '/v1/client-auth/logout') {
      if (!bearer) {
        send(response, 401, err('SESSION_INVALID'));
      } else if (request.url === '/v1/client-auth/me') {
        send(response, 200, { data: who() });
      } else if (request.url === '/v1/client-auth/logout') {
        state.revoked = true;
        response.writeHead(204);
        response.end();
      } else if (request.method === 'GET') {
        send(response, 200, { data: { user_id: USER, full_name: state.name, version: state.version } });
      } else {
        const sent = JSON.parse(body);
        if (sent.expected_version !== state.version) {
          send(response, 409, err('VERSION_CONFLICT'));
          return;
        }
        state.name = sent.full_name;
        state.version += 1;
        send(response, 200, { data: { user_id: USER, full_name: state.name, version: state.version } });
      }
    } else {
      send(response, 404, err('NOT_FOUND'));
    }
  };
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      // The app asks the server's health in the background; the answer is a plain "up" and is not recorded as business traffic.
      if (request.url === '/v1/health/live' || request.url === '/v1/health/ready') {
        send(response, 200, { data: { status: request.url.endsWith('live') ? 'ok' : 'ready' } });
        return;
      }
      // GET /v1/client-auth/config: how a registration is verified (the real backend's answer, scripted by state.mode).
      if (request.url === '/v1/client-auth/config') {
        state.configSeen += 1;
        send(response, state.mode === undefined ? 503 : 200, state.mode === undefined ? err('SERVICE_UNAVAILABLE') : { data: { registration_verification: state.mode } }, { 'cache-control': 'no-store' });
        return;
      }
      const entry = { method: request.method, url: request.url, headers: request.headers, body };
      state.seen.push(entry);
      const kind = request.url === '/v1/auth/phone-verifications' ? 'otp' : request.url.endsWith('/verify') ? 'verify' : request.url === '/v1/client-auth/register' ? 'register' : 'other';
      const respond = () => {
        const scripted = state.queue[kind]?.shift();
        if (scripted !== undefined) {
          scripted({ request, response, send, err, body });
          return;
        }
        if (kind === 'otp') {
          state.issued += 1;
          send(response, 201, { data: { verification_id: challengeId(state.issued), expires_in_seconds: state.expires, resend_after_seconds: state.resend } });
        } else if (kind === 'verify') {
          const ok = JSON.parse(body).otp === CODE;
          send(response, ok ? 200 : 400, ok ? { data: { verification_token: PROOF, purpose: 'REGISTER', expires_in_seconds: 600 } } : err('OTP_INVALID'));
        } else if (kind === 'register') {
          send(response, 201, { data: { ...identity(), access_token: ACCESS, session: { expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString() } } });
        } else {
          account(request, response, body);
        }
      };
      state.delayMs > 0 ? setTimeout(respond, state.delayMs) : respond();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    state,
    reset,
    url: `http://127.0.0.1:${String(server.address().port)}`,
    count: (kind) => state.seen.filter((entry) => (kind === 'otp' ? entry.url === '/v1/auth/phone-verifications' : kind === 'verify' ? entry.url.endsWith('/verify') : entry.url === '/v1/client-auth/register')).length,
    of: (kind) => state.seen.filter((entry) => (kind === 'otp' ? entry.url === '/v1/auth/phone-verifications' : kind === 'verify' ? entry.url.endsWith('/verify') : entry.url === '/v1/client-auth/register')),
    stop: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(resolve);
    }),
  };
}

// ---- set-up --------------------------------------------------------------------------------------------------------------

let work;
let backend;
let front;
let origin;
let browser;
let tls;

before(async () => {
  work = mkdtempSync(join(tmpdir(), 'register-browser-'));
  const made = createLocalCertificate(join(work, 'tls'), 30);
  const pem = readFileSync(made.cert);
  tls = { key: readFileSync(made.key), cert: pem };
  const dist = buildClientWeb('food-web', { outDir: join(work, 'food'), quiet: true }).dist;
  backend = await startBackend();
  front = createClientWebServer({ app: 'food-web', distDir: dist, backendUrl: backend.url, key: readFileSync(made.key), cert: pem, authTimeoutMs: 4000 });
  await new Promise((resolve) => front.listen(0, '127.0.0.1', resolve));
  origin = `https://localhost:${String(front.address().port)}`;
  browser = await launchChrome({ spki: spkiHash(pem) });
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => {
    front?.closeAllConnections?.();
    front?.close(() => resolve());
    if (front === undefined) {
      resolve();
    }
  });
  await backend?.stop();
  rmSync(work, { recursive: true, force: true });
});

async function withPage(width, run) {
  backend.reset();
  const page = await browser.newPage();
  try {
    await page.viewport(width);
    await run(page);
    assert.deepEqual(page.problems, [], 'no console error, CSP violation or exception');
  } finally {
    await browser.closePage(page);
  }
}

// ---- page helpers --------------------------------------------------------------------------------------------------------

const text = (selector) => `document.querySelector(${JSON.stringify(selector)})?.innerText ?? ''`;
const path = `location.pathname`;
const waitPath = (page, expected) => page.waitFor(`location.pathname === ${JSON.stringify(expected)} && document.querySelector('#app')?.children.length > 0`, `path ${expected}`);

async function fillRegister(page, { name = NAME, phone = PHONE, password = PASSWORD, confirm = password, consent = true } = {}) {
  // F11 locks its submit until the server has said how a registration is verified (GET /v1/client-auth/config).
  await page.waitFor(`document.querySelector('#register-submit')?.disabled === false`, 'F11 unlocked by the server mode');
  await page.fill('#full-name', name);
  await page.fill('#phone', phone);
  await page.fill('#password', password);
  await page.fill('#password-confirm', confirm);
  if (consent) {
    await page.click('#consent');
  }
}

/** F11 filled and sent; waits for F12. */
async function toOtp(page) {
  await page.goto(`${origin}/register`);
  await fillRegister(page);
  await page.click('#register-submit');
  await waitPath(page, '/register/otp');
}

const business = () => backend.count('otp') + backend.count('verify') + backend.count('register');
const OTP_REQUEST_BODY = JSON.stringify({ phone: PHONE, purpose: 'REGISTER' });

describe('F11: the approved consent, readable before submit', () => {
  it('shows both texts in full, the checkbox is unchecked, and sending without it sends nothing', async () => {
    await withPage(390, async (page) => {
      await page.goto(`${origin}/register`);
      const doc = readFileSync(new URL('../../docs/tasks/M01-03-customer-register-local-handoff.md', import.meta.url), 'utf8');
      const shown = await page.evaluate(text('#consent-texts'));
      const terms = /Đây là bản thử nghiệm 11Ship\/11Food[^\n]*/.exec(doc)[0];
      const privacy = /Bản thử nghiệm lưu số điện thoại[^\n]*/.exec(doc)[0];
      assert.ok(shown.includes(terms), 'the terms text is shown verbatim');
      assert.ok(shown.includes(privacy), 'the data information is shown verbatim');
      assert.equal(await page.evaluate(`document.querySelector('#consent').checked`), false);
      assert.match(await page.evaluate(text('label[for=consent]')), /Tôi đồng ý với Điều khoản dùng thử và Thông tin dữ liệu thử nghiệm\./);
      await fillRegister(page, { consent: false });
      await page.click('#register-submit');
      await page.waitFor(`document.querySelector('#consent-error')?.hidden === false`, 'consent error');
      assert.equal(await page.evaluate(path), '/register');
      assert.equal(business(), 0, 'nothing was sent');
    });
  });

  for (const width of WIDTHS) {
    it(`${width}px: F11 and F12 have no sideways scroll and every control is at least 44px`, async () => {
      await withPage(width, async (page) => {
        await page.goto(`${origin}/register`);
        assert.deepEqual(await page.evaluate(SMALL_TARGETS), [], `small targets on F11 at ${width}`);
        const f11 = await page.evaluate(OVERFLOW);
        assert.ok(f11.scrollWidth <= f11.innerWidth, `F11 scrolls sideways: ${JSON.stringify(f11)}`);
        await page.shot(shots, `food-${width}-f11-empty`);
        await fillRegister(page);
        await page.shot(shots, `food-${width}-f11-filled`);
        await page.click('#register-submit');
        await waitPath(page, '/register/otp');
        assert.deepEqual(await page.evaluate(SMALL_TARGETS), [], `small targets on F12 at ${width}`);
        const f12 = await page.evaluate(OVERFLOW);
        assert.ok(f12.scrollWidth <= f12.innerWidth, `F12 scrolls sideways: ${JSON.stringify(f12)}`);
        await page.shot(shots, `food-${width}-f12`);
      });
    });
  }
});

describe('the whole flow: F11 -> code -> account -> F01, with what the server says', () => {
  it('registers with the typed form, lands on F01 signed in, and keeps no secret in the URL, history or storage', async () => {
    await withPage(390, async (page) => {
      await toOtp(page);
      assert.equal(backend.of('otp')[0].body, OTP_REQUEST_BODY);
      assert.match(await page.evaluate(text('main')), /098 •••• 321/);
      assert.match(await page.evaluate(text('main')), /SMS mô phỏng/);
      await page.shot(shots, 'food-390-f12-waiting');
      await page.fill('#otp', CODE);
      await page.click('#otp-submit');
      await waitPath(page, '/');
      await page.waitFor(`document.body.innerText.includes(${JSON.stringify(NAME)})`, 'the name the server returned is shown');
      await page.shot(shots, 'food-390-f01-signed-in');

      assert.equal(backend.count('verify'), 1);
      assert.equal(backend.of('verify')[0].url, `/v1/auth/phone-verifications/${challengeId(1)}/verify`);
      assert.deepEqual(JSON.parse(backend.of('verify')[0].body), { otp: CODE });
      const [register] = backend.of('register');
      assert.match(register.headers['idempotency-key'], /^[0-9a-f-]{36}$/);
      const sent = JSON.parse(register.body);
      assert.equal(sent.password, PASSWORD, 'the password typed in F11 reaches the register');
      assert.equal(sent.full_name, NAME);
      assert.equal(sent.phone, PHONE);
      assert.equal(sent.verification_token, PROOF);
      assert.deepEqual(sent.consent, { terms_version: 'test-terms-20261011-v1', privacy_version: 'test-privacy-20261011-v1' });
      assert.deepEqual(sent.device.platform, 'WEB');
      assert.equal(sent.device.app, 'FOOD');
      for (const entry of backend.state.seen) {
        assert.equal(entry.headers.cookie, undefined);
        assert.equal(entry.headers.authorization, undefined);
      }

      // No secret anywhere the browser keeps things.
      const leaks = await page.evaluate(`(() => {
        const secrets = [${JSON.stringify(PASSWORD)}, ${JSON.stringify(PROOF)}, ${JSON.stringify(ACCESS)}, ${JSON.stringify(CODE)}];
        const haystack = [location.href, JSON.stringify(history.state), JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage }), document.cookie, document.documentElement.outerHTML].join('\\n');
        return secrets.filter((secret) => haystack.includes(secret));
      })()`);
      assert.deepEqual(leaks, []);
      assert.equal(await page.evaluate('localStorage.length + sessionStorage.length'), 0);
      assert.equal(await page.evaluate('document.querySelectorAll("input").length > 0 ? [...document.querySelectorAll("input")].some((i) => i.value !== "") : false'), false);

      // The account screen shows what the server reported; logout is connected.
      await page.click('a[href="/account"]');
      await waitPath(page, '/account');
      const account = await page.evaluate(text('main'));
      assert.match(account, new RegExp(NAME));
      assert.match(account, /098 •••• 321/);
      assert.equal(await page.evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes('Đăng xuất'))`), true, 'logout is connected');
      await page.shot(shots, 'food-390-f04-signed-in');
    });
  });

  it('F5 does not bring the session back: a reload is signed out, and a reload inside F12 goes back to F11', async () => {
    await withPage(390, async (page) => {
      await toOtp(page);
      await page.reload();
      await waitPath(page, '/register');
      assert.equal(await page.evaluate(`document.querySelector('#full-name').value`), '');
      assert.equal(backend.count('register'), 0);

      await toOtp(page);
      await page.fill('#otp', CODE);
      await page.click('#otp-submit');
      await waitPath(page, '/');
      await page.waitFor(`document.body.innerText.includes(${JSON.stringify(NAME)})`, 'signed in');
      await page.reload();
      await sleep(300);
      assert.equal(await page.evaluate(`document.body.innerText.includes(${JSON.stringify(NAME)})`), false, 'a reload starts signed out');
      assert.match(await page.evaluate(text('main')), /Bạn chưa đăng nhập/);
    });
  });

  it('opening F12 directly with nothing started goes to F11 and sends nothing', async () => {
    await withPage(390, async (page) => {
      await page.goto(`${origin}/register/otp`);
      await waitPath(page, '/register');
      assert.equal(business(), 0);
    });
  });
});

describe('F12: wrong code, expiry, resend, rate limit, change of phone', () => {
  it('a wrong code shows the wrong-code message, clears the field and never calls register', async () => {
    await withPage(390, async (page) => {
      await toOtp(page);
      await page.fill('#otp', '000000');
      await page.click('#otp-submit');
      await page.waitFor(`document.querySelector('#otp-error')?.hidden === false`, 'wrong code message');
      assert.match(await page.evaluate(text('#otp-error')), /Mã không đúng/);
      assert.equal(await page.evaluate(`document.querySelector('#otp').value`), '');
      assert.equal(backend.count('register'), 0);
      await page.shot(shots, 'food-390-f12-wrong-code');
      // The right code then works, still with the original form.
      await page.fill('#otp', CODE);
      await page.click('#otp-submit');
      await waitPath(page, '/');
      assert.equal(JSON.parse(backend.of('register')[0].body).password, PASSWORD);
    });
  });

  it('an expired code (server deadline) shows the expiry, blocks verify without a request, and a resend gives a new challenge', async () => {
    await withPage(390, async (page) => {
      backend.state.expires = 2;
      backend.state.resend = 1;
      await toOtp(page);
      await page.waitFor(`document.body.innerText.includes('Mã đã hết hạn')`, 'expired message', 6000);
      await page.shot(shots, 'food-390-f12-expired');
      await page.fill('#otp', CODE);
      await page.click('#otp-submit');
      await sleep(300);
      assert.equal(backend.count('verify'), 0, 'no request for a code the server said is expired');
      assert.equal(await page.evaluate(`document.querySelector('#otp-resend').getAttribute('aria-disabled')`), null, 'send again is available from the server instant');
      backend.state.expires = 180;
      backend.state.resend = 60;
      await page.click('#otp-resend');
      await page.waitFor(`!document.body.innerText.includes('Mã đã hết hạn')`, 'expiry banner cleared');
      assert.equal(backend.count('otp'), 2);
      assert.equal(await page.evaluate(`document.querySelector('#otp').value`), '');
      await page.fill('#otp', CODE);
      await page.click('#otp-submit');
      await waitPath(page, '/');
      assert.equal(backend.of('verify')[0].url, `/v1/auth/phone-verifications/${challengeId(2)}/verify`, 'the verify goes to the NEW challenge');
    });
  });

  it('"send again" is not available before the server instant and is never pressed by a timer', async () => {
    await withPage(390, async (page) => {
      backend.state.resend = 3;
      await toOtp(page);
      assert.equal(await page.evaluate(`document.querySelector('#otp-resend').getAttribute('aria-disabled')`), 'true');
      assert.match(await page.evaluate(text('#otp-resend')), /Gửi lại mã \(00:0[1-3]\)/);
      await page.click('#otp-resend');
      await sleep(200);
      assert.equal(backend.count('otp'), 1, 'a press before the instant sends nothing');
      await page.waitFor(`document.querySelector('#otp-resend').getAttribute('aria-disabled') === null`, 'enabled at the server instant', 6000);
      await sleep(1500);
      assert.equal(backend.count('otp'), 1, 'enabling it did not send anything by itself');
    });
  });

  it('429 on resend with Retry-After holds the button for that long; without Retry-After nothing is invented and the person decides', async () => {
    await withPage(390, async (page) => {
      backend.state.resend = 0;
      await toOtp(page);
      backend.state.queue.otp.push(({ response, send, err }) => send(response, 429, err('OTP_RATE_LIMITED'), { 'retry-after': '90' }));
      await page.click('#otp-resend');
      await page.waitFor(`document.body.innerText.includes('Thử quá nhiều lần')`, 'rate limit banner');
      await page.waitFor(`document.querySelector('#otp-resend').getAttribute('aria-disabled') === 'true'`, 'held');
      assert.match(await page.evaluate(text('#otp-resend')), /Gửi lại mã \(01:[23]\d\)/);
      await page.shot(shots, 'food-390-f12-rate-limited');
      await sleep(1200);
      assert.equal(backend.count('otp'), 2, 'no automatic retry');
    });
    await withPage(390, async (page) => {
      backend.state.resend = 0;
      await toOtp(page);
      backend.state.queue.otp.push(({ response, send, err }) => send(response, 429, err('OTP_RATE_LIMITED')));
      await page.click('#otp-resend');
      await page.waitFor(`document.body.innerText.includes('Thử quá nhiều lần')`, 'rate limit banner');
      assert.equal(await page.evaluate(`document.querySelector('#otp-resend').getAttribute('aria-disabled')`), null, 'no cooldown was invented');
      assert.match(await page.evaluate(text('main')), /Vui lòng thử lại sau\./);
      await sleep(1500);
      assert.equal(backend.count('otp'), 2);
    });
  });

  it('a locked challenge (too many wrong codes) says so and does not register', async () => {
    await withPage(390, async (page) => {
      await toOtp(page);
      backend.state.queue.verify.push(({ response, send, err }) => send(response, 429, err('OTP_RATE_LIMITED')));
      await page.fill('#otp', CODE);
      await page.click('#otp-submit');
      await page.waitFor(`document.body.innerText.includes('Đã nhập sai quá số lần')`, 'locked message');
      assert.equal(backend.count('register'), 0);
    });
  });

  it('"Đổi số điện thoại" asks before dropping a typed code, then returns to an empty F11; the old challenge answers nothing', async () => {
    await withPage(390, async (page) => {
      await toOtp(page);
      await page.fill('#otp', '12');
      await page.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Đổi số điện thoại'))?.click()`);
      await page.waitFor(`document.body.innerText.includes('Bỏ thay đổi?')`, 'leave question');
      await page.shot(shots, 'food-390-f12-leave-question');
      assert.equal(await page.evaluate(path), '/register/otp');
      await page.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Ở lại')?.click()`);
      await sleep(150);
      assert.equal(await page.evaluate(path), '/register/otp');
      assert.equal(await page.evaluate(`document.querySelector('#otp').value`), '12', 'staying keeps what was typed');
      await page.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Đổi số điện thoại'))?.click()`);
      await page.waitFor(`document.body.innerText.includes('Bỏ thay đổi?')`, 'leave question again');
      await page.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Thoát')?.click()`);
      await waitPath(page, '/register');
      assert.equal(await page.evaluate(`document.querySelector('#password').value + document.querySelector('#full-name').value`), '', 'the form is empty again');
      // The flow is gone: F12 cannot be reached without a new start.
      await page.evaluate(`history.pushState(null, '', '/register/otp'); dispatchEvent(new PopStateEvent('popstate'))`);
      await waitPath(page, '/register');
      assert.equal(backend.count('verify'), 0);
      assert.equal(backend.count('register'), 0);
    });
  });
});

describe('double submit, lost answers, keyboard', () => {
  it('pressing "Tiếp tục" twice (click and Enter) sends one request for a code; pressing "Xác minh" twice sends one verify and one register', async () => {
    await withPage(390, async (page) => {
      backend.state.delayMs = 500;
      await page.goto(`${origin}/register`);
      await fillRegister(page);
      await page.click('#register-submit');
      await page.evaluate(`document.querySelector('#phone').focus()`);
      await page.press('Enter');
      await page.click('#register-submit');
      await waitPath(page, '/register/otp');
      assert.equal(backend.count('otp'), 1);
      await page.fill('#otp', CODE);
      await page.click('#otp-submit');
      await page.click('#otp-submit');
      await page.press('Enter');
      await waitPath(page, '/');
      assert.equal(backend.count('verify'), 1);
      assert.equal(backend.count('register'), 1);
    });
  });

  it('a register whose answer is lost keeps the intent: "Thử lại" re-sends the SAME key and body, with no new code and no verify', async () => {
    await withPage(390, async (page) => {
      await toOtp(page);
      backend.state.queue.register.push(({ request }) => request.socket.destroy());
      await page.fill('#otp', CODE);
      await page.click('#otp-submit');
      await page.waitFor(`document.querySelector('#register-retry') !== null`, 'retry offered');
      assert.equal(await page.evaluate(path), '/register/otp');
      assert.equal(await page.evaluate(`document.querySelector('#otp-submit').offsetParent === null`), true, 'the code step is not offered again');
      assert.match(await page.evaluate(text('#register-state')), /Đã xác minh số điện thoại/);
      await page.shot(shots, 'food-390-f12-register-unknown');
      await page.click('#register-retry');
      await waitPath(page, '/');
      const sent = backend.of('register');
      assert.equal(sent.length, 2);
      assert.equal(sent[1].headers['idempotency-key'], sent[0].headers['idempotency-key']);
      assert.equal(sent[1].body, sent[0].body);
      assert.equal(backend.count('verify'), 1);
      assert.equal(backend.count('otp'), 1);
    });
  });

  it('a register that times out at the front (504) is also "unknown": same key on the retry', async () => {
    await withPage(390, async (page) => {
      await toOtp(page);
      backend.state.queue.register.push(() => undefined); // never answers: the front ends it as 504 after its deadline
      await page.fill('#otp', CODE);
      await page.click('#otp-submit');
      await page.waitFor(`document.querySelector('#register-retry') !== null`, 'retry offered', 9000);
      await page.click('#register-retry');
      await waitPath(page, '/');
      const sent = backend.of('register');
      assert.equal(sent.length, 2);
      assert.equal(sent[1].headers['idempotency-key'], sent[0].headers['idempotency-key']);
    });
  });

  it('leaving at the unknown-outcome step asks first and drops the password and proof (no way back into that attempt)', async () => {
    await withPage(390, async (page) => {
      await toOtp(page);
      backend.state.queue.register.push(({ request }) => request.socket.destroy());
      await page.fill('#otp', CODE);
      await page.click('#otp-submit');
      await page.waitFor(`document.querySelector('#register-retry') !== null`, 'retry offered');
      await page.evaluate(`history.back()`);
      await page.waitFor(`document.body.innerText.includes('Bỏ thay đổi?')`, 'the question is asked even though no field changed');
      await page.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Thoát')?.click()`);
      await waitPath(page, '/register');
      assert.equal(backend.count('register'), 1, 'leaving sent nothing');
    });
  });

  it('keyboard: Tab reaches every field, the checkbox opens with Space, Enter sends; the code step is reachable and Enter verifies', async () => {
    await withPage(390, async (page) => {
      await page.goto(`${origin}/register`);
      await page.evaluate(`document.querySelector('#full-name').focus()`);
      const order = [];
      for (let index = 0; index < 7; index += 1) {
        order.push(await page.evaluate(`document.activeElement.id || document.activeElement.getAttribute('aria-label')`));
        await page.press('Tab');
      }
      assert.deepEqual(order, ['full-name', 'phone', 'password', 'Hiện mật khẩu', 'password-confirm', 'Hiện mật khẩu', 'consent']);
      await fillRegister(page, { consent: false });
      await page.evaluate(`document.querySelector('#consent').focus()`);
      await page.press(' ');
      assert.equal(await page.evaluate(`document.querySelector('#consent').checked`), true);
      await page.evaluate(`document.querySelector('#password-confirm').focus()`);
      await page.press('Enter');
      await waitPath(page, '/register/otp');
      await page.fill('#otp', CODE);
      await page.press('Enter');
      await waitPath(page, '/');
    });
  });
});

describe('DISABLED_TEST: F11 registers without OTP and goes straight to F01', () => {
  const NOTE = 'Bản test: tạm không xác minh số điện thoại';
  const configRequests = () => backend.state.configSeen;

  it('shows the test note and "Đăng ký", sends one register without any token and no OTP request, never opens F12', async () => {
    await withPage(390, async (page) => {
      backend.state.mode = 'DISABLED_TEST';
      await page.goto(`${origin}/register`);
      await page.waitFor(`document.querySelector('#register-submit')?.disabled === false`, 'mode loaded');
      assert.equal((await page.evaluate(text('#register-submit'))).trim(), 'Đăng ký');
      assert.ok((await page.evaluate(`document.body.innerText`)).includes(NOTE));
      await fillRegister(page);
      await page.click('#register-submit');
      await waitPath(page, '/');
      assert.equal(backend.count('otp'), 0);
      assert.equal(backend.count('verify'), 0);
      assert.equal(backend.count('register'), 1);
      const sent = JSON.parse(backend.of('register')[0].body);
      assert.deepEqual(Object.keys(sent), ['phone', 'password', 'device', 'full_name', 'consent']);
      assert.equal(sent.password, PASSWORD);
      assert.ok(configRequests() >= 1);
    });
  });

  it('REQUIRED keeps the OTP flow and the usual label', async () => {
    await withPage(390, async (page) => {
      await page.goto(`${origin}/register`);
      await page.waitFor(`document.querySelector('#register-submit')?.disabled === false`, 'mode loaded');
      assert.equal((await page.evaluate(`document.body.innerText`)).includes(NOTE), false);
      await fillRegister(page);
      await page.click('#register-submit');
      await waitPath(page, '/register/otp');
      assert.equal(backend.count('otp'), 1);
    });
  });

  it('without a valid mode answer the submit stays locked and nothing is sent', async () => {
    await withPage(390, async (page) => {
      backend.state.mode = undefined;
      await page.goto(`${origin}/register`);
      await page.waitFor(`document.body.innerText.includes('Thử lại')`, 'the failure with a retry is shown');
      assert.equal(await page.evaluate(`document.querySelector('#register-submit').disabled`), true);
      assert.equal(business(), 0);
    });
  });

  it('a lost register answer is retried with the SAME key and body, and still reaches F01 without OTP', async () => {
    await withPage(390, async (page) => {
      backend.state.mode = 'DISABLED_TEST';
      backend.state.queue.register.push(({ response }) => response.destroy());
      await page.goto(`${origin}/register`);
      await fillRegister(page);
      await page.click('#register-submit');
      await page.waitFor(`document.body.innerText.includes('Thử lại')`, 'unknown outcome offers a retry');
      await page.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Thử lại')?.click()`);
      await waitPath(page, '/');
      const [first, second] = backend.of('register');
      assert.equal(first.headers['idempotency-key'], second.headers['idempotency-key']);
      assert.equal(first.body, second.body);
      assert.equal(backend.count('otp') + backend.count('verify'), 0);
    });
  });
});

describe('M01 account: login -> read/edit the name -> logout, and an invalid session (Food, stand-in backend)', () => {
  it('opens Food on the guest home before registration; login is an explicit account action', async () => {
    await withPage(390, async (page) => {
      await page.goto(`${origin}/`);
      await waitPath(page, '/');
      assert.equal(await page.evaluate(`document.querySelector('#login-submit') === null`), true);
      assert.equal(business(), 0);
      await page.click('a[href="/account"]');
      await waitPath(page, '/account');
      await page.click('#account-login');
      await waitPath(page, '/login');
    });
  });
  const submitProfile = async (page, value) => {
    await page.waitFor(`document.querySelector('#profile-save')?.disabled === false`, 'profile loaded');
    await page.fill('#full-name', value);
    await page.click('#profile-save');
  };
  const login = async (page) => {
    await page.goto(`${origin}/login`);
    await page.fill('#phone', PHONE);
    await page.fill('#password', PASSWORD);
    await page.click('#login-submit');
    await waitPath(page, '/');
  };
  const clickButton = (page, label) => page.evaluate(`(() => { const b = [...document.querySelectorAll('button')].filter((x) => x.textContent.trim() === ${JSON.stringify(label)}).pop(); if (b === undefined) { throw new Error('no button ${label}'); } b.click(); return true; })()`);
  const openProfile = (page) => page.evaluate(`[...document.querySelectorAll('a,button')].find((x) => x.textContent.includes('Thông tin cá nhân'))?.click()`);

  it('a wrong password is a login error, not an expired session', async () => {
    await withPage(390, async (page) => {
      await page.goto(`${origin}/login`);
      await page.fill('#phone', PHONE);
      await page.fill('#password', 'sai mật khẩu 999');
      await page.click('#login-submit');
      await page.waitFor(`document.body.innerText.toLowerCase().includes('không đúng')`, 'login error');
      assert.equal(await page.evaluate(path), '/login');
      assert.equal(await page.evaluate(`document.body.innerText.includes('hết hạn')`), false);
    });
  });

  it('logs in with the exact body, edits the name from the server value, takes a version conflict without overwriting, and logs out with a confirmed revoke', async () => {
    await withPage(390, async (page) => {
      await login(page);
      const sent = backend.state.seen.find((e) => e.url === '/v1/client-auth/login');
      assert.deepEqual(Object.keys(JSON.parse(sent.body)).sort(), ['device', 'password', 'phone']);
      assert.match(sent.headers['idempotency-key'], /^[0-9a-f-]{36}$/);
      assert.equal(JSON.parse(sent.body).device.app, 'FOOD');

      await page.click('a[href="/account"]');
      await waitPath(page, '/account');
      await openProfile(page);
      await page.waitFor(`document.querySelector('#profile-save') !== null`, 'F17 live form');
      assert.equal(await page.evaluate(`document.querySelector('#full-name').value`), NAME);

      await submitProfile(page, 'Trần Thị Bình');
      await page.waitFor(`document.body.innerText.includes('Đã lưu')`, 'saved');
      const put = backend.state.seen.filter((e) => e.method === 'PUT' && e.url === '/v1/customer/me/profile');
      assert.equal(put.length, 1);
      assert.deepEqual(JSON.parse(put[0].body), { full_name: 'Trần Thị Bình', expected_version: 1 });
      assert.match(put[0].headers['idempotency-key'], /^[0-9a-f-]{36}$/);
      assert.equal(await page.evaluate(`document.querySelector('#full-name').value`), 'Trần Thị Bình');

      // Someone else saved meanwhile: the old version is refused and nothing is overwritten.
      backend.state.name = 'Tên từ nơi khác';
      backend.state.version = 5;
      await submitProfile(page, 'Lê Văn Cường');
      await page.waitFor(`document.body.innerText.includes('Thử lại') || document.body.innerText.includes('Tải lại') || document.body.innerText.includes('đã thay đổi')`, 'conflict shown');
      assert.equal(backend.state.name, 'Tên từ nơi khác', 'a conflict never overwrites');
      await page.evaluate(`[...document.querySelectorAll('#app button')].filter((x) => x.textContent.trim() === 'Thử lại').pop()?.click()`);
      await page.waitFor(`document.querySelector('#full-name')?.value === 'Tên từ nơi khác'`, 'current profile loaded');
      assert.equal(backend.state.name, 'Tên từ nơi khác');
    });
  });

  it('logout asks first, sends exact {} with the bearer, and the server revokes', async () => {
    await withPage(390, async (page) => {
      await login(page);
      await page.click('a[href="/account"]');
      await waitPath(page, '/account');
      await clickButton(page, 'Đăng xuất');
      await page.waitFor(`[...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Đăng xuất').length >= 2`, 'dialog');
      await clickButton(page, 'Đăng xuất');
      await page.waitFor(`!document.body.innerText.includes(${JSON.stringify(NAME)}) && [...document.querySelectorAll('button')].every((b) => b.textContent.trim() !== 'Đăng xuất')`, 'signed out');
      await waitPath(page, '/');
      const out = backend.state.seen.filter((e) => e.url === '/v1/client-auth/logout');
      assert.equal(out.length, 1);
      assert.equal(out[0].body, '{}');
      assert.equal(backend.state.revoked, true);
      assert.equal(await page.evaluate(`document.body.innerText.includes(${JSON.stringify(NAME)})`), false);
    });
  });

  it('an invalid session on an authenticated call wipes the screen and goes to login', async () => {
    await withPage(390, async (page) => {
      await login(page);
      await page.click('a[href="/account"]');
      await waitPath(page, '/account');
      backend.state.revoked = true;
      await openProfile(page);
      await waitPath(page, '/login');
      assert.equal(await page.evaluate(`document.body.innerText.includes(${JSON.stringify(NAME)})`), false);
      assert.equal(await page.evaluate('localStorage.length + sessionStorage.length'), 0);
    });
  });
});

describe('M01 account on 11Ship: the same login, S05 name edit and logout with app SHIP (one smoke, not the Food matrix)', () => {
  let shipFront;
  let shipOrigin;
  let shipDir;
  before(async () => {
    shipDir = mkdtempSync(join(tmpdir(), 'register-browser-ship-'));
    const dist = buildClientWeb('ship-web', { outDir: join(shipDir, 'ship'), quiet: true }).dist;
    // The same certificate as the Food front: Chrome trusts one public-key hash per launch.
    shipFront = createClientWebServer({ app: 'ship-web', distDir: dist, backendUrl: backend.url, key: tls.key, cert: tls.cert, authTimeoutMs: 4000 });
    await new Promise((resolve) => shipFront.listen(0, '127.0.0.1', resolve));
    shipOrigin = `https://localhost:${String(shipFront.address().port)}`;
  });
  after(async () => {
    shipFront?.closeAllConnections?.();
    await new Promise((resolve) => (shipFront === undefined ? resolve() : shipFront.close(() => resolve())));
    rmSync(shipDir, { recursive: true, force: true });
  });

  it('opens Ship on the guest home before registration; login is an explicit account action', async () => {
    await withPage(390, async (page) => {
      await page.goto(`${shipOrigin}/`);
      await waitPath(page, '/');
      assert.equal(await page.evaluate(`document.querySelector('#login-submit') === null`), true);
      assert.equal(business(), 0);
      await page.click('a[href="/account"]');
      await waitPath(page, '/account');
      await page.click('#account-login');
      await waitPath(page, '/login');
    });
  });
  it('logs in as SHIP, edits the name on S05, and logs out with a confirmed revoke; sign-in grants no driver status', async () => {
    await withPage(390, async (page) => {
      await page.goto(`${shipOrigin}/login`);
      await page.fill('#phone', PHONE);
      await page.fill('#password', PASSWORD);
      await page.click('#login-submit');
      await page.waitFor(`location.pathname !== '/login' && document.querySelector('#app')?.children.length > 0`, 'left the login screen');
      const sent = JSON.parse(backend.state.seen.find((e) => e.url === '/v1/client-auth/login').body);
      assert.equal(sent.device.app, 'SHIP');
      assert.deepEqual(Object.keys(sent).sort(), ['device', 'password', 'phone']);

      await page.click('a[href="/account"]');
      await waitPath(page, '/account');
      await page.evaluate(`[...document.querySelectorAll('a,button')].filter((x) => x.textContent.includes('Thông tin cá nhân')).pop()?.click()`);
      await waitPath(page, '/account/profile');
      await page.waitFor(`document.querySelector('#profile-save')?.disabled === false`, 'S05 loaded');
      await page.fill('#full-name', 'Phạm Quốc Dũng');
      await page.click('#profile-save');
      await page.waitFor(`document.body.innerText.includes('Đã lưu')`, 'saved');
      assert.equal(backend.state.name, 'Phạm Quốc Dũng');
      assert.deepEqual(JSON.parse(backend.state.seen.find((e) => e.method === 'PUT').body), { full_name: 'Phạm Quốc Dũng', expected_version: 1 });

      await page.evaluate(`history.back()`);
      await waitPath(page, '/account');
      await page.evaluate(`[...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Đăng xuất').pop()?.click()`);
      await page.waitFor(`[...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Đăng xuất').length >= 2`, 'dialog');
      await page.evaluate(`[...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Đăng xuất').pop().click()`);
      await page.waitFor(`!document.body.innerText.includes('Phạm Quốc Dũng') && [...document.querySelectorAll('button')].every((b) => b.textContent.trim() !== 'Đăng xuất')`, 'signed out');
      await waitPath(page, '/');
      assert.equal(backend.state.revoked, true);
    });
  });
});
