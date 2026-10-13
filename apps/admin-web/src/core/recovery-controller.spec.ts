import { describe, expect, it } from '@jest/globals';
import { RecoveryController, RecoveryScreen } from './recovery-controller';
import { fail, FakeServer, ok } from './test-support';
import { AdminRecoveryApi } from './recovery-api';

// M01-RESET, ADMIN page: the server's mode decides, one form, one intent = one key, nothing automatic.

const PHONE = '0987654321';
const PASSWORD = 'Mật khẩu mới 12345';

function setup(server: FakeServer) {
  let n = 0;
  const controller = new RecoveryController(new AdminRecoveryApi(server.transport), () => `key-${String(++n)}`);
  const screens: RecoveryScreen[] = [];
  controller.subscribe((screen) => screens.push(screen));
  return { controller, screens };
}

const on = ok({ mode: 'DISABLED_TEST' });

describe('admin recovery page', () => {
  it('shows the form only for a valid DISABLED_TEST answer; UNAVAILABLE and unusable answers keep it closed', async () => {
    const closed = new FakeServer().on('GET', '/config', ok({ mode: 'UNAVAILABLE' }));
    const a = setup(closed);
    await a.controller.start();
    expect(a.controller.screen).toEqual({ name: 'unavailable' });
    await a.controller.submit(PHONE, PASSWORD, PASSWORD);
    expect(closed.count('POST', '/reset-test')).toBe(0);

    for (const answer of [ok({ mode: 'ON' }), ok({ mode: 'DISABLED_TEST', x: 1 }), fail(503, 'SERVICE_UNAVAILABLE'), 'network' as const]) {
      const server = new FakeServer().on('GET', '/config', answer);
      const b = setup(server);
      await b.controller.start();
      expect(b.controller.screen).toEqual({ name: 'config-error' });
      await b.controller.submit(PHONE, PASSWORD, PASSWORD);
      expect(server.requests.filter((request) => request.method === 'POST')).toHaveLength(0);
    }
  });

  it('sends exactly {phone, password} with a key and NO csrf, then shows done; the confirmation is never sent', async () => {
    const server = new FakeServer().on('GET', '/config', on).on('POST', '/reset-test', ok({ next: 'LOGIN' }));
    const { controller } = setup(server);
    await controller.start();
    expect(controller.screen).toEqual({ name: 'test-form', phone: '', pending: false });
    await controller.submit(` ${PHONE} `, PASSWORD, PASSWORD);
    expect(controller.screen).toEqual({ name: 'done' });
    expect(server.requests[1]).toEqual({ method: 'POST', path: '/reset-test', body: { phone: PHONE, password: PASSWORD }, idempotencyKey: 'key-1' });
    expect(JSON.stringify(server.requests[1])).not.toContain('csrf');
  });

  it('refuses a bad phone, a short password and a mismatch locally, without a request', async () => {
    const server = new FakeServer().on('GET', '/config', on);
    const { controller } = setup(server);
    await controller.start();
    await controller.submit('0912', PASSWORD, PASSWORD);
    expect(controller.screen).toMatchObject({ name: 'test-form', phoneError: 'Số điện thoại không hợp lệ.' });
    await controller.submit(PHONE, 'short', 'short');
    expect(controller.screen).toMatchObject({ name: 'test-form', passwordError: 'Mật khẩu cần từ 8 đến 128 ký tự.' });
    await controller.submit(PHONE, PASSWORD, `${PASSWORD}x`);
    expect(controller.screen).toMatchObject({ name: 'test-form', passwordError: 'Hai mật khẩu chưa khớp.' });
    expect(server.count('POST', '/reset-test')).toBe(0);
  });

  it('a lost answer keeps the key: the same form re-sends the SAME request; another password is a new intent', async () => {
    const server = new FakeServer().on('GET', '/config', on).on('POST', '/reset-test', 'network', fail(500, 'INTERNAL_ERROR'), ok({ next: 'LOGIN' }));
    const { controller } = setup(server);
    await controller.start();
    await controller.submit(PHONE, PASSWORD, PASSWORD);
    expect(controller.screen).toMatchObject({ name: 'test-form', failure: 'unknown-outcome', pending: false });
    await controller.submit(PHONE, PASSWORD, PASSWORD);
    expect(controller.screen).toMatchObject({ name: 'test-form', failure: 'unknown-outcome' });
    await controller.submit(PHONE, PASSWORD, PASSWORD);
    expect(controller.screen).toEqual({ name: 'done' });
    const posts = server.requests.filter((request) => request.method === 'POST');
    expect(new Set(posts.map((request) => request.idempotencyKey))).toEqual(new Set(['key-1']));
  });

  it('a definite refusal ends the intent (a new key next time); 429 carries Retry-After; leaving drops the intent', async () => {
    const server = new FakeServer()
      .on('GET', '/config', on)
      .on('POST', '/reset-test', fail(429, 'RATE_LIMITED', { 'retry-after': '30' }), fail(400, 'BAD_REQUEST'), 'network', ok({ next: 'LOGIN' }));
    const { controller } = setup(server);
    await controller.start();
    await controller.submit(PHONE, PASSWORD, PASSWORD);
    expect(controller.screen).toMatchObject({ name: 'test-form', failure: 'rate-limited', retrySec: 30 });
    await controller.submit(PHONE, PASSWORD, PASSWORD);
    expect(controller.screen).toMatchObject({ failure: 'invalid' });
    await controller.submit(PHONE, PASSWORD, PASSWORD);
    controller.leave();
    await controller.submit(PHONE, PASSWORD, PASSWORD);
    const keys = server.requests.filter((request) => request.method === 'POST').map((request) => request.idempotencyKey);
    expect(keys).toEqual(['key-1', 'key-2', 'key-3', 'key-4']);
  });

  it('does not run two submits at once', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const server = new FakeServer().on('GET', '/config', on).on('POST', '/reset-test', gate.then(() => ok({ next: 'LOGIN' })));
    const { controller } = setup(server);
    await controller.start();
    const first = controller.submit(PHONE, PASSWORD, PASSWORD);
    await controller.submit(PHONE, PASSWORD, PASSWORD);
    release?.();
    await first;
    expect(server.count('POST', '/reset-test')).toBe(1);
  });
});
