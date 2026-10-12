import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { buildClientWeb } from '../../scripts/client-web-build.mjs';

// M01.07 — the register flow controller (apps/client-shared/src/register-flow.ts) on top of the REAL adapter (createAuthClient)
// with a controlled fetch. What is proved: the form typed in F11 reaches the final register unchanged while the code step
// happens; one intent = one key and one body across a lost answer; leaving drops everything and makes late answers stale;
// no second request on a double press; resend replaces the challenge; a 429 invents no wait. The same flow in a real browser is
// register-browser.test.mjs; against the real backend and PostgreSQL it is tests/integration/food-register-browser.int.spec.ts.

let out;
let lib;
const load = (name) => import(pathToFileURL(join(lib, name)).href);
before(() => {
  out = mkdtempSync(join(tmpdir(), 'register-flow-'));
  const built = buildClientWeb('ui-foundation', { design: true, outDir: out, quiet: true });
  lib = join(built.dist, 'js', 'client-shared', 'src');
});
after(() => rmSync(out, { recursive: true, force: true }));

const USER = '11111111-1111-4111-8111-111111111111';
const CHALLENGE_1 = '22222222-2222-4222-8222-222222222222';
const CHALLENGE_2 = '55555555-5555-4555-8555-555555555555';
const PROOF = 'PROOF_TOKEN_' + 'p'.repeat(30);
const ACCESS = 'ACCESS_TOKEN_' + 'a'.repeat(30);
const PASSWORD = '  Mật khẩu có dấu cách & ký tự lạ 123 ';
const PHONE = '0987654321';

const identity = () => ({
  user_id: USER,
  phone_normalized: '+84987654321',
  available_roles: ['CUSTOMER'],
  active_role: 'CUSTOMER',
  profile: { full_name: 'Nguyễn Văn An', version: 1 },
  capabilities: { customer_access: true, shop_profile_read: false, shop_manage: false, driver_profile_read: false },
  onboarding: { shop: 'NOT_STARTED', driver: 'NOT_STARTED' },
  onboarding_required: false,
  role_selection_required: false,
});
const signIn = () => ({ data: { ...identity(), access_token: ACCESS, session: { expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString() } } });
const issued = (id = CHALLENGE_1, expires = 180, resend = 60) => ({ data: { verification_id: id, expires_in_seconds: expires, resend_after_seconds: resend } });
const verified = () => ({ data: { verification_token: PROOF, purpose: 'REGISTER', expires_in_seconds: 600 } });
const errorBody = (code) => ({ error: { code, message: 'RAW_SERVER_TEXT_MARKER', request_id: 'r', details: {} } });
const reply = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

/** `handler(call, index)` answers; an Error returned is a dropped connection; a promise may be returned to delay. */
function stub(handler) {
  const calls = [];
  const fn = async (url, init) => {
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const call = { url: String(url), method: init.method, headers, body: init.body, signal: init.signal };
    calls.push(call);
    const result = await handler(call, calls.length);
    if (result instanceof Error) {
      throw result;
    }
    return result;
  };
  return { fetch: fn, calls };
}
const isOtpRequest = (call) => call.url.endsWith('/v1/auth/phone-verifications');
const isVerify = (call) => /\/phone-verifications\/[^/]+\/verify$/.test(call.url);
const isRegister = (call) => call.url.endsWith('/v1/client-auth/register');
const KEYS = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
};

async function setup(handler, options = {}) {
  const { createAuthClient } = await load('auth/client.js');
  const { createRegisterController, REGISTER_FLOW } = await load('register-flow.js');
  const { FlowStore } = await load('screen.js');
  const { FOOD_TEST_CONSENT } = await load('consent.js');
  const http = stub(handler);
  const auth = createAuthClient({ fetch: http.fetch, app: 'FOOD', newKey: KEYS(), deviceId: 'web-test-device' });
  const flows = new FlowStore();
  const controller = createRegisterController({ auth, flows, consent: FOOD_TEST_CONSENT, ...options });
  return { auth, flows, controller, http, REGISTER_FLOW, consent: FOOD_TEST_CONSENT };
}

