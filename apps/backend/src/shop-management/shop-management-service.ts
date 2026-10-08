import { Injectable } from '@nestjs/common';
import { AuditWriter } from '../audit/audit-writer';
import { SessionActor, SessionAuthorizationParticipant } from '../auth/session-authorization-participant';
import { AppError, TechnicalError } from '../common/app-errors';
import { IdempotencyExecutor, JsonObject } from '../idempotency/idempotency-executor';
import { OutboxWriter } from '../outbox/outbox-writer';
import { isCanonicalUuid } from '../shared/identifiers';
import { canonicalizeBusinessHours, toWire } from '../shop/business-hours';
import { ServiceAreaRepository } from '../shop/service-area-repository';
import { AVAILABILITY_TIME_ZONE } from '../shop/shop-availability-sql';
import { ShopAvailabilityReader, ShopSnapshot } from '../shop/shop-availability-reader';
import { ShopBusinessHoursRepository } from '../shop/shop-business-hours-repository';
import { ShopRepository, ShopRow } from '../shop/shop-repository';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import {
  SHOP_BUSINESS_HOURS_REPLACE_OPERATION_ID,
  SHOP_BUSINESS_HOURS_UPDATED_EVENT_TYPE,
  SHOP_MANAGEMENT_AUDIT_ACTIONS,
  SHOP_MANAGEMENT_EVENT_SCHEMA_VERSION,
  SHOP_MANAGEMENT_RESOURCE_TYPE,
  SHOP_MANAGEMENT_SCOPE_TYPE,
  SHOP_PROFILE_UPDATE_OPERATION_ID,
  SHOP_PROFILE_UPDATED_EVENT_TYPE,
} from './shop-management-constants';
import { BusinessHoursReplaceInput, ShopProfileUpdateInput } from './shop-management-validation';

export interface ShopManagementOutcome {
  readonly status: number;
  readonly payload: unknown;
  readonly replayed: boolean;
}

/**
 * Shop management coordinator (M02-A). The two mutations run in the transaction the M00 IdempotencyExecutor opens;
 * the read opens one short read transaction of its own, because a read has no idempotency record.
 *
 * Lock order of a NEW mutation (after the executor's own advisory + record locks), the A2 global order:
 *   user row FOR UPDATE -> CURRENT session row FOR UPDATE -> OWNER membership -> shop -> service area (FOR SHARE,
 *   profile update only) -> writes -> audit -> outbox -> (the executor writes the idempotency record last).
 * The authenticated user AND session come from the guard's principal; nothing about identity, shop, role, status or
 * accepting_orders is read from a request body or a URL. The HTTP guard is only a precheck: the session, its SHOP
 * context and the ownership are checked again inside the transaction, under the locks, so a revocation, a role switch
 * or an expiry during a lock wait refuses the command before any effect (SessionAuthorizationParticipant).
 *
 * Availability is NEVER stored or toggled here: it is computed from the schedule, the profile status and the area
 * status by the read port. This service has no accepting-orders operation, reads no accepting_orders column and
 * emits no event when a shop opens or closes.
 */
