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

// M01-A2D (task section 14): the two codes Driver onboarding adds. INVALID_SERVICE_AREA (400) and
// VERSION_CONFLICT (409) are the A2S codes and are reused, not redefined.
const DRIVER_ONBOARDING_ERRORS: ReadonlyArray<readonly [string, number]> = [
  ['DRIVER_PROFILE_EXISTS', 409],
  ['DRIVER_PENDING_APPROVAL', 403],
];

// M02-A (task section 7): the four codes Shop management adds. SESSION_*, ACCOUNT_DISABLED, INVALID_SERVICE_AREA,
// SHOP_PROFILE_INCOMPLETE and VERSION_CONFLICT are reused, not redefined.
const SHOP_MANAGEMENT_ERRORS: ReadonlyArray<readonly [string, number]> = [
  ['SHOP_NOT_FOUND', 404],
  ['SHOP_ROLE_REQUIRED', 403],
  ['SHOP_DISABLED', 403],
  ['INVALID_BUSINESS_HOURS', 400],
];

describe('Shop management error registry (M02-A)', () => {
  it('registers exactly the four new codes with the locked statuses and clean fixed messages', () => {
    for (const [code, status] of SHOP_MANAGEMENT_ERRORS) {
      const definition = (APP_ERROR_DEFINITIONS as Record<string, { status: number; message: string }>)[code];
      expect([code, definition?.status]).toEqual([code, status]);
      expect(definition?.message).not.toMatch(/[{}$%<>]|undefined|null|constraint|shops?_|uuid/i);
    }
  });

  it('is serialized through the standard envelope with empty details', () => {
    for (const [code, status] of SHOP_MANAGEMENT_ERRORS) {
      const classified = classifyException(new AppError(code as keyof typeof APP_ERROR_DEFINITIONS));
      expect([classified.status, classified.code]).toEqual([status, code]);
      expect(buildErrorBody(classified, '123e4567-e89b-42d3-a456-426614174000').error.details).toEqual({});
    }
  });

  it('reuses the existing session, account, area, completeness and version codes unchanged', () => {
    expect(APP_ERROR_DEFINITIONS.SHOP_PROFILE_INCOMPLETE.status).toBe(409);
    expect(APP_ERROR_DEFINITIONS.ACCOUNT_DISABLED.status).toBe(403);
    expect(APP_ERROR_DEFINITIONS.INVALID_SERVICE_AREA.status).toBe(400);
    expect(APP_ERROR_DEFINITIONS.VERSION_CONFLICT.status).toBe(409);
    expect(APP_ERROR_DEFINITIONS.SESSION_REVOKED.status).toBe(401);
  });
});

describe('Driver onboarding error registry (M01-A2D)', () => {
  it('registers the two new codes with the locked statuses and clean fixed messages', () => {
    for (const [code, status] of DRIVER_ONBOARDING_ERRORS) {
      const definition = (APP_ERROR_DEFINITIONS as Record<string, { status: number; message: string }>)[code];
      expect([code, definition?.status]).toEqual([code, status]);
      expect(definition?.message).not.toMatch(/[{}$%<>]|undefined|null|constraint|drivers?_|uuid/i);
    }
  });

  it('is serialized through the standard envelope with empty details', () => {
    for (const [code, status] of DRIVER_ONBOARDING_ERRORS) {
      const classified = classifyException(new AppError(code as keyof typeof APP_ERROR_DEFINITIONS));
      expect([classified.status, classified.code]).toEqual([status, code]);
      expect(buildErrorBody(classified, '123e4567-e89b-42d3-a456-426614174000').error.details).toEqual({});
    }
  });

  it('reuses the A2S service-area and version codes unchanged', () => {
    expect(APP_ERROR_DEFINITIONS.INVALID_SERVICE_AREA.status).toBe(400);
    expect(APP_ERROR_DEFINITIONS.VERSION_CONFLICT.status).toBe(409);
  });
});

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

describe('Staging fixture registration error (M00-D2)', () => {
  it('AUTH_REGISTRATION_UNAVAILABLE is a fixed 503 that names no phone, account or configuration', () => {
    const definition = APP_ERROR_DEFINITIONS.AUTH_REGISTRATION_UNAVAILABLE;
    expect(definition.status).toBe(503);
    expect(definition.message).not.toMatch(/[{}$%<>]|undefined|null|fixture|staging|allowlist|phone number/i);
    const classified = classifyException(new AppError('AUTH_REGISTRATION_UNAVAILABLE'));
    expect([classified.status, classified.code]).toEqual([503, 'AUTH_REGISTRATION_UNAVAILABLE']);
    expect(buildErrorBody(classified, '123e4567-e89b-42d3-a456-426614174000').error.details).toEqual({});
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
