import { Injectable } from '@nestjs/common';
import { actorOf, AuthPrincipal } from '../auth/auth-principal';
import { SessionAuthorizationParticipant } from '../auth/session-authorization-participant';
import { AppError } from '../common/app-errors';
import { safeJsonNumber } from '../driver-wallet/driver-wallet-validation';
import { JsonObject } from '../idempotency/idempotency-executor';
import { ShopAvailabilityReader } from '../shop/shop-availability-reader';
import { ShopRevenueCursor, ShopRevenuePeriod, ShopRevenueReader, SHOP_REVENUE_TIME_ZONE } from '../orders/shop-revenue-reader';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { encodeRevenueCursor } from './shop-revenue-validation';

/** fee-like average: sum / count rounded half up to a whole VND; null when count is 0 (never 0). */
export function averageOf(total: bigint, count: bigint): bigint | null {
  if (count === 0n) {
    return null;
  }
  return (2n * total + count) / (2n * count);
}
/**
 * The owner's shop revenue (issue #391), read only. The shop is NOT taken from the request: the session must be a SHOP context of an active role, and the shop is
 * the one the session's user owns (the same snapshot the shop management read uses). A user without a shop reads as not found.
 */
@Injectable()
export class ShopRevenueService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly sessionAuth: SessionAuthorizationParticipant,
    private readonly shops: ShopAvailabilityReader,
    private readonly reader: ShopRevenueReader,
  ) {}

  summary(principal: AuthPrincipal, period: ShopRevenuePeriod): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const shop = await this.#ownShop(context, principal);
      const { totals, days } = await this.reader.summary(context, shop.shopId, period);
      const average = averageOf(totals.itemsVnd, totals.completedCount);
      return {
        period: { from: period.from, to: period.to, timezone: SHOP_REVENUE_TIME_ZONE },
        summary: {
          completed_count: safeJsonNumber(totals.completedCount),
          items_total_vnd: safeJsonNumber(totals.itemsVnd),
          average_items_vnd: average === null ? null : safeJsonNumber(average),
        },
        daily: days.map((day) => ({
          date: day.day,
          completed_count: safeJsonNumber(day.completedCount),
          items_total_vnd: safeJsonNumber(day.itemsVnd),
        })),
      };
    });
  }

  orders(principal: AuthPrincipal, period: ShopRevenuePeriod, limit: number, cursor: ShopRevenueCursor | undefined): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const shop = await this.#ownShop(context, principal);
      const rows = await this.reader.orders(context, shop.shopId, period, limit, cursor);
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map((row) => ({
          order_id: row.orderId,
          code: row.code,
          ended_at: row.endedAt,
          items_total_vnd: safeJsonNumber(row.itemsVnd),
        })),
        next_cursor: rows.length > limit && last !== undefined ? encodeRevenueCursor({ endedAt: last.endedAt, orderId: last.orderId }) : null,
      };
    });
  }

  async #ownShop(context: TransactionContext, principal: AuthPrincipal) {
    const actor = actorOf(principal);
    await this.sessionAuth.lockAuthorizedShopActorShared(context, actor);
    const shop = await this.shops.snapshotOfOwner(context, actor.userId);
    if (shop === undefined) {
      throw new AppError('SHOP_NOT_FOUND');
    }
    return shop;
  }
}
