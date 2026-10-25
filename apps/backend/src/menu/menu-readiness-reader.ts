import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';

/**
 * The read port the setup readiness of a shop (issue #190) consumes: does the shop have a first sellable dish, and which of these shops do. It reads
 * only Menu tables, locks nothing and writes nothing; the Shop module never learns anything about dishes except through this answer.
 * The rule (VISIBLE, price > 0, a picture) is the same as menu-readiness-sql.ts.
 */
@Injectable()
export class MenuReadinessReader {
  async hasSellableItem(context: TransactionContext, shopId: string): Promise<boolean> {
    const result = await context.query<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM app.menu_items si
          WHERE si.shop_id = $1::uuid AND si.status = 'VISIBLE' AND si.price_vnd > 0 AND si.image_id IS NOT NULL
       ) AS ok`,
      [shopId],
    );
    return result.rows[0]?.ok === true;
  }

  /** Which of these shops have at least one sellable dish (one statement for the whole list). */
  async shopIdsWithSellableItem(context: TransactionContext, shopIds: readonly string[]): Promise<Set<string>> {
    if (shopIds.length === 0) {
      return new Set();
    }
    const result = await context.query<{ shop_id: string }>(
      `SELECT DISTINCT si.shop_id
         FROM app.menu_items si
        WHERE si.shop_id = ANY($1::uuid[]) AND si.status = 'VISIBLE' AND si.price_vnd > 0 AND si.image_id IS NOT NULL`,
      [shopIds],
    );
    return new Set(result.rows.map((row) => row.shop_id));
  }
}
