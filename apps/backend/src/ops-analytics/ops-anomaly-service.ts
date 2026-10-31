import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { SessionLookup } from '../admin-auth/admin-session-repository';
import { AdminRights, AdminRightsReader } from '../admin-m12/admin-rights';
import { PROVISIONING_SCOPE_TYPE } from '../admin-provisioning/admin-provisioning-constants';
import { setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { AdminSystemActor } from '../admin-provisioning/admin-system-actor';
import { AuditWriter } from '../audit/audit-writer';
import { AppError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { PERMISSION_REPORT_READ } from '../finance-access/finance-access-constants';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { AnomalySettings, CASE_STATUSES, CaseRow, CaseStatus, Finding, OpsAnomalyRepository, OpsAnomalySettingsRepository, RULE_KINDS, RuleKind } from './ops-anomaly-repository';

export const ANOMALY_ACTIONS = ['review', 'check', 'dismiss', 'reopen', 'note'] as const;
export type AnomalyAction = (typeof ANOMALY_ACTIONS)[number];

const OPERATIONS = { action: 'ops.anomaly.action.v1', settings: 'ops.anomaly.settings.v1' } as const;

/** Which apps a rule needs to be READ: customer behaviour is the shop side, a direct call touches shop and Shipper, a Shipper's abandon is the Shipper side. */
const READ_APPS: Record<RuleKind, readonly ('SHOP' | 'DRIVER')[]> = {
  CUSTOMER_ORDER_CANCELS: ['SHOP'],
  DIRECT_CALL_CANCELS: ['SHOP', 'DRIVER'],
  SHIPPER_ABANDONS: ['DRIVER'],
  REPEAT_PAIR_CANCELS: ['SHOP', 'DRIVER'],
};

const readable = (rights: AdminRights, rule: RuleKind): boolean => READ_APPS[rule].every((app) => rights.canViewApp(app));
/** Notes and closing: SYSTEM, or an ADMIN who manages the objects of the case (shops: can_manage_shops; Shippers: the DRIVER review right). Seeing a case never lets you close it. */
const manageable = (rights: AdminRights, rule: RuleKind): boolean => READ_APPS[rule].every((app) => (app === 'SHOP' ? rights.canManageShops : rights.canReviewApp('DRIVER')));

const view = (c: CaseRow, rights: AdminRights, withEvidence: boolean): JsonObject => ({
  case_id: c.caseId,
  rule: c.rule,
  subject_kind: c.subjectKind,
  subject_id: c.subjectId,
  status: c.status,
  occurrences: c.occurrences,
  sample: c.sample,
  rate_pct: c.ratePct,
  window_from: new Date(c.windowFromMs).toISOString(),
  window_to: new Date(c.windowToMs).toISOString(),
  last_evidence_at: new Date(c.lastEvidenceMs).toISOString(),
  first_flagged_at: new Date(c.firstFlaggedMs).toISOString(),
  updated_at: new Date(c.updatedMs).toISOString(),
  note: c.note,
  version: c.version,
  can: manageable(rights, c.rule) ? canOf(c.status) : [],
  ...(withEvidence ? { evidence: c.evidence } : {}),
});

function canOf(status: CaseStatus): AnomalyAction[] {
  switch (status) {
    case 'NEW':
      return ['review', 'check', 'dismiss', 'note'];
    case 'REVIEWING':
      return ['check', 'dismiss', 'note'];
    case 'CHECKED':
    case 'DISMISSED':
      return ['reopen'];
  }
}

const TARGET: Record<Exclude<AnomalyAction, 'note'>, CaseStatus> = { review: 'REVIEWING', check: 'CHECKED', dismiss: 'DISMISSED', reopen: 'REVIEWING' };

/**
 * Issue #242: the anomaly SIGNALS. The detector (idempotent) opens or refreshes ONE case per rule and subject; the administration reads, notes and closes them. Nothing here
 * ever locks, suspends, restricts, charges or scores an account, changes an order, or tells the person: a flag is a thing for a human to look at, with the evidence and the
 * rule that raised it. Reading needs report.read and the APP views the rule needs; closing and notes need the right to manage those objects (see `manageable`).
 */
@Injectable()
export class OpsAnomalyService {
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actor: AdminSystemActor,
    private readonly rightsReader: AdminRightsReader,
    private readonly repo: OpsAnomalyRepository,
    private readonly settings: OpsAnomalySettingsRepository,
    private readonly audit: AuditWriter,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
  }

  // ---- the detector --------------------------------------------------------------------------------------------------------------

  /** Evaluates every rule at `nowMs` and opens / refreshes cases. Safe to run twice: the same facts change nothing. Returns what it opened and refreshed. */
  async detect(nowMs: number): Promise<{ opened: number; refreshed: number; findings: number }> {
    return this.transactions.withTransaction(async (context) => {
      const s = await this.settings.read(context);
      const found: Finding[] = [
        ...(await this.repo.customerOrderCancels(context, s, nowMs)),
        ...(await this.repo.directCallCancels(context, s, nowMs)),
        ...(await this.repo.shipperAbandons(context, s, nowMs)),
        ...(await this.repo.repeatPairCancels(context, s, nowMs)),
      ];
      const from = nowMs - s.windowDays * 86_400_000;
      let opened = 0;
      let refreshed = 0;
      for (const f of found) {
        const open = await this.repo.findOpen(context, f.rule, f.subjectId, true);
        if (open !== undefined) {
          if (await this.repo.refresh(context, open, f, from, nowMs)) refreshed += 1;
          continue;
        }
        // A closed case is only followed by a new one when there is evidence NEWER than its closing: the same old facts never re-open what a person already looked at.
        const closed = await this.repo.lastClosed(context, f.rule, f.subjectId);
        if (closed !== undefined && closed.closedMs !== null && f.lastEvidenceMs <= closed.closedMs) continue;
        const caseId = randomUUID();
        await this.repo.insert(context, caseId, f, from, nowMs);
        await this.audit.append(context, {
          requestId: randomUUID(), actorType: 'SYSTEM', actorId: null, action: 'ops.anomaly.opened.v1', resourceType: 'ops_anomaly_case', resourceId: caseId, resourceVersion: 1, outcome: 'SUCCESS',
          metadata: { rule: f.rule, occurrences: f.occurrences, sample: f.sample },
        });
        opened += 1;
      }
      return { opened, refreshed, findings: found.length };
    });
  }

  // ---- reading -------------------------------------------------------------------------------------------------------------------

  async #read<T>(token: string | undefined, body: (context: TransactionContext, rights: AdminRights, rules: RuleKind[]) => Promise<T>): Promise<T> {
    const known = await this.actor.precheck(token, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const rights = await this.rightsReader.read(context, known);
      rights.require(PERMISSION_REPORT_READ);
      const rules = RULE_KINDS.filter((rule) => readable(rights, rule));
      if (rules.length === 0) throw new AppError('ADMIN_FORBIDDEN');
      return body(context, rights, rules);
    });
  }

  async list(token: string | undefined, q: { status: CaseStatus | 'OPEN' | null; rule: RuleKind | null; q: string; limit: number; offset: number }): Promise<JsonObject> {
    return this.#read(token, async (context, rights, rules) => {
      if (q.rule !== null && !rules.includes(q.rule)) throw new AppError('ADMIN_FORBIDDEN');
      const page = await this.repo.list(context, { status: q.status, rule: q.rule, rules, q: q.q }, q.limit, q.offset);
      const settings = await this.settings.read(context);
      return {
        items: page.rows.map((c) => view(c, rights, false)),
        total: page.total, limit: q.limit, offset: q.offset,
        counts: await this.repo.counts(context, rules),
        rules,
        settings: this.#settingsView(settings, rights),
        note: 'Cờ chỉ để người xem xét; hệ thống không tự khóa, hạn chế, trừ tiền hay đổi quyền nhận chuyến.',
      };
    });
  }

  async detail(token: string | undefined, caseId: string): Promise<JsonObject> {
    return this.#read(token, async (context, rights, rules) => {
      const c = await this.repo.find(context, caseId, false);
      // Outside the rules this administrator may read: the same answer as a case that does not exist.
      if (c === undefined || !rules.includes(c.rule)) throw new AppError('ANOMALY_CASE_NOT_FOUND');
      return this.#detailView(context, c, rights);
    });
  }

  async #detailView(context: TransactionContext, c: CaseRow, rights: AdminRights): Promise<JsonObject> {
    const events = await this.repo.events(context, c.caseId);
    return { ...view(c, rights, true), history: events.map((e) => ({ action: e.action, from: e.fromStatus, to: e.toStatus, note: e.note, actor_user_id: e.actor, at: new Date(e.atMs).toISOString() })) };
  }

  #settingsView(s: AnomalySettings, rights: AdminRights): JsonObject {
    return { window_days: s.windowDays, min_samples: s.minSamples, rate_pct: s.ratePct, repeat_per_day: s.repeatPerDay, version: s.version, editable: rights.isSystem };
  }

  // ---- acting --------------------------------------------------------------------------------------------------------------------

  async act(token: string | undefined, csrf: unknown, caseId: string, input: { action: AnomalyAction; expectedVersion: number; note: string | null }, key: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(token, { required: true, header: csrf });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE, scopeId: known.userId, operationId: OPERATIONS.action, idempotencyKey: key,
        logicalRequest: { case_id: caseId, action: input.action, expected_version: input.expectedVersion, note: input.note },
        replay: this.#replay(known),
      },
      async (context) => {
        const rights = await this.#rightsLocked(context, known);
        const c = await this.repo.find(context, caseId, true);
        if (c === undefined || !readable(rights, c.rule)) throw new AppError('ANOMALY_CASE_NOT_FOUND');
        if (!manageable(rights, c.rule)) throw new AppError('ADMIN_FORBIDDEN');
        if (c.version !== input.expectedVersion) throw new AppError('VERSION_CONFLICT');
        if (!canOf(c.status).includes(input.action)) throw new AppError('ADMIN_ACTION_NOT_ALLOWED');
        if ((input.action === 'dismiss' || input.action === 'check' || input.action === 'note') && (input.note === null || input.note.trim() === '')) {
          throw new AppError('ADMIN_INPUT_INVALID');
        }
        const to = input.action === 'note' ? c.status : TARGET[input.action];
        if (input.action === 'reopen' && (await this.repo.findOpen(context, c.rule, c.subjectId, true)) !== undefined) throw new AppError('ADMIN_ACTION_NOT_ALLOWED');
        await this.repo.transition(context, c, to, input.note, randomUUID(), input.action, known.userId);
        await this.audit.append(context, {
          requestId: meta.requestId, actorType: rights.role, actorId: known.userId, action: OPERATIONS.action, resourceType: 'ops_anomaly_case', resourceId: caseId, resourceVersion: c.version + 1, outcome: 'SUCCESS',
          metadata: { rule: c.rule, from: c.status, to, action: input.action, note: input.note },
        });
        const after = await this.repo.find(context, caseId, false);
        return { status: 200, replayGuard: { actor_user_id: known.userId }, payload: await this.#detailView(context, after as CaseRow, rights) };
      },
    );
  }

  async updateSettings(token: string | undefined, csrf: unknown, input: { windowDays: number; minSamples: number; ratePct: number; repeatPerDay: number; expectedVersion: number; reason: string }, key: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(token, { required: true, header: csrf });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE, scopeId: known.userId, operationId: OPERATIONS.settings, idempotencyKey: key,
        logicalRequest: { window_days: input.windowDays, min_samples: input.minSamples, rate_pct: input.ratePct, repeat_per_day: input.repeatPerDay, expected_version: input.expectedVersion, reason: input.reason },
        replay: this.#replay(known),
      },
      async (context) => {
        const rights = await this.#rightsLocked(context, known);
        if (!rights.isSystem) throw new AppError('ADMIN_FORBIDDEN');
        const before = await this.settings.lock(context);
        if (before.version !== input.expectedVersion) throw new AppError('VERSION_CONFLICT');
        await this.settings.update(context, input, known.userId);
        const after = await this.settings.read(context);
        await this.audit.append(context, {
          requestId: meta.requestId, actorType: 'SYSTEM', actorId: known.userId, action: OPERATIONS.settings, resourceType: 'ops_anomaly_settings', resourceId: 'singleton', resourceVersion: after.version, outcome: 'SUCCESS',
          metadata: { from: { window_days: before.windowDays, min_samples: before.minSamples, rate_pct: before.ratePct, repeat_per_day: before.repeatPerDay }, to: { window_days: after.windowDays, min_samples: after.minSamples, rate_pct: after.ratePct, repeat_per_day: after.repeatPerDay }, reason: input.reason },
        });
        return { status: 200, replayGuard: { actor_user_id: known.userId }, payload: this.#settingsView(after, rights) };
      },
    );
  }

  async #rightsLocked(context: TransactionContext, known: SessionLookup): Promise<AdminRights> {
    await setBusinessLockTimeout(context, this.#lockTimeoutMs);
    const rights = await this.rightsReader.read(context, known);
    rights.require(PERMISSION_REPORT_READ);
    return rights;
  }

  #replay(known: SessionLookup) {
    return {
      kind: 'sensitive' as const,
      authorize: async (context: TransactionContext, guard: JsonObject) => {
        if (guard.actor_user_id !== known.userId) throw new AppError('ADMIN_SESSION_INVALID');
        await this.#rightsLocked(context, known);
        return true as const;
      },
    };
  }
}

export { CASE_STATUSES };
