import { describe, expect, it } from '@jest/globals';
import { AppError } from '../common/app-errors';
import {
  parseClassifyBody,
  parseDriverId,
  parseReasonBody,
  parseShipperListQuery,
  parseVersionBody,
  parseWalletParametersBody,
  REASON_MAX_CODEPOINTS,
} from './admin-shipper-validation';

const ID = '623e4567-e89b-42d3-a456-426614174000';

function code(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.code : 'OTHER';
  }
}

describe('Shipper administration parsers (M03)', () => {
  it('takes the target from a canonical uuid only', () => {
    expect(parseDriverId(ID)).toBe(ID);
    expect(code(() => parseDriverId('nope'))).toBe('ADMIN_INPUT_INVALID');
    expect(code(() => parseDriverId(undefined))).toBe('ADMIN_INPUT_INVALID');
  });

  it('a version-only body is exactly {expected_version}', () => {
    expect(parseVersionBody({ expected_version: 3 })).toEqual({ expectedVersion: 3 });
    for (const bad of [{}, { expected_version: 0 }, { expected_version: '3' }, { expected_version: 3, reason: 'x' }, { expected_version: 3, status: 'ACTIVE' }, [], null, 'x']) {
      expect(code(() => parseVersionBody(bad))).toBe('ADMIN_INPUT_INVALID');
    }
  });

  it('a reason is required, trimmed, at most 500 characters, and nothing else may be sent', () => {
    expect(parseReasonBody({ expected_version: 1, reason: '  Sai   thông tin  ' })).toEqual({ expectedVersion: 1, reason: 'Sai thông tin' });
    for (const bad of [{ expected_version: 1 }, { expected_version: 1, reason: '' }, { expected_version: 1, reason: '   ' }, { expected_version: 1, reason: 5 }, { expected_version: 1, reason: 'x'.repeat(REASON_MAX_CODEPOINTS + 1) }, { expected_version: 1, reason: 'x', extra: 1 }, { expected_version: 1, reason: 'a\u0000b' }]) {
      expect(code(() => parseReasonBody(bad))).toBe('ADMIN_INPUT_INVALID');
    }
    expect(parseReasonBody({ expected_version: 1, reason: 'x'.repeat(REASON_MAX_CODEPOINTS) }).reason).toHaveLength(REASON_MAX_CODEPOINTS);
  });

  it('the classification is EXTERNAL or PLATFORM, nothing else', () => {
    expect(parseClassifyBody({ expected_version: 2, driver_type: 'PLATFORM' })).toEqual({ expectedVersion: 2, driverType: 'PLATFORM' });
    for (const bad of [{ expected_version: 2, driver_type: 'SYSTEM' }, { expected_version: 2, driver_type: 'platform' }, { expected_version: 2 }, { expected_version: 2, driver_type: 'EXTERNAL', role: 'ADMIN' }]) {
      expect(code(() => parseClassifyBody(bad))).toBe('ADMIN_INPUT_INVALID');
    }
  });

  it('the list query: bounded paging, a known status, a trimmed search that never becomes a pattern of its own', () => {
    expect(parseShipperListQuery({})).toMatchObject({ q: null, limit: 20, offset: 0, filter: { pattern: null, status: null } });
    const parsed = parseShipperListQuery({ q: '  Nguyễn_100%  ', status: 'SUBMITTED', limit: '5', offset: '10' });
    expect(parsed.q).toBe('Nguyễn_100%');
    expect(parsed.filter.status).toBe('SUBMITTED');
    // LIKE metacharacters in the typed text are literal.
    expect(parsed.filter.pattern?.name).toBe('%nguyen\\_100\\%%');
    expect(parsed.limit).toBe(5);
    expect(parsed.offset).toBe(10);
    expect(parseShipperListQuery({ status: 'ALL' }).filter.status).toBeNull();
    // A phone number also searches the number without its leading zero.
    expect(parseShipperListQuery({ q: '0912 345 678' }).filter.pattern?.phone).toBe('%912345678%');
    expect(parseShipperListQuery({ q: 'SH000012' }).filter.pattern?.phone).toBeNull();
    for (const bad of [{ status: 'NOPE' }, { limit: '0' }, { limit: '51' }, { offset: '-1' }, { q: ['a', 'b'] }, { extra: '1' }, { q: 'x'.repeat(81) }]) {
      expect(code(() => parseShipperListQuery(bad))).toBe('ADMIN_INPUT_INVALID');
    }
  });

  it('wallet parameters are whole positive VND at most one billion, both present, nothing else', () => {
    const max = 1_000_000_000;
    expect(parseWalletParametersBody({ expected_version: 2, topup_min_vnd: 100000, withdraw_min_vnd: 10000 }, max)).toEqual({ expectedVersion: 2, topupMinVnd: 100000, withdrawMinVnd: 10000 });
    for (const bad of [
      { expected_version: 2, topup_min_vnd: 0, withdraw_min_vnd: 10000 },
      { expected_version: 2, topup_min_vnd: -1, withdraw_min_vnd: 10000 },
      { expected_version: 2, topup_min_vnd: 1.5, withdraw_min_vnd: 10000 },
      { expected_version: 2, topup_min_vnd: '100000', withdraw_min_vnd: 10000 },
      { expected_version: 2, topup_min_vnd: max + 1, withdraw_min_vnd: 10000 },
      { expected_version: 2, topup_min_vnd: 100000 },
      { expected_version: 2, topup_min_vnd: 100000, withdraw_min_vnd: 10000, note: 'x' },
      { topup_min_vnd: 100000, withdraw_min_vnd: 10000 },
    ]) {
      expect(code(() => parseWalletParametersBody(bad, max))).toBe('ADMIN_INPUT_INVALID');
    }
  });
});
