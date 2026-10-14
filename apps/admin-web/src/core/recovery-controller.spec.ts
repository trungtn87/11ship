import { describe, expect, it } from '@jest/globals';
import { RecoveryController, RecoveryScreen } from './recovery-controller';
import { fail, FakeServer, ok } from './test-support';
import { AdminRecoveryApi } from './recovery-api';

// M01-RESET, ADMIN page (issue #102): the server's mode decides; phone -> SMS code -> new password; one reset intent = one key.

const PHONE = '0987654321';
const PASSWORD = 'Mật khẩu mới 12345';
const ID = '44444444-4444-4444-8444-444444444444';
const PROOF = 'RESET-PROOF-TOKEN-0123456789';

function setup(server: FakeServer) {
  let n = 0;
  const controller = new RecoveryController(new AdminRecoveryApi(server.transport), () => `key-${String(++n)}`);
  const screens: RecoveryScreen[] = [];
  controller.subscribe((screen) => screens.push(screen));
  return { controller, screens };
}

const on = ok({ mode: 'SMS_OTP' });
const sent = ok({ verification_id: ID, expires_in_seconds: 300, resend_after_seconds: 60 });
const proof = ok({ verification_token: PROOF, purpose: 'RESET_PASSWORD', expires_in_seconds: 600 });

describe('admin recovery page (SMS_OTP)', () => {
  it('opens only for SMS_OTP; UNAVAILABLE, the old test mode and unusable answers keep it closed and nothing is sent', async () => {
    const closed = new FakeServer().on('GET', '/config', ok({ mode: 'UNAVAILABLE' }));
    const a = setup(closed);
    await a.controller.start();
    expect(a.controller.screen).toEqual({ name: 'unavailable' });
    await a.controller.sendCode(PHONE);
    expect(closed.requests.filter((request) => request.method === 'POST')).toHaveLength(0);

    for (const answer of [ok({ mode: 'DISABLED_TEST' }), ok({ mode: 'SMS_OTP', x: 1 }), fail(503, 'SERVICE_UNAVAILABLE'), 'network' as const]) {
      const server = new FakeServer().on('GET', '/config', answer);
      const b = setup(server);
      await b.controller.start();
      expect(b.controller.screen).toEqual({ name: 'config-error' });
      await b.controller.sendCode(PHONE);
      await b.controller.setPassword(PASSWORD);
      expect(server.requests.filter((request) => request.method === 'POST')).toHaveLength(0);
    }
  });

  it('walks phone -> code -> password -> done with exact bodies, a key and NO csrf; the proof goes only to /reset', async () => {
    const server = new FakeServer()
      .on('GET', '/config', on)
      .on('POST', '/otp', sent)
      .on('POST', `/otp/${ID}/verify`, proof)
      .on('POST', '/reset', ok({ next: 'LOGIN' }));
    const { controller } = setup(server);
    await controller.start();
    expect(controller.screen).toEqual({ name: 'phone', phone: '', pending: false });
    await controller.sendCode(` ${PHONE} `);
    expect(controller.screen).toMatchObject({ name: 'otp', pending: false, resendSec: 60 });
    await controller.verify('123456');
    expect(controller.screen).toEqual({ name: 'password', pending: false });
    await controller.setPassword(PASSWORD);
    expect(controller.screen).toEqual({ name: 'done' });
    expect(server.requests.filter((request) => request.method === 'POST')).toEqual([
      { method: 'POST', path: '/otp', body: { phone: PHONE } },
      { method: 'POST', path: `/otp/${ID}/verify`, body: { otp: '123456' } },
      { method: 'POST', path: '/reset', body: { verification_token: PROOF, password: PASSWORD }, idempotencyKey: 'key-1' },
    ]);
    expect(JSON.stringify(server.requests)).not.toContain('csrf');
  });

  it('refuses a bad phone and a short password locally; a wrong code stays on the code step', async () => {
    const server = new FakeServer().on('GET', '/config', on).on('POST', '/otp', sent).on('POST', `/otp/${ID}/verify`, fail(400, 'OTP_INVALID'));
    const { controller } = setup(server);
    await controller.start();
    await controller.sendCode('0912');
    expect(controller.screen).toMatchObject({ name: 'phone', phoneError: 'Số điện thoại không hợp lệ.' });
    expect(server.count('POST', '/otp')).toBe(0);
    await controller.sendCode(PHONE);
    await controller.verify('000000');
    expect(controller.screen).toMatchObject({ name: 'otp', codeError: 'invalid', pending: false });
    await controller.setPassword(PASSWORD);
    expect(server.count('POST', '/reset')).toBe(0);
  });

  it('honest failures: gateway not ready (503) and rate limit (429) are shown, nothing is claimed as sent', async () => {
    const server = new FakeServer().on('GET', '/config', on).on('POST', '/otp', fail(503, 'SERVICE_UNAVAILABLE'), fail(429, 'OTP_RATE_LIMITED', { 'retry-after': '120' }));
    const { controller } = setup(server);
    await controller.start();
    await controller.sendCode(PHONE);
    expect(controller.screen).toMatchObject({ name: 'phone', phoneError: 'Chưa gửi được mã. Vui lòng thử lại sau.' });
    await controller.sendCode(PHONE);
    expect(controller.screen).toEqual({ name: 'rate-limited', retrySec: 120 });
  });

  it('a lost answer on /reset keeps the key: the same form re-sends the SAME request; a refused proof ends the intent', async () => {
    const server = new FakeServer()
      .on('GET', '/config', on)
      .on('POST', '/otp', sent)
      .on('POST', `/otp/${ID}/verify`, proof)
      .on('POST', '/reset', 'network', ok({ next: 'LOGIN' }));
    const { controller } = setup(server);
    await controller.start();
    await controller.sendCode(PHONE);
    await controller.verify('123456');
    await controller.setPassword(PASSWORD);
    expect(controller.screen).toMatchObject({ name: 'password', pending: false });
    await controller.setPassword(PASSWORD);
    expect(controller.screen).toEqual({ name: 'done' });
    const keys = server.requests.filter((request) => request.path === '/reset').map((request) => request.idempotencyKey);
    expect(keys).toEqual(['key-1', 'key-1']);

    const refused = new FakeServer().on('GET', '/config', on).on('POST', '/otp', sent).on('POST', `/otp/${ID}/verify`, proof).on('POST', '/reset', fail(409, 'VERIFICATION_PROOF_USED'));
    const r = setup(refused);
    await r.controller.start();
    await r.controller.sendCode(PHONE);
    await r.controller.verify('123456');
    await r.controller.setPassword(PASSWORD);
    expect(r.controller.screen).toMatchObject({ name: 'phone', phoneError: expect.stringContaining('không còn hiệu lực') });
    await r.controller.setPassword(PASSWORD);
    expect(refused.count('POST', '/reset')).toBe(1);
  });

  it('leaving drops the proof and the intent', async () => {
    const server = new FakeServer().on('GET', '/config', on).on('POST', '/otp', sent).on('POST', `/otp/${ID}/verify`, proof).on('POST', '/reset', 'network');
    const { controller } = setup(server);
    await controller.start();
    await controller.sendCode(PHONE);
    await controller.verify('123456');
    await controller.setPassword(PASSWORD);
    controller.leave();
    await controller.setPassword(PASSWORD);
    expect(server.count('POST', '/reset')).toBe(1);
  });
});