@Injectable()
export class ShopManagementService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly sessionAuth: SessionAuthorizationParticipant,
    private readonly shops: ShopRepository,
    private readonly hours: ShopBusinessHoursRepository,
    private readonly serviceAreas: ServiceAreaRepository,
    private readonly reader: ShopAvailabilityReader,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  /**
   * GET /v1/shop/me. One read transaction: user FOR SHARE, then the CURRENT session FOR SHARE (through the Auth-owned
   * participant, which also requires the SHOP context and role from the LOCKED rows), held until the read ends; then
   * ONE statement reads the owned shop, its schedule and its availability at one PostgreSQL instant. No audit, no
   * outbox, no idempotency record. A DISABLED shop is still readable (online=false); a user without a shop gets
   * SHOP_NOT_FOUND.
   */
  async read(actor: SessionActor): Promise<Record<string, unknown>> {
    const snapshot = await this.transactions.withTransaction(async (context) => {
      await this.sessionAuth.lockAuthorizedShopActorShared(context, actor);
      return this.reader.snapshotOfOwner(context, actor.userId);
    });
    if (snapshot === undefined) {
      throw new AppError('SHOP_NOT_FOUND');
    }
    return toView(snapshot);
  }

  async updateProfile(
    actor: SessionActor,
    input: ShopProfileUpdateInput,
    idempotencyKey: string | readonly string[] | undefined,
    requestId: string,
  ): Promise<ShopManagementOutcome> {
    const profile = input.profile;
    const outcome = await this.executor.execute(
      {
        scopeType: SHOP_MANAGEMENT_SCOPE_TYPE,
        scopeId: actor.userId,
        operationId: SHOP_PROFILE_UPDATE_OPERATION_ID,
        idempotencyKey,
        // The NORMALIZED request: "absent" and null are the same logical request for zalo and facebook.
        logicalRequest: {
          expected_version: input.expectedVersion,
          name: profile.name,
          contact_phone: profile.contactPhoneNormalized,
          zalo: profile.zalo,
          facebook: profile.facebook,
          address_text: profile.addressText,
          pickup_lat: profile.pickupLat,
          pickup_lng: profile.pickupLng,
          service_area_id: profile.serviceAreaId,
        },
        replay: { kind: 'sensitive', authorize: (context, guard) => this.#authorizeReplay(context, guard, actor) },
      },
      (context) => this.#updateProfile(context, actor, input, requestId),
    );
    return { status: outcome.status, payload: outcome.payload, replayed: outcome.replayed };
  }

  async replaceBusinessHours(
    actor: SessionActor,
    input: BusinessHoursReplaceInput,
    idempotencyKey: string | readonly string[] | undefined,
    requestId: string,
  ): Promise<ShopManagementOutcome> {
    // Idempotent for an already canonical schedule: the fingerprint is built from the canonical form, so the order
    // of the request array and the two spellings of a full day are the same logical request.
    const intervals = canonicalizeBusinessHours(input.intervals);
    const outcome = await this.executor.execute(
      {
        scopeType: SHOP_MANAGEMENT_SCOPE_TYPE,
        scopeId: actor.userId,
        operationId: SHOP_BUSINESS_HOURS_REPLACE_OPERATION_ID,
        idempotencyKey,
        logicalRequest: { expected_version: input.expectedVersion, intervals: intervals.map(toWire) },
        replay: { kind: 'sensitive', authorize: (context, guard) => this.#authorizeReplay(context, guard, actor) },
      },
      (context) => this.#replaceBusinessHours(context, actor, { ...input, intervals }, requestId),
    );
    return { status: outcome.status, payload: outcome.payload, replayed: outcome.replayed };
  }

  async #updateProfile(
    context: TransactionContext,
    actor: SessionActor,
    input: ShopProfileUpdateInput,
    requestId: string,
  ) {
    const userId = actor.userId;
    await this.sessionAuth.lockAuthorizedShopActor(context, actor);
    const shop = await this.#lockWritableShop(context, userId, input.expectedVersion);

    const profile = input.profile;
    // The area is checked only now, after the version: a stale request locks nothing it does not need. FOR SHARE
    // keeps the area from being deactivated before this transaction commits.
    const area = profile.serviceAreaId === null ? undefined : await this.serviceAreas.lockShared(context, profile.serviceAreaId);
    if (area === undefined || area.status !== 'ACTIVE') {
      throw new AppError('INVALID_SERVICE_AREA');
    }

    const version = await this.shops.updateActiveProfile(context, shop.shopId, shop.version, profile);
    await this.#record(context, requestId, userId, shop.shopId, version, {
      audit: SHOP_MANAGEMENT_AUDIT_ACTIONS.profileUpdate,
      event: SHOP_PROFILE_UPDATED_EVENT_TYPE,
    });

    return {
      status: 200,
      replayGuard: { user_id: userId, shop_id: shop.shopId },
      payload: {
        shop_id: shop.shopId,
        version,
        profile: {
          name: profile.name,
          contact_phone: profile.contactPhoneNormalized,
          zalo: profile.zalo,
          facebook: profile.facebook,
          address_text: profile.addressText,
          pickup_lat: profile.pickupLat,
          pickup_lng: profile.pickupLng,
          service_area_id: profile.serviceAreaId,
        },
      },
    };
  }

  async #replaceBusinessHours(
    context: TransactionContext,
    actor: SessionActor,
    input: BusinessHoursReplaceInput,
    requestId: string,
  ) {
    const userId = actor.userId;
    await this.sessionAuth.lockAuthorizedShopActor(context, actor);
    const shop = await this.#lockWritableShop(context, userId, input.expectedVersion);

    // Delete + insert + version, in this order, inside the one transaction: a failure of any step (or of audit,
    // outbox or the idempotency record after it) rolls the previous schedule back untouched.
    await this.hours.replaceAll(context, shop.shopId, input.intervals);
    const version = await this.shops.advanceVersion(context, shop.shopId, shop.version);
    await this.#record(context, requestId, userId, shop.shopId, version, {
      audit: SHOP_MANAGEMENT_AUDIT_ACTIONS.businessHoursReplace,
      event: SHOP_BUSINESS_HOURS_UPDATED_EVENT_TYPE,
    });

    return {
      status: 200,
      replayGuard: { user_id: userId, shop_id: shop.shopId },
      payload: {
        shop_id: shop.shopId,
        version,
        timezone: AVAILABILITY_TIME_ZONE,
        intervals: input.intervals.map(toWire),
      },
    };
  }

  /**
   * The owned shop, locked (OWNER membership then shop), that a mutation may change at exactly `expectedVersion`.
   * No shop is SHOP_NOT_FOUND; a DISABLED one is SHOP_DISABLED; an INCOMPLETE one belongs to onboarding
   * (SHOP_PROFILE_INCOMPLETE); a stale version is VERSION_CONFLICT. A status nobody recognizes is a technical error.
   */
  async #lockWritableShop(context: TransactionContext, userId: string, expectedVersion: number): Promise<ShopRow> {
    const shop = await this.shops.lockOwnedShop(context, userId);
    if (shop === undefined) {
      throw new AppError('SHOP_NOT_FOUND');
    }
    requireActiveShop(shop);
    if (shop.version !== expectedVersion) {
      throw new AppError('VERSION_CONFLICT');
    }
    return shop;
  }

  /** One SUCCESS audit row and one outbox event per committed mutation: safe ids and the new version only. */
  async #record(
    context: TransactionContext,
    requestId: string,
    userId: string,
    shopId: string,
    version: number,
    names: { readonly audit: string; readonly event: string },
  ): Promise<void> {
    await this.audit.append(context, {
      requestId,
      actorType: 'USER',
      actorId: userId,
      action: names.audit,
      resourceType: SHOP_MANAGEMENT_RESOURCE_TYPE,
      resourceId: shopId,
      resourceVersion: version,
      outcome: 'SUCCESS',
      metadata: { operation: names.audit },
    });
    await this.outbox.append(context, {
      eventType: names.event,
      eventSchemaVersion: SHOP_MANAGEMENT_EVENT_SCHEMA_VERSION,
      resourceType: SHOP_MANAGEMENT_RESOURCE_TYPE,
      resourceId: shopId,
      resourceVersion: version,
      payload: { shop_id: shopId, version },
    });
  }

  /**
   * A stored result is replayed only while the CURRENT session is still valid for this user in the SHOP context, the
   * user is ACTIVE, the user still OWNS the same shop and that shop is ACTIVE. The same authorization as a new
   * execution runs first (user then session, both locked, fresh database clock), then membership and shop, all BEFORE
   * anything is decrypted. The replay guard is exactly {user_id, shop_id}: a valid replacement session of the same
   * user may replay, a revoked or expired one may not. The sessionId is authorization context here, never part of the
   * logical request, the idempotency scope or the guard. No expected_version check and no service-area check: a
   * replay mutates nothing, so a stale version or an area deactivated since does not stop the owner from reading
   * back the result that was stored.
   */
  async #authorizeReplay(context: TransactionContext, guard: JsonObject, actor: SessionActor): Promise<true> {
    const guardedUser = guard.user_id;
    const guardedShop = guard.shop_id;
    if (!isCanonicalUuid(guardedUser) || guardedUser !== actor.userId || !isCanonicalUuid(guardedShop)) {
      throw new TechnicalError('internal', 'Invalid replay guard');
    }
    await this.sessionAuth.lockAuthorizedShopActor(context, actor);
    const shop = await this.shops.lockOwnedShop(context, actor.userId);
    if (shop === undefined || shop.shopId !== guardedShop) {
      throw new AppError('SHOP_NOT_FOUND');
    }
    requireActiveShop(shop);
    return true;
  }
}

