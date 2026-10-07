import { describe, expect, it } from '@jest/globals';
import { StandaloneAuditRecorder } from '../audit/standalone-audit-recorder';
import { AppError, TechnicalError } from '../common/app-errors';
import { AuthConfig, OtpHmacKey } from '../config/auth-config';
import { fakeTransactions } from './auth-fakes.fixture';
import { computeOtpDigest } from './otp';
import { OtpProvider } from './otp-provider';
import { UserRepository } from './user-repository';
import { VerificationRepository, VerificationRow, VerificationStatus } from './verification-repository';
import { VerificationService } from './verification-service';

const KEY = new OtpHmacKey(Buffer.alloc(32, 5));
const CONFIG: AuthConfig = {
  otpTtlSeconds: 300,
  otpResendSeconds: 60,
  otpMaxAttempts: 5,
  proofTtlSeconds: 600,
  sessionTtlSeconds: 3600,
  otpHmacKey: KEY,
};
const PHONE = '+84987654321';
const REQUEST_ID = '323e4567-e89b-42d3-a456-426614174000';
const NOW = 1_000_000;

interface RequestRig {
  service: VerificationService;
  events: string[];
  inserted: Array<Record<string, unknown>>;
  sent: Array<{ phone: string; otp: string; inTransaction: boolean }>;
}

function requestRig(options: { registered?: boolean; cooldown?: boolean; providerFails?: boolean; markPending?: boolean } = {}): RequestRig {
  const { manager, state } = fakeTransactions(NOW);
  const events: string[] = [];
  const inserted: Array<Record<string, unknown>> = [];
  const sent: RequestRig['sent'] = [];
  const verifications = {
    lockLane: async () => void events.push('lane.lock'),
    hasLiveCooldown: async () => {
      events.push('cooldown');
      return options.cooldown ?? false;
    },
    invalidateLive: async () => void events.push('invalidate'),
    insertPendingDelivery: async (_c: unknown, row: Record<string, unknown>) => {
      events.push('insert');
      inserted.push(row);
    },
    markPending: async () => {
      events.push('mark.pending');
      return options.markPending ?? true;
    },
    markDeliveryFailed: async () => void events.push('mark.failed'),
  } as unknown as VerificationRepository;
  const users = {
    isPhoneRegistered: async () => {
      events.push('registered?');
      return options.registered ?? false;
    },
  } as unknown as UserRepository;
  const provider: OtpProvider = {
    sendRegisterOtp: async (phone, otp) => {
      sent.push({ phone, otp, inTransaction: state.inTransaction });
      events.push('send');
      if (options.providerFails) {
        throw new Error('SECRET_MARKER_PROVIDER_FAILURE');
      }
    },
  };
  const recorder = { recordBestEffort: async () => undefined } as unknown as StandaloneAuditRecorder;
  return { service: new VerificationService(manager, verifications, users, recorder, CONFIG, provider), events, inserted, sent };
}

