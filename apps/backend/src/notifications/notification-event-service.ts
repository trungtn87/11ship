import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { OutboxPublishEvent } from '../outbox/outbox-publisher';
import { feeOpenTo } from '../delivery/delivery-shipper-service';
import { SHIPPER_SEARCH_RADIUS_M } from '../shipping-policy/shipping-eligibility';
import { ShippingEligibilityService } from '../shipping-policy/shipping-eligibility-service';
import { ShippingFeeAgreementService } from '../shipping-policy/shipping-fee-agreement-service';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { DraftBase, composeDeliveryChange, DeliveryChangePayload, NEW_OFFERS_COPY, PROFILE_COPY, TOPUP_COPY } from './notification-composer';
import {
  CATEGORY_OF_KIND,
  MAX_EVENT_AGE_MS,
  OUTBOX_DELIVERY_CHANGED_TYPE,
  OUTBOX_DRIVER_STATE_CHANGED_TYPE,
  OUTBOX_ORDER_PREFIX,
  OUTBOX_TOPUP_CHANGED_TYPE,
  OUTBOX_WITHDRAWAL_PREFIX,
  PICKUP_REMINDER_STALE_MS,
  PUSH_TTL_MS,
  SEARCH_REMINDER_STALE_MS,
} from './notification-constants';
import { NotificationConfig, NotificationRepository } from './notification-repository';
import { NotificationPushQueue } from './notification-push-queue';
import { NotificationRecipients } from './notification-recipients';
import { isCanonicalUuid } from '../shared/identifiers';

/** At most this many Shippers are asked about per search round (nearest first). */
const CANDIDATE_LIMIT = 100;

function parseDeliveryPayload(payload: Readonly<Record<string, unknown>>): DeliveryChangePayload | undefined {
  const { delivery_id: deliveryId, code, shop_id: shopId, change, state, version, assignment_id: assignmentId, driver_id: driverId } = payload;
  if (!isCanonicalUuid(deliveryId) || typeof code !== 'string' || !isCanonicalUuid(shopId) || typeof change !== 'string' || typeof state !== 'string' || typeof version !== 'number') {
    return undefined;
  }
  return { deliveryId, code, shopId, change, state, version, assignmentId: isCanonicalUuid(assignmentId) ? assignmentId : null, driverId: isCanonicalUuid(driverId) ? driverId : null };
}

/**
 * M08's consumer of the outbox (M08.02). The outbox is at-least-once, so the event id is recorded in the SAME transaction as the rows an event produces:
 * a redelivery finds the record and does nothing, and a crash in between leaves neither. One business fact = one inbox row per recipient (unique on the
 * dedupe key); the push is a child of that row. Events of modules that do not exist yet (Orders, withdrawals) are recorded as "not integrated", never
 * invented. Who is told is decided from the identifiers on the event and re-read from the owners' tables: never from a typed phone number.
 */
