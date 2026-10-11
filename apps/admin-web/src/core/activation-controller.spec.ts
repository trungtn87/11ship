import { describe, expect, it } from '@jest/globals';
import { ADMIN_COPY } from './messages';
import { ActivationController, ActivationScreen } from './activation-controller';
import {
  ACT_SECRET,
  FakeClock,
  FakeServer,
  TOKEN,
  actEnrollment,
  actError,
  actState,
  fail,
  ok,
  otpStatus,
  startedFresh,
  settle,
} from './test-support';

// Unit tests of the ADMIN activation flow against a SCRIPTED server. Not integration tests: the real backend, the real
// QR and a real browser are exercised by tests/integration/admin-web-browser.int.spec.ts.

function setup(server: FakeServer) {
  const clock = new FakeClock();
  const controller = new ActivationController(server.activationApi(), clock);
  const screens: ActivationScreen[] = [];
  controller.subscribe((screen) => screens.push(screen));
  return { controller, clock, screens };
}

const exposed = (controller: ActivationController): string => JSON.stringify(controller.screen);

/** Link opened: start (201) + the read that follows it. */
async function toOtp(server: FakeServer, status: ReturnType<typeof otpStatus> = otpStatus('NONE')) {
  server.on('POST', '/start', startedFresh()).on('GET', '/state', status);
  const context = setup(server);
  await context.controller.begin(TOKEN);
  await settle();
  expect(context.controller.screen.name).toBe('otp');
  return context;
}

async function toPassword(server: FakeServer) {
  const context = await toOtp(server, otpStatus('SUBMITTED', { resend_at: '2999-01-01T00:00:00.000Z', attempts_left: 5 }));
  server.on('POST', '/otp/verify', ok({ state: 'OTP_VERIFIED' }));
  await context.controller.verifyOtp('012345');
  expect(context.controller.screen.name).toBe('password');
  return context;
}

async function toEnroll(server: FakeServer) {
  const context = await toPassword(server);
  server.on('POST', '/password', ok({ state: 'PASSWORD_SET' })).on('POST', '/totp/enrollment', actEnrollment());
  await context.controller.submitPassword('Correct-Horse-1', 'Correct-Horse-1');
  await settle();
  const screen = context.controller.screen;
  expect(screen.name === 'enroll' && screen.secret).toBe(ACT_SECRET);
  return context;
}

describe('activation - opening the link', () => {
  it('the token goes only in the body of POST /start, never in a path, and is not kept afterwards', async () => {
    const server = new FakeServer();
    const { controller } = await toOtp(server);
    expect(server.requests[0]).toEqual({ method: 'POST', path: '/start', body: { token: TOKEN } });
    expect(server.requests.some((request) => request.path.includes(TOKEN))).toBe(false);
    expect(server.requests.slice(1).some((request) => JSON.stringify(request).includes(TOKEN))).toBe(false);
    expect(exposed(controller)).not.toContain(TOKEN);
  });

  it('an invalid link (one code for every reason) is its own screen', async () => {
    const server = new FakeServer().on('POST', '/start', actError(404, 'ADMIN_ACTIVATION_LINK_INVALID'));
    const { controller } = setup(server);
    await controller.begin(TOKEN);
    expect(controller.screen.name).toBe('link-invalid');
  });

  it('a malformed fragment is rejected locally, nothing is sent', () => {
    const server = new FakeServer();
    const { controller } = setup(server);
    controller.rejectLink();
    expect(controller.screen.name).toBe('link-invalid');
    expect(server.requests).toEqual([]);
  });

  it('phone conflict on start, and an attempt limit with Retry-After, each get their screen', async () => {
    const conflict = new FakeServer().on('POST', '/start', actError(409, 'ADMIN_PHONE_CONFLICT'));
    const first = setup(conflict);
    await first.controller.begin(TOKEN);
    expect(first.controller.screen).toMatchObject({ name: 'invalidated', reason: 'PHONE_CONFLICT', canRestart: false });

    const limited = new FakeServer().on('POST', '/start', fail(429, 'ADMIN_AUTH_RATE_LIMITED', { 'retry-after': '40' }));
    const second = setup(limited);
    await second.controller.begin(TOKEN);
    expect(second.controller.screen.name).toBe('rate-limited');
    expect(second.controller.waitSeconds()).toBe(40);
    second.clock.advance(41_000);
    expect(second.controller.screen.name).toBe('session-expired'); // the person opens the link again
  });

  it('a lost answer to start: "unavailable"; the retry sends the same start once more (the user clicked)', async () => {
    const server = new FakeServer().on('POST', '/start', 'network', startedFresh()).on('GET', '/state', otpStatus('NONE'));
    const { controller } = setup(server);
    await controller.begin(TOKEN);
    expect(controller.screen.name).toBe('unavailable');
    await settle();
    expect(server.count('POST', '/start')).toBe(1); // nothing was repeated by itself
    await controller.retry();
    await settle();
    expect(controller.screen.name).toBe('otp');
    expect(exposed(controller)).not.toContain(TOKEN);
  });
});

