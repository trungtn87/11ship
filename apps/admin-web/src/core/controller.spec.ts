import { describe, expect, it } from '@jest/globals';
import { AdminAuthController, Screen } from './controller';
import { COPY } from './messages';
import {
  FakeClock,
  FakeServer,
  SECRET,
  deferred,
  enrollmentOk,
  fail,
  loginOk,
  meOk,
  noContent,
  noSession,
  preauthState,
  Scripted,
  sessionState,
  settle,
} from './test-support';

// Unit tests of the flow logic against a SCRIPTED server. They are not integration tests: the real backend and a real
// browser are exercised by tests/integration/admin-web-browser.int.spec.ts.

function setup(server: FakeServer) {
  const clock = new FakeClock();
  const controller = new AdminAuthController(server.api(), clock, () => 'web-device-1');
  const screens: Screen[] = [];
  controller.subscribe((screen) => screens.push(screen));
  return { controller, clock, screens };
}

/** Everything the screens ever exposed, as text: used to prove a secret or CSRF token is not kept around. */
function exposed(controller: AdminAuthController): string {
  return JSON.stringify(controller.screen);
}

async function toLogin(server: FakeServer) {
  server.on('GET', '/state', noSession());
  const context = setup(server);
  await context.controller.start();
  expect(context.controller.screen.name).toBe('login');
  return context;
}

async function toVerify(server: FakeServer) {
  const context = await toLogin(server);
  server.on('POST', '/login', loginOk('VERIFY_TOTP', 'csrf-pre-1'));
  await context.controller.submitLogin('0912345678', 'Correct-Horse-1');
  expect(context.controller.screen.name).toBe('verify');
  return context;
}

async function toEnroll(server: FakeServer) {
  const context = await toLogin(server);
  server.on('POST', '/login', loginOk('ENROLL_TOTP', 'csrf-pre-1')).on('POST', '/totp/enrollment', enrollmentOk());
  await context.controller.submitLogin('0912345678', 'Correct-Horse-1');
  await settle();
  const screen = context.controller.screen;
  expect(screen.name === 'enroll' && screen.secret).toBe(SECRET);
  return context;
}

describe('admin web flow - reload (GET /state)', () => {
  it('SESSION: stays neutral until GET /me answers, then shows the role from /me', async () => {
    const me = deferred<Scripted>();
    const server = new FakeServer().on('GET', '/state', sessionState()).on('GET', '/me', me.promise);
    const { controller, screens } = setup(server);
    const started = controller.start();
    await settle();
    expect(controller.screen.name).toBe('checking');
    expect(screens.some((screen) => screen.name === 'shell')).toBe(false);
    me.resolve(meOk('ADMIN'));
    await started;
    expect(controller.screen).toEqual({ name: 'shell', role: 'ADMIN', pending: false });
  });

  it('PREAUTH ENROLL_TOTP: enrollment step, the secret is reloaded through the protected endpoint with the state CSRF', async () => {
    const server = new FakeServer().on('GET', '/state', preauthState('ENROLL_TOTP', 'csrf-from-state')).on('POST', '/totp/enrollment', enrollmentOk());
    const { controller } = setup(server);
    await controller.start();
    await settle();
    expect(controller.screen).toMatchObject({ name: 'enroll', secret: SECRET, showKey: false, loadingSecret: false });
    expect(server.requests[1]).toEqual({ method: 'POST', path: '/totp/enrollment', body: {}, csrf: 'csrf-from-state' });
  });

  it('PREAUTH VERIFY_TOTP: verify step, nothing else is requested', async () => {
    const server = new FakeServer().on('GET', '/state', preauthState('VERIFY_TOTP'));
    const { controller } = setup(server);
    await controller.start();
    expect(controller.screen).toMatchObject({ name: 'verify', pending: false });
    expect(server.requests).toHaveLength(1);
  });

  it('401 without cookies: plain login; a dead step cookie: login with the "log in again" notice', async () => {
    const first = setup(new FakeServer().on('GET', '/state', noSession()));
    await first.controller.start();
    expect(first.controller.screen).toEqual({ name: 'login', phone: '', pending: false });
    const second = setup(new FakeServer().on('GET', '/state', fail(401, 'ADMIN_PREAUTH_INVALID')));
    await second.controller.start();
    expect(second.controller.screen).toEqual({ name: 'login', phone: '', pending: false, notice: COPY.preauthInvalid });
  });

  it('network or 503: the unavailable screen; "Thử lại" reads the state again (user-initiated only)', async () => {
    const server = new FakeServer().on('GET', '/state', 'network').on('GET', '/state', fail(503, 'SERVICE_UNAVAILABLE')).on('GET', '/state', noSession());
    const { controller, clock } = setup(server);
    await controller.start();
    expect(controller.screen).toEqual({ name: 'unavailable', pending: false });
    clock.advance(10 * 60_000);
    expect(server.count('GET', '/state')).toBe(1);
    await controller.retryStart();
    expect(controller.screen).toEqual({ name: 'unavailable', pending: false });
    await controller.retryStart();
    expect(controller.screen.name).toBe('login');
  });

  it('SESSION but /me refuses: back to login, never a shell', async () => {
    const server = new FakeServer().on('GET', '/state', sessionState()).on('GET', '/me', fail(401, 'ADMIN_SESSION_INVALID'));
    const { controller, screens } = setup(server);
    await controller.start();
    expect(controller.screen.name).toBe('login');
    expect(screens.some((screen) => screen.name === 'shell')).toBe(false);
  });
});

