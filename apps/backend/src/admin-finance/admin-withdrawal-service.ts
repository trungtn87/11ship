import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { SessionLookup } from '../admin-auth/admin-session-repository';
import { PROVISIONING_SCOPE_TYPE } from '../admin-provisioning/admin-provisioning-constants';
import { setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { AdminSystemActor, LockedActor } from '../admin-provisioning/admin-system-actor';
import { AuditWriter } from '../audit/audit-writer';
import { AppError, TechnicalError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DriverAdminQueryRepository } from '../driver/driver-admin-query-repository';
import { DriverRepository } from '../driver/driver-repository';
import {
  FinancePermissionKey,
  FINANCE_PERMISSION_READ,
  FINANCE_PERMISSION_WITHDRAWAL_CONFIRM,
  FINANCE_PERMISSION_WITHDRAWAL_PROCESS,
  FINANCE_PERMISSION_WITHDRAWAL_RECONCILE,
} from '../finance-access/finance-access-constants';
import { FinanceAccessParticipant } from '../finance-access/finance-access-participant';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { OutboxWriter } from '../outbox/outbox-writer';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { driverIdentityView } from './admin-finance-views';
import { maskAccountNumber, maskName } from '../wallet/finance-masking';
import { SystemBankAccountRepository } from '../wallet/system-bank-account-repository';
import { WithdrawalMoneyService } from '../wallet/withdrawal-money-service';
import { WithdrawalEventKind, WithdrawalRepository, WithdrawalRow } from '../wallet/withdrawal-repository';
import { encodeCursor } from '../wallet-topup/topup-request-validation';
import { safeJsonNumber } from '../driver-wallet/driver-wallet-validation';
import { requestCodeOf } from '../driver-wallet/driver-withdrawal-service';
import { AdminWithdrawalListQuery, MarkPaidBody, OutgoingEvidence, ReconcileBody, ReportBody, VersionBody } from './admin-withdrawal-validation';

type Command = 'start' | 'paid' | 'report' | 'reconcile';
const OPERATION: Readonly<Record<Command, string>> = {
  start: 'admin.wallet_withdrawal.start_processing.v1',
  paid: 'admin.wallet_withdrawal.mark_paid.v1',
  report: 'admin.wallet_withdrawal.report_reconciliation.v1',
  reconcile: 'admin.wallet_withdrawal.reconcile.v1',
};
const RESOURCE = 'wallet_withdrawal';
const EVENT_CHANGED = 'wallet.withdrawal.changed.v1';
/** A bank time later than the database clock by more than this is a typing error, not a transfer. */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const iso = (ms: number): string => new Date(ms).toISOString();

interface Rights {
  readonly read: boolean;
  readonly process: boolean;
  readonly confirm: boolean;
  readonly reconcile: boolean;
}

/**
 * Administration of the Shipper withdrawals (M04-C): list and read them (`wallet.read`), claim a PENDING one for the manual transfer (`wallet.withdrawal.process`),
 * record that transfer as PAID (`wallet.withdrawal.confirm`, only the administrator who claimed it) and report or settle an unknown outcome
 * (`wallet.withdrawal.reconcile`). SYSTEM has every right implicitly; an ADMIN only the ones SYSTEM granted, asked again UNDER the locks of every call and again on a
 * replay. The system NEVER moves money at a bank: PAID only RECORDS what an administrator did by hand, with the outgoing bank transaction identity (unique across the
 * whole system, in both directions) as evidence.
 *
 * Every write is ONE transaction opened by the idempotency executor, in the lock order of ADR-004 3.1: idempotency record -> the administrator (user, membership, factor,
 * session) -> the finance right(s) FOR SHARE -> the Shipper root (drivers FOR UPDATE) -> the wallet FOR UPDATE -> the withdrawal FOR UPDATE (state, version and owner read
 * again) -> bank record (OUT) -> hold / ledger / balance -> withdrawal state -> event -> audit -> outbox -> the executor's record. Anything unknown (a lost reply, a different
 * amount, a different destination) goes to RECONCILIATION with the hold still ACTIVE: nothing is ever sent twice or released on a guess.
 */
@Injectable()
export class AdminWithdrawalService {
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actor: AdminSystemActor,
    private readonly access: FinanceAccessParticipant,
    private readonly drivers: DriverRepository,
    private readonly driverQueries: DriverAdminQueryRepository,
    private readonly withdrawals: WithdrawalRepository,
    private readonly money: WithdrawalMoneyService,
    private readonly accounts: SystemBankAccountRepository,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
  }

  async list(sessionToken: string | undefined, query: AdminWithdrawalListQuery): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      await this.#authorize(context, known, FINANCE_PERMISSION_READ);
      const rows = await this.withdrawals.listForAdmin(context, { state: query.state, limit: query.limit + 1, after: query.after });
      const page = rows.slice(0, query.limit);
      const identities = await this.driverQueries.identities(context, page.map((row) => row.driverId));
      const last = page[page.length - 1];
      return {
        items: page.map((row) => summary(row, identities.get(row.driverId))),
        next_cursor: rows.length > query.limit && last !== undefined ? encodeCursor(last.createdAtMs, last.withdrawalId) : null,
      };
    });
  }

  async detail(sessionToken: string | undefined, withdrawalId: string): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const { locked } = await this.#authorize(context, known, FINANCE_PERMISSION_READ);
      return this.#detailView(context, locked, withdrawalId);
    });
  }

  /** The accounts OF THE SYSTEM a transfer can be recorded from (masked), for the administrators who record transfers. */
  async sourceAccounts(sessionToken: string | undefined): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const { locked, nowMs } = await this.#authorize(context, known, FINANCE_PERMISSION_READ);
      const rights = await this.#rights(context, locked, nowMs);
      if (!rights.process && !rights.confirm && !rights.reconcile) {
        throw new AppError('ADMIN_FORBIDDEN');
      }
      const rows = await this.accounts.list(context);
      return { accounts: rows.map((row) => ({ account_id: row.accountId, bank_id: row.bankId, account_number_masked: maskAccountNumber(row.accountNumber) })) };
    });
  }

  startProcessing(sessionToken: string | undefined, csrf: unknown, withdrawalId: string, body: VersionBody, key: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    return this.#command('start', sessionToken, csrf, withdrawalId, { withdrawal_id: withdrawalId, expected_version: body.expectedVersion }, key, meta, [FINANCE_PERMISSION_WITHDRAWAL_PROCESS], async (ctx) => {
      if (ctx.current.state !== 'PENDING') {
        throw new AppError('WITHDRAWAL_STATE_CONFLICT');
      }
      this.#expectVersion(ctx.current, body.expectedVersion);
      // The destination is the snapshot of the moment of the request; a Shipper who changed the bank account since must request again (cancel + new request).
      if (!(await this.withdrawals.bankSnapshotIsCurrent(ctx.context, ctx.current.withdrawalId))) {
        throw new AppError('BANK_SNAPSHOT_STALE');
      }
      const after = await this.withdrawals.startProcessing(ctx.context, ctx.current.withdrawalId, body.expectedVersion, ctx.locked.known.userId, randomUUID());
      return { after: this.#changed(after), event: { kind: 'PROCESSING_STARTED', from: 'PENDING', reason: null }, detail: {} };
    });
  }

  markPaid(sessionToken: string | undefined, csrf: unknown, withdrawalId: string, body: MarkPaidBody, key: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    const e = body.evidence;
    const logical = { withdrawal_id: withdrawalId, expected_version: body.expectedVersion, destination_checked: true, ...evidenceJson(e) };
    return this.#command('paid', sessionToken, csrf, withdrawalId, logical, key, meta, [FINANCE_PERMISSION_WITHDRAWAL_CONFIRM], async (ctx) => {
      if (ctx.current.state !== 'PROCESSING') {
        throw new AppError('WITHDRAWAL_STATE_CONFLICT');
      }
      this.#expectVersion(ctx.current, body.expectedVersion);
      if (ctx.current.processingOwnerUserId !== ctx.locked.known.userId) {
        throw new AppError('WITHDRAWAL_NOT_OWNER');
      }
      this.#assertNotFuture(e, ctx.nowMs);
      // A different amount is not a PAID withdrawal: it is reported for reconciliation (the request is never rewritten to match what was sent).
      if (BigInt(e.actualAmountVnd) !== ctx.current.amountVnd) {
        throw new AppError('WITHDRAWAL_EVIDENCE_MISMATCH');
      }
      const recordId = await this.#recordOutgoing(ctx.context, ctx.current, e);
      await this.money.capture(ctx.context, ctx.current);
      const after = await this.withdrawals.markPaid(ctx.context, ctx.current.withdrawalId, 'PROCESSING', body.expectedVersion, ctx.locked.known.userId, recordId, e.paidAtIso);
      return { after: this.#changed(after), event: { kind: 'PAID', from: 'PROCESSING', reason: null }, detail: { amount_vnd: safeJsonNumber(ctx.current.amountVnd) } };
    });
  }

  reportReconciliation(sessionToken: string | undefined, csrf: unknown, withdrawalId: string, body: ReportBody, key: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    const logical = { withdrawal_id: withdrawalId, expected_version: body.expectedVersion, reason_code: body.reason, evidence: body.evidence === undefined ? null : evidenceJson(body.evidence) };
    // The owner (process right) or a reconciler may report; the right to transfer again is never part of it.
    return this.#command('report', sessionToken, csrf, withdrawalId, logical, key, meta, [FINANCE_PERMISSION_WITHDRAWAL_PROCESS, FINANCE_PERMISSION_WITHDRAWAL_RECONCILE], async (ctx) => {
      if (ctx.current.state !== 'PROCESSING') {
        throw new AppError('WITHDRAWAL_STATE_CONFLICT');
      }
      this.#expectVersion(ctx.current, body.expectedVersion);
      const mayAsOwner = ctx.rights.process && ctx.current.processingOwnerUserId === ctx.locked.known.userId;
      if (!mayAsOwner && !ctx.rights.reconcile) {
        throw new AppError('ADMIN_FORBIDDEN');
      }
      let recordId: string | null = null;
      if (body.evidence !== undefined) {
        this.#assertNotFuture(body.evidence, ctx.nowMs);
        recordId = await this.#recordOutgoing(ctx.context, ctx.current, body.evidence);
      }
      const after = await this.withdrawals.reportReconciliation(ctx.context, ctx.current.withdrawalId, body.expectedVersion, body.reason, ctx.locked.known.userId, recordId);
      return { after: this.#changed(after), event: { kind: 'RECONCILIATION_REPORTED', from: 'PROCESSING', reason: body.reason }, detail: { reason_code: body.reason } };
    });
  }

  reconcile(sessionToken: string | undefined, csrf: unknown, withdrawalId: string, body: ReconcileBody, key: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    const logical = {
      withdrawal_id: withdrawalId,
      expected_version: body.expectedVersion,
      outcome: body.outcome,
      reason_code: body.reasonCode,
      evidence: body.evidence === undefined ? null : evidenceJson(body.evidence),
    };
    return this.#command('reconcile', sessionToken, csrf, withdrawalId, logical, key, meta, [FINANCE_PERMISSION_WITHDRAWAL_RECONCILE], async (ctx): Promise<Applied> => {
      if (ctx.current.state !== 'RECONCILIATION') {
        throw new AppError('WITHDRAWAL_STATE_CONFLICT');
      }
      this.#expectVersion(ctx.current, body.expectedVersion);
      if (body.outcome === 'UNKNOWN') {
        const after = await this.withdrawals.touchReconciliation(ctx.context, ctx.current.withdrawalId, body.expectedVersion, null);
        return { after: this.#changed(after), event: { kind: 'RECONCILIATION_UNKNOWN', from: 'RECONCILIATION', reason: body.reasonCode }, detail: { outcome: 'UNKNOWN' } };
      }
      if (body.outcome === 'CONFIRMED_NOT_SENT_FINAL') {
        // Only when NO outgoing record exists (a record of a transfer that did go out can never be released), and the bank confirmed it was not sent.
        if (ctx.current.bankRecordId !== null || (await this.withdrawals.hasOutgoingRecord(ctx.context, ctx.current.withdrawalId))) {
          throw new AppError('WITHDRAWAL_STATE_CONFLICT');
        }
        await this.money.release(ctx.context, ctx.current);
        const after = await this.withdrawals.resolveNotSent(ctx.context, ctx.current.withdrawalId, body.expectedVersion, ctx.locked.known.userId);
        return { after: this.#changed(after), event: { kind: 'RECONCILED_NOT_SENT', from: 'RECONCILIATION', reason: body.reasonCode }, detail: { outcome: 'CONFIRMED_NOT_SENT_FINAL', amount_vnd: safeJsonNumber(ctx.current.amountVnd) } };
      }
      // CONFIRMED_PAID: the outgoing record must exist (attached earlier, or recorded now from the evidence) and be EXACTLY the amount and the snapshot's transfer.
      let recordId = ctx.current.bankRecordId;
      let amount: bigint;
      let paidAtIso: string;
      if (recordId !== null) {
        const existing = await this.withdrawals.findOutgoingRecord(ctx.context, recordId);
        if (existing === undefined) {
          throw new TechnicalError('internal', 'The attached outgoing record vanished');
        }
        amount = existing.amountVnd;
        paidAtIso = iso(existing.occurredAtMs);
        if (body.evidence !== undefined) {
          throw new AppError('ADMIN_INPUT_INVALID');
        }
      } else {
        if (body.evidence === undefined) {
          throw new AppError('ADMIN_INPUT_INVALID');
        }
        this.#assertNotFuture(body.evidence, ctx.nowMs);
        amount = BigInt(body.evidence.actualAmountVnd);
        paidAtIso = body.evidence.paidAtIso;
        if (amount !== ctx.current.amountVnd) {
          throw new AppError('WITHDRAWAL_EVIDENCE_MISMATCH');
        }
        recordId = await this.#recordOutgoing(ctx.context, ctx.current, body.evidence);
      }
      if (amount !== ctx.current.amountVnd) {
        // The recorded transfer is not the requested amount: no PAID, no release. This stays an open case until the Owner decides how a partial payout is handled.
        throw new AppError('WITHDRAWAL_EVIDENCE_MISMATCH');
      }
      await this.money.capture(ctx.context, ctx.current);
      const after = await this.withdrawals.markPaid(ctx.context, ctx.current.withdrawalId, 'RECONCILIATION', body.expectedVersion, ctx.locked.known.userId, recordId, paidAtIso);
      return { after: this.#changed(after), event: { kind: 'RECONCILED_PAID', from: 'RECONCILIATION', reason: body.reasonCode }, detail: { outcome: 'CONFIRMED_PAID', amount_vnd: safeJsonNumber(ctx.current.amountVnd) } };
    });
  }

  // ---- shell ---------------------------------------------------------------------------------------------------------------------------------------------

  #expectVersion(current: WithdrawalRow, expected: number): void {
    if (current.version !== expected) {
      throw new AppError('VERSION_CONFLICT');
    }
  }

  #assertNotFuture(evidence: OutgoingEvidence, nowMs: number): void {
    if (evidence.paidAtMs > nowMs + FUTURE_TOLERANCE_MS) {
      throw new AppError('ADMIN_INPUT_INVALID');
    }
  }

  #changed(row: WithdrawalRow | undefined): WithdrawalRow {
    if (row === undefined) {
      // Locked and checked just above: unreachable. Never guess; the whole transaction rolls back.
      throw new AppError('WITHDRAWAL_STATE_CONFLICT');
    }
    return row;
  }

  /** Records the outgoing bank transaction once for the whole system; a transaction already recorded by anyone rolls the whole command back. */
  async #recordOutgoing(context: TransactionContext, withdrawal: WithdrawalRow, evidence: OutgoingEvidence): Promise<string> {
    const account = await this.accounts.find(context, evidence.systemAccountId);
    if (account === undefined || account.bankId !== evidence.bankId) {
      throw new AppError('FINANCE_BANK_ACCOUNT_NOT_FOUND');
    }
    const bankRecordId = randomUUID();
    const recorded = await this.withdrawals.insertOutgoingRecord(context, {
      bankRecordId,
      bankId: evidence.bankId,
      systemAccountId: evidence.systemAccountId,
      canonicalTransactionId: evidence.canonicalTransactionId,
      amountVnd: BigInt(evidence.actualAmountVnd),
      occurredAtIso: evidence.paidAtIso,
      withdrawalId: withdrawal.withdrawalId,
    });
    if (!recorded) {
      throw new AppError('BANK_TRANSACTION_ALREADY_RECORDED');
    }
    return bankRecordId;
  }

  #command(
    command: Command,
    sessionToken: string | undefined,
    csrfHeader: unknown,
    withdrawalId: string,
    logicalRequest: JsonObject,
    idempotencyKey: string | readonly string[] | undefined,
    meta: { requestId: string },
    needed: readonly FinancePermissionKey[],
    apply: (ctx: CommandContext) => Promise<Applied>,
  ): Promise<IdempotentOutcome> {
    return this.actor.precheck(sessionToken, { required: true, header: csrfHeader }).then((known) =>
      this.executor.execute(
        {
          scopeType: PROVISIONING_SCOPE_TYPE,
          scopeId: known.userId,
          operationId: OPERATION[command],
          idempotencyKey,
          logicalRequest,
          replay: {
            kind: 'sensitive',
            authorize: async (context, guard) => {
              if (guard.actor_user_id !== known.userId) {
                throw new AppError('ADMIN_SESSION_INVALID');
              }
              await this.#requireAny(context, known, needed);
              return true;
            },
          },
        },
        async (context) => {
          const { locked, nowMs, rights } = await this.#requireAny(context, known, needed);
          // Discovery only: which Shipper to lock first. Every decision below is made again under the locks.
          const found = await this.withdrawals.findById(context, withdrawalId);
          if (found === undefined) {
            throw new AppError('WITHDRAWAL_NOT_FOUND');
          }
          if ((await this.drivers.lockById(context, found.driverId)) === undefined) {
            throw new AppError('DRIVER_NOT_FOUND');
          }
          // ADR-004 3.1: Shipper root -> WALLET root -> the withdrawal (the source row). Nothing below is decided before it is read again.
          await this.money.lockWalletOfDriver(context, found.driverId);
          const current = await this.withdrawals.lockById(context, withdrawalId);
          if (current === undefined || current.driverId !== found.driverId || current.walletId !== found.walletId) {
            throw new AppError('WITHDRAWAL_NOT_FOUND');
          }
          const applied = await apply({ context, locked, nowMs, rights, current });
          await this.#record(context, locked, meta.requestId, OPERATION[command], applied);
          return { status: 200, replayGuard: { actor_user_id: known.userId }, payload: await this.#detailView(context, locked, withdrawalId) };
        },
      ),
    );
  }

  async #record(context: TransactionContext, locked: LockedActor, requestId: string, action: string, applied: Applied): Promise<void> {
    const row = applied.after;
    await this.withdrawals.insertEvent(context, {
      eventId: randomUUID(),
      withdrawalId: row.withdrawalId,
      kind: applied.event.kind,
      fromState: applied.event.from,
      toState: row.state,
      actorUserId: locked.known.userId,
      reasonCode: applied.event.reason,
      version: row.version,
    });
    await this.audit.append(context, {
      requestId,
      actorType: locked.checked.membership.adminRole,
      actorId: locked.known.userId,
      action,
      resourceType: RESOURCE,
      resourceId: row.withdrawalId,
      resourceVersion: row.version,
      outcome: 'SUCCESS',
      // Identifiers, state, amount and a reason CODE only: never the bank, the account number, the holder, the transaction id or a note.
      metadata: { state: row.state, ...applied.detail },
    });
    await this.outbox.append(context, {
      eventType: EVENT_CHANGED,
      eventSchemaVersion: 1,
      resourceType: RESOURCE,
      resourceId: row.withdrawalId,
      resourceVersion: row.version,
      payload: { withdrawal_id: row.withdrawalId, state: row.state, version: row.version },
    });
  }

  async #authorize(context: TransactionContext, known: SessionLookup, permission: FinancePermissionKey): Promise<{ locked: LockedActor; nowMs: number }> {
    const locked = await this.actor.lock(context, known, { user: 'read', factor: 'read' });
    const nowMs = await freshClockMs(context);
    await this.access.require(context, locked, permission, nowMs);
    return { locked, nowMs };
  }

  /** The administrator under the module's locks, the clock after them, then AT LEAST ONE of the needed rights (each asked FOR SHARE). */
  async #requireAny(context: TransactionContext, known: SessionLookup, needed: readonly FinancePermissionKey[]): Promise<{ locked: LockedActor; nowMs: number; rights: Rights }> {
    const locked = await this.actor.lock(context, known, { user: 'read', factor: 'read' });
    const nowMs = await freshClockMs(context);
    const rights = await this.#rights(context, locked, nowMs);
    const held: Readonly<Record<string, boolean>> = { [FINANCE_PERMISSION_WITHDRAWAL_PROCESS]: rights.process, [FINANCE_PERMISSION_WITHDRAWAL_CONFIRM]: rights.confirm, [FINANCE_PERMISSION_WITHDRAWAL_RECONCILE]: rights.reconcile };
    if (!needed.some((key) => held[key] === true)) {
      throw new AppError('ADMIN_FORBIDDEN');
    }
    return { locked, nowMs, rights };
  }

  async #rights(context: TransactionContext, locked: LockedActor, nowMs: number): Promise<Rights> {
    const may = async (key: FinancePermissionKey): Promise<boolean> => {
      try {
        await this.access.require(context, locked, key, nowMs);
        return true;
      } catch (error) {
        if (error instanceof AppError && error.code === 'ADMIN_FORBIDDEN') {
          return false;
        }
        throw error;
      }
    };
    return {
      read: await may(FINANCE_PERMISSION_READ),
      process: await may(FINANCE_PERMISSION_WITHDRAWAL_PROCESS),
      confirm: await may(FINANCE_PERMISSION_WITHDRAWAL_CONFIRM),
      reconcile: await may(FINANCE_PERMISSION_WITHDRAWAL_RECONCILE),
    };
  }

  async #detailView(context: TransactionContext, locked: LockedActor, withdrawalId: string): Promise<JsonObject> {
    const row = await this.withdrawals.findById(context, withdrawalId);
    if (row === undefined) {
      throw new AppError('WITHDRAWAL_NOT_FOUND');
    }
    const nowMs = await freshClockMs(context);
    const rights = await this.#rights(context, locked, nowMs);
    const identities = await this.driverQueries.identities(context, [row.driverId]);
    const events = await this.withdrawals.listEvents(context, withdrawalId);
    const me = locked.known.userId;
    const isOwner = row.processingOwnerUserId === me;
    // The whole destination only while the transfer is the actor's to make or to settle: the owner of a PROCESSING claim, or a reconciler of a RECONCILIATION one.
    const showFull = (row.state === 'PROCESSING' && isOwner && (rights.process || rights.confirm)) || (row.state === 'RECONCILIATION' && (rights.reconcile || (isOwner && rights.process)));
    const outgoing = row.bankRecordId === null ? undefined : await this.withdrawals.findOutgoingRecord(context, row.bankRecordId);
    return {
      ...summary(row, identities.get(row.driverId)),
      destination: showFull
        ? { bank_code: row.bankCode, bank_name: row.bankName, account_number: row.accountNumber, account_holder: row.accountHolder, full: true }
        : { bank_code: row.bankCode, bank_name: row.bankName, account_number_masked: maskAccountNumber(row.accountNumber), account_holder_masked: maskName(row.accountHolder), full: false },
      snapshot_current: row.state === 'PENDING' ? await this.withdrawals.bankSnapshotIsCurrent(context, row.withdrawalId) : null,
      processing: row.processingOwnerUserId === null ? null : { started_at: iso(row.processingStartedAtMs ?? row.createdAtMs), is_owner: isOwner },
      reconciliation: row.reconciliationReason === null ? null : { reason_code: row.reconciliationReason, reported_at: iso(row.reconciliationReportedAtMs ?? row.createdAtMs) },
      outgoing: outgoing === undefined ? null : { bank_id: outgoing.bankId, amount_vnd: safeJsonNumber(outgoing.amountVnd), occurred_at: iso(outgoing.occurredAtMs), matches_amount: outgoing.amountVnd === row.amountVnd },
      paid_at: row.paidAtMs === null ? null : iso(row.paidAtMs),
      outcome: row.outcome,
      events: events.map((event) => ({ kind: event.kind, from_state: event.fromState, to_state: event.toState, reason_code: event.reasonCode, at: iso(event.createdAtMs), by_me: event.actorUserId === me })),
      rights: { can_process: rights.process && row.state === 'PENDING', can_confirm: rights.confirm && row.state === 'PROCESSING' && isOwner, can_report: row.state === 'PROCESSING' && ((rights.process && isOwner) || rights.reconcile), can_reconcile: rights.reconcile && row.state === 'RECONCILIATION' },
    };
  }
}