describe('activation - reload at every step (GET /state only)', () => {
  const cases: [string, ReturnType<typeof actState>, string][] = [
    ['STARTED with the SMS not yet sent', otpStatus('NONE'), 'otp'],
    ['STARTED with the SMS sent', otpStatus('SUBMITTED', { resend_at: '2999-01-01T00:00:00.000Z', attempts_left: 4 }), 'otp'],
    ['OTP_VERIFIED', actState('OTP_VERIFIED', { password_deadline: '2999-01-01T00:00:00.000Z', restart_required: false }), 'password'],
    ['PASSWORD_SET', actState('PASSWORD_SET'), 'enroll'],
    ['TOTP_ISSUED', actState('TOTP_ISSUED', { totp_attempts_left: 4 }), 'enroll'],
    ['COMPLETED', actState('COMPLETED', { next: 'LOGIN' }), 'done'],
  ];
  for (const [label, answer, screen] of cases) {
    it(`${label} -> ${screen}, without sending anything`, async () => {
      const server = new FakeServer().on('GET', '/state', answer);
      if (screen === 'enroll') {
        server.on('POST', '/totp/enrollment', actEnrollment());
      }
      const { controller } = setup(server);
      await controller.begin(undefined);
      await settle();
      expect(controller.screen.name).toBe(screen);
      expect(server.count('POST', '/otp/request')).toBe(0);
      expect(server.count('POST', '/start')).toBe(0);
      expect(server.requests.filter((request) => request.method === 'POST').map((request) => request.path)).toEqual(screen === 'enroll' ? ['/totp/enrollment'] : []);
    });
  }

  it('reload at TOTP_ISSUED gets the SAME secret again (enrollment is replayable)', async () => {
    const server = new FakeServer().on('GET', '/state', actState('TOTP_ISSUED')).on('POST', '/totp/enrollment', actEnrollment());
    const { controller } = setup(server);
    await controller.begin(undefined);
    await settle();
    expect(controller.screen).toMatchObject({ name: 'enroll', secret: ACT_SECRET });
  });

  it('no attempt for this browser (401): the expired-session screen', async () => {
    const server = new FakeServer().on('GET', '/state', actError(401, 'ADMIN_ACTIVATION_SESSION_INVALID'));
    const { controller } = setup(server);
    await controller.begin(undefined);
    expect(controller.screen.name).toBe('session-expired');
  });

  it('INVALIDATED: each reason has its screen; only ATTEMPTS_EXHAUSTED (with a token) can restart', async () => {
    for (const reason of ['REPLACED', 'LINK_UNAVAILABLE', 'PHONE_CONFLICT'] as const) {
      const server = new FakeServer().on('GET', '/state', actState('INVALIDATED', { reason, can_restart: false }));
      const { controller } = setup(server);
      await controller.begin(undefined);
      expect(controller.screen).toMatchObject({ name: 'invalidated', reason, canRestart: false });
    }
    const server = new FakeServer()
      .on('GET', '/state', actState('INVALIDATED', { reason: 'ATTEMPTS_EXHAUSTED', can_restart: true, csrf_token: 'csrf-x' }))
      .on('POST', '/restart', startedFresh())
      .on('GET', '/state', otpStatus('NONE'));
    const { controller } = setup(server);
    await controller.begin(undefined);
    expect(controller.screen).toMatchObject({ name: 'invalidated', reason: 'ATTEMPTS_EXHAUSTED', canRestart: true });
    await controller.restart();
    await settle();
    expect(controller.screen.name).toBe('otp');
    expect(server.requests.find((request) => request.path === '/restart')).toMatchObject({ csrf: 'csrf-x', body: {} });
  });
});

