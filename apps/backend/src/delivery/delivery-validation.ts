import { BadRequestException } from '@nestjs/common';
import { isWellFormed } from '../auth/auth-validation';
import { normalizeVietnamPhone } from '../auth/phone';
import { AGREEMENT_REASONS, AgreementReason } from '../shipping-policy/shipping-fee-agreement';
import { FeePayer } from './delivery-constants';

// Strict parsers of the M07 requests. Every body is an exact object (required keys, plus the few optional ones named): no key may be added, so no
// shop id, driver id, status, fee mode or version of another record can arrive from a client. Failures never echo the offending key or value: a
// plain 400. Pure: no I/O.

function reject(): never {
  throw new BadRequestException();
}

const CONTROL = /[\p{Cc}\p{Cf}]/u;

/** NFC, collapsed whitespace, trimmed; refuses control / format characters and lengths outside min..max code points. */
export function text(value: unknown, min: number, max: number): string {
  if (typeof value !== 'string' || !isWellFormed(value)) {
    return reject();
  }
  const normalized = value.normalize('NFC').replace(/\s+/gu, ' ').trim();
  const length = [...normalized].length;
  if (CONTROL.test(normalized) || length < min || length > max) {
    return reject();
  }
  return normalized;
}

function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = text(value, 0, max);
  return normalized === '' ? null : normalized;
}

function whole(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    return reject();
  }
  return value;
}

function version(value: unknown): number {
  return whole(value, 1, Number.MAX_SAFE_INTEGER);
}

function coordinate(value: unknown, limit: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit) {
    return reject();
  }
  return value;
}

/** An object with exactly the `required` keys and any subset of the `optional` ones. */
export function shaped(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return reject();
  }
  const keys = Object.keys(value);
  if (!required.every((key) => keys.includes(key)) || !keys.every((key) => required.includes(key) || optional.includes(key))) {
    return reject();
  }
  return value as Record<string, unknown>;
}

export const MAX_COD_VND = 10_000_000;
const MAX_FEE_VND = 10_000_000;
const MAX_MONEY_VND = 9_007_199_254_740_991;

export interface AgreedFeeInput {
  readonly reasonCode: AgreementReason;
  readonly reasonNote: string | null;
  readonly amountVnd: number;
}

export interface CreateDeliveryInput {
  readonly recipientName: string;
  /** Normalized +84 number. */
  readonly recipientPhone: string;
  readonly addressText: string;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly goodsDescription: string;
  readonly goodsValueVnd: number;
  readonly paidVnd: number;
  readonly feePayer: FeePayer;
  readonly note: string | null;
  readonly agreedFee: AgreedFeeInput | null;
  /** Index 0..2 of the fee table's band, chosen by the shop for an address without a map point (a fee ESTIMATE). Null otherwise. */
  readonly feeBand: number | null;
}

