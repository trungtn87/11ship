import { describe, expect, it } from '@jest/globals';
import { FakeOtpProvider } from './fake-otp-provider';
import { bindOtpProvider } from './otp-provider-binding';
import { StartupConfigError } from '../config/startup-config-error';

describe('FakeOtpProvider', () => {
  it('keeps what it was asked to send, per phone, newest last', async () => {
    const provider = new FakeOtpProvider();
    await provider.sendRegisterOtp('+84900000001', '111111');
    await provider.sendRegisterOtp('+84900000002', '222222');
    await provider.sendRegisterOtp('+84900000001', '333333');
    expect(provider.lastOtpFor('+84900000001')).toBe('333333');
    expect(provider.lastOtpFor('+84900000002')).toBe('222222');
    expect(provider.lastOtpFor('+84900000003')).toBeUndefined();
    expect(provider.sentCount()).toBe(3);
    provider.clear();
    expect(provider.sentCount()).toBe(0);
  });

  it('can be told to fail the next sends, then recovers', async () => {
    const provider = new FakeOtpProvider();
    provider.failNext(2);
    for (let i = 0; i < 2; i += 1) {
      let failed = false;
      try {
        await provider.sendRegisterOtp('+84900000001', '111111');
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
    }
    await provider.sendRegisterOtp('+84900000001', '444444');
    expect(provider.lastOtpFor('+84900000001')).toBe('444444');
    expect(provider.sentCount()).toBe(1); // failed sends are not recorded as delivered
  });

  it('holds sends at a barrier until released', async () => {
    const provider = new FakeOtpProvider();
    const release = provider.holdSends();
    const pending = provider.sendRegisterOtp('+84900000001', '555555');
    await Promise.resolve();
    expect(provider.sendStarted()).toBe(1);
    expect(provider.sentCount()).toBe(0);
    release();
    await pending;
    expect(provider.sentCount()).toBe(1);
  });

  it('never writes the OTP or the phone anywhere', async () => {
    const written: string[] = [];
    const out = process.stdout.write.bind(process.stdout);
    const err = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: unknown) => (written.push(String(chunk)), true)) as typeof process.stdout.write;
    process.stderr.write = ((chunk: unknown) => (written.push(String(chunk)), true)) as typeof process.stderr.write;
    try {
      await new FakeOtpProvider().sendRegisterOtp('+84977777777', '987654');
    } finally {
      process.stdout.write = out;
      process.stderr.write = err;
    }
    expect(written.join('')).not.toContain('987654');
    expect(written.join('')).not.toContain('977777777');
  });
});

describe('bindOtpProvider (task section 7)', () => {
  it('binds the fake only in development and test', () => {
    expect(bindOtpProvider('development')).toBeInstanceOf(FakeOtpProvider);
    expect(bindOtpProvider('test')).toBeInstanceOf(FakeOtpProvider);
  });

  it('refuses staging and production with a startup error that names only OTP_PROVIDER', () => {
    for (const env of ['staging', 'production'] as const) {
      try {
        bindOtpProvider(env);
        throw new Error('expected a failure');
      } catch (error) {
        expect(error).toBeInstanceOf(StartupConfigError);
        expect((error as StartupConfigError).invalid).toEqual(['OTP_PROVIDER']);
      }
    }
  });
});
