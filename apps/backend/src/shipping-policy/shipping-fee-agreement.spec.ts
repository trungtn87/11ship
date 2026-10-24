import { describe, expect, it } from '@jest/globals';
import { Agreement, AgreementAction, answerDeadline, answerIsDue, answerIsWaiting, applyAgreementAction, feeAllowsAssignment, holderLeftEffect, needsCustomerConsent, rejectedKey, Transition } from './shipping-fee-agreement';

const T0 = 1_000_000;
const EXPIRES = T0 + 600_000;
const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';

const agreed = (over: Partial<Agreement> = {}): Agreement => ({
  agreementId: 'a',
  deliveryId: 'd',
  feeMode: 'AGREED',
  payer: 'SHOP',
  status: 'PROPOSED',
  baseFeeVnd: 15000,
  basePolicyVersionNo: 1,
  reasonCode: 'URGENT',
  reasonNote: null,
  proposedFeeVnd: 25000,
  counterFeeVnd: null,
  counterBy: null,
  boundDriverId: null,
  pendingFeeVnd: null,
  pendingSource: null,
  revisionFeeVnd: null,
  revisionBy: null,
  finalFeeVnd: null,
  expiresAtMs: EXPIRES,
  answerExpiresAtMs: null,
  version: 1,
  createdBy: 'shop',
  createdAtMs: T0 - 1000,
  updatedAtMs: T0 - 1000,
  lockedAtMs: null,
  ...over,
});

const run = (agreement: Agreement, action: AgreementAction, nowMs = T0, rejected: ReadonlySet<string> = new Set()): Transition => applyAgreementAction(agreement, action, nowMs, rejected);
const okOf = (t: Transition) => {
  if (t.kind !== 'ok') {
    throw new Error(`expected ok, got ${JSON.stringify(t)}`);
  }
  return t;
};
const refusal = (t: Transition): string | undefined => (t.kind === 'refused' ? t.code : t.kind);

describe('M06 fee agreement: when the customer must confirm', () => {
  it('only when the customer pays an AGREED amount that is not the base fee (or there is no base fee)', () => {
    expect(needsCustomerConsent(agreed({ payer: 'CUSTOMER' }), 25000)).toBe(true);
    expect(needsCustomerConsent(agreed({ payer: 'CUSTOMER' }), 15000)).toBe(false); // equal to the base fee: nothing changes for the customer
    expect(needsCustomerConsent(agreed({ payer: 'CUSTOMER', baseFeeVnd: null }), 15000)).toBe(true); // outside the price table: always
    expect(needsCustomerConsent(agreed({ payer: 'SHOP' }), 25000)).toBe(false);
    expect(needsCustomerConsent(agreed({ payer: 'CUSTOMER', feeMode: 'STANDARD' }), 25000)).toBe(false);
  });
});

describe('M06 fee agreement: proposal, Shipper answers', () => {
  it('a Shipper agrees to the proposal: shop pays -> final at once, bound to that Shipper; the amount may be above or below the base fee', () => {
    const t = okOf(run(agreed(), { type: 'DRIVER_ACCEPT', driverId: D1 }));
    expect(t.patch).toMatchObject({ status: 'ACCEPTED', finalFeeVnd: 25000, boundDriverId: D1 });
    expect(t.eventType).toBe('DRIVER_ACCEPTED');
    const lower = okOf(run(agreed({ proposedFeeVnd: 9000 }), { type: 'DRIVER_ACCEPT', driverId: D1 }));
    expect(lower.patch).toMatchObject({ status: 'ACCEPTED', finalFeeVnd: 9000 });
  });

  it('customer pays and the amount differs from the base fee: the fee is NOT final until the customer confirms', () => {
    const t = okOf(run(agreed({ payer: 'CUSTOMER' }), { type: 'DRIVER_ACCEPT', driverId: D1 }));
    expect(t.patch).toMatchObject({ status: 'AWAITING_CUSTOMER', pendingFeeVnd: 25000, pendingSource: 'PROPOSAL', boundDriverId: D1 });
    expect(t.patch).not.toHaveProperty('finalFeeVnd');
    const waiting = agreed({ payer: 'CUSTOMER', status: 'AWAITING_CUSTOMER', pendingFeeVnd: 25000, pendingSource: 'PROPOSAL', boundDriverId: D1 });
    const yes = okOf(run(waiting, { type: 'CUSTOMER_CONFIRM', approve: true }));
    expect(yes.patch).toMatchObject({ status: 'ACCEPTED', finalFeeVnd: 25000, pendingFeeVnd: null });
    const no = okOf(run(waiting, { type: 'CUSTOMER_CONFIRM', approve: false }));
    expect(no.patch).toMatchObject({ status: 'DECLINED' });
  });

  it('customer pays and the proposal equals the base fee: final at once (nothing changed for the customer)', () => {
    const t = okOf(run(agreed({ payer: 'CUSTOMER', proposedFeeVnd: 15000 }), { type: 'DRIVER_ACCEPT', driverId: D1 }));
    expect(t.patch).toMatchObject({ status: 'ACCEPTED', finalFeeVnd: 15000 });
  });

  it('a Shipper who skips changes nothing on the agreement (the search simply goes on)', () => {
    const t = okOf(run(agreed(), { type: 'DRIVER_SKIP', driverId: D1 }));
    expect(t.patch).toBeNull();
    expect(t.eventType).toBe('DRIVER_SKIPPED');
  });
});

