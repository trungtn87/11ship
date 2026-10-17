import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuditWriter } from '../audit/audit-writer';
import { AuthPrincipal } from '../auth/auth-principal';
import { UserRepository } from '../auth/user-repository';
import { ClientActor, ClientSessionAuthority } from '../client-auth/client-session-authority';
import { AppError, TechnicalError } from '../common/app-errors';
import { DriverRepository, DriverRow } from '../driver/driver-repository';
import { ShipperWalletParametersReader } from '../driver/shipper-wallet-parameters';
import { IdempotencyExecutor, JsonObject } from '../idempotency/idempotency-executor';
import { OutboxWriter } from '../outbox/outbox-writer';
import { isCanonicalUuid } from '../shared/identifiers';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { TopupRequestRepository, TopupRequestRow } from '../wallet/topup-request-repository';
import { WalletService } from '../wallet/wallet-service';
import { encodeCursor, TopupListQuery } from './topup-request-validation';

const SCOPE_TYPE = 'user';
const RESOURCE = 'wallet_topup_request';
const EVENT_CHANGED = 'wallet.topup_request.changed.v1';
const OPERATION = { create: 'wallet.topup_request.create.v1', cancel: 'wallet.topup_request.cancel.v1' } as const;

/**
 * The Shipper's own top-up REQUESTS (M04-B2.1). A request asks for money and never moves any: this service writes nothing to the wallet
 * balance, the ledger, a topup or a bank record. The caller is the authenticated principal only (no driver, wallet or user id in any
 * path, query or body). Each write is ONE transaction opened by the idempotency executor: record -> user row -> CURRENT session row ->
 * driver row FOR UPDATE -> (wallet) -> request -> audit -> outbox -> the executor's record, in the lock order of ADR-004 3.1.
 * Reads take only shared locks on the user and session, write nothing and never create a wallet.
 */
