import { MAX_FEE_VND } from './shipping-fee-policy';

// M06 v1.1: the shipping-fee agreement (proposal / counter-offer / acceptance). Pure rules: no I/O, no clock of its own. The caller (M07 through
// ShippingFeeAgreementService) says who acts; M06 never decides who MAY act (roles belong to M07), it decides what the amounts and states allow.
//
//   STANDARD  the fee is the base fee of the three bands: final at once.
//   AGREED    the shop proposes an amount and a reason. A Shipper may agree, skip, or counter. The shop accepts or rejects a counter: rejecting keeps the
//             ORIGINAL proposal and never touches the deadline (the search clock is M07's and does not restart). When the CUSTOMER pays and the amount is
//             not the base fee (or there is no base fee), the customer must confirm before the amount becomes final. After `picked_up` the fee is locked.
//
// Nothing here adds a surcharge by itself (weather, urgency, bulk): an amount exists only because a person proposed or accepted it.

export type FeeMode = 'STANDARD' | 'AGREED';
export type FeePayer = 'CUSTOMER' | 'SHOP';
export type AgreementStatus = 'PROPOSED' | 'COUNTERED' | 'AWAITING_CUSTOMER' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'LOCKED';
export type AgreementReason = 'URGENT' | 'BULKY' | 'BAD_WEATHER' | 'OUT_OF_PRICE_RANGE' | 'OTHER';
export const AGREEMENT_REASONS: readonly AgreementReason[] = ['URGENT', 'BULKY', 'BAD_WEATHER', 'OUT_OF_PRICE_RANGE', 'OTHER'];
export const REASON_NOTE_MAX = 200;

export interface Agreement {
  readonly agreementId: string;
  readonly deliveryId: string;
  readonly feeMode: FeeMode;
  readonly payer: FeePayer;
  readonly status: AgreementStatus;
  readonly baseFeeVnd: number | null;
  readonly basePolicyVersionNo: number | null;
  readonly reasonCode: AgreementReason | null;
  readonly reasonNote: string | null;
  readonly proposedFeeVnd: number | null;
  readonly counterFeeVnd: number | null;
  readonly counterBy: string | null;
  readonly boundDriverId: string | null;
  readonly pendingFeeVnd: number | null;
  readonly pendingSource: 'PROPOSAL' | 'COUNTER' | null;
  /** NULL until the fee is final (accepted / locked). */
  readonly finalFeeVnd: number | null;
  readonly expiresAtMs: number;
  readonly version: number;
  readonly createdBy: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly lockedAtMs: number | null;
}

export type AgreementAction =
  | { readonly type: 'DRIVER_ACCEPT'; readonly driverId: string }
  | { readonly type: 'DRIVER_SKIP'; readonly driverId: string }
  | { readonly type: 'COUNTER'; readonly driverId: string; readonly amountVnd: number }
  | { readonly type: 'SHOP_ACCEPT_COUNTER' }
  | { readonly type: 'SHOP_REJECT_COUNTER' }
  | { readonly type: 'CUSTOMER_CONFIRM'; readonly approve: boolean }
  | { readonly type: 'LOCK' }
  | { readonly type: 'ADMIN_ADJUST'; readonly amountVnd: number; readonly reason: string }
  | { readonly type: 'EXTEND_DEADLINE'; readonly newExpiresAtMs: number };

export type EventType =
  | 'STANDARD_CREATED'
  | 'PROPOSED'
  | 'DRIVER_ACCEPTED'
  | 'DRIVER_SKIPPED'
  | 'COUNTERED'
  | 'COUNTER_ACCEPTED'
  | 'COUNTER_REJECTED'
  | 'CUSTOMER_CONFIRMED'
  | 'CUSTOMER_DECLINED'
  | 'EXPIRED'
  | 'LOCKED'
  | 'ADMIN_ADJUSTED'
  | 'DEADLINE_EXTENDED';

export type RefusalCode =
  | 'INVALID_STATE'
  | 'AMOUNT_INVALID'
  | 'COUNTER_SAME_AS_PROPOSAL'
  | 'COUNTER_ALREADY_REJECTED'
  | 'REASON_REQUIRED'
  | 'DEADLINE_NOT_LATER';

