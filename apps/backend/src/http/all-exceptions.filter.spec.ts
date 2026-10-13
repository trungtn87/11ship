import { describe, expect, it } from '@jest/globals';
import {
  ArgumentsHost,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
  ActivationStateError,
  AdminAuthRateLimitError,
  APP_ERROR_DEFINITIONS,
  AppError,
  AppErrorCode,
  TechnicalError,
} from '../common/app-errors';
import { CryptoError } from '../crypto/crypto-error';
import { JsonLogger, LOG_META_WHITELIST } from '../logging/json-logger';
import { JsonValidationError } from '../shared/json/safe-json';
import { TransactionError } from '../transaction/transaction-error';
import { AllExceptionsFilter } from './all-exceptions.filter';

const SECRET = 'SECRET_MARKER_FILTER_91c2';
const REQUEST_ID = '11111111-2222-4333-8444-555555555555';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface Reply {
  body: { error: { code: string; message: string; request_id: string; details: object } };
  status: number;
}

function run(exception: unknown, request: { requestId?: string; method?: string } = {
  requestId: REQUEST_ID,
  method: 'GET',
}): { reply: Reply; logs: string[]; headers: Array<[string, string]> } {
  const logs: string[] = [];
  const headers: Array<[string, string]> = [];
  const replies: Reply[] = [];
  const adapterHost = {
    httpAdapter: {
      setHeader: (_response: unknown, name: string, value: string) => {
        headers.push([name, value]);
      },
      reply: (_response: unknown, body: Reply['body'], status: number) => {
        replies.push({ body, status });
      },
    },
  } as unknown as HttpAdapterHost;
  const host = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
  } as unknown as ArgumentsHost;
  const logger = new JsonLogger((line) => {
    logs.push(line);
  });

  new AllExceptionsFilter(adapterHost, logger).catch(exception, host);

  const reply = replies[0];
  if (reply === undefined) {
    throw new Error('the filter did not reply');
  }
  return { reply, logs, headers };
}