@Injectable()
export class TopupRequestService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly authority: ClientSessionAuthority,
    private readonly users: UserRepository,
    private readonly drivers: DriverRepository,
    private readonly wallets: WalletService,
    private readonly requests: TopupRequestRepository,
    private readonly limits: ShipperWalletParametersReader,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  /** The receiving accounts the system accepts money on. Empty until a SYSTEM-only package configures a real one. */
  async receivingAccounts(principal: AuthPrincipal): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      await this.#reader(context, principal);
      const accounts = await this.requests.listReceivingAccounts(context);
      return { accounts: accounts.map((account) => ({ bank_id: account.bankId, account_number: account.accountNumber, account_holder: account.accountHolder })) };
    });
  }

  async list(principal: AuthPrincipal, query: TopupListQuery): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const driver = await this.#reader(context, principal);
      const wallet = await this.wallets.readWallet(context, driver.driverId);
      if (!wallet.provisioned) {
        return { items: [], next_cursor: null };
      }
      const rows = await this.requests.listForWallet(context, wallet.walletId, { state: query.state, limit: query.limit + 1, after: query.after });
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      return {
        items: page.map(view),
        next_cursor: rows.length > query.limit && last !== undefined ? encodeCursor(last.createdAtMs, last.requestId) : null,
      };
    });
  }

  async read(principal: AuthPrincipal, requestId: string): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const driver = await this.#reader(context, principal);
      const row = await this.requests.findOwned(context, requestId, driver.driverId);
      if (row === undefined) {
        throw new AppError('TOPUP_REQUEST_NOT_FOUND');
      }
      return view(row);
    });
  }

  async create(principal: AuthPrincipal, amountVnd: number, key: string | readonly string[] | undefined, requestId: string): Promise<JsonObject> {
    const outcome = await this.executor.execute(
      {
        scopeType: SCOPE_TYPE,
        scopeId: principal.userId,
        operationId: OPERATION.create,
        idempotencyKey: key,
        logicalRequest: { amount_vnd: amountVnd },
        replay: this.#replay(principal),
      },
      async (context) => {
        const { actor, driver } = await this.#writer(context, principal);
        // The minimum is read from the database at this moment; a request made before a change keeps the amount it was made with.
        const limits = await this.limits.limits(context);
        if (amountVnd < limits.topupMinVnd) {
          throw new AppError('TOPUP_AMOUNT_BELOW_MINIMUM');
        }
        // A request is only taken when there is a real account to pay to: otherwise the Shipper could believe an address exists.
        if ((await this.requests.listReceivingAccounts(context)).length === 0) {
          throw new AppError('TOPUP_RECEIVING_ACCOUNT_NOT_CONFIGURED');
        }
        const { wallet } = await this.wallets.ensureZeroWallet(context, driver.driverId);
        const row = await this.requests.insertPending(context, {
          requestId: randomUUID(),
          walletId: wallet.walletId,
          driverId: driver.driverId,
          amountVnd: BigInt(amountVnd),
          createdByUserId: actor.userId,
        });
        await this.#record(context, actor, requestId, OPERATION.create, 'created', row);
        return { status: 201, replayGuard: { user_id: actor.userId }, payload: view(row) };
      },
    );
    return outcome.payload as JsonObject;
  }

  async cancel(principal: AuthPrincipal, topupRequestId: string, expectedVersion: number, key: string | readonly string[] | undefined, requestId: string): Promise<JsonObject> {
    const outcome = await this.executor.execute(
      {
        scopeType: SCOPE_TYPE,
        scopeId: principal.userId,
        operationId: OPERATION.cancel,
        idempotencyKey: key,
        logicalRequest: { request_id: topupRequestId, expected_version: expectedVersion },
        replay: this.#replay(principal),
      },
      async (context) => {
        const { actor, driver } = await this.#writer(context, principal);
        const current = await this.requests.lockOwned(context, topupRequestId, driver.driverId);
        if (current === undefined) {
          throw new AppError('TOPUP_REQUEST_NOT_FOUND');
        }
        if (current.state !== 'PENDING') {
          throw new AppError('TOPUP_REQUEST_STATE_CONFLICT');
        }
        if (current.version !== expectedVersion) {
          throw new AppError('VERSION_CONFLICT');
        }
        const cancelled = await this.requests.cancelPending(context, topupRequestId, expectedVersion, actor.userId);
        if (cancelled === undefined) {
          // The row was locked and checked just above, so this is unreachable; never guess, roll the transaction back.
          throw new TechnicalError('internal', 'Top-up request changed under its lock');
        }
        await this.#record(context, actor, requestId, OPERATION.cancel, 'cancelled', cancelled);
        return { status: 200, replayGuard: { user_id: actor.userId }, payload: view(cancelled) };
      },
    );
    return outcome.payload as JsonObject;
  }

  /** A replay answers only after the CURRENT session, role and profile are authorized again under the same locks. */
  #replay(principal: AuthPrincipal) {
    return {
      kind: 'sensitive' as const,
      authorize: async (context: TransactionContext, guard: JsonObject): Promise<true> => {
        if (!isCanonicalUuid(guard.user_id) || guard.user_id !== principal.userId) {
          throw new TechnicalError('internal', 'Invalid replay guard');
        }
        await this.#writer(context, principal);
        return true;
      },
    };
  }

  /** Reader: shared locks on the user and session; the Shipper profile is read, not locked. */
  async #reader(context: TransactionContext, principal: AuthPrincipal): Promise<DriverRow> {
    const actor = await this.authority.lock(context, principal, 'share');
    await this.#assertShipDriver(context, actor);
    const driver = await this.drivers.findByUserId(context, actor.userId);
    return assertUsable(driver);
  }

  /** Writer: user row, CURRENT session row, then the driver row FOR UPDATE (the guard root of everything money-related). */
  async #writer(context: TransactionContext, principal: AuthPrincipal): Promise<{ actor: ClientActor; driver: DriverRow }> {
    const actor = await this.authority.lock(context, principal, 'update');
    await this.#assertShipDriver(context, actor);
    const driver = assertUsable(await this.drivers.lockByUserId(context, actor.userId));
    return { actor, driver };
  }

  /** The 11Ship app, the DRIVER hat on the locked session AND the DRIVER role still held now (read under the user lock already taken). */
  async #assertShipDriver(context: TransactionContext, actor: ClientActor): Promise<void> {
    assertShipDriverContext(actor);
    if (!(await this.users.hasRole(context, actor.userId, 'DRIVER'))) {
      throw new AppError('ROLE_NOT_AVAILABLE');
    }
  }

  async #record(context: TransactionContext, actor: ClientActor, requestId: string, action: string, change: string, row: TopupRequestRow): Promise<void> {
    await this.audit.append(context, {
      requestId,
      actorType: 'USER',
      actorId: actor.userId,
      action,
      resourceType: RESOURCE,
      resourceId: row.requestId,
      resourceVersion: row.version,
      outcome: 'SUCCESS',
      metadata: { change, state: row.state },
    });
    // The event carries the identifier, the state and the version only: no amount owner, bank, phone, note or picture.
    await this.outbox.append(context, {
      eventType: EVENT_CHANGED,
      eventSchemaVersion: 1,
      resourceType: RESOURCE,
      resourceId: row.requestId,
      resourceVersion: row.version,
      payload: { request_id: row.requestId, state: row.state, version: row.version },
    });
  }
}

/** The caller must wear the Shipper hat of the 11Ship app: app SHIP and the active role DRIVER on the locked session. */
function assertShipDriverContext(actor: ClientActor): void {
  if (actor.app !== 'SHIP' || actor.storedActiveRole !== 'DRIVER') {
    throw new AppError('ROLE_NOT_AVAILABLE');
  }
}

/** A Shipper profile must exist and not be CLOSED. PENDING is allowed: the first top-up is what lets the profile be activated. */
function assertUsable(driver: DriverRow | undefined): DriverRow {
  if (driver === undefined) {
    throw new AppError('DRIVER_NOT_FOUND');
  }
  if (driver.status === 'CLOSED') {
    throw new AppError('DRIVER_STATE_CONFLICT');
  }
  return driver;
}

function view(row: TopupRequestRow): JsonObject {
  return {
    request_id: row.requestId,
    amount_requested_vnd: Number(row.amountRequestedVnd),
    state: row.state,
    version: row.version,
    created_at: new Date(row.createdAtMs).toISOString(),
    resolved_at: row.resolvedAtMs === null ? null : new Date(row.resolvedAtMs).toISOString(),
  };
}