@Injectable()
export class NotificationEventService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly repo: NotificationRepository,
    private readonly recipients: NotificationRecipients,
    private readonly eligibility: ShippingEligibilityService,
    private readonly agreements: ShippingFeeAgreementService,
    private readonly pushes: NotificationPushQueue,
  ) {}

  /** Resolves when the event is fully handled or recognized as not ours; rejects (so the outbox retries) when it could not be persisted. */
  async consume(event: OutboxPublishEvent): Promise<void> {
    const ownType = event.eventType === OUTBOX_DELIVERY_CHANGED_TYPE || event.eventType === OUTBOX_TOPUP_CHANGED_TYPE || event.eventType === OUTBOX_DRIVER_STATE_CHANGED_TYPE;
    if (ownType && this.#ageOf(event) > MAX_EVENT_AGE_MS) {
      // Old news (a backlog after an outage, or from before M08 existed): recorded, told to nobody, never replayed.
      await this.transactions.withTransaction((context) => this.repo.claimEvent(context, event.eventId, event.eventType, 'STALE_EVENT'));
      return;
    }
    switch (event.eventType) {
      case OUTBOX_DELIVERY_CHANGED_TYPE:
        return this.#delivery(event);
      case OUTBOX_TOPUP_CHANGED_TYPE:
        return this.#topup(event);
      case OUTBOX_DRIVER_STATE_CHANGED_TYPE:
        return this.#profile(event);
      default:
        if (event.eventType.startsWith(OUTBOX_ORDER_PREFIX) || event.eventType.startsWith(OUTBOX_WITHDRAWAL_PREFIX)) {
          // M10 (Order) and M04-C (withdrawal) do not exist yet: the hook is here, the event is acknowledged as "not integrated" and nothing is made up.
          await this.transactions.withTransaction((context) => this.repo.claimEvent(context, event.eventId, event.eventType.slice(0, 80), 'NOT_INTEGRATED'));
        }
    }
  }

  /** How long ago the event was written (its own time, taken from the database clock when it was stored). */
  #ageOf(event: OutboxPublishEvent): number {
    const at = Date.parse(event.occurredAt);
    return Number.isFinite(at) ? Math.max(0, Date.now() - at) : 0;
  }

  // ---- delivery --------------------------------------------------------------------------------------------------------------

  async #delivery(event: OutboxPublishEvent): Promise<void> {
    const p = parseDeliveryPayload(event.payload);
    if (p === undefined) {
      await this.transactions.withTransaction((context) => this.repo.claimEvent(context, event.eventId, event.eventType, 'INVALID_PAYLOAD'));
      return;
    }
    const drafts = composeDeliveryChange(p);
    if (drafts.length === 0) {
      await this.transactions.withTransaction((context) => this.repo.claimEvent(context, event.eventId, event.eventType, 'NO_NOTIFICATION'));
      return;
    }
    // M06 asks its own questions in its own transactions: the audience of a new round is decided BEFORE ours opens.
    const wantsOffer = drafts.some((d) => d.type === 'OFFER_ROUND');
    const audience = wantsOffer ? await this.#eligibleUsers(p.deliveryId, p.change === 'released_by_shipper' || p.change === 'released_by_admin' ? p.driverId : null) : [];

    await this.transactions.withTransaction(async (context) => {
      const config = await this.repo.readConfig(context);
      if (!(await this.repo.claimEvent(context, event.eventId, event.eventType, 'OK'))) {
        return;
      }
      for (const draft of drafts) {
        if (draft.type === 'NOTIFY') {
          const userId = await this.#resolve(context, draft.draft, p);
          if (userId !== undefined) {
            await this.#notify(context, config, draft.draft, userId, event.eventId, this.#ageOf(event));
          }
        } else if (draft.type === 'OFFER_ROUND') {
          await this.#offerRound(context, config, draft.deliveryId, draft.roundVersion, audience, event.eventId);
        } else {
          const userId = draft.reminder === 'PICKUP' ? (p.driverId === null ? undefined : await this.recipients.driverUser(context, p.driverId)) : await this.recipients.shopOwner(context, p.shopId);
          if (userId !== undefined) {
            await this.repo.insertReminder(context, {
              reminderId: randomUUID(),
              eventId: event.eventId,
              kind: draft.reminder,
              recipientUserId: userId,
              app: draft.reminder === 'PICKUP' ? 'SHIP' : 'FOOD',
              deliveryId: draft.deliveryId,
              assignmentId: draft.assignmentId,
              validForMs: draft.reminder === 'PICKUP' ? PICKUP_REMINDER_STALE_MS : SEARCH_REMINDER_STALE_MS,
              ageMs: this.#ageOf(event),
            });
          }
        }
      }
    });
  }

  async #resolve(context: TransactionContext, d: DraftBase, p: DeliveryChangePayload): Promise<string | undefined> {
    if (d.audience === 'SHOP') {
      return this.recipients.shopOwner(context, p.shopId);
    }
    if (d.audience === 'DRIVER') {
      return p.driverId === null ? undefined : this.recipients.driverUser(context, p.driverId);
    }
    return this.recipients.agreementDriverUser(context, p.deliveryId);
  }

  /** Who M06 says may take the delivery right now, nearest first. Excludes the Shipper who just gave it back. */
  async #eligibleUsers(deliveryId: string, excludeDriverId: string | null): Promise<string[]> {
    const prep = await this.transactions.withTransaction(async (context) => {
      const facts = await this.recipients.deliveryOfferFacts(context, deliveryId);
      if (facts === undefined || facts.state !== 'waiting_driver' || facts.remainingMs <= 0) {
        return undefined;
      }
      const candidates = await this.recipients.candidateShippers(context, facts.pickupLat, facts.pickupLng, Math.round(SHIPPER_SEARCH_RADIUS_M * 1.1), CANDIDATE_LIMIT);
      const agreement = await this.agreements.readByDelivery(context, deliveryId);
      return { candidates, agreement, nowMs: await freshClockMs(context) };
    });
    if (prep === undefined) {
      return [];
    }
    const users: string[] = [];
    for (const candidate of prep.candidates) {
      if (candidate.driverId === excludeDriverId || (prep.agreement !== undefined && !feeOpenTo(prep.agreement, candidate.driverId))) {
        continue;
      }
      const [decision] = await this.eligibility.precheck({ driverId: candidate.driverId, deliveryIds: [deliveryId] }, prep.nowMs);
      if (decision?.eligible === true) {
        users.push(candidate.userId);
      }
    }
    return users;
  }

  /** One push per Shipper, delivery and round; ONE collapsed card per Shipper; the delivery's own deadline is read, never written. */
  async #offerRound(context: TransactionContext, config: NotificationConfig, deliveryId: string, roundVersion: number, users: readonly string[], eventId: string): Promise<void> {
    const facts = await this.recipients.deliveryOfferFacts(context, deliveryId);
    // The round is current only while the delivery still is the version this event opened: anything later (accepted, cancelled, expired) makes it stale.
    if (facts === undefined || facts.state !== 'waiting_driver' || facts.version !== roundVersion || facts.remainingMs <= 0) {
      return;
    }
    for (const userId of users) {
      if (!(await this.repo.recordOfferRound(context, deliveryId, roundVersion, userId))) {
        continue;
      }
      const card = await this.repo.upsertCollapsedCard(context, {
        notificationId: randomUUID(),
        recipientUserId: userId,
        app: 'SHIP',
        kind: NEW_OFFERS_COPY.kind,
        category: 'AVAILABLE',
        title: NEW_OFFERS_COPY.title,
        body: NEW_OFFERS_COPY.body,
        targetType: 'DELIVERY_LIST',
        targetId: null,
        targetVersion: 0,
        dedupeKey: 'offers',
        sourceEventId: eventId,
        validForMs: facts.remainingMs,
        purgeDays: config.purgeDays,
      });
      await this.pushes.queue(context, { config, notificationId: card.notificationId, userId, app: 'SHIP', category: 'AVAILABLE', pushKey: `offer:${deliveryId}:${String(roundVersion)}`, ttlMs: Math.min(PUSH_TTL_MS.offer, facts.remainingMs) });
    }
  }

  // ---- wallet and profile -----------------------------------------------------------------------------------------------------

  async #topup(event: OutboxPublishEvent): Promise<void> {
    const { request_id: requestId, state, version } = event.payload;
    await this.transactions.withTransaction(async (context) => {
      const config = await this.repo.readConfig(context);
      if (!(await this.repo.claimEvent(context, event.eventId, event.eventType, 'OK'))) {
        return;
      }
      if (!isCanonicalUuid(requestId) || typeof version !== 'number' || (state !== 'CONFIRMED' && state !== 'REJECTED')) {
        return;
      }
      const userId = await this.recipients.topupOwner(context, requestId);
      if (userId === undefined) {
        return;
      }
      const copy = TOPUP_COPY[state];
      await this.#notify(context, config, { audience: 'DRIVER', app: 'SHIP', kind: copy.kind, title: copy.title, body: copy.body, targetType: 'WALLET_TXN', targetId: requestId, targetVersion: version, dedupeKey: `topup:${requestId}:${state}:${String(version)}`, validForMs: null, pushTtlMs: PUSH_TTL_MS.account }, userId, event.eventId, this.#ageOf(event));
    });
  }

  async #profile(event: OutboxPublishEvent): Promise<void> {
    const { driver_id: driverId, change, version } = event.payload;
    const copy = typeof change === 'string' ? PROFILE_COPY[change] : undefined;
    await this.transactions.withTransaction(async (context) => {
      const config = await this.repo.readConfig(context);
      if (!(await this.repo.claimEvent(context, event.eventId, event.eventType, copy === undefined ? 'NO_NOTIFICATION' : 'OK'))) {
        return;
      }
      if (copy === undefined || !isCanonicalUuid(driverId) || typeof version !== 'number') {
        return;
      }
      const userId = await this.recipients.driverUser(context, driverId);
      if (userId === undefined) {
        return;
      }
      await this.#notify(context, config, { audience: 'DRIVER', app: 'SHIP', kind: copy.kind, title: copy.title, body: copy.body, targetType: 'PROFILE', targetId: null, targetVersion: version, dedupeKey: `driver:${driverId}:${String(change)}:${String(version)}`, validForMs: null, pushTtlMs: PUSH_TTL_MS.account }, userId, event.eventId, this.#ageOf(event));
    });
  }

  // ---- shared ----------------------------------------------------------------------------------------------------------------

  async #notify(context: TransactionContext, config: NotificationConfig, d: DraftBase, userId: string, eventId: string, ageMs: number): Promise<void> {
    const category = CATEGORY_OF_KIND[d.kind];
    const inserted = await this.repo.insertNotification(context, {
      notificationId: randomUUID(),
      recipientUserId: userId,
      app: d.app,
      kind: d.kind,
      category,
      title: d.title,
      body: d.body,
      targetType: d.targetType,
      targetId: d.targetId,
      targetVersion: d.targetVersion,
      dedupeKey: d.dedupeKey,
      sourceEventId: eventId,
      validForMs: d.validForMs,
      purgeDays: config.purgeDays,
      ageMs,
    });
    if (inserted.created) {
      await this.pushes.queue(context, { config, notificationId: inserted.notificationId, userId, app: d.app, category, pushKey: `n:${inserted.notificationId}`, ttlMs: d.pushTtlMs, ageMs });
    }
  }
}
