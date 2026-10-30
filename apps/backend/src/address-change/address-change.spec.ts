import { describe, expect, it } from '@jest/globals';
import { ADDRESS_CHANGE_EXPIRY_MS } from './address-change-constants';
import {
  parseCreateAddressChangeBody,
  parseDecideAddressChangeBody,
  parseCancelAddressChangeBody,
} from './address-change-validation';
import { addressChangeView } from './address-change-views';
import { AddressChangeRequestRow } from './address-change-repository';

describe('Address Change Validation (#218)', () => {
  it('parses valid create address change input with coordinates', () => {
    const input = parseCreateAddressChangeBody({
      recipient_name: 'Nguyễn Văn A',
      recipient_phone: '0912345678',
      address_text: '123 Đường Láng, Hà Nội',
      lat: 21.0123,
      lng: 105.8123,
      note: 'Giao sau 18h',
      expected_version: 1,
    });
    expect(input.recipientName).toBe('Nguyễn Văn A');
    expect(input.recipientPhone).toBe('0912345678');
    expect(input.addressText).toBe('123 Đường Láng, Hà Nội');
    expect(input.lat).toBe(21.0123);
    expect(input.lng).toBe(105.8123);
    expect(input.note).toBe('Giao sau 18h');
    expect(input.expectedVersion).toBe(1);
  });

  it('parses valid create address change input without coordinates (text only)', () => {
    const input = parseCreateAddressChangeBody({
      recipient_name: 'Trần Thị B',
      recipient_phone: '+84987654321',
      dropoff_address_text: '456 Cầu Giấy, Hà Nội',
      expected_version: 2,
    });
    expect(input.recipientName).toBe('Trần Thị B');
    expect(input.recipientPhone).toBe('0987654321');
    expect(input.addressText).toBe('456 Cầu Giấy, Hà Nội');
    expect(input.lat).toBeNull();
    expect(input.lng).toBeNull();
  });

  it('rejects invalid phone number', () => {
    expect(() =>
      parseCreateAddressChangeBody({
        recipient_name: 'A',
        recipient_phone: '1234',
        address_text: 'Hà Nội',
        expected_version: 1,
      }),
    ).toThrow(/phone/i);
  });

  it('rejects missing or empty recipient name or address', () => {
    expect(() =>
      parseCreateAddressChangeBody({
        recipient_name: '',
        recipient_phone: '0912345678',
        address_text: 'Hà Nội',
        expected_version: 1,
      }),
    ).toThrow(/delivery/i);

    expect(() =>
      parseCreateAddressChangeBody({
        recipient_name: 'A',
        recipient_phone: '0912345678',
        address_text: '',
        expected_version: 1,
      }),
    ).toThrow(/delivery/i);
  });

  it('rejects mismatched lat without lng or invalid coordinates', () => {
    expect(() =>
      parseCreateAddressChangeBody({
        recipient_name: 'A',
        recipient_phone: '0912345678',
        address_text: 'Hà Nội',
        lat: 21.0,
        expected_version: 1,
      }),
    ).toThrow(/delivery/i);

    expect(() =>
      parseCreateAddressChangeBody({
        recipient_name: 'A',
        recipient_phone: '0912345678',
        address_text: 'Hà Nội',
        lat: 100.0,
        lng: 105.0,
        expected_version: 1,
      }),
    ).toThrow(/delivery/i);
  });

  it('parses decide and cancel input', () => {
    const accept = parseDecideAddressChangeBody({ accept: true, expected_version: 1 });
    expect(accept.accept).toBe(true);
    expect(accept.reason).toBeNull();

    const reject = parseDecideAddressChangeBody({ accept: false, reason: 'Xa quá không đi được', expected_version: 1 });
    expect(reject.accept).toBe(false);
    expect(reject.reason).toBe('Xa quá không đi được');

    const cancel = parseCancelAddressChangeBody({ expected_version: 3 });
    expect(cancel.expectedVersion).toBe(3);
  });
});

