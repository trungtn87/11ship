import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DriverRepository } from '../driver/driver-repository';
import { TransactionContext } from '../transaction/transaction-context';
import {
  Agreement,
  AGREEMENT_REASONS,
  AgreementAction,
  AgreementReason,
  answerDeadline,
  applyAgreementAction,
  FeePayer,
  isValidAmount,
  REASON_NOTE_MAX,
  RefusalCode,
} from './shipping-fee-agreement';
import { FeeAnswerParameterReader } from './fee-answer-parameter';
import { ActorType, ShippingFeeAgreementRepository } from './shipping-fee-agreement-repository';
import { ShippingFeePolicyReader } from './shipping-fee-policy-repository';
import { evaluateQuote, QuoteOutcome, UnpricedReason } from './shipping-fee-quote';

/** The note is shown to Shippers before they accept: 8+ digits (separators ignored) look like a phone number and are refused. */
export function noteLooksLikePhone(note: string): boolean {
  return /\d{8,}/.test(note.replace(/[\s.\-()+]/g, ''));
}

export type ServiceRefusal = RefusalCode | 'NOT_FOUND' | 'DELIVERY_ALREADY_HAS_AGREEMENT' | 'PROPOSAL_INVALID' | 'DRIVER_NOT_FOUND' | 'ACTOR_REQUIRED';

export type AgreementOutcome =
  /** Applied now. */
  | { readonly kind: 'ok'; readonly agreement: Agreement }
  /** This very request (same request id) was already applied: the stored result, nothing applied twice. */
  | { readonly kind: 'replayed'; readonly agreement: Agreement }
  /** The offer's deadline had passed: it is recorded as EXPIRED and nothing else was applied. */
  | { readonly kind: 'expired'; readonly agreement: Agreement }
  /**
   * The payer's time to answer the Shipper's counter-offer had run out: the offer is dropped and recorded (COUNTER_EXPIRED), the earlier fee stays and the search goes on;
   * the late answer itself is not applied. The row is written HERE, so a caller that refuses the answer must not roll this back by throwing in the same transaction it reads from
   * (see FeeAnswerExpiry, which commits it on its own before an answer is attempted).
   */
  | { readonly kind: 'answer_expired'; readonly agreement: Agreement }
  /** Someone else changed the agreement first (the version differs): re-read and decide again. */
  | { readonly kind: 'conflict'; readonly agreement: Agreement }
  | { readonly kind: 'refused'; readonly code: ServiceRefusal }
  /** STANDARD cannot be created: no fee table, no route, or the distance is beyond the last band (never 0, never turned into an agreement by itself). */
  | { readonly kind: 'unpriced'; readonly reason: UnpricedReason };

interface CreateBase {
  readonly deliveryId: string;
  readonly payer: FeePayer;
  /** Real route distance in metres from M14; null when there is no valid route. */
  readonly distanceM: number | null;
  /** The shop owner's user id (M07 decided that they may call a Shipper). */
  readonly createdBy: string;
  /** The offer's deadline = M07's search deadline. Never moved earlier; a rejected counter-offer does not touch it. */
  readonly expiresAtMs: number;
  /** Idempotency key of M07's request. */
  readonly requestId: string;
  readonly nowMs: number;
}

export interface Act {
  readonly agreementId: string;
  readonly expectedVersion: number;
  readonly requestId: string;
  readonly nowMs: number;
  readonly action: AgreementAction;
  /** The user acting for SHOP / CUSTOMER / ADMIN (M07 authorized the role). Not needed for a Shipper (taken from the driver) or for LOCK / EXTEND_DEADLINE. */
  readonly actorUserId?: string;
  /** SHOP_ACCEPT_COUNTER / SHOP_REJECT_COUNTER answered by the CUSTOMER who pays (an ORDER placed in 11Food): the log says CUSTOMER, not SHOP. */
  readonly answeredBy?: 'CUSTOMER' | 'SHOP';
  /** Stored as the reason of the event when the transition has none (for example "the shop confirmed on behalf of a customer without an app"). */
  readonly eventNote?: string;
  /** The event is a confirmation given by this person for the payer, who has no app: stored apart from the actor, which stays the person who acted. */
  readonly onBehalfOf?: 'CUSTOMER';
}

