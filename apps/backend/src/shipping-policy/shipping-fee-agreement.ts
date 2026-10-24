import { MAX_FEE_VND } from './shipping-fee-policy';

// M06 v1.1: the shipping-fee agreement (proposal / counter-offer / acceptance). Pure rules: no I/O, no clock of its own. The caller (M07 through
// ShippingFeeAgreementService) says who acts; M06 never decides who MAY act (roles belong to M07), it decides what the amounts and states allow.
//
//   STANDARD  the fee is the base fee of the three bands: final at once.
//   AGREED    the shop proposes an amount and a reason. A Shipper may agree, skip, or counter. The shop accepts or rejects a counter: rejecting keeps the
//             ORIGINAL proposal and never touches the deadline (the search clock is M07's and does not restart). When the CUSTOMER pays and the amount is
//             not the base fee (or there is no base fee), the customer must confirm before the amount becomes final. After `picked_up` the fee is locked.
//
// REVISION (Owner decision 2026-10-24): a Shipper may also propose another amount for a fee that is already FINAL (the bands' fee of STANDARD, or an agreed amount),
// before the goods are picked up, even after taking the delivery. The agreement stays ACCEPTED at the fee it had; the proposal waits in `revisionFeeVnd` /
// `revisionBy` until the payer answers it (accept: the fee changes, bound to that Shipper; refuse or silence: the proposal is dropped and the fee stays). A
// fee that differs from the ORIGINAL one (the base fee, or the shop's proposal) belongs to the Shipper it was agreed with: when that Shipper's turn ends the fee
// goes back to the original (see `HOLDER_LEFT`), so the delivery can be taken by anybody else at a fee nobody has to explain.
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
  /** A Shipper's proposal to change a FINAL fee (status ACCEPTED), waiting for the payer; NULL when none. Both or neither. */
  readonly revisionFeeVnd: number | null;
  readonly revisionBy: string | null;
  /** NULL until the fee is final (accepted / locked). */
  readonly finalFeeVnd: number | null;
  readonly expiresAtMs: number;
  /**
   * The instant by which the payer must answer a Shipper's counter-offer (COUNTERED, or AWAITING_CUSTOMER that came from a counter-offer): fixed when the offer is made from the
   * configured answer time, never later than `expiresAtMs` (the search window), never moved by a repeat of the same request. NULL when no counter-offer is waiting.
   */
  readonly answerExpiresAtMs: number | null;
  readonly version: number;
  readonly createdBy: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly lockedAtMs: number | null;
}

export type AgreementAction =
  | { readonly type: 'DRIVER_ACCEPT'; readonly driverId: string }
  | { readonly type: 'DRIVER_SKIP'; readonly driverId: string }
  | { readonly type: 'COUNTER'; readonly driverId: string; readonly amountVnd: number; readonly answerExpiresAtMs?: number }
  | { readonly type: 'SHOP_ACCEPT_COUNTER' }
  | { readonly type: 'SHOP_REJECT_COUNTER' }
  | { readonly type: 'CUSTOMER_CONFIRM'; readonly approve: boolean }
  | { readonly type: 'EXPIRE_ANSWER' }
  /** The Shipper's turn on the delivery ended (gave it up, or a proposal of theirs was refused): their pending proposal is withdrawn and a fee bound to them goes back to the original. */
  | { readonly type: 'HOLDER_LEFT'; readonly driverId: string }
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
  | 'COUNTER_EXPIRED'
  | 'COUNTER_WITHDRAWN'
  | 'FEE_REVERTED'
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
  | 'DEADLINE_NOT_LATER'
  | 'ANSWER_NOT_DUE';