describe('M06 fee agreement: counter-offer, shop accepts or rejects', () => {
  const countered = (over: Partial<Agreement> = {}): Agreement => agreed({ status: 'COUNTERED', counterFeeVnd: 30000, counterBy: D1, ...over });

  it('a Shipper counters with another amount, above or below the proposal', () => {
    const t = okOf(run(agreed(), { type: 'COUNTER', driverId: D1, amountVnd: 30000 }));
    expect(t.patch).toEqual({ status: 'COUNTERED', counterFeeVnd: 30000, counterBy: D1, answerExpiresAtMs: EXPIRES });
    expect(okOf(run(agreed(), { type: 'COUNTER', driverId: D1, amountVnd: 20000 })).patch).toMatchObject({ counterFeeVnd: 20000 });
  });

  it('refuses a counter equal to the proposal and amounts that are not whole VND within the technical limit (no silent clamp)', () => {
    expect(refusal(run(agreed(), { type: 'COUNTER', driverId: D1, amountVnd: 25000 }))).toBe('COUNTER_SAME_AS_PROPOSAL');
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 10_000_001, 2 ** 53]) {
      expect(refusal(run(agreed(), { type: 'COUNTER', driverId: D1, amountVnd: bad }))).toBe('AMOUNT_INVALID');
    }
    expect(okOf(run(agreed(), { type: 'COUNTER', driverId: D1, amountVnd: 0 })).patch).toMatchObject({ counterFeeVnd: 0 });
    expect(okOf(run(agreed(), { type: 'COUNTER', driverId: D1, amountVnd: 10_000_000 })).patch).toMatchObject({ counterFeeVnd: 10_000_000 });
  });

  it('shop REJECTS: the original proposal stays, the counter is cleared, and the deadline is NOT touched (the search clock does not restart)', () => {
    const t = okOf(run(countered(), { type: 'SHOP_REJECT_COUNTER' }));
    expect(t.patch).toEqual({ status: 'PROPOSED', counterFeeVnd: null, counterBy: null, answerExpiresAtMs: null });
    expect(t.patch).not.toHaveProperty('expiresAtMs');
    expect(t.eventType).toBe('COUNTER_REJECTED');
    expect(t.amountVnd).toBe(30000);
    expect(t.driverId).toBe(D1);
  });

  it('the Shipper whose counter was rejected cannot offer the same amount again, but may offer another; another Shipper may offer it', () => {
    const rejected = new Set([rejectedKey(D1, 30000)]);
    expect(refusal(run(agreed(), { type: 'COUNTER', driverId: D1, amountVnd: 30000 }, T0, rejected))).toBe('COUNTER_ALREADY_REJECTED');
    expect(okOf(run(agreed(), { type: 'COUNTER', driverId: D1, amountVnd: 28000 }, T0, rejected)).patch).toMatchObject({ counterFeeVnd: 28000 });
    expect(okOf(run(agreed(), { type: 'COUNTER', driverId: D2, amountVnd: 30000 }, T0, rejected)).patch).toMatchObject({ counterBy: D2 });
  });

  it('shop ACCEPTS the counter: shop pays -> final = the counter, bound to the Shipper who made it; customer pays -> waits for the customer', () => {
    const shopPays = okOf(run(countered(), { type: 'SHOP_ACCEPT_COUNTER' }));
    expect(shopPays.patch).toMatchObject({ status: 'ACCEPTED', finalFeeVnd: 30000, boundDriverId: D1, counterFeeVnd: null });
    const customerPays = okOf(run(countered({ payer: 'CUSTOMER' }), { type: 'SHOP_ACCEPT_COUNTER' }));
    expect(customerPays.patch).toMatchObject({ status: 'AWAITING_CUSTOMER', pendingFeeVnd: 30000, pendingSource: 'COUNTER', boundDriverId: D1 });
    expect(customerPays.patch).not.toHaveProperty('finalFeeVnd');
  });

  it('a customer who declines a COUNTER sends the request back to the proposal (the search goes on); the bound Shipper is released', () => {
    const waiting = agreed({ payer: 'CUSTOMER', status: 'AWAITING_CUSTOMER', pendingFeeVnd: 30000, pendingSource: 'COUNTER', boundDriverId: D1 });
    const t = okOf(run(waiting, { type: 'CUSTOMER_CONFIRM', approve: false }));
    expect(t.patch).toMatchObject({ status: 'PROPOSED', boundDriverId: null, pendingFeeVnd: null });
    expect(t.patch).not.toHaveProperty('expiresAtMs');
  });

  it('steps that do not fit the state are refused: no agreeing while a counter is pending, no countering twice, no confirming nothing', () => {
    expect(refusal(run(countered(), { type: 'DRIVER_ACCEPT', driverId: D2 }))).toBe('INVALID_STATE');
    expect(refusal(run(countered(), { type: 'COUNTER', driverId: D2, amountVnd: 1000 }))).toBe('INVALID_STATE');
    expect(refusal(run(agreed(), { type: 'SHOP_ACCEPT_COUNTER' }))).toBe('INVALID_STATE');
    expect(refusal(run(agreed(), { type: 'SHOP_REJECT_COUNTER' }))).toBe('INVALID_STATE');
    expect(refusal(run(agreed(), { type: 'CUSTOMER_CONFIRM', approve: true }))).toBe('INVALID_STATE');
  });
});