const FORM = { fullName: '  Nguyễn  Văn An ', phone: ` ${PHONE} `, password: PASSWORD };
const happy = (call) => (isOtpRequest(call) ? reply(201, issued()) : isVerify(call) ? reply(200, verified()) : reply(201, signIn()));

describe('the approved consent (docs/tasks/M01-03-customer-register-local-handoff.md §3)', () => {
  it('the texts and versions of the screen are the approved ones, character for character', async () => {
    const { FOOD_TEST_CONSENT: c } = await load('consent.js');
    const doc = readFileSync(new URL('../../docs/tasks/M01-03-customer-register-local-handoff.md', import.meta.url), 'utf8');
    assert.equal(c.termsVersion, 'test-terms-20261011-v1');
    assert.equal(c.privacyVersion, 'test-privacy-20261011-v1');
    for (const text of [c.termsText, c.privacyText, c.checkboxLabel, c.termsVersion, c.privacyVersion]) {
      assert.ok(doc.includes(text), `the approved document contains: ${text.slice(0, 50)}…`);
    }
  });
});

describe('register flow: the form survives the code step and is sent unchanged', () => {
  it('request code -> verify -> register: original password, name, consent pair and proof in the final body; session from the server', async () => {
    const { controller, http, auth, flows, REGISTER_FLOW, consent } = await setup(happy);
    const started = await controller.begin(FORM);
    assert.equal(started.kind, 'ok');
    assert.equal(flows.has(REGISTER_FLOW), true, 'F12 may open');
    assert.deepEqual(JSON.parse(http.calls[0].body), { phone: PHONE, purpose: 'REGISTER' });
    const view = controller.view();
    assert.equal(view.phone, PHONE);
    assert.equal(view.stage, 'otp');
    assert.equal(view.challenge.verificationId, CHALLENGE_1);
    assert.ok(view.challenge.expiresAtMs > Date.now() + 170_000 && view.challenge.expiresAtMs <= Date.now() + 180_000, 'the deadline is the server value, counted from now');
    assert.ok(view.challenge.resendAtMs > Date.now() + 55_000 && view.challenge.resendAtMs <= Date.now() + 60_500);
    assert.equal(JSON.stringify(view).includes(PASSWORD.trim()), false, 'the view never carries the password');

    const done = await controller.verify('123456');
    assert.equal(done.kind, 'ok');
    assert.equal(http.calls.length, 3);
    assert.equal(http.calls[1].url.endsWith(`/phone-verifications/${CHALLENGE_1}/verify`), true);
    assert.deepEqual(JSON.parse(http.calls[1].body), { otp: '123456' });
    assert.equal(http.calls[1].body.includes('Mật'), false, 'the password is not part of the code step');
    const register = http.calls[2];
    assert.equal(register.headers['idempotency-key'], '00000000-0000-4000-8000-000000000001');
    assert.deepEqual(JSON.parse(register.body), {
      phone: PHONE,
      password: PASSWORD,
      verification_token: PROOF,
      device: { device_id: 'web-test-device', platform: 'WEB', app: 'FOOD' },
      full_name: 'Nguyễn Văn An',
      consent: { terms_version: consent.termsVersion, privacy_version: consent.privacyVersion },
    });
    // Session and identity come from the server's answer; the flow data is gone, the session stays.
    assert.equal(auth.session.state().kind, 'authenticated');
    assert.equal(auth.session.identity().userId, USER);
    assert.equal(auth.session.identity().profile.fullName, 'Nguyễn Văn An');
    assert.equal(controller.view(), undefined);
    assert.equal(flows.has(REGISTER_FLOW), false);
    assert.equal(JSON.stringify(auth.session.identity()).includes(ACCESS), false, 'the screens never see the bearer');
  });

  it('a refused request for a code stores nothing and opens no flow', async () => {
    const { controller, flows, REGISTER_FLOW } = await setup(() => reply(409, errorBody('PHONE_ALREADY_REGISTERED')));
    const started = await controller.begin(FORM);
    assert.equal(started.kind, 'failure');
    assert.equal(started.code, 'PHONE_ALREADY_REGISTERED');
    assert.equal(controller.view(), undefined);
    assert.equal(flows.has(REGISTER_FLOW), false);
  });

  it('a wrong code keeps the code step (no register, no new request for a code)', async () => {
    const { controller, http } = await setup((call) => (isOtpRequest(call) ? reply(201, issued()) : reply(400, errorBody('OTP_INVALID'))));
    await controller.begin(FORM);
    const step = await controller.verify('000000');
    assert.equal(step.kind, 'failure');
    assert.equal(step.where, 'verify');
    assert.equal(step.code, 'OTP_INVALID');
    assert.equal(controller.view().stage, 'otp');
    assert.equal(http.calls.filter(isRegister).length, 0);
    assert.equal(http.calls.filter(isOtpRequest).length, 1);
  });
});

