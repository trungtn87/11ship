import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { toSafeInteger } from '../shop/shop-db';
import { TransactionContext } from '../transaction/transaction-context';

export type CategoryStatus = 'ACTIVE' | 'INACTIVE';

/** One dish group as the Administration web manages it. */
export interface ManagedCategory {
  readonly categoryId: string;
  readonly name: string;
  readonly status: CategoryStatus;
  readonly sortOrder: number;
  readonly version: number;
  readonly updatedAtMs: number;
}

export interface ManagedCategoryListed extends ManagedCategory {
  /** Dishes of any shop that are not deleted (visible or hidden) and belong to the group. */
  readonly itemCount: number;
}

export interface CategoryListParams {
  /** A folded LIKE pattern, or null. */
  readonly pattern: string | null;
  readonly status: CategoryStatus | null;
  readonly limit: number;
  readonly offset: number;
}

interface RawCategory {
  category_id: string;
  name: string;
  status: CategoryStatus;
  sort_order: number;
  version: string;
  updated_ms: string;
}

const COLUMNS = `category_id, name, status, sort_order, version, (extract(epoch from updated_at) * 1000)::bigint AS updated_ms`;

function toCategory(row: RawCategory): ManagedCategory {
  return {
    categoryId: row.category_id,
    name: row.name,
    status: row.status,
    sortOrder: row.sort_order,
    version: toSafeInteger(row.version),
    updatedAtMs: toSafeInteger(row.updated_ms),
  };
}

/**
 * SQL of the dish-group management (M02, Administration web). Part of the Menu module, which owns app.menu_categories. Every method takes
 * the caller's TransactionContext and never begins, commits or rolls back. A mutation first takes `lockWrites` (one transaction-scoped
 * advisory lock for all group writes: the volume is a handful of rows, and it makes "check the name, then write" race-free), then the
 * row FOR UPDATE.
 */
@Injectable()
export class MenuCategoryAdminRepository {
  /** Serialises every create/update of a group. Released with the transaction. */
  async lockWrites(context: TransactionContext): Promise<void> {
    await context.query('SELECT pg_advisory_xact_lock(1793232000, 1)');
  }

  async count(context: TransactionContext, params: Pick<CategoryListParams, 'pattern' | 'status'>): Promise<number> {
    const result = await context.query<{ n: string }>(
      `SELECT count(*) AS n FROM app.menu_categories c
        WHERE ($1::text IS NULL OR app.fold_vi(c.name) LIKE $1::text)
          AND ($2::text IS NULL OR c.status = $2::text)`,
      [params.pattern, params.status],
    );
    return toSafeInteger(result.rows[0]?.n);
  }

  /** ACTIVE groups first, then the order, then the name, then the id: one total order, so pages never overlap. */
  async list(context: TransactionContext, params: CategoryListParams): Promise<ManagedCategoryListed[]> {
    const result = await context.query<RawCategory & { item_count: string }>(
      `SELECT c.category_id, c.name, c.status, c.sort_order, c.version, (extract(epoch from c.updated_at) * 1000)::bigint AS updated_ms,
              (SELECT count(*) FROM app.menu_items i WHERE i.category_id = c.category_id AND i.status <> 'DELETED') AS item_count
         FROM app.menu_categories c
        WHERE ($1::text IS NULL OR app.fold_vi(c.name) LIKE $1::text)
          AND ($2::text IS NULL OR c.status = $2::text)
        ORDER BY (c.status = 'ACTIVE') DESC, c.sort_order, app.fold_vi(c.name) COLLATE "C", c.name COLLATE "C", c.category_id
        LIMIT $3::integer OFFSET $4::integer`,
      [params.pattern, params.status, params.limit, params.offset],
    );
    return result.rows.map((row) => ({ ...toCategory(row), itemCount: toSafeInteger(row.item_count) }));
  }

  /** The order a NEW group takes by default: after the last one. */
  async nextSortOrder(context: TransactionContext): Promise<number> {
    const result = await context.query<{ next: string }>(`SELECT (COALESCE(max(sort_order), -1) + 1)::bigint AS next FROM app.menu_categories`);
    return Math.min(toSafeInteger(result.rows[0]?.next), 100000);
  }

  async lockById(context: TransactionContext, categoryId: string): Promise<ManagedCategory | undefined> {
    const result = await context.query<RawCategory>(`SELECT ${COLUMNS} FROM app.menu_categories WHERE category_id = $1::uuid FOR UPDATE`, [categoryId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toCategory(row);
  }

  /** A group (other than `exceptId`) whose name is the same ignoring case, white space and composition. Marks are NOT ignored. */
  async findSameName(context: TransactionContext, name: string, exceptId: string | null): Promise<ManagedCategory | undefined> {
    const result = await context.query<RawCategory>(
      `SELECT ${COLUMNS} FROM app.menu_categories
        WHERE app.menu_category_key(name) = app.menu_category_key($1::text) AND ($2::uuid IS NULL OR category_id <> $2::uuid)`,
      [name, exceptId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toCategory(row);
  }

  async itemCount(context: TransactionContext, categoryId: string): Promise<number> {
    const result = await context.query<{ n: string }>(
      `SELECT count(*) AS n FROM app.menu_items WHERE category_id = $1::uuid AND status <> 'DELETED'`,
      [categoryId],
    );
    return toSafeInteger(result.rows[0]?.n);
  }

  async insert(context: TransactionContext, input: { categoryId: string; name: string; status: CategoryStatus; sortOrder: number }): Promise<ManagedCategory> {
    const result = await context.query<RawCategory>(
      `INSERT INTO app.menu_categories (category_id, name, status, sort_order, version, created_at, updated_at)
       SELECT $1::uuid, $2::text, $3::text, $4::integer, 1, clock.t, clock.t
         FROM (SELECT date_trunc('milliseconds', clock_timestamp()) AS t) AS clock
       RETURNING ${COLUMNS}`,
      [input.categoryId, input.name, input.status, input.sortOrder],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new TechnicalError('internal', 'Dish group was not written');
    }
    return toCategory(row);
  }

  /** The caller holds the row FOR UPDATE and has compared the version: this writes the three fields and bumps the version. */
  async update(context: TransactionContext, current: ManagedCategory, next: { name: string; status: CategoryStatus; sortOrder: number }): Promise<ManagedCategory> {
    const result = await context.query<RawCategory>(
      `UPDATE app.menu_categories
          SET name = $3::text, status = $4::text, sort_order = $5::integer, version = version + 1,
              updated_at = GREATEST(updated_at, date_trunc('milliseconds', clock_timestamp()))
        WHERE category_id = $1::uuid AND version = $2::bigint
       RETURNING ${COLUMNS}`,
      [current.categoryId, current.version, next.name, next.status, next.sortOrder],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new TechnicalError('internal', 'Dish group was not updated');
    }
    return toCategory(row);
  }
}
