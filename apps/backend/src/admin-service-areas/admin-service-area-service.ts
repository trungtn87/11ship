import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { SessionLookup } from '../admin-auth/admin-session-repository';
import { PROVISIONING_SCOPE_TYPE } from '../admin-provisioning/admin-provisioning-constants';
import { setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { AdminSystemActor, LockedActor } from '../admin-provisioning/admin-system-actor';
import { AuditWriter } from '../audit/audit-writer';
import { AppError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { OutboxWriter } from '../outbox/outbox-writer';
import { assertParameterAccess, ParameterAccess } from '../system-settings/system-parameter-access';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { AreaCounts, AreaImpact, AreaRecord, AdminServiceAreaRepository } from './admin-service-area-repository';
import { Coverage, CreateAreaBody, ImpactQuery, StatusAreaBody, UpdateAreaBody } from './admin-service-area-validation';

const RESOURCE = 'service_area';
const OPERATIONS = {
  create: 'admin.service_area.create.v1',
  update: 'admin.service_area.update.v1',
  status: 'admin.service_area.status.v1',
} as const;
const EVENTS = { create: 'service_area.created.v1', update: 'service_area.updated.v1', status: 'service_area.status_changed.v1' } as const;
const iso = (ms: number): string => new Date(ms).toISOString();

const coverageView = (c: Coverage | null): JsonObject => (c === null ? (null as unknown as JsonObject) : { lat: c.latitude, lng: c.longitude, radius_m: c.radiusMeters });

function areaView(area: AreaRecord, counts: AreaCounts): JsonObject {
  return {
    service_area_id: area.serviceAreaId,
    code: area.code,
    name: area.name,
    status: area.status,
    version: area.version,
    coverage: coverageView(area.coverage),
    // "Chưa cấu hình GPS": the area has no circle, so a pin cannot be proved to belong to it (and GPS resolve never picks it).
    gps_configured: area.coverage !== null,
    shops_total: counts.shopsTotal,
    shops_public: counts.shopsPublic,
    pins_outside: counts.pinsOutside,
    created_at: iso(area.createdAtMs),
    updated_at: iso(area.updatedAtMs),
  };
}

function impactView(impact: AreaImpact, requiresConfirmation: boolean): JsonObject {
  return {
    shops_total: impact.shopsTotal,
    shops_public: impact.shopsPublic,
    pins_outside_current: impact.pinsOutsideCurrent,
    pins_outside_proposed: impact.pinsOutsideProposed,
    public_shops_newly_outside: impact.publicShopsNewlyOutside,
    orders_open: impact.ordersOpen,
    active_deliveries: impact.activeDeliveries,
    requires_confirmation: requiresConfirmation,
  };
}

const sameCoverage = (a: Coverage | null, b: Coverage | undefined): boolean =>
  b === undefined || (a !== null && a.latitude === b.latitude && a.longitude === b.longitude && a.radiusMeters === b.radiusMeters);

/**
 * Administration "Hệ thống -> Vùng hoạt động" (issue #253). SYSTEM creates, edits and switches areas; any live ADMIN reads and previews (the rule of
 * every system parameter; `can_manage_shops` / `can_lock` give nothing here). One transaction per write: record -> actor locks -> the area row FOR
 * UPDATE (shops, which hold it FOR SHARE while they save a pin, wait or are waited for) -> version check -> impact recount -> write -> audit with the
 * reason -> outbox. Nothing here touches a shop, an order, a delivery or a fee: orders keep the pickup and fee they were created with; a shop
 * whose pin leaves the circle is simply not listed any more (the public rules decide from the stored pin) until its owner re-pins.
 */
@Injectable()
export class AdminServiceAreaService {
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actor: AdminSystemActor,
    private readonly areas: AdminServiceAreaRepository,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
  }

  async list(sessionToken: string | undefined): Promise<JsonObject> {
    return this.#read(sessionToken, async (context) => ({ items: (await this.areas.list(context)).map(({ area, counts }) => areaView(area, counts)) }));
  }

  async detail(sessionToken: string | undefined, areaId: string): Promise<JsonObject> {
    return this.#read(sessionToken, (context) => this.#detail(context, areaId));
  }

  async impact(sessionToken: string | undefined, areaId: string, query: ImpactQuery): Promise<JsonObject> {
    return this.#read(sessionToken, async (context) => {
      const area = await this.areas.find(context, areaId, false);
      if (area === undefined) throw new AppError('SERVICE_AREA_NOT_FOUND');
      const impact = await this.areas.impact(context, area, query.coverage);
      return impactView(impact, this.#needsConfirmation(area, query.status ?? area.status, query.coverage, impact));
    });
  }

  async create(sessionToken: string | undefined, csrfHeader: unknown, body: CreateAreaBody, key: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrfHeader });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE,
        scopeId: known.userId,
        operationId: OPERATIONS.create,
        idempotencyKey: key,
        logicalRequest: { code: body.code, name: body.name, status: body.status, coverage: coverageView(body.coverage), reason: body.reason },
        replay: this.#replay(known),
      },
      async (context) => {
        const locked = await this.#lockActor(context, known, 'write');
        if (await this.areas.codeExists(context, body.code)) throw new AppError('SERVICE_AREA_CODE_CONFLICT');
        const areaId = randomUUID();
        await this.areas.insert(context, areaId, body);
        await this.#record(context, locked, meta, 'create', areaId, 1, { code: body.code, name: body.name, status: body.status, gps_configured: body.coverage !== null, reason: body.reason });
        return { status: 201, replayGuard: { actor_user_id: known.userId }, payload: await this.#detail(context, areaId) };
      },
    );
  }

  async update(sessionToken: string | undefined, csrfHeader: unknown, areaId: string, body: UpdateAreaBody, key: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrfHeader });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE,
        scopeId: known.userId,
        operationId: OPERATIONS.update,
        idempotencyKey: key,
        logicalRequest: { service_area_id: areaId, expected_version: body.expectedVersion, name: body.name, coverage: body.coverage === undefined ? 'KEEP' : coverageView(body.coverage), confirm_impact: body.confirmImpact, reason: body.reason },
        replay: this.#replay(known),
      },
      async (context) => {
        const locked = await this.#lockActor(context, known, 'write');
        const area = await this.#lockArea(context, areaId, body.expectedVersion);
        const geometryChanged = !sameCoverage(area.coverage, body.coverage);
        if (geometryChanged) {
          const impact = await this.areas.impact(context, area, body.coverage ?? null);
          if (this.#needsConfirmation(area, area.status, body.coverage ?? null, impact) && !body.confirmImpact) throw new AppError('SERVICE_AREA_IMPACT_CONFIRM_REQUIRED');
        }
        await this.areas.update(context, areaId, { name: body.name, coverage: body.coverage, status: area.status });
        await this.#record(context, locked, meta, 'update', areaId, area.version + 1, {
          from_name: area.name, to_name: body.name, geometry_changed: geometryChanged,
          ...(geometryChanged && body.coverage !== undefined ? { to_lat: body.coverage.latitude, to_lng: body.coverage.longitude, to_radius_m: body.coverage.radiusMeters } : {}),
          reason: body.reason,
        });
        return { status: 200, replayGuard: { actor_user_id: known.userId }, payload: await this.#detail(context, areaId) };
      },
    );
  }

  async setStatus(sessionToken: string | undefined, csrfHeader: unknown, areaId: string, body: StatusAreaBody, key: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrfHeader });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE,
        scopeId: known.userId,
        operationId: OPERATIONS.status,
        idempotencyKey: key,
        logicalRequest: { service_area_id: areaId, expected_version: body.expectedVersion, status: body.status, confirm_impact: body.confirmImpact, reason: body.reason },
        replay: this.#replay(known),
      },
      async (context) => {
        const locked = await this.#lockActor(context, known, 'write');
        const area = await this.#lockArea(context, areaId, body.expectedVersion);
        if (area.status === body.status) {
          // Already in the wanted state: nothing to change and nothing to log (a retry with a fresh key, a double tap).
          return { status: 200, replayGuard: { actor_user_id: known.userId }, payload: await this.#detail(context, areaId) };
        }
        const impact = await this.areas.impact(context, area, null);
        if (this.#needsConfirmation(area, body.status, null, impact) && !body.confirmImpact) throw new AppError('SERVICE_AREA_IMPACT_CONFIRM_REQUIRED');
        await this.areas.update(context, areaId, { name: area.name, coverage: undefined, status: body.status });
        await this.#record(context, locked, meta, 'status', areaId, area.version + 1, { from_status: area.status, to_status: body.status, reason: body.reason });
        return { status: 200, replayGuard: { actor_user_id: known.userId }, payload: await this.#detail(context, areaId) };
      },
    );
  }

  /** Switching an ACTIVE area off, or moving its circle so that public shops fall outside, must be confirmed once the figures were seen. */
  #needsConfirmation(area: AreaRecord, nextStatus: 'ACTIVE' | 'INACTIVE', proposed: Coverage | null, impact: AreaImpact): boolean {
    const switchOff = area.status === 'ACTIVE' && nextStatus === 'INACTIVE' && (impact.shopsPublic > 0 || impact.ordersOpen > 0 || impact.activeDeliveries > 0);
    const geometry = proposed !== null && !sameCoverage(area.coverage, proposed) && impact.publicShopsNewlyOutside > 0;
    return switchOff || geometry;
  }

  async #lockArea(context: TransactionContext, areaId: string, expectedVersion: number): Promise<AreaRecord> {
    const area = await this.areas.find(context, areaId, true);
    if (area === undefined) throw new AppError('SERVICE_AREA_NOT_FOUND');
    if (area.version !== expectedVersion) throw new AppError('VERSION_CONFLICT');
    return area;
  }

  async #detail(context: TransactionContext, areaId: string): Promise<JsonObject> {
    const area = await this.areas.find(context, areaId, false);
    if (area === undefined) throw new AppError('SERVICE_AREA_NOT_FOUND');
    const counts = await this.areas.counts(context, areaId);
    const impact = await this.areas.impact(context, area, null);
    return { ...areaView(area, counts), orders_open: impact.ordersOpen, active_deliveries: impact.activeDeliveries };
  }

  async #record(context: TransactionContext, locked: LockedActor, meta: { requestId: string }, kind: keyof typeof OPERATIONS, areaId: string, version: number, metadata: JsonObject): Promise<void> {
    await this.audit.append(context, {
      requestId: meta.requestId,
      actorType: locked.checked.membership.adminRole,
      actorId: locked.known.userId,
      action: OPERATIONS[kind],
      resourceType: RESOURCE,
      resourceId: areaId,
      resourceVersion: version,
      outcome: 'SUCCESS',
      metadata,
    });
    await this.outbox.append(context, {
      eventType: EVENTS[kind],
      eventSchemaVersion: 1,
      resourceType: RESOURCE,
      resourceId: areaId,
      resourceVersion: version,
      payload: { service_area_id: areaId, version },
    });
  }

  #replay(known: SessionLookup) {
    return {
      kind: 'sensitive' as const,
      authorize: async (context: TransactionContext, guard: JsonObject) => {
        if (guard.actor_user_id !== known.userId) throw new AppError('ADMIN_SESSION_INVALID');
        await this.#lockActor(context, known, 'write');
        return true as const;
      },
    };
  }

  async #read<T>(sessionToken: string | undefined, body: (context: TransactionContext) => Promise<T>): Promise<T> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      await this.#lockActor(context, known, 'read');
      return body(context);
    });
  }

  async #lockActor(context: TransactionContext, known: SessionLookup, access: ParameterAccess): Promise<LockedActor> {
    const locked = await this.actor.lock(context, known, { user: 'read', factor: 'read' });
    const nowMs = await freshClockMs(context);
    assertParameterAccess(this.actor, locked, nowMs, access);
    return locked;
  }
}
