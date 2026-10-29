import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from '@jest/globals';
import { AppError } from '../common/app-errors';
import {
  parseAddressCreateBody,
  parseAddressId,
  parseAddressUpdateBody,
  rejectBodyAndQuery,
  rejectQuery,
} from './customers-validation';

const VALID = { label: 'HOME', contact_phone: '0901234567', address_description: 'Tổ 5, phường Thục Phán, Cao Bằng' };

describe('parseAddressCreateBody', () => {
  it('keeps the legacy APK contract: only label, phone and address are required', () => {
    expect(parseAddressCreateBody(VALID)).toEqual({
      label: 'HOME',
      displayName: null,
      recipientName: null,
      contactPhone: '+84901234567',
      addressDescription: 'Tổ 5, phường Thục Phán, Cao Bằng',
      latitude: null,
      longitude: null,
      deliveryNote: null,
      pickupDefault: false,
      deliveryDefault: false,
    });
  });

  it('trims text, turns a blank optional text into null, keeps a position and the default flag', () => {
    expect(
      parseAddressCreateBody({
        ...VALID,
        label: 'OFFICE',
        contact_phone: '+84901234567',
        recipient_name: '  Nguyễn Văn A  ',
        address_description: '  Đường Hoàng Đình Giong  ',
        delivery_note: '   ',
        latitude: 22.6657,
        longitude: 106.2522,
        is_default: true,
      }),
    ).toEqual({
      label: 'OFFICE',
      displayName: null,
      recipientName: 'Nguyễn Văn A',
      contactPhone: '+84901234567',
      addressDescription: 'Đường Hoàng Đình Giong',
      latitude: 22.6657,
      longitude: 106.2522,
      deliveryNote: null,
      pickupDefault: false,
      deliveryDefault: true,
    });
  });

  it('absent, null and blank recipient names mean the same for legacy APKs', () => {
    const absent = parseAddressCreateBody(VALID);
    const nulls = parseAddressCreateBody({ ...VALID, display_name: null, recipient_name: null, delivery_note: null, latitude: null, longitude: null });
    const blank = parseAddressCreateBody({ ...VALID, recipient_name: '   ' });
    expect(nulls).toEqual(absent);
    expect(blank).toEqual(absent);
  });

  it('refuses a missing required key (M05-08), an extra key and an identity selector', () => {
    for (const body of [
      {},
      { label: 'HOME', contact_phone: '0901234567' },
      { label: 'HOME', address_description: 'x' },
      { contact_phone: '0901234567', address_description: 'x' },
      { ...VALID, customer_id: '00000000-0000-4000-8000-000000000001' },
      { ...VALID, user_id: '00000000-0000-4000-8000-000000000001' },
      { ...VALID, is_active: false },
      { ...VALID, version: 1 },
      [],
      null,
      'label',
    ]) {
      expect(() => parseAddressCreateBody(body)).toThrow(BadRequestException);
    }
  });

  it('refuses a blank address, an unknown label and a wrong type', () => {
    for (const patch of [
      { address_description: '' },
      { address_description: '    ' },
      { address_description: 'a'.repeat(301) },
      { address_description: 5 },
      { label: 'WORK' },
      { label: 'home' },
      { label: null },
      { recipient_name: 'a'.repeat(121) },
      { recipient_name: 7 },
      { display_name: 'a'.repeat(51) },
      { delivery_note: 'a'.repeat(201) },
      { delivery_note: false },
      { is_default: 'true' },
      { is_default: 1 },
      { address_description: 'a\u0000b' },
    ]) {
      expect(() => parseAddressCreateBody({ ...VALID, ...patch })).toThrow(BadRequestException);
    }
  });

  it('a bad phone is INVALID_PHONE, never an echo', () => {
    for (const phone of ['', '123', '09012345678', '+85501234567', '0901 234 567', 901234567, null, undefined]) {
      try {
        parseAddressCreateBody({ ...VALID, contact_phone: phone });
        throw new Error('expected a refusal');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe('INVALID_PHONE');
      }
    }
  });

  it('a position is both coordinates in range or none (M05-07: no GPS is fine)', () => {
    for (const patch of [
      { latitude: 10 },
      { longitude: 10 },
      { latitude: 10, longitude: null },
      { latitude: 91, longitude: 10 },
      { latitude: -91, longitude: 10 },
      { latitude: 10, longitude: 181 },
      { latitude: 10, longitude: -181 },
      { latitude: '10', longitude: 10 },
      { latitude: Number.POSITIVE_INFINITY, longitude: 10 },
      { latitude: Number.NaN, longitude: 10 },
    ]) {
      expect(() => parseAddressCreateBody({ ...VALID, ...patch })).toThrow(BadRequestException);
    }
    expect(parseAddressCreateBody({ ...VALID, latitude: 0, longitude: -0 })).toMatchObject({ latitude: 0, longitude: 0 });
    expect(Object.is(parseAddressCreateBody({ ...VALID, latitude: -0, longitude: -0 }).latitude, 0)).toBe(true);
    expect(parseAddressCreateBody({ ...VALID, latitude: 90, longitude: -180 })).toMatchObject({ latitude: 90, longitude: -180 });
  });
});