describe('admin web flow - password step', () => {
  it('an invalid phone is refused locally with the field message, no request', async () => {
    const server = new FakeServer();
    const { controller } = await toLogin(server);
    expect(await controller.submitLogin('091 234 5678', 'pw')).toBe('invalid-phone');
    expect(controller.screen).toMatchObject({ name: 'login', phoneError: COPY.invalidPhone });
    expect(server.count('POST', '/login')).toBe(0);
  });

  it('INVALID_PHONE / INVALID_CREDENTIALS from the server: the approved messages, the phone is kept', async () => {
    const server = new FakeServer();
    const { controller } = await toLogin(server);
    server.on('POST', '/login', fail(400, 'INVALID_PHONE'), fail(401, 'INVALID_CREDENTIALS'));
    await controller.submitLogin('0912345678', 'pw');
    expect(controller.screen).toMatchObject({ name: 'login', phone: '0912345678', phoneError: COPY.invalidPhone, pending: false });
    await controller.submitLogin('0912345678', 'pw');
    expect(controller.screen).toMatchObject({ name: 'login', phone: '0912345678', formError: COPY.invalidCredentials, pending: false });
  });

  it('a second submit while the first is pending is ignored (no duplicate request)', async () => {
    const answer = deferred<Scripted>();
    const server = new FakeServer();
    const { controller } = await toLogin(server);
    server.on('POST', '/login', answer.promise);
    const first = controller.submitLogin('0912345678', 'pw');
    expect(controller.screen).toMatchObject({ name: 'login', pending: true });
    expect(await controller.submitLogin('0912345678', 'pw')).toBe('ignored');
    answer.resolve(fail(401, 'INVALID_CREDENTIALS'));
    await first;
    expect(server.count('POST', '/login')).toBe(1);
  });

  it('sends the trimmed phone and the device label; the password is not part of any screen', async () => {
    const server = new FakeServer();
    const { controller, screens } = await toLogin(server);
    server.on('POST', '/login', loginOk('VERIFY_TOTP'));
    await controller.submitLogin('  0912345678 ', 'Secret-Password-9');
    expect(server.requests.at(-1)?.body).toEqual({
      phone: '0912345678',
      password: 'Secret-Password-9',
      device: { device_id: 'web-device-1', platform: 'WEB', app: 'ADMIN_WEB' },
    });
    expect(JSON.stringify(screens)).not.toContain('Secret-Password-9');
  });

  it('429: countdown from Retry-After; the button comes back when it ends, and nothing is submitted by itself', async () => {
    const server = new FakeServer();
    const { controller, clock } = await toLogin(server);
    server.on('POST', '/login', fail(429, 'ADMIN_AUTH_RATE_LIMITED', { 'retry-after': '120' }));
    await controller.submitLogin('0912345678', 'pw');
    expect(controller.screen).toMatchObject({ name: 'login', pending: false, lock: { untilMs: clock.now() + 120_000 } });
    expect(controller.lockRemainingSeconds()).toBe(120);
    expect(await controller.submitLogin('0912345678', 'pw')).toBe('ignored');
    clock.advance(119_000);
    expect(controller.lockRemainingSeconds()).toBe(1);
    clock.advance(1_000);
    expect(controller.screen).toMatchObject({ name: 'login', notice: COPY.rateLimitedOver });
    expect('lock' in controller.screen && controller.screen.lock).toBeFalsy();
    expect(server.count('POST', '/login')).toBe(1);
  });

  it('network failure: "Chưa thể kết nối", never a fake success', async () => {
    const server = new FakeServer();
    const { controller } = await toLogin(server);
    server.on('POST', '/login', 'network');
    await controller.submitLogin('0912345678', 'pw');
    expect(controller.screen).toMatchObject({ name: 'login', formError: COPY.unavailable, pending: false });
  });
});

