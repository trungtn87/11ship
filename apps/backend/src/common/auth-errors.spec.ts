import { describe, expect, it } from '@jest/globals';
import { APP_ERROR_DEFINITIONS, AppError } from './app-errors';
import { buildErrorBody, classifyException } from '../http/error-envelope';

// M01-A1 task section 15: the fixed typed errors, their statuses and the guarantee that a message can never
// carry client input or reveal whether an account exists.
const AUTH_ERRORS: ReadonlyArray<readonly [string, number]> = [
  ['INVALID_PHONE', 400],
  ['OTP_INVALID', 400],
  ['OTP_EXPIRED', 400],
  ['OTP_ALREADY_USED', 409],
  ['OTP_RATE_LIMITED', 429],
  ['PHONE_ALREADY_REGISTERED', 409],
  ['VERIFICATION_PROOF_INVALID', 400],
  ['VERIFICATION_PROOF_USED', 409],
  ['VERIFICATION_PURPOSE_MISMATCH', 400],
  ['INVALID_CREDENTIALS', 401],
  ['ACCOUNT_DISABLED', 403],
  ['ROLE_NOT_AVAILABLE', 403],
  ['SESSION_INVALID', 401],
  ['SESSION_REVOKED', 401],
  ['SESSION_EXPIRED', 401],
];

// M01-A2S (handoff section 10): the four Shop onboarding codes.
const SHOP_ONBOARDING_ERRORS: ReadonlyArray<readonly [string, number]> = [
  ['SHOP_ONBOARDING_EXISTS', 409],
  ['SHOP_PROFILE_INCOMPLETE', 409],
  ['INVALID_SERVICE_AREA', 400],
  ['VERSION_CONFLICT', 409],
];

describe('Shop onboarding error registry (M01-A2S)', () => {
  it('registers exactly the four locked codes with the locked statuses and clean fixed messages', () => {
    for (const [code, status] of SHOP_ONBOARDING_ERRORS) {
      const definition = (APP_ERROR_DEFINITIONS as Record<string, { status: number; message: string }>)[code];
      expect([code, definition?.status]).toEqual([code, status]);
      expect(definition?.message).not.toMatch(/[{}$%<>]|undefined|null|constraint|shops?_|uuid/i);
    }
  });

  it('is serialized through the standard envelope with empty details', () => {
    for (const [code, status] of SHOP_ONBOARDING_ERRORS) {
      const classified = classifyException(new AppError(code as keyof typeof APP_ERROR_DEFINITIONS));
      expect([classified.status, classified.code]).toEqual([status, code]);
      expect(buildErrorBody(classified, '123e4567-e89b-42d3-a456-426614174000').error.details).toEqual({});
    }
  });
});

describe('Auth error registry', () => {
  it('registers exactly the 15 locked codes with the locked statuses', () => {
    for (const [code, status] of AUTH_ERRORS) {
      const definition = (APP_ERROR_DEFINITIONS as Record<string, { status: number; message: string }>)[code];
      expect([code, definition?.status]).toEqual([code, status]);
    }
  });

  it('every message is fixed, unique and free of placeholders', () => {
    const messages = Object.values(APP_ERROR_DEFINITIONS).map((definition) => definition.message);
    expect(new Set(messages).size).toBe(messages.length);
    for (const [code] of AUTH_ERRORS) {
      const { message } = (APP_ERROR_DEFINITIONS as Record<string, { message: string }>)[code] as { message: string };
      expect(message).not.toMatch(/[{}$%<>]|undefined|null/);
      expect(message.length).toBeLessThan(100);
    }
  });

  it('the credential error does not say which part was wrong, and no message says an account does or does not exist', () => {
    expect(APP_ERROR_DEFINITIONS.INVALID_CREDENTIALS.message).toMatch(/phone number or password/);
    for (const [code] of AUTH_ERRORS) {
      const { message } = (APP_ERROR_DEFINITIONS as Record<string, { message: string }>)[code] as { message: string };
      expect(message).not.toMatch(/not found|does not exist|no such|unknown (user|account)/i);
    }
  });

  it('is serialized through the standard envelope with the request id and empty details', () => {
    for (const [code, status] of AUTH_ERRORS) {
      const classified = classifyException(new AppError(code as keyof typeof APP_ERROR_DEFINITIONS));
      expect(classified.status).toBe(status);
      expect(classified.code).toBe(code);
      expect(buildErrorBody(classified, '123e4567-e89b-42d3-a456-426614174000')).toEqual({
        error: { code, message: classified.message, request_id: '123e4567-e89b-42d3-a456-426614174000', details: {} },
      });
    }
  });
});
