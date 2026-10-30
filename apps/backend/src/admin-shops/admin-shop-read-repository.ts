import { Injectable } from '@nestjs/common';
import { epochMs, toSafeInteger } from '../auth/auth-db';
import { TechnicalError } from '../common/app-errors';
import { TERMINAL_STATES } from '../delivery/delivery-constants';
import { ENDED_STATUSES } from '../orders/order-constants';
import { evaluateAvailability } from '../shop/shop-availability-reader';
import { pinInAreaSql } from '../shop/service-area-repository';
import { hasHoursSql, hasPickupPointSql, inHoursSql, localTimeCtes, PRODUCTION_CLOCK } from '../shop/shop-availability-sql';
import { sellableItemExistsSql } from '../menu/menu-readiness-sql';
import { effectiveAvailability, evaluateSetup, SetupEvaluation, SetupState } from '../shop-setup/shop-setup-rules';
import { ShopAvailability, ShopStatus } from '../shop/shop-types';
import { TransactionContext } from '../transaction/transaction-context';
import { ScheduleFilter } from './admin-shop-validation';

// READ-ONLY projections of the shop-management pages of the administration web (M02 "Quản lý quán"). No INSERT, UPDATE, DELETE or lock clause here:
// the actor's locks are taken by the service first, and the status change itself lives in the Shop module (ShopRepository). This file reads columns other
// modules own (shops, shop_members, users, customer_profiles, menu_*, orders, deliveries, audit_logs); like the account read it is named in the Shop
// boundary spec as the one allowed outside reader. No password, hash, token, OTP, bank or session column is ever selected. Every value reaches the
// statements as a parameter; no statement text contains anything the client sent.

/** The code a shop is known by (K01, K02, ...): the same expression as app.shop_display_order, so the code on an order and on the shop agree. */
const SHOP_CODE = `'K' || lpad(pid.shop_number::text, greatest(2, length(pid.shop_number::text)), '0')`;

export interface ShopFilter {
  readonly name: string | null;
  readonly digits: string | null;
  readonly areaId: string | null;
  readonly profile: ShopStatus | null;
  readonly schedule: ScheduleFilter | null;
  readonly setup: SetupState | null;
}

export interface OwnerFacts {
  readonly userId: string;
  readonly name: string | null;
  readonly phone: string;
  /** The owner account is locked (availability then reads SHOP_DISABLED whatever the shop status is). */
  readonly locked: boolean;
}

export interface ShopListRow {
  readonly shopId: string;
  readonly code: string;
  readonly name: string;
  readonly addressText: string;
  readonly owner: OwnerFacts | undefined;
  readonly areaId: string | null;
  readonly areaName: string | null;
  readonly status: ShopStatus;
  readonly version: number;
  readonly availability: ShopAvailability;
  readonly itemsVisible: number;
  readonly itemsTotal: number;
  /** Issue #190: the setup steps and state (derived from the real rows), the pending request and the reason of a lock. */
  readonly setup: SetupEvaluation;
  readonly setupRequest: { readonly note: string; readonly atMs: number } | null;
  readonly lock: { readonly kind: 'ADMIN' | 'OWNER_ACCOUNT'; readonly reason: string | null } | null;
}

export interface ShopAdminFacts {
  readonly shopId: string;
  readonly code: string;
  readonly owner: OwnerFacts | undefined;
  readonly areaName: string | null;
  readonly areaStatus: string | null;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly itemsVisible: number;
  readonly itemsHidden: number;
  readonly hasSellableItem: boolean;
  readonly activatedAtMs: number | null;
  readonly setupRequest: { readonly note: string; readonly atMs: number } | null;
  /** The reason the last administrator lock gave (audit), or null. */
  readonly lockReason: string | null;
}

export interface OpenWork {
  /** Orders whose status is not one of the M10 end statuses (pending, preparing, and any status the order module does not end). */
  readonly ordersOpen: number;
  readonly ordersPendingConfirmation: number;
  readonly ordersPreparing: number;
  /** Deliveries whose state is not one of the M07 terminal states. */
  readonly activeDeliveries: number;
}