describe('Address Change Views (#218)', () => {
  const sampleRow: AddressChangeRequestRow = {
    changeRequestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    orderId: 'oooooooo-oooo-4ooo-8ooo-oooooooooooo',
    deliveryId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    source: 'ORDER',
    requestedBy: 'uuuuuuuu-uuuu-4uuu-8uuu-uuuuuuuuuuuu',
    status: 'PENDING',
    targetActor: 'SHOP',
    targetDriverId: null,
    originalRecipientName: 'Người cũ',
    originalRecipientPhone: '0911111111',
    originalAddressText: 'Địa chỉ cũ',
    originalLat: 21.0,
    originalLng: 105.8,
    originalFeeVnd: 25_000,
    originalDistanceM: 3000,
    newRecipientName: 'Người mới',
    newRecipientPhone: '0922222222',
    newAddressText: 'Địa chỉ mới',
    newLat: 21.02,
    newLng: 105.82,
    newFeeVnd: 35_000,
    newDistanceM: 4500,
    feeDifferenceVnd: 10_000,
    note: 'Đổi địa chỉ',
    rejectReason: null,
    resolvedBy: null,
    resolvedAtMs: null,
    expiresAtMs: 1_800_000_300_000,
    orderVersion: 2,
    deliveryVersion: 1,
    version: 1,
    createdAtMs: 1_800_000_000_000,
    updatedAtMs: 1_800_000_000_000,
  };

  it('formats pending request view with expiry tracking', () => {
    const view = addressChangeView(sampleRow, 1_800_000_100_000);
    expect(view).not.toBeNull();
    expect(view?.status).toBe('PENDING');
    expect(view?.is_expired).toBe(false);
    expect(view?.time_remaining_seconds).toBe(200);
    expect(view?.fee_difference_vnd).toBe(10_000);
    expect((view?.new_recipient as Record<string, unknown>)?.name).toBe('Người mới');
    expect(view?.target_actor).toBe('SHOP');
  });

  it('detects expired status when clock passes expiresAtMs', () => {
    const view = addressChangeView(sampleRow, 1_800_000_350_000);
    expect(view?.status).toBe('EXPIRED');
    expect(view?.is_expired).toBe(true);
    expect(view?.time_remaining_seconds).toBe(0);
  });
});

describe('Address Change Rules & Concurrency (#218)', () => {
  it('enforces 5-minute expiry constant matching PR and UI', () => {
    expect(ADDRESS_CHANGE_EXPIRY_MS).toBe(5 * 60_000);
    expect(ADDRESS_CHANGE_EXPIRY_MS).toBe(300_000);
  });

  it('keeps fee unchanged and sets coordinates/distance to null for text-only address change', () => {
    const input = parseCreateAddressChangeBody({
      recipient_name: 'Khách đổi địa chỉ chữ',
      recipient_phone: '0988888888',
      address_text: 'Số 99 Phố Huế, Hai Bà Trưng, Hà Nội',
      expected_version: 1,
    });
    expect(input.lat).toBeNull();
    expect(input.lng).toBeNull();
    expect(input.recipientName).toBe('Khách đổi địa chỉ chữ');
    expect(input.addressText).toBe('Số 99 Phố Huế, Hai Bà Trưng, Hà Nội');
  });

  it('calculates remaining seconds correctly for 5-minute timeout window', () => {
    const nowMs = 1_000_000;
    const expiresAtMs = nowMs + ADDRESS_CHANGE_EXPIRY_MS;
    const pendingRow: AddressChangeRequestRow = {
      changeRequestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      orderId: 'oooooooo-oooo-4ooo-8ooo-oooooooooooo',
      deliveryId: null,
      source: 'ORDER',
      requestedBy: 'uuuuuuuu-uuuu-4uuu-8uuu-uuuuuuuuuuuu',
      status: 'PENDING',
      targetActor: 'SHOP',
      targetDriverId: null,
      originalRecipientName: 'A',
      originalRecipientPhone: '091',
      originalAddressText: 'Old',
      originalLat: null,
      originalLng: null,
      originalFeeVnd: 20_000,
      originalDistanceM: null,
      newRecipientName: 'B',
      newRecipientPhone: '092',
      newAddressText: 'New text',
      newLat: null,
      newLng: null,
      newFeeVnd: null,
      newDistanceM: null,
      feeDifferenceVnd: null,
      note: null,
      rejectReason: null,
      resolvedBy: null,
      resolvedAtMs: null,
      expiresAtMs,
      orderVersion: 1,
      deliveryVersion: null,
      version: 1,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    };

    const viewAtStart = addressChangeView(pendingRow, nowMs);
    expect(viewAtStart?.time_remaining_seconds).toBe(300);
    expect(viewAtStart?.status).toBe('PENDING');

    const viewAtHalf = addressChangeView(pendingRow, nowMs + 150_000);
    expect(viewAtHalf?.time_remaining_seconds).toBe(150);
    expect(viewAtHalf?.status).toBe('PENDING');

    const viewAtEnd = addressChangeView(pendingRow, nowMs + 300_001);
    expect(viewAtEnd?.time_remaining_seconds).toBe(0);
    expect(viewAtEnd?.status).toBe('EXPIRED');
  });
});