describe('activation - SMS step', () => {
  it('requests ONE SMS, shows the resend wait, and ignores a second click until it ends', async () => {
    const server = new FakeServer();
    const { controller, clock } = await toOtp(server);
    server.on('POST', '/otp/request', { status: 202, body: { data: { resend_at: new Date(clock.now() + 60_000).toISOString(), delivery: 'SUBMITTED' } } });
    await controller.requestOtp();
    expect(controller.screen).toMatchObject({ name: 'otp', otp: { status: 'SUBMITTED' } });
    expect(controller.waitSeconds()).toBe(60);
    await controller.requestOtp();
    expect(server.count('POST', '/otp/request')).toBe(1);
    clock.advance(61_000);
    expect(controller.waitSeconds()).toBe(0);
    expect(server.count('POST', '/otp/request')).toBe(1); // the end of the wait sends nothing
  });

  it('TEST_DISPLAY: the displayed code is on the OTP screen only and goes with it', async () => {
    const server = new FakeServer();
    const { controller, clock } = await toOtp(server);
    server.on('POST', '/otp/request', { status: 202, body: { data: { resend_at: new Date(clock.now() + 60_000).toISOString(), delivery: 'SUBMITTED', displayed_code: '042042' } } });
    await controller.requestOtp();
    expect(controller.screen).toMatchObject({ name: 'otp', displayedCode: '042042' });
    server.on('POST', '/otp/verify', ok({ state: 'OTP_VERIFIED' }));
    await controller.verifyOtp('042042');
    expect(exposed(controller)).not.toContain('042042');
  });

  it('a lost answer to "send": only GET /state is read, never a second SMS', async () => {
    const server = new FakeServer();
    const { controller } = await toOtp(server);
    server.on('POST', '/otp/request', 'network').on('GET', '/state', otpStatus('SUBMITTED', { resend_at: '2999-01-01T00:00:00.000Z', attempts_left: 5 }));
    await controller.requestOtp();
    await settle();
    expect(server.count('POST', '/otp/request')).toBe(1);
    expect(controller.screen).toMatchObject({ name: 'otp', pending: false, otp: { status: 'SUBMITTED' } });
  });

  it('OTP_RATE_LIMITED has no Retry-After: the resend time comes from GET /state', async () => {
    const server = new FakeServer();
    const { controller, clock } = await toOtp(server);
    const resendAt = new Date(clock.now() + 90_000).toISOString();
    server.on('POST', '/otp/request', fail(429, 'OTP_RATE_LIMITED')).on('GET', '/state', otpStatus('SUBMITTED', { resend_at: resendAt }));
    await controller.requestOtp();
    await settle();
    expect(controller.waitSeconds()).toBe(90);
    expect(server.count('POST', '/otp/request')).toBe(1);
  });

  it('wrong SMS code: the error shows, the field is reset, attempts left come from a read; the code is never resent', async () => {
    const server = new FakeServer();
    const { controller } = await toOtp(server, otpStatus('SUBMITTED', { resend_at: '2999-01-01T00:00:00.000Z', attempts_left: 5 }));
    server.on('POST', '/otp/verify', fail(400, 'OTP_INVALID')).on('GET', '/state', otpStatus('FAILED', { resend_at: '2999-01-01T00:00:00.000Z', attempts_left: 4 }));
    await controller.verifyOtp('000000');
    await settle();
    expect(controller.screen).toMatchObject({ name: 'otp', codeError: 'invalid', otp: { attemptsLeft: 4 } });
    expect(server.count('POST', '/otp/verify')).toBe(1);
    expect(server.requests.find((request) => request.path === '/otp/verify')?.body).toEqual({ code: '000000' }); // leading zeros kept
  });

  it('an incomplete code sends nothing', async () => {
    const server = new FakeServer();
    const { controller } = await toOtp(server);
    expect(await controller.verifyOtp('12345')).toBe('incomplete');
    expect(server.count('POST', '/otp/verify')).toBe(0);
  });

  it('STEP_INVALID: the details say where the attempt is; without a CSRF token the state is read', async () => {
    const server = new FakeServer();
    const { controller } = await toOtp(server, otpStatus('SUBMITTED', { resend_at: '2999-01-01T00:00:00.000Z' }));
    server.on('POST', '/otp/verify', actError(409, 'ADMIN_ACTIVATION_STEP_INVALID', { state: 'PASSWORD_SET', expires_at: '2999-01-01T00:00:00.000Z' }));
    server.on('GET', '/state', actState('PASSWORD_SET')).on('POST', '/totp/enrollment', actEnrollment());
    await controller.verifyOtp('123456');
    await settle();
    expect(controller.screen.name).toBe('enroll');
  });

  it('ADMIN_CSRF_INVALID: nothing is repeated; GET /state brings the current step and token', async () => {
    const server = new FakeServer();
    const { controller } = await toOtp(server, otpStatus('SUBMITTED', { resend_at: '2999-01-01T00:00:00.000Z' }));
    server.on('POST', '/otp/verify', fail(403, 'ADMIN_CSRF_INVALID')).on('GET', '/state', otpStatus('SUBMITTED', { resend_at: '2999-01-01T00:00:00.000Z' }));
    await controller.verifyOtp('123456');
    await settle();
    expect(server.count('POST', '/otp/verify')).toBe(1);
    expect(controller.screen.name).toBe('otp');
  });
});