export interface ManagedItem {
  readonly itemId: string;
  readonly name: string;
  readonly priceVnd: number;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly categoryStatus: 'ACTIVE' | 'INACTIVE';
  readonly status: 'VISIBLE' | 'HIDDEN';
  readonly imageId: string | null;
  readonly version: number;
  readonly updatedAtMs: number;
}

export interface MenuGroupCount {
  readonly categoryId: string;
  readonly name: string;
  readonly status: 'ACTIVE' | 'INACTIVE';
  readonly itemCount: number;
}

export interface HistoryRow {
  readonly auditId: string;
  readonly occurredAtMs: number;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly actorName: string | null;
  readonly action: string;
  readonly version: number | null;
  readonly outcome: string;
  readonly metadata: Record<string, unknown>;
}

interface RawList {
  shop_id: string;
  code: string;
  name: string;
  address_text: string;
  owner_id: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  owner_locked: boolean | null;
  area_id: string | null;
  area_name: string | null;
  area_status: string | null;
  status: string;
  version: string;
  evaluated_at: string;
  has_hours: boolean;
  in_hours: boolean;
  items_visible: string;
  items_total: string;
  total: string;
  contact_phone_normalized: string;
  has_pickup_point: boolean;
  pickup_in_area: boolean;
  has_sellable: boolean;
  activated_ms: string | null;
  request_note: string | null;
  request_ms: string | null;
  lock_reason: string | null;
  setup_state: SetupState;
}

function ownerOf(id: string | null, name: string | null, phone: string | null, locked: boolean | null): OwnerFacts | undefined {
  return id === null || phone === null ? undefined : { userId: id, name, phone, locked: locked === true };
}

function asStatus(value: string): ShopStatus {
  if (value !== 'INCOMPLETE' && value !== 'ACTIVE' && value !== 'DISABLED') {
    throw new TechnicalError('internal', 'Unexpected shop status');
  }
  return value;
}

const OWNER_JOIN = `
  LEFT JOIN app.shop_members om ON om.shop_id = s.shop_id AND om.member_role = 'OWNER'
  LEFT JOIN app.users ou ON ou.user_id = om.user_id
  LEFT JOIN app.customer_profiles cp ON cp.user_id = ou.user_id`;