describe('register flow: double press, lost answer, leaving', () => {
  it('a second press while the code is being checked sends nothing', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const { controller, http } = await setup(async (call) => {
      if (isVerify(call)) {
        await gate;
        return reply(200, verified());
      }
      return isOtpRequest(call) ? reply(201, issued()) : reply(201, signIn());
    });
    await controller.begin(FORM);
    const first = controller.verify('123456');
    const second = await controller.verify('123456');
    const resend = await controller.resend();
    assert.equal(second.kind, 'failure');
    assert.equal(second.code, 'IN_PROGRESS');
    assert.equal(resend.kind, 'failure');
    assert.equal(resend.code, 'IN_PROGRESS');
    release();
    assert.equal((await first).kind, 'ok');
    assert.equal(http.calls.filter(isVerify).length, 1);
    assert.equal(http.calls.filter(isRegister).length, 1);
  });

  it('two presses of "continue" in F11 make one request for a code', async () => {
    const { controller, http } = await setup(async (call) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return reply(201, issued());
    });
    const [a, b] = await Promise.all([controller.begin(FORM), controller.begin(FORM)]);
    assert.equal(a.kind, 'ok');
    assert.equal(b.kind, 'ok');
    assert.equal(http.calls.length, 1);
  });

  for (const [name, answer] of [
    ['the connection drops', () => new Error('network down')],
    ['the server answers 503', () => reply(503, errorBody('SERVICE_UNAVAILABLE'))],
    ['the server answers 500', () => reply(500, errorBody('INTERNAL_ERROR'))],
  ]) {
    it(`register whose answer is lost (${name}): stays in the register step; "try again" re-sends the SAME key, body and proof - no new code, no new verify`, async () => {
      let registers = 0;
      const { controller, http, auth } = await setup((call) => {
        if (isOtpRequest(call)) {
          return reply(201, issued());
        }
        if (isVerify(call)) {
          return reply(200, verified());
        }
        registers += 1;
        return registers === 1 ? answer() : reply(201, signIn());
      });
      await controller.begin(FORM);
      const first = await controller.verify('123456');
      assert.equal(first.kind, 'failure');
      assert.equal(first.where, 'register');
      assert.equal(first.unresolved, true);
      assert.equal(controller.view().stage, 'register', 'the screen offers "try again", not the code step');
      assert.equal(auth.session.state().kind, 'anonymous');

      const second = await controller.retryRegister();
      assert.equal(second.kind, 'ok');
      const sent = http.calls.filter(isRegister);
      assert.equal(sent.length, 2);
      assert.equal(sent[1].headers['idempotency-key'], sent[0].headers['idempotency-key']);
      assert.equal(sent[1].body, sent[0].body, 'the exact same bytes');
      assert.equal(http.calls.filter(isVerify).length, 1, 'the code was not asked again');
      assert.equal(http.calls.filter(isOtpRequest).length, 1, 'no new code was requested');
      assert.equal(auth.session.state().kind, 'authenticated');
    });
  }

  it('register refused for good (phone already registered): the flow ends, the proof is never sent again, "try again" does nothing', async () => {
    const { controller, http } = await setup((call) => (isOtpRequest(call) ? reply(201, issued()) : isVerify(call) ? reply(200, verified()) : reply(409, errorBody('PHONE_ALREADY_REGISTERED'))));
    await controller.begin(FORM);
    const step = await controller.verify('123456');
    assert.equal(step.where, 'register');
    assert.equal(step.code, 'PHONE_ALREADY_REGISTERED');
    assert.equal(step.unresolved, false);
    const view = controller.view();
    assert.equal(view.stage, 'failed');
    assert.equal(view.failure.code, 'PHONE_ALREADY_REGISTERED');
    const again = await controller.retryRegister();
    assert.equal(again.kind, 'failure');
    assert.equal(http.calls.filter(isRegister).length, 1);
  });

  it('"result not replayable" is a definite end that points to sign-in (no new key, no new proof)', async () => {
    const { controller } = await setup((call) => (isOtpRequest(call) ? reply(201, issued()) : isVerify(call) ? reply(200, verified()) : reply(409, errorBody('AUTH_RESULT_NOT_REPLAYABLE'))));
    await controller.begin(FORM);
    const step = await controller.verify('123456');
    assert.equal(step.code, 'RESULT_NOT_REPLAYABLE');
    assert.equal(controller.view().stage, 'failed');
  });

  it('leaving while the register is on its way: the late answer is stale, NO session is established, everything is gone', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const { controller, auth, flows, REGISTER_FLOW } = await setup(async (call) => {
      if (isRegister(call)) {
        await gate;
        return reply(201, signIn());
      }
      return isOtpRequest(call) ? reply(201, issued()) : reply(200, verified());
    });
    await controller.begin(FORM);
    const pending = controller.verify('123456');
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.cancel();
    release();
    assert.equal((await pending).kind, 'stale');
    assert.equal(auth.session.state().kind, 'anonymous', 'a flow the person left cannot sign them in');
    assert.equal(controller.view(), undefined);
    assert.equal(flows.has(REGISTER_FLOW), false);
  });

  it('leaving drops the kept key and body of an unresolved register: the next register is a new intent', async () => {
    let registers = 0;
    const { controller, http } = await setup((call) => {
      if (isOtpRequest(call)) {
        return reply(201, issued());
      }
      if (isVerify(call)) {
        return reply(200, verified());
      }
      registers += 1;
      return registers === 1 ? new Error('lost') : reply(201, signIn());
    });
    await controller.begin(FORM);
    await controller.verify('123456');
    controller.cancel();
    assert.equal(controller.view(), undefined);
    assert.equal((await controller.retryRegister()).kind, 'stale', 'nothing is left to retry');
    await controller.begin(FORM);
    const done = await controller.verify('123456');
    assert.equal(done.kind, 'ok');
    const sent = http.calls.filter(isRegister);
    assert.notEqual(sent[1].headers['idempotency-key'], sent[0].headers['idempotency-key'], 'a new flow, a new key');
  });

  it('leaving while the code is asked for: the answer is stale and opens no flow', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const { controller, flows, REGISTER_FLOW } = await setup(async () => {
      await gate;
      return reply(201, issued());
    });
    const pending = controller.begin(FORM);
    controller.cancel();
    release();
    assert.equal((await pending).kind, 'stale');
    assert.equal(controller.view(), undefined);
    assert.equal(flows.has(REGISTER_FLOW), false);
  });

  it('changing the phone (a new start) drops the old challenge: a verify answer for the old one is stale', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let issuedCount = 0;
    const { controller } = await setup(async (call) => {
      if (isOtpRequest(call)) {
        issuedCount += 1;
        return reply(201, issued(issuedCount === 1 ? CHALLENGE_1 : CHALLENGE_2));
      }
      await gate;
      return reply(200, verified());
    });
    await controller.begin(FORM);
    const oldVerify = controller.verify('123456');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await controller.begin({ ...FORM, phone: '0912345678' });
    release();
    assert.equal((await oldVerify).kind, 'stale');
    const view = controller.view();
    assert.equal(view.phone, '0912345678');
    assert.equal(view.stage, 'otp', 'the old proof did not carry over');
    assert.equal(view.challenge.verificationId, CHALLENGE_2);
  });
});