/** The changed fields of the agreement row (everything else is untouched). */
export type AgreementPatch = Partial<
  Pick<
    Agreement,
    'status' | 'counterFeeVnd' | 'counterBy' | 'boundDriverId' | 'pendingFeeVnd' | 'pendingSource' | 'revisionFeeVnd' | 'revisionBy' | 'finalFeeVnd' | 'expiresAtMs' | 'answerExpiresAtMs' | 'lockedAtMs'
  >
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
  /** The payer's time to answer a counter-offer ran out: the offer is dropped (see `EXPIRE_ANSWER`); nothing the caller asked is applied. */
  | { readonly kind: 'answer_expired' }
  | { readonly kind: 'refused'; readonly code: RefusalCode };

export const isValidAmount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_FEE_VND;

/** The customer must confirm an agreed amount that is not the base fee (or when there is no base fee) when they are the one who pays. */
export function needsCustomerConsent(agreement: Agreement, amountVnd: number): boolean {
  return agreement.payer === 'CUSTOMER' && agreement.feeMode === 'AGREED' && (agreement.baseFeeVnd === null || amountVnd !== agreement.baseFeeVnd);
}

const OPEN: readonly AgreementStatus[] = ['PROPOSED', 'COUNTERED', 'AWAITING_CUSTOMER'];
const NO_COUNTER = { counterFeeVnd: null, counterBy: null } as const;
const NO_PENDING = { pendingFeeVnd: null, pendingSource: null } as const;
const NO_ANSWER_CLOCK = { answerExpiresAtMs: null } as const;
const NO_REVISION = { revisionFeeVnd: null, revisionBy: null } as const;

/** A Shipper's proposal to change a final fee is waiting for the payer. */
export const revisionIsPending = (agreement: Pick<Agreement, 'status' | 'revisionFeeVnd'>): boolean => agreement.status === 'ACCEPTED' && agreement.revisionFeeVnd !== null;

/** The fee as it was before any Shipper changed it: the base fee of the bands (STANDARD) or the shop's own proposal (AGREED). */
export const originalFeeOf = (agreement: Pick<Agreement, 'feeMode' | 'baseFeeVnd' | 'proposedFeeVnd'>): number | null => (agreement.feeMode === 'STANDARD' ? agreement.baseFeeVnd : agreement.proposedFeeVnd);

/** What it takes to end `driverId`'s turn: drop a proposal of theirs that is waiting, and/or take a fee that only they agreed back to the original. */
export function holderLeftEffect(agreement: Agreement, driverId: string): { readonly withdrawn: boolean; readonly revert: boolean; readonly original: number | null } {
  const original = originalFeeOf(agreement);
  return {
    withdrawn: revisionIsPending(agreement) && agreement.revisionBy === driverId,
    revert: agreement.status === 'ACCEPTED' && agreement.boundDriverId === driverId && agreement.finalFeeVnd !== null && original !== null && agreement.finalFeeVnd !== original,
    original,
  };
}

/** A counter-offer is waiting for the payer: COUNTERED, AWAITING_CUSTOMER that came from the counter-offer (the shop's own proposal keeps only the search deadline), or a proposal to change a final fee. */
export const answerIsWaiting = (agreement: Pick<Agreement, 'status' | 'pendingSource' | 'revisionFeeVnd'>): boolean =>
  agreement.status === 'COUNTERED' || (agreement.status === 'AWAITING_CUSTOMER' && agreement.pendingSource === 'COUNTER') || revisionIsPending(agreement);

/** The answer time of the offer has run out. The deadline instant itself is already late. */
export const answerIsDue = (agreement: Agreement, nowMs: number): boolean => answerIsWaiting(agreement) && agreement.answerExpiresAtMs !== null && nowMs >= agreement.answerExpiresAtMs;

