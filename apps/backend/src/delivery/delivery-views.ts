import { Injectable } from '@nestjs/common';
import { UserRepository } from '../auth/user-repository';
import { DriverRepository, DriverRow } from '../driver/driver-repository';
import { JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { Agreement } from '../shipping-policy/shipping-fee-agreement';
import { SHIPPER_SEARCH_RADIUS_M } from '../shipping-policy/shipping-eligibility';
import { ShippingFeeAgreementService } from '../shipping-policy/shipping-fee-agreement-service';
import { TransactionContext } from '../transaction/transaction-context';
import { RUNNING_STATES } from './delivery-constants';
import { AssignmentRow, DeliveryRepository, DeliveryRow, EventRow, IncidentRow } from './delivery-repository';
import { creatorMayCancelAfterPickup, dropoffAreaOf, feeStatusOf, freshnessOf, locationValid, mayRecall, shipperMayRelease, shopMayCancel } from './delivery-rules';
import { ShipperLocationRepository } from './shipper-location';
import { buildDeliveryStory, StoryDelivery } from '../orders/order-story';
import { failReasonText, humanDeliveryReason } from './delivery-reason-text';

// The JSON each reader gets. The server decides which fields are filled; a field the caller may not see is null (or absent), so a screen cannot
// show what it was never given. Money is a whole number or null (never 0 for "unknown"); times are ISO strings; the search block carries the
// SERVER clock so a countdown never depends on the phone clock.

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

export function agreementView(agreement: Agreement | undefined): JsonObject | null {
  if (agreement === undefined || agreement.feeMode !== 'AGREED' || agreement.proposedFeeVnd === null || agreement.reasonCode === null) {
    return null;
  }
  return {
    state: agreement.status,
    proposed_vnd: agreement.proposedFeeVnd,
    counter_vnd: agreement.counterFeeVnd,
    reason_code: agreement.reasonCode,
    reason_note: agreement.reasonNote,
    expires_at: new Date(agreement.expiresAtMs).toISOString(),
  };
}

/** Who answers a fee the Shipper proposed: the customer for an ORDER they pay, the shop in every other case (for a DIRECT call, on behalf of a customer without an app). */
export function feeDeciderOf(d: Pick<DeliveryRow, 'source' | 'feePayer'>): 'CUSTOMER' | 'SHOP' {
  return d.source === 'ORDER' && d.feePayer === 'CUSTOMER' ? 'CUSTOMER' : 'SHOP';
}

/** The fee question waiting for the payer, or null. Only the amounts and the deadline: nothing about the Shipper. */
function feeDecisionView(agreement: Agreement | undefined): JsonObject | null {
  if (agreement === undefined || agreement.feeMode !== 'AGREED' || (agreement.status !== 'COUNTERED' && agreement.status !== 'AWAITING_CUSTOMER')) {
    return null;
  }
  return {
    state: agreement.status,
    current_vnd: agreement.proposedFeeVnd,
    offered_vnd: agreement.status === 'COUNTERED' ? agreement.counterFeeVnd : agreement.pendingFeeVnd,
    // Only a Shipper's counter-offer can be refused; the shop's own proposal is answered by accepting or by the shop cancelling.
    can_decline: agreement.status === 'COUNTERED' || agreement.pendingSource === 'COUNTER',
    expires_at: new Date(agreement.expiresAtMs).toISOString(),
  };
}

export function eventView(event: EventRow): JsonObject {
  return { at: new Date(event.atMs).toISOString(), type: event.type, actor: event.actorType, note: event.note };
}

export interface ShipperIdentity {
  readonly driver: DriverRow;
  readonly phone: string | null;
}

@Injectable()
export class DeliveryViews {
  constructor(
    private readonly deliveries: DeliveryRepository,
    private readonly drivers: DriverRepository,
    private readonly users: UserRepository,
    private readonly locations: ShipperLocationRepository,
    private readonly agreements: ShippingFeeAgreementService,
  ) {}

  async shipperOf(context: TransactionContext, driverId: string): Promise<ShipperIdentity | undefined> {
    const driver = await this.drivers.findById(context, driverId);
    if (driver === undefined) {
      return undefined;
    }
    const user = await this.users.findById(context, driver.userId);
    return { driver, phone: user?.phoneNormalized ?? null };
  }

  #fee(d: DeliveryRow, agreement: Agreement | undefined): JsonObject {
    return {
      mode: d.feeMode,
      payer: d.feePayer,
      amount_vnd: d.feeVnd,
      status: feeStatusOf({ feeVnd: d.feeVnd, agreementStatus: agreement?.status ?? null }),
      distance_m: d.routeDistanceM,
      // How the amount was found: a measured route, a band the shop chose for an address without a map point (an ESTIMATE, never a verified distance), or neither.
      basis: d.routeDistanceM !== null ? 'ROUTE' : d.feeMode === 'STANDARD' && d.feeVnd !== null ? 'ESTIMATED_BAND' : null,
      decider: feeDeciderOf(d),
      agreement: agreementView(agreement),
    };
  }

  #search(d: DeliveryRow, nowMs: number): JsonObject {
    return {
      started_at: iso(d.searchStartedAtMs),
      expires_at: iso(d.searchExpiresAtMs),
      server_now: iso(nowMs),
      stopped_at: iso(d.searchStoppedAtMs),
    };
  }

  #result(d: DeliveryRow, incident: IncidentRow | undefined): JsonObject | null {
    if (d.endedAtMs === null) {
      return null;
    }
    const outcome = d.state === 'completed' ? 'completed' : d.state === 'failed' ? 'failed' : d.state === 'cancelled_by_merchant' ? 'cancelled' : 'search_stopped';
    return { outcome, at: iso(d.endedAtMs), reason: humanDeliveryReason(d.endReason) ?? humanDeliveryReason(incident?.reasonNote) ?? null, goods_condition: incident?.goodsCondition ?? null };
  }

  #incident(incident: IncidentRow | undefined): JsonObject | null {
    return incident === undefined
      ? null
      : {
          incident_id: incident.incidentId,
          status: incident.status,
          custody: incident.custody,
          reason: incident.reasonNote ?? incident.reasonCode,
          opened_at: iso(incident.openedAtMs),
        };
  }

  /** One call as the story builder reads it: its events and, when it failed, the failure as a sentence. */
  async storyOf(context: TransactionContext, d: DeliveryRow, known?: IncidentRow): Promise<StoryDelivery> {
    const incident = known ?? (d.state === 'failed' ? await this.deliveries.findIncident(context, d.deliveryId) : undefined);
    return {
      deliveryId: d.deliveryId,
      source: d.source,
      previousDeliveryId: d.previousDeliveryId,
      events: await this.deliveries.listEvents(context, d.deliveryId, 200),
      failText: d.state === 'failed' && incident !== undefined ? failReasonText(incident.reasonCode, incident.reasonNote) : null,
    };
  }

  /** The shop's full view of one of its deliveries. `detail` adds the timeline. */
  async forShop(context: TransactionContext, d: DeliveryRow, nowMs: number, detail: boolean): Promise<JsonObject> {
    const assignment = await this.deliveries.findActiveAssignment(context, d.deliveryId);
    const incident = await this.deliveries.findIncident(context, d.deliveryId);
    const agreement = await this.agreements.readByDelivery(context, d.deliveryId);
    let assignmentView: JsonObject | null = null;
    let location: JsonObject | null = null;
    if (assignment !== undefined) {
      const shipper = await this.shipperOf(context, assignment.driverId);
      assignmentView = {
        assignment_id: assignment.assignmentId,
        shipper: { name: shipper?.driver.fullName ?? '—', phone: shipper?.phone ?? null, plate_number: shipper?.driver.plateNumber ?? null },
        accepted_at: iso(assignment.acceptedAtMs),
        picked_up_at: iso(assignment.pickedUpAtMs),
        destination_confirmed: assignment.destinationConfirmedAtMs !== null || d.feeVnd !== null,
      };
      // Tracking is readable only while this shipper HOLDS the delivery (an active assignment of a running delivery).
      // A DIRECT call has no map point to deliver to and is followed by its STATUS only, never by the Shipper's route (Owner decision 2026-10-23).
      if (RUNNING_STATES.includes(d.state) && d.source === 'ORDER') {
        location = await this.#location(context, assignment.driverId);
      }
    }
    const decider = feeDeciderOf(d);
    const feeQuestionOpen = agreement !== undefined && agreement.feeMode === 'AGREED' && (agreement.status === 'COUNTERED' || agreement.status === 'AWAITING_CUSTOMER');
    const view: JsonObject = {
      delivery_id: d.deliveryId,
      code: d.code,
      display_code: d.displayCode ?? d.code,
      source: d.source,
      order_id: d.orderId,
      previous_delivery_id: d.previousDeliveryId,
      state: d.state,
      version: d.version,
      pickup: { shop_name: d.shopName, phone: d.shopPhone, address_text: d.pickupAddressText, lat: d.pickupLat, lng: d.pickupLng },
      recipient: { name: d.recipientName, phone: d.recipientPhone, address_text: d.dropoffAddressText, lat: d.dropoffLat, lng: d.dropoffLng },
      goods: { description: d.goodsDescription, value_vnd: d.goodsValueVnd, paid_vnd: d.paidVnd },
      fee: this.#fee(d, agreement),
      search: this.#search(d, nowMs),
      note: d.note,
      assignment: assignmentView,
      location,
      result: this.#result(d, incident),
      incident: this.#incident(incident),
      can: {
        cancel: shopMayCancel(d.state) || creatorMayCancelAfterPickup(d.state, d.source, 'SHOP'),
        // After pickup: the shop that CREATED a DIRECT call (not the shop of a customer's order) is the only one who may cancel; the goods stay with the Shipper.
        cancel_after_pickup: creatorMayCancelAfterPickup(d.state, d.source, 'SHOP'),
        recall: mayRecall(d.state, incident?.status === 'OPEN'),
        resolve_custody: incident?.status === 'OPEN',
        // The shop answers a fee proposal only when it is the payer or stands in for a payer without an app (DIRECT).
        decide_fee: feeQuestionOpen && decider === 'SHOP',
        wait_customer_fee: feeQuestionOpen && decider === 'CUSTOMER',
      },
    };
    if (detail) {
      view.timeline = (await this.deliveries.listEvents(context, d.deliveryId, 200)).map(eventView);
      view.story = buildDeliveryStory(await this.storyOf(context, d, incident), 'shop').map((entry) => ({ at: entry.at, text: entry.text }));
    }
    return view;
  }

  /**
   * The ordering CUSTOMER's view of a delivery of their Order (M10): the state, the fee, the search clock, and, only while a Shipper holds the delivery, who
   * it is and the Shipper's LATEST position with its age. Nothing about the shop's other deliveries, the fee agreement or the commission. Once the delivery
   * has ended (or the Shipper gave it back) there is no Shipper and no position: tracking stops with the right to see it.
   */
  async forCustomer(context: TransactionContext, d: DeliveryRow, nowMs: number): Promise<JsonObject> {
    const assignment = await this.deliveries.findActiveAssignment(context, d.deliveryId);
    const incident = await this.deliveries.findIncident(context, d.deliveryId);
    const agreement = await this.agreements.readByDelivery(context, d.deliveryId);
    let shipper: JsonObject | null = null;
    let location: JsonObject | null = null;
    if (assignment !== undefined && RUNNING_STATES.includes(d.state)) {
      const identity = await this.shipperOf(context, assignment.driverId);
      shipper = {
        name: identity?.driver.fullName ?? '—',
        phone: identity?.phone ?? null,
        plate_number: identity?.driver.plateNumber ?? null,
        accepted_at: iso(assignment.acceptedAtMs),
        picked_up_at: iso(assignment.pickedUpAtMs),
      };
      location = await this.#location(context, assignment.driverId);
    }
    return {
      delivery_id: d.deliveryId,
      code: d.code,
      display_code: d.displayCode ?? d.code,
      state: d.state,
      version: d.version,
      fee: { payer: d.feePayer, amount_vnd: d.feeVnd, status: feeStatusOf({ feeVnd: d.feeVnd, agreementStatus: agreement?.status ?? null }), distance_m: d.routeDistanceM },
      search: this.#search(d, nowMs),
      shipper,
      location,
      result: this.#result(d, incident),
      goods_custody: d.state === 'failed' || incident !== undefined ? (incident?.custody ?? null) : null,
      fee_decision: feeDeciderOf(d) === 'CUSTOMER' && d.source === 'ORDER' ? feeDecisionView(agreement) : null,
      // The points of the call as they were when it was made (snapshots): the map draws these; they say nothing about where anybody is NOW.
      pickup: { lat: d.pickupLat, lng: d.pickupLng },
      dropoff: d.dropoffLat === null || d.dropoffLng === null ? null : { lat: d.dropoffLat, lng: d.dropoffLng },
      created_at: iso(d.createdAtMs),
    };
  }

  /**
   * The view of a delivery for a Shipper who took it. While the assignment is ACTIVE the Shipper has the contacts and the map points; once it ended
   * (given back, completed, failed) the view is the LIMITED projection: no phone, no street address, no position of the drop-off.
   */
  async forShipper(context: TransactionContext, d: DeliveryRow, assignment: AssignmentRow, nowMs: number): Promise<JsonObject> {
    const incident = await this.deliveries.findIncident(context, d.deliveryId);
    const agreement = await this.agreements.readByDelivery(context, d.deliveryId);
    const active = assignment.status === 'ACTIVE';
    const running = active && RUNNING_STATES.includes(d.state);
    const before = d.state === 'accepted' || d.state === 'location_confirmed';
    return {
      delivery_id: d.deliveryId,
      code: d.code,
      display_code: d.displayCode ?? d.code,
      source: d.source,
      order_id: null,
      previous_delivery_id: null,
      state: active ? d.state : assignment.status === 'COMPLETED' ? 'completed' : assignment.status === 'FAILED' ? 'failed' : 'cancelled_by_merchant',
      // How THIS Shipper's part ended, so the history can say "Đã hủy nhận" rather than the delivery's own state.
      own_outcome: active ? null : assignment.status === 'CANCELLED_BY_SHIPPER' ? 'released' : assignment.status === 'RELEASED_BY_ADMIN' ? 'released_by_admin' : assignment.status === 'CANCELLED_BY_SHOP' ? 'cancelled_by_shop' : assignment.status.toLowerCase(),
      version: d.version,
      pickup: { shop_name: d.shopName, phone: active ? d.shopPhone : null, address_text: active ? d.pickupAddressText : null, lat: active ? d.pickupLat : null, lng: active ? d.pickupLng : null },
      recipient: {
        name: d.recipientName,
        phone: active ? d.recipientPhone : null,
        address_text: active ? d.dropoffAddressText : null,
        lat: active ? d.dropoffLat : null,
        lng: active ? d.dropoffLng : null,
      },
      goods: { description: d.goodsDescription, value_vnd: d.goodsValueVnd, paid_vnd: d.paidVnd },
      fee: this.#fee(d, agreement),
      search: this.#search(d, nowMs),
      note: active ? d.note : null,
      assignment: {
        assignment_id: assignment.assignmentId,
        shipper: { name: '', phone: null, plate_number: null },
        accepted_at: iso(assignment.acceptedAtMs),
        picked_up_at: iso(assignment.pickedUpAtMs),
        destination_confirmed: assignment.destinationConfirmedAtMs !== null || d.feeVnd !== null,
      },
      location: null,
      result: active ? null : { outcome: assignment.status === 'COMPLETED' ? 'completed' : assignment.status === 'FAILED' ? 'failed' : 'cancelled', at: iso(assignment.endedAtMs), reason: humanDeliveryReason(assignment.endReason), goods_condition: incident?.goodsCondition ?? null },
      incident: incident !== undefined && incident.assignmentId === assignment.assignmentId ? this.#incident(incident) : null,
      can: {
        release: active && shipperMayRelease(d.state),
        // Asked only when the fee really is empty and the Shipper is the one who may fill it (a never-priced call); never because a point or an amount is "null".
        confirm_fee: active && before && d.feeVnd === null && agreement?.feeMode !== 'AGREED',
        confirm_destination: active && before && d.feeVnd === null && agreement?.feeMode !== 'AGREED',
        // One step: the fee is settled, nothing else (no drop-off pin) is required to take the goods.
        pickup: active && before && d.feeVnd !== null,
        complete: running && d.state === 'delivering',
        // Kept as false so an older app never offers it: after pickup the Shipper only completes, or calls the shop.
        fail: false,
      },
    };
  }

  /** One offer: only what the rules allow before accepting. No phone, no street address, no drop-off position. */
  async offer(context: TransactionContext, d: DeliveryRow, nowMs: number, decision: { eligible: boolean; reasons: readonly string[]; distanceToShopM: number | null }): Promise<JsonObject> {
    const agreement = await this.agreements.readByDelivery(context, d.deliveryId);
    return {
      delivery_id: d.deliveryId,
      code: d.code,
      display_code: d.displayCode ?? d.code,
      shop: { name: d.shopName, area_text: dropoffAreaOf(d.pickupAddressText) },
      distance_to_shop_m: decision.distanceToShopM,
      dropoff_area_text: d.dropoffAreaText,
      destination_known: d.dropoffLat !== null && d.dropoffLng !== null,
      goods_value_vnd: d.goodsValueVnd,
      unpaid_vnd: d.goodsValueVnd - d.paidVnd,
      fee_vnd: d.feeVnd,
      fee_status: feeStatusOf({ feeVnd: d.feeVnd, agreementStatus: agreement?.status ?? null }),
      fee_payer: d.feePayer,
      fee_decider: feeDeciderOf(d),
      source: d.source,
      search_expires_at: iso(d.searchExpiresAtMs),
      server_now: iso(nowMs),
      eligible: decision.eligible,
      reasons: [...decision.reasons],
      agreement: agreementView(agreement),
    };
  }

  /** The Admin's view. The contact is filled only when the caller was allowed to see it. */
  async forAdmin(context: TransactionContext, d: DeliveryRow, canContact: boolean, can: readonly string[]): Promise<JsonObject> {
    const nowMs = await freshClockMs(context);
    const assignments = await this.deliveries.listAssignments(context, d.deliveryId);
    const incident = await this.deliveries.findIncident(context, d.deliveryId);
    const agreement = await this.agreements.readByDelivery(context, d.deliveryId);
    const active = assignments.find((a) => a.status === 'ACTIVE');
    const assignmentViews: JsonObject[] = [];
    for (const assignment of assignments) {
      const shipper = await this.shipperOf(context, assignment.driverId);
      assignmentViews.push({
        assignment_id: assignment.assignmentId,
        shipper_name: shipper?.driver.fullName ?? '—',
        status: assignment.status,
        accepted_at: iso(assignment.acceptedAtMs),
        ended_at: iso(assignment.endedAtMs),
        end_reason: assignment.endReason,
        end_actor: assignment.endActor,
        shipper_driver_id: assignment.driverId,
      });
    }
    const shipper = active === undefined ? undefined : await this.shipperOf(context, active.driverId);
    const running = active !== undefined && RUNNING_STATES.includes(d.state);
    const location = running ? await this.#location(context, active.driverId) : null;
    const recall = await this.deliveries.findRecallOf(context, d.deliveryId);
    return {
      delivery_id: d.deliveryId,
      code: d.code,
      display_code: d.displayCode ?? d.code,
      source: d.source,
      order_id: d.orderId,
      previous_delivery_id: d.previousDeliveryId,
      state: d.state,
      version: d.version,
      shop: { shop_id: d.shopId, name: d.shopName },
      shipper: shipper === undefined ? null : { driver_id: shipper.driver.driverId, name: shipper.driver.fullName },
      recipient: { name: canContact ? d.recipientName : null, phone: canContact ? d.recipientPhone : null, address_text: canContact ? d.dropoffAddressText : null },
      goods: { description: d.goodsDescription, value_vnd: d.goodsValueVnd, paid_vnd: d.paidVnd },
      fee: { mode: d.feeMode, payer: d.feePayer, amount_vnd: d.feeVnd, status: feeStatusOf({ feeVnd: d.feeVnd, agreementStatus: agreement?.status ?? null }) },
      search: this.#search(d, nowMs),
      location,
      // Why there is no position, said apart so the Admin map never mistakes "not tracked" for "tracking failed" (M12-B): NO_SHIPPER / NOT_RUNNING (the delivery
      // is not on the way, so nothing is tracked) / NO_POSITION (running, but the Shipper's phone never sent one) / AVAILABLE (see `location.freshness`).
      location_state: active === undefined ? 'NO_SHIPPER' : !running ? 'NOT_RUNNING' : location === null ? 'NO_POSITION' : 'AVAILABLE',
      pickup: { address_text: d.pickupAddressText, lat: d.pickupLat, lng: d.pickupLng },
      dropoff: {
        area_text: d.dropoffAreaText,
        address_text: canContact ? d.dropoffAddressText : null,
        lat: canContact ? d.dropoffLat : null,
        lng: canContact ? d.dropoffLng : null,
        pinned: d.dropoffPinnedBy !== null,
      },
      links: {
        shop_id: d.shopId,
        shipper_driver_id: shipper === undefined ? null : shipper.driver.driverId,
        order_id: d.orderId,
        previous_delivery_id: d.previousDeliveryId,
        next_delivery: recall === undefined ? null : { delivery_id: recall.deliveryId, code: recall.code },
      },
      assignments: assignmentViews,
      timeline: (await this.deliveries.listEvents(context, d.deliveryId, 300)).map(eventView),
      incident:
        incident === undefined
          ? null
          : {
              incident_id: incident.incidentId,
              status: incident.status,
              custody: incident.custody,
              reason: incident.reasonNote ?? incident.reasonCode,
              opened_at: iso(incident.openedAtMs),
              closed_at: iso(incident.closedAtMs),
              m11_referred_at: iso(incident.m11ReferredAtMs),
            },
      policy: {
        search_radius_m: SHIPPER_SEARCH_RADIUS_M,
        commission_vnd: assignments[assignments.length - 1] === undefined ? null : Number(assignments[assignments.length - 1]?.commissionVnd),
        fee_policy_version_no: agreement?.basePolicyVersionNo ?? null,
      },
      can: [...can],
    };
  }

  async #location(context: TransactionContext, driverId: string): Promise<JsonObject | null> {
    const stored = await this.locations.find(context, driverId);
    if (stored === undefined) {
      return null;
    }
    return {
      lat: stored.lat,
      lng: stored.lng,
      recorded_at: iso(stored.recordedAtMs),
      age_seconds: stored.ageSeconds,
      freshness: freshnessOf(stored.ageSeconds, locationValid(stored.lat, stored.lng, stored.accuracyM)),
    };
  }
}
