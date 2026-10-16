import { Injectable } from '@nestjs/common';
import { foldVietnamese, likeContains } from '../shared/fold-vietnamese';
import { toSafeInteger } from '../shop/shop-db';
import { DiscoverableShop, ShopDiscoveryReader } from '../shop/shop-discovery-reader';
import { ServiceAreaRepository } from '../shop/service-area-repository';
import { TransactionManager } from '../transaction/transaction-manager';
import { MenuRepository } from './menu-repository';
import { DiscoveryQuery } from './discovery-validation';

type Reason = 'ONLINE' | 'OUTSIDE_BUSINESS_HOURS' | 'NO_BUSINESS_HOURS';

/** Dishes read for one answer (the whole matching set is searched; only the page asked for is returned). */
const DISH_SEARCH_CAP = 1000;

function availabilityOf(shop: DiscoverableShop): { online: boolean; reason: Reason } {
  if (!shop.hasHours) {
    return { online: false, reason: 'NO_BUSINESS_HOURS' };
  }
  return shop.inHours ? { online: true, reason: 'ONLINE' } : { online: false, reason: 'OUTSIDE_BUSINESS_HOURS' };
}

/** Open now first, then the folded name, then the id: a stable order that does not depend on the database collation. */
function byOpenThenName(a: DiscoverableShop & { folded: string }, b: DiscoverableShop & { folded: string }): number {
  const openA = a.hasHours && a.inHours ? 0 : 1;
  const openB = b.hasHours && b.inHours ? 0 : 1;
  if (openA !== openB) {
    return openA - openB;
  }
  if (a.folded !== b.folded) {
    return a.folded < b.folded ? -1 : 1;
  }
  return a.shopId < b.shopId ? -1 : a.shopId > b.shopId ? 1 : 0;
}

/**
 * Public discovery (M02, docs/current/M02-discovery-UI-LOCKED-20261016.md): the service areas and groups a customer may choose, the
 * shops of an area and the dishes, with the search over names. Read only, no session, nothing personal.
 *
 * The Shop module says which shops of the area may be shown and whether each is open at one PostgreSQL instant (it never reads a menu
 * table); the Menu module says which of them have a VISIBLE dish and finds dishes (it never reads a shop table). This coordinator joins
 * the two in ONE read transaction. A shop appears only while it is publicly visible (ACTIVE shop in an ACTIVE area with a VISIBLE
 * dish); a group that was switched off is not a reason to hide its dishes. The whole matching set is searched, not a loaded page; one
 * more row than asked is read to tell `has_more` without a count.
 */
@Injectable()
export class DiscoveryService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly shopReader: ShopDiscoveryReader,
    private readonly areas: ServiceAreaRepository,
    private readonly menu: MenuRepository,
  ) {}

  async serviceAreas(): Promise<Record<string, unknown>[]> {
    return this.transactions.withTransaction(async (context) => {
      const rows = await this.areas.listActive(context);
      return rows.map((row) => ({ service_area_id: row.serviceAreaId, name: row.name }));
    });
  }

  async categories(): Promise<Record<string, unknown>[]> {
    return this.transactions.withTransaction(async (context) => {
      const rows = await this.menu.listCategories(context);
      return rows.filter((row) => row.status === 'ACTIVE').map((row) => ({ category_id: row.categoryId, name: row.name }));
    });
  }

  async shops(query: DiscoveryQuery): Promise<Record<string, unknown>> {
    return this.transactions.withTransaction(async (context) => {
      const eligible = await this.#eligible(context, query);
      const withDish = await this.menu.shopIdsWithPublicItem(context, eligible.map((s) => s.shopId), query.categoryId);
      const matching = eligible
        .filter((shop) => withDish.has(shop.shopId))
        .map((shop) => ({ ...shop, folded: foldVietnamese(shop.name) }))
        .filter((shop) => query.term === '' || shop.folded.includes(query.term))
        .sort(byOpenThenName);
      const page = matching.slice(query.offset, query.offset + query.limit);
      return {
        shops: page.map((shop) => ({ shop_id: shop.shopId, name: shop.name, address_text: shop.addressText, availability: availabilityOf(shop) })),
        has_more: matching.length > query.offset + query.limit,
      };
    });
  }

  async dishes(query: DiscoveryQuery): Promise<Record<string, unknown>> {
    return this.transactions.withTransaction(async (context) => {
      const eligible = await this.#eligible(context, query);
      const byId = new Map(eligible.map((shop) => [shop.shopId, { ...shop, folded: foldVietnamese(shop.name) }]));
      const items = await this.menu.searchPublicItems(
        context,
        eligible.map((s) => s.shopId),
        query.categoryId,
        query.term === '' ? null : likeContains(query.term),
        DISH_SEARCH_CAP,
      );
      const rows = items
        .map((item) => ({ item, shop: byId.get(item.shopId) }))
        .filter((row): row is { item: (typeof items)[number]; shop: DiscoverableShop & { folded: string } } => row.shop !== undefined)
        .sort((a, b) => byOpenThenName(a.shop, b.shop) || (foldVietnamese(a.item.name) < foldVietnamese(b.item.name) ? -1 : foldVietnamese(a.item.name) > foldVietnamese(b.item.name) ? 1 : a.item.itemId < b.item.itemId ? -1 : 1));
      const page = rows.slice(query.offset, query.offset + query.limit);
      return {
        dishes: page.map(({ item, shop }) => ({
          item_id: item.itemId,
          name: item.name,
          price_vnd: toSafeInteger(item.priceVnd),
          image_id: item.imageId,
          shop: { shop_id: shop.shopId, name: shop.name, address_text: shop.addressText, availability: availabilityOf(shop) },
        })),
        has_more: rows.length > query.offset + query.limit,
      };
    });
  }

  /** The shops of the area that may be shown (open-only already applied). */
  async #eligible(context: Parameters<ShopDiscoveryReader['eligibleShopsOfArea']>[0], query: DiscoveryQuery): Promise<DiscoverableShop[]> {
    const all = await this.shopReader.eligibleShopsOfArea(context, query.areaId);
    return query.openOnly ? all.filter((shop) => shop.hasHours && shop.inHours) : all;
  }
}