const ACTOR_OF: Readonly<Record<AgreementAction['type'], ActorType>> = {
  DRIVER_ACCEPT: 'DRIVER',
  DRIVER_SKIP: 'DRIVER',
  COUNTER: 'DRIVER',
  SHOP_ACCEPT_COUNTER: 'SHOP',
  SHOP_REJECT_COUNTER: 'SHOP',
  CUSTOMER_CONFIRM: 'CUSTOMER',
  LOCK: 'SYSTEM',
  ADMIN_ADJUST: 'ADMIN',
  EXTEND_DEADLINE: 'SYSTEM',
  EXPIRE_ANSWER: 'SYSTEM',
};

/**
 * M06 v1.1 fee agreement for M07 (no routes of its own). Every call runs inside the CALLER's transaction: M07 owns the delivery lifecycle, who may
 * answer, the search clock and the lock at `picked_up`; this service owns the amounts, the states, the log and the guarantees:
 *  - one row per delivery, changed only under `FOR UPDATE`, so simultaneous answers are serialized and the loser sees a conflict or a replay;
 *  - a repeated request id is answered from the log and never applied twice;
 *  - a late answer on an expired offer is refused and recorded as EXPIRED;
 *  - rejecting a counter-offer keeps the proposal and does not move the deadline (the database forbids moving it earlier);
 *  - the customer must confirm an amount that differs from the base fee when the customer pays; the fee is NULL until final.
 */
@Injectable()
export class ShippingFeeAgreementService {
  constructor(
    private readonly agreements: ShippingFeeAgreementRepository,
    private readonly policies: ShippingFeePolicyReader,
    private readonly drivers: DriverRepository,
    private readonly answerTime: FeeAnswerParameterReader,
  ) {}

  /** What the fee table says for this route distance NOW (a read only: nothing is recorded). Unpriced is `feeVnd: null`, never 0. */
  async estimate(context: TransactionContext, distanceM: number | null): Promise<QuoteOutcome> {
    return evaluateQuote(await this.policies.active(context), distanceM);
  }

  /**
   * The three bands in force NOW, for a shop that picks one for an address without a map point. `fromM` is a distance inside the band (its lower bound) and is
   * what `estimate` is asked with: the fee is the band's own, the distance is not claimed as measured. Null when no fee table is in force.
   */
  async bands(context: TransactionContext): Promise<{ readonly versionNo: number; readonly bands: readonly { readonly index: number; readonly fromM: number; readonly toM: number; readonly feeVnd: number }[] } | null> {
    const active = await this.policies.active(context);
    if (active === null) {
      return null;
    }
    return { versionNo: active.versionNo, bands: active.policy.tiers.map((tier, index) => ({ index, fromM: tier.fromM, toM: tier.toM, feeVnd: tier.feeVnd })) };
  }

  /** STANDARD: the fee is the base fee of the three bands for this route distance, final at once. */
  async createStandard(context: TransactionContext, input: CreateBase): Promise<AgreementOutcome> {
    const quote = evaluateQuote(await this.policies.active(context), input.distanceM);
    if (quote.status !== 'PRICED') {
      return { kind: 'unpriced', reason: quote.reason };
    }
    if (input.expiresAtMs <= input.nowMs) {
      return { kind: 'refused', code: 'PROPOSAL_INVALID' };
    }
    const agreementId = randomUUID();
    const inserted = await this.agreements.insert(context, {
      agreementId,
      deliveryId: input.deliveryId,
      feeMode: 'STANDARD',
      payer: input.payer,
      status: 'ACCEPTED',
      baseFeeVnd: quote.feeVnd,
      basePolicyVersionNo: quote.policyVersionNo,
      reasonCode: null,
      reasonNote: null,
      proposedFeeVnd: null,
      finalFeeVnd: quote.feeVnd,
      expiresAtMs: input.expiresAtMs,
      createdBy: input.createdBy,
    });
    return inserted ? this.#created(context, agreementId, input, 'STANDARD_CREATED', quote.feeVnd) : this.#existing(context, input);
  }

