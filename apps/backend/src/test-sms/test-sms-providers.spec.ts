import { describe, expect, it } from '@jest/globals';
import { bindActivationOtpProvider } from '../admin-activation/activation-otp-providers';
import { DEFAULT_ACTIVATION_LIMITS } from '../config/admin-activation-config';
import { StartupConfigError } from '../config/startup-config-error';
import { bindOtpProvider } from '../auth/otp-provider-binding';
import { FakeOtpProvider } from '../auth/fake-otp-provider';
import { TestSmsInbox } from './test-sms-inbox';
import { TestInboxActivationOtpProvider, TestInboxOtpProvider } from './test-sms-providers';

const PHONE = '+84901234567';

function activationConfig(otpMode: 'FAKE' | 'TEST_DISPLAY' | 'TEST_INBOX' | 'SMS'): Parameters<typeof bindActivationOtpProvider>[0] {
  return { phoneVerificationMode: 'REQUIRED', otpMode, providerTimeoutMs: 8000, promoteGraceMs: 10_000, limits: DEFAULT_ACTIVATION_LIMITS };
}

describe('test inbox adapters', () => {
  it('REGISTER resolves only AFTER the append succeeded, into the shared inbox', async () => {
    const inbox = new TestSmsInbox();
    const provider = new TestInboxOtpProvider(inbox);
    await provider.sendRegisterOtp(PHONE, '123456');
    const [message] = inbox.list({ limit: 20 });
    expect(message?.purpose).toBe('REGISTER');
    expect(message?.otp).toBe('123456');
    expect(message?.phoneNormalized).toBe(PHONE);
  });

  it('REGISTER rejects (and stores nothing) when the inbox refuses the message', async () => {
    const inbox = new TestSmsInbox();
    const provider = new TestInboxOtpProvider(inbox);
    await expect(provider.sendRegisterOtp(PHONE, 'abc')).rejects.toThrow();
    expect(inbox.size()).toBe(0);
  });

  it('ADMIN_ACTIVATION answers ACCEPTED after the append and NEVER returns a displayedCode', async () => {
    const inbox = new TestSmsInbox();
    const provider = new TestInboxActivationOtpProvider(inbox);
    const answer = await provider.send(PHONE, '654321');
    expect(answer).toEqual({ outcome: 'ACCEPTED' });
    expect('displayedCode' in answer).toBe(false);
    expect(inbox.list({ limit: 20 })[0]?.purpose).toBe('ADMIN_ACTIVATION');
    expect(provider.mode).toBe('TEST_INBOX');
  });

  it('ADMIN_ACTIVATION rejects (the service maps any exception to UNKNOWN) when the append fails, storing nothing', async () => {
    const inbox = new TestSmsInbox();
    const provider = new TestInboxActivationOtpProvider(inbox);
    await expect(provider.send('0901234567', '123456')).rejects.toThrow();
    expect(inbox.size()).toBe(0);
  });

  it('both adapters feed the SAME inbox instance', async () => {
    const inbox = new TestSmsInbox();
    await new TestInboxOtpProvider(inbox).sendRegisterOtp(PHONE, '111111');
    await new TestInboxActivationOtpProvider(inbox).send(PHONE, '222222');
    expect(inbox.list({ limit: 20 }).map((m) => [m.purpose, m.otp])).toEqual([
      ['ADMIN_ACTIVATION', '222222'],
      ['REGISTER', '111111'],
    ]);
  });

  it('does not change the inbox when a message is only read (reading consumes and resets nothing)', async () => {
    const inbox = new TestSmsInbox();
    await new TestInboxOtpProvider(inbox).sendRegisterOtp(PHONE, '111111');
    const before = inbox.list({ limit: 20 });
    inbox.list({ limit: 20 });
    const first = before[0];
    expect(first === undefined ? undefined : inbox.get(first.messageId)).toEqual(first);
    expect(inbox.list({ limit: 20 })).toEqual(before);
  });
});

describe('bindings keep the previous behaviour and add TEST_INBOX only by explicit adapter (TS08)', () => {
  it('bindOtpProvider: development/test still bind the in-memory fake when no inbox adapter is supplied', () => {
    expect(bindOtpProvider('development')).toBeInstanceOf(FakeOtpProvider);
    expect(bindOtpProvider('test')).toBeInstanceOf(FakeOtpProvider);
  });

  it('bindOtpProvider: the inbox adapter is bound in development/test and refused in staging/production', () => {
    const adapter = new TestInboxOtpProvider(new TestSmsInbox());
    expect(bindOtpProvider('development', { testInboxProvider: adapter })).toBe(adapter);
    expect(bindOtpProvider('test', { testInboxProvider: adapter })).toBe(adapter);
    for (const appEnv of ['staging', 'production'] as const) {
      expect(() => bindOtpProvider(appEnv, { testInboxProvider: adapter })).toThrow(StartupConfigError);
      // Not even the staging fixture mode lets the adapter in: it is refused before anything is opened.
      expect(() => bindOtpProvider(appEnv, { testInboxProvider: adapter, stagingFixtureMode: true })).toThrow(StartupConfigError);
    }
  });

  it('bindActivationOtpProvider: TEST_INBOX needs the adapter; without it startup is refused naming only the variable', () => {
    const adapter = new TestInboxActivationOtpProvider(new TestSmsInbox());
    expect(bindActivationOtpProvider(activationConfig('TEST_INBOX'), { testInboxProvider: adapter })).toBe(adapter);
    try {
      bindActivationOtpProvider(activationConfig('TEST_INBOX'));
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(StartupConfigError);
      expect((error as StartupConfigError).invalid).toEqual(['ADMIN_ACTIVATION_OTP_MODE']);
    }
  });

  it('bindActivationOtpProvider: an adapter never replaces a different explicit mode, and SMS stays refused', () => {
    const adapter = new TestInboxActivationOtpProvider(new TestSmsInbox());
    expect(bindActivationOtpProvider(activationConfig('FAKE'), { testInboxProvider: adapter }).mode).toBe('FAKE');
    expect(bindActivationOtpProvider(activationConfig('TEST_DISPLAY'), { testInboxProvider: adapter }).mode).toBe('TEST_DISPLAY');
    expect(() => bindActivationOtpProvider(activationConfig('SMS'), { testInboxProvider: adapter })).toThrow(StartupConfigError);
  });
});
