import { Inject, Injectable } from '@nestjs/common';
import { AdminAccountReadRepository } from '../admin-accounts/admin-account-read-repository';
import { AdminRole } from '../admin-auth/admin-auth-constants';
import { SessionLookup } from '../admin-auth/admin-session-repository';
import { PROVISIONING_SCOPE_TYPE } from '../admin-provisioning/admin-provisioning-constants';
import { setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { AdminSystemActor } from '../admin-provisioning/admin-system-actor';
import { AuditWriter } from '../audit/audit-writer';
import { AppError, TechnicalError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { OutboxWriter } from '../outbox/outbox-writer';
import { toWire } from '../shop/business-hours';
import { ServiceAreaRepository } from '../shop/service-area-repository';
import { ShopAvailabilityReader, ShopSnapshot } from '../shop/shop-availability-reader';
import { AVAILABILITY_TIME_ZONE } from '../shop/shop-availability-sql';
import { ShopRepository } from '../shop/shop-repository';
import { ShopAvailability } from '../shop/shop-types';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { AdminShopReadRepository, HistoryRow, OwnerFacts } from './admin-shop-read-repository';
import { ShopHistoryQuery, ShopListQuery, ShopMenuQuery, StatusChangeBody } from './admin-shop-validation';

export type ShopStatusCommand = 'disable' | 'enable';

const OPERATION: Readonly<Record<ShopStatusCommand, string>> = {
  disable: 'admin.shop.disable.v1',
  enable: 'admin.shop.enable.v1',
};
const EVENT: Readonly<Record<ShopStatusCommand, string>> = {
  disable: 'shop.disabled_by_admin.v1',
  enable: 'shop.enabled_by_admin.v1',
};
const RESOURCE = 'shop';

/** Reasons the audit rows carry; the screen turns the operation name into a sentence. */
export const SHOP_ADMIN_AUDIT_ACTIONS: readonly string[] = [OPERATION.disable, OPERATION.enable];

interface Authorized {
  readonly role: AdminRole;
  readonly actorId: string;
  /** May disable / enable (SYSTEM, or an ADMIN whose CURRENT SHOP row has VIEW and the shop-management right). */
  readonly manage: boolean;
}

const iso = (ms: number): string => new Date(ms).toISOString();

const ownerView = (owner: OwnerFacts | undefined): JsonObject | null => (owner === undefined ? null : { name: owner.name, phone: owner.phone, locked: owner.locked });

const availabilityView = (availability: ShopAvailability): JsonObject => ({ online: availability.online, reason: availability.reason, evaluated_at: availability.evaluatedAt });

const logoUrl = (snapshot: ShopSnapshot): string | null => (snapshot.logo == null ? null : `/v1/shops/${snapshot.shopId}/logo?v=${String(snapshot.version)}`);

/** Why a DISABLED shop cannot be switched on yet, from the stored profile (the same conditions the onboarding completion checks). */
function enableBlockers(snapshot: ShopSnapshot, areaStatus: string | null): string[] {
  const blockers: string[] = [];
  if (snapshot.pickupLat === null || snapshot.pickupLng === null) {
    blockers.push('PICKUP_POINT_MISSING');
  }
  if (snapshot.serviceAreaId === null) {
    blockers.push('SERVICE_AREA_MISSING');
  } else if (areaStatus !== 'ACTIVE') {
    blockers.push('SERVICE_AREA_INACTIVE');
  }
  return blockers;
}

function historyView(row: HistoryRow): JsonObject {
  const meta = row.metadata;
  const text = (key: string): string | null => (typeof meta[key] === 'string' ? (meta[key] as string) : null);
  return {
    audit_id: row.auditId,
    occurred_at: iso(row.occurredAtMs),
    // An owner is told only by role: the page never shows a login phone of an actor.
    actor: row.actorType === 'USER' ? { type: 'OWNER', name: null } : { type: row.actorType === 'SYSTEM' ? 'SYSTEM' : 'ADMIN', name: row.actorName },
    action: row.action,
    version: row.version,
    reason: text('reason'),
    from_status: text('from_status'),
    to_status: text('to_status'),
  };
}

/**
 * Shop management for the administration web (M02 "Quản lý quán"): the list, the detail with the schedule, the dishes, the history and the customer
 * preview (reads), and the two status commands DISABLE / ENABLE (writes). SYSTEM, or an ADMIN whose CURRENT permission rows give VIEW on the SHOP app
 * (read) plus the shop-management right on SHOP (disable / enable: the separate `can_manage_shops` right; `can_lock`, which locks accounts, gives nothing here). The backend decides on every read and
 * write under the actor's locks and the database clock; the screen only hides what it cannot use.
 *
 * There is NO route that edits a profile, a schedule, a price or a dish: the owner keeps doing that in 11Food. A status command changes one column
 * (ACTIVE <-> DISABLED) and the version, writes the audit row (actor, reason, before / after, version) and the outbox event in the same transaction, and
 * touches no order, no delivery and no account. Lock order: the executor's record -> the actor's locks -> the shop row FOR UPDATE -> audit -> outbox.
 */
@Injectable()
export class AdminShopService {
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actor: AdminSystemActor,
    private readonly permissions: AdminAccountReadRepository,
    private readonly reads: AdminShopReadRepository,
    private readonly shops: ShopRepository,
    private readonly snapshots: ShopAvailabilityReader,
    private readonly areas: ServiceAreaRepository,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
  }

  async list(sessionToken: string | undefined, query: ShopListQuery): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.#read(known, async (context) => {
      const page = await this.reads.list(context, { name: query.name, digits: query.digits, areaId: query.areaId, profile: query.profile, schedule: query.schedule }, query.limit, query.offset);
      const areas = await this.areas.listAll(context);
      return {
        items: page.rows.map((row) => ({
          shop_id: row.shopId,
          code: row.code,
          name: row.name,
          address_text: row.addressText,
          owner: ownerView(row.owner),
          service_area: row.areaId === null ? null : { service_area_id: row.areaId, name: row.areaName },
          status: row.status,
          version: row.version,
          availability: availabilityView(row.availability),
          items_visible: row.itemsVisible,
          items_total: row.itemsTotal,
        })),
        total: page.total,
        limit: query.limit,
        offset: query.offset,
        areas: areas.map((area) => ({ service_area_id: area.serviceAreaId, name: area.name, status: area.status })),
      };
    });
  }

  async detail(sessionToken: string | undefined, shopId: string): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.#read(known, async (context, auth) => this.#detailView(context, auth, shopId));
  }

  async menu(sessionToken: string | undefined, shopId: string, query: ShopMenuQuery): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.#read(known, async (context) => {
      await this.#requireShop(context, shopId);
      const [groups, page] = await Promise.all([this.reads.menuGroups(context, shopId), this.reads.menuItems(context, shopId, { name: query.name, categoryId: query.categoryId, status: query.status }, query.limit, query.offset)]);
      return {
        categories: groups.map((group) => ({ category_id: group.categoryId, name: group.name, status: group.status, item_count: group.itemCount })),
        items: page.rows.map((item) => ({
          item_id: item.itemId,
          name: item.name,
          price_vnd: item.priceVnd,
          category: { category_id: item.categoryId, name: item.categoryName, status: item.categoryStatus },
          status: item.status,
          image_url: item.imageId === null ? null : `/v1/menu-images/${item.imageId}`,
          version: item.version,
          updated_at: iso(item.updatedAtMs),
        })),
        total: page.total,
        limit: query.limit,
        offset: query.offset,
      };
    });
  }

  async history(sessionToken: string | undefined, shopId: string, query: ShopHistoryQuery): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.#read(known, async (context) => {
      await this.#requireShop(context, shopId);
      const page = await this.reads.history(context, shopId, query.limit, query.offset);
      return { items: page.rows.map(historyView), total: page.total, limit: query.limit, offset: query.offset };
    });
  }

  /**
   * "Xem như khách": what a customer would be shown for this shop right now, built from the same stored data and the same rule as GET /v1/shops/:id
   * (an ACTIVE shop in an ACTIVE area; VISIBLE dishes only; no phone, Zalo, Facebook or GPS). When customers cannot see the shop at all the answer says so
   * (`visible_to_customers: false` and the reason); it never invents a preview.
   */
  async preview(sessionToken: string | undefined, shopId: string): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.#read(known, async (context) => {
      const snapshot = await this.snapshots.snapshotOfShop(context, shopId);
      if (snapshot === undefined) {
        throw new AppError('SHOP_NOT_FOUND');
      }
      const reason = snapshot.availability.reason;
      if (snapshot.status !== 'ACTIVE' || reason === 'SHOP_DISABLED' || reason === 'SHOP_INCOMPLETE' || reason === 'SERVICE_AREA_INACTIVE') {
        const hidden: JsonObject = { visible_to_customers: false, reason, shop_id: shopId };
        return hidden;
      }
      const items = await this.reads.previewItems(context, shopId);
      const groups: { category_id: string; name: string; items: JsonObject[] }[] = [];
      for (const item of items) {
        let group = groups.find((candidate) => candidate.category_id === item.categoryId);
        if (group === undefined) {
          group = { category_id: item.categoryId, name: item.categoryName, items: [] };
          groups.push(group);
        }
        group.items.push({ item_id: item.itemId, name: item.name, price_vnd: item.priceVnd, image_url: item.imageId === null ? null : `/v1/menu-images/${item.imageId}` });
      }
      const visible: JsonObject = {
        visible_to_customers: true,
        shop_id: snapshot.shopId,
        logo_url: logoUrl(snapshot),
        name: snapshot.name,
        address_text: snapshot.addressText,
        timezone: AVAILABILITY_TIME_ZONE,
        availability: availabilityView(snapshot.availability),
        hours: snapshot.hours.map(toWire),
        categories: groups,
      };
      return visible;
    });
  }

  async command(
    name: ShopStatusCommand,
    sessionToken: string | undefined,
    csrfHeader: unknown,
    shopId: string,
    body: StatusChangeBody,
    idempotencyKey: string | readonly string[] | undefined,
    meta: { requestId: string },
  ): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrfHeader });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE,
        scopeId: known.userId,
        operationId: OPERATION[name],
        idempotencyKey,
        logicalRequest: { shop_id: shopId, expected_version: body.expectedVersion, reason: body.reason },
        replay: { kind: 'sensitive', authorize: (context, guard) => this.#authorizeReplay(context, guard, known, shopId) },
      },
      async (context) => {
        const auth = await this.#authorize(context, known, 'manage');
        const shop = await this.shops.lockShopForUpdate(context, shopId);
        if (shop === undefined) {
          throw new AppError('SHOP_NOT_FOUND');
        }
        if (shop.version !== body.expectedVersion) {
          throw new AppError('VERSION_CONFLICT');
        }
        const from = name === 'disable' ? 'ACTIVE' : 'DISABLED';
        if (shop.status !== from) {
          // A draft is finished and switched on by its owner (the onboarding flow); a shop already in the wanted state needs nothing.
          throw new AppError('SHOP_STATE_CONFLICT');
        }
        const work = await this.reads.openWork(context, shopId);
        if (name === 'disable' && (work.ordersOpen > 0 || work.activeDeliveries > 0)) {
          // Counted again here, under the shop row lock, never from the popup's figures: nothing is cancelled or ended to make room.
          throw new AppError('SHOP_HAS_OPEN_WORK');
        }
        if (name === 'enable') {
          // The same conditions as the onboarding completion: a pickup point and an ACTIVE service area (held FOR SHARE until commit).
          if (shop.pickupLat === null || shop.pickupLng === null || shop.serviceAreaId === null) {
            throw new AppError('SHOP_PROFILE_INCOMPLETE');
          }
          const area = await this.areas.lockShared(context, shop.serviceAreaId);
          if (area === undefined || area.status !== 'ACTIVE') {
            throw new AppError('INVALID_SERVICE_AREA');
          }
        }
        const to = name === 'disable' ? 'DISABLED' : 'ACTIVE';
        const version = await this.shops.changeStatus(context, shopId, from, to, shop.version);
        await this.audit.append(context, {
          requestId: meta.requestId,
          actorType: auth.role,
          actorId: auth.actorId,
          action: OPERATION[name],
          resourceType: RESOURCE,
          resourceId: shopId,
          resourceVersion: version,
          outcome: 'SUCCESS',
          metadata: {
            shop_id: shopId,
            reason: body.reason,
            from_status: from,
            to_status: to,
            from_version: shop.version,
            version,
            open_orders: work.ordersOpen,
            active_deliveries: work.activeDeliveries,
          },
        });
        await this.outbox.append(context, {
          eventType: EVENT[name],
          eventSchemaVersion: 1,
          resourceType: RESOURCE,
          resourceId: shopId,
          resourceVersion: version,
          payload: { shop_id: shopId, status: to, version },
        });
        return { status: 200, replayGuard: { actor_user_id: auth.actorId, shop_id: shopId }, payload: await this.#detailView(context, auth, shopId) };
      },
    );
  }

  async #read<T>(known: SessionLookup, body: (context: TransactionContext, auth: Authorized) => Promise<T>): Promise<T> {
    return this.transactions.withTransaction(async (context): Promise<T> => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const auth = await this.#authorize(context, known, 'view');
      return body(context, auth);
    });
  }

  async #requireShop(context: TransactionContext, shopId: string): Promise<void> {
    if ((await this.reads.facts(context, shopId)) === undefined) {
      throw new AppError('SHOP_NOT_FOUND');
    }
  }

  async #detailView(context: TransactionContext, auth: Authorized, shopId: string): Promise<JsonObject> {
    const [snapshot, facts, work] = await Promise.all([this.snapshots.snapshotOfShop(context, shopId), this.reads.facts(context, shopId), this.reads.openWork(context, shopId)]);
    if (snapshot === undefined || facts === undefined) {
      throw new AppError('SHOP_NOT_FOUND');
    }
    const actions: string[] = [];
    if (auth.manage && snapshot.status === 'ACTIVE') {
      actions.push('DISABLE');
    }
    const blocked = snapshot.status === 'ACTIVE' && (work.ordersOpen > 0 || work.activeDeliveries > 0);
    if (auth.manage && snapshot.status === 'DISABLED') {
      actions.push('ENABLE');
    }
    return {
      shop_id: snapshot.shopId,
      code: facts.code,
      name: snapshot.name,
      status: snapshot.status,
      version: snapshot.version,
      logo_url: logoUrl(snapshot),
      owner: ownerView(facts.owner),
      profile: {
        contact_phone: snapshot.contactPhoneNormalized,
        zalo: snapshot.zalo,
        facebook: snapshot.facebook,
        address_text: snapshot.addressText,
        service_area: snapshot.serviceAreaId === null ? null : { service_area_id: snapshot.serviceAreaId, name: facts.areaName, status: facts.areaStatus },
        pickup_lat: snapshot.pickupLat,
        pickup_lng: snapshot.pickupLng,
      },
      availability: availabilityView(snapshot.availability),
      timezone: AVAILABILITY_TIME_ZONE,
      hours: snapshot.hours.map(toWire),
      menu: { visible: facts.itemsVisible, hidden: facts.itemsHidden },
      open_work: {
        orders_open: work.ordersOpen,
        orders_pending_confirmation: work.ordersPendingConfirmation,
        orders_preparing: work.ordersPreparing,
        active_deliveries: work.activeDeliveries,
      },
      disable_blocked: blocked,
      enable_blockers: snapshot.status === 'DISABLED' ? enableBlockers(snapshot, facts.areaStatus) : [],
      allowed_actions: actions,
      created_at: iso(facts.createdAtMs),
      updated_at: iso(facts.updatedAtMs),
    };
  }

  /**
   * Actor locks in the module order, the CURRENT permission rows (ADMIN) and the database clock after the last lock, then the right: SYSTEM; or an ADMIN with
   * VIEW on SHOP, and for a write also the shop-management right of the SHOP row. Nothing from the client decides it.
   */
  async #authorize(context: TransactionContext, known: SessionLookup, right: 'view' | 'manage'): Promise<Authorized> {
    const locked = await this.actor.lock(context, known, { user: 'read', factor: 'read' });
    const role = locked.checked.membership.adminRole;
    const rows = role === 'ADMIN' ? await this.permissions.permissions(context, known.userId) : [];
    const nowMs = await freshClockMs(context);
    this.actor.assertSessionLive(locked, nowMs);
    if (role === 'SYSTEM') {
      return { role, actorId: known.userId, manage: true };
    }
    const shop = rows.find((candidate) => candidate.app === 'SHOP');
    const view = shop?.canView ?? false;
    const manage = view && (shop?.canManageShops ?? false);
    if (!view || (right === 'manage' && !manage)) {
      throw new AppError('ADMIN_FORBIDDEN');
    }
    return { role, actorId: known.userId, manage };
  }

  async #authorizeReplay(context: TransactionContext, guard: JsonObject, known: SessionLookup, shopId: string): Promise<true> {
    if (guard.actor_user_id !== known.userId || guard.shop_id !== shopId) {
      throw new TechnicalError('internal', 'Invalid replay guard');
    }
    await this.#authorize(context, known, 'manage');
    return true;
  }
}