describe('M06 fee agreement: expiry, lock and Admin adjustment', () => {
  it('an open offer whose deadline passed answers "expire" for ANY late answer; the deadline instant itself is already late', () => {
    for (const action of [
      { type: 'DRIVER_ACCEPT', driverId: D1 } as const,
      { type: 'COUNTER', driverId: D1, amountVnd: 1000 } as const,
      { type: 'SHOP_ACCEPT_COUNTER' } as const,
      { type: 'CUSTOMER_CONFIRM', approve: true } as const,
    ]) {
      expect(run(agreed({ status: 'COUNTERED', counterFeeVnd: 1, counterBy: D1 }), action, EXPIRES).kind).toBe('expire');
      expect(run(agreed(), action, EXPIRES + 1).kind).toBe('expire');
    }
    expect(run(agreed(), { type: 'DRIVER_ACCEPT', driverId: D1 }, EXPIRES - 1).kind).toBe('ok');
  });

  it('an accepted fee does not expire, and only M07 extending its own search can move the deadline (forward only)', () => {
    const accepted = agreed({ status: 'ACCEPTED', finalFeeVnd: 25000, boundDriverId: D1 });
    expect(run(accepted, { type: 'LOCK' }, EXPIRES + 10_000_000).kind).toBe('ok');
    expect(okOf(run(agreed(), { type: 'EXTEND_DEADLINE', newExpiresAtMs: EXPIRES + 1 })).patch).toEqual({ expiresAtMs: EXPIRES + 1 });
    expect(refusal(run(agreed(), { type: 'EXTEND_DEADLINE', newExpiresAtMs: EXPIRES }))).toBe('DEADLINE_NOT_LATER');
    expect(refusal(run(agreed(), { type: 'EXTEND_DEADLINE', newExpiresAtMs: EXPIRES - 1 }))).toBe('DEADLINE_NOT_LATER');
  });

  it('LOCK (at picked_up) only from an accepted fee; after it only an Admin adjustment, with a reason and a different amount, may change it', () => {
    expect(refusal(run(agreed(), { type: 'LOCK' }))).toBe('INVALID_STATE');
    const accepted = agreed({ status: 'ACCEPTED', finalFeeVnd: 25000, boundDriverId: D1 });
    const locked = okOf(run(accepted, { type: 'LOCK' }, T0 + 5));
    expect(locked.patch).toEqual({ status: 'LOCKED', lockedAtMs: T0 + 5 });
    const lockedRow = agreed({ status: 'LOCKED', finalFeeVnd: 25000, boundDriverId: D1, lockedAtMs: T0 });
    // Nobody but an Admin changes a locked fee: every other action is refused.
    for (const action of [{ type: 'DRIVER_ACCEPT', driverId: D1 } as const, { type: 'COUNTER', driverId: D1, amountVnd: 1000 } as const, { type: 'SHOP_ACCEPT_COUNTER' } as const, { type: 'LOCK' } as const]) {
      expect(refusal(run(lockedRow, action))).toBe('INVALID_STATE');
    }
    expect(refusal(run(accepted, { type: 'ADMIN_ADJUST', amountVnd: 20000, reason: 'x' }))).toBe('INVALID_STATE'); // not locked yet
    const adjusted = okOf(run(lockedRow, { type: 'ADMIN_ADJUST', amountVnd: 20000, reason: '  Khách đổi địa chỉ  ' }));
    expect(adjusted.patch).toEqual({ finalFeeVnd: 20000 });
    expect(adjusted.reason).toBe('Khách đổi địa chỉ');
    expect(refusal(run(lockedRow, { type: 'ADMIN_ADJUST', amountVnd: 20000, reason: '   ' }))).toBe('REASON_REQUIRED');
    expect(refusal(run(lockedRow, { type: 'ADMIN_ADJUST', amountVnd: 25000, reason: 'same' }))).toBe('AMOUNT_INVALID');
    expect(refusal(run(lockedRow, { type: 'ADMIN_ADJUST', amountVnd: -5, reason: 'neg' }))).toBe('AMOUNT_INVALID');
    expect(refusal(run(lockedRow, { type: 'ADMIN_ADJUST', amountVnd: 20000, reason: 'x'.repeat(201) }))).toBe('REASON_REQUIRED');
  });

  it('a fee allows assignment when final and either the original fee (anybody) or an amount bound to that Shipper (STANDARD: final base fee, any Shipper)', () => {
    const accepted = agreed({ status: 'ACCEPTED', finalFeeVnd: 25000, boundDriverId: D1 });
    expect(feeAllowsAssignment(accepted, D1)).toBe(true);
    expect(feeAllowsAssignment(accepted, D2)).toBe(true); // the shop's own proposal that a Shipper agreed to stays open to others
    const counterAccepted = agreed({ status: 'ACCEPTED', finalFeeVnd: 30000, boundDriverId: D1 });
    expect(feeAllowsAssignment(counterAccepted, D1)).toBe(true);
    expect(feeAllowsAssignment(counterAccepted, D2)).toBe(false);
    expect(feeAllowsAssignment(agreed(), D1)).toBe(false);
    expect(feeAllowsAssignment(agreed({ status: 'AWAITING_CUSTOMER', pendingFeeVnd: 1, pendingSource: 'PROPOSAL', boundDriverId: D1 }), D1)).toBe(false);
    expect(feeAllowsAssignment(agreed({ feeMode: 'STANDARD', status: 'ACCEPTED', finalFeeVnd: 15000, proposedFeeVnd: null, reasonCode: null }), D2)).toBe(true);
  });
});