/** POST /v1/shop/me/deliveries. */
export function parseCreateBody(body: unknown): CreateDeliveryInput {
  const b = shaped(body, ['recipient_name', 'recipient_phone', 'dropoff_address_text', 'goods_description', 'goods_value_vnd', 'paid_vnd', 'fee_payer'], ['dropoff_lat', 'dropoff_lng', 'note', 'agreed_fee', 'fee_band']);
  const phone = normalizeVietnamPhone(b.recipient_phone);
  if (phone === undefined || (b.fee_payer !== 'CUSTOMER' && b.fee_payer !== 'SHOP')) {
    return reject();
  }
  const hasLat = b.dropoff_lat !== undefined;
  const hasLng = b.dropoff_lng !== undefined;
  if (hasLat !== hasLng) {
    return reject();
  }
  const goodsValueVnd = whole(b.goods_value_vnd, 0, MAX_MONEY_VND);
  const paidVnd = whole(b.paid_vnd, 0, goodsValueVnd);
  const feeBand = b.fee_band === undefined ? null : whole(b.fee_band, 0, 2);
  if (feeBand !== null && (b.agreed_fee !== undefined || hasLat)) {
    // A band is an estimate for an address with no map point; with a map point the route measures the distance and with an agreed fee the amount is proposed.
    return reject();
  }
  let agreedFee: AgreedFeeInput | null = null;
  if (b.agreed_fee !== undefined) {
    const f = shaped(b.agreed_fee, ['reason_code', 'amount_vnd'], ['reason_note']);
    if (typeof f.reason_code !== 'string' || !(AGREEMENT_REASONS as readonly string[]).includes(f.reason_code)) {
      return reject();
    }
    agreedFee = { reasonCode: f.reason_code as AgreementReason, reasonNote: optionalText(f.reason_note, 200), amountVnd: whole(f.amount_vnd, 0, MAX_FEE_VND) };
  }
  return {
    recipientName: text(b.recipient_name, 1, 80),
    recipientPhone: phone,
    addressText: text(b.dropoff_address_text, 1, 300),
    lat: hasLat ? coordinate(b.dropoff_lat, 90) : null,
    lng: hasLng ? coordinate(b.dropoff_lng, 180) : null,
    goodsDescription: text(b.goods_description, 1, 120),
    goodsValueVnd,
    paidVnd,
    feePayer: b.fee_payer,
    note: optionalText(b.note, 200),
    agreedFee,
    feeBand,
  };
}

export interface ReasonInput {
  readonly reason: string;
  readonly expectedVersion: number;
}

/** A command that needs a reason (cancel before pickup, give the delivery back): {reason, expected_version}. */
export function parseReasonBody(body: unknown): ReasonInput {
  const b = shaped(body, ['reason', 'expected_version']);
  return { reason: text(b.reason, 1, 200), expectedVersion: version(b.expected_version) };
}

export interface VersionInput {
  readonly expectedVersion: number;
}

/** {expected_version}. */
export function parseVersionBody(body: unknown): VersionInput {
  return { expectedVersion: version(shaped(body, ['expected_version']).expected_version) };
}

/** {} : a command that names only the target in the path. */
export function parseEmptyBody(body: unknown): void {
  shaped(body, []);
}

export interface CustodyInput {
  readonly resolution: 'GOODS_RETURNED' | 'HANDLED_NO_RETURN';
  readonly note: string | null;
}

/** POST .../custody: GOODS_RETURNED (back at the shop) or HANDLED_NO_RETURN (dealt with; the note says how). */
export function parseCustodyBody(body: unknown): CustodyInput {
  const b = shaped(body, ['resolution'], ['note']);
  if (b.resolution !== 'GOODS_RETURNED' && b.resolution !== 'HANDLED_NO_RETURN') {
    return reject();
  }
  const note = optionalText(b.note, 300);
  if (b.resolution === 'HANDLED_NO_RETURN' && note === null) {
    return reject();
  }
  return { resolution: b.resolution, note };
}

export interface DestinationInput {
  readonly lat: number | null;
  readonly lng: number | null;
  readonly feeVnd: number | null;
  readonly expectedVersion: number;
}

/** POST .../destination: the agreed fee when the delivery has none, and optionally a pin ({lat, lng} together). */
export function parseDestinationBody(body: unknown): DestinationInput {
  const b = shaped(body, ['expected_version'], ['lat', 'lng', 'fee_vnd']);
  if ((b.lat === undefined) !== (b.lng === undefined)) {
    return reject();
  }
  return {
    lat: b.lat === undefined ? null : coordinate(b.lat, 90),
    lng: b.lng === undefined ? null : coordinate(b.lng, 180),
    feeVnd: b.fee_vnd === undefined ? null : whole(b.fee_vnd, 0, MAX_FEE_VND),
    expectedVersion: version(b.expected_version),
  };
}

/** POST .../fee/counter: {amount_vnd}. */
export function parseCounterBody(body: unknown): { readonly amountVnd: number } {
  return { amountVnd: whole(shaped(body, ['amount_vnd']).amount_vnd, 0, MAX_FEE_VND) };
}

