// HTTP client of "Nhóm món": GET /v1/admin/menu-categories (list), POST (create) and POST /:id (change name, order and status together).
// Cookie-only (HttpOnly session, same origin); the CSRF token is passed in from memory. Every answer is parsed strictly: a body that does not have the
// documented shape is "unknown", never half-shown data. Nothing is stored here.

import { Failure } from './accounts.js';
import { CsrfPort, failureOf } from './accounts-api.js';
import { ApiClient, ApiResult, record, str } from './api.js';
import { CATALOG_PAGE_SIZE, CatalogCommand, CatalogQuery, CatalogRead, CatalogSaveResult, CatalogSource, CategoryRow } from './catalog.js';

/** The transport's base: this client's paths start with /admin. */
export const CATALOG_BASE = '/v1';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH = '/admin/menu-categories';

export interface CategoryPage {
  readonly rows: readonly CategoryRow[];
  readonly total: number;
  readonly nextSortOrder: number;
}

const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function parseCategoryRow(value: unknown): CategoryRow | undefined {
  const raw = record(value);
  if (raw === undefined) {
    return undefined;
  }
  const id = str(raw.category_id);
  const name = str(raw.name);
  const updatedAt = str(raw.updated_at);
  const status = raw.status === 'ACTIVE' || raw.status === 'INACTIVE' ? raw.status : undefined;
  if (
    id === undefined ||
    !UUID_RE.test(id) ||
    name === undefined ||
    name === '' ||
    updatedAt === undefined ||
    Number.isNaN(Date.parse(updatedAt)) ||
    status === undefined ||
    !whole(raw.sort_order) ||
    !whole(raw.item_count) ||
    !whole(raw.version) ||
    raw.version < 1
  ) {
    return undefined;
  }
  return { id, name, sortOrder: raw.sort_order, status, itemCount: raw.item_count, version: raw.version, updatedAt };
}

export function parseCategoryPage(data: Record<string, unknown>): CategoryPage | undefined {
  if (!Array.isArray(data.items) || !whole(data.total) || !whole(data.next_sort_order)) {
    return undefined;
  }
  const rows: CategoryRow[] = [];
  for (const entry of data.items) {
    const row = parseCategoryRow(entry);
    if (row === undefined) {
      return undefined;
    }
    rows.push(row);
  }
  return { rows, total: data.total, nextSortOrder: data.next_sort_order };
}

function query(params: Readonly<Record<string, string | undefined>>): string {
  const parts = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value as string)}`);
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

export class AdminCatalogApi extends ApiClient {
  list(filter: CatalogQuery): Promise<ApiResult<CategoryPage>> {
    const path = `${PATH}${query({
      q: filter.query.trim(),
      status: filter.status === 'ALL' ? undefined : filter.status,
      limit: String(CATALOG_PAGE_SIZE),
      offset: String((Math.max(filter.page, 1) - 1) * CATALOG_PAGE_SIZE),
    })}`;
    return this.call({ method: 'GET', path }, parseCategoryPage);
  }

  /** One request; the caller owns the key and never repeats the call by itself. */
  save(csrf: string, command: CatalogCommand): Promise<ApiResult<CategoryRow>> {
    if (command.kind === 'create') {
      return this.call(
        {
          method: 'POST',
          path: PATH,
          body: { name: command.name, status: command.status, ...(command.sortOrder === null ? {} : { sort_order: command.sortOrder }) },
          csrf,
          idempotencyKey: command.key,
        },
        parseCategoryRow,
        // 201 for the first answer; a replay of the same key answers with the stored 201 too, 200 is accepted for safety.
        [201, 200],
      );
    }
    return this.call(
      {
        method: 'POST',
        path: `${PATH}/${encodeURIComponent(command.id)}`,
        body: { expected_version: command.version, name: command.name, sort_order: command.sortOrder, status: command.status },
        csrf,
        idempotencyKey: command.key,
      },
      parseCategoryRow,
    );
  }
}

type Failed = { readonly kind: 'failed'; readonly failure: Failure; readonly retryAfterSec?: number };

/** The real CatalogSource. It keeps nothing: no rows, no versions, no keys. */
export function createCatalogSource(api: AdminCatalogApi, session?: CsrfPort): CatalogSource {
  return {
    async list(filter): Promise<CatalogRead> {
      const result = await api.list(filter);
      if (result.kind === 'ok') {
        return { kind: 'ready', rows: result.data.rows, total: result.data.total, nextSortOrder: result.data.nextSortOrder };
      }
      const failed: Failed = failureOf(result);
      return failed;
    },
    async save(command): Promise<CatalogSaveResult> {
      if (session === undefined) {
        return { kind: 'not-wired' };
      }
      const csrf = session.csrf();
      if (csrf === undefined) {
        return { kind: 'session-expired' };
      }
      const result = await api.save(csrf, command);
      if (result.kind === 'ok') {
        return { kind: 'ok' };
      }
      // No usable answer, or a server fault (503 TRANSACTION_OUTCOME_UNKNOWN included): the save may have been executed.
      if (result.kind === 'network' || result.status >= 500) {
        return { kind: 'unknown' };
      }
      switch (result.code) {
        case 'ADMIN_CSRF_INVALID':
          // Refused before anything ran; a fresh token is read and the admin retries with the SAME key.
          await session.refresh();
          return { kind: 'unknown' };
        case 'ADMIN_SESSION_INVALID':
          return { kind: 'session-expired' };
        case 'ADMIN_FORBIDDEN':
          return { kind: 'forbidden' };
        case 'MENU_CATEGORY_VERSION_CONFLICT':
          return { kind: 'conflict' };
        case 'MENU_CATEGORY_NAME_TAKEN':
          return { kind: 'name-taken', inactive: false };
        case 'MENU_CATEGORY_NAME_TAKEN_INACTIVE':
          return { kind: 'name-taken', inactive: true };
        case 'MENU_CATEGORY_NOT_FOUND':
          return { kind: 'not-found' };
        case 'IDEMPOTENCY_BUSY':
          return { kind: 'unknown' };
        case 'ADMIN_AUTH_RATE_LIMITED':
          return { kind: 'rate-limited', ...(result.retryAfterSeconds === undefined ? {} : { retryAfterSec: result.retryAfterSeconds }) };
        default:
          return { kind: 'rejected' };
      }
    },
  };
}