/** The changed fields of the agreement row (everything else is untouched). */
export type AgreementPatch = Partial<
  Pick<Agreement, 'status' | 'counterFeeVnd' | 'counterBy' | 'boundDriverId' | 'pendingFeeVnd' | 'pendingSource' | 'finalFeeVnd' | 'expiresAtMs' | 'lockedAtMs'>
>;

export type Transition =
  | {
      readonly kind: 'ok';
      /** Null for an event that changes nothing on the row (a Shipper skipping). */
      readonly patch: AgreementPatch | null;
      readonly eventType: EventType;
      readonly amountVnd: number | null;
      readonly reason: string | null;
      readonly driverId: string | null;
    }
  | { readonly kind: 'expire' }
  | { readonly kind: 'refused'; readonly code: RefusalCode };

export const isValidAmount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_FEE_VND;

/** The customer must confirm an agreed amount that is not the base fee (or when there is no base fee) when they are the one who pays. */
export function needsCustomerConsent(agreement: Agreement, amountVnd: number): boolean {
  return agreement.payer === 'CUSTOMER' && agreement.feeMode === 'AGREED' && (agreement.baseFeeVnd === null || amountVnd !== agreement.baseFeeVnd);
}

const OPEN: readonly AgreementStatus[] = ['PROPOSED', 'COUNTERED', 'AWAITING_CUSTOMER'];
const NO_COUNTER = { counterFeeVnd: null, counterBy: null } as const;
const NO_PENDING = { pendingFeeVnd: null, pendingSource: null } as const;

/** A counter-offer the shop already rejected: the same Shipper may not offer the same amount again. Keyed `${driverId}:${amount}`. */
export const rejectedKey = (driverId: string, amountVnd: number): string => `${driverId}:${String(amountVnd)}`;

/**
 * What an action does to an agreement at `nowMs`. `rejected` is the set of rejected counter-offers of this agreement (from its event log).
 * An open agreement whose deadline passed answers `expire`: nothing else is applied to it.
 */
