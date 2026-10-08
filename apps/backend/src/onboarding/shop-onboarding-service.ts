import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuditWriter } from '../audit/audit-writer';
import { RoleGrantParticipant } from '../auth/role-grant-participant';
import { AppError, TechnicalError } from '../common/app-errors';
import { IdempotencyExecutor, JsonObject } from '../idempotency/idempotency-executor';
import { OutboxWriter } from '../outbox/outbox-writer';
import { isCanonicalUuid } from '../shared/identifiers';
import { ServiceAreaRepository } from '../shop/service-area-repository';
import { ShopRepository } from '../shop/shop-repository';
import { TransactionContext } from '../transaction/transaction-context';
import {
  ONBOARDING_AUDIT_ACTIONS,
  ONBOARDING_SCOPE_TYPE,
  SHOP_COMPLETE_OPERATION_ID,
  SHOP_ONBOARDED_EVENT_SCHEMA_VERSION,
  SHOP_ONBOARDED_EVENT_TYPE,
  SHOP_PROFILE_SAVE_OPERATION_ID,
  SHOP_RESOURCE_TYPE,
} from './onboarding-constants';
import { ShopCompleteInput, ShopProfileInput } from './shop-onboarding-validation';

export interface OnboardingOutcome {
  readonly status: number;
  readonly payload: unknown;
  readonly replayed: boolean;
}

/**
 * Shop onboarding coordinator (M01-A2S). One transaction per command, opened by the M00 IdempotencyExecutor.
 *
 * Lock order inside the callback (the A2 global order, after the executor's own advisory + record locks):
 *   user row -> OWNER membership -> shop -> service_area (FOR SHARE) -> business writes -> audit/outbox.
 * The authenticated user comes from the session principal; nothing about identity, role, status or
 * accepting_orders is read from the request body.
 */