@Injectable()
export class AdminShopReadRepository {
  /**
   * One page of shops with the facts the list shows, the schedule state evaluated at ONE instant of the database clock by the same rule as the
   * detail (inHoursSql + evaluateAvailability). `total` counts every row the filter matches, not only the page.
   */
  async list(context: TransactionContext, filter: ShopFilter, limit: number, offset: number): Promise<{ rows: ShopListRow[]; total: number }> {
    const online = `(s.status = 'ACTIVE' AND a.status = 'ACTIVE' AND COALESCE(ou.status = 'ACTIVE', true) AND h.has_hours AND h.in_hours AND ${hasPickupPointSql('s')} AND ${pinInAreaSql('s', 'a')} AND ${sellableItemExistsSql('s.shop_id')})`;
    const result = await context.query<RawList>(
      `${localTimeCtes(PRODUCTION_CLOCK)},
       base AS (
         SELECT s.shop_id, ${SHOP_CODE} AS code, s.name, s.address_text, s.status, s.version, s.contact_phone_normalized,
                s.created_at, s.service_area_id AS area_id, a.name AS area_name, a.status AS area_status,
                ou.user_id AS owner_id, cp.full_name AS owner_name, ou.phone_normalized AS owner_phone, (ou.status <> 'ACTIVE') AS owner_locked,
                to_char(date_trunc('milliseconds', l.instant) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS evaluated_at,
                h.has_hours, h.in_hours,
                COALESCE(i.visible, 0) AS items_visible, COALESCE(i.total, 0) AS items_total,
                ${online} AS is_online,
                ${hasPickupPointSql('s')} AS has_pickup_point,
                ${pinInAreaSql('s', 'a')} AS pickup_in_area,
                ${sellableItemExistsSql('s.shop_id')} AS has_sellable,
                ${epochMs('s.activated_at')} AS activated_ms,
                s.setup_request_note AS request_note, ${epochMs('s.setup_request_at')} AS request_ms,
                (SELECT al.metadata->>'reason' FROM app.audit_logs al
                  WHERE al.resource_type = 'shop' AND al.resource_id = s.shop_id::text AND al.action = 'admin.shop.disable.v1' AND al.outcome = 'SUCCESS'
                  ORDER BY al.occurred_at DESC, al.audit_id DESC LIMIT 1) AS lock_reason
           FROM app.shops s
           LEFT JOIN app.shop_public_ids pid ON pid.shop_id = s.shop_id
           LEFT JOIN app.service_areas a ON a.service_area_id = s.service_area_id${OWNER_JOIN}
          CROSS JOIN local_time l
          CROSS JOIN LATERAL (SELECT ${hasHoursSql('s.shop_id')} AS has_hours, ${inHoursSql('s.shop_id')} AS in_hours) h
           LEFT JOIN LATERAL (
             SELECT count(*) FILTER (WHERE mi.status = 'VISIBLE') AS visible, count(*) AS total
               FROM app.menu_items mi WHERE mi.shop_id = s.shop_id AND mi.status <> 'DELETED'
           ) i ON true
       ),
       staged AS (
         SELECT b.*,
                (b.name <> '' AND b.address_text <> '' AND b.contact_phone_normalized <> '' AND b.area_id IS NOT NULL AND b.area_status = 'ACTIVE'
                 AND b.has_hours AND b.has_pickup_point AND b.pickup_in_area AND b.has_sellable) AS setup_complete
           FROM base b
       ),
       classified AS (
         SELECT t.*,
                CASE
                  WHEN t.status = 'DISABLED' OR COALESCE(t.owner_locked, false) THEN 'LOCKED'
                  WHEN t.request_note IS NOT NULL THEN 'NEEDS_REVIEW'
                  WHEN NOT t.setup_complete THEN CASE WHEN t.activated_ms IS NULL THEN 'INCOMPLETE' ELSE 'NEEDS_REVIEW' END
                  WHEN t.status = 'ACTIVE' THEN 'ACTIVATED'
                  ELSE 'INCOMPLETE'
                END AS setup_state
           FROM staged t
       ),
       matched AS (
         SELECT * FROM classified b
          WHERE ($1::text IS NULL
                 OR app.fold_vi(b.name) LIKE $1::text
                 OR app.fold_vi(COALESCE(b.owner_name, '')) LIKE $1::text
                 OR lower(b.code) LIKE $1::text
                 OR ($2::text IS NOT NULL AND (substr(COALESCE(b.owner_phone, ''), 2) LIKE $2::text OR substr(b.contact_phone_normalized, 2) LIKE $2::text)))
            AND ($3::uuid IS NULL OR b.area_id = $3::uuid)
            AND ($4::text IS NULL OR b.status = $4::text)
            AND ($5::text IS NULL OR ($5::text = 'OPEN' AND b.is_online) OR ($5::text = 'CLOSED' AND NOT b.is_online))
            AND ($8::text IS NULL OR b.setup_state = $8::text)
       )
       SELECT m.*, (SELECT count(*) FROM matched) AS total
         FROM matched m
        ORDER BY m.created_at DESC, m.shop_id DESC
        LIMIT $6::int OFFSET $7::int`,
      [filter.name, filter.digits, filter.areaId, filter.profile, filter.schedule, limit, offset, filter.setup],
    );
    let total = result.rows[0] === undefined ? 0 : toSafeInteger(result.rows[0].total);
    if (result.rows.length === 0 && offset > 0) {
      // A page past the end: the filter may still match rows, so say how many (the screen goes back to the last page).
      total = await this.#count(context, filter);
    }
    return {
      rows: result.rows.map((row) => ({
        shopId: row.shop_id,
        code: row.code,
        name: row.name,
        addressText: row.address_text,
        owner: ownerOf(row.owner_id, row.owner_name, row.owner_phone, row.owner_locked),
        areaId: row.area_id,
        areaName: row.area_name,
        status: asStatus(row.status),
        version: toSafeInteger(row.version),
        availability: effectiveAvailability(evaluateAvailability(row.status, row.area_status, row.has_hours, row.in_hours, row.evaluated_at, row.owner_locked === true, row.has_pickup_point, row.pickup_in_area), row.has_sellable),
        itemsVisible: toSafeInteger(row.items_visible),
        itemsTotal: toSafeInteger(row.items_total),
        setup: evaluateSetup({
          status: row.status,
          ownerLocked: row.owner_locked === true,
          name: row.name,
          addressText: row.address_text,
          contactPhone: row.contact_phone_normalized,
          serviceAreaId: row.area_id,
          areaStatus: row.area_status,
          hasHours: row.has_hours,
          hasPickupPoint: row.has_pickup_point,
          pickupInArea: row.pickup_in_area,
          hasSellableItem: row.has_sellable,
          activatedAt: row.activated_ms,
          requestPending: row.request_note !== null,
        }),
        setupRequest: row.request_note === null || row.request_ms === null ? null : { note: row.request_note, atMs: toSafeInteger(row.request_ms) },
        lock: row.status === 'DISABLED' ? { kind: 'ADMIN', reason: row.lock_reason } : row.owner_locked === true ? { kind: 'OWNER_ACCOUNT', reason: null } : null,
      })),
      total,
    };
  }

