import { describe, expect, it } from '@jest/globals';
import { AppError } from '../common/app-errors';
import { parseOrderParametersBody } from './order-parameters-validation';

const codeOf = (body: unknown): string | undefined => {
  try {
    parseOrderParametersBody(body);
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.code : 'OTHER';
  }
};

describe('order parameters body: "Thời gian trả lời đề xuất phí"', () => {
  it('accepts a positive whole number of minutes with the version, and an optional reason', () => {
    expect(parseOrderParametersBody({ expected_version: 1, fee_answer_minutes: 5 })).toEqual({ expectedVersion: 1, feeAnswerMinutes: 5, reason: null });
    expect(parseOrderParametersBody({ expected_version: 3, fee_answer_minutes: 1440, reason: 'Khách trả lời chậm' })).toMatchObject({ feeAnswerMinutes: 1440, reason: 'Khách trả lời chậm' });
    expect(parseOrderParametersBody({ expected_version: 0, fee_answer_minutes: 1 }).feeAnswerMinutes).toBe(1);
  });

  it('refuses zero, negatives, decimals, strings, out-of-range numbers, missing and extra keys', () => {
    for (const minutes of [0, -5, 2.5, '5', null, 1441, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(codeOf({ expected_version: 1, fee_answer_minutes: minutes })).toBe('ADMIN_INPUT_INVALID');
    }
    expect(codeOf({ expected_version: 1 })).toBe('ADMIN_INPUT_INVALID');
    expect(codeOf({ fee_answer_minutes: 5 })).toBe('ADMIN_INPUT_INVALID');
    expect(codeOf({ expected_version: -1, fee_answer_minutes: 5 })).toBe('ADMIN_INPUT_INVALID');
    expect(codeOf({ expected_version: 1, fee_answer_minutes: 5, other: 1 })).toBe('ADMIN_INPUT_INVALID');
    expect(codeOf(null)).toBe('ADMIN_INPUT_INVALID');
    expect(codeOf([])).toBe('ADMIN_INPUT_INVALID');
  });
});