describe('activation - password and Authenticator', () => {
  it('password: 8-128 code points and a matching confirmation, checked before any request', async () => {
    const server = new FakeServer();
    const { controller } = await toPassword(server);
    const before = server.requests.length;
    expect(await controller.submitPassword('short', 'short')).toBe('invalid');
    expect(await controller.submitPassword('Correct-Horse-1', 'Correct-Horse-2')).toBe('mismatch');
    expect(server.requests.length).toBe(before);
  });

  it('the password is sent once, in the body, and is not in any screen afterwards', async () => {
    const server = new FakeServer();
    const { controller } = await toEnroll(server);
    expect(server.requests.find((request) => request.path === '/password')).toMatchObject({ csrf: 'csrf-act-1', body: { password: 'Correct-Horse-1' } });
    expect(exposed(controller)).not.toContain('Correct-Horse-1');
  });

  it('a lost answer to the password: only GET /state; still OTP_VERIFIED -> stays, the user decides', async () => {
    const server = new FakeServer();
    const { controller } = await toPassword(server);
    server.on('POST', '/password', 'network').on('GET', '/state', actState('OTP_VERIFIED', { password_deadline: '2999-01-01T00:00:00.000Z', restart_required: false }));
    await controller.submitPassword('Correct-Horse-1', 'Correct-Horse-1');
    await settle();
    expect(server.count('POST', '/password')).toBe(1);
    expect(controller.screen).toMatchObject({ name: 'password', pending: false });
  });

  it('a lost answer to the password that DID succeed moves on after the read', async () => {
    const server = new FakeServer();
    const { controller } = await toPassword(server);
    server.on('POST', '/password', 'network').on('GET', '/state', actState('PASSWORD_SET')).on('POST', '/totp/enrollment', actEnrollment());
    await controller.submitPassword('Correct-Horse-1', 'Correct-Horse-1');
    await settle();
    expect(controller.screen).toMatchObject({ name: 'enroll', secret: ACT_SECRET });
    expect(server.count('POST', '/password')).toBe(1);
  });

  it('password deadline passed (restart_required): restart is offered, the form is closed', async () => {
    const server = new FakeServer().on('GET', '/state', actState('OTP_VERIFIED', { password_deadline: '2000-01-01T00:00:00.000Z', restart_required: true })).on('POST', '/restart', startedFresh()).on('GET', '/state', otpStatus('NONE'));
    const { controller } = setup(server);
    await controller.begin(undefined);
    expect(controller.screen).toMatchObject({ name: 'password', restartRequired: true });
    expect(await controller.submitPassword('Correct-Horse-1', 'Correct-Horse-1')).toBe('ignored');
    await controller.restart();
    await settle();
    expect(controller.screen.name).toBe('otp');
  });

  it('completing: the right code ends on "done"; secret and QR source are gone; no admin session is requested', async () => {
    const server = new FakeServer();
    const { controller } = await toEnroll(server);
    server.on('POST', '/complete', ok({ state: 'COMPLETED', next: 'LOGIN' }));
    await controller.complete('000123');
    expect(controller.screen).toEqual({ name: 'done' });
    expect(server.requests.find((request) => request.path === '/complete')).toMatchObject({ csrf: 'csrf-act-1', body: { code: '000123' } });
    expect(server.requests.every((request) => request.path !== '/me' && request.path !== '/login')).toBe(true);
  });

  it('a wrong Authenticator code: error, field reset, attempts from the read; the 5th wrong one lands on ATTEMPTS_EXHAUSTED', async () => {
    const server = new FakeServer();
    const { controller } = await toEnroll(server);
    server.on('POST', '/complete', fail(400, 'ADMIN_TOTP_INVALID')).on('GET', '/state', actState('TOTP_ISSUED', { totp_attempts_left: 1 }));
    await controller.complete('111111');
    await settle();
    expect(controller.screen).toMatchObject({ name: 'enroll', codeError: 'invalid', attemptsLeft: 1, pending: false });
    server.on('POST', '/complete', fail(400, 'ADMIN_TOTP_INVALID')).on('GET', '/state', actState('INVALIDATED', { reason: 'ATTEMPTS_EXHAUSTED', can_restart: true, csrf_token: 'csrf-x' }));
    await controller.complete('222222');
    await settle();
    expect(controller.screen).toMatchObject({ name: 'invalidated', reason: 'ATTEMPTS_EXHAUSTED', canRestart: true });
    expect(exposed(controller)).not.toContain(ACT_SECRET);
  });

  it('Retry-After on the code step locks the field until it ends, then sends nothing by itself', async () => {
    const server = new FakeServer();
    const { controller, clock } = await toEnroll(server);
    server.on('POST', '/complete', fail(429, 'ADMIN_AUTH_RATE_LIMITED', { 'retry-after': '30' })).on('GET', '/state', actState('TOTP_ISSUED'));
    await controller.complete('123456');
    await settle();
    expect(controller.waitSeconds()).toBe(30);
    expect(await controller.complete('654321')).toBe('ignored');
    clock.advance(31_000);
    expect(controller.waitSeconds()).toBe(0);
    expect(server.count('POST', '/complete')).toBe(1);
  });

  it('a lost answer to the last code: only a read; COMPLETED -> done, TOTP_ISSUED -> stays, the code is sent once', async () => {
    const lostButDone = new FakeServer();
    const done = await toEnroll(lostButDone);
    lostButDone.on('POST', '/complete', 'network').on('GET', '/state', actState('COMPLETED', { next: 'LOGIN' }));
    await done.controller.complete('123456');
    await settle();
    expect(done.controller.screen.name).toBe('done');
    expect(lostButDone.count('POST', '/complete')).toBe(1);

    const lost = new FakeServer();
    const stay = await toEnroll(lost);
    lost.on('POST', '/complete', fail(503, 'SERVICE_UNAVAILABLE')).on('GET', '/state', actState('TOTP_ISSUED', { totp_attempts_left: 5 }));
    await stay.controller.complete('123456');
    await settle();
    expect(stay.controller.screen).toMatchObject({ name: 'enroll', codeError: 'unavailable', pending: false });
    expect(lost.count('POST', '/complete')).toBe(1);
  });

  it('replaced by a newer invitation while on a step: the next answer names it', async () => {
    const server = new FakeServer();
    const { controller } = await toEnroll(server);
    server.on('POST', '/complete', actError(409, 'ADMIN_ACTIVATION_STEP_INVALID', { state: 'INVALIDATED', reason: 'REPLACED', can_restart: false }));
    await controller.complete('123456');
    expect(controller.screen).toMatchObject({ name: 'invalidated', reason: 'REPLACED', canRestart: false });
    expect(exposed(controller)).not.toContain(ACT_SECRET);
  });

  it('the attempt running out on the server is noticed at its expiry time by a READ, not by guessing', async () => {
    const server = new FakeServer().on('GET', '/state', otpStatus('NONE', {}, '2026-10-09T09:02:00.000Z'));
    const { controller, clock } = setup(server);
    await controller.begin(undefined);
    expect(controller.screen.name).toBe('otp');
    clock.advance(60_000);
    await settle();
    expect(server.count('GET', '/state')).toBe(1); // nothing before the expiry
    server.on('GET', '/state', actError(401, 'ADMIN_ACTIVATION_SESSION_INVALID'));
    clock.advance(61_000);
    await settle();
    expect(controller.screen.name).toBe('session-expired');
    expect(server.requests.filter((request) => request.method === 'POST')).toEqual([]);
  });
});