export interface LocationInput {
  readonly lat: number;
  readonly lng: number;
  readonly accuracyM: number | null;
}

/** PUT /v1/driver/location: {lat, lng, accuracy_m?}. */
export function parseLocationBody(body: unknown): LocationInput {
  const b = shaped(body, ['lat', 'lng'], ['accuracy_m']);
  let accuracyM: number | null = null;
  if (b.accuracy_m !== undefined) {
    if (typeof b.accuracy_m !== 'number' || !Number.isFinite(b.accuracy_m) || b.accuracy_m < 0 || b.accuracy_m > 100_000) {
      return reject();
    }
    accuracyM = b.accuracy_m;
  }
  return { lat: coordinate(b.lat, 90), lng: coordinate(b.lng, 180), accuracyM };
}

export const SHOP_DELIVERY_FILTERS = ['all', 'searching', 'accepted', 'delivering', 'completed', 'failed'] as const;
export type ShopDeliveryFilter = (typeof SHOP_DELIVERY_FILTERS)[number];

export interface ShopListQuery {
  readonly scope: 'active' | 'history' | 'all';
  readonly filter: ShopDeliveryFilter;
  readonly q: string;
  readonly fromMs: number | null;
  readonly toMs: number | null;
  readonly limit: number;
  readonly offset: number;
}

function shopListDate(value: unknown): number | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return reject();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return reject();
  return parsed;
}

/** Preserves the old active/history default for older clients; 11Food sends scope=all explicitly. */
export function parseShopListQuery(query: unknown): ShopListQuery {
  const q = shaped(query ?? {}, [], ['scope', 'filter', 'q', 'from', 'to', 'limit', 'offset']);
  if (q.scope !== undefined && q.scope !== 'active' && q.scope !== 'history' && q.scope !== 'all') return reject();
  if (q.filter !== undefined && !(SHOP_DELIVERY_FILTERS as readonly unknown[]).includes(q.filter)) return reject();
  const fromMs = shopListDate(q.from);
  const toMs = shopListDate(q.to);
  if (fromMs !== null && toMs !== null && (toMs <= fromMs || toMs - fromMs > 367 * 86_400_000)) return reject();
  const limit = q.limit === undefined ? 50 : Number(q.limit);
  const offset = q.offset === undefined ? 0 : Number(q.offset);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) return reject();
  return {
    scope: q.scope === 'all' ? 'all' : q.scope === 'history' ? 'history' : 'active',
    filter: (q.filter ?? 'all') as ShopDeliveryFilter,
    q: q.q === undefined ? '' : text(q.q, 0, 40),
    fromMs, toMs, limit, offset,
  };
}

export function parseScopeQuery(query: unknown): 'active' | 'history' {
  const q = shaped(query ?? {}, [], ['scope']);
  if (q.scope !== undefined && q.scope !== 'active' && q.scope !== 'history') {
    return reject();
  }
  return q.scope === 'history' ? 'history' : 'active';
}

/** No query at all (a read by id). */
export function parseNoQuery(query: unknown): void {
  shaped(query ?? {}, []);
}

export function parseDeliveryId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
    return reject();
  }
  return value;
}

export interface CreateCustomerDeliveryInput {
  readonly senderName: string;
  readonly senderPhone: string | null;
  readonly pickupAddressText: string;
  readonly pickupLat: number | null;
  readonly pickupLng: number | null;
  readonly recipientName: string;
  readonly recipientPhone: string;
  readonly dropoffAddressText: string;
  readonly dropoffLat: number | null;
  readonly dropoffLng: number | null;
  readonly goodsDescription: string;
  readonly goodsValueVnd: number;
  readonly codVnd: number;
  readonly feePayer: FeePayer;
  readonly note: string | null;
  readonly agreedFee: AgreedFeeInput | null;
}

