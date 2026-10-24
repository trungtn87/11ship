import { BadRequestException } from '@nestjs/common';
import { normalizeVietnamPhone } from '../auth/phone';
import { shaped, text } from '../delivery/delivery-validation';
import { AGREEMENT_REASONS, AgreementReason } from '../shipping-policy/shipping-fee-agreement';
import { isCanonicalUuid } from '../shared/identifiers';
import { MAX_CART_LINES, MAX_ITEM_NOTE, MAX_LINE_QUANTITY, MAX_ORDER_NOTE, MAX_REASON } from './order-constants';

// Strict parsers of the M10 requests. Every body is an exact object (required keys plus the few optional ones named): no key may be added, so no customer id,
// shop id (other than the shop of a cart), status, price total, version of another record or actor can arrive from a client. Failures never echo the offending
// key or value: a plain 400. Pure: no I/O.

function reject(): never {
  throw new BadRequestException();
}

function whole(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    return reject();
  }
  return value;
}

function versionOf(value: unknown): number {
  return whole(value, 1, Number.MAX_SAFE_INTEGER);
}

function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = text(value, 0, max);
  return normalized === '' ? null : normalized;
}

function uuid(value: unknown): string {
  if (!isCanonicalUuid(value)) {
    return reject();
  }
  return value;
}

export function parseOrderId(value: unknown): string {
  return uuid(value);
}

function coordinate(value: unknown, limit: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit) {
    return reject();
  }
  return value;
}

/** An ISO instant WITH an explicit offset or Z (never a local time guessed from the phone). */
function instant(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/u.test(value)) {
    return reject();
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : reject();
}

export interface LineInput {
  readonly itemId: string;
  readonly quantity: number;
  readonly note: string | null;
  /** The unit price the customer saw (placing an order only). */
  readonly expectedPriceVnd: number | null;
}

function lines(value: unknown, withPrice: boolean): LineInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_CART_LINES) {
    return reject();
  }
  return value.map((entry: unknown): LineInput => {
    const l = withPrice ? shaped(entry, ['item_id', 'quantity', 'unit_price_vnd'], ['note']) : shaped(entry, ['item_id', 'quantity'], ['note']);
    return {
      itemId: uuid(l.item_id),
      quantity: whole(l.quantity, 1, MAX_LINE_QUANTITY),
      note: optionalText(l.note, MAX_ITEM_NOTE),
      expectedPriceVnd: withPrice ? whole(l.unit_price_vnd, 1, 99_999_999) : null,
    };
  });
}

export interface CartInput {
  readonly shopId: string;
  readonly lines: readonly LineInput[];
  readonly note: string | null;
}

/** PUT /v1/customers/me/cart : the whole cart (one shop). */
export function parseCartBody(body: unknown): CartInput {
  const b = shaped(body, ['shop_id', 'lines'], ['note']);
  return { shopId: uuid(b.shop_id), lines: lines(b.lines, false), note: optionalText(b.note, MAX_ORDER_NOTE) };
}

export interface AddressInput {
  /** An address of the M05 address book (the server reads its CURRENT text and pin), or a typed one. */
  readonly addressId: string | null;
  readonly addressText: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
}

export interface CheckoutInput {
  readonly shopId: string;
  readonly lines: readonly LineInput[];
  readonly note: string | null;
  readonly recipientName: string;
  readonly recipientPhone: string;
  readonly address: AddressInput;
  readonly scheduledForMs: number | null;
}

function address(value: unknown): AddressInput {
  const a = shaped(value, [], ['address_id', 'address_text', 'lat', 'lng']);
  const byId = a.address_id !== undefined;
  const typed = a.address_text !== undefined;
  if (byId === typed || (byId && (a.lat !== undefined || a.lng !== undefined)) || (a.lat === undefined) !== (a.lng === undefined)) {
    return reject();
  }
  if (byId) {
    return { addressId: uuid(a.address_id), addressText: null, lat: null, lng: null };
  }
  return { addressId: null, addressText: text(a.address_text, 1, 300), lat: a.lat === undefined ? null : coordinate(a.lat, 90), lng: a.lng === undefined ? null : coordinate(a.lng, 180) };
}

function checkout(b: Record<string, unknown>, withPrice: boolean): CheckoutInput {
  const phone = normalizeVietnamPhone(b.recipient_phone);
  if (phone === undefined) {
    return reject();
  }
  return {
    shopId: uuid(b.shop_id),
    lines: lines(b.lines, withPrice),
    note: optionalText(b.note, MAX_ORDER_NOTE),
    recipientName: text(b.recipient_name, 1, 80),
    recipientPhone: phone,
    address: address(b.address),
    scheduledForMs: b.scheduled_for === undefined || b.scheduled_for === null ? null : instant(b.scheduled_for),
  };
}

/** POST /v1/customers/me/orders/preview : what the checkout shows before sending (no prices from the client). */
export function parsePreviewBody(body: unknown): CheckoutInput {
  return checkout(shaped(body, ['shop_id', 'lines', 'recipient_name', 'recipient_phone', 'address'], ['note', 'scheduled_for']), false);
}

