import { describe, expect, it } from '@jest/globals';
import { DEFAULT_ACTIVATION_LIMITS } from '../config/admin-activation-config';
import { AttemptRow, ChallengeRow } from './admin-activation-repository';
import { otpStatusOf, stateBody as stateBodyWith, stateGetsCsrf, wireReason, ViewInput } from './admin-activation-views';

const PASSWORD_DEADLINE_MS = DEFAULT_ACTIVATION_LIMITS.passwordDeadlineSeconds * 1000;
const stateBody = (input: ViewInput, csrf: string | undefined): ReturnType<typeof stateBodyWith> => stateBodyWith(input, csrf, PASSWORD_DEADLINE_MS);

const NOW = 1_800_000_000_000;

function attempt(overrides: Partial<AttemptRow> = {}): AttemptRow {
  return {
    attemptId: 'a',
    invitationId: 'i',
    generationId: 'g',
    userId: 'u',
    factorId: 'f',
    tokenDigest: 'd',
    csrfNonce: Buffer.alloc(32),
    csrfKeyId: 'k1',
    status: 'STARTED',
    phoneVerificationMode: 'REQUIRED',
    invalidatedReason: null,
    otpVerifiedAtMs: null,
    passwordHash: null,
    passwordSetAtMs: null,
    totpKeyId: null,
    totpEnvelope: null,
    totpIssuedAtMs: null,
    totpAttemptCount: 0,
    createdAtMs: NOW - 60_000,
    expiresAtMs: NOW + 600_000,
    completedAtMs: null,
    invalidatedAtMs: null,
    ...overrides,
  };
}

function challenge(overrides: Partial<ChallengeRow> = {}): ChallengeRow {
  return {
    challengeId: 'c',
    attemptId: 'a',
    phoneNormalized: '+84901234567',
    otpDigest: 'x',
    digestKeyId: 'k1',
    status: 'PENDING',
    attemptCount: 0,
    createdAtMs: NOW - 10_000,
    expiresAtMs: NOW + 290_000,
    resendNotBeforeMs: NOW + 50_000,
    verifiedAtMs: null,
    endedAtMs: null,
    ...overrides,
  };
}

const invitation = { status: 'PENDING', expiresAtMs: NOW + 3_600_000 };

