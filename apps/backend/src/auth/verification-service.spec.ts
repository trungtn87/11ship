import { describe, expect, it } from '@jest/globals';
import { StandaloneAuditRecorder } from '../audit/standalone-audit-recorder';
import { AppError, OtpRefusalError, TechnicalError } from '../common/app-errors';
import { AuthConfig, OtpHmacKey } from '../config/auth-config';
import { fakeTransactions } from './auth-fakes.fixture';
import { computeOtpDigest } from './otp';
import { OtpProvider } from './otp-provider';
import { OtpPolicy, OtpPolicyRepository } from './otp-policy-repository';
import { SystemSettingsReader } from '../system-settings/system-settings-reader';
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
const IP = '203.0.113.7';

const DEFAULT_POLICY: OtpPolicy = {
  values: { cooldown_seconds: 60, max_wrong_attempts: 3, phone_per_hour: 3, phone_per_day: 5, ip_per_hour: 10, global_per_day: 30 },
  version: 1,
  updatedAtMs: NOW,
  updatedBy: null,
};

interface RequestRig {
  service: VerificationService;
  events: string[];
  inserted: Array<Record<string, unknown>>;
  sent: Array<{ phone: string; otp: string; inTransaction: boolean }>;
}

function requestRig(
  options: {
    registered?: boolean;
    lockReason?: 'DELETE_REQUEST' | 'VIOLATION';
    registrationOtpOff?: boolean;
    /** Seconds left of a running shared cooldown. */
    cooldown?: number;
    phoneHour?: number;
    phoneDay?: number;
    ipHour?: number;
    policy?: OtpPolicy;
    providerFails?: boolean;
    providerError?: Error;
    markPending?: boolean;
  } = {},
): RequestRig {
  const { manager, state } = fakeTransactions(NOW);
  const events: string[] = [];
  const inserted: Array<Record<string, unknown>> = [];
  const sent: RequestRig['sent'] = [];
  const verifications = {
    lockLane: async () => void events.push('lane.lock'),
    cooldownRemainingSeconds: async (_c: unknown, _phone: string, seconds: number) => {
      events.push(`cooldown:${String(seconds)}`);
      return options.cooldown;
    },
    countPhoneChallenges: async (_c: unknown, _phone: string, window: number) => {
      events.push(`phone.count:${String(window)}`);
      return window === 3600 ? (options.phoneHour ?? 0) : (options.phoneDay ?? 0);
    },
    phoneRetryAfter: async () => 120,
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
  const policies = {
    read: async () => {
      events.push('policy');
      return options.policy ?? DEFAULT_POLICY;
    },
    lockIp: async () => void events.push('ip.lock'),
    countIpSince: async () => {
      events.push('ip.count');
      return options.ipHour ?? 0;
    },
    ipRetryAfter: async () => 900,
    insertIpRequest: async () => void events.push('ip.insert'),
    pruneIpRequests: async () => void events.push('ip.prune'),
  } as unknown as OtpPolicyRepository;
  const users = {
    isPhoneRegistered: async () => {
      events.push('registered?');
      return options.registered ?? false;
    },
    findByPhone: async () =>
      options.lockReason === undefined ? { status: 'ACTIVE' } : { status: 'DISABLED', lockReason: options.lockReason },
  } as unknown as UserRepository;
  const systemSettings = {
    registrationOtpRequired: async () => {
      events.push('setting.registration');
      return options.registrationOtpOff !== true;
    },
  } as unknown as SystemSettingsReader;
  const provider: OtpProvider = {
    sendRegisterOtp: async (phone, otp) => {
      sent.push({ phone, otp, inTransaction: state.inTransaction });
      events.push('send');
      if (options.providerError !== undefined) {
        throw options.providerError;
      }
      if (options.providerFails) {
        throw new Error('SECRET_MARKER_PROVIDER_FAILURE');
      }
    },
  };
  const recorder = { recordBestEffort: async () => undefined } as unknown as StandaloneAuditRecorder;
  return { service: new VerificationService(manager, verifications, users, recorder, policies, CONFIG, provider, undefined, systemSettings), events, inserted, sent };
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
    const result = await r.service.requestOtp(PHONE, 'REGISTER', IP);
    expect(r.events).toEqual(['setting.registration', 'lane.lock', 'registered?', 'policy', 'cooldown:60', 'phone.count:3600', 'phone.count:86400', 'ip.lock', 'ip.count', 'ip.insert', 'ip.prune', 'invalidate', 'insert', 'send', 'mark.pending']);
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]?.inTransaction).toBe(false);
    expect(result.expires_in_seconds).toBe(300);
    expect(result.resend_after_seconds).toBe(60);
    expect(result.verification_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('stores only the HMAC digest; the plaintext OTP goes to the provider alone', async () => {
    const r = requestRig();
    const result = await r.service.requestOtp(PHONE, 'REGISTER', IP);
    const row = r.inserted[0] as Record<string, unknown>;
    const otp = r.sent[0]?.otp as string;
    expect(otp).toMatch(/^[0-9]{6}$/);
    expect(row.otpDigest).toBe(computeOtpDigest(KEY, result.verification_id, PHONE, 'REGISTER', otp));
    expect(JSON.stringify(row)).not.toContain(otp);
    expect(row).toMatchObject({ phoneNormalized: PHONE, purpose: 'REGISTER', otpTtlSeconds: 300, resendSeconds: 60 });
  });

  it('refuses inside the lane lock when the phone is registered or the cooldown holds, calling no provider', async () => {
    const registered = requestRig({ registered: true });
    const e1 = await failureOf(() => registered.service.requestOtp(PHONE, 'REGISTER', IP));
    expect((e1 as AppError).code).toBe('PHONE_ALREADY_REGISTERED');
    expect(registered.sent).toHaveLength(0);

    const cooling = requestRig({ cooldown: 41 });
    const e2 = await failureOf(() => cooling.service.requestOtp(PHONE, 'REGISTER', IP));
    expect((e2 as AppError).code).toBe('OTP_RATE_LIMITED');
    expect((e2 as OtpRefusalError).details).toEqual({ reason: 'COOLDOWN', retry_after_seconds: 41 });
    expect((e2 as OtpRefusalError).retryAfterSeconds).toBe(41);
    expect(cooling.events).toEqual(['setting.registration', 'lane.lock', 'registered?', 'policy', 'cooldown:60']);
    expect(cooling.sent).toHaveLength(0);
  });

  it('reads the limits from the policy on EVERY request, so a change by SYSTEM applies at once', async () => {
    const changed = requestRig({ policy: { ...DEFAULT_POLICY, values: { ...DEFAULT_POLICY.values, cooldown_seconds: 90 } } });
    const result = await changed.service.requestOtp(PHONE, 'REGISTER', IP);
    expect(changed.events).toContain('cooldown:90');
    expect(result.resend_after_seconds).toBe(90);
    expect(changed.inserted[0]).toMatchObject({ resendSeconds: 90 });
  });

  it.each([
    ['PHONE_HOUR', { phoneHour: 3 }],
    ['PHONE_DAY', { phoneDay: 5 }],
    ['IP_HOUR', { ipHour: 10 }],
  ] as const)('refuses at the %s limit before any challenge is written, with the reason and a retry time', async (reason, options) => {
    const r = requestRig(options);
    const error = await failureOf(() => r.service.requestOtp(PHONE, 'REGISTER', IP));
    expect((error as AppError).code).toBe('OTP_RATE_LIMITED');
    expect((error as OtpRefusalError).details.reason).toBe(reason);
    expect((error as OtpRefusalError).retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(r.events).not.toContain('insert');
    expect(r.events).not.toContain('ip.insert');
    expect(r.sent).toHaveLength(0);
  });

  it('just below every limit is accepted, and the limits come from the policy (a lowered phone hour limit refuses at 1)', async () => {
    const ok = requestRig({ phoneHour: 2, phoneDay: 4, ipHour: 9 });
    await ok.service.requestOtp(PHONE, 'REGISTER', IP);
    expect(ok.sent).toHaveLength(1);
    const lowered = requestRig({ phoneHour: 1, policy: { ...DEFAULT_POLICY, values: { ...DEFAULT_POLICY.values, phone_per_hour: 1 } } });
    expect(((await failureOf(() => lowered.service.requestOtp(PHONE, 'REGISTER', IP))) as OtpRefusalError).details.reason).toBe('PHONE_HOUR');
  });

  it('stores only an HMAC of the client address identity, never the address', async () => {
    const r = requestRig();
    await r.service.requestOtp(PHONE, 'REGISTER', IP);
    expect(JSON.stringify(r.inserted)).not.toContain(IP);
  });

  it('the whole-gateway daily cap hit at the queue is a 429 (not a 503), the challenge is closed and no code is reported', async () => {
    const r = requestRig({ providerError: new OtpRefusalError('OTP_RATE_LIMITED', { reason: 'GLOBAL_DAY' }) });
    const error = await failureOf(() => r.service.requestOtp(PHONE, 'REGISTER', IP));
    expect((error as OtpRefusalError).details).toEqual({ reason: 'GLOBAL_DAY' });
    expect(r.events).toContain('mark.failed');
    expect(r.events).not.toContain('mark.pending');
  });

  it('a phone whose account was locked at its owner\'s request is told to recover it; one locked for another reason is plainly registered', async () => {
    const recoverable = requestRig({ registered: true, lockReason: 'DELETE_REQUEST' });
    expect(((await failureOf(() => recoverable.service.requestOtp(PHONE, 'REGISTER', IP))) as AppError).code).toBe('ACCOUNT_RECOVERY_AVAILABLE');
    expect(recoverable.sent).toHaveLength(0);
    const violation = requestRig({ registered: true, lockReason: 'VIOLATION' });
    expect(((await failureOf(() => violation.service.requestOtp(PHONE, 'REGISTER', IP))) as AppError).code).toBe('PHONE_ALREADY_REGISTERED');
    expect(violation.sent).toHaveLength(0);
  });

  it('SYSTEM turned the registration OTP off: no challenge, no provider call, no row', async () => {
    const off = requestRig({ registrationOtpOff: true });
    const error = await failureOf(() => off.service.requestOtp(PHONE, 'REGISTER', IP));
    expect((error as AppError).code).toBe('PHONE_VERIFICATION_NOT_REQUIRED');
    expect(off.events).toEqual(['setting.registration']);
    expect(off.inserted).toHaveLength(0);
    expect(off.sent).toHaveLength(0);
  });

  it('a provider failure marks DELIVERY_FAILED and surfaces a sanitized 503 with no provider detail', async () => {
    const r = requestRig({ providerFails: true });
    const error = await failureOf(() => r.service.requestOtp(PHONE, 'REGISTER', IP));
    expect(error).toBeInstanceOf(TechnicalError);
    expect((error as TechnicalError).kind).toBe('unavailable');
    expect((error as TechnicalError).message).not.toContain('SECRET_MARKER_PROVIDER_FAILURE');
    expect(r.events).toEqual(['setting.registration', 'lane.lock', 'registered?', 'policy', 'cooldown:60', 'phone.count:3600', 'phone.count:86400', 'ip.lock', 'ip.count', 'ip.insert', 'ip.prune', 'invalidate', 'insert', 'send', 'mark.failed']);
    expect(r.events).not.toContain('mark.pending');
  });

  it('a challenge superseded while the provider worked is not reported as delivered', async () => {
    const r = requestRig({ markPending: false });
    const error = await failureOf(() => r.service.requestOtp(PHONE, 'REGISTER', IP));
    expect((error as TechnicalError).kind).toBe('unavailable');
  });
});