/** The answer deadline of a new counter-offer: the configured time from now, never after the search deadline. */
export const answerDeadline = (nowMs: number, answerMinutes: number, searchExpiresAtMs: number): number => Math.min(nowMs + answerMinutes * 60_000, searchExpiresAtMs);

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
  if (action.type === 'EXPIRE_ANSWER') {
    if (!answerIsDue(agreement, nowMs)) {
      return { kind: 'refused', code: 'ANSWER_NOT_DUE' };
    }
    // The offer is dropped and the earlier fee stays: the proposal goes on waiting for a Shipper within the search window, which this never extends.
    if (revisionIsPending(agreement)) {
      return { kind: 'ok', patch: { ...NO_REVISION, ...NO_ANSWER_CLOCK }, eventType: 'COUNTER_EXPIRED', amountVnd: agreement.revisionFeeVnd, reason: null, driverId: agreement.revisionBy };
    }
    return agreement.status === 'COUNTERED'
      ? { kind: 'ok', patch: { status: 'PROPOSED', ...NO_COUNTER, ...NO_ANSWER_CLOCK }, eventType: 'COUNTER_EXPIRED', amountVnd: agreement.counterFeeVnd, reason: null, driverId: agreement.counterBy }
      : { kind: 'ok', patch: { status: 'PROPOSED', boundDriverId: null, ...NO_PENDING, ...NO_ANSWER_CLOCK }, eventType: 'COUNTER_EXPIRED', amountVnd: agreement.pendingFeeVnd, reason: null, driverId: agreement.boundDriverId };
  }
  if (answerIsDue(agreement, nowMs) && action.type !== 'EXTEND_DEADLINE' && action.type !== 'HOLDER_LEFT') {
    return { kind: 'answer_expired' };
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
      : ok({ status: 'ACCEPTED', finalFeeVnd: amount, boundDriverId: driverId, ...NO_COUNTER, ...NO_PENDING, ...NO_ANSWER_CLOCK }, accepted, amount, driverId);

  switch (action.type) {
    case 'HOLDER_LEFT': {
      const { withdrawn, revert, original } = holderLeftEffect(agreement, action.driverId);
      if (!withdrawn && !revert) {
        return refuse('INVALID_STATE');
      }
      const dropRevision = withdrawn ? { ...NO_REVISION, ...NO_ANSWER_CLOCK } : {};
      if (!revert) {
        return ok({ ...dropRevision }, 'COUNTER_WITHDRAWN', agreement.revisionFeeVnd, action.driverId);
      }
      // The fee the Shipper alone agreed goes back to the original. An agreed fee the payer had not confirmed yet is asked again of the next Shipper (PROPOSED).
      return agreement.feeMode === 'AGREED'
        ? ok({ status: 'PROPOSED', boundDriverId: null, finalFeeVnd: null, ...NO_PENDING, ...NO_COUNTER, ...dropRevision }, 'FEE_REVERTED', agreement.finalFeeVnd, action.driverId)
        : ok({ boundDriverId: null, finalFeeVnd: original, ...dropRevision }, 'FEE_REVERTED', agreement.finalFeeVnd, action.driverId);
    }
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
      if (agreement.status === 'ACCEPTED') {
        // A FINAL fee (STANDARD, or an agreed amount): the Shipper proposes another amount; the fee stays as it is until the payer answers.
        if (agreement.revisionFeeVnd !== null || agreement.finalFeeVnd === null) {
          return refuse('INVALID_STATE');
        }
        if (!isValidAmount(action.amountVnd)) {
          return refuse('AMOUNT_INVALID');
        }
        if (action.amountVnd === agreement.finalFeeVnd) {
          return refuse('COUNTER_SAME_AS_PROPOSAL');
        }
        if (rejected.has(rejectedKey(action.driverId, action.amountVnd))) {
          return refuse('COUNTER_ALREADY_REJECTED');
        }
        return ok(
          { revisionFeeVnd: action.amountVnd, revisionBy: action.driverId, answerExpiresAtMs: Math.min(action.answerExpiresAtMs ?? agreement.expiresAtMs, agreement.expiresAtMs) },
          'COUNTERED',
          action.amountVnd,
          action.driverId,
        );
      }
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
      // The answer clock starts here, once: a repeat of this request is answered from its stored outcome and never reaches this line again.
      return ok(
        { status: 'COUNTERED', counterFeeVnd: action.amountVnd, counterBy: action.driverId, answerExpiresAtMs: Math.min(action.answerExpiresAtMs ?? agreement.expiresAtMs, agreement.expiresAtMs) },
        'COUNTERED',
        action.amountVnd,
        action.driverId,
      );
    case 'SHOP_ACCEPT_COUNTER':
      if (revisionIsPending(agreement) && agreement.revisionFeeVnd !== null && agreement.revisionBy !== null) {
        // The payer (or the shop for a payer without an app) answered: the amount becomes the fee, bound to the Shipper who proposed it. No further confirmation exists.
        return ok({ finalFeeVnd: agreement.revisionFeeVnd, boundDriverId: agreement.revisionBy, ...NO_REVISION, ...NO_ANSWER_CLOCK }, 'COUNTER_ACCEPTED', agreement.revisionFeeVnd, agreement.revisionBy);
      }
      if (agreement.status !== 'COUNTERED' || agreement.counterFeeVnd === null || agreement.counterBy === null) {
        return refuse('INVALID_STATE');
      }
      return settle(agreement.counterFeeVnd, agreement.counterBy, 'COUNTER', 'COUNTER_ACCEPTED');
    case 'SHOP_REJECT_COUNTER':
      if (revisionIsPending(agreement)) {
        return ok({ ...NO_REVISION, ...NO_ANSWER_CLOCK }, 'COUNTER_REJECTED', agreement.revisionFeeVnd, agreement.revisionBy);
      }
      if (agreement.status !== 'COUNTERED' || agreement.counterFeeVnd === null) {
        return refuse('INVALID_STATE');
      }
      // The original proposal stays and so does the deadline (not in the patch): the search simply goes on with other Shippers.
      return ok({ status: 'PROPOSED', ...NO_COUNTER, ...NO_ANSWER_CLOCK }, 'COUNTER_REJECTED', agreement.counterFeeVnd, agreement.counterBy);
    case 'CUSTOMER_CONFIRM':
      if (agreement.status !== 'AWAITING_CUSTOMER' || agreement.pendingFeeVnd === null) {
        return refuse('INVALID_STATE');
      }
      if (action.approve) {
        return ok({ status: 'ACCEPTED', finalFeeVnd: agreement.pendingFeeVnd, ...NO_PENDING, ...NO_ANSWER_CLOCK }, 'CUSTOMER_CONFIRMED', agreement.pendingFeeVnd, agreement.boundDriverId);
      }
      // Declined: a customer who refuses a COUNTER sends the request back to the proposal (the search goes on); one who refuses the proposal itself ends it.
      return agreement.pendingSource === 'COUNTER'
        ? ok({ status: 'PROPOSED', boundDriverId: null, ...NO_PENDING, ...NO_ANSWER_CLOCK }, 'CUSTOMER_DECLINED', agreement.pendingFeeVnd, agreement.boundDriverId)
        : ok({ status: 'DECLINED', ...NO_PENDING, ...NO_ANSWER_CLOCK }, 'CUSTOMER_DECLINED', agreement.pendingFeeVnd, agreement.boundDriverId);
    case 'LOCK':
      // A proposal still waiting for the payer means the fee is not settled: the goods are not picked up at it.
      if (agreement.status !== 'ACCEPTED' || agreement.revisionFeeVnd !== null) {
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

/**
 * Whether a Shipper may take the delivery at the fee as it stands: the fee is final, no proposal about it waits for the payer, and it is either the ORIGINAL fee (the base fee of the
 * bands, or the shop's own proposal), which anybody may take, or an amount agreed with exactly that Shipper, which is theirs alone.
 */
export function feeAllowsAssignment(agreement: Agreement, driverId: string): boolean {
  if ((agreement.status !== 'ACCEPTED' && agreement.status !== 'LOCKED') || agreement.revisionFeeVnd !== null) {
    return false;
  }
  return agreement.boundDriverId === driverId || (agreement.finalFeeVnd !== null && agreement.finalFeeVnd === originalFeeOf(agreement));
}
