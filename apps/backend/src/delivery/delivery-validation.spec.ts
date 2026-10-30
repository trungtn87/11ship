import { describe, expect, it } from '@jest/globals';
import { parseCustomerCreateBody, parseShopListQuery, parseToggleLocationBody } from './delivery-validation';

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

describe('M07 customer delivery validation (Phần A, B, C)', () => {
  const validBase = {
    sender_name: 'Người gửi',
    sender_phone: '0901234567',
    pickup_address_text: '123 Đường Láng, Hà Nội',
    recipient_name: 'Người nhận',
    recipient_phone: '0987654321',
    dropoff_address_text: '456 Cầu Giấy, Hà Nội',
    goods_description: 'Tài liệu hợp đồng',
  };

  it('allows creation without GPS coordinates (missing GPS does not block creation)', () => {
    const parsed = parseCustomerCreateBody(validBase);
    expect(parsed.pickupLat).toBeNull();
    expect(parsed.pickupLng).toBeNull();
    expect(parsed.dropoffLat).toBeNull();
    expect(parsed.dropoffLng).toBeNull();
    expect(parsed.codVnd).toBe(0);
    expect(parsed.feePayer).toBe('SENDER');
  });

  it('allows creation with full GPS coordinates', () => {
    const parsed = parseCustomerCreateBody({
      ...validBase,
      pickup_lat: 21.0285,
      pickup_lng: 105.8542,
      dropoff_lat: 21.0333,
      dropoff_lng: 105.8000,
    });
    expect(parsed.pickupLat).toBe(21.0285);
    expect(parsed.pickupLng).toBe(105.8542);
    expect(parsed.dropoffLat).toBe(21.0333);
    expect(parsed.dropoffLng).toBe(105.8000);
  });

  it('rejects incomplete coordinates on either end', () => {
    expect(() => parseCustomerCreateBody({ ...validBase, pickup_lat: 21.0285 })).toThrow();
    expect(() => parseCustomerCreateBody({ ...validBase, dropoff_lng: 105.8000 })).toThrow();
  });

  it('handles optional COD amount up to 10M VND and fee payers', () => {
    const parsed = parseCustomerCreateBody({
      ...validBase,
      cod_vnd: 500000,
      fee_payer: 'RECIPIENT',
    });
    expect(parsed.codVnd).toBe(500000);
    expect(parsed.feePayer).toBe('RECIPIENT');

    expect(() => parseCustomerCreateBody({ ...validBase, cod_vnd: -1000 })).toThrow();
    expect(() => parseCustomerCreateBody({ ...validBase, cod_vnd: 10000001 })).toThrow();
    expect(() => parseCustomerCreateBody({ ...validBase, fee_payer: 'INVALID' })).toThrow();
    expect(() => parseCustomerCreateBody({ ...validBase, fee_payer: 'CUSTOMER' })).toThrow();
    expect(() => parseCustomerCreateBody({ ...validBase, fee_payer: 'SHOP' })).toThrow();
  });

  it('validates toggle location body', () => {
    expect(parseToggleLocationBody({ share_location: true })).toEqual({ shareLocation: true });
    expect(parseToggleLocationBody({ share_location: false })).toEqual({ shareLocation: false });
    expect(() => parseToggleLocationBody({ share_location: 'true' })).toThrow();
  });
});
