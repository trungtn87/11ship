import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AuthPrincipal } from '../auth/auth-principal';
import { AppError, TechnicalError } from '../common/app-errors';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { isCanonicalUuid } from '../shared/identifiers';
import { EligibilityParametersRepository } from '../shipping-policy/eligibility-parameters-repository';
import { Agreement, AgreementAction, feeAllowsAssignment, revisionIsPending } from '../shipping-policy/shipping-fee-agreement';
import { ShippingFeeAgreementService } from '../shipping-policy/shipping-fee-agreement-service';
import { ShippingEligibilityService } from '../shipping-policy/shipping-eligibility-service';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { CommissionHoldService } from '../wallet/commission-hold-service';
import { CommissionPolicyRepository } from '../wallet/commission-policy-repository';
import { DELIVERY_SCOPE_TYPE, OPERATIONS } from './delivery-constants';
import { DeliveryActors, ShipperCaller } from './delivery-actors';
import { ORDER_DELIVERY_PORT, OrderDeliveryPort } from './delivery-order-port';
import { DeliveryHandback } from './delivery-handback';
import { DeliveryRecorder } from './delivery-recorder';
import { AssignmentRow, DeliveryPatch, DeliveryRepository, DeliveryRow } from './delivery-repository';
import { originalEtaMs, searchExpired, shipperMayRelease } from './delivery-rules';
import { DestinationInput, LocationInput, ReasonInput, VersionInput } from './delivery-validation';
import { DeliveryViews, feeDeciderOf } from './delivery-views';
import { M14RouteClient } from './m14-route-client';
import { ShipperSettlementReader } from '../shipper-settlement/shipper-settlement-reader';
import { ShipperLocationRepository, shouldShareLocation } from './shipper-location';

/** Reports arriving within this long after the switch went OFF (or the account changed) are not stored as a live position. */
const LATE_UPLOAD_AFTER_OFF_MS = 20_000;
import { AddressChangeRepository } from '../address-change/address-change-repository';

const OFFER_LIMIT = 30;
const HISTORY_LIMIT = 50;
/** Offers the rules cannot place near the Shipper are not listed at all (no city-wide list of other shops' orders). */
const HIDDEN_REASONS = ['OUT_OF_SEARCH_RADIUS', 'LOCATION_UNAVAILABLE', 'LOCATION_STALE', 'SHOP_LOCATION_MISSING', 'DELIVERY_NOT_AVAILABLE', 'DELIVERY_SEARCH_EXPIRED'];

/**
 * The Shipper's side of M07 (11Ship): what may be taken, accepting (one winner, commission set aside in the same commit), giving the delivery back,
 * the fee, the pickup, and the only way a Shipper ends a delivery (completing it). The caller is the authenticated principal only.
 *
 * Each write is ONE transaction opened by the idempotency executor: record -> user row -> CURRENT session row -> the Shipper (driver) row FOR UPDATE
 * (the root of every assignment and money path) -> the delivery row -> assignment -> wallet hold -> writes -> timeline -> audit -> outbox -> the
 * executor's record. The conditions M03/M04/M06 set (status, bank, GPS, radius, count, wallet, ETA protection) are decided AGAIN inside that
 * transaction by M06's `confirm`, under the driver lock, so two simultaneous accepts of one Shipper cannot exceed the count or the balance and two
 * Shippers racing for one delivery produce exactly one winner (the other waits on the delivery row, then finds it taken and holds nothing). Roads are
 * asked of M14 OUTSIDE any transaction.
 */