async function failureOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('VerificationService.requestOtp (task sections 7 and 11)', () => {
  it('commits the PENDING_DELIVERY row, THEN calls the provider outside any transaction, THEN marks PENDING', async () => {
    const r = requestRig();
    const result = await r.service.requestOtp(PHONE, 'REGISTER');
    expect(r.events).toEqual(['lane.lock', 'registered?', 'cooldown', 'invalidate', 'insert', 'send', 'mark.pending']);
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]?.inTransaction).toBe(false);
    expect(result.expires_in_seconds).toBe(300);
    expect(result.resend_after_seconds).toBe(60);
    expect(result.verification_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('stores only the HMAC digest; the plaintext OTP goes to the provider alone', async () => {
    const r = requestRig();
    const result = await r.service.requestOtp(PHONE, 'REGISTER');
    const row = r.inserted[0] as Record<string, unknown>;
    const otp = r.sent[0]?.otp as string;
    expect(otp).toMatch(/^[0-9]{6}$/);
    expect(row.otpDigest).toBe(computeOtpDigest(KEY, result.verification_id, PHONE, 'REGISTER', otp));
    expect(JSON.stringify(row)).not.toContain(otp);
    expect(row).toMatchObject({ phoneNormalized: PHONE, purpose: 'REGISTER', otpTtlSeconds: 300, resendSeconds: 60 });
  });

  it('refuses inside the lane lock when the phone is registered or the cooldown holds, calling no provider', async () => {
    const registered = requestRig({ registered: true });
    const e1 = await failureOf(() => registered.service.requestOtp(PHONE, 'REGISTER'));
    expect((e1 as AppError).code).toBe('PHONE_ALREADY_REGISTERED');
    expect(registered.sent).toHaveLength(0);

    const cooling = requestRig({ cooldown: true });
    const e2 = await failureOf(() => cooling.service.requestOtp(PHONE, 'REGISTER'));
    expect((e2 as AppError).code).toBe('OTP_RATE_LIMITED');
    expect(cooling.events).toEqual(['lane.lock', 'registered?', 'cooldown']);
    expect(cooling.sent).toHaveLength(0);
  });

  it('a provider failure marks DELIVERY_FAILED and surfaces a sanitized 503 with no provider detail', async () => {
    const r = requestRig({ providerFails: true });
    const error = await failureOf(() => r.service.requestOtp(PHONE, 'REGISTER'));
    expect(error).toBeInstanceOf(TechnicalError);
    expect((error as TechnicalError).kind).toBe('unavailable');
    expect((error as TechnicalError).message).not.toContain('SECRET_MARKER_PROVIDER_FAILURE');
    expect(r.events).toEqual(['lane.lock', 'registered?', 'cooldown', 'invalidate', 'insert', 'send', 'mark.failed']);
    expect(r.events).not.toContain('mark.pending');
  });

  it('a challenge superseded while the provider worked is not reported as delivered', async () => {
    const r = requestRig({ markPending: false });
    const error = await failureOf(() => r.service.requestOtp(PHONE, 'REGISTER'));
    expect((error as TechnicalError).kind).toBe('unavailable');
  });
});

interface VerifyRig {
  service: VerificationService;
  events: string[];
  denials: unknown[];
}

function verifyRig(row: Partial<VerificationRow> | undefined, wrongStatus: VerificationStatus = 'PENDING'): VerifyRig {
  const { manager, events } = fakeTransactions(NOW); // the fake clock reports itself as 'clock'
  const denials: unknown[] = [];
  const full: VerificationRow | undefined =
    row === undefined
      ? undefined
      : {
          verificationId: '123e4567-e89b-42d3-a456-426614174000',
          phoneNormalized: PHONE,
          purpose: 'REGISTER',
          otpDigest: computeOtpDigest(KEY, '123e4567-e89b-42d3-a456-426614174000', PHONE, 'REGISTER', '123456'),
          status: 'PENDING',
          attemptCount: 0,
          expiresAtMs: NOW + 60_000,
          ...row,
        };
  const verifications = {
    lockForVerify: async () => {
      events.push('lock');
      return full;
    },
    recordWrongAttempt: async () => {
      events.push('wrong');
      return { status: wrongStatus };
    },
    markVerified: async () => void events.push('verified'),
    insertProof: async () => void events.push('proof'),
  } as unknown as VerificationRepository;
  const recorder = { recordBestEffort: async (entry: unknown) => void denials.push(entry) } as unknown as StandaloneAuditRecorder;
  const provider: OtpProvider = { sendRegisterOtp: async () => undefined };
  return {
    service: new VerificationService(manager, verifications, {} as UserRepository, recorder, CONFIG, provider),
    events,
    denials,
  };
}

const ID = '123e4567-e89b-42d3-a456-426614174000';

async function verifyCode(r: VerifyRig, otp: string): Promise<string> {
  try {
    await r.service.verifyOtp(ID, otp, REQUEST_ID);
  } catch (error) {
    return (error as AppError).code;
  }
  return 'OK';
}

describe('VerificationService.verifyOtp (task section 8)', () => {
  it('a correct OTP verifies and creates the proof in the same transaction', async () => {
    const r = verifyRig({});
    const result = await r.service.verifyOtp(ID, '123456', REQUEST_ID);
    expect(r.events).toEqual(['lock', 'clock', 'verified', 'proof']);
    expect(result.verification_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.purpose).toBe('REGISTER');
    expect(result.expires_in_seconds).toBe(600);
  });

  it('an unknown verification is OTP_INVALID', async () => {
    expect(await verifyCode(verifyRig(undefined), '123456')).toBe('OTP_INVALID');
  });

  it('maps every non-PENDING status to its typed error without counting an attempt', async () => {
    const expected: Array<[VerificationStatus, string]> = [
      ['VERIFIED', 'OTP_ALREADY_USED'],
      ['INVALIDATED', 'OTP_ALREADY_USED'],
      ['LOCKED', 'OTP_RATE_LIMITED'],
      ['PENDING_DELIVERY', 'OTP_INVALID'],
      ['DELIVERY_FAILED', 'OTP_INVALID'],
    ];
    for (const [status, code] of expected) {
      const r = verifyRig({ status });
      expect([status, await verifyCode(r, '123456')]).toEqual([status, code]);
      expect(r.events).not.toContain('wrong');
      expect(r.events).not.toContain('proof');
    }
  });

  it('an expired OTP (equality counts as expired) is OTP_EXPIRED, even with the right code', async () => {
    for (const expiresAtMs of [NOW, NOW - 1]) {
      const r = verifyRig({ expiresAtMs });
      expect(await verifyCode(r, '123456')).toBe('OTP_EXPIRED');
      expect(r.events).toEqual(['lock', 'clock']);
    }
  });

  it('a wrong OTP counts one attempt and answers OTP_INVALID; reaching the maximum answers OTP_RATE_LIMITED with a DENIED audit', async () => {
    const wrong = verifyRig({}, 'PENDING');
    expect(await verifyCode(wrong, '000000')).toBe('OTP_INVALID');
    expect(wrong.events).toEqual(['lock', 'clock', 'wrong']);
    expect(wrong.denials).toHaveLength(0);

    const locking = verifyRig({}, 'LOCKED');
    expect(await verifyCode(locking, '000000')).toBe('OTP_RATE_LIMITED');
    expect(locking.denials).toHaveLength(1);
    expect(locking.denials[0]).toMatchObject({
      requestId: REQUEST_ID,
      action: 'auth.otp_verify.v1',
      outcome: 'DENIED',
      reasonCode: 'OTP_LOCKED',
      resourceType: 'phone_verification',
      resourceId: ID,
    });
    expect(JSON.stringify(locking.denials)).not.toContain('000000');
  });

  it('an attempt on an already LOCKED challenge is denied and audited too', async () => {
    const r = verifyRig({ status: 'LOCKED' });
    expect(await verifyCode(r, '123456')).toBe('OTP_RATE_LIMITED');
    expect(r.denials[0]).toMatchObject({ reasonCode: 'OTP_ALREADY_LOCKED' });
  });
});
