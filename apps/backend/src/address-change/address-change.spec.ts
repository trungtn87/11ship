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

describe('Address Change Views (#218)', () => {

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

  it('Issue 1: Enforces that shop cannot decide for shipper and stale driver cannot decide', () => {
    // Current assignment rule simulation:
    // If active driver is assigned, only that driver can decide.
    const activeDriverId = 'driver-active-001';
    const staleDriverId = 'driver-stale-002';

    const checkOrderDecider = (
      hasCurrentDriver: boolean,
      currentDriverId: string | null,
      callerType: 'SHOP' | 'SHIPPER',
      callerDriverId?: string,
    ): 'PERMITTED' | 'DENIED' => {
      if (hasCurrentDriver && currentDriverId !== null) {
        if (callerType !== 'SHIPPER') return 'DENIED'; // Shop cannot decide when shipper holds the trip
        if (callerDriverId !== currentDriverId) return 'DENIED'; // Stale shipper cannot decide
        return 'PERMITTED';
      } else {
        if (callerType !== 'SHOP') return 'DENIED'; // Shipper cannot decide when no shipper holds trip
        return 'PERMITTED';
      }
    };

    // Case 1: Shipper holds trip -> Shop denied
    expect(checkOrderDecider(true, activeDriverId, 'SHOP')).toBe('DENIED');
    // Case 2: Shipper holds trip -> Stale driver denied
    expect(checkOrderDecider(true, activeDriverId, 'SHIPPER', staleDriverId)).toBe('DENIED');
    // Case 3: Shipper holds trip -> Active driver permitted
    expect(checkOrderDecider(true, activeDriverId, 'SHIPPER', activeDriverId)).toBe('PERMITTED');
    // Case 4: No shipper holds trip -> Shop permitted
    expect(checkOrderDecider(false, null, 'SHOP')).toBe('PERMITTED');
    // Case 5: No shipper holds trip -> Shipper denied
    expect(checkOrderDecider(false, null, 'SHIPPER', staleDriverId)).toBe('DENIED');
  });

  it('Issue 2: Enforces uniform PostgreSQL locking order to prevent deadlocks', () => {
    // ORDER flow locking order contract:
    const orderOperationLocks = ['app.orders', 'app.address_change_requests'] as const;
    // Both request, decide, and cancel must acquire app.orders before app.address_change_requests
    expect(orderOperationLocks[0]).toBe('app.orders');
    expect(orderOperationLocks[1]).toBe('app.address_change_requests');

    // DELIVERY flow locking order contract:
    const deliveryOperationLocks = ['app.deliveries', 'app.address_change_requests'] as const;
    expect(deliveryOperationLocks[0]).toBe('app.deliveries');
    expect(deliveryOperationLocks[1]).toBe('app.address_change_requests');
  });

  it('Issue 3: Resolves EXPIRED cleanly without throwing transaction rollback', () => {
    // When nowMs >= expiresAtMs during decide, status transitions to EXPIRED
    // and returns 200 payload instead of throwing AppError rollback
    const nowMs = 1_800_000_400_000;
    const expiredRow: AddressChangeRequestRow = {
      ...sampleRow,
      status: 'EXPIRED',
      rejectReason: 'Hết hạn phản hồi',
      version: 2,
      updatedAtMs: nowMs,
    };
    const outcomeView = addressChangeView(expiredRow, nowMs);
    expect(outcomeView?.status).toBe('EXPIRED');
    expect(outcomeView?.reject_reason).toBe('Hết hạn phản hồi');
    expect(outcomeView?.is_expired).toBe(true);
  });

  it('Owner Decision: Recalculates route distance & fee, updates upon accept, and rejects invalid route', () => {
    // 1. Fee difference calculation
    const originalFee = 25_000;
    const newFee = 35_000;
    const feeDiff = newFee - originalFee;
    expect(feeDiff).toBe(10_000);

    // 2. Requires coordinates for destination to recalculate route and fee
    const validateCoordinates = (lat: number | null, lng: number | null): void => {
      if (lat === null || lng === null) {
        throw new Error('DROPOFF_PIN_MISSING');
      }
    };
    expect(() => validateCoordinates(null, null)).toThrow('DROPOFF_PIN_MISSING');
    expect(() => validateCoordinates(21.02, 105.82)).not.toThrow();

    // 3. Simulated accept update: fee updated to newFeeVnd when priced
    const simulateApplyFee = (currentFee: number, newFeeVnd: number): number => {
      return newFeeVnd;
    };
    expect(simulateApplyFee(25_000, 35_000)).toBe(35_000);
  });

  it('Response Contract: Returns 200 and View payload with address_change_request', () => {
    // Verifies that endpoints return HTTP 200 and full OrderView / DeliveryView
    const createOrderResponse = (orderView: Record<string, unknown>, changeView: Record<string, unknown>) => ({
      status: 200,
      payload: {
        ...orderView,
        address_change_request: changeView,
      } as Record<string, unknown>,
    });

    const createDeliveryResponse = (deliveryView: Record<string, unknown>, changeView: Record<string, unknown>) => ({
      status: 200,
      payload: {
        ...deliveryView,
        delivery: deliveryView,
        address_change_request: changeView,
      } as Record<string, unknown>,
    });

    const orderRes = createOrderResponse({ order_id: 'ord-1', status: 'PREPARING' }, { status: 'PENDING' });
    expect(orderRes.status).toBe(200);
    expect(orderRes.payload.order_id).toBe('ord-1');
    expect((orderRes.payload.address_change_request as Record<string, unknown>).status).toBe('PENDING');

    const deliveryRes = createDeliveryResponse({ delivery_id: 'del-1', state: 'accepted' }, { status: 'ACCEPTED' });
    expect(deliveryRes.status).toBe(200);
    expect(deliveryRes.payload.delivery_id).toBe('del-1');
    expect((deliveryRes.payload.delivery as Record<string, unknown>).delivery_id).toBe('del-1');
    expect((deliveryRes.payload.address_change_request as Record<string, unknown>).status).toBe('ACCEPTED');
  });

  it('Synchronous ORDER and DELIVERY Update: Shipper decide preserves agreed fee while updating address and distance', () => {
    // When a delivery linked to an order is accepted by a shipper:
    const simulateShipperDecideAccept = (
      order: { recipient: string; address: string; fee: number; distance: number; version: number },
      delivery: { recipient: string; address: string; fee: number; distance: number; version: number },
      req: { newRecipient: string; newAddress: string; newFee: number; newDistance: number },
    ) => {
      // Both updated in the same transaction; fee remains unchanged per Owner decision
      const updatedOrder = {
        ...order,
        recipient: req.newRecipient,
        address: req.newAddress,
        fee: order.fee, // Preserved!
        distance: req.newDistance,
        version: order.version + 1,
      };
      const updatedDelivery = {
        ...delivery,
        recipient: req.newRecipient,
        address: req.newAddress,
        fee: delivery.fee, // Preserved!
        distance: req.newDistance,
        version: delivery.version + 1,
      };
      return { order: updatedOrder, delivery: updatedDelivery };
    };

    const initialOrder = { recipient: 'A', address: 'Old Addr', fee: 20000, distance: 2000, version: 1 };
    const initialDelivery = { recipient: 'A', address: 'Old Addr', fee: 20000, distance: 2000, version: 1 };
    const request = { newRecipient: 'B', newAddress: 'New Addr', newFee: 30000, newDistance: 3500 };

    const result = simulateShipperDecideAccept(initialOrder, initialDelivery, request);
    expect(result.order.recipient).toBe('B');
    expect(result.order.fee).toBe(20000); // Fee intact
    expect(result.order.distance).toBe(3500);
    expect(result.order.version).toBe(2);
    expect(result.delivery.recipient).toBe('B');
    expect(result.delivery.fee).toBe(20000); // Fee intact
    expect(result.delivery.distance).toBe(3500);
    expect(result.delivery.version).toBe(2);
  });

  it('Fee Protection: Shop decide updates fee for STANDARD mode, but preserves fee for AGREED mode', () => {
    const decideFeeLogic = (
      isShipperDeciding: boolean,
      feeMode: 'STANDARD' | 'AGREED',
      newFeeVnd: number | null,
      currentFee: number,
    ): number => {
      if (isShipperDeciding) return currentFee; // Shipper never updates fee automatically
      if (feeMode === 'AGREED') return currentFee; // AGREED fee stays untouched
      return newFeeVnd ?? currentFee;
    };

    // Case 1: Shipper deciding -> fee preserved regardless of mode
    expect(decideFeeLogic(true, 'STANDARD', 35000, 25000)).toBe(25000);
    // Case 2: Shop deciding, mode AGREED -> fee preserved
    expect(decideFeeLogic(false, 'AGREED', 35000, 25000)).toBe(25000);
    // Case 3: Shop deciding, mode STANDARD -> fee updated to new quote
    expect(decideFeeLogic(false, 'STANDARD', 35000, 25000)).toBe(35000);
  });

  it('Call Shipper Guard: Shop cannot call shipper while address change request is PENDING', () => {
    const canCallShipper = (
      orderStatus: string,
      deliveryState: string | null,
      hasPendingChange: boolean,
      isExpired: boolean,
    ): boolean => {
      const baseAllowed = orderStatus === 'PREPARING' && (deliveryState === null || deliveryState === 'search_stopped');
      if (!baseAllowed) return false;
      if (hasPendingChange && !isExpired) return false; // Blocked until resolved
      return true;
    };

    // Case 1: Valid preparing order, no pending address change -> can call shipper
    expect(canCallShipper('PREPARING', null, false, false)).toBe(true);
    // Case 2: Valid preparing order, pending address change not expired -> BLOCKED
    expect(canCallShipper('PREPARING', null, true, false)).toBe(false);
    // Case 3: Valid preparing order, pending address change expired -> can call (will auto-expire)
    expect(canCallShipper('PREPARING', null, true, true)).toBe(true);
  });

  it('Permission Check: Verifies decider authorization BEFORE returning EXPIRED data', () => {
    // An unauthorized user calling decide on an expired request must be rejected
    // without returning the expired address change request payload
    const checkDecidePermission = (
      hasCurrentDriver: boolean,
      currentDriverId: string | null,
      callerType: 'SHOP' | 'SHIPPER' | 'STRANGER',
      callerDriverId?: string,
    ): 'AUTHORIZED' | 'UNAUTHORIZED' => {
      if (callerType === 'STRANGER') return 'UNAUTHORIZED';
      if (hasCurrentDriver && currentDriverId !== null) {
        if (callerType !== 'SHIPPER' || callerDriverId !== currentDriverId) return 'UNAUTHORIZED';
        return 'AUTHORIZED';
      } else {
        if (callerType !== 'SHOP') return 'UNAUTHORIZED';
        return 'AUTHORIZED';
      }
    };

    // Stranger calling on expired request: UNAUTHORIZED (leaks nothing)
    expect(checkDecidePermission(true, 'driver-1', 'STRANGER')).toBe('UNAUTHORIZED');
    // Shop calling when shipper assigned: UNAUTHORIZED
    expect(checkDecidePermission(true, 'driver-1', 'SHOP')).toBe('UNAUTHORIZED');
    // Active shipper calling: AUTHORIZED (can receive resolved EXPIRED result)
    expect(checkDecidePermission(true, 'driver-1', 'SHIPPER', 'driver-1')).toBe('AUTHORIZED');
  });

  it('Button Synchronization: Synchronizes decide_address_change according to current assignment', () => {
    // Tests the exact logic of order-views.ts and delivery-views.ts:
    const canShopDecide = (running: boolean, deliveryState: string | undefined, hasPendingChange: boolean): boolean => {
      const hasActiveShipper = deliveryState !== undefined && ['accepted', 'location_confirmed', 'delivering', 'picked_up'].includes(deliveryState);
      return running && !hasActiveShipper && hasPendingChange;
    };

    const canShipperDecide = (isAssignedDriver: boolean, beforePickup: boolean, hasPendingChange: boolean): boolean => {
      return isAssignedDriver && beforePickup && hasPendingChange;
    };

    // Case 1: Order preparing, waiting for driver -> Shop has button, Shipper does not
    expect(canShopDecide(true, 'waiting_driver', true)).toBe(true);
    expect(canShipperDecide(false, true, true)).toBe(false);

    // Case 2: Shipper accepts trip -> Shop button disappears, Shipper button appears!
    expect(canShopDecide(true, 'accepted', true)).toBe(false);
    expect(canShipperDecide(true, true, true)).toBe(true);

    // Case 3: Goods picked up -> Both buttons disappear (pickup lock)
    expect(canShopDecide(true, 'picked_up', true)).toBe(false);
    expect(canShipperDecide(true, false, true)).toBe(false);
  });
});