describe('AllExceptionsFilter — Retry-After (administration rate limit)', () => {
  it('sends Retry-After only for the typed AdminAuthRateLimitError, with its integer seconds', () => {
    const { reply, headers } = run(new AdminAuthRateLimitError(42));
    expect(reply.status).toBe(429);
    expect(reply.body.error.code).toBe('ADMIN_AUTH_RATE_LIMITED');
    expect(reply.body.error.message).toBe(APP_ERROR_DEFINITIONS.ADMIN_AUTH_RATE_LIMITED.message);
    expect(reply.body.error.details).toEqual({});
    expect(headers).toEqual([['Retry-After', '42']]);
  });

  it('floors an invalid value to 1 second instead of emitting a malformed header', () => {
    for (const value of [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(run(new AdminAuthRateLimitError(value)).headers).toEqual([['Retry-After', '1']]);
    }
  });

  it('never sends Retry-After for a plain AppError of the same code or for an impostor', () => {
    expect(run(new AppError('ADMIN_AUTH_RATE_LIMITED')).headers).toEqual([]);
    expect(run(new AppError('OTP_RATE_LIMITED')).headers).toEqual([]);
    const impostor = Object.assign(new Error('x'), { status: 429, retryAfterSeconds: 99, headers: { 'Retry-After': '99' } });
    const { reply, headers } = run(impostor);
    expect(reply.status).toBe(429);
    expect(headers).toEqual([]);
  });
});

describe('AllExceptionsFilter', () => {
  it('returns 503 SERVICE_UNAVAILABLE in the documented envelope', () => {
    const { reply } = run(new ServiceUnavailableException());
    expect(reply.status).toBe(503);
    expect(reply.body).toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service unavailable',
        request_id: REQUEST_ID,
        details: {},
      },
    });
  });

  it('returns 404 NOT_FOUND without echoing the exception message', () => {
    const { reply, logs } = run(new NotFoundException(`Cannot GET /${SECRET}`));
    expect(reply.status).toBe(404);
    expect(reply.body.error.code).toBe('NOT_FOUND');
    expect(reply.body.error.message).toBe('Not found');
    expect(reply.body.error.request_id).toBe(REQUEST_ID);
    expect(JSON.stringify(reply.body)).not.toContain(SECRET);
    expect(logs.join('\n')).not.toContain(SECRET);
  });

  it('maps an unexpected error to 500 INTERNAL_ERROR and never leaks its message', () => {
    const databaseError = Object.assign(
      new Error(`password authentication failed for user "x" at 10.0.0.5 ${SECRET}`),
      { code: '28P01' },
    );
    const { reply, logs } = run(databaseError);
    expect(reply.status).toBe(500);
    expect(reply.body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        request_id: REQUEST_ID,
        details: {},
      },
    });
    expect(JSON.stringify(reply.body)).not.toContain(SECRET);
    expect(logs.join('\n')).not.toContain(SECRET);
    expect(logs.join('\n')).not.toContain('10.0.0.5');
  });

  it('treats a thrown non-Error value as 500 without leaking it', () => {
    const { reply, logs } = run(`connection string postgres://u:${SECRET}@h/db`);
    expect(reply.status).toBe(500);
    expect(JSON.stringify(reply.body)).not.toContain(SECRET);
    expect(logs.join('\n')).not.toContain(SECRET);
  });

  it('replaces a custom HttpException message with a fixed one', () => {
    const { reply } = run(new BadRequestException(`bad value ${SECRET}`));
    expect(reply.status).toBe(400);
    expect(reply.body.error.code).toBe('BAD_REQUEST');
    expect(JSON.stringify(reply.body)).not.toContain(SECRET);
  });

  it('honours 4xx statuses raised by the HTTP layer but never a 5xx one', () => {
    expect(run({ status: 400, message: SECRET }).reply.status).toBe(400);
    expect(run({ statusCode: 413 }).reply.body.error.code).toBe('CLIENT_ERROR');
    expect(run({ status: 502, message: SECRET }).reply.status).toBe(500);
  });

  it('generates a UUID request id when none was assigned', () => {
    const { reply } = run(new NotFoundException(), { method: 'GET' });
    expect(reply.body.error.request_id).toMatch(UUID);
  });

  it('logs only whitelisted metadata', () => {
    const { logs } = run(new Error(SECRET));
    expect(logs).toHaveLength(1);
    const entry = JSON.parse(logs[0] ?? '{}') as Record<string, unknown>;
    const allowed = new Set<string>(['time', 'level', 'event', ...LOG_META_WHITELIST]);
    for (const key of Object.keys(entry)) {
      expect(allowed.has(key)).toBe(true);
    }
    expect(entry.event).toBe('request_failed');
    expect(entry.level).toBe('error');
    expect(entry.request_id).toBe(REQUEST_ID);
    expect(entry.status).toBe(500);
    expect(entry.code).toBe('INTERNAL_ERROR');
  });

  describe('typed error registry', () => {
    const codes = Object.keys(APP_ERROR_DEFINITIONS) as AppErrorCode[];

    it('registers exactly the foundation codes (six idempotency + unknown transaction outcome), the Auth Core codes, the Shop onboarding codes, the Driver onboarding codes, the Shop management codes, the administration login codes the ADMIN invitation codes, the administration activation codes, the administration account read code, the staging-fixture registration code and the client registration codes', () => {
      expect([...codes].sort()).toEqual([
        'ACCOUNT_DISABLED',
        'ADMIN_ACTIVATION_LINK_INVALID',
        'ADMIN_ACTIVATION_SESSION_INVALID',
        'ADMIN_ACTIVATION_STEP_INVALID',
        'ADMIN_AUTH_RATE_LIMITED',
        'ADMIN_CSRF_INVALID',
        'ADMIN_ENROLLMENT_NOT_ALLOWED',
        'ADMIN_FORBIDDEN',
        'ADMIN_INPUT_INVALID',
        'ADMIN_INVITATION_NOT_FOUND',
        'ADMIN_INVITATION_NOT_PENDING',
        'ADMIN_INVITATION_NOT_REPLAYABLE',
        'ADMIN_INVITATION_PENDING_EXISTS',
        'ADMIN_PHONE_CONFLICT',
        'ADMIN_PREAUTH_INVALID',
        'ADMIN_SESSION_INVALID',
        'ADMIN_STEP_UP_REQUIRED',
        'ADMIN_TOTP_INVALID',
        'ADMIN_VERSION_CONFLICT',
        'AUTH_REGISTRATION_UNAVAILABLE',
        'AUTH_RESULT_NOT_REPLAYABLE',
        'CONSENT_VERSION_UNSUPPORTED',
        'DEVICE_PROOF_REQUIRED',
        'DRIVER_PENDING_APPROVAL',
        'DRIVER_PROFILE_EXISTS',
        'IDEMPOTENCY_BUSY',
        'IDEMPOTENCY_KEY_REQUIRED',
        'IDEMPOTENCY_KEY_REUSED',
        'IDEMPOTENCY_KEY_UNAVAILABLE',
        'IDEMPOTENCY_REPLAY_EXPIRED',
        'INVALID_BUSINESS_HOURS',
        'INVALID_CREDENTIALS',
        'INVALID_IDEMPOTENCY_KEY',
        'INVALID_PHONE',
        'INVALID_SERVICE_AREA',
        'OTP_ALREADY_USED',
        'OTP_EXPIRED',
        'OTP_INVALID',
        'OTP_RATE_LIMITED',
        'PHONE_ALREADY_REGISTERED',
        'ROLE_NOT_AVAILABLE',
        'SESSION_EXPIRED',
        'SESSION_INVALID',
        'SESSION_REVOKED',
        'SHOP_DISABLED',
        'SHOP_NOT_FOUND',
        'SHOP_ONBOARDING_EXISTS',
        'SHOP_PROFILE_INCOMPLETE',
        'SHOP_ROLE_REQUIRED',
        'TRANSACTION_OUTCOME_UNKNOWN',
        'USER_NOT_AVAILABLE',
        'VERIFICATION_PROOF_INVALID',
        'VERIFICATION_PROOF_USED',
        'VERIFICATION_PURPOSE_MISMATCH',
        'VERSION_CONFLICT',
      ]);
    });

    it.each(codes)('preserves %s with its fixed status and message', (code) => {
      const { reply, logs } = run(new AppError(code));
      expect(reply.status).toBe(APP_ERROR_DEFINITIONS[code].status);
      expect(reply.body).toEqual({
        error: {
          code,
          message: APP_ERROR_DEFINITIONS[code].message,
          request_id: REQUEST_ID,
          details: {},
        },
      });
      const entry = JSON.parse(logs[0] ?? '{}') as Record<string, unknown>;
      expect(entry.code).toBe(code);
      expect(entry.error_class).toBe('AppError');
    });

    it('puts the safe state details of the typed activation state error in the envelope, and only those', () => {
      const { reply } = run(new ActivationStateError({ state: 'OTP_VERIFIED', restartRequired: true }));
      expect(reply.status).toBe(409);
      expect(reply.body.error.code).toBe('ADMIN_ACTIVATION_STEP_INVALID');
      expect(reply.body.error.details).toEqual({ state: 'OTP_VERIFIED', restartRequired: true });
      const impostor = Object.assign(new AppError('ADMIN_ACTIVATION_STEP_INVALID'), { details: { leaked: SECRET } });
      expect(run(impostor).reply.body.error.details).toEqual({});
    });

    it('uses the documented statuses', () => {
      expect(APP_ERROR_DEFINITIONS.IDEMPOTENCY_KEY_REQUIRED.status).toBe(400);
      expect(APP_ERROR_DEFINITIONS.INVALID_IDEMPOTENCY_KEY.status).toBe(400);
      expect(APP_ERROR_DEFINITIONS.IDEMPOTENCY_KEY_REUSED.status).toBe(409);
      expect(APP_ERROR_DEFINITIONS.IDEMPOTENCY_BUSY.status).toBe(409);
      expect(APP_ERROR_DEFINITIONS.IDEMPOTENCY_REPLAY_EXPIRED.status).toBe(409);
      expect(APP_ERROR_DEFINITIONS.IDEMPOTENCY_KEY_UNAVAILABLE.status).toBe(503);
      expect(APP_ERROR_DEFINITIONS.TRANSACTION_OUTCOME_UNKNOWN.status).toBe(503);
    });

    it('never reflects a code, message or details supplied by an arbitrary exception', () => {
      const impostor = Object.assign(new Error(`message ${SECRET}`), {
        code: 'IDEMPOTENCY_BUSY',
        status: 409,
        statusCode: 409,
        details: { leaked: SECRET },
        response: { code: 'IDEMPOTENCY_KEY_REUSED', message: SECRET },
      });
      const { reply, logs } = run(impostor);
      // `status: 409` is honoured as a plain client status, but the public code is the generic one.
      expect(reply.body.error.code).toBe('CONFLICT');
      expect(reply.body.error.message).toBe('Conflict');
      expect(reply.body.error.details).toEqual({});
      expect(JSON.stringify(reply.body)).not.toContain(SECRET);
      expect(logs.join('\n')).not.toContain(SECRET);
      expect(JSON.parse(logs[0] ?? '{}')).toMatchObject({ code: 'CONFLICT' });
    });

    it('does not trust an object that only imitates AppError', () => {
      const fake = { code: 'IDEMPOTENCY_KEY_REUSED', status: 409, message: SECRET };
      expect(run(fake).reply.body.error.code).toBe('CONFLICT');
      const fakeError = Object.assign(new Error(SECRET), { name: 'AppError', code: 'IDEMPOTENCY_BUSY' });
      const { reply } = run(fakeError);
      expect(reply.status).toBe(500);
      expect(reply.body.error.code).toBe('INTERNAL_ERROR');
    });

    it('does not let an HttpException choose its own public code or message', () => {
      const exception = new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: SECRET,
        details: { leaked: SECRET },
      });
      const { reply } = run(exception);
      expect(reply.body.error.code).toBe('BAD_REQUEST');
      expect(JSON.stringify(reply.body)).not.toContain(SECRET);
    });

    it('collapses infrastructure failures into the generic envelopes', () => {
      const unavailable = run(new TransactionError('DEADLINE_EXCEEDED', '57014'));
      expect(unavailable.reply.status).toBe(503);
      expect(unavailable.reply.body.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(unavailable.reply.body.error.message).toBe('Service unavailable');

      for (const failure of [
        new TransactionError('CONTEXT_CLOSED'),
        new CryptoError('authentication_failed'),
        new JsonValidationError('secret_key'),
        new TechnicalError('internal', SECRET),
      ]) {
        const { reply, logs } = run(failure);
        expect(reply.status).toBe(500);
        expect(reply.body.error.code).toBe('INTERNAL_ERROR');
        expect(JSON.stringify(reply.body)).not.toContain('authentication_failed');
        expect(JSON.stringify(reply.body)).not.toContain(SECRET);
        expect(logs.join('\n')).not.toContain(SECRET);
      }
    });

    it('logs only allow-listed error classes, never an arbitrary class name', () => {
      class SECRET_MARKER_CLASS_NAME extends Error {}
      const { logs } = run(new SECRET_MARKER_CLASS_NAME('x'));
      const entry = JSON.parse(logs[0] ?? '{}') as Record<string, unknown>;
      expect(entry.error_class).toBe('UnknownError');
      expect(logs.join('\n')).not.toContain('SECRET_MARKER_CLASS_NAME');
    });
  });
});
