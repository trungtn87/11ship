import { describe, expect, it } from '@jest/globals';
import { StartupConfigError } from '../config/startup-config-error';
import { bindActivationOtpProvider, FakeActivationOtpProvider, TestDisplayActivationOtpProvider } from './activation-otp-providers';

const PHONE = '+84901234567';

describe('activation OTP providers and binding', () => {
  it('binds FAKE and TEST_DISPLAY only by explicit mode', () => {
    expect(bindActivationOtpProvider({ otpMode: 'FAKE', providerTimeoutMs: 8000, promoteGraceMs: 10_000 })).toBeInstanceOf(FakeActivationOtpProvider);
    expect(bindActivationOtpProvider({ otpMode: 'TEST_DISPLAY', providerTimeoutMs: 8000, promoteGraceMs: 10_000 })).toBeInstanceOf(
      TestDisplayActivationOtpProvider,
    );
  });

  it('SMS has no adapter: startup is refused naming only the variable, never a fallback to a fake', () => {
    try {
      bindActivationOtpProvider({ otpMode: 'SMS', providerTimeoutMs: 8000, promoteGraceMs: 10_000 });
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(StartupConfigError);
      expect((error as StartupConfigError).invalid).toEqual(['ADMIN_ACTIVATION_OTP_MODE']);
    }
  });

  it('FAKE keeps what it "sent" and scripts outcomes: REJECTED is not sent, UNKNOWN is sent, THROW throws', async () => {
    const fake = new FakeActivationOtpProvider();
    expect(await fake.send(PHONE, '111111')).toEqual({ outcome: 'ACCEPTED' });
    expect(fake.lastOtpFor(PHONE)).toBe('111111');
    fake.script('REJECTED', 'UNKNOWN', 'THROW');
    expect(await fake.send(PHONE, '222222')).toEqual({ outcome: 'REJECTED' });
    expect(fake.lastOtpFor(PHONE)).toBe('111111');
    expect(await fake.send(PHONE, '333333')).toEqual({ outcome: 'UNKNOWN' });
    expect(fake.lastOtpFor(PHONE)).toBe('333333');
    await expect(fake.send(PHONE, '444444')).rejects.toThrow();
    expect(fake.sendStarted()).toBe(5);
    expect(fake.sentCount()).toBe(2);
  });

  it('FAKE can hold a send at a deterministic barrier', async () => {
    const fake = new FakeActivationOtpProvider();
    const release = fake.holdSends();
    const pending = fake.send(PHONE, '555555');
    await Promise.resolve();
    expect(fake.sendStarted()).toBe(1);
    expect(fake.sentCount()).toBe(0);
    release();
    expect(await pending).toEqual({ outcome: 'ACCEPTED' });
    expect(fake.sentCount()).toBe(1);
  });

  it('TEST_DISPLAY hands the code back to the client and keeps nothing', async () => {
    const provider = new TestDisplayActivationOtpProvider();
    expect(await provider.send(PHONE, '666666')).toEqual({ outcome: 'ACCEPTED', displayedCode: '666666' });
  });
});