export interface PlaceInput extends CheckoutInput {
  readonly clientRef: string;
  /** The total the customer saw: a changed price or dish is refused so they check and send again. */
  readonly expectedItemsTotalVnd: number;
}

/** POST /v1/customers/me/orders : the checkout with the prices and the total the customer saw. */
export function parsePlaceBody(body: unknown): PlaceInput {
  const b = shaped(body, ['client_ref', 'shop_id', 'lines', 'recipient_name', 'recipient_phone', 'address', 'items_total_vnd'], ['note', 'scheduled_for']);
  return { ...checkout(b, true), clientRef: uuid(b.client_ref), expectedItemsTotalVnd: whole(b.items_total_vnd, 1, Number.MAX_SAFE_INTEGER) };
}

export function parseClientRefQuery(query: unknown): string {
  return uuid(shaped(query ?? {}, ['client_ref']).client_ref);
}

export interface CancelInput {
  readonly expectedVersion: number;
  readonly reason: string | null;
}

/** POST /v1/customers/me/orders/:id/cancel : the customer's reason is optional. */
export function parseCustomerCancelBody(body: unknown): CancelInput {
  const b = shaped(body, ['expected_version'], ['reason']);
  return { expectedVersion: versionOf(b.expected_version), reason: optionalText(b.reason, MAX_REASON) };
}

export interface ReorderInput {
  readonly replaceCart: boolean;
}

export function parseReorderBody(body: unknown): ReorderInput {
  const b = shaped(body, [], ['replace_cart']);
  if (b.replace_cart !== undefined && typeof b.replace_cart !== 'boolean') {
    return reject();
  }
  return { replaceCart: b.replace_cart === true };
}

export type CustomerScope = 'processing' | 'scheduled' | 'history';

export interface CustomerListQuery {
  readonly scope: CustomerScope;
  readonly limit: number;
  readonly offset: number;
}

function page(q: Record<string, unknown>): { limit: number; offset: number } {
  const limit = q.limit === undefined ? 30 : Number(q.limit);
  const offset = q.offset === undefined ? 0 : Number(q.offset);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) {
    return reject();
  }
  return { limit, offset };
}

export function parseCustomerListQuery(query: unknown): CustomerListQuery {
  const q = shaped(query ?? {}, [], ['scope', 'limit', 'offset']);
  if (q.scope !== undefined && q.scope !== 'processing' && q.scope !== 'scheduled' && q.scope !== 'history') {
    return reject();
  }
  return { scope: (q.scope ?? 'processing') as CustomerScope, ...page(q) };
}

export const SHOP_FILTERS = ['all', 'pending', 'preparing', 'scheduled', 'delivering', 'attention', 'history'] as const;
export type ShopFilter = (typeof SHOP_FILTERS)[number];

export interface ShopListQuery {
  readonly filter: ShopFilter;
  readonly q: string;
  readonly fromMs: number | null;
  readonly toMs: number | null;
  readonly limit: number;
  readonly offset: number;
}

function day(value: unknown): number | null {
  if (value === undefined) {
    return null;
  }
  return instant(value);
}

export function parseShopListQuery(query: unknown): ShopListQuery {
  const q = shaped(query ?? {}, [], ['filter', 'q', 'from', 'to', 'limit', 'offset']);
  if (q.filter !== undefined && !(SHOP_FILTERS as readonly unknown[]).includes(q.filter)) {
    return reject();
  }
  return { filter: (q.filter ?? 'all') as ShopFilter, q: q.q === undefined ? '' : text(q.q, 0, 40), fromMs: day(q.from), toMs: day(q.to), ...page(q) };
}

export function parseNoQuery(query: unknown): void {
  shaped(query ?? {}, []);
}

export interface EditInput {
  readonly expectedVersion: number;
  readonly changes: readonly { readonly lineId: string; readonly quantity: number | null; readonly unitPriceVnd: number | null; readonly remove: boolean }[];
}

/** POST /v1/shop/me/orders/:id/edit : per line a new quantity, a new unit price, or removal. Only before confirmation. */
export function parseEditBody(body: unknown): EditInput {
  const b = shaped(body, ['expected_version', 'changes']);
  if (!Array.isArray(b.changes) || b.changes.length < 1 || b.changes.length > MAX_CART_LINES) {
    return reject();
  }
  const seen = new Set<string>();
  const changes = b.changes.map((entry: unknown) => {
    const c = shaped(entry, ['line_id'], ['quantity', 'unit_price_vnd', 'remove']);
    const lineId = uuid(c.line_id);
    if (seen.has(lineId) || (c.remove !== undefined && c.remove !== true)) {
      return reject();
    }
    seen.add(lineId);
    const remove = c.remove === true;
    if (remove && (c.quantity !== undefined || c.unit_price_vnd !== undefined)) {
      return reject();
    }
    if (!remove && c.quantity === undefined && c.unit_price_vnd === undefined) {
      return reject();
    }
    return {
      lineId,
      quantity: c.quantity === undefined ? null : whole(c.quantity, 1, MAX_LINE_QUANTITY),
      unitPriceVnd: c.unit_price_vnd === undefined ? null : whole(c.unit_price_vnd, 1, 99_999_999),
      remove,
    };
  });
  return { expectedVersion: versionOf(b.expected_version), changes };
}