describe('M07 2026-10-24: the payer\'s time to answer a fee proposal is its own clock, never longer than the search', () => {
  const MIN = 60_000;
  const waiting = (over: Partial<Agreement> = {}): Agreement =>
    agreed({ status: 'COUNTERED', counterFeeVnd: 30000, counterBy: D1, answerExpiresAtMs: T0 + 5 * MIN, ...over });

  it('each new offer takes the configured minutes from now; the search deadline caps it', () => {
    expect(answerDeadline(T0, 5, T0 + 60 * MIN)).toBe(T0 + 5 * MIN);
    expect(answerDeadline(T0, 10, T0 + 60 * MIN)).toBe(T0 + 10 * MIN);
    expect(answerDeadline(T0, 5, T0 + 2 * MIN)).toBe(T0 + 2 * MIN);
    expect(answerDeadline(T0, 5, T0)).toBe(T0);
  });

  it('a counter-offer stores the deadline it was given and never one past the search deadline', () => {
    expect(okOf(run(agreed(), { type: 'COUNTER', driverId: D1, amountVnd: 30000, answerExpiresAtMs: T0 + 5 * MIN })).patch).toMatchObject({ answerExpiresAtMs: T0 + 5 * MIN });
    expect(okOf(run(agreed(), { type: 'COUNTER', driverId: D1, amountVnd: 30000, answerExpiresAtMs: EXPIRES + 99 * MIN })).patch).toMatchObject({ answerExpiresAtMs: EXPIRES });
  });

  it('only a Shipper\'s counter-offer has the clock: the shop\'s own proposal does not', () => {
    expect(answerIsWaiting(waiting())).toBe(true);
    expect(answerIsWaiting(waiting({ status: 'AWAITING_CUSTOMER', pendingSource: 'COUNTER', pendingFeeVnd: 30000 }))).toBe(true);
    expect(answerIsWaiting(waiting({ status: 'AWAITING_CUSTOMER', pendingSource: 'PROPOSAL', pendingFeeVnd: 25000, answerExpiresAtMs: null }))).toBe(false);
    expect(answerIsWaiting(agreed())).toBe(false);
    expect(answerIsDue(waiting(), T0 + 5 * MIN - 1)).toBe(false);
    expect(answerIsDue(waiting(), T0 + 5 * MIN)).toBe(true);
  });

  it('an answer on time works; one at or after the deadline is refused as answer_expired and applies nothing', () => {
    expect(okOf(run(waiting(), { type: 'SHOP_REJECT_COUNTER' }, T0 + 5 * MIN - 1)).eventType).toBe('COUNTER_REJECTED');
    expect(run(waiting(), { type: 'SHOP_ACCEPT_COUNTER' }, T0 + 5 * MIN).kind).toBe('answer_expired');
    expect(run(waiting(), { type: 'SHOP_REJECT_COUNTER' }, T0 + 6 * MIN).kind).toBe('answer_expired');
    expect(run(waiting({ status: 'AWAITING_CUSTOMER', pendingSource: 'COUNTER', pendingFeeVnd: 30000, boundDriverId: D1 }), { type: 'CUSTOMER_CONFIRM', approve: true }, T0 + 5 * MIN).kind).toBe('answer_expired');
  });

  it('expiring drops the unapproved offer, keeps the earlier fee and the search deadline, and clears the clock', () => {
    const t = okOf(run(waiting(), { type: 'EXPIRE_ANSWER' }, T0 + 5 * MIN));
    expect(t.eventType).toBe('COUNTER_EXPIRED');
    expect(t.patch).toEqual({ status: 'PROPOSED', counterFeeVnd: null, counterBy: null, answerExpiresAtMs: null });
    expect(t.patch).not.toHaveProperty('expiresAtMs');
    expect(t.patch).not.toHaveProperty('finalFeeVnd');
    const awaiting = okOf(run(waiting({ status: 'AWAITING_CUSTOMER', pendingSource: 'COUNTER', pendingFeeVnd: 30000, boundDriverId: D1, counterFeeVnd: null, counterBy: null }), { type: 'EXPIRE_ANSWER' }, T0 + 6 * MIN));
    expect(awaiting.patch).toMatchObject({ status: 'PROPOSED', boundDriverId: null, pendingFeeVnd: null, pendingSource: null, answerExpiresAtMs: null });
  });

  it('is not due before the deadline, nor for an offer without the clock, nor once settled', () => {
    expect(refusal(run(waiting(), { type: 'EXPIRE_ANSWER' }, T0 + 5 * MIN - 1))).toBe('ANSWER_NOT_DUE');
    expect(refusal(run(agreed(), { type: 'EXPIRE_ANSWER' }, EXPIRES - 1))).toBe('ANSWER_NOT_DUE');
    expect(refusal(run(agreed({ status: 'ACCEPTED', finalFeeVnd: 25000 }), { type: 'EXPIRE_ANSWER' }, T0 + 99 * MIN))).toBe('ANSWER_NOT_DUE');
  });

  it('the search deadline still wins when both have passed (the whole agreement expires)', () => {
    expect(run(waiting(), { type: 'EXPIRE_ANSWER' }, EXPIRES).kind).toBe('expire');
  });
});