  async #count(context: TransactionContext, filter: ShopFilter): Promise<number> {
    const page = await this.list(context, filter, 1, 0);
    return page.total;
  }

  /** Shop code, owner and counts of one shop, for the detail header and the profile tab. Undefined when the shop does not exist. */
  async facts(context: TransactionContext, shopId: string): Promise<ShopAdminFacts | undefined> {
    const result = await context.query<{
      shop_id: string;
      code: string;
      owner_id: string | null;
      owner_name: string | null;
      owner_phone: string | null;
      owner_locked: boolean | null;
      area_name: string | null;
      area_status: string | null;
      created_ms: string;
      updated_ms: string;
      items_visible: string;
      items_hidden: string;
      has_sellable: boolean;
      activated_ms: string | null;
      request_note: string | null;
      request_ms: string | null;
      lock_reason: string | null;
    }>(
      `SELECT s.shop_id, ${SHOP_CODE} AS code, ou.user_id AS owner_id, cp.full_name AS owner_name, ou.phone_normalized AS owner_phone,
              (ou.status <> 'ACTIVE') AS owner_locked, a.name AS area_name, a.status AS area_status,
              ${epochMs('s.created_at')} AS created_ms, ${epochMs('s.updated_at')} AS updated_ms,
              (SELECT count(*) FROM app.menu_items mi WHERE mi.shop_id = s.shop_id AND mi.status = 'VISIBLE') AS items_visible,
              (SELECT count(*) FROM app.menu_items mi WHERE mi.shop_id = s.shop_id AND mi.status = 'HIDDEN') AS items_hidden,
              ${sellableItemExistsSql('s.shop_id')} AS has_sellable,
              ${epochMs('s.activated_at')} AS activated_ms, s.setup_request_note AS request_note, ${epochMs('s.setup_request_at')} AS request_ms,
              (SELECT al.metadata->>'reason' FROM app.audit_logs al
                WHERE al.resource_type = 'shop' AND al.resource_id = s.shop_id::text AND al.action = 'admin.shop.disable.v1' AND al.outcome = 'SUCCESS'
                ORDER BY al.occurred_at DESC, al.audit_id DESC LIMIT 1) AS lock_reason
         FROM app.shops s
         LEFT JOIN app.shop_public_ids pid ON pid.shop_id = s.shop_id
         LEFT JOIN app.service_areas a ON a.service_area_id = s.service_area_id${OWNER_JOIN}
        WHERE s.shop_id = $1::uuid`,
      [shopId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return undefined;
    }
    return {
      shopId: row.shop_id,
      code: row.code,
      owner: ownerOf(row.owner_id, row.owner_name, row.owner_phone, row.owner_locked),
      areaName: row.area_name,
      areaStatus: row.area_status,
      createdAtMs: toSafeInteger(row.created_ms),
      updatedAtMs: toSafeInteger(row.updated_ms),
      itemsVisible: toSafeInteger(row.items_visible),
      itemsHidden: toSafeInteger(row.items_hidden),
      hasSellableItem: row.has_sellable,
      activatedAtMs: row.activated_ms === null ? null : toSafeInteger(row.activated_ms),
      setupRequest: row.request_note === null || row.request_ms === null ? null : { note: row.request_note, atMs: toSafeInteger(row.request_ms) },
      lockReason: row.lock_reason,
    };
  }

  /**
   * The work of one shop that is not finished, by the end statuses of M10 and the terminal states of M07 (nothing defined here): a disable is refused
   * while any of it exists. One statement, so the three numbers are one snapshot; the caller holds the shop row FOR UPDATE, and every writer that can
   * add work takes that row (the owner's commands FOR UPDATE, a customer's order FOR SHARE), so a count made after the lock cannot be overtaken.
   */
  async openWork(context: TransactionContext, shopId: string): Promise<OpenWork> {
    const result = await context.query<{ open: string; pending: string; preparing: string; deliveries: string }>(
      `SELECT (SELECT count(*) FROM app.orders o WHERE o.shop_id = $1::uuid AND o.status <> ALL($3::text[])) AS open,
              (SELECT count(*) FROM app.orders o WHERE o.shop_id = $1::uuid AND o.status = 'PENDING_CONFIRMATION') AS pending,
              (SELECT count(*) FROM app.orders o WHERE o.shop_id = $1::uuid AND o.status = 'PREPARING') AS preparing,
              (SELECT count(*) FROM app.deliveries d WHERE d.shop_id = $1::uuid AND d.state <> ALL($2::text[])) AS deliveries`,
      [shopId, TERMINAL_STATES, ENDED_STATUSES],
    );
    const row = result.rows[0];
    return {
      ordersOpen: toSafeInteger(row?.open),
      ordersPendingConfirmation: toSafeInteger(row?.pending),
      ordersPreparing: toSafeInteger(row?.preparing),
      activeDeliveries: toSafeInteger(row?.deliveries),
    };
  }

  /** Every dish group with the number of this shop's dishes in it (deleted dishes are not counted): the filter of the menu tab. */
  async menuGroups(context: TransactionContext, shopId: string): Promise<MenuGroupCount[]> {
    const result = await context.query<{ category_id: string; name: string; status: 'ACTIVE' | 'INACTIVE'; n: string }>(
      `SELECT c.category_id, c.name, c.status,
              (SELECT count(*) FROM app.menu_items mi WHERE mi.shop_id = $1::uuid AND mi.category_id = c.category_id AND mi.status <> 'DELETED') AS n
         FROM app.menu_categories c
        ORDER BY c.sort_order, app.fold_vi(c.name) COLLATE "C", c.name COLLATE "C", c.category_id`,
      [shopId],
    );
    return result.rows.map((row) => ({ categoryId: row.category_id, name: row.name, status: row.status, itemCount: toSafeInteger(row.n) }));
  }

  /** The dishes an administrator sees: visible and hidden, never deleted. An INACTIVE group keeps its dishes. */
  async menuItems(context: TransactionContext, shopId: string, filter: { name: string | null; categoryId: string | null; status: 'VISIBLE' | 'HIDDEN' | null }, limit: number, offset: number): Promise<{ rows: ManagedItem[]; total: number }> {
    const where = `i.shop_id = $1::uuid AND i.status <> 'DELETED'
          AND ($2::text IS NULL OR app.fold_vi(i.name) LIKE $2::text)
          AND ($3::uuid IS NULL OR i.category_id = $3::uuid)
          AND ($4::text IS NULL OR i.status = $4::text)`;
    const params = [shopId, filter.name, filter.categoryId, filter.status];
    const total = await context.query<{ n: string }>(`SELECT count(*) AS n FROM app.menu_items i WHERE ${where}`, params);
    const result = await context.query<{
      item_id: string;
      name: string;
      price_vnd: number;
      category_id: string;
      category_name: string;
      category_status: 'ACTIVE' | 'INACTIVE';
      status: 'VISIBLE' | 'HIDDEN';
      image_id: string | null;
      version: string;
      updated_ms: string;
    }>(
      `SELECT i.item_id, i.name, i.price_vnd, i.category_id, c.name AS category_name, c.status AS category_status, i.status, i.image_id, i.version,
              ${epochMs('i.updated_at')} AS updated_ms
         FROM app.menu_items i
         JOIN app.menu_categories c ON c.category_id = i.category_id
        WHERE ${where}
        ORDER BY c.sort_order, app.fold_vi(c.name) COLLATE "C", c.category_id, i.created_at, i.item_id
        LIMIT $5::int OFFSET $6::int`,
      [...params, limit, offset],
    );
    return {
      total: toSafeInteger(total.rows[0]?.n),
      rows: result.rows.map((row) => ({
        itemId: row.item_id,
        name: row.name,
        priceVnd: row.price_vnd,
        categoryId: row.category_id,
        categoryName: row.category_name,
        categoryStatus: row.category_status,
        status: row.status,
        imageId: row.image_id,
        version: toSafeInteger(row.version),
        updatedAtMs: toSafeInteger(row.updated_ms),
      })),
    };
  }

  /**
   * The audit rows of one shop, newest first: the owner's profile / schedule saves and the administration's disable / enable. The actor's name is the
   * administrator's profile name (an owner is told only as "Chủ quán"; no phone is read here).
   */
  async history(context: TransactionContext, shopId: string, limit: number, offset: number): Promise<{ rows: HistoryRow[]; total: number }> {
    const where = `a.resource_type = 'shop' AND a.resource_id = $1 AND a.outcome = 'SUCCESS'`;
    const total = await context.query<{ n: string }>(`SELECT count(*) AS n FROM app.audit_logs a WHERE ${where}`, [shopId]);
    const result = await context.query<{
      audit_id: string;
      occurred_ms: string;
      actor_type: string;
      actor_id: string | null;
      actor_name: string | null;
      action: string;
      resource_version: string | null;
      outcome: string;
      metadata: Record<string, unknown>;
    }>(
      `SELECT a.audit_id, ${epochMs('a.occurred_at')} AS occurred_ms, a.actor_type, a.actor_id, ap.full_name AS actor_name, a.action,
              a.resource_version, a.outcome, a.metadata
         FROM app.audit_logs a
         LEFT JOIN app.admin_profiles ap ON a.actor_type IN ('ADMIN', 'SYSTEM') AND a.actor_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND ap.user_id = a.actor_id::uuid
        WHERE ${where}
        ORDER BY a.occurred_at DESC, a.audit_id DESC
        LIMIT $2::int OFFSET $3::int`,
      [shopId, limit, offset],
    );
    return {
      total: toSafeInteger(total.rows[0]?.n),
      rows: result.rows.map((row) => ({
        auditId: row.audit_id,
        occurredAtMs: toSafeInteger(row.occurred_ms),
        actorType: row.actor_type,
        actorId: row.actor_id,
        actorName: row.actor_name,
        action: row.action,
        version: row.resource_version === null ? null : toSafeInteger(row.resource_version),
        outcome: row.outcome,
        metadata: row.metadata,
      })),
    };
  }

  /** The public view of a shop's dishes for "Xem như khách": exactly the dishes a customer sees (VISIBLE only), in the customer order. */
  async previewItems(context: TransactionContext, shopId: string): Promise<{ itemId: string; name: string; priceVnd: number; imageId: string | null; categoryId: string; categoryName: string }[]> {
    const result = await context.query<{ item_id: string; name: string; price_vnd: number; image_id: string | null; category_id: string; category_name: string }>(
      `SELECT i.item_id, i.name, i.price_vnd, i.image_id, i.category_id, c.name AS category_name
         FROM app.menu_items i
         JOIN app.menu_categories c ON c.category_id = i.category_id
        WHERE i.shop_id = $1::uuid AND i.status = 'VISIBLE'
        ORDER BY c.sort_order, app.fold_vi(c.name) COLLATE "C", c.name COLLATE "C", c.category_id, i.created_at, i.item_id`,
      [shopId],
    );
    return result.rows.map((row) => ({ itemId: row.item_id, name: row.name, priceVnd: row.price_vnd, imageId: row.image_id, categoryId: row.category_id, categoryName: row.category_name }));
  }
}