@Injectable()
export class DeliveryShipperService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actors: DeliveryActors,
    private readonly deliveries: DeliveryRepository,
    private readonly views: DeliveryViews,
    private readonly recorder: DeliveryRecorder,
    private readonly handback: DeliveryHandback,
    private readonly agreements: ShippingFeeAgreementService,
    private readonly commission: CommissionHoldService,
    private readonly policies: CommissionPolicyRepository,
    private readonly eligibility: ShippingEligibilityService,
    private readonly parameters: EligibilityParametersRepository,
    private readonly routes: M14RouteClient,
    private readonly locations: ShipperLocationRepository,
    private readonly settlement: ShipperSettlementReader,
    @Inject(ORDER_DELIVERY_PORT) private readonly orders: OrderDeliveryPort,
    private readonly addressChanges: AddressChangeRepository,
  ) {}

  // ---- reads -----------------------------------------------------------------------------------------------------------------

  /** The deliveries on offer near the Shipper, with whether they may take each and why not. Rules only; accepting decides again. */
  async offers(principal: AuthPrincipal): Promise<JsonObject> {
    const prep = await this.transactions.withTransaction(async (context) => {
      const caller = await this.actors.shipperReader(context, principal);
      const nowMs = await freshClockMs(context);
      const rows: DeliveryRow[] = [];
      for (const row of await this.deliveries.listOpenOffers(context, OFFER_LIMIT)) {
        const agreement = await this.agreements.readByDelivery(context, row.deliveryId);
        // A fee already settled with ANOTHER Shipper is not offered to this one.
        if (agreement !== undefined && !feeOpenTo(agreement, caller.driver.driverId)) {
          continue;
        }
        rows.push(row);
      }
      return { driverId: caller.driver.driverId, nowMs, rows };
    });
    if (prep.rows.length === 0) {
      return { offers: [] };
    }
    const decisions = await this.eligibility.precheck({ driverId: prep.driverId, deliveryIds: prep.rows.map((row) => row.deliveryId) }, prep.nowMs);
    const offers = await this.transactions.withTransaction(async (context) => {
      const out: JsonObject[] = [];
      for (let index = 0; index < prep.rows.length; index += 1) {
        const decision = decisions[index];
        const row = prep.rows[index];
        if (decision === undefined || row === undefined || decision.reasons.some((reason) => HIDDEN_REASONS.includes(reason))) {
          continue;
        }
        out.push(await this.views.offer(context, row, prep.nowMs, decision, prep.driverId));
      }
      return out;
    });
    return { offers };
  }

  async mine(principal: AuthPrincipal, scope: 'active' | 'history'): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const caller = await this.actors.shipperHolderReader(context, principal);
      const nowMs = await freshClockMs(context);
      const assignments = scope === 'active' ? await this.deliveries.listActiveOfDriver(context, caller.driver.driverId) : await this.deliveries.listEndedOfDriver(context, caller.driver.driverId, HISTORY_LIMIT);
      const out: JsonObject[] = [];
      for (const assignment of assignments) {
        const delivery = await this.deliveries.findById(context, assignment.deliveryId);
        if (delivery !== undefined) {
          out.push(await this.views.forShipper(context, delivery, assignment, nowMs));
        }
      }
      return { deliveries: out };
    });
  }

  async read(principal: AuthPrincipal, deliveryId: string): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const caller = await this.actors.shipperHolderReader(context, principal);
      const mine = (await this.deliveries.listAssignments(context, deliveryId)).filter((assignment) => assignment.driverId === caller.driver.driverId);
      const latest = mine[mine.length - 1];
      const delivery = latest === undefined ? undefined : await this.deliveries.findById(context, deliveryId);
      if (latest === undefined || delivery === undefined) {
        // A delivery this Shipper never held is not readable: the same answer as one that does not exist.
        throw new AppError('DELIVERY_NOT_FOUND');
      }
      return this.views.forShipper(context, delivery, latest, await freshClockMs(context));
    });
  }

  /** Keeps ONLY the latest position of the Shipper (M14). Not a business command: it overwrites, so it needs no Idempotency-Key. */
  async reportLocation(principal: AuthPrincipal, input: LocationInput): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const caller = await this.actors.shipperReader(context, principal);
      // Issue #265 (Owner 2026-10-31): a report that reaches the server just after the Shipper switched Online OFF is a late upload: it must not become a live position. The mark of a
      // late upload is that the Shipper was still sharing a moment ago: the row changed within seconds AND the last stored position is just as fresh. The first fix of a turn-on (a Shipper
      // just activated, or with no recent position) is kept, as the turn-on needs it. The answer says "stop" either way.
      let lateAfterOff = false;
      if (!shouldShareLocation(caller.driver) && (await freshClockMs(context)) - caller.driver.updatedAtMs < LATE_UPLOAD_AFTER_OFF_MS) {
        const last = await this.locations.find(context, caller.driver.driverId);
        lateAfterOff = last !== undefined && last.ageSeconds * 1000 < LATE_UPLOAD_AFTER_OFF_MS * 3;
      }
      if (!lateAfterOff) {
        await this.locations.upsert(context, caller.driver.driverId, input.lat, input.lng, input.accuracyM);
      }
      // The answer tells the app whether it must keep sharing: a Shipper who is off and has no work left lets it stop by itself.
      const activeWork = await this.settlement.hasActiveWork(context, caller.driver.driverId);
      return { ok: true, intent_online: caller.driver.acceptingDeliveries, has_active_work: activeWork, should_share_location: shouldShareLocation(caller.driver) };
    });
  }

  // ---- accept ----------------------------------------------------------------------------------------------------------------

  async accept(principal: AuthPrincipal, deliveryId: string, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    const pre = await this.transactions.withTransaction(async (context) => {
      const caller = await this.actors.shipperReader(context, principal);
      const delivery = await this.deliveries.findById(context, deliveryId);
      const held = delivery === undefined ? undefined : await this.deliveries.findActiveAssignment(context, deliveryId);
      const location = await this.locations.find(context, caller.driver.driverId);
      const params = await this.parameters.read(context);
      return { driverId: caller.driver.driverId, delivery, mine: held?.driverId === caller.driver.driverId, nowMs: await freshClockMs(context), location, params };
    });
    if (pre.delivery === undefined) {
      throw new AppError('DELIVERY_NOT_FOUND');
    }
    // Roads and the batching route are asked OUTSIDE the transaction (M14). A Shipper who already holds this delivery needs none: the retry answers.
    let preview: Awaited<ReturnType<ShippingEligibilityService['preview']>> | undefined;
    let etaMs: number | null = null;
    if (!pre.mine) {
      preview = await this.eligibility.preview({ driverId: pre.driverId, deliveryId }, pre.nowMs);
      etaMs = await this.#originalEta(pre.delivery, pre.location, pre.nowMs, pre.params.pickupServiceSeconds, pre.params.handoffServiceSeconds);
    }
    return this.executor.execute(
      { scopeType: DELIVERY_SCOPE_TYPE, scopeId: principal.userId, operationId: OPERATIONS.accept, idempotencyKey: key, logicalRequest: { delivery_id: deliveryId }, replay: this.#replay(principal, false) },
      async (context) => {
        const caller = await this.actors.shipperWriter(context, principal, { acceptNew: true });
        const driverId = caller.driver.driverId;
        const delivery = await this.deliveries.lockById(context, deliveryId);
        if (delivery === undefined) {
          throw new AppError('DELIVERY_NOT_FOUND');
        }
        const held = await this.deliveries.findActiveAssignment(context, deliveryId);
        if (held !== undefined) {
          if (held.driverId === driverId) {
            // This very Shipper already holds it (a retry under a new key): the same answer, nothing is taken twice.
            return { status: 200, replayGuard: { user_id: caller.actor.userId }, payload: await this.views.forShipper(context, delivery, held, await freshClockMs(context)) };
          }
          throw new AppError('DELIVERY_ALREADY_TAKEN');
        }
        const nowMs = await freshClockMs(context);
        if (delivery.state !== 'waiting_driver') {
          throw new AppError(delivery.state === 'search_stopped' ? 'DELIVERY_SEARCH_EXPIRED' : 'DELIVERY_STATE_CONFLICT');
        }
        if (searchExpired(nowMs, delivery.searchExpiresAtMs)) {
          throw new AppError('DELIVERY_SEARCH_EXPIRED');
        }
        let current = delivery;
        let agreement = await this.agreements.readByDelivery(context, deliveryId);
        if (agreement !== undefined) {
          if (agreement.feeMode === 'AGREED' && agreement.status === 'PROPOSED') {
            const agreeOutcome = await this.agreements.act(context, {
              agreementId: agreement.agreementId,
              expectedVersion: agreement.version,
              requestId: randomUUID(),
              nowMs,
              action: { type: 'DRIVER_ACCEPT', driverId },
            });
            if (agreeOutcome.kind === 'ok' || agreeOutcome.kind === 'replayed') {
              agreement = agreeOutcome.agreement;
            }
          }
          if (!feeAllowsAssignment(agreement, driverId)) {
            throw new AppError('FEE_NOT_CONFIRMED');
          }
          current = await this.#syncFee(context, current, agreement);
        }
        const decision = await this.eligibility.confirm(context, { driverId, deliveryId }, preview?.route, nowMs);
        if (!decision.eligible) {
          throw new AppError('DELIVERY_NOT_ELIGIBLE');
        }
        const openCount = await this.deliveries.countActiveOfDriver(context, driverId);
        const complete = current.dropoffLat !== null && current.feeVnd !== null;
        if (openCount > 0 && !complete) {
          // A delivery without a drop-off point or a settled fee goes only to a Shipper with nothing else to do: it cannot be protected or batched.
          throw new AppError('DELIVERY_NOT_ELIGIBLE');
        }
        const assignmentId = randomUUID();
        // The commission policy in force NOW is snapshotted on this assignment (amount and label); a later change never reaches it (M04-C).
        const policy = await this.policies.current(context);
        await this.deliveries.insertAssignment(context, {
          assignmentId,
          deliveryId,
          driverId,
          originalEtaAtMs: etaMs,
          commissionVnd: policy.amountVnd,
          commissionPolicy: policy.label,
          destinationConfirmed: complete,
        });
        const reserved = await this.commission.reserveCommission(context, { driverId, assignmentId, amountVnd: policy.amountVnd });
        if (reserved.kind === 'insufficient') {
          throw new AppError('DELIVERY_NOT_ELIGIBLE');
        }
        const after = await this.#update(context, current, { state: 'accepted' });
        await this.addressChanges.expirePendingForDelivery(context, current.deliveryId, current.orderId, 'Shipper mới nhận đơn');
        await this.recorder.record(context, { delivery: after, type: 'accepted', actorType: 'SHIPPER', actorId: caller.actor.userId, assignmentId, driverId, operation: OPERATIONS.accept, requestId, metadata: { commission_vnd: Number(policy.amountVnd) } });
        const assignment = await this.#assignment(context, assignmentId);
        return { status: 200, replayGuard: { user_id: caller.actor.userId }, payload: await this.views.forShipper(context, after, assignment, await freshClockMs(context)) };
      },
    );
  }

  // ---- give the delivery back ------------------------------------------------------------------------------------------------

  /**
   * "Hủy nhận đơn": ends this Shipper's assignment and gives the commission back. While the ORIGINAL search window is still open the delivery goes back
   * to the search for someone else; after it the search stops. The window never restarts. Not possible once the goods are picked up.
   */
  async release(principal: AuthPrincipal, deliveryId: string, input: ReasonInput, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    return this.executor.execute(
      {
        scopeType: DELIVERY_SCOPE_TYPE,
        scopeId: principal.userId,
        operationId: OPERATIONS.release,
        idempotencyKey: key,
        logicalRequest: { delivery_id: deliveryId, reason: input.reason, expected_version: input.expectedVersion },
        replay: this.#replay(principal, false, true),
      },
      async (context) => {
        const { caller, delivery, assignment } = await this.#mine(context, principal, deliveryId, input.expectedVersion, true);
        if (delivery.state === 'delivering' || delivery.state === 'picked_up') {
          throw new AppError('AFTER_PICKUP_NO_CANCEL');
        }
        if (!shipperMayRelease(delivery.state)) {
          throw new AppError('DELIVERY_STATE_CONFLICT');
        }
        const nowMs = await freshClockMs(context);
        // One place ends a Shipper's turn: the assignment, the commission (released once), the fee only this Shipper had agreed (back to the original) and the delivery itself
        // (back to the search while the ORIGINAL window is open, otherwise the search stops).
        const { delivery: after, next } = await this.handback.endTurn(context, delivery, assignment, {
          status: 'CANCELLED_BY_SHIPPER',
          actor: 'SHIPPER',
          reason: input.reason,
          stoppedReason: 'Hết thời gian tìm shipper sau khi shipper hủy nhận',
          nowMs,
        });
        await this.addressChanges.expirePendingForDelivery(context, delivery.deliveryId, delivery.orderId, 'Shipper hủy nhận đơn');
        await this.recorder.record(context, {
          delivery: after,
          type: 'released_by_shipper',
          actorType: 'SHIPPER',
          actorId: caller.actor.userId,
          assignmentId: assignment.assignmentId,
          driverId: caller.driver.driverId,
          note: input.reason,
          operation: OPERATIONS.release,
          requestId,
          metadata: { next_state: next },
        });
        const ended = await this.#assignment(context, assignment.assignmentId);
        return { status: 200, replayGuard: { user_id: caller.actor.userId }, payload: await this.views.forShipper(context, after, ended, nowMs) };
      },
    );
  }

  // ---- fee agreement (the Shipper's part) ------------------------------------------------------------------------------------

  feeAgree(principal: AuthPrincipal, deliveryId: string, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    return this.#feeAct(principal, deliveryId, key, requestId, OPERATIONS.feeAgree, (driverId) => ({ type: 'DRIVER_ACCEPT', driverId }), 'fee_agreed', {});
  }

  feeSkip(principal: AuthPrincipal, deliveryId: string, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    return this.#feeAct(principal, deliveryId, key, requestId, OPERATIONS.feeSkip, (driverId) => ({ type: 'DRIVER_SKIP', driverId }), 'fee_skipped', {});
  }

  /**
   * The Shipper proposes another fee (Owner decision 2026-10-24): for an agreed fee still being settled, for a FINAL fee (the bands' fee of STANDARD, or an agreed amount) before taking the
   * delivery, and for the Shipper who HOLDS it, until they pick the goods up. The fee in force does not change here: the payer answers (see ShippingFeeAgreement), and until then the goods
   * cannot be picked up. The answer time is fixed by this request and never moved by a repeat of it; it is never later than the search deadline. After "Đã nhận hàng" the fee is locked.
   */
  feeCounter(principal: AuthPrincipal, deliveryId: string, amountVnd: number, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    return this.executor.execute(
      { scopeType: DELIVERY_SCOPE_TYPE, scopeId: principal.userId, operationId: OPERATIONS.feeCounter, idempotencyKey: key, logicalRequest: { delivery_id: deliveryId, amount_vnd: amountVnd }, replay: this.#replay(principal, false) },
      async (context) => {
        const caller = await this.actors.shipperWriter(context, principal, { acceptNew: false });
        const driverId = caller.driver.driverId;
        const delivery = await this.deliveries.lockById(context, deliveryId);
        if (delivery === undefined) {
          throw new AppError('DELIVERY_NOT_FOUND');
        }
        const nowMs = await freshClockMs(context);
        if (delivery.state === 'delivering' || delivery.state === 'picked_up') {
          throw new AppError('FEE_LOCKED');
        }
        const holding = delivery.state === 'accepted' || delivery.state === 'location_confirmed';
        let held: AssignmentRow | undefined;
        if (holding) {
          held = await this.deliveries.lockActiveAssignment(context, deliveryId);
          if (held === undefined || held.driverId !== driverId) {
            // A delivery this Shipper does not hold is not theirs to talk about.
            throw new AppError('DELIVERY_NOT_FOUND');
          }
        } else if (delivery.state !== 'waiting_driver') {
          throw new AppError(searchExpired(nowMs, delivery.searchExpiresAtMs) ? 'DELIVERY_SEARCH_EXPIRED' : 'DELIVERY_STATE_CONFLICT');
        } else if (caller.driver.status !== 'ACTIVE') {
          throw new AppError('ROLE_NOT_AVAILABLE');
        }
        // The answer time never passes the search window, so a proposal made when that window is over would be dead on arrival.
        if (searchExpired(nowMs, delivery.searchExpiresAtMs)) {
          throw new AppError('DELIVERY_SEARCH_EXPIRED');
        }
        const agreement = await this.agreements.readByDelivery(context, deliveryId);
        if (agreement === undefined || (agreement.status === 'ACCEPTED' && !holding && !feeAllowsAssignment(agreement, driverId)) || agreement.status === 'LOCKED') {
          throw new AppError('DELIVERY_STATE_CONFLICT');
        }
        const outcome = await this.agreements.act(context, { agreementId: agreement.agreementId, expectedVersion: agreement.version, requestId: randomUUID(), nowMs, action: { type: 'COUNTER', driverId, amountVnd } });
        if (outcome.kind === 'conflict') {
          throw new AppError('VERSION_CONFLICT');
        }
        if (outcome.kind === 'expired') {
          throw new AppError('DELIVERY_SEARCH_EXPIRED');
        }
        if (outcome.kind !== 'ok' && outcome.kind !== 'replayed') {
          throw new AppError('DELIVERY_STATE_CONFLICT');
        }
        // A proposal about a FINAL fee moves the delivery's version (the people who answer it work from the version they last saw, and the notice of each proposal is its own).
        const synced = await this.#syncFee(context, delivery, outcome.agreement);
        const after = outcome.agreement.status === 'ACCEPTED' ? await this.#update(context, synced, {}) : synced;
        await this.recorder.record(context, { delivery: after, type: 'fee_countered', actorType: 'SHIPPER', actorId: caller.actor.userId, assignmentId: held?.assignmentId ?? null, driverId, operation: OPERATIONS.feeCounter, requestId, metadata: { agreement_status: outcome.agreement.status, amount_vnd: amountVnd, held: holding } });
        // The answer is the offer-shaped view whether or not the Shipper holds the delivery already (it carries no contact or address); a holder's screen reloads the delivery itself.
        return { status: 200, replayGuard: { user_id: caller.actor.userId }, payload: await this.views.offer(context, after, nowMs, { eligible: true, reasons: [], distanceToShopM: null }, driverId) };
      },
    );
  }

  async #feeAct(
    principal: AuthPrincipal,
    deliveryId: string,
    key: string | readonly string[] | undefined,
    requestId: string,
    operation: string,
    action: (driverId: string) => AgreementAction,
    change: string,
    extra: JsonObject,
  ): Promise<IdempotentOutcome> {
    return this.executor.execute(
      { scopeType: DELIVERY_SCOPE_TYPE, scopeId: principal.userId, operationId: operation, idempotencyKey: key, logicalRequest: { delivery_id: deliveryId, ...extra }, replay: this.#replay(principal, false) },
      async (context) => {
        const caller = await this.actors.shipperWriter(context, principal, { acceptNew: true });
        const delivery = await this.deliveries.lockById(context, deliveryId);
        if (delivery === undefined) {
          throw new AppError('DELIVERY_NOT_FOUND');
        }
        const nowMs = await freshClockMs(context);
        if (delivery.state !== 'waiting_driver' || searchExpired(nowMs, delivery.searchExpiresAtMs)) {
          throw new AppError(searchExpired(nowMs, delivery.searchExpiresAtMs) ? 'DELIVERY_SEARCH_EXPIRED' : 'DELIVERY_STATE_CONFLICT');
        }
        const agreement = await this.agreements.readByDelivery(context, deliveryId);
        if (agreement === undefined || agreement.feeMode !== 'AGREED') {
          throw new AppError('DELIVERY_STATE_CONFLICT');
        }
        const outcome = await this.agreements.act(context, { agreementId: agreement.agreementId, expectedVersion: agreement.version, requestId: randomUUID(), nowMs, action: action(caller.driver.driverId) });
        if (outcome.kind === 'conflict') {
          throw new AppError('VERSION_CONFLICT');
        }
        if (outcome.kind === 'expired') {
          throw new AppError('DELIVERY_SEARCH_EXPIRED');
        }
        if (outcome.kind !== 'ok' && outcome.kind !== 'replayed') {
          throw new AppError('DELIVERY_STATE_CONFLICT');
        }
        const after = await this.#syncFee(context, delivery, outcome.agreement);
        await this.recorder.record(context, { delivery: after, type: change, actorType: 'SHIPPER', actorId: caller.actor.userId, driverId: caller.driver.driverId, operation, requestId, metadata: { agreement_status: outcome.agreement.status, ...extra } });
        return { status: 200, replayGuard: { user_id: caller.actor.userId }, payload: await this.views.offer(context, after, nowMs, { eligible: true, reasons: [], distanceToShopM: null }, caller.driver.driverId) };
      },
    );
  }

  // ---- fee confirmation (and the optional drop-off pin) ----------------------------------------------------------------------

  /**
   * Before pickup, ONLY when the fee is still empty (a legacy call that was never priced): the Shipper enters the fee agreed with the payer. Whenever the
   * fee is already set nothing is asked again: the same amount (or none) is an idempotent no-op. The drop-off pin is optional (an address is enough to
   * deliver: Owner decision 2026-10-23); a Shipper who wants to may pin a point that does not exist yet, they never move one that is fixed. A fee of the
   * bands or of an agreement is set by M06, never typed in by the Shipper. After pickup the fee and the point are locked.
   */
  async confirmDestination(principal: AuthPrincipal, deliveryId: string, input: DestinationInput, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    return this.executor.execute(
      {
        scopeType: DELIVERY_SCOPE_TYPE,
        scopeId: principal.userId,
        operationId: OPERATIONS.destination,
        idempotencyKey: key,
        logicalRequest: { delivery_id: deliveryId, lat: input.lat, lng: input.lng, fee_vnd: input.feeVnd, expected_version: input.expectedVersion },
        replay: this.#replay(principal, false),
      },
      async (context) => {
        const { caller, delivery, assignment } = await this.#mine(context, principal, deliveryId, input.expectedVersion);
        if (delivery.state !== 'accepted' && delivery.state !== 'location_confirmed') {
          throw new AppError(delivery.state === 'delivering' ? 'FEE_LOCKED' : 'DELIVERY_STATE_CONFLICT');
        }
        const patch: { -readonly [K in keyof DeliveryPatch]: DeliveryPatch[K] } = {};
        if (input.lat !== null && input.lng !== null) {
          if (delivery.dropoffLat === null || delivery.dropoffLng === null) {
            patch.dropoffLat = input.lat;
            patch.dropoffLng = input.lng;
            patch.dropoffPinnedBy = caller.driver.driverId;
          } else if (Math.abs(delivery.dropoffLat - input.lat) > 1e-6 || Math.abs(delivery.dropoffLng - input.lng) > 1e-6) {
            // The point is already fixed (the shop pinned it): the Shipper may confirm it, they do not move it.
            throw new AppError('DELIVERY_INPUT_INVALID');
          }
        }
        if (delivery.feeVnd !== null) {
          if (input.feeVnd !== null && input.feeVnd !== delivery.feeVnd) {
            throw new AppError('FEE_LOCKED');
          }
        } else if (delivery.feeMode !== 'AGREED') {
          // STANDARD that was never priced and PICKUP_AGREEMENT: the amount the Shipper and the payer agreed (audited as entered by the Shipper).
          if (input.feeVnd === null) {
            throw new AppError('FEE_NOT_CONFIRMED');
          }
          // The same approval rights as an agreed fee (Owner decision 2026-10-24): when the CUSTOMER decides the fee (an order they pay), the Shipper's typed amount is
          // only a proposal and never becomes the fee by itself, whether the delivery is a legacy STANDARD one or not. The payer's approval is the only way in.
          if (feeDeciderOf(delivery) === 'CUSTOMER') {
            throw new AppError('FEE_NOT_CONFIRMED');
          }
          patch.feeVnd = input.feeVnd;
          patch.feeConfirmedBy = caller.driver.driverId;
        } else {
          // AGREED but not final yet: the payer settles it through the agreement, never the Shipper.
          throw new AppError('FEE_NOT_CONFIRMED');
        }
        if (delivery.state === 'accepted') {
          patch.state = 'location_confirmed';
        }
        const after = await this.#update(context, delivery, patch);
        if (assignment.destinationConfirmedAtMs === null) {
          await this.#touch(context, assignment, 'destination');
        }
        await this.recorder.record(context, {
          delivery: after,
          type: 'destination_confirmed',
          actorType: 'SHIPPER',
          actorId: caller.actor.userId,
          assignmentId: assignment.assignmentId,
          driverId: caller.driver.driverId,
          operation: OPERATIONS.destination,
          requestId,
          metadata: { pinned: patch.dropoffLat !== undefined, fee_confirmed: patch.feeVnd !== undefined },
        });
        return { status: 200, replayGuard: { user_id: caller.actor.userId }, payload: await this.views.forShipper(context, after, await this.#assignment(context, assignment.assignmentId), await freshClockMs(context)) };
      },
    );
  }

  // ---- pickup ----------------------------------------------------------------------------------------------------------------

  /**
   * "Đã nhận hàng": ONE command records the pickup and moves the delivery to `delivering` (there is no separate "start delivery"). It needs this Shipper's
   * live assignment and a settled fee (no drop-off point: the address is enough); it locks the fee and the delivery information. After it the Shipper can
   * no longer cancel or fail it; only the creator of the request can cancel (see DeliveryCancel.cancelAfterPickup).
   */
  async pickup(principal: AuthPrincipal, deliveryId: string, input: VersionInput, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    return this.executor.execute(
      { scopeType: DELIVERY_SCOPE_TYPE, scopeId: principal.userId, operationId: OPERATIONS.pickup, idempotencyKey: key, logicalRequest: { delivery_id: deliveryId, expected_version: input.expectedVersion }, replay: this.#replay(principal, false) },
      async (context) => {
        const { caller, delivery, assignment } = await this.#mine(context, principal, deliveryId, input.expectedVersion);
        if (delivery.state !== 'accepted' && delivery.state !== 'location_confirmed') {
          throw new AppError('DELIVERY_STATE_CONFLICT');
        }
        const agreement = await this.agreements.readByDelivery(context, deliveryId);
        let current = delivery;
        if (agreement !== undefined) {
          // A fee still waiting for the payer's answer is not the fee: the goods are not picked up at an amount nobody agreed to.
          if ((agreement.status !== 'ACCEPTED' && agreement.status !== 'LOCKED') || revisionIsPending(agreement)) {
            throw new AppError('FEE_NOT_CONFIRMED');
          }
          current = await this.#syncFee(context, current, agreement);
        }
        if (current.feeVnd === null) {
          throw new AppError('FEE_NOT_CONFIRMED');
        }
        if (agreement !== undefined && agreement.status === 'ACCEPTED') {
          const locked = await this.agreements.act(context, { agreementId: agreement.agreementId, expectedVersion: agreement.version, requestId: randomUUID(), nowMs: await freshClockMs(context), action: { type: 'LOCK' } });
          if (locked.kind !== 'ok' && locked.kind !== 'replayed') {
            throw new AppError('FEE_NOT_CONFIRMED');
          }
        }
        await this.#touch(context, assignment, 'pickup');
        const after = await this.#update(context, current, { state: 'delivering', pickedUpNow: true });
        await this.addressChanges.expirePendingForDelivery(context, current.deliveryId, current.orderId);
        await this.recorder.record(context, {
          delivery: after,
          type: 'picked_up',
          actorType: 'SHIPPER',
          actorId: caller.actor.userId,
          assignmentId: assignment.assignmentId,
          driverId: caller.driver.driverId,
          operation: OPERATIONS.pickup,
          requestId,
        });
        return { status: 200, replayGuard: { user_id: caller.actor.userId }, payload: await this.views.forShipper(context, after, await this.#assignment(context, assignment.assignmentId), await freshClockMs(context)) };
      },
    );
  }

  // ---- the two ways a delivery ends ------------------------------------------------------------------------------------------

  /**
   * "Giao thành công": the assignment and the delivery end, the commission set aside is TAKEN (once), the current Order (if any) is completed and the
   * Shipper's tracking right ends, all in one commit. A repeat answers the same result; a concurrent "failed" cannot also win.
   */
  async complete(principal: AuthPrincipal, deliveryId: string, input: VersionInput, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    return this.executor.execute(
      { scopeType: DELIVERY_SCOPE_TYPE, scopeId: principal.userId, operationId: OPERATIONS.complete, idempotencyKey: key, logicalRequest: { delivery_id: deliveryId, expected_version: input.expectedVersion }, replay: this.#replay(principal, false, true) },
      async (context) => {
        const { caller, delivery, assignment } = await this.#mine(context, principal, deliveryId, input.expectedVersion, true);
        if (delivery.state !== 'delivering') {
          throw new AppError('DELIVERY_STATE_CONFLICT');
        }
        await this.#endAssignment(context, assignment, 'COMPLETED', 'SHIPPER', null);
        const captured = await this.commission.captureCommission(context, assignment.assignmentId);
        if (captured.kind !== 'done') {
          throw new TechnicalError('internal', 'Commission was not capturable');
        }
        if (delivery.source === 'ORDER' && delivery.orderId !== null) {
          await this.orders.deliveryCompleted(context, delivery.orderId, delivery.deliveryId);
        }
        const after = await this.#update(context, delivery, { state: 'completed', endedNow: true });
        await this.recorder.record(context, {
          delivery: after,
          type: 'completed',
          actorType: 'SHIPPER',
          actorId: caller.actor.userId,
          assignmentId: assignment.assignmentId,
          driverId: caller.driver.driverId,
          operation: OPERATIONS.complete,
          requestId,
          metadata: { commission_vnd: Number(assignment.commissionVnd) },
        });
        return { status: 200, replayGuard: { user_id: caller.actor.userId }, payload: await this.views.forShipper(context, after, await this.#assignment(context, assignment.assignmentId), await freshClockMs(context)) };
      },
    );
  }

  /**
   * "Giao thất bại" does not exist for the Shipper any more (Owner decision 2026-10-23): once the goods are picked up the Shipper can only complete the
   * delivery; if it cannot be delivered they call the shop and the creator of the request decides (cancel after pickup). Refused for every state, so a
   * direct API call cannot go around the app. Nothing is read or written.
   */
  fail(): never {
    throw new AppError('SHIPPER_FAIL_NOT_ALLOWED');
  }

  // ---- shared ----------------------------------------------------------------------------------------------------------------

  /** The Shipper (driver row FOR UPDATE), then the delivery, and this Shipper's ACTIVE assignment on it. Anything else: not found. */
  async #mine(context: TransactionContext, principal: AuthPrincipal, deliveryId: string, expectedVersion: number, holder = false): Promise<{ caller: ShipperCaller; delivery: DeliveryRow; assignment: AssignmentRow }> {
    const caller = holder ? await this.actors.shipperHolderWriter(context, principal) : await this.actors.shipperWriter(context, principal, { acceptNew: false });
    const delivery = await this.deliveries.lockById(context, deliveryId);
    const assignment = delivery === undefined ? undefined : await this.deliveries.lockActiveAssignment(context, deliveryId);
    if (delivery === undefined || assignment === undefined || assignment.driverId !== caller.driver.driverId) {
      throw new AppError('DELIVERY_NOT_FOUND');
    }
    if (delivery.version !== expectedVersion) {
      throw new AppError('VERSION_CONFLICT');
    }
    return { caller, delivery, assignment };
  }

  async #endAssignment(context: TransactionContext, assignment: AssignmentRow, status: 'COMPLETED' | 'FAILED' | 'CANCELLED_BY_SHIPPER', actor: 'SHIPPER', reason: string | null): Promise<void> {
    if (!(await this.deliveries.endAssignment(context, assignment.assignmentId, assignment.version, status, actor, reason))) {
      throw new TechnicalError('internal', 'Assignment changed under its lock');
    }
  }

  async #touch(context: TransactionContext, assignment: AssignmentRow, what: 'destination' | 'pickup'): Promise<void> {
    if (!(await this.deliveries.touchAssignment(context, assignment.assignmentId, assignment.version, what))) {
      throw new TechnicalError('internal', 'Assignment changed under its lock');
    }
  }

  async #assignment(context: TransactionContext, assignmentId: string): Promise<AssignmentRow> {
    const row = await this.deliveries.findAssignment(context, assignmentId);
    if (row === undefined) {
      throw new TechnicalError('internal', 'Assignment vanished');
    }
    return row;
  }

  async #update(context: TransactionContext, delivery: DeliveryRow, patch: DeliveryPatch): Promise<DeliveryRow> {
    const updated = await this.deliveries.update(context, delivery.deliveryId, delivery.version, patch);
    if (updated === undefined) {
      throw new AppError('VERSION_CONFLICT');
    }
    return updated;
  }

  /** The fee of the delivery follows the agreement once it is final (and only then): the delivery never shows an amount nobody settled. */
  async #syncFee(context: TransactionContext, delivery: DeliveryRow, agreement: Agreement): Promise<DeliveryRow> {
    if (agreement.finalFeeVnd !== null && delivery.feeVnd !== agreement.finalFeeVnd) {
      return this.#update(context, delivery, { feeVnd: agreement.finalFeeVnd });
    }
    return delivery;
  }

  /** The original ETA of the hand-over (Shipper -> shop -> drop-off, plus service times), from M14, stored once on the assignment. Null if any leg is unknown. */
  async #originalEta(delivery: DeliveryRow, location: { lat: number; lng: number } | undefined, nowMs: number, pickupServiceSeconds: number, handoffServiceSeconds: number): Promise<number | null> {
    if (location === undefined || delivery.dropoffLat === null || delivery.dropoffLng === null || delivery.pickupLat === null || delivery.pickupLng === null) {
      return null;
    }
    const shop = { lat: delivery.pickupLat, lng: delivery.pickupLng };
    const toShop = await this.routes.route({ lat: location.lat, lng: location.lng }, shop);
    const toDropoff = await this.routes.route(shop, { lat: delivery.dropoffLat, lng: delivery.dropoffLng });
    return originalEtaMs(nowMs, toShop?.seconds ?? null, toDropoff?.seconds ?? null, pickupServiceSeconds, handoffServiceSeconds);
  }

  /** A replay answers only after the CURRENT session, the 11Ship DRIVER context and the Shipper profile are authorized again under the same locks. */
  #replay(principal: AuthPrincipal, acceptNew: boolean, holder = false) {
    return {
      kind: 'sensitive' as const,
      authorize: async (context: TransactionContext, guard: JsonObject): Promise<true> => {
        if (!isCanonicalUuid(guard.user_id) || guard.user_id !== principal.userId) {
          throw new TechnicalError('internal', 'Invalid replay guard');
        }
        if (holder) {
          await this.actors.shipperHolderWriter(context, principal);
        } else {
          await this.actors.shipperWriter(context, principal, { acceptNew });
        }
        return true;
      },
    };
  }
}

/** Whether this Shipper may even see the offer: a fee still being settled, one that is theirs, or one that anyone can take. */
export function feeOpenTo(agreement: Agreement, driverId: string): boolean {
  if (revisionIsPending(agreement)) {
    // A proposal for a final fee is waiting for the payer: the delivery is held for the Shipper who made it until it is answered or runs out.
    return agreement.revisionBy === driverId;
  }
  if (agreement.status === 'ACCEPTED' || agreement.status === 'LOCKED') {
    return feeAllowsAssignment(agreement, driverId);
  }
  return agreement.status === 'PROPOSED' || agreement.status === 'COUNTERED' || agreement.status === 'AWAITING_CUSTOMER';
}
