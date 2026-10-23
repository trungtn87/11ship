import { Injectable } from '@nestjs/common';
import { toSafeInteger } from '../shop/shop-db';
import { TransactionContext } from '../transaction/transaction-context';

/** Public, lifetime quantities only. No customer/order details leave the Orders module. */
@Injectable()
export class OrderSalesReader {
  async quantitiesOfItems(context: TransactionContext, itemIds: readonly string[]): Promise<ReadonlyMap<string, number>> {
    if (itemIds.length === 0) return new Map();
    const result = await context.query<{ item_id: string; sold_count: string }>(
      `SELECT i.menu_item_id AS item_id, sum(i.quantity)::text AS sold_count
         FROM app.order_items i
         JOIN app.orders o ON o.order_id = i.order_id
        WHERE i.menu_item_id = ANY($1::uuid[]) AND i.removed_at IS NULL AND o.status = 'COMPLETED'
        GROUP BY i.menu_item_id`,
      [[...itemIds]],
    );
    return new Map(result.rows.map((row) => [row.item_id, toSafeInteger(row.sold_count)]));
  }
}
