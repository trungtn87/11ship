import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from '@jest/globals';
import { AppError } from '../common/app-errors';
import { parseDriverOnboardingBody } from './driver-onboarding-validation';

const A = '123e4567-e89b-42d3-a456-426614174001';
const B = '223e4567-e89b-42d3-a456-426614174002';
const C = '023e4567-e89b-42d3-a456-426614174003';

function outcome(body: unknown): string {
  try {
    parseDriverOnboardingBody(body);
    return 'OK';
  } catch (error) {
    if (error instanceof AppError) {
      return error.code;
    }
    if (error instanceof BadRequestException) {
      return 'BAD_REQUEST';
    }
    return `OTHER:${String(error)}`;
  }
}

const valid = (extra: Record<string, unknown> = {}) => ({ full_name: 'Nguyen Van A', service_area_ids: [A], ...extra });

describe('parseDriverOnboardingBody (A03-26, A03-27, A03-28, A03-29)', () => {
  it('accepts the contract body and normalizes it', () => {
    expect(parseDriverOnboardingBody({ full_name: '  Nguyen Van A  ', plate_number: ' 11B1-12345 ', service_area_ids: [A] })).toEqual({
      fullName: 'Nguyen Van A',
      plateNumber: '11B1-12345',
      serviceAreaIds: [A],
    });
  });

  it('plate_number is optional: absent and null are the same normalized request (A03-28)', () => {
    const absent = parseDriverOnboardingBody(valid());
    const explicit = parseDriverOnboardingBody(valid({ plate_number: null }));
    expect(absent).toEqual(explicit);
    expect(absent.plateNumber).toBeNull();
  });

  it('sorts the areas by UUID so the same set in any order is the same logical request', () => {
    const forward = parseDriverOnboardingBody(valid({ service_area_ids: [A, B, C] }));
    const reverse = parseDriverOnboardingBody(valid({ service_area_ids: [C, B, A] }));
    expect(forward.serviceAreaIds).toEqual([C, A, B]);
    expect(reverse).toEqual(forward);
  });

  it('refuses every field outside the schema, whatever its value (A03-27)', () => {
    const forbidden: Array<[string, unknown]> = [
      ['driver_type', 'PLATFORM'],
      ['driver_type', 'EXTERNAL'],
      ['driver_type', 'SYSTEM'],
      ['type', 'PLATFORM'],
      ['status', 'ACTIVE'],
      ['accepting_deliveries', true],
      ['user_id', '523e4567-e89b-42d3-a456-426614174000'],
      ['driver_id', '523e4567-e89b-42d3-a456-426614174000'],
      ['role', 'ADMIN'],
      ['roles', ['ADMIN']],
      ['is_admin', true],
      ['permissions', ['driver.approve']],
      ['bank_verified', true],
      ['bank_account', '1234'],
      ['wallet_balance', 1000],
      ['wallet_funded', true],
      ['cccd', '012345678901'],
      ['vehicle_type', 'MOTORBIKE'],
      ['version', 1],
    ];
    for (const [key, value] of forbidden) {
      expect([key, outcome(valid({ [key]: value }))]).toEqual([key, 'BAD_REQUEST']);
    }
  });

  it('refuses a body that is not a plain JSON object', () => {
    for (const body of [undefined, null, 'x', 7, true, [], [valid()]]) {
      expect([JSON.stringify(body) ?? 'undefined', outcome(body)]).toEqual([JSON.stringify(body) ?? 'undefined', 'BAD_REQUEST']);
    }
  });

  it('requires full_name and service_area_ids', () => {
    expect(outcome({ service_area_ids: [A] })).toBe('BAD_REQUEST');
    expect(outcome({ full_name: 'Nguyen Van A' })).toBe('BAD_REQUEST');
    expect(outcome({})).toBe('BAD_REQUEST');
  });

  it('full_name: trimmed, not blank, at most 120 characters, text only', () => {
    expect(outcome(valid({ full_name: 'x'.repeat(120) }))).toBe('OK');
    expect(outcome(valid({ full_name: 'x'.repeat(121) }))).toBe('BAD_REQUEST');
    // Counted in characters, not UTF-16 units.
    expect(outcome(valid({ full_name: '😀'.repeat(120) }))).toBe('OK');
    expect(outcome(valid({ full_name: '😀'.repeat(121) }))).toBe('BAD_REQUEST');
    for (const bad of ['', '   ', '\t\n', null, undefined, 7, true, ['x'], { a: 1 }, 'a\u0000b', 'a\uD800b']) {
      expect([String(bad), outcome(valid({ full_name: bad }))]).toEqual([String(bad), 'BAD_REQUEST']);
    }
  });

  it('plate_number: trimmed, not blank when present, at most 32 characters', () => {
    expect(outcome(valid({ plate_number: 'x'.repeat(32) }))).toBe('OK');
    expect(outcome(valid({ plate_number: 'x'.repeat(33) }))).toBe('BAD_REQUEST');
    for (const bad of ['', '   ', 7, true, ['x'], { a: 1 }, 'a\u0000b', 'a\uD800b']) {
      expect([String(bad), outcome(valid({ plate_number: bad }))]).toEqual([String(bad), 'BAD_REQUEST']);
    }
  });

  it('service_area_ids: a non-empty array of canonical UUIDs, at most 50', () => {
    for (const bad of [undefined, null, 'x', A, {}, [], [1], [null], [''], ['not-a-uuid'], [A.toUpperCase()], ['00000000-0000-0000-0000-000000000000'], [[A]]]) {
      expect([JSON.stringify(bad) ?? 'undefined', outcome(valid({ service_area_ids: bad }))]).toEqual([
        JSON.stringify(bad) ?? 'undefined',
        'BAD_REQUEST',
      ]);
    }
    const many = Array.from({ length: 50 }, (_, i) => `123e4567-e89b-42d3-a456-${String(i).padStart(12, '0')}`);
    expect(outcome(valid({ service_area_ids: many }))).toBe('OK');
    expect(outcome(valid({ service_area_ids: [...many, A] }))).toBe('BAD_REQUEST');
  });

  it('a duplicate area is INVALID_SERVICE_AREA, decided before any transaction (A03-29)', () => {
    expect(outcome(valid({ service_area_ids: [A, A] }))).toBe('INVALID_SERVICE_AREA');
    expect(outcome(valid({ service_area_ids: [A, B, A] }))).toBe('INVALID_SERVICE_AREA');
  });

  it('never echoes the offending value', () => {
    try {
      parseDriverOnboardingBody(valid({ driver_type: 'PLATFORM-SECRET-MARKER' }));
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect(JSON.stringify((error as BadRequestException).getResponse())).not.toContain('SECRET-MARKER');
    }
  });
});