describe('parseAddressUpdateBody', () => {
  it('needs expected_version and at least one change', () => {
    expect(parseAddressUpdateBody({ expected_version: 2, delivery_note: 'Gọi trước' })).toEqual({
      expectedVersion: 2,
      patch: { deliveryNote: 'Gọi trước' },
    });
    for (const body of [{}, { expected_version: 1 }, { delivery_note: 'x' }, { expected_version: 0, delivery_note: 'x' }, { expected_version: '1', delivery_note: 'x' }]) {
      expect(() => parseAddressUpdateBody(body)).toThrow(BadRequestException);
    }
  });

  it('only the keys sent are changed; null clears an optional field and a position together', () => {
    expect(parseAddressUpdateBody({ expected_version: 1, display_name: null, recipient_name: '', delivery_note: '', latitude: null, longitude: null })).toEqual({
      expectedVersion: 1,
      patch: { displayName: null, recipientName: null, deliveryNote: null, position: null },
    });
    expect(
      parseAddressUpdateBody({ expected_version: 3, label: 'OTHER', contact_phone: '84901234567', address_description: ' Xóm Nà Cạn ', latitude: 22.5, longitude: 106.1 }),
    ).toEqual({
      expectedVersion: 3,
      patch: { label: 'OTHER', contactPhone: '+84901234567', addressDescription: 'Xóm Nà Cạn', position: { latitude: 22.5, longitude: 106.1 } },
    });
  });

  it('a half position, a blank address, a null phone, an identity or status field is refused', () => {
    for (const patch of [
      { latitude: 10 },
      { longitude: 10 },
      { latitude: 10, longitude: null },
      { address_description: '  ' },
      { address_description: null },
      { label: null },
      { customer_id: '00000000-0000-4000-8000-000000000001' },
      { is_active: false },
      { id: '00000000-0000-4000-8000-000000000001' },
    ]) {
      expect(() => parseAddressUpdateBody({ expected_version: 1, ...patch })).toThrow(BadRequestException);
    }
    expect(() => parseAddressUpdateBody({ expected_version: 1, contact_phone: null })).toThrow(AppError);
  });

  it('is_default accepts only true: the default is moved to another address, never simply removed', () => {
    expect(parseAddressUpdateBody({ expected_version: 1, is_default: true })).toEqual({ expectedVersion: 1, patch: { deliveryDefault: true } });
    for (const value of [false, 'true', 1, null]) {
      expect(() => parseAddressUpdateBody({ expected_version: 1, is_default: value, delivery_note: 'x' })).toThrow(BadRequestException);
    }
  });

  it('supports setting and clearing pickup and delivery defaults independently', () => {
    expect(parseAddressUpdateBody({ expected_version: 2, is_pickup_default: true, is_delivery_default: false })).toEqual({
      expectedVersion: 2,
      patch: { pickupDefault: true, deliveryDefault: false },
    });
  });
});

describe('path id, query and body framing', () => {
  it('a malformed address id names no address: CUSTOMER_ADDRESS_NOT_FOUND', () => {
    expect(parseAddressId('00000000-0000-4000-8000-000000000001')).toBe('00000000-0000-4000-8000-000000000001');
    for (const id of ['', 'x', '../me', '00000000-0000-4000-8000-00000000000G', '00000000-0000-4000-8000-000000000001/default', undefined, 5]) {
      expect(() => parseAddressId(id)).toThrow(AppError);
      try {
        parseAddressId(id);
      } catch (error) {
        expect((error as AppError).code).toBe('CUSTOMER_ADDRESS_NOT_FOUND');
      }
    }
  });

  it('no query string is accepted', () => {
    expect(() => rejectQuery(undefined)).not.toThrow();
    expect(() => rejectQuery({})).not.toThrow();
    for (const query of [{ customer_id: 'x' }, { a: '1' }, 'x', null]) {
      expect(() => rejectQuery(query)).toThrow(BadRequestException);
    }
  });

  it('a body-less request refuses any framing of a body, even an empty JSON object', () => {
    expect(() => rejectBodyAndQuery({ headers: {} }, {})).not.toThrow();
    expect(() => rejectBodyAndQuery({ headers: { 'content-length': '0' } }, {})).not.toThrow();
    expect(() => rejectBodyAndQuery({ headers: { 'content-length': '2' } }, {})).toThrow(BadRequestException);
    expect(() => rejectBodyAndQuery({ headers: { 'transfer-encoding': 'chunked' } }, {})).toThrow(BadRequestException);
    expect(() => rejectBodyAndQuery({ headers: {} }, { x: '1' })).toThrow(BadRequestException);
  });
});
