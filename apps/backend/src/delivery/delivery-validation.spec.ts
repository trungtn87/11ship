import { describe, expect, it } from '@jest/globals';
import { parseShopListQuery } from './delivery-validation';

describe('M07 shop delivery filters', () => {
  it('keeps the older active default, while 11Food can explicitly show all history', () => {
    expect(parseShopListQuery({})).toMatchObject({ scope: 'active', filter: 'all', limit: 50, offset: 0 });
    expect(parseShopListQuery({ scope: 'all', filter: 'all' })).toMatchObject({ scope: 'all', filter: 'all' });
    expect(parseShopListQuery({ scope: 'history', q: 'G-01' })).toMatchObject({ scope: 'history', q: 'G-01' });
  });

  it('accepts the supported server-side status, date and paging query', () => {
    const q = parseShopListQuery({
      scope: 'all',
      filter: 'delivering',
      q: 'K01-0001',
      from: '2026-10-21T17:00:00.000Z',
      to: '2026-10-22T17:00:00.000Z',
      limit: '20',
      offset: '40',
    });
    expect(q).toEqual({
      scope: 'all',
      filter: 'delivering',
      q: 'K01-0001',
      fromMs: Date.parse('2026-10-21T17:00:00.000Z'),
      toMs: Date.parse('2026-10-22T17:00:00.000Z'),
      limit: 20,
      offset: 40,
    });
  });

  it('rejects unknown states, invalid time bounds and unbounded page sizes', () => {
    expect(() => parseShopListQuery({ filter: 'anything' })).toThrow();
    expect(() => parseShopListQuery({ scope: 'unknown' })).toThrow();
    expect(() => parseShopListQuery({ offset: '-1' })).toThrow();
    expect(() => parseShopListQuery({ limit: '1000' })).toThrow();
    expect(() => parseShopListQuery({ from: '2026-10-22T17:00:00.000Z', to: '2026-10-21T17:00:00.000Z' })).toThrow();
    expect(() => parseShopListQuery({ q: '%'.repeat(41) })).toThrow();
  });
});