export interface ConfirmInput {
  readonly expectedVersion: number;
  readonly changeReason: string | null;
}

export function parseConfirmBody(body: unknown): ConfirmInput {
  const b = shaped(body, ['expected_version'], ['change_reason']);
  return { expectedVersion: versionOf(b.expected_version), changeReason: optionalText(b.change_reason, MAX_REASON) };
}

export interface ReasonInput {
  readonly expectedVersion: number;
  readonly reason: string;
}

/** A command that needs a reason (reject, cancel the dish order, close as not completed). */
export function parseReasonBody(body: unknown): ReasonInput {
  const b = shaped(body, ['expected_version', 'reason']);
  return { expectedVersion: versionOf(b.expected_version), reason: text(b.reason, 1, MAX_REASON) };
}

export interface FeeDecisionInput {
  readonly accept: boolean;
  /** The VERSION OF THE DELIVERY the customer saw (`delivery.version` of the order). */
  readonly expectedVersion: number;
}

/** POST /v1/customers/me/orders/:id/delivery/fee : the payer answers the fee the Shipper proposed. */
export function parseFeeDecisionBody(body: unknown): FeeDecisionInput {
  const b = shaped(body, ['decision', 'expected_version']);
  if (b.decision !== 'ACCEPT' && b.decision !== 'REJECT') {
    return reject();
  }
  return { accept: b.decision === 'ACCEPT', expectedVersion: versionOf(b.expected_version) };
}

export interface VersionInput {
  readonly expectedVersion: number;
}

export function parseVersionBody(body: unknown): VersionInput {
  return { expectedVersion: versionOf(shaped(body, ['expected_version']).expected_version) };
}

export interface PaymentInput {
  readonly expectedVersion: number;
  readonly paidVnd: number;
}

export function parsePaymentBody(body: unknown): PaymentInput {
  const b = shaped(body, ['expected_version', 'paid_vnd']);
  return { expectedVersion: versionOf(b.expected_version), paidVnd: whole(b.paid_vnd, 0, Number.MAX_SAFE_INTEGER) };
}

export interface CallInput {
  readonly expectedVersion: number;
  readonly feePayer: 'CUSTOMER' | 'SHOP';
  readonly agreedFee: { readonly reasonCode: AgreementReason; readonly reasonNote: string | null; readonly amountVnd: number } | null;
}

/** POST /v1/shop/me/orders/:id/call-shipper : who pays the fee (the customer by default) and, for a fee outside the table, the agreed amount. */
export function parseCallBody(body: unknown): CallInput {
  const b = shaped(body, ['expected_version'], ['fee_payer', 'agreed_fee']);
  if (b.fee_payer !== undefined && b.fee_payer !== 'CUSTOMER' && b.fee_payer !== 'SHOP') {
    return reject();
  }
  let agreedFee: CallInput['agreedFee'] = null;
  if (b.agreed_fee !== undefined) {
    const f = shaped(b.agreed_fee, ['reason_code', 'amount_vnd'], ['reason_note']);
    if (typeof f.reason_code !== 'string' || !(AGREEMENT_REASONS as readonly string[]).includes(f.reason_code)) {
      return reject();
    }
    agreedFee = { reasonCode: f.reason_code as AgreementReason, reasonNote: optionalText(f.reason_note, 200), amountVnd: whole(f.amount_vnd, 0, 10_000_000) };
  }
  return { expectedVersion: versionOf(b.expected_version), feePayer: b.fee_payer === 'SHOP' ? 'SHOP' : 'CUSTOMER', agreedFee };
}

export const ADMIN_ORDER_ACTIONS = ['cancel-order', 'close-not-completed'] as const;
export type AdminOrderAction = (typeof ADMIN_ORDER_ACTIONS)[number];

export function parseAdminAction(value: unknown): AdminOrderAction {
  if (typeof value !== 'string' || !(ADMIN_ORDER_ACTIONS as readonly string[]).includes(value)) {
    return reject();
  }
  return value as AdminOrderAction;
}

export interface AdminListQuery {
  readonly q: string;
  readonly status: string;
  readonly shop: string;
  readonly fromMs: number | null;
  readonly toMs: number | null;
  readonly limit: number;
  readonly offset: number;
}

export function parseAdminListQuery(query: unknown): AdminListQuery {
  const q = shaped(query ?? {}, [], ['q', 'status', 'shop', 'from', 'to', 'limit', 'offset']);
  const status = q.status === undefined ? '' : text(q.status, 0, 24);
  if (status !== '' && !/^[A-Z_]+$/u.test(status)) {
    return reject();
  }
  return { q: q.q === undefined ? '' : text(q.q, 0, 60), status, shop: q.shop === undefined ? '' : text(q.shop, 0, 60), fromMs: day(q.from), toMs: day(q.to), ...page(q) };
}
