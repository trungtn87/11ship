import { describe, expect, it } from '@jest/globals';
import {
  APP_ERROR_CODES,
  APP_ERROR_DEFINITIONS,
  ActivationStateError,
  AdminAuthRateLimitError,
  AppError,
  isAppErrorCode,
  TechnicalError,
} from './app-errors';

describe('application error registry', () => {
  it('gives every code a unique fixed message and a 4xx/5xx status', () => {
    const messages = new Set<string>();
    for (const code of APP_ERROR_CODES) {
      const definition = APP_ERROR_DEFINITIONS[code];
      // M01-A1 adds 401 (credentials/session), 403 (disabled account, role) and 429 (OTP rate limit);
      // M02-A adds 404 (SHOP_NOT_FOUND); shop logos add 413 (SHOP_LOGO_TOO_LARGE).
      expect([400, 401, 403, 404, 409, 413, 429, 503]).toContain(definition.status);
      expect(definition.message.length).toBeGreaterThan(0);
      messages.add(definition.message);
    }
    expect(messages.size).toBe(APP_ERROR_CODES.length);
  });

  it('builds AppError from the registry only', () => {
    const error = new AppError('IDEMPOTENCY_BUSY');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('IDEMPOTENCY_BUSY');
    expect(error.status).toBe(409);
    expect(error.message).toBe(APP_ERROR_DEFINITIONS.IDEMPOTENCY_BUSY.message);
  });

  it('carries the Retry-After seconds only on the typed administration rate-limit error', () => {
    const error = new AdminAuthRateLimitError(30);
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('ADMIN_AUTH_RATE_LIMITED');
    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(30);
    expect(new AdminAuthRateLimitError(0).retryAfterSeconds).toBe(1);
    expect(new AppError('ADMIN_AUTH_RATE_LIMITED')).not.toHaveProperty('retryAfterSeconds');
  });

  it('carries safe state details only on the typed activation state error (409 STEP_INVALID)', () => {
    const error = new ActivationStateError({ state: 'STARTED', restartRequired: false });
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('ADMIN_ACTIVATION_STEP_INVALID');
    expect(error.status).toBe(409);
    expect(error.details).toEqual({ state: 'STARTED', restartRequired: false });
    expect(new AppError('ADMIN_ACTIVATION_STEP_INVALID')).not.toHaveProperty('details');
  });

  it('recognizes registered codes strictly', () => {
    expect(isAppErrorCode('IDEMPOTENCY_BUSY')).toBe(true);
    expect(isAppErrorCode('idempotency_busy')).toBe(false);
    expect(isAppErrorCode('toString')).toBe(false);
    expect(isAppErrorCode('__proto__')).toBe(false);
    expect(isAppErrorCode(409)).toBe(false);
    expect(isAppErrorCode(undefined)).toBe(false);
  });

  it('keeps the exported code list immutable', () => {
    expect(Object.isFrozen(APP_ERROR_CODES)).toBe(true);
  });

  it('marks technical errors as unavailable or internal', () => {
    expect(new TechnicalError('unavailable', 'x').kind).toBe('unavailable');
    expect(new TechnicalError('internal', 'x').kind).toBe('internal');
  });
});