describe('activation - restart whose answer is lost (F1): recovered by GET /state, never re-posted', () => {
  const exhausted = (csrf: string) => actState('INVALIDATED', { reason: 'ATTEMPTS_EXHAUSTED', can_restart: true, csrf_token: csrf });

  it('the restart was committed but its answer was lost: GET /state returns the NEW attempt, with its own CSRF', async () => {
    const server = new FakeServer()
      .on('GET', '/state', exhausted('csrf-old'), actState('STARTED', { csrf_token: 'csrf-new', otp: { status: 'NONE' } }))
      .on('POST', '/restart', 'network')
      .on('POST', '/otp/request', { status: 202, body: { data: { delivery: 'SUBMITTED', resend_at: '2999-01-01T00:00:00.000Z' } } });
    const { controller } = setup(server);
    await controller.begin(undefined);
    await controller.restart();
    await settle();
    expect(controller.screen).toMatchObject({ name: 'otp', pending: false });
    expect(server.count('POST', '/restart')).toBe(1);
    expect(server.count('GET', '/state')).toBe(2);
    await controller.requestOtp();
    expect(server.requests.find((request) => request.path === '/otp/request')).toMatchObject({ csrf: 'csrf-new' });
  });

  it('the restart was NOT committed (5xx): GET /state returns the old attempt, nothing is re-posted; the user may press again', async () => {
    const server = new FakeServer()
      .on('GET', '/state', exhausted('csrf-old'), exhausted('csrf-old-2'), otpStatus('NONE'))
      .on('POST', '/restart', fail(503, 'SERVICE_UNAVAILABLE'), startedFresh());
    const { controller } = setup(server);
    await controller.begin(undefined);
    await controller.restart();
    await settle();
    expect(controller.screen).toMatchObject({ name: 'invalidated', reason: 'ATTEMPTS_EXHAUSTED', canRestart: true, pending: false });
    expect((controller.screen as { stateUnknown?: boolean }).stateUnknown).toBeUndefined();
    expect(server.count('POST', '/restart')).toBe(1); // no automatic second POST
    await controller.restart(); // the user's own decision, with the CSRF of the latest read
    await settle();
    expect(server.requests.filter((request) => request.path === '/restart').map((request) => request.csrf)).toEqual(['csrf-old', 'csrf-old-2']);
    expect(controller.screen.name).toBe('otp');
  });

  it('both the POST and the GET are lost: the outcome is unknown, only a READ can be repeated, never the POST', async () => {
    const server = new FakeServer()
      .on('GET', '/state', exhausted('csrf-old'), 'network', fail(503, 'SERVICE_UNAVAILABLE'), actState('STARTED', { csrf_token: 'csrf-new', otp: { status: 'NONE' } }))
      .on('POST', '/restart', 'network');
    const { controller, clock } = setup(server);
    await controller.begin(undefined);
    await controller.restart();
    expect(controller.screen).toMatchObject({ name: 'invalidated', pending: false, stateUnknown: true, error: ADMIN_COPY.restartUnknown });
    await controller.restart(); // not offered while the outcome is unknown
    clock.advance(120_000);
    await settle();
    expect(server.count('POST', '/restart')).toBe(1);
    await controller.retryRead(); // the read fails again
    expect(controller.screen).toMatchObject({ name: 'invalidated', stateUnknown: true });
    expect(server.count('GET', '/state')).toBe(3);
    await controller.retryRead(); // the read works: the new attempt
    expect(controller.screen).toMatchObject({ name: 'otp' });
    expect(server.count('POST', '/restart')).toBe(1);
    expect(server.count('GET', '/state')).toBe(4);
  });

  it('a restart from the password step (deadline passed) is recovered the same way', async () => {
    const closed = actState('OTP_VERIFIED', { password_deadline: '2000-01-01T00:00:00.000Z', restart_required: true });
    const server = new FakeServer().on('GET', '/state', closed, otpStatus('NONE')).on('POST', '/restart', 'network');
    const { controller } = setup(server);
    await controller.begin(undefined);
    await controller.restart();
    await settle();
    expect(controller.screen.name).toBe('otp');
    expect(server.count('POST', '/restart')).toBe(1);
  });
});

