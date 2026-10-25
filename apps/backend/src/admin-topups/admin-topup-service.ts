import { Inject, Injectable } from '@nestjs/common';
import { SessionLookup } from '../admin-auth/admin-session-repository';
import { PROVISIONING_SCOPE_TYPE } from '../admin-provisioning/admin-provisioning-constants';
import { setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { AdminSystemActor, LockedActor } from '../admin-provisioning/admin-system-actor';
import { AuditWriter } from '../audit/audit-writer';
import { AppError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DriverRepository } from '../driver/driver-repository';
import { FinanceAccessParticipant } from '../finance-access/finance-access-participant';
import { FinancePermissionKey, FINANCE_PERMISSION_READ, FINANCE_PERMISSION_TOPUP_RECORD } from '../finance-access/finance-access-constants';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { OutboxWriter } from '../outbox/outbox-writer';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { AdminTopupRow, TopupRequestRepository } from '../wallet/topup-request-repository';
import { SystemBankAccountRepository } from '../wallet/system-bank-account-repository';
import { TopupPostingService } from '../wallet/topup-posting-service';
import { encodeCursor } from '../wallet-topup/topup-request-validation';
import { AdminTopupListQuery, ConfirmBody, RejectBody } from './admin-topup-validation';

type Command = 'confirm' | 'reject';
const OPERATION: Readonly<Record<Command, string>> = { confirm: 'admin.wallet_topup.confirm.v1', reject: 'admin.wallet_topup.reject.v1' };
const RESOURCE = 'wallet_topup_request';
const EVENT_CHANGED = 'wallet.topup_request.changed.v1';
/** A bank time later than the database clock by more than this is a typing error, not a payment. */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * Administration of the Shipper top-up requests (M04-B2.2b): list and read them (`wallet.read`), reject a PENDING one or CONFIRM the money received
 * (`wallet.topup.record`). SYSTEM has both rights implicitly; an ADMIN only the ones SYSTEM granted, asked again UNDER the locks of every call
 * (FinanceAccessParticipant, FOR SHARE on the right's row, after the fresh database clock). Nothing here trusts a cookie alone, a hidden button or an app permission.
 *
 * A confirmation is ONE transaction opened by the idempotency executor, in the lock order of ADR-004 3.1: idempotency record -> the administrator (user,
 * membership, factor, session) -> the finance right FOR SHARE -> the Shipper root (drivers FOR UPDATE) -> the wallet FOR UPDATE -> the request FOR UPDATE (state, version, owner and wallet read again)
 * -> the receiving account FOR SHARE -> bank record (IN) -> topup -> ledger credit -> wallet balance -> request CONFIRMED -> audit -> outbox ->
 * the executor's record -> COMMIT. The amount credited is the ACTUAL amount the administrator recorded from the statement; the amount asked for is kept. Any
 * refusal, any failure of any step and a bank transaction recorded before (by anyone, any key, any wallet) roll the WHOLE transaction back: no row of the
 * bank, the topup, the ledger, the wallet or the request is left. A replay of the same key answers only after the administrator, the session and the right were
 * checked again, and never writes. The Shipper is not activated and no other ledger kind is touched.
 */
@Injectable()
export class AdminTopupService {
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actor: AdminSystemActor,
    private readonly access: FinanceAccessParticipant,
    private readonly drivers: DriverRepository,
    private readonly requests: TopupRequestRepository,
    private readonly posting: TopupPostingService,
    private readonly accounts: SystemBankAccountRepository,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
  }

  async list(sessionToken: string | undefined, query: AdminTopupListQuery): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      await this.#authorize(context, known, 'read', FINANCE_PERMISSION_READ);
      const rows = await this.requests.listForAdmin(context, { state: query.state, limit: query.limit + 1, after: query.after });
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      const reported = await this.requests.reportedAt(context, page.map((r) => r.requestId));
      return { items: page.map((r) => ({ ...view(r), reported_at: reported.has(r.requestId) ? iso(reported.get(r.requestId) as number) : null })), next_cursor: rows.length > query.limit && last !== undefined ? encodeCursor(last.createdAtMs, last.requestId) : null };
    });
  }

  /**
   * The accounts a confirmation can name (read-only projection for the record right, SYSTEM implicit): identifier, bank code, the number MASKED to its last
   * four digits and whether it receives now. The holder and the full number never leave the SYSTEM-only account routes. Authorized under the locks like every call.
   */
  async receivingAccounts(sessionToken: string | undefined): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      await this.#authorize(context, known, 'read', FINANCE_PERMISSION_TOPUP_RECORD);
      const rows = await this.accounts.list(context);
      return { accounts: rows.map((row) => ({ account_id: row.accountId, bank_id: row.bankId, account_number_masked: `****${row.accountNumber.slice(-4)}`, can_receive: row.canReceive })) };
    });
  }

  async detail(sessionToken: string | undefined, requestId: string): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      await this.#authorize(context, known, 'read', FINANCE_PERMISSION_READ);
      const row = await this.requests.findForAdmin(context, requestId);
      if (row === undefined) {
        throw new AppError('TOPUP_REQUEST_NOT_FOUND');
      }
      const reported = (await this.requests.reportedAt(context, [row.requestId])).get(row.requestId);
      return { ...view(row), reported_at: reported === undefined ? null : iso(reported) };
    });
  }

  reject(sessionToken: string | undefined, csrfHeader: unknown, requestId: string, body: RejectBody, key: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    return this.#command('reject', sessionToken, csrfHeader, requestId, { request_id: requestId, expected_version: body.expectedVersion, reason_code: body.reasonCode }, key, meta, async (context, locked, driverClosed, row) => {
      void driverClosed;
      const after = await this.#resolve(context, row, body.expectedVersion, 'REJECTED', locked);
      await this.#record(context, locked, meta.requestId, OPERATION.reject, after, { reason_code: body.reasonCode });
      return after;
    });
  }

  confirm(sessionToken: string | undefined, csrfHeader: unknown, requestId: string, body: ConfirmBody, key: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    const logical = {
      request_id: requestId,
      expected_version: body.expectedVersion,
      actual_amount_vnd: body.actualAmountVnd,
      bank_id: body.bankId,
      system_owned_account_id: body.systemAccountId,
      canonical_transaction_id: body.canonicalTransactionId,
      received_at: body.receivedAtIso,
    };
    return this.#command('confirm', sessionToken, csrfHeader, requestId, logical, key, meta, async (context, locked, driverClosed, row, nowMs) => {
      if (driverClosed) {
        // No money is credited to a closed profile; the request is dealt with (rejected) instead.
        throw new AppError('DRIVER_STATE_CONFLICT');
      }
      if (body.receivedAtMs > nowMs + FUTURE_TOLERANCE_MS) {
        throw new AppError('ADMIN_INPUT_INVALID');
      }
      await this.posting.creditTopup(context, {
        walletId: row.walletId,
        driverId: row.driverId,
        requestId: row.requestId,
        bankId: body.bankId,
        systemAccountId: body.systemAccountId,
        canonicalTransactionId: body.canonicalTransactionId,
        actualAmountVnd: BigInt(body.actualAmountVnd),
        receivedAtIso: body.receivedAtIso,
        confirmedByUserId: locked.known.userId,
      });
      const after = await this.#resolve(context, row, body.expectedVersion, 'CONFIRMED', locked);
      await this.#record(context, locked, meta.requestId, OPERATION.confirm, after, { requested_amount_vnd: Number(row.amountRequestedVnd), actual_amount_vnd: body.actualAmountVnd });
      return after;
    });
  }

  /** The common shell of a write; `apply` returns the request as it is after the change. */
  #command(
    command: Command,
    sessionToken: string | undefined,
    csrfHeader: unknown,
    requestId: string,
    logicalRequest: JsonObject,
    idempotencyKey: string | readonly string[] | undefined,
    meta: { requestId: string },
    apply: (context: TransactionContext, locked: LockedActor, driverClosed: boolean, row: AdminTopupRow, nowMs: number) => Promise<AdminTopupRow | { requestId: string }>,
  ): Promise<IdempotentOutcome> {
    void meta;
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
              await this.#authorize(context, known, 'read', FINANCE_PERMISSION_TOPUP_RECORD);
              return true;
            },
          },
        },
        async (context) => {
          const { locked, nowMs } = await this.#authorize(context, known, 'read', FINANCE_PERMISSION_TOPUP_RECORD);
          // Discovery only: which Shipper to lock first. Every decision below is made again under the locks.
          const found = await this.requests.findById(context, requestId);
          if (found === undefined) {
            throw new AppError('TOPUP_REQUEST_NOT_FOUND');
          }
          const driver = await this.drivers.lockById(context, found.driverId);
          if (driver === undefined) {
            throw new AppError('DRIVER_NOT_FOUND');
          }
          // ADR-004 3.1: Shipper root -> WALLET root -> topup source (the request). Nothing below is decided before the request is read again.
          if (!(await this.posting.lockWalletOf(context, found.walletId, found.driverId))) {
            throw new AppError('TOPUP_REQUEST_NOT_FOUND');
          }
          const current = await this.requests.lockById(context, requestId);
          if (current === undefined || current.driverId !== found.driverId || current.walletId !== found.walletId) {
            throw new AppError('TOPUP_REQUEST_NOT_FOUND');
          }
          if (current.state !== 'PENDING') {
            throw new AppError('TOPUP_REQUEST_STATE_CONFLICT');
          }
          if (current.version !== JSON.parse(JSON.stringify(logicalRequest)).expected_version) {
            throw new AppError('VERSION_CONFLICT');
          }
          const row: AdminTopupRow = { ...current, actualAmountVnd: null, receivedAtMs: null };
          await apply(context, locked, driver.status === 'CLOSED', row, nowMs);
          const after = await this.requests.findForAdmin(context, requestId);
          if (after === undefined) {
            throw new AppError('TOPUP_REQUEST_NOT_FOUND');
          }
          return { status: 200, replayGuard: { actor_user_id: known.userId }, payload: view(after) };
        },
      ),
    );
  }

  async #resolve(context: TransactionContext, row: AdminTopupRow, expectedVersion: number, state: 'CONFIRMED' | 'REJECTED', locked: LockedActor): Promise<AdminTopupRow> {
    const resolved = await this.requests.resolve(context, row.requestId, expectedVersion, state, locked.known.userId);
    if (resolved === undefined) {
      // Locked and checked just above: unreachable. Never guess; the whole transaction rolls back.
      throw new AppError('TOPUP_REQUEST_STATE_CONFLICT');
    }
    return { ...resolved, actualAmountVnd: null, receivedAtMs: null };
  }

  async #record(context: TransactionContext, locked: LockedActor, requestId: string, action: string, row: AdminTopupRow, detail: Readonly<Record<string, string | number>>): Promise<void> {
    await this.audit.append(context, {
      requestId,
      actorType: locked.checked.membership.adminRole,
      actorId: locked.known.userId,
      action,
      resourceType: RESOURCE,
      resourceId: row.requestId,
      resourceVersion: row.version,
      outcome: 'SUCCESS',
      metadata: { state: row.state, ...detail },
    });
    // The event carries the identifier, the state and the version only (the same shape the Shipper's own commands publish).
    await this.outbox.append(context, {
      eventType: EVENT_CHANGED,
      eventSchemaVersion: 1,
      resourceType: RESOURCE,
      resourceId: row.requestId,
      resourceVersion: row.version,
      payload: { request_id: row.requestId, state: row.state, version: row.version },
    });
  }

  /** The administrator under the module's locks, the database clock read after them, then the finance right asked again (FOR SHARE). */
  async #authorize(context: TransactionContext, known: SessionLookup, mode: 'read' | 'write', permission: FinancePermissionKey): Promise<{ locked: LockedActor; nowMs: number }> {
    const locked = await this.actor.lock(context, known, { user: mode, factor: 'read' });
    const nowMs = await freshClockMs(context);
    await this.access.require(context, locked, permission, nowMs);
    return { locked, nowMs };
  }
}

function view(row: AdminTopupRow): JsonObject {
  return {
    request_id: row.requestId,
    driver_id: row.driverId,
    amount_requested_vnd: Number(row.amountRequestedVnd),
    actual_amount_vnd: row.actualAmountVnd === null ? null : Number(row.actualAmountVnd),
    state: row.state,
    version: row.version,
    created_at: iso(row.createdAtMs),
    resolved_at: row.resolvedAtMs === null ? null : iso(row.resolvedAtMs),
    received_at: row.receivedAtMs === null ? null : iso(row.receivedAtMs),
  };
}