describe('admin web flow - Authenticator steps', () => {
  it('enrollment: the key is hidden until asked; an incomplete code is not sent; leading zero kept', async () => {
    const server = new FakeServer();
    const { controller } = await toEnroll(server);
    expect(controller.screen).toMatchObject({ name: 'enroll', showKey: false });
    controller.toggleKey();
    expect(controller.screen).toMatchObject({ name: 'enroll', showKey: true });
    expect(await controller.submitCode('01234')).toBe('incomplete');
    server.on('POST', '/totp/enrollment/verify', fail(400, 'ADMIN_TOTP_INVALID'));
    await controller.submitCode('012345');
    expect(server.requests.at(-1)).toEqual({ method: 'POST', path: '/totp/enrollment/verify', body: { code: '012345' }, csrf: 'csrf-pre-1' });
    expect(controller.screen).toMatchObject({ name: 'enroll', codeError: COPY.totpInvalid, codeReset: 1, secret: SECRET });
  });

  it('success: the secret and the step CSRF are dropped, then the shell is built from GET /me only', async () => {
    const me = deferred<Scripted>();
    const server = new FakeServer();
    const { controller, screens } = await toEnroll(server);
    // The verify answer claims SYSTEM; /me says ADMIN. The shell must show what /me says.
    server.on('POST', '/totp/enrollment/verify', meOk('SYSTEM', 'csrf-session-1')).on('GET', '/me', me.promise);
    const sent = controller.submitCode('123456');
    await settle();
    expect(screens.some((screen) => screen.name === 'shell')).toBe(false);
    me.resolve(meOk('ADMIN', 'csrf-session-2'));
    await sent;
    expect(controller.screen).toEqual({ name: 'shell', role: 'ADMIN', pending: false });
    expect(exposed(controller)).not.toContain(SECRET);
    // The session CSRF used afterwards is the one from /me.
    server.on('POST', '/logout', noContent);
    await controller.logout();
    expect(server.requests.at(-1)).toEqual({ method: 'POST', path: '/logout', body: {}, csrf: 'csrf-session-2' });
  });

  it('ADMIN_PREAUTH_INVALID: back to login with the approved message; the secret is gone', async () => {
    const server = new FakeServer();
    const { controller } = await toEnroll(server);
    server.on('POST', '/totp/enrollment/verify', fail(401, 'ADMIN_PREAUTH_INVALID'));
    await controller.submitCode('123456');
    expect(controller.screen).toEqual({ name: 'login', phone: '0912345678', pending: false, notice: COPY.preauthInvalid });
    expect(exposed(controller)).not.toContain(SECRET);
  });

  it('ADMIN_CSRF_INVALID: the code is NOT sent again; the state is read and the user is told the step changed', async () => {
    const server = new FakeServer();
    const { controller } = await toVerify(server);
    server.on('POST', '/totp/verify', fail(403, 'ADMIN_CSRF_INVALID')).on('GET', '/state', preauthState('VERIFY_TOTP', 'csrf-pre-2'));
    await controller.submitCode('123456');
    expect(server.count('POST', '/totp/verify')).toBe(1);
    expect(controller.screen).toMatchObject({ name: 'verify', notice: COPY.stepChanged, pending: false });
    // The next (user-initiated) submit uses the CSRF token of the step the server reported.
    server.on('POST', '/totp/verify', fail(400, 'ADMIN_TOTP_INVALID'));
    await controller.submitCode('123456');
    expect(server.requests.at(-1)?.csrf).toBe('csrf-pre-2');
  });

  it('429 on verify: countdown, step kept, no automatic submit', async () => {
    const server = new FakeServer();
    const { controller, clock } = await toVerify(server);
    server.on('POST', '/totp/verify', fail(429, 'ADMIN_AUTH_RATE_LIMITED', { 'retry-after': '900' }));
    await controller.submitCode('123456');
    expect(controller.screen).toMatchObject({ name: 'verify', lock: { untilMs: clock.now() + 900_000 } });
    expect(await controller.submitCode('123456')).toBe('ignored');
    clock.advance(900_000);
    expect(controller.screen.name).toBe('verify');
    expect(server.count('POST', '/totp/verify')).toBe(1);
  });

  it('lost response, session cookie arrived: GET /state shows SESSION, so the shell (the code is never re-sent)', async () => {
    const server = new FakeServer();
    const { controller } = await toVerify(server);
    server.on('POST', '/totp/verify', 'network').on('GET', '/state', sessionState()).on('GET', '/me', meOk('SYSTEM'));
    await controller.submitCode('123456');
    expect(controller.screen).toEqual({ name: 'shell', role: 'SYSTEM', pending: false });
    expect(server.count('POST', '/totp/verify')).toBe(1);
  });

  it('lost response, no cookie and the step consumed: login with "use a new code"', async () => {
    const server = new FakeServer();
    const { controller } = await toVerify(server);
    server.on('POST', '/totp/verify', 'network').on('GET', '/state', fail(401, 'ADMIN_PREAUTH_INVALID'));
    await controller.submitCode('123456');
    expect(controller.screen).toMatchObject({ name: 'login', notice: COPY.lostResponse });
    expect(server.count('POST', '/totp/verify')).toBe(1);
  });

  it('lost response, the step is still alive: stay, show "Chưa thể kết nối", the user decides', async () => {
    const server = new FakeServer();
    const { controller } = await toVerify(server);
    server.on('POST', '/totp/verify', 'network').on('GET', '/state', preauthState('VERIFY_TOTP'));
    await controller.submitCode('123456');
    expect(controller.screen).toMatchObject({ name: 'verify', codeError: COPY.unavailable, pending: false });
    expect(server.count('POST', '/totp/verify')).toBe(1);
  });

  it('"Quay lại đăng nhập" is available while a code is pending and its late answer is ignored', async () => {
    const answer = deferred<Scripted>();
    const server = new FakeServer();
    const { controller } = await toVerify(server);
    server.on('POST', '/totp/verify', answer.promise);
    const sent = controller.submitCode('123456');
    controller.backToLogin();
    expect(controller.screen.name).toBe('login');
    answer.resolve(meOk());
    await sent;
    expect(controller.screen.name).toBe('login');
  });

  it('the step expires while the page is open: state read at expiry, login with the "expired" message', async () => {
    const server = new FakeServer();
    const { controller, clock } = await toLogin(server);
    const soon = new Date(clock.now() + 300_000).toISOString();
    server.on('POST', '/login', { status: 200, body: { data: { next_step: 'VERIFY_TOTP', expires_at: soon, csrf_token: 'c' } } });
    await controller.submitLogin('0912345678', 'pw');
    server.on('GET', '/state', fail(401, 'ADMIN_PREAUTH_INVALID'));
    clock.advance(300_600);
    await settle();
    expect(controller.screen).toMatchObject({ name: 'login', notice: COPY.preauthExpired });
  });
});

