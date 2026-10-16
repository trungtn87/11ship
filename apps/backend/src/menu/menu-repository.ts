import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { toSafeInteger } from '../shop/shop-db';
import { MenuImageContentType, MenuItemStatus } from './menu-constants';
import { MenuItemFields } from './menu-validation';

export interface MenuCategoryRow {
  readonly categoryId: string;
  readonly name: string;
  readonly status: 'ACTIVE' | 'INACTIVE';
}

export interface MenuItemRow {
  readonly itemId: string;
  readonly shopId: string;
  readonly categoryId: string;
  readonly name: string;
  readonly priceVnd: number;
  readonly imageId: string | null;
  readonly status: MenuItemStatus;
  readonly version: number;
}

interface RawItem {
  item_id: string;
  shop_id: string;
  category_id: string;
  name: string;
  price_vnd: number;
  image_id: string | null;
  status: MenuItemStatus;
  version: string;
}

const ITEM_COLUMNS = 'item_id, shop_id, category_id, name, price_vnd, image_id, status, version';

function toItem(row: RawItem): MenuItemRow {
  return {
    itemId: row.item_id,
    shopId: row.shop_id,
    categoryId: row.category_id,
    name: row.name,
    priceVnd: row.price_vnd,
    imageId: row.image_id,
    status: row.status,
    version: toSafeInteger(row.version),
  };
}

export interface PublicMenuItem {
  readonly itemId: string;
  readonly name: string;
  readonly priceVnd: number;
  readonly imageId: string | null;
  readonly categoryId: string;
}

/**
 * SQL for app.menu_categories, app.menu_images and app.menu_items (M02-MON). Every method takes the caller's TransactionContext:
 * none of them begins, commits or rolls back anything. Lock order inside a mutation (after user, session and shop): category,
 * image, then the dish row.
 */
@Injectable()
export class MenuRepository {
  async listCategories(context: TransactionContext): Promise<MenuCategoryRow[]> {
    const result = await context.query<{ category_id: string; name: string; status: 'ACTIVE' | 'INACTIVE' }>(
      `SELECT category_id, name, status FROM app.menu_categories ORDER BY sort_order, name, category_id`,
    );
    return result.rows.map((row) => ({ categoryId: row.category_id, name: row.name, status: row.status }));
  }

  /** The dishes of a shop that are not deleted, newest first inside a stable order. */
  async listItems(context: TransactionContext, shopId: string): Promise<MenuItemRow[]> {
    const result = await context.query<RawItem>(
      `SELECT ${ITEM_COLUMNS}
         FROM app.menu_items
        WHERE shop_id = $1::uuid AND status <> 'DELETED'
        ORDER BY created_at, item_id`,
      [shopId],
    );
    return result.rows.map(toItem);
  }

  /** Dishes customers may see: VISIBLE ones only. The group may be INACTIVE (the link is kept; it is not a reason to hide). */
  async listPublicItems(context: TransactionContext, shopId: string): Promise<PublicMenuItem[]> {
    const result = await context.query<{
      item_id: string;
      name: string;
      price_vnd: number;
      image_id: string | null;
      category_id: string;
    }>(
      `SELECT i.item_id, i.name, i.price_vnd, i.image_id, i.category_id
         FROM app.menu_items i
         JOIN app.menu_categories c ON c.category_id = i.category_id
        WHERE i.shop_id = $1::uuid AND i.status = 'VISIBLE'
        ORDER BY c.sort_order, c.name, c.category_id, i.created_at, i.item_id`,
      [shopId],
    );
    return result.rows.map((row) => ({
      itemId: row.item_id,
      name: row.name,
      priceVnd: row.price_vnd,
      imageId: row.image_id,
      categoryId: row.category_id,
    }));
  }

