import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { SessionLookup } from '../admin-auth/admin-session-repository';
import { AdminRole } from '../admin-auth/admin-auth-constants';
import { AdminAccountReadRepository } from '../admin-accounts/admin-account-read-repository';
import { setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { PROVISIONING_SCOPE_TYPE } from '../admin-provisioning/admin-provisioning-constants';
import { AdminSystemActor } from '../admin-provisioning/admin-system-actor';
import { AuditWriter } from '../audit/audit-writer';
import { AppError, TechnicalError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { ManagedCategory, MenuCategoryAdminRepository } from '../menu/menu-category-admin-repository';
import { OutboxWriter } from '../outbox/outbox-writer';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { CategoryListQuery, CreateCategoryBody, UpdateCategoryBody } from './admin-menu-category-validation';

const CREATE_OPERATION = 'admin.menu_category.create.v1';
const UPDATE_OPERATION = 'admin.menu_category.update.v1';
const RESOURCE = 'menu_category';

const iso = (ms: number): string => new Date(ms).toISOString();

function view(category: ManagedCategory, itemCount: number): JsonObject {
  return {
    category_id: category.categoryId,
    name: category.name,
    status: category.status,
    sort_order: category.sortOrder,
    version: category.version,
    item_count: itemCount,
    updated_at: iso(category.updatedAtMs),
  };
}

interface Authorized {
  readonly role: AdminRole;
}

/**
 * Dish-group management (M02, Administration web). SYSTEM, or an ADMIN whose CURRENT SHOP permission row has VIEW and the catalog right;
 * shop owners never reach it (a different credential, a different route). The backend decides on every read and write, under the actor's
 * locks, after the database clock was read (the screen only hides what it cannot use).
 *
 * A write is one transaction opened by the idempotency executor: record -> actor locks -> permission -> advisory lock for group writes ->
 * the group row FOR UPDATE -> version and name checks -> write -> audit (actor, time, before and after) -> outbox -> the executor's record.
 * A replay re-checks the CURRENT actor and permission and returns the stored answer; it never writes again. No group is ever deleted.
 */
@Injectable()
export class AdminMenuCategoryService {
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actor: AdminSystemActor,
    private readonly permissions: AdminAccountReadRepository,
    private readonly categories: MenuCategoryAdminRepository,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
  }

  async list(sessionToken: string | undefined, query: CategoryListQuery): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context): Promise<JsonObject> => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      await this.#authorize(context, known);
      const filter = { pattern: query.pattern, status: query.status };
      const total = await this.categories.count(context, filter);
      const rows = await this.categories.list(context, { ...filter, limit: query.limit, offset: query.offset });
      return {
        items: rows.map((row) => view(row, row.itemCount)),
        total,
        limit: query.limit,
        offset: query.offset,
        q: query.q,
        status: query.status ?? 'ALL',
        next_sort_order: await this.categories.nextSortOrder(context),
      };
    });
  }

  async create(
    sessionToken: string | undefined,
    csrfHeader: unknown,
    body: CreateCategoryBody,
    idempotencyKey: string | readonly string[] | undefined,
    meta: { requestId: string },
  ): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrfHeader });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE,
        scopeId: known.userId,
        operationId: CREATE_OPERATION,
        idempotencyKey,
        logicalRequest: { name: body.name, sort_order: body.sortOrder, status: body.status },
        replay: { kind: 'sensitive', authorize: (context, guard) => this.#authorizeReplay(context, guard, known) },
      },
      async (context) => {
        const auth = await this.#authorize(context, known);
        await this.categories.lockWrites(context);
        await this.#assertNameFree(context, body.name, null);
        const sortOrder = body.sortOrder ?? (await this.categories.nextSortOrder(context));
        const created = await this.categories.insert(context, { categoryId: randomUUID(), name: body.name, status: body.status, sortOrder });
        await this.audit.append(context, {
          requestId: meta.requestId,
          actorType: auth.role,
          actorId: known.userId,
          action: CREATE_OPERATION,
          resourceType: RESOURCE,
          resourceId: created.categoryId,
          resourceVersion: created.version,
          outcome: 'SUCCESS',
          metadata: { category_id: created.categoryId, to_name: created.name, to_status: created.status, to_sort_order: created.sortOrder, version: created.version },
        });
        await this.outbox.append(context, {
          eventType: 'menu.category.created.v1',
          eventSchemaVersion: 1,
          resourceType: RESOURCE,
          resourceId: created.categoryId,
          resourceVersion: created.version,
          payload: { category_id: created.categoryId, status: created.status, version: created.version },
        });
        return { status: 201, replayGuard: { actor_user_id: known.userId }, payload: view(created, 0) };
      },
    );
  }

  async update(
    sessionToken: string | undefined,
    csrfHeader: unknown,
    categoryId: string,
    body: UpdateCategoryBody,
    idempotencyKey: string | readonly string[] | undefined,
    meta: { requestId: string },
  ): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrfHeader });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE,
        scopeId: known.userId,
        operationId: UPDATE_OPERATION,
        idempotencyKey,
        logicalRequest: { category_id: categoryId, expected_version: body.expectedVersion, name: body.name, sort_order: body.sortOrder, status: body.status },
        replay: { kind: 'sensitive', authorize: (context, guard) => this.#authorizeReplay(context, guard, known) },
      },
      async (context) => {
        const auth = await this.#authorize(context, known);
        await this.categories.lockWrites(context);
        const current = await this.categories.lockById(context, categoryId);
        if (current === undefined) {
          throw new AppError('MENU_CATEGORY_NOT_FOUND');
        }
        if (current.version !== body.expectedVersion) {
          throw new AppError('MENU_CATEGORY_VERSION_CONFLICT');
        }
        await this.#assertNameFree(context, body.name, categoryId);
        const itemCount = await this.categories.itemCount(context, categoryId);
        const changed = [
          ...(current.name !== body.name ? ['name'] : []),
          ...(current.status !== body.status ? ['status'] : []),
          ...(current.sortOrder !== body.sortOrder ? ['sort_order'] : []),
        ];
        if (changed.length === 0) {
          // Nothing to write: the same answer, no new version, no audit row.
          return { status: 200, replayGuard: { actor_user_id: known.userId }, payload: view(current, itemCount) };
        }
        const updated = await this.categories.update(context, current, { name: body.name, status: body.status, sortOrder: body.sortOrder });
        await this.audit.append(context, {
          requestId: meta.requestId,
          actorType: auth.role,
          actorId: known.userId,
          action: UPDATE_OPERATION,
          resourceType: RESOURCE,
          resourceId: categoryId,
          resourceVersion: updated.version,
          outcome: 'SUCCESS',
          metadata: {
            category_id: categoryId,
            changed_fields: changed.join(','),
            from_name: current.name,
            to_name: updated.name,
            from_status: current.status,
            to_status: updated.status,
            from_sort_order: current.sortOrder,
            to_sort_order: updated.sortOrder,
            item_count: itemCount,
            version: updated.version,
          },
        });
        await this.outbox.append(context, {
          eventType: 'menu.category.updated.v1',
          eventSchemaVersion: 1,
          resourceType: RESOURCE,
          resourceId: categoryId,
          resourceVersion: updated.version,
          payload: { category_id: categoryId, status: updated.status, version: updated.version },
        });
        return { status: 200, replayGuard: { actor_user_id: known.userId }, payload: view(updated, itemCount) };
      },
    );
  }

  /** The same name (ignoring case, white space and composition, NOT marks) on another group: an inactive one is named as such. */
  async #assertNameFree(context: TransactionContext, name: string, exceptId: string | null): Promise<void> {
    const same = await this.categories.findSameName(context, name, exceptId);
    if (same !== undefined) {
      throw new AppError(same.status === 'INACTIVE' ? 'MENU_CATEGORY_NAME_TAKEN_INACTIVE' : 'MENU_CATEGORY_NAME_TAKEN');
    }
  }

  /**
   * Actor locks in the module order, the CURRENT permission rows (ADMIN), the database clock after the last lock, then the right:
   * SYSTEM, or an ADMIN with VIEW and the catalog right on SHOP. Nothing from the client decides it.
   */
  async #authorize(context: TransactionContext, known: SessionLookup): Promise<Authorized> {
    const locked = await this.actor.lock(context, known, { user: 'read', factor: 'read' });
    const role = locked.checked.membership.adminRole;
    const rows = role === 'ADMIN' ? await this.permissions.permissions(context, known.userId) : [];
    const nowMs = await freshClockMs(context);
    this.actor.assertSessionLive(locked, nowMs);
    if (role === 'ADMIN' && !rows.some((row) => row.app === 'SHOP' && row.canView && row.canManageCatalog === true)) {
      throw new AppError('ADMIN_FORBIDDEN');
    }
    return { role };
  }

  async #authorizeReplay(context: TransactionContext, guard: JsonObject, known: SessionLookup): Promise<true> {
    if (guard.actor_user_id !== known.userId) {
      throw new TechnicalError('internal', 'Invalid replay guard');
    }
    await this.#authorize(context, known);
    return true;
  }
}