describe('admin web flow - shell, logout and other tabs', () => {
  async function toShell(server: FakeServer) {
    server.on('GET', '/state', sessionState('csrf-session-1')).on('GET', '/me', meOk('SYSTEM', 'csrf-session-1'));
    const context = setup(server);
    await context.controller.start();
    expect(context.controller.screen.name).toBe('shell');
    return context;
  }

  it('logout 204: login', async () => {
    const server = new FakeServer();
    const { controller } = await toShell(server);
    server.on('POST', '/logout', noContent);
    await controller.logout();
    expect(controller.screen).toEqual({ name: 'login', phone: '', pending: false });
  });

  it('logout lost or 503: still in the shell with "Chưa thể kết nối" (never assumed done)', async () => {
    const server = new FakeServer();
    const { controller } = await toShell(server);
    server.on('POST', '/logout', 'network', fail(503, 'SERVICE_UNAVAILABLE'));
    await controller.logout();
    expect(controller.screen).toEqual({ name: 'shell', role: 'SYSTEM', pending: false, error: COPY.unavailable });
    await controller.logout();
    expect(controller.screen).toEqual({ name: 'shell', role: 'SYSTEM', pending: false, error: COPY.unavailable });
  });

  it('logout with a session that is already invalid: login', async () => {
    const server = new FakeServer();
    const { controller } = await toShell(server);
    server.on('POST', '/logout', fail(401, 'ADMIN_SESSION_INVALID'));
    await controller.logout();
    expect(controller.screen.name).toBe('login');
  });

  it('tab visible again and the session was revoked elsewhere: login', async () => {
    const server = new FakeServer();
    const { controller } = await toShell(server);
    server.on('GET', '/state', noSession());
    await controller.recheck();
    expect(controller.screen.name).toBe('login');
  });

  it('tab visible again and another tab logged in anew: the role is read again from /me', async () => {
    const server = new FakeServer();
    const { controller } = await toShell(server);
    server.on('GET', '/state', sessionState('csrf-session-9')).on('GET', '/me', meOk('ADMIN', 'csrf-session-9'));
    await controller.recheck();
    expect(controller.screen).toEqual({ name: 'shell', role: 'ADMIN', pending: false });
  });

  it('verify tab visible again after another tab started a new step: notice, code cleared, new CSRF used', async () => {
    const server = new FakeServer();
    const { controller } = await toVerify(server);
    server.on('GET', '/state', preauthState('VERIFY_TOTP', 'csrf-pre-other-tab'));
    await controller.recheck();
    expect(controller.screen).toMatchObject({ name: 'verify', notice: COPY.stepChanged, codeReset: 1 });
    server.on('POST', '/totp/verify', fail(400, 'ADMIN_TOTP_INVALID'));
    await controller.submitCode('123456');
    expect(server.requests.at(-1)?.csrf).toBe('csrf-pre-other-tab');
  });

  it('login tab visible again while another tab holds a session: shell after /me', async () => {
    const server = new FakeServer();
    const { controller } = await toLogin(server);
    server.on('GET', '/state', sessionState()).on('GET', '/me', meOk('SYSTEM'));
    await controller.recheck();
    expect(controller.screen.name).toBe('shell');
  });

  it('recheck errors (network/5xx) change nothing', async () => {
    const server = new FakeServer();
    const { controller } = await toShell(server);
    server.on('GET', '/state', 'network', fail(503, 'SERVICE_UNAVAILABLE'));
    await controller.recheck();
    await controller.recheck();
    expect(controller.screen).toEqual({ name: 'shell', role: 'SYSTEM', pending: false });
  });
});