describe('activation - a read that finds the password window closed (F3)', () => {
  it('GET /state moves restartRequired from false to true: the form is closed and the restart is offered', async () => {
    const server = new FakeServer();
    const { controller } = await toPassword(server);
    expect(controller.screen).toMatchObject({ name: 'password', restartRequired: false });
    server
      .on('POST', '/password', 'network')
      .on('GET', '/state', actState('OTP_VERIFIED', { password_deadline: '2000-01-01T00:00:00.000Z', restart_required: true }))
      .on('POST', '/restart', startedFresh())
      .on('GET', '/state', otpStatus('NONE'));
    await controller.submitPassword('Correct-Horse-1', 'Correct-Horse-1');
    await settle();
    expect(controller.screen).toMatchObject({ name: 'password', restartRequired: true, pending: false, passwordDeadlineMs: Date.parse('2000-01-01T00:00:00.000Z') });
    expect(await controller.submitPassword('Correct-Horse-1', 'Correct-Horse-1')).toBe('ignored');
    expect(server.count('POST', '/password')).toBe(1);
    await controller.restart();
    await settle();
    expect(controller.screen.name).toBe('otp');
  });

  it('a read that still says OTP_VERIFIED updates the password deadline', async () => {
    const server = new FakeServer();
    const { controller } = await toPassword(server);
    server.on('POST', '/password', 'network').on('GET', '/state', actState('OTP_VERIFIED', { password_deadline: '2998-01-01T00:00:00.000Z', restart_required: false }));
    await controller.submitPassword('Correct-Horse-1', 'Correct-Horse-1');
    await settle();
    expect(controller.screen).toMatchObject({ name: 'password', restartRequired: false, passwordDeadlineMs: Date.parse('2998-01-01T00:00:00.000Z') });
  });
});
