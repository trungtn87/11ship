import { describe, expect, it } from '@jest/globals';
import { parseActivationView, viewFromStepInvalid } from './activation-api';
import { FakeServer, TOKEN, actEnrollment, actError, ok, otpStatus, startedFresh } from './test-support';

describe('admin web 1C client', () => {
  it('start sends only {token}; 201 carries no otp object, 200 may continue with one', async () => {
    const server = new FakeServer().on('POST', '/start', startedFresh(), ok({ state: 'OTP_VERIFIED', expires_at: '2999-01-01T00:00:00.000Z', csrf_token: 'c', restart_required: false }));
    const api = server.activationApi();
    expect(await api.start(TOKEN)).toEqual({ kind: 'ok', data: { state: 'STARTED', expiresAt: '2999-01-01T00:00:00.000Z', csrfToken: 'csrf-act-1', phoneVerificationMode: 'REQUIRED', restartRequired: false } });
    expect((await api.start(TOKEN)).kind).toBe('ok');
    expect(server.requests[0]).toEqual({ method: 'POST', path: '/start', body: { token: TOKEN } });
  });

  it('every other call carries the ACTIVATION csrf and the documented body', async () => {
    const server = new FakeServer()
      .on('POST', '/otp/request', { status: 202, body: { data: { resend_at: '2999-01-01T00:00:00.000Z', delivery: 'SUBMITTED' } } })
      .on('POST', '/otp/verify', ok({ state: 'OTP_VERIFIED' }))
      .on('POST', '/password', ok({ state: 'PASSWORD_SET' }))
      .on('POST', '/totp/enrollment', actEnrollment())
      .on('POST', '/complete', ok({ state: 'COMPLETED', next: 'LOGIN' }))
      .on('POST', '/restart', startedFresh());
    const api = server.activationApi();
    await api.requestOtp('c1');
    await api.verifyOtp('c2', '000012');
    await api.setPassword('c3', 'pw-12345678');
    await api.enrollment('c4');
    await api.complete('c5', '000001');
    await api.restart('c6');
    expect(server.requests).toEqual([
      { method: 'POST', path: '/otp/request', body: {}, csrf: 'c1' },
      { method: 'POST', path: '/otp/verify', body: { code: '000012' }, csrf: 'c2' },
      { method: 'POST', path: '/password', body: { password: 'pw-12345678' }, csrf: 'c3' },
      { method: 'POST', path: '/totp/enrollment', body: {}, csrf: 'c4' },
      { method: 'POST', path: '/complete', body: { code: '000001' }, csrf: 'c5' },
      { method: 'POST', path: '/restart', body: {}, csrf: 'c6' },
    ]);
  });

  it('parses every GET /state shape and rejects unknown ones', () => {
    expect(parseActivationView({ state: 'COMPLETED', next: 'LOGIN' })).toEqual({ state: 'COMPLETED' });
    expect(parseActivationView({ state: 'INVALIDATED', reason: 'REPLACED', can_restart: false })).toEqual({ state: 'INVALIDATED', reason: 'REPLACED', canRestart: false });
    expect(parseActivationView({ state: 'INVALIDATED', reason: 'WHATEVER' })).toBeUndefined();
    expect(parseActivationView({ state: 'NOPE' })).toBeUndefined();
    expect(parseActivationView({ state: 'STARTED', expires_at: 'x', otp: { status: 'BOGUS' } })).toBeUndefined();
    expect(parseActivationView({ state: 'TOTP_ISSUED', expires_at: 'x', csrf_token: 'c', totp_attempts_left: 4 })).toEqual({ state: 'TOTP_ISSUED', expiresAt: 'x', csrfToken: 'c', totpAttemptsLeft: 4 });
  });

  it('keeps displayed_code only when present, and error.details of STEP_INVALID', async () => {
    const server = new FakeServer()
      .on('POST', '/otp/request', { status: 202, body: { data: { resend_at: 'r', delivery: 'SUBMITTED', displayed_code: '042042' } } })
      .on('POST', '/otp/verify', actError(409, 'ADMIN_ACTIVATION_STEP_INVALID', { state: 'PASSWORD_SET', expires_at: 'e' }))
      .on('POST', '/password', actError(400, 'ADMIN_INPUT_INVALID'));
    const api = server.activationApi();
    expect(await api.requestOtp('c')).toEqual({ kind: 'ok', data: { resendAt: 'r', displayedCode: '042042' } });
    const invalid = await api.verifyOtp('c', '123456');
    expect(invalid.kind === 'error' && viewFromStepInvalid(invalid.details)).toEqual({ state: 'PASSWORD_SET', expiresAt: 'e' });
    const plain = await api.setPassword('c', 'x');
    expect(plain).toEqual({ kind: 'error', status: 400, code: 'ADMIN_INPUT_INVALID' }); // empty details are not reported
    expect(otpStatus('NONE').status).toBe(200);
  });

  it('refuses an enrollment answer that is not an otpauth URI', async () => {
    const server = new FakeServer().on('POST', '/totp/enrollment', ok({ state: 'TOTP_ISSUED', otpauth_uri: 'https://x', secret: 'S' }));
    expect((await server.activationApi().enrollment('c')).kind).toBe('network');
  });

  it('phone_verification_mode: absent means REQUIRED, DISABLED_TEST is read, an unknown value is refused', () => {
    expect(parseActivationView({ state: 'STARTED', expires_at: 'x', otp: { status: 'NONE' } })).toMatchObject({ phoneVerificationMode: 'REQUIRED' });
    expect(parseActivationView({ state: 'STARTED', expires_at: 'x', phone_verification_mode: 'REQUIRED', otp: { status: 'NONE' } })).toMatchObject({
      phoneVerificationMode: 'REQUIRED',
    });
    expect(
      parseActivationView({ state: 'STARTED', expires_at: 'x', phone_verification_mode: 'DISABLED_TEST', password_deadline: 'd', restart_required: true }),
    ).toMatchObject({ state: 'STARTED', phoneVerificationMode: 'DISABLED_TEST', passwordDeadline: 'd', restartRequired: true });
    expect(parseActivationView({ state: 'STARTED', expires_at: 'x', phone_verification_mode: 'SKIP' })).toBeUndefined();
    expect(parseActivationView({ state: 'OTP_VERIFIED', phone_verification_mode: 7 })).toBeUndefined();
  });
});
