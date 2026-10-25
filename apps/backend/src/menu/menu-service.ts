import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { OrderSalesReader } from '../orders/order-sales-reader';
import { AuditWriter } from '../audit/audit-writer';
import { SessionActor, SessionAuthorizationParticipant } from '../auth/session-authorization-participant';
import { AppError, TechnicalError } from '../common/app-errors';
import { IdempotencyExecutor, JsonObject } from '../idempotency/idempotency-executor';
import { OutboxWriter } from '../outbox/outbox-writer';
import { isCanonicalUuid } from '../shared/identifiers';
import { toWire } from '../shop/business-hours';
import { requireActiveShop } from '../shop/shop-guards';
import { AVAILABILITY_TIME_ZONE } from '../shop/shop-availability-sql';
import { ShopAvailabilityReader } from '../shop/shop-availability-reader';
import { ShopRepository, ShopRow } from '../shop/shop-repository';
import { FREE_VISIBLE_DISH_LIMIT } from '../shop-payment/shop-payment-constants';
import { ShopPaymentRepository } from '../shop-payment/shop-payment-repository';
import { ShopActivation } from '../shop-setup/shop-activation';
import { publicContactOf } from '../shop-setup/shop-public-contact';
import { ShopSetupGate } from '../shop-setup/shop-setup-gate';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import {
  MENU_EVENT_SCHEMA_VERSION,
  MENU_IMAGES_MAX_PER_SHOP,
  MENU_ITEM_CHANGED_EVENT_TYPE,
  MENU_ITEM_CREATE_OPERATION_ID,
  MENU_ITEM_DELETE_OPERATION_ID,
  MENU_ITEM_HIDE_OPERATION_ID,
  MENU_ITEM_SHOW_OPERATION_ID,
  MENU_ITEM_UPDATE_OPERATION_ID,
  MENU_ITEMS_MAX_PER_SHOP,
  MENU_LIMITS,
  MENU_RESOURCE_TYPE,
  MENU_SCOPE_TYPE,
} from './menu-constants';
import { MenuCategoryRow, MenuItemRow, MenuRepository } from './menu-repository';
import { ImageUploadInput, ItemUpdateInput, MenuItemFields } from './menu-validation';

export interface MenuOutcome {
  readonly status: number;
  readonly payload: unknown;
}

/**
 * Menu coordinator (M02-MON). The dish mutations run in the transaction of the M00 IdempotencyExecutor; the two owner reads and
 * the picture upload open one transaction of their own; the public reads open a read transaction without any session.
 *
 * Lock order of a NEW mutation (after the executor's advisory + record locks), the A2 global order extended by Menu:
 *   user FOR UPDATE -> CURRENT session FOR UPDATE -> OWNER membership -> shop FOR UPDATE -> group FOR SHARE -> picture
 *   FOR SHARE -> dish FOR UPDATE -> writes -> audit -> outbox -> (the executor writes the idempotency record last).
 * The shop row lock serializes every menu write of one shop, so the dish count cap and the version checks cannot race. The shop's
 * own version (profile + schedule) is NOT advanced by a dish: a dish has a version of its own.
 *
 * Who the actor is, which shop is meant and what the role is come only from the authenticated principal and the locked rows,
 * never from a body or a URL (a dish id of another shop is "not found"). A DISABLED shop can still be READ but nothing is written.
 */