  /** AGREED: the shop proposes `proposedFeeVnd` for a stated reason. The base fee is recorded when there is one (null outside the price table). */
  async createAgreed(context: TransactionContext, input: CreateBase & { reasonCode: AgreementReason; reasonNote?: string | null; proposedFeeVnd: number }): Promise<AgreementOutcome> {
    const note = input.reasonNote === undefined || input.reasonNote === null ? null : input.reasonNote.normalize('NFC').trim();
    if (
      !AGREEMENT_REASONS.includes(input.reasonCode) ||
      !isValidAmount(input.proposedFeeVnd) ||
      (note !== null && ([...note].length > REASON_NOTE_MAX || noteLooksLikePhone(note))) ||
      (input.reasonCode === 'OTHER' && (note === null || note === '')) ||
      input.expiresAtMs <= input.nowMs
    ) {
      return { kind: 'refused', code: 'PROPOSAL_INVALID' };
    }
    const quote = evaluateQuote(await this.policies.active(context), input.distanceM);
    const agreementId = randomUUID();
    const inserted = await this.agreements.insert(context, {
      agreementId,
      deliveryId: input.deliveryId,
      feeMode: 'AGREED',
      payer: input.payer,
      status: 'PROPOSED',
      baseFeeVnd: quote.status === 'PRICED' ? quote.feeVnd : null,
      basePolicyVersionNo: quote.status === 'PRICED' ? quote.policyVersionNo : null,
      reasonCode: input.reasonCode,
      reasonNote: note === '' ? null : note,
      proposedFeeVnd: input.proposedFeeVnd,
      finalFeeVnd: null,
      expiresAtMs: input.expiresAtMs,
      createdBy: input.createdBy,
    });
    return inserted ? this.#created(context, agreementId, input, 'PROPOSED', input.proposedFeeVnd) : this.#existing(context, input);
  }

  /** One step of the agreement (see applyAgreementAction). Idempotent per request id, version-checked, serialized on the agreement row. */
  async act(context: TransactionContext, input: Act): Promise<AgreementOutcome> {
    const current = await this.agreements.lock(context, input.agreementId);
    if (current === undefined) {
      return { kind: 'refused', code: 'NOT_FOUND' };
    }
    if ((await this.agreements.eventByRequest(context, input.agreementId, input.requestId)) !== undefined) {
      return { kind: 'replayed', agreement: current };
    }
    if (current.version !== input.expectedVersion) {
      return { kind: 'conflict', agreement: current };
    }
    const actorType = input.answeredBy ?? ACTOR_OF[input.action.type];
    let actorUserId: string | null = null;
    let driverId: string | null = null;
    if ('driverId' in input.action) {
      const driver = await this.drivers.findById(context, input.action.driverId);
      if (driver === undefined) {
        return { kind: 'refused', code: 'DRIVER_NOT_FOUND' };
      }
      actorUserId = driver.userId;
      driverId = driver.driverId;
    } else if (actorType === 'SHOP' || actorType === 'CUSTOMER' || actorType === 'ADMIN') {
      if (input.actorUserId === undefined) {
        return { kind: 'refused', code: 'ACTOR_REQUIRED' };
      }
      actorUserId = input.actorUserId;
    }
    // A new counter-offer gets its own answer deadline from the time configured NOW (Cài đặt › Đơn hàng), never after the search deadline. It is fixed here and stored with the
    // offer: changing the setting later does not move it, and a repeat of this request was answered from the log above, so it cannot restart the clock.
    const action: AgreementAction =
      input.action.type === 'COUNTER' && input.action.answerExpiresAtMs === undefined
        ? { ...input.action, answerExpiresAtMs: answerDeadline(input.nowMs, await this.answerTime.minutes(context), current.expiresAtMs) }
        : input.action;
    const transition = applyAgreementAction(current, action, input.nowMs, await this.agreements.rejectedCounters(context, input.agreementId));
    if (transition.kind === 'refused') {
      return { kind: 'refused', code: transition.code };
    }
    if (transition.kind === 'answer_expired') {
      // Drop the offer that was not answered in time, keep the earlier fee, and say so; the answer that arrived late is not applied.
      const dropped = applyAgreementAction(current, { type: 'EXPIRE_ANSWER' }, input.nowMs);
      if (dropped.kind !== 'ok' || dropped.patch === null) {
        return { kind: 'refused', code: 'INVALID_STATE' };
      }
      const after = await this.agreements.update(context, input.agreementId, dropped.patch);
      await this.agreements.appendEvent(context, {
        eventId: randomUUID(),
        agreementId: input.agreementId,
        eventType: dropped.eventType,
        actorType: 'SYSTEM',
        actorId: null,
        driverId: dropped.driverId,
        amountVnd: dropped.amountVnd,
        reason: null,
        requestId: input.requestId,
        agreementVersion: after.version,
        onBehalfOf: null,
        feePayer: current.payer,
      });
      return { kind: 'answer_expired', agreement: after };
    }
    if (transition.kind === 'expire') {
      // An expired offer keeps its proposal and its history (the event log) but holds no open counter-offer or pending confirmation.
      const expired = await this.agreements.update(context, input.agreementId, { status: 'EXPIRED', counterFeeVnd: null, counterBy: null, pendingFeeVnd: null, pendingSource: null, answerExpiresAtMs: null });
      await this.agreements.appendEvent(context, {
        eventId: randomUUID(),
        agreementId: input.agreementId,
        eventType: 'EXPIRED',
        actorType: 'SYSTEM',
        actorId: null,
        driverId: null,
        amountVnd: null,
        reason: null,
        requestId: input.requestId,
        agreementVersion: expired.version,
        onBehalfOf: null,
        feePayer: current.payer,
      });
      return { kind: 'expired', agreement: expired };
    }
    const next = transition.patch === null ? current : await this.agreements.update(context, input.agreementId, transition.patch);
    await this.agreements.appendEvent(context, {
      eventId: randomUUID(),
      agreementId: input.agreementId,
      eventType: transition.eventType,
      actorType,
      actorId: actorUserId,
      driverId: transition.driverId ?? driverId,
      amountVnd: transition.amountVnd,
      reason: transition.reason ?? input.eventNote ?? null,
      requestId: input.requestId,
      agreementVersion: next.version,
      onBehalfOf: input.onBehalfOf ?? null,
      feePayer: current.payer,
    });
    return { kind: 'ok', agreement: next };
  }