export function parseCustomerCreateBody(body: unknown): CreateCustomerDeliveryInput {
  const b = shaped(
    body,
    ['recipient_name', 'recipient_phone', 'dropoff_address_text', 'goods_description', 'pickup_address_text'],
    ['sender_name', 'sender_phone', 'pickup_lat', 'pickup_lng', 'dropoff_lat', 'dropoff_lng', 'goods_value_vnd', 'cod_vnd', 'fee_payer', 'note', 'agreed_fee']
  );
  const recipientPhone = normalizeVietnamPhone(b.recipient_phone);
  if (recipientPhone === undefined) return reject();
  const hasSenderPhone = b.sender_phone !== undefined && b.sender_phone !== null && String(b.sender_phone).trim() !== '';
  const senderPhone = hasSenderPhone ? normalizeVietnamPhone(b.sender_phone) : undefined;
  if (hasSenderPhone && senderPhone === undefined) return reject();

  const hasPickupLat = b.pickup_lat !== undefined && b.pickup_lat !== null;
  const hasPickupLng = b.pickup_lng !== undefined && b.pickup_lng !== null;
  if (hasPickupLat !== hasPickupLng) return reject();

  const hasDropoffLat = b.dropoff_lat !== undefined && b.dropoff_lat !== null;
  const hasDropoffLng = b.dropoff_lng !== undefined && b.dropoff_lng !== null;
  if (hasDropoffLat !== hasDropoffLng) return reject();

  const goodsValueVnd = b.goods_value_vnd !== undefined ? whole(b.goods_value_vnd, 0, MAX_MONEY_VND) : 0;
  const codVnd = b.cod_vnd !== undefined ? whole(b.cod_vnd, 0, MAX_COD_VND) : 0;

  const feePayer = (b.fee_payer as FeePayer) ?? 'SENDER';
  if (feePayer !== 'SENDER' && feePayer !== 'RECIPIENT') {
    return reject();
  }

  let agreedFee: AgreedFeeInput | null = null;
  if (b.agreed_fee !== undefined && b.agreed_fee !== null) {
    const f = shaped(b.agreed_fee, ['amount_vnd'], ['reason_code', 'reason_note']);
    const reasonCode = (f.reason_code && (AGREEMENT_REASONS as readonly string[]).includes(f.reason_code as string))
      ? (f.reason_code as AgreementReason)
      : 'OTHER';
    const reasonNote = optionalText(f.reason_note, 200) ?? (reasonCode === 'OTHER' ? 'Khách tự thỏa thuận phí' : null);
    agreedFee = { reasonCode, reasonNote, amountVnd: whole(f.amount_vnd, 1, MAX_FEE_VND) };
  }

  return {
    senderName: b.sender_name !== undefined ? text(b.sender_name, 1, 80) : 'Khách gửi hàng',
    senderPhone: senderPhone ?? null,
    pickupAddressText: text(b.pickup_address_text, 1, 300),
    pickupLat: hasPickupLat ? coordinate(b.pickup_lat, 90) : null,
    pickupLng: hasPickupLng ? coordinate(b.pickup_lng, 180) : null,
    recipientName: text(b.recipient_name, 1, 80),
    recipientPhone,
    dropoffAddressText: text(b.dropoff_address_text, 1, 300),
    dropoffLat: hasDropoffLat ? coordinate(b.dropoff_lat, 90) : null,
    dropoffLng: hasDropoffLng ? coordinate(b.dropoff_lng, 180) : null,
    goodsDescription: text(b.goods_description, 1, 120),
    goodsValueVnd,
    codVnd,
    feePayer,
    note: optionalText(b.note, 200),
    agreedFee,
  };
}

export function parseToggleLocationBody(body: unknown): { shareLocation: boolean } {
  const b = shaped(body, ['share_location']);
  if (typeof b.share_location !== 'boolean') return reject();
  return { shareLocation: b.share_location };
}