@Injectable()
export class ShopOnboardingService {
  constructor(
    private readonly executor: IdempotencyExecutor,
    private readonly roleGrants: RoleGrantParticipant,
    private readonly shops: ShopRepository,
    private readonly serviceAreas: ServiceAreaRepository,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  async saveProfile(
    userId: string,
    input: ShopProfileInput,
    idempotencyKey: string | readonly string[] | undefined,
    requestId: string,
  ): Promise<OnboardingOutcome> {
    const outcome = await this.executor.execute(
      {
        scopeType: ONBOARDING_SCOPE_TYPE,
        scopeId: userId,
        operationId: SHOP_PROFILE_SAVE_OPERATION_ID,
        idempotencyKey,
        // The NORMALIZED request: "absent" and null are the same logical request.
        logicalRequest: {
          name: input.name,
          contact_phone: input.contactPhoneNormalized,
          zalo: input.zalo,
          facebook: input.facebook,
          address_text: input.addressText,
          pickup_lat: input.pickupLat,
          pickup_lng: input.pickupLng,
          service_area_id: input.serviceAreaId,
          expected_version: input.expectedVersion,
        },
        replay: { kind: 'sensitive', authorize: (context, guard) => this.#authorizeReplay(context, guard, userId) },
      },
      (context) => this.#save(context, userId, input, requestId),
    );
    return { status: outcome.status, payload: outcome.payload, replayed: outcome.replayed };
  }

  async complete(
    userId: string,
    input: ShopCompleteInput,
    idempotencyKey: string | readonly string[] | undefined,
    requestId: string,
  ): Promise<OnboardingOutcome> {
    const outcome = await this.executor.execute(
      {
        scopeType: ONBOARDING_SCOPE_TYPE,
        scopeId: userId,
        operationId: SHOP_COMPLETE_OPERATION_ID,
        idempotencyKey,
        logicalRequest: { expected_version: input.expectedVersion },
        replay: { kind: 'sensitive', authorize: (context, guard) => this.#authorizeReplay(context, guard, userId) },
      },
      (context) => this.#complete(context, userId, input, requestId),
    );
    return { status: outcome.status, payload: outcome.payload, replayed: outcome.replayed };
  }

  async #save(context: TransactionContext, userId: string, input: ShopProfileInput, requestId: string) {
    await this.roleGrants.lockActiveUser(context, userId);
    const existing = await this.shops.lockOwnedShop(context, userId);

    if (input.expectedVersion === null && existing !== undefined) {
      throw new AppError('SHOP_ONBOARDING_EXISTS');
    }
    if (input.expectedVersion !== null) {
      if (existing === undefined) {
        // There is no draft to be at that version.
        throw new AppError('VERSION_CONFLICT');
      }
      if (existing.status !== 'INCOMPLETE') {
        // ACTIVE and DISABLED shops are not mutable through onboarding.
        throw new AppError('SHOP_ONBOARDING_EXISTS');
      }
      if (existing.version !== input.expectedVersion) {
        throw new AppError('VERSION_CONFLICT');
      }
    }

    if (input.serviceAreaId !== null) {
      const area = await this.serviceAreas.lockShared(context, input.serviceAreaId);
      if (area === undefined || area.status !== 'ACTIVE') {
        throw new AppError('INVALID_SERVICE_AREA');
      }
    }

    let shopId: string;
    let version: number;
    let created: boolean;
    if (existing === undefined) {
      shopId = randomUUID();
      version = 1;
      created = true;
      await this.shops.insertDraft(context, shopId, input);
      if (!(await this.shops.insertOwnerMembership(context, shopId, userId))) {
        throw new AppError('SHOP_ONBOARDING_EXISTS');
      }
    } else {
      shopId = existing.shopId;
      created = false;
      version = await this.shops.updateDraft(context, shopId, existing.version, input);
    }

    await this.audit.append(context, {
      requestId,
      actorType: 'USER',
      actorId: userId,
      action: ONBOARDING_AUDIT_ACTIONS.shopProfileSave,
      resourceType: SHOP_RESOURCE_TYPE,
      resourceId: shopId,
      resourceVersion: version,
      outcome: 'SUCCESS',
      metadata: { created },
    });

    return {
      status: created ? 201 : 200,
      replayGuard: { user_id: userId },
      payload: { shop_id: shopId, status: 'INCOMPLETE', version, role_granted: false },
    };
  }

  async #complete(context: TransactionContext, userId: string, input: ShopCompleteInput, requestId: string) {
    await this.roleGrants.lockActiveUser(context, userId);
    const shop = await this.shops.lockOwnedShop(context, userId);
    if (shop === undefined) {
      throw new AppError('SHOP_PROFILE_INCOMPLETE');
    }
    if (shop.status !== 'INCOMPLETE') {
      throw new AppError('SHOP_ONBOARDING_EXISTS');
    }
    if (shop.version !== input.expectedVersion) {
      throw new AppError('VERSION_CONFLICT');
    }
    if (shop.pickupLat === null || shop.pickupLng === null || shop.serviceAreaId === null) {
      throw new AppError('SHOP_PROFILE_INCOMPLETE');
    }
    const area = await this.serviceAreas.lockShared(context, shop.serviceAreaId);
    if (area === undefined || area.status !== 'ACTIVE') {
      throw new AppError('INVALID_SERVICE_AREA');
    }

    const version = await this.shops.activate(context, shop.shopId, shop.version);
    await this.roleGrants.grant(context, userId, 'SHOP');

    await this.audit.append(context, {
      requestId,
      actorType: 'USER',
      actorId: userId,
      action: ONBOARDING_AUDIT_ACTIONS.shopComplete,
      resourceType: SHOP_RESOURCE_TYPE,
      resourceId: shop.shopId,
      resourceVersion: version,
      outcome: 'SUCCESS',
      metadata: { role: 'SHOP' },
    });
    await this.outbox.append(context, {
      eventType: SHOP_ONBOARDED_EVENT_TYPE,
      eventSchemaVersion: SHOP_ONBOARDED_EVENT_SCHEMA_VERSION,
      resourceType: SHOP_RESOURCE_TYPE,
      resourceId: shop.shopId,
      resourceVersion: version,
      payload: { shop_id: shop.shopId, user_id: userId },
    });

    return {
      status: 200,
      replayGuard: { user_id: userId },
      payload: {
        shop_id: shop.shopId,
        status: 'ACTIVE',
        accepting_orders: false,
        role_granted: true,
        version,
      },
    };
  }

  /** A stored result is replayed only while the account is still ACTIVE (user row locked first). */
  async #authorizeReplay(context: TransactionContext, guard: JsonObject, userId: string): Promise<true> {
    const guarded = guard.user_id;
    if (!isCanonicalUuid(guarded) || guarded !== userId) {
      throw new TechnicalError('internal', 'Invalid replay guard');
    }
    await this.roleGrants.lockActiveUser(context, userId);
    return true;
  }
}