@Injectable()
export class MenuService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly sessionAuth: SessionAuthorizationParticipant,
    private readonly shops: ShopRepository,
    private readonly menu: MenuRepository,
    private readonly reader: ShopAvailabilityReader,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly sales: OrderSalesReader,
    private readonly activation: ShopActivation,
    private readonly gate: ShopSetupGate,
    private readonly entitlements: ShopPaymentRepository,
  ) {}

  // ---- reads ----------------------------------------------------------------------------------------------------

  /** GET /v1/shop/me/menu: every group (so an INACTIVE one keeps its name) and every dish that is not deleted. */
  async readOwnMenu(actor: SessionActor): Promise<Record<string, unknown>> {
    return this.transactions.withTransaction(async (context) => {
      await this.sessionAuth.lockAuthorizedShopActorShared(context, actor);
      const shop = await this.shops.findOwnedShop(context, actor.userId);
      if (shop === undefined) {
        throw new AppError('SHOP_NOT_FOUND');
      }
      const [categories, items] = await Promise.all([
        this.menu.listCategories(context),
        this.menu.listItems(context, shop.shopId),
      ]);
      return {
        shop_id: shop.shopId,
        shop_status: shop.status,
        categories: categories.map(toCategoryWire),
        items: items.map(toItemWire),
        limits: MENU_LIMITS,
        // #198: how many dishes this shop shows now and how many it may show (null = no limit, the manual right is held). Hidden dishes do not count.
        visible: await this.#visibleSummary(context, shop.shopId, items),
      };
    });
  }

  /**
   * GET /v1/shops/:shopId, for customers (no session). Issue #190: only a shop that is SET UP (ACTIVE, owner not locked, an ACTIVE service area, a
   * weekly schedule, a pickup point and a sellable dish) is shown, whatever old status it carries; an unknown id is SHOP_NOT_FOUND and everything else
   * is the same SHOP_UNAVAILABLE (the reason is never told, so a direct link reveals neither menu nor contact of a shop that is not set up). The shop
   * being CLOSED now is not a reason to hide it: the schedule only sets the chip and the order path refuses a new order. The quick-contact fields are
   * the shop's own public contact (phone, Zalo, Messenger), validated server-side; no login phone, GPS owner id or customer data is part of the answer.
   */
  async readPublicShop(shopId: string): Promise<Record<string, unknown>> {
    if (!isCanonicalUuid(shopId)) {
      throw new AppError('SHOP_NOT_FOUND');
    }
    return this.transactions.withTransaction(async (context) => {
      const snapshot = await this.reader.snapshotOfShop(context, shopId);
      if (snapshot === undefined) {
        throw new AppError('SHOP_NOT_FOUND');
      }
      const gate = await this.gate.evaluate(context, snapshot);
      if (!gate.publicVisible) {
        throw new AppError('SHOP_UNAVAILABLE');
      }
      const reason = gate.availability.reason;
      const contact = publicContactOf(snapshot);
      const [categories, items] = await Promise.all([
        this.menu.listCategories(context),
        this.menu.listPublicItems(context, shopId),
      ]);
      const sold = await this.sales.quantitiesOfItems(context, items.map((item) => item.itemId));
      return {
        shop_id: snapshot.shopId,
        ...(snapshot.logo == null ? {} : { logo_url: '/v1/shops/' + snapshot.shopId + '/logo?v=' + snapshot.version }),
        name: snapshot.name,
        address_text: snapshot.addressText,
        contact: {
          phone: contact.phone,
          zalo_url: contact.zaloUrl,
          messenger_url: contact.messengerUrl,
          facebook_url: contact.facebookUrl,
        },
        timezone: AVAILABILITY_TIME_ZONE,
        availability: {
          online: gate.availability.online,
          reason: reason,
          evaluated_at: gate.availability.evaluatedAt,
        },
        hours: snapshot.hours.map(toWire),
        // Groups without a public dish are left out; the order is the group order, then the creation order of the dish.
        categories: categories
          .map((category) => ({
            category_id: category.categoryId,
            name: category.name,
            items: items
              .filter((item) => item.categoryId === category.categoryId)
              .map((item) => ({
                item_id: item.itemId,
                name: item.name,
                price_vnd: item.priceVnd,
                sold_count: sold.get(item.itemId) ?? 0,
                image_id: item.imageId,
              })),
          }))
          .filter((category) => category.items.length > 0),
      };
    });
  }

  async readImage(imageId: string): Promise<{ contentType: string; data: Buffer }> {
    if (!isCanonicalUuid(imageId)) {
      throw new AppError('MENU_IMAGE_NOT_FOUND');
    }
    const image = await this.transactions.withTransaction((context) => this.menu.findImage(context, imageId));
    if (image === undefined) {
      throw new AppError('MENU_IMAGE_NOT_FOUND');
    }
    return image;
  }

  // ---- picture upload ---------------------------------------------------------------------------------------------

  /**
   * POST /v1/shop/me/menu/images. Not idempotent on purpose: a repeated upload only adds one more unreferenced picture (bounded by
   * the per-shop cap) and the dish save that points at it has its own key. The picture belongs to the shop of the caller.
   */
  async uploadImage(actor: SessionActor, input: ImageUploadInput): Promise<MenuOutcome> {
    return this.transactions.withTransaction(async (context) => {
      await this.sessionAuth.lockAuthorizedShopActor(context, actor);
      const shop = await this.#lockWritableShop(context, actor.userId);
      if ((await this.menu.countImages(context, shop.shopId)) >= MENU_IMAGES_MAX_PER_SHOP) {
        throw new AppError('MENU_LIMIT_REACHED');
      }
      const imageId = randomUUID();
      await this.menu.insertImage(context, imageId, shop.shopId, input.contentType, input.bytes);
      return { status: 201, payload: { image_id: imageId, content_type: input.contentType, byte_size: input.bytes.length } };
    });
  }

  // ---- dish mutations ---------------------------------------------------------------------------------------------

  async createItem(
    actor: SessionActor,
    input: MenuItemFields,
    idempotencyKey: string | readonly string[] | undefined,
    requestId: string,
  ): Promise<MenuOutcome> {
    const outcome = await this.executor.execute(
      {
        scopeType: MENU_SCOPE_TYPE,
        scopeId: actor.userId,
        operationId: MENU_ITEM_CREATE_OPERATION_ID,
        idempotencyKey,
        logicalRequest: toLogical(input),
        replay: { kind: 'sensitive', authorize: (context, guard) => this.#authorizeReplay(context, guard, actor) },
      },
      async (context) => {
        await this.sessionAuth.lockAuthorizedShopActor(context, actor);
        const shop = await this.#lockWritableShop(context, actor.userId);
        await this.#checkReferences(context, shop.shopId, input, undefined);
        if ((await this.menu.countLiveItems(context, shop.shopId)) >= MENU_ITEMS_MAX_PER_SHOP) {
          throw new AppError('MENU_LIMIT_REACHED');
        }
        // A new dish is VISIBLE: it needs a free place among the visible ones (decided under the shop row lock taken above).
        await this.#requireVisibleRoom(context, shop.shopId);
        const item = await this.menu.insertItem(context, randomUUID(), shop.shopId, input);
        await this.#record(context, requestId, actor.userId, item, MENU_ITEM_CREATE_OPERATION_ID);
        await this.activation.reconcile(context, shop.shopId, requestId, 'menu_change');
        return { status: 201, replayGuard: guardOf(actor.userId, shop.shopId), payload: { item: toItemWire(item) } };
      },
    );
    return { status: outcome.status, payload: outcome.payload };
  }

  async updateItem(
    actor: SessionActor,
    itemId: string,
    input: ItemUpdateInput,
    idempotencyKey: string | readonly string[] | undefined,
    requestId: string,
  ): Promise<MenuOutcome> {
    return this.#mutate(actor, itemId, input.expectedVersion, MENU_ITEM_UPDATE_OPERATION_ID, toLogical(input), idempotencyKey, requestId, async (context, shop, current) => {
      await this.#checkReferences(context, shop.shopId, input, current);
      return this.menu.updateItemFields(context, current, input);
    });
  }

  async hideItem(actor: SessionActor, itemId: string, expectedVersion: number, key: string | readonly string[] | undefined, requestId: string): Promise<MenuOutcome> {
    return this.#mutate(actor, itemId, expectedVersion, MENU_ITEM_HIDE_OPERATION_ID, {}, key, requestId, (context, _shop, current) =>
      this.menu.setItemStatus(context, current, 'HIDDEN'),
    );
  }

  async showItem(actor: SessionActor, itemId: string, expectedVersion: number, key: string | readonly string[] | undefined, requestId: string): Promise<MenuOutcome> {
    return this.#mutate(actor, itemId, expectedVersion, MENU_ITEM_SHOW_OPERATION_ID, {}, key, requestId, async (context, shop, current) => {
      // Showing a dish that is already visible takes no new place; showing a hidden one does.
      if (current.status !== 'VISIBLE') {
        await this.#requireVisibleRoom(context, shop.shopId);
      }
      return this.menu.setItemStatus(context, current, 'VISIBLE');
    });
  }

  async deleteItem(actor: SessionActor, itemId: string, expectedVersion: number, key: string | readonly string[] | undefined, requestId: string): Promise<MenuOutcome> {
    return this.#mutate(actor, itemId, expectedVersion, MENU_ITEM_DELETE_OPERATION_ID, {}, key, requestId, (context, _shop, current) =>
      this.menu.softDeleteItem(context, current),
    );
  }

  /**
   * A change of one existing dish at an exact version. The dish id and the expected version are part of the logical request, so
   * the same key with another dish or version is IDEMPOTENCY_KEY_REUSED, and a replay returns the stored answer.
   */
  async #mutate(
    actor: SessionActor,
    itemId: string,
    expectedVersion: number,
    operationId: string,
    extraLogical: Record<string, unknown>,
    idempotencyKey: string | readonly string[] | undefined,
    requestId: string,
    change: (context: TransactionContext, shop: ShopRow, current: MenuItemRow) => Promise<MenuItemRow>,
  ): Promise<MenuOutcome> {
    const outcome = await this.executor.execute(
      {
        scopeType: MENU_SCOPE_TYPE,
        scopeId: actor.userId,
        operationId,
        idempotencyKey,
        logicalRequest: { item_id: itemId, expected_version: expectedVersion, ...extraLogical } as JsonObject,
        replay: { kind: 'sensitive', authorize: (context, guard) => this.#authorizeReplay(context, guard, actor) },
      },
      async (context) => {
        await this.sessionAuth.lockAuthorizedShopActor(context, actor);
        const shop = await this.#lockWritableShop(context, actor.userId);
        const current = await this.menu.lockItem(context, shop.shopId, itemId);
        // A dish of another shop, an unknown one and a deleted one are the same answer.
        if (current === undefined || current.status === 'DELETED') {
          throw new AppError('MENU_ITEM_NOT_FOUND');
        }
        if (current.version !== expectedVersion) {
          throw new AppError('VERSION_CONFLICT');
        }
        const item = await change(context, shop, current);
        await this.#record(context, requestId, actor.userId, item, operationId);
        await this.activation.reconcile(context, shop.shopId, requestId, 'menu_change');
        return { status: 200, replayGuard: guardOf(actor.userId, shop.shopId), payload: { item: toItemWire(item) } };
      },
    );
    return { status: outcome.status, payload: outcome.payload };
  }

  /**
   * The group must be ACTIVE for a new dish and when the dish changes group; keeping its current (even INACTIVE) group is allowed,
   * so a dish whose group was switched off can still be edited without silently losing the link. A picture must be one of this shop.
   */
  async #checkReferences(
    context: TransactionContext,
    shopId: string,
    fields: MenuItemFields,
    current: MenuItemRow | undefined,
  ): Promise<void> {
    const category = await this.menu.lockCategoryShared(context, fields.categoryId);
    const keepsLink = current !== undefined && current.categoryId === fields.categoryId;
    if (category === undefined || (category.status !== 'ACTIVE' && !keepsLink)) {
      throw new AppError('MENU_CATEGORY_NOT_AVAILABLE');
    }
    if (fields.imageId !== null && !(await this.menu.lockOwnImageShared(context, fields.imageId, shopId))) {
      throw new AppError('INVALID_MENU_IMAGE');
    }
  }

  /**
   * #198: without the manual MENU_EXPANDED right a shop shows at most FREE_VISIBLE_DISH_LIMIT dishes at once. The caller holds the shop row FOR UPDATE, as does every
   * grant / revoke of the right and every other menu write, so the count and the right cannot change between this check and the write. Only a step that ADDS a
   * visible dish is refused: hiding, editing, and showing again after hiding stay possible, and a shop that already shows more (the right was revoked) keeps every
   * dish; nothing is hidden or deleted for it, it simply cannot add another until it is back under the limit.
   */
  async #requireVisibleRoom(context: TransactionContext, shopId: string): Promise<void> {
    if (await this.entitlements.isGranted(context, shopId)) {
      return;
    }
    if ((await this.menu.countVisibleItems(context, shopId)) >= FREE_VISIBLE_DISH_LIMIT) {
      throw new AppError('MENU_VISIBLE_LIMIT_REACHED');
    }
  }

  async #visibleSummary(context: TransactionContext, shopId: string, items: readonly MenuItemRow[]): Promise<JsonObject> {
    const expanded = await this.entitlements.isGranted(context, shopId);
    return { count: items.filter((item) => item.status === 'VISIBLE').length, limit: expanded ? null : FREE_VISIBLE_DISH_LIMIT, expanded };
  }

  async #lockWritableShop(context: TransactionContext, userId: string): Promise<ShopRow> {
    const shop = await this.shops.lockOwnedShop(context, userId);
    if (shop === undefined) {
      throw new AppError('SHOP_NOT_FOUND');
    }
    requireActiveShop(shop);
    return shop;
  }

  async #record(context: TransactionContext, requestId: string, userId: string, item: MenuItemRow, operation: string): Promise<void> {
    await this.audit.append(context, {
      requestId,
      actorType: 'USER',
      actorId: userId,
      action: operation,
      resourceType: MENU_RESOURCE_TYPE,
      resourceId: item.itemId,
      resourceVersion: item.version,
      outcome: 'SUCCESS',
      metadata: { operation },
    });
    await this.outbox.append(context, {
      eventType: MENU_ITEM_CHANGED_EVENT_TYPE,
      eventSchemaVersion: MENU_EVENT_SCHEMA_VERSION,
      resourceType: MENU_RESOURCE_TYPE,
      resourceId: item.itemId,
      resourceVersion: item.version,
      payload: { shop_id: item.shopId, item_id: item.itemId, version: item.version },
    });
  }

  /** Same rule as Shop management: a stored result is replayed only for a valid CURRENT session of the same user who still owns the same ACTIVE shop. */
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

function guardOf(userId: string, shopId: string): JsonObject {
  return { user_id: userId, shop_id: shopId };
}

function toLogical(input: MenuItemFields & { expectedVersion?: number; itemId?: string }): JsonObject {
  return {
    ...(input.expectedVersion === undefined ? {} : { expected_version: input.expectedVersion }),
    name: input.name,
    price_vnd: input.priceVnd,
    category_id: input.categoryId,
    image_id: input.imageId,
  };
}

function toCategoryWire(category: MenuCategoryRow): Record<string, unknown> {
  return { category_id: category.categoryId, name: category.name, status: category.status };
}

export function toItemWire(item: MenuItemRow): JsonObject {
  return {
    item_id: item.itemId,
    name: item.name,
    price_vnd: item.priceVnd,
    category_id: item.categoryId,
    image_id: item.imageId,
    status: item.status,
    version: item.version,
  };
}