describe('register flow: resend and rate limits', () => {
  it('a successful resend REPLACES the challenge: the next verify goes to the new id with the new deadlines', async () => {
    let issuedCount = 0;
    const { controller, http } = await setup((call) => {
      if (isOtpRequest(call)) {
        issuedCount += 1;
        return reply(201, issuedCount === 1 ? issued(CHALLENGE_1, 180, 30) : issued(CHALLENGE_2, 120, 30));
      }
      return isVerify(call) ? reply(200, verified()) : reply(201, signIn());
    });
    await controller.begin(FORM);
    const before = controller.view().challenge;
    const again = await controller.resend();
    assert.equal(again.kind, 'ok');
    const after = controller.view().challenge;
    assert.equal(after.verificationId, CHALLENGE_2);
    assert.ok(after.expiresAtMs < before.expiresAtMs, 'the new, shorter server value applies');
    assert.deepEqual(JSON.parse(http.calls[1].body), { phone: PHONE, purpose: 'REGISTER' });
    await controller.verify('123456');
    assert.equal(http.calls.find(isVerify).url.endsWith(`/${CHALLENGE_2}/verify`), true);
  });

  it('429 with Retry-After holds "send again" until then; 429 without it invents NO wait', async () => {
    let n = 0;
    const { controller, http } = await setup((call) => {
      n += 1;
      if (n === 1) {
        return reply(201, issued(CHALLENGE_1, 180, 1));
      }
      if (n === 2) {
        return reply(429, errorBody('OTP_RATE_LIMITED'), { 'retry-after': '90' });
      }
      return reply(429, errorBody('OTP_RATE_LIMITED'));
    });
    await controller.begin(FORM);
    const first = await controller.resend();
    assert.equal(first.code, 'RATE_LIMITED');
    assert.equal(first.retryAfterSeconds, 90);
    const held = controller.view().challenge;
    assert.ok(held.resendAtMs > Date.now() + 85_000 && held.resendAtMs <= Date.now() + 90_500, 'waits for the server value');
    assert.equal(held.verificationId, CHALLENGE_1, 'the old challenge stays');
    const second = await controller.resend();
    assert.equal(second.code, 'RATE_LIMITED');
    assert.equal(second.retryAfterSeconds, undefined);
    assert.equal(controller.view().challenge.resendAtMs, held.resendAtMs, 'no cooldown was made up');
    assert.equal(http.calls.length, 3, 'and nothing was sent by itself');
  });

  it('a refused resend keeps the old challenge valid and the code step open', async () => {
    let n = 0;
    const { controller } = await setup(() => {
      n += 1;
      return n === 1 ? reply(201, issued()) : reply(503, errorBody('SERVICE_UNAVAILABLE'));
    });
    await controller.begin(FORM);
    const result = await controller.resend();
    assert.equal(result.kind, 'failure');
    assert.equal(controller.view().stage, 'otp');
    assert.equal(controller.view().challenge.verificationId, CHALLENGE_1);
    assert.equal(controller.view().busy, false);
  });
});

describe('where the real register flow is switched on', () => {
  it('only on a local https origin: never plain http, never a deployed host', async () => {
    const { isLocalHttpsRuntime } = await load('app.js');
    assert.equal(isLocalHttpsRuntime({ protocol: 'https:', hostname: 'localhost' }), true);
    assert.equal(isLocalHttpsRuntime({ protocol: 'https:', hostname: '127.0.0.1' }), true);
    assert.equal(isLocalHttpsRuntime({ protocol: 'http:', hostname: 'localhost' }), false);
    assert.equal(isLocalHttpsRuntime({ protocol: 'http:', hostname: '127.0.0.1' }), false);
    assert.equal(isLocalHttpsRuntime({ protocol: 'https:', hostname: 'test.11ship.example' }), false);
    assert.equal(isLocalHttpsRuntime({ protocol: 'https:', hostname: 'localhost.evil.example' }), false);
  });
});