interface VerifyRig {
  service: VerificationService;
  events: string[];
  denials: unknown[];
}

function verifyRig(row: Partial<VerificationRow> | undefined, wrongStatus: VerificationStatus = 'PENDING', wrongCount = 1): VerifyRig {
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
    recordWrongAttempt: async (_c: unknown, _id: string, max: number) => {
      events.push(`wrong:${String(max)}`);
      return { status: wrongStatus, attemptCount: wrongCount };
    },
    markVerified: async () => void events.push('verified'),
    insertProof: async () => void events.push('proof'),
  } as unknown as VerificationRepository;
  const recorder = { recordBestEffort: async (entry: unknown) => void denials.push(entry) } as unknown as StandaloneAuditRecorder;
  const provider: OtpProvider = { sendRegisterOtp: async () => undefined };
  const policies = { read: async () => DEFAULT_POLICY } as unknown as OtpPolicyRepository;
  return {
    service: new VerificationService(manager, verifications, {} as UserRepository, recorder, policies, CONFIG, provider),
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
      ['LOCKED', 'OTP_LOCKED'],
      ['PENDING_DELIVERY', 'OTP_INVALID'],
      ['DELIVERY_FAILED', 'OTP_INVALID'],
    ];
    for (const [status, code] of expected) {
      const r = verifyRig({ status });
      expect([status, await verifyCode(r, '123456')]).toEqual([status, code]);
      expect(r.events.some((event) => event.startsWith('wrong'))).toBe(false);
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

  it('a wrong OTP counts one attempt and says how many are left (2, then 1); reaching the maximum answers OTP_LOCKED, not the send quota, with a DENIED audit', async () => {
    const wrong = verifyRig({}, 'PENDING', 1);
    expect(await verifyCode(wrong, '000000')).toBe('OTP_INVALID');
    expect(wrong.events).toEqual(['lock', 'clock', 'wrong:3']);
    expect(wrong.denials).toHaveLength(0);
    for (const [count, left] of [[1, 2], [2, 1]] as const) {
      const r = verifyRig({}, 'PENDING', count);
      const error = await r.service.verifyOtp(ID, '000000', REQUEST_ID).catch((e: unknown) => e);
      expect((error as OtpRefusalError).details).toEqual({ attempts_remaining: left });
    }

    const locking = verifyRig({}, 'LOCKED', 3);
    expect(await verifyCode(locking, '000000')).toBe('OTP_LOCKED');
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
    expect(await verifyCode(r, '123456')).toBe('OTP_LOCKED');
    expect(r.denials[0]).toMatchObject({ reasonCode: 'OTP_ALREADY_LOCKED' });
  });
});