  async lockCategoryShared(context: TransactionContext, categoryId: string): Promise<MenuCategoryRow | undefined> {
    const result = await context.query<{ category_id: string; name: string; status: 'ACTIVE' | 'INACTIVE' }>(
      `SELECT category_id, name, status FROM app.menu_categories WHERE category_id = $1::uuid FOR SHARE`,
      [categoryId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { categoryId: row.category_id, name: row.name, status: row.status };
  }

  /** True when the picture exists and belongs to the shop; the row is locked FOR SHARE until the transaction ends. */
  async lockOwnImageShared(context: TransactionContext, imageId: string, shopId: string): Promise<boolean> {
    const result = await context.query(
      `SELECT image_id FROM app.menu_images WHERE image_id = $1::uuid AND shop_id = $2::uuid FOR SHARE`,
      [imageId, shopId],
    );
    return result.rowCount === 1;
  }

  async countLiveItems(context: TransactionContext, shopId: string): Promise<number> {
    const result = await context.query<{ n: string }>(
      `SELECT count(*) AS n FROM app.menu_items WHERE shop_id = $1::uuid AND status <> 'DELETED'`,
      [shopId],
    );
    return toSafeInteger(result.rows[0]?.n);
  }

  async countImages(context: TransactionContext, shopId: string): Promise<number> {
    const result = await context.query<{ n: string }>(
      `SELECT count(*) AS n FROM app.menu_images WHERE shop_id = $1::uuid`,
      [shopId],
    );
    return toSafeInteger(result.rows[0]?.n);
  }

  /** The dish of this shop (never another's), locked FOR UPDATE, whatever its status. */
  async lockItem(context: TransactionContext, shopId: string, itemId: string): Promise<MenuItemRow | undefined> {
    const result = await context.query<RawItem>(
      `SELECT ${ITEM_COLUMNS} FROM app.menu_items WHERE item_id = $1::uuid AND shop_id = $2::uuid FOR UPDATE`,
      [itemId, shopId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toItem(row);
  }

  async insertItem(context: TransactionContext, itemId: string, shopId: string, fields: MenuItemFields): Promise<MenuItemRow> {
    const result = await context.query<RawItem>(
      `INSERT INTO app.menu_items (item_id, shop_id, category_id, name, price_vnd, image_id, status, version, created_at, updated_at)
       SELECT $1::uuid, $2::uuid, $3::uuid, $4, $5::integer, $6::uuid, 'VISIBLE', 1, clock.t, clock.t
         FROM (SELECT date_trunc('milliseconds', clock_timestamp()) AS t) AS clock
       RETURNING ${ITEM_COLUMNS}`,
      [itemId, shopId, fields.categoryId, fields.name, fields.priceVnd, fields.imageId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new TechnicalError('internal', 'Dish was not written');
    }
    return toItem(row);
  }

  async updateItemFields(context: TransactionContext, current: MenuItemRow, fields: MenuItemFields): Promise<MenuItemRow> {
    return this.#update(
      context,
      current,
      `name = $3, price_vnd = $4::integer, category_id = $5::uuid, image_id = $6::uuid`,
      [fields.name, fields.priceVnd, fields.categoryId, fields.imageId],
      "status <> 'DELETED'",
    );
  }

  async setItemStatus(context: TransactionContext, current: MenuItemRow, status: Exclude<MenuItemStatus, 'DELETED'>): Promise<MenuItemRow> {
    return this.#update(context, current, `status = $3`, [status], "status <> 'DELETED'");
  }

  async softDeleteItem(context: TransactionContext, current: MenuItemRow): Promise<MenuItemRow> {
    return this.#update(
      context,
      current,
      `status = 'DELETED', deleted_at = date_trunc('milliseconds', clock_timestamp())`,
      [],
      "status <> 'DELETED'",
    );
  }

  async #update(
    context: TransactionContext,
    current: MenuItemRow,
    assignments: string,
    values: readonly unknown[],
    extraWhere: string,
  ): Promise<MenuItemRow> {
    const result = await context.query<RawItem>(
      `UPDATE app.menu_items
          SET ${assignments},
              version = version + 1,
              updated_at = date_trunc('milliseconds', clock_timestamp())
        WHERE item_id = $1::uuid AND version = $2::bigint AND ${extraWhere}
        RETURNING ${ITEM_COLUMNS}`,
      [current.itemId, current.version, ...values],
    );
    const row = result.rows[0];
    if (result.rowCount !== 1 || row === undefined) {
      throw new TechnicalError('internal', 'Dish was not updated');
    }
    return toItem(row);
  }

  async insertImage(
    context: TransactionContext,
    imageId: string,
    shopId: string,
    contentType: MenuImageContentType,
    bytes: Buffer,
  ): Promise<void> {
    const result = await context.query(
      `INSERT INTO app.menu_images (image_id, shop_id, content_type, byte_size, data, created_at)
       SELECT $1::uuid, $2::uuid, $3, $4::integer, $5::bytea, clock.t
         FROM (SELECT date_trunc('milliseconds', clock_timestamp()) AS t) AS clock`,
      [imageId, shopId, contentType, bytes.length, bytes],
    );
    if (result.rowCount !== 1) {
      throw new TechnicalError('internal', 'Picture was not written');
    }
  }

  async findImage(
    context: TransactionContext,
    imageId: string,
  ): Promise<{ contentType: MenuImageContentType; data: Buffer } | undefined> {
    const result = await context.query<{ content_type: MenuImageContentType; data: Buffer }>(
      `SELECT content_type, data FROM app.menu_images WHERE image_id = $1::uuid`,
      [imageId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { contentType: row.content_type, data: row.data };
  }

  /** Which of these shops have at least one VISIBLE dish (inside the group when one is given). */
  async shopIdsWithPublicItem(context: TransactionContext, shopIds: readonly string[], categoryId: string | null): Promise<Set<string>> {
    if (shopIds.length === 0) {
      return new Set();
    }
    const result = await context.query<{ shop_id: string }>(
      `SELECT DISTINCT shop_id
         FROM app.menu_items
        WHERE shop_id = ANY($1::uuid[]) AND status = 'VISIBLE' AND ($2::uuid IS NULL OR category_id = $2::uuid)`,
      [shopIds, categoryId],
    );
    return new Set(result.rows.map((row) => row.shop_id));
  }

  /**
   * VISIBLE dishes of these shops whose folded name contains the term (`likePattern` is already a LIKE body of the folded term, null =
   * no term), inside the group when one is given. At most `cap` rows: the coordinator pages what it keeps.
   */
  async searchPublicItems(
    context: TransactionContext,
    shopIds: readonly string[],
    categoryId: string | null,
    likePattern: string | null,
    cap: number,
  ): Promise<(PublicMenuItem & { shopId: string })[]> {
    if (shopIds.length === 0) {
      return [];
    }
    const result = await context.query<{ item_id: string; name: string; price_vnd: number; image_id: string | null; category_id: string; shop_id: string }>(
      `SELECT item_id, name, price_vnd, image_id, category_id, shop_id
         FROM app.menu_items
        WHERE shop_id = ANY($1::uuid[]) AND status = 'VISIBLE'
          AND ($2::uuid IS NULL OR category_id = $2::uuid)
          AND ($3::text IS NULL OR app.fold_vi(name) LIKE $3::text ESCAPE '\\')
        ORDER BY app.fold_vi(name), item_id
        LIMIT $4::integer`,
      [shopIds, categoryId, likePattern, cap],
    );
    return result.rows.map((row) => ({ itemId: row.item_id, name: row.name, priceVnd: row.price_vnd, imageId: row.image_id, categoryId: row.category_id, shopId: row.shop_id }));
  }
}
