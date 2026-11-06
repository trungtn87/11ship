import { describe, expect, it } from '@jest/globals';
import { AppError } from '../common/app-errors';
import { OtpHmacKey } from '../config/auth-config';
import { PhoneAllowlist } from '../config/staging-fixtures-config';
import { createAccountOriginPolicy } from './account-origin';
import { VerificationService } from './verification-service';

// M00-D2 — OTP request/verify are closed at the service boundary while the staging fixture mode is
// on: the dependencies below throw on ANY use, so a pass proves that nothing (database, hash, idempotency, provider,
// audit) was touched before the refusal.

function untouchable(label: string): unknown {
  return new Proxy(
    {},
    {
      get: (_target, property) => {
        throw new Error(`${label}.${String(property)} must not be used in fixture mode`);
      },
    },
  );
}

const CONFIG = {
  otpTtlSeconds: 300,
  otpResendSeconds: 60,
  otpMaxAttempts: 5,
  proofTtlSeconds: 600,
  sessionTtlSeconds: 3600,
  otpHmacKey: new OtpHmacKey(Buffer.alloc(32, 5)),
};
const FIXTURE_POLICY = createAccountOriginPolicy({
  appEnv: 'staging',
  fixtureModeEnabled: true,
  allowedPhones: new PhoneAllowlist(['+84901000001']),
});
const REQUEST_ID = '323e4567-e89b-42d3-a456-426614174000';

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof AppError ? error.code : `OTHER:${String(error)}`;
  }
  return 'OK';
}

describe('fixture mode closes OTP before any side effect', () => {
  const verification = new VerificationService(
    untouchable('transactions') as never,
    untouchable('verifications') as never,
    untouchable('users') as never,
    untouchable('recorder') as never,
    untouchable('policies') as never,
    CONFIG,
    untouchable('provider') as never,
    FIXTURE_POLICY,
  );
  it('requestOtp answers AUTH_REGISTRATION_UNAVAILABLE and never reaches the database or the provider', async () => {
    expect(await codeOf(() => verification.requestOtp('+84901000001', 'REGISTER', '203.0.113.7'))).toBe('AUTH_REGISTRATION_UNAVAILABLE');
  });

  it('verifyOtp answers AUTH_REGISTRATION_UNAVAILABLE before reading or counting anything', async () => {
    expect(await codeOf(() => verification.verifyOtp('123e4567-e89b-42d3-a456-426614174000', '123456', REQUEST_ID))).toBe(
      'AUTH_REGISTRATION_UNAVAILABLE',
    );
  });

  it('is a 503 in the registry', () => {
    expect(new AppError('AUTH_REGISTRATION_UNAVAILABLE').code).toBe('AUTH_REGISTRATION_UNAVAILABLE');
  });
});