interface CommandContext {
  readonly context: TransactionContext;
  readonly locked: LockedActor;
  readonly nowMs: number;
  readonly rights: Rights;
  readonly current: WithdrawalRow;
}

interface Applied {
  readonly after: WithdrawalRow;
  readonly event: { readonly kind: WithdrawalEventKind; readonly from: WithdrawalRow['state'] | null; readonly reason: string | null };
  readonly detail: Readonly<Record<string, string | number>>;
}

function evidenceJson(e: OutgoingEvidence): JsonObject {
  return { actual_amount_vnd: e.actualAmountVnd, bank_id: e.bankId, system_owned_account_id: e.systemAccountId, canonical_transaction_id: e.canonicalTransactionId, paid_at: e.paidAtIso };
}

function summary(row: WithdrawalRow, identity: { shipperCode: string; fullName: string; status: string; phone: string } | undefined): JsonObject {
  return {
    withdrawal_id: row.withdrawalId,
    request_code: requestCodeOf(row.withdrawalId),
    driver_id: row.driverId,
    shipper: driverIdentityView(identity),
    amount_vnd: safeJsonNumber(row.amountVnd),
    state: row.state,
    version: row.version,
    created_at: iso(row.createdAtMs),
    resolved_at: row.resolvedAtMs === null ? null : iso(row.resolvedAtMs),
    destination_bank: row.bankName,
    destination_masked: maskAccountNumber(row.accountNumber),
  };
}