describe('M07 2026-10-24: another fee for a fee that is already final (revision), and what happens when the Shipper\'s turn ends', () => {
  const MIN = 60_000;
  const standard = (over: Partial<Agreement> = {}): Agreement =>
    agreed({ feeMode: 'STANDARD', status: 'ACCEPTED', reasonCode: null, proposedFeeVnd: null, baseFeeVnd: 15000, finalFeeVnd: 15000, ...over });
  const agreedFinal = (over: Partial<Agreement> = {}): Agreement => agreed({ status: 'ACCEPTED', proposedFeeVnd: 15000, finalFeeVnd: 15000, boundDriverId: D1, ...over });
  const pending = (over: Partial<Agreement> = {}): Agreement => standard({ revisionFeeVnd: 20000, revisionBy: D1, answerExpiresAtMs: T0 + 5 * MIN, ...over });

  it('a Shipper proposes another amount for a table fee or an agreed fee: the fee stays, the proposal waits with its own clock (never past the search deadline)', () => {
    for (const row of [standard(), agreedFinal()]) {
      const t = okOf(run(row, { type: 'COUNTER', driverId: D2, amountVnd: 20000, answerExpiresAtMs: T0 + 5 * MIN }));
      expect(t.eventType).toBe('COUNTERED');
      expect(t.patch).toEqual({ revisionFeeVnd: 20000, revisionBy: D2, answerExpiresAtMs: T0 + 5 * MIN });
      expect(t.patch).not.toHaveProperty('finalFeeVnd');
      expect(t.patch).not.toHaveProperty('status');
    }
    expect(okOf(run(standard(), { type: 'COUNTER', driverId: D1, amountVnd: 20000, answerExpiresAtMs: EXPIRES + 99 * MIN })).patch).toMatchObject({ answerExpiresAtMs: EXPIRES });
  });

  it('refuses the same amount, an invalid amount, a second proposal while one waits, and an amount this Shipper had refused', () => {
    expect(refusal(run(standard(), { type: 'COUNTER', driverId: D1, amountVnd: 15000 }))).toBe('COUNTER_SAME_AS_PROPOSAL');
    expect(refusal(run(standard(), { type: 'COUNTER', driverId: D1, amountVnd: -1 }))).toBe('AMOUNT_INVALID');
    expect(refusal(run(pending(), { type: 'COUNTER', driverId: D2, amountVnd: 21000 }))).toBe('INVALID_STATE');
    expect(refusal(run(standard(), { type: 'COUNTER', driverId: D1, amountVnd: 20000 }, T0, new Set([rejectedKey(D1, 20000)])))).toBe('COUNTER_ALREADY_REJECTED');
    expect(refusal(run(standard({ status: 'LOCKED', lockedAtMs: T0 }), { type: 'COUNTER', driverId: D1, amountVnd: 20000 }))).toBe('INVALID_STATE');
  });

  it('the payer\'s answer is ONE step: accepting makes the amount the fee, bound to the proposer; refusing drops it and keeps the fee', () => {
    const accepted = okOf(run(pending(), { type: 'SHOP_ACCEPT_COUNTER' }, T0 + MIN));
    expect(accepted.eventType).toBe('COUNTER_ACCEPTED');
    expect(accepted.patch).toEqual({ finalFeeVnd: 20000, boundDriverId: D1, revisionFeeVnd: null, revisionBy: null, answerExpiresAtMs: null });
    const refused = okOf(run(pending(), { type: 'SHOP_REJECT_COUNTER' }, T0 + MIN));
    expect(refused.eventType).toBe('COUNTER_REJECTED');
    expect(refused.patch).toEqual({ revisionFeeVnd: null, revisionBy: null, answerExpiresAtMs: null });
    expect(answerIsWaiting(pending())).toBe(true);
    expect(refusal(run(standard(), { type: 'SHOP_ACCEPT_COUNTER' }))).toBe('INVALID_STATE');
  });

  it('an unanswered proposal expires (the late answer is not applied) and keeps the fee; the pickup lock is refused while one waits', () => {
    expect(run(pending(), { type: 'SHOP_ACCEPT_COUNTER' }, T0 + 5 * MIN).kind).toBe('answer_expired');
    const t = okOf(run(pending(), { type: 'EXPIRE_ANSWER' }, T0 + 5 * MIN));
    expect(t.eventType).toBe('COUNTER_EXPIRED');
    expect(t.patch).toEqual({ revisionFeeVnd: null, revisionBy: null, answerExpiresAtMs: null });
    expect(refusal(run(pending(), { type: 'EXPIRE_ANSWER' }, T0 + MIN))).toBe('ANSWER_NOT_DUE');
    expect(refusal(run(pending(), { type: 'LOCK' }, T0 + MIN))).toBe('INVALID_STATE');
    expect(okOf(run(standard(), { type: 'LOCK' })).patch).toMatchObject({ status: 'LOCKED' });
  });

  it('when a Shipper\'s turn ends: a fee only they agreed goes back to the original (STANDARD: base fee; AGREED: asked again), their waiting proposal is withdrawn, anything else is left alone', () => {
    const revisedStandard = standard({ finalFeeVnd: 20000, boundDriverId: D1 });
    expect(okOf(run(revisedStandard, { type: 'HOLDER_LEFT', driverId: D1 })).patch).toEqual({ boundDriverId: null, finalFeeVnd: 15000 });
    const revisedAgreed = agreedFinal({ finalFeeVnd: 20000 });
    const back = okOf(run(revisedAgreed, { type: 'HOLDER_LEFT', driverId: D1 }));
    expect(back.eventType).toBe('FEE_REVERTED');
    expect(back.patch).toMatchObject({ status: 'PROPOSED', boundDriverId: null, finalFeeVnd: null, pendingFeeVnd: null, counterFeeVnd: null });
    // Both at once: the revised fee goes back and the new proposal goes with it.
    expect(okOf(run(pending({ finalFeeVnd: 18000, boundDriverId: D1 }), { type: 'HOLDER_LEFT', driverId: D1 })).patch).toMatchObject({ boundDriverId: null, finalFeeVnd: 15000, revisionFeeVnd: null, revisionBy: null, answerExpiresAtMs: null });
    // Only the proposal: withdrawn, the fee untouched. Even when its answer time has passed.
    const withdrawn = okOf(run(pending(), { type: 'HOLDER_LEFT', driverId: D1 }, T0 + 9 * MIN));
    expect(withdrawn.eventType).toBe('COUNTER_WITHDRAWN');
    expect(withdrawn.patch).toEqual({ revisionFeeVnd: null, revisionBy: null, answerExpiresAtMs: null });
    // Nothing of this Shipper in the agreement: nothing to do (the shop's own fee they agreed to stays takeable by anyone), and nothing of another Shipper's is touched.
    expect(holderLeftEffect(agreedFinal(), D1)).toMatchObject({ withdrawn: false, revert: false });
    expect(holderLeftEffect(revisedStandard, D2)).toMatchObject({ withdrawn: false, revert: false });
    expect(refusal(run(standard(), { type: 'HOLDER_LEFT', driverId: D1 }))).toBe('INVALID_STATE');
  });

  it('who may take the delivery: the original fee anybody, an amount agreed with a Shipper only that Shipper, nobody while a proposal waits', () => {
    expect(feeAllowsAssignment(standard(), D2)).toBe(true);
    expect(feeAllowsAssignment(standard({ finalFeeVnd: 20000, boundDriverId: D1 }), D2)).toBe(false);
    expect(feeAllowsAssignment(standard({ finalFeeVnd: 20000, boundDriverId: D1 }), D1)).toBe(true);
    expect(feeAllowsAssignment(agreedFinal({ finalFeeVnd: 15000 }), D2)).toBe(true);
    expect(feeAllowsAssignment(agreedFinal({ finalFeeVnd: 20000 }), D2)).toBe(false);
    expect(feeAllowsAssignment(pending(), D1)).toBe(false);
    expect(feeAllowsAssignment(pending(), D2)).toBe(false);
  });
});