export function applyAgreementAction(agreement: Agreement, action: AgreementAction, nowMs: number, rejected: ReadonlySet<string> = new Set()): Transition {
  if (OPEN.includes(agreement.status) && nowMs >= agreement.expiresAtMs && action.type !== 'EXTEND_DEADLINE') {
    return { kind: 'expire' };
  }
  const refuse = (code: RefusalCode): Transition => ({ kind: 'refused', code });
  const ok = (patch: AgreementPatch | null, eventType: EventType, amountVnd: number | null = null, driverId: string | null = null, reason: string | null = null): Transition => ({
    kind: 'ok',
    patch,
    eventType,
    amountVnd,
    reason,
    driverId,
  });
  /** Settle `amount` bound to `driverId`: final at once, or wait for the customer. */
  const settle = (amount: number, driverId: string, source: 'PROPOSAL' | 'COUNTER', accepted: EventType): Transition =>
    needsCustomerConsent(agreement, amount)
      ? ok({ status: 'AWAITING_CUSTOMER', pendingFeeVnd: amount, pendingSource: source, boundDriverId: driverId, ...NO_COUNTER }, accepted, amount, driverId)
      : ok({ status: 'ACCEPTED', finalFeeVnd: amount, boundDriverId: driverId, ...NO_COUNTER, ...NO_PENDING }, accepted, amount, driverId);

  switch (action.type) {
    case 'DRIVER_ACCEPT':
      if (agreement.feeMode !== 'AGREED' || agreement.status !== 'PROPOSED' || agreement.proposedFeeVnd === null) {
        return refuse('INVALID_STATE');
      }
      return settle(agreement.proposedFeeVnd, action.driverId, 'PROPOSAL', 'DRIVER_ACCEPTED');
    case 'DRIVER_SKIP':
      if (agreement.feeMode !== 'AGREED' || (agreement.status !== 'PROPOSED' && agreement.status !== 'COUNTERED')) {
        return refuse('INVALID_STATE');
      }
      return ok(null, 'DRIVER_SKIPPED', null, action.driverId);
    case 'COUNTER':
      if (agreement.feeMode !== 'AGREED' || agreement.status !== 'PROPOSED') {
        return refuse('INVALID_STATE');
      }
      if (!isValidAmount(action.amountVnd)) {
        return refuse('AMOUNT_INVALID');
      }
      if (action.amountVnd === agreement.proposedFeeVnd) {
        return refuse('COUNTER_SAME_AS_PROPOSAL');
      }
      if (rejected.has(rejectedKey(action.driverId, action.amountVnd))) {
        return refuse('COUNTER_ALREADY_REJECTED');
      }
      return ok({ status: 'COUNTERED', counterFeeVnd: action.amountVnd, counterBy: action.driverId }, 'COUNTERED', action.amountVnd, action.driverId);
    case 'SHOP_ACCEPT_COUNTER':
      if (agreement.status !== 'COUNTERED' || agreement.counterFeeVnd === null || agreement.counterBy === null) {
        return refuse('INVALID_STATE');
      }
      return settle(agreement.counterFeeVnd, agreement.counterBy, 'COUNTER', 'COUNTER_ACCEPTED');
    case 'SHOP_REJECT_COUNTER':
      if (agreement.status !== 'COUNTERED' || agreement.counterFeeVnd === null) {
        return refuse('INVALID_STATE');
      }
      // The original proposal stays and so does the deadline (not in the patch): the search simply goes on with other Shippers.
      return ok({ status: 'PROPOSED', ...NO_COUNTER }, 'COUNTER_REJECTED', agreement.counterFeeVnd, agreement.counterBy);
    case 'CUSTOMER_CONFIRM':
      if (agreement.status !== 'AWAITING_CUSTOMER' || agreement.pendingFeeVnd === null) {
        return refuse('INVALID_STATE');
      }
      if (action.approve) {
        return ok({ status: 'ACCEPTED', finalFeeVnd: agreement.pendingFeeVnd, ...NO_PENDING }, 'CUSTOMER_CONFIRMED', agreement.pendingFeeVnd, agreement.boundDriverId);
      }
      // Declined: a customer who refuses a COUNTER sends the request back to the proposal (the search goes on); one who refuses the proposal itself ends it.
      return agreement.pendingSource === 'COUNTER'
        ? ok({ status: 'PROPOSED', boundDriverId: null, ...NO_PENDING }, 'CUSTOMER_DECLINED', agreement.pendingFeeVnd, agreement.boundDriverId)
        : ok({ status: 'DECLINED', ...NO_PENDING }, 'CUSTOMER_DECLINED', agreement.pendingFeeVnd, agreement.boundDriverId);
    case 'LOCK':
      if (agreement.status !== 'ACCEPTED') {
        return refuse('INVALID_STATE');
      }
      return ok({ status: 'LOCKED', lockedAtMs: nowMs }, 'LOCKED', agreement.finalFeeVnd, agreement.boundDriverId);
    case 'ADMIN_ADJUST': {
      if (agreement.status !== 'LOCKED') {
        return refuse('INVALID_STATE');
      }
      if (!isValidAmount(action.amountVnd) || action.amountVnd === agreement.finalFeeVnd) {
        return refuse('AMOUNT_INVALID');
      }
      const reason = action.reason.normalize('NFC').trim();
      if (reason === '' || [...reason].length > REASON_NOTE_MAX) {
        return refuse('REASON_REQUIRED');
      }
      return ok({ finalFeeVnd: action.amountVnd }, 'ADMIN_ADJUSTED', action.amountVnd, agreement.boundDriverId, reason);
    }
    case 'EXTEND_DEADLINE':
      if (!OPEN.includes(agreement.status)) {
        return refuse('INVALID_STATE');
      }
      return action.newExpiresAtMs > agreement.expiresAtMs ? ok({ expiresAtMs: action.newExpiresAtMs }, 'DEADLINE_EXTENDED') : refuse('DEADLINE_NOT_LATER');
  }
}

/** Whether a Shipper may take the delivery at the agreed fee: the fee is final and bound to exactly that Shipper. */
export function feeAllowsAssignment(agreement: Agreement, driverId: string): boolean {
  if (agreement.status !== 'ACCEPTED' && agreement.status !== 'LOCKED') {
    return false;
  }
  return agreement.feeMode === 'STANDARD' || agreement.boundDriverId === driverId;
}