  read(context: TransactionContext, agreementId: string): Promise<Agreement | undefined> {
    return this.agreements.find(context, agreementId);
  }

  /** Open agreements whose payer's time to answer a counter-offer ran out (a sweeper's list; each is applied under its locks by FeeAnswerExpiry). */
  answerDue(context: TransactionContext, nowMs: number, limit: number): Promise<{ agreementId: string; deliveryId: string; boundDriverId: string | null; counterBy: string | null }[]> {
    return this.agreements.answerDue(context, nowMs, limit);
  }

  answerWasDropped(context: TransactionContext, agreementId: string): Promise<boolean> {
    return this.agreements.lastEventIsExpiry(context, agreementId);
  }

  lastAnsweredDriver(context: TransactionContext, agreementId: string): Promise<string | undefined> {
    return this.agreements.lastAnsweredDriver(context, agreementId);
  }

  readByDelivery(context: TransactionContext, deliveryId: string): Promise<Agreement | undefined> {
    return this.agreements.findByDelivery(context, deliveryId);
  }

  async #created(context: TransactionContext, agreementId: string, input: CreateBase, eventType: 'STANDARD_CREATED' | 'PROPOSED', amountVnd: number): Promise<AgreementOutcome> {
    await this.agreements.appendEvent(context, {
      eventId: randomUUID(),
      agreementId,
      eventType,
      actorType: 'SHOP',
      actorId: input.createdBy,
      driverId: null,
      amountVnd,
      reason: null,
      requestId: input.requestId,
      agreementVersion: 1,
      onBehalfOf: null,
      feePayer: input.payer,
    });
    return { kind: 'ok', agreement: (await this.agreements.find(context, agreementId)) as Agreement };
  }

  /** The delivery already has an agreement: the same request repeated gets it back; any other request is refused (one agreement per delivery). */
  async #existing(context: TransactionContext, input: CreateBase): Promise<AgreementOutcome> {
    const found = await this.agreements.findByDelivery(context, input.deliveryId);
    if (found !== undefined && (await this.agreements.eventByRequest(context, found.agreementId, input.requestId)) !== undefined) {
      return { kind: 'replayed', agreement: found };
    }
    return { kind: 'refused', code: 'DELIVERY_ALREADY_HAS_AGREEMENT' };
  }
}
