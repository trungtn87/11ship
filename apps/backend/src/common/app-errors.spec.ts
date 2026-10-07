import { describe, expect, it } from '@jest/globals';
import {
  APP_ERROR_CODES,
  APP_ERROR_DEFINITIONS,
  AppError,
  isAppErrorCode,
  TechnicalError,
} from './app-errors';

describe('application error registry', () => {
  it('gives every code a unique fixed message and a 4xx/5xx status', () => {
    const messages = new Set<string>();
    for (const code of APP_ERROR_CODES) {
      const definition = APP_ERROR_DEFINITIONS[code];
      expect([400, 409, 503]).toContain(definition.status);
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