describe('activation state view (contract 6.3, 6.1.1)', () => {
  it('otp.status follows the NEWEST challenge in any status', () => {
    expect(otpStatusOf(undefined, NOW)).toBe('NONE');
    expect(otpStatusOf(challenge(), NOW)).toBe('SUBMITTED');
    expect(otpStatusOf(challenge({ status: 'PENDING_DELIVERY' }), NOW)).toBe('SUBMITTED');
    expect(otpStatusOf(challenge({ expiresAtMs: NOW }), NOW)).toBe('EXPIRED');
    expect(otpStatusOf(challenge({ status: 'LOCKED', attemptCount: 5 }), NOW)).toBe('LOCKED');
    expect(otpStatusOf(challenge({ status: 'DELIVERY_FAILED' }), NOW)).toBe('FAILED');
    expect(otpStatusOf(challenge({ status: 'INVALIDATED' }), NOW)).toBe('NONE');
  });

  it('only live attempts and ATTEMPTS_EXHAUSTED get a CSRF token', () => {
    for (const status of ['STARTED', 'OTP_VERIFIED', 'PASSWORD_SET', 'TOTP_ISSUED'] as const) {
      expect(stateGetsCsrf(attempt({ status }))).toBe(true);
    }
    expect(stateGetsCsrf(attempt({ status: 'COMPLETED' }))).toBe(false);
    for (const reason of ['SUPERSEDED', 'INVITATION_CLOSED', 'PHONE_CONFLICT'] as const) {
      expect(stateGetsCsrf(attempt({ status: 'INVALIDATED', invalidatedReason: reason }))).toBe(false);
    }
    expect(stateGetsCsrf(attempt({ status: 'INVALIDATED', invalidatedReason: 'ATTEMPTS_EXHAUSTED' }))).toBe(true);
  });

  it('STARTED shows the OTP block with resend_at and attempts_left only while a code is submitted', () => {
    const none = stateBody({ attempt: attempt(), newestChallenge: undefined, invitation, nowMs: NOW }, 'csrf');
    expect(none).toMatchObject({ state: 'STARTED', otp: { status: 'NONE' }, csrf_token: 'csrf' });
    const sent = stateBody({ attempt: attempt(), newestChallenge: challenge({ attemptCount: 2 }), invitation, nowMs: NOW }, undefined);
    expect(sent.otp).toEqual({ status: 'SUBMITTED', delivery: 'SENT', resend_at: new Date(NOW + 50_000).toISOString(), attempts_left: 3 });
    expect(sent.csrf_token).toBeUndefined();
  });

  it('OTP_VERIFIED reports the password deadline and restart_required strictly after it', () => {
    const verifiedAt = NOW - PASSWORD_DEADLINE_MS;
    const atDeadline = stateBody({ attempt: attempt({ status: 'OTP_VERIFIED', otpVerifiedAtMs: verifiedAt }), newestChallenge: undefined, invitation, nowMs: NOW }, undefined);
    expect(atDeadline).toMatchObject({ state: 'OTP_VERIFIED', restart_required: false, password_deadline: new Date(NOW).toISOString() });
    const after = stateBody({ attempt: attempt({ status: 'OTP_VERIFIED', otpVerifiedAtMs: verifiedAt - 1 }), newestChallenge: undefined, invitation, nowMs: NOW }, undefined);
    expect(after.restart_required).toBe(true);
  });

  it('TOTP_ISSUED counts the attempts left; COMPLETED points to the login and has no expiry', () => {
    const issued = stateBody({ attempt: attempt({ status: 'TOTP_ISSUED', totpAttemptCount: 3 }), newestChallenge: undefined, invitation, nowMs: NOW }, undefined);
    expect(issued).toMatchObject({ state: 'TOTP_ISSUED', totp_attempts_left: 2 });
    const completed = stateBody({ attempt: attempt({ status: 'COMPLETED' }), newestChallenge: undefined, invitation, nowMs: NOW }, 'csrf');
    expect(completed).toEqual({ state: 'COMPLETED', next: 'LOGIN' });
  });

  it('INVALIDATED reasons map to the wire reasons and can_restart needs ATTEMPTS_EXHAUSTED plus an open invitation', () => {
    expect(wireReason('SUPERSEDED')).toBe('REPLACED');
    expect(wireReason('INVITATION_CLOSED')).toBe('LINK_UNAVAILABLE');
    expect(wireReason('PHONE_CONFLICT')).toBe('PHONE_CONFLICT');
    expect(wireReason('ATTEMPTS_EXHAUSTED')).toBe('ATTEMPTS_EXHAUSTED');
    const exhausted = attempt({ status: 'INVALIDATED', invalidatedReason: 'ATTEMPTS_EXHAUSTED' });
    expect(stateBody({ attempt: exhausted, newestChallenge: undefined, invitation, nowMs: NOW }, 'c')).toMatchObject({ reason: 'ATTEMPTS_EXHAUSTED', can_restart: true, csrf_token: 'c' });
    expect(stateBody({ attempt: exhausted, newestChallenge: undefined, invitation: { ...invitation, status: 'REVOKED' }, nowMs: NOW }, 'c').can_restart).toBe(false);
    expect(stateBody({ attempt: exhausted, newestChallenge: undefined, invitation: { ...invitation, expiresAtMs: NOW }, nowMs: NOW }, 'c').can_restart).toBe(false);
    const replaced = attempt({ status: 'INVALIDATED', invalidatedReason: 'SUPERSEDED' });
    const body = stateBody({ attempt: replaced, newestChallenge: undefined, invitation, nowMs: NOW }, 'c');
    expect(body).toEqual({ state: 'INVALIDATED', reason: 'REPLACED', can_restart: false });
  });

  it('live views say which phone verification mode the attempt has; terminal ones keep their old shape', () => {
    for (const status of ['STARTED', 'OTP_VERIFIED', 'PASSWORD_SET', 'TOTP_ISSUED'] as const) {
      for (const mode of ['REQUIRED', 'DISABLED_TEST'] as const) {
        const body = stateBody({ attempt: attempt({ status, phoneVerificationMode: mode }), newestChallenge: undefined, invitation, nowMs: NOW }, 'c');
        expect(body.phone_verification_mode).toBe(mode);
      }
    }
    expect(stateBody({ attempt: attempt({ status: 'COMPLETED' }), newestChallenge: undefined, invitation, nowMs: NOW }, 'c')).not.toHaveProperty('phone_verification_mode');
    expect(
      stateBody({ attempt: attempt({ status: 'INVALIDATED', invalidatedReason: 'SUPERSEDED' }), newestChallenge: undefined, invitation, nowMs: NOW }, 'c'),
    ).not.toHaveProperty('phone_verification_mode');
  });

  it('DISABLED_TEST STARTED is the password step: no OTP block, a window from created_at that never passes expires_at', () => {
    const created = NOW - 60_000;
    const open = stateBody(
      { attempt: attempt({ phoneVerificationMode: 'DISABLED_TEST', createdAtMs: created, expiresAtMs: NOW + 600_000 }), newestChallenge: undefined, invitation, nowMs: NOW },
      'csrf',
    );
    expect(open).toMatchObject({ state: 'STARTED', phone_verification_mode: 'DISABLED_TEST', restart_required: false, csrf_token: 'csrf' });
    expect(open).not.toHaveProperty('otp');
    expect(open.password_deadline).toBe(new Date(created + PASSWORD_DEADLINE_MS).toISOString());
    // The deadline is never later than the end of the attempt.
    const capped = stateBody(
      { attempt: attempt({ phoneVerificationMode: 'DISABLED_TEST', createdAtMs: created, expiresAtMs: created + 1000 }), newestChallenge: undefined, invitation, nowMs: created },
      undefined,
    );
    expect(capped.password_deadline).toBe(new Date(created + 1000).toISOString());
    // Strictly after the deadline the page is told to restart; AT the deadline it is not.
    const atDeadline = stateBody(
      { attempt: attempt({ phoneVerificationMode: 'DISABLED_TEST', createdAtMs: NOW - PASSWORD_DEADLINE_MS, expiresAtMs: NOW + 600_000 }), newestChallenge: undefined, invitation, nowMs: NOW },
      undefined,
    );
    expect(atDeadline.restart_required).toBe(false);
    const after = stateBody(
      { attempt: attempt({ phoneVerificationMode: 'DISABLED_TEST', createdAtMs: NOW - PASSWORD_DEADLINE_MS - 1, expiresAtMs: NOW + 600_000 }), newestChallenge: undefined, invitation, nowMs: NOW },
      undefined,
    );
    expect(after.restart_required).toBe(true);
  });

  it('a REQUIRED STARTED view is unchanged: the OTP block and no password window', () => {
    const body = stateBody({ attempt: attempt(), newestChallenge: undefined, invitation, nowMs: NOW }, 'csrf');
    expect(body).toMatchObject({ state: 'STARTED', phone_verification_mode: 'REQUIRED', otp: { status: 'NONE' } });
    expect(body).not.toHaveProperty('password_deadline');
    expect(body).not.toHaveProperty('restart_required');
  });

  it('the view can never carry a phone, name, id, secret, password or digest', () => {
    const text = JSON.stringify(
      stateBody({ attempt: attempt({ status: 'TOTP_ISSUED', passwordHash: '$argon2id$x' }), newestChallenge: challenge(), invitation, nowMs: NOW }, 'csrf'),
    );
    for (const forbidden of ['+84901234567', '$argon2id$', 'otpDigest', 'tokenDigest', 'user_id', 'factor_id']) {
      expect(text).not.toContain(forbidden);
    }
  });
});
