import { describe, expect, it } from '@jest/globals';
import { AppError } from '../common/app-errors';
import { parseShopHistoryQuery, parseShopId, parseShopListQuery, parseShopMenuQuery, parseStatusChangeBody } from './admin-shop-validation';

const ID = '123e4567-e89b-42d3-a456-426614174000';
const refused = (run: () => unknown): void => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('ADMIN_INPUT_INVALID');
    return;
  }
  throw new Error('expected ADMIN_INPUT_INVALID');
};

describe('admin shop validation', () => {
  it('reads a list query with 20 per page by default and folds the search the way the database does', () => {
    expect(parseShopListQuery({})).toMatchObject({ q: null, name: null, digits: null, areaId: null, profile: null, schedule: null, limit: 20, offset: 0 });
    const parsed = parseShopListQuery({ q: '  Phở   Ngon ', area: ID, profile: 'DISABLED', schedule: 'OPEN', limit: '20', offset: '40' });
    expect(parsed).toMatchObject({ q: 'Phở Ngon', name: '%pho ngon%', areaId: ID, profile: 'DISABLED', schedule: 'OPEN', limit: 20, offset: 40 });
    // A phone-like text also searches the numbers, without the leading 0 or +.
    expect(parseShopListQuery({ q: '0912 345 678' }).digits).toBe('%912345678%');
    expect(parseShopListQuery({ q: '+84912345678' }).digits).toBe('%84912345678%');
    expect(parseShopListQuery({ q: 'K01' }).digits).toBeNull();
    // LIKE wildcards in the search are literal characters.
    expect(parseShopListQuery({ q: '50%_off' }).name).toBe('%50\\%\\_off%');
    expect(parseShopListQuery({ profile: 'ALL', schedule: 'ALL', area: 'ALL' })).toMatchObject({ profile: null, schedule: null, areaId: null });
  });

  it('refuses unknown keys, wrong values and out-of-range pages', () => {
    for (const query of [{ x: '1' }, { profile: 'BOGUS' }, { schedule: 'MAYBE' }, { area: 'not-a-uuid' }, { limit: '0' }, { limit: '51' }, { offset: '-1' }, { offset: '1.5' }, { q: 'a'.repeat(81) }, { q: 'a\u0000b' }, { q: ['a', 'b'] }, null, 'text', []]) {
      refused(() => parseShopListQuery(query));
    }
  });

  it('reads the menu and history queries', () => {
    expect(parseShopMenuQuery({ q: 'Phở', category: ID, status: 'HIDDEN', limit: '10', offset: '10' })).toMatchObject({ name: '%pho%', categoryId: ID, status: 'HIDDEN', limit: 10, offset: 10 });
    expect(parseShopMenuQuery({})).toMatchObject({ categoryId: null, status: null, limit: 20 });
    for (const query of [{ status: 'DELETED' }, { category: 'x' }, { profile: 'ACTIVE' }]) {
      refused(() => parseShopMenuQuery(query));
    }
    expect(parseShopHistoryQuery({ limit: '5' })).toEqual({ limit: 5, offset: 0 });
    refused(() => parseShopHistoryQuery({ q: 'x' }));
  });

  it('reads a status change: the version and a reason of 1-500 characters, nothing else', () => {
    expect(parseStatusChangeBody({ expected_version: 3, reason: '  Vi phạm   quy định ' })).toEqual({ expectedVersion: 3, reason: 'Vi phạm quy định' });
    expect(parseStatusChangeBody({ expected_version: 1, reason: 'x'.repeat(500) }).reason).toHaveLength(500);
    for (const body of [{}, { expected_version: 3 }, { reason: 'x' }, { expected_version: 0, reason: 'x' }, { expected_version: 1.5, reason: 'x' }, { expected_version: '3', reason: 'x' }, { expected_version: 3, reason: '' }, { expected_version: 3, reason: ' \n ' }, { expected_version: 3, reason: 'x'.repeat(501) }, { expected_version: 3, reason: 'a\u0007b' }, { expected_version: 3, reason: 'x', status: 'ACTIVE' }, { expected_version: 3, reason: 'x', actor: ID }, [], null]) {
      refused(() => parseStatusChangeBody(body));
    }
  });

  it('accepts only a canonical id in the path', () => {
    expect(parseShopId(ID)).toBe(ID);
    for (const value of ['', 'abc', ID.toUpperCase(), `${ID}x`, undefined]) {
      refused(() => parseShopId(value));
    }
  });
});