/** ACTIVE passes; DISABLED and INCOMPLETE are refused with their own codes; anything else is a broken invariant. */
function requireActiveShop(shop: ShopRow): void {
  switch (shop.status) {
    case 'ACTIVE':
      return;
    case 'DISABLED':
      throw new AppError('SHOP_DISABLED');
    case 'INCOMPLETE':
      throw new AppError('SHOP_PROFILE_INCOMPLETE');
    default:
      throw new TechnicalError('internal', 'Unexpected shop status');
  }
}

/** The exact GET /v1/shop/me data object (task section 10). It never includes accepting_orders. */
function toView(snapshot: ShopSnapshot): Record<string, unknown> {
  return {
    shop_id: snapshot.shopId,
    name: snapshot.name,
    contact_phone: snapshot.contactPhoneNormalized,
    zalo: snapshot.zalo,
    facebook: snapshot.facebook,
    address_text: snapshot.addressText,
    pickup_lat: snapshot.pickupLat,
    pickup_lng: snapshot.pickupLng,
    service_area_id: snapshot.serviceAreaId,
    status: snapshot.status,
    version: snapshot.version,
    timezone: AVAILABILITY_TIME_ZONE,
    hours: snapshot.hours.map(toWire),
    availability: {
      online: snapshot.availability.online,
      reason: snapshot.availability.reason,
      evaluated_at: snapshot.availability.evaluatedAt,
    },
  };
}
