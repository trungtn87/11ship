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
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { SystemBankAccountRepository, SystemBankAccountRow } from '../wallet/system-bank-account-repository';
import { BankAccountBody, ReceivingBody } from './finance-access-validation';

const OPERATION = 'admin.system_bank_account.create.v1';
const RESOURCE = 'system_bank_account';
const EVENT_CREATED = 'system.bank_account.created.v1';
const OPERATION_RECEIVING = 'admin.system_bank_account.receiving.v1';
const EVENT_RECEIVING = 'system.bank_account.receiving_changed.v1';

/**
 * The receiving accounts OF THE SYSTEM (M04-B2.2a/b), SYSTEM only: read the list or one account, add a new one and switch receiving on or off. A new
 * account is ALWAYS created not receiving (can_receive = false); `setReceiving` is the only way to change the flag (versioned, row locked, audited, a
 * no-op change is a conflict). Switching OFF does not touch recorded money; money that arrives for a switched-off account cannot be recorded until
 * SYSTEM switches it on again. There is no command to change or delete an account; the identity (bank, number, holder) never changes, so another account is added instead. The same bank and number twice is one
 * conflict that says nothing else. Number and holder are the SYSTEM's own data, shown only to SYSTEM here; the audit row and the event carry the
 * identifier and the bank code, never the number or the holder.
 */
@Injectable()
export class SystemBankAccountService {
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actor: AdminSystemActor,
    private readonly accounts: SystemBankAccountRepository,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
  }

  async list(sessionToken: string | undefined): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      await this.#lockSystem(context, known, 'read');
      return { accounts: (await this.accounts.list(context)).map(view) };
    });
  }

  async detail(sessionToken: string | undefined, accountId: string): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      await this.#lockSystem(context, known, 'read');
      const row = await this.accounts.find(context, accountId);
      if (row === undefined) {
        throw new AppError('FINANCE_BANK_ACCOUNT_NOT_FOUND');
      }
      return view(row);
    });
  }

  async create(
    sessionToken: string | undefined,
    csrfHeader: unknown,
    body: BankAccountBody,
    idempotencyKey: string | readonly string[] | undefined,
    meta: { requestId: string },
  ): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrfHeader });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE,
        scopeId: known.userId,
        operationId: OPERATION,
        idempotencyKey,
        logicalRequest: { bank_id: body.bankId, account_number: body.accountNumber, account_holder: body.accountHolder },
        replay: {
          kind: 'sensitive',
          authorize: async (context, guard) => {
            if (guard.actor_user_id !== known.userId) {
              throw new AppError('ADMIN_SESSION_INVALID');
            }
            await this.#lockSystem(context, known, 'write');
            return true;
          },
        },
      },
      async (context) => {
        const locked = await this.#lockSystem(context, known, 'write');
        const row = await this.accounts.insertInactive(context, { accountId: randomUUID(), bankId: body.bankId, accountNumber: body.accountNumber, accountHolder: body.accountHolder });
        if (row === undefined) {
          throw new AppError('FINANCE_BANK_ACCOUNT_EXISTS');
        }
        await this.audit.append(context, {
          requestId: meta.requestId,
          actorType: locked.checked.membership.adminRole,
          actorId: known.userId,
          action: OPERATION,
          resourceType: RESOURCE,
          resourceId: row.accountId,
          resourceVersion: row.version,
          outcome: 'SUCCESS',
          metadata: { bank_id: row.bankId, can_receive: false },
        });
        await this.outbox.append(context, {
          eventType: EVENT_CREATED,
          eventSchemaVersion: 1,
          resourceType: RESOURCE,
          resourceId: row.accountId,
          resourceVersion: row.version,
          payload: { account_id: row.accountId, bank_id: row.bankId, can_receive: false, version: row.version },
        });
        return { status: 201, replayGuard: { actor_user_id: known.userId }, payload: view(row) };
      },
    );
  }

  async setReceiving(
    sessionToken: string | undefined,
    csrfHeader: unknown,
    accountId: string,
    body: ReceivingBody,
    idempotencyKey: string | readonly string[] | undefined,
    meta: { requestId: string },
  ): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrfHeader });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE,
        scopeId: known.userId,
        operationId: OPERATION_RECEIVING,
        idempotencyKey,
        logicalRequest: { account_id: accountId, expected_version: body.expectedVersion, can_receive: body.canReceive },
        replay: {
          kind: 'sensitive',
          authorize: async (context, guard) => {
            if (guard.actor_user_id !== known.userId) {
              throw new AppError('ADMIN_SESSION_INVALID');
            }
            await this.#lockSystem(context, known, 'write');
            return true;
          },
        },
      },
      async (context) => {
        const locked = await this.#lockSystem(context, known, 'write');
        const current = await this.accounts.lockForUpdate(context, accountId);
        if (current === undefined) {
          throw new AppError('FINANCE_BANK_ACCOUNT_NOT_FOUND');
        }
        if (current.version !== body.expectedVersion) {
          throw new AppError('FINANCE_VERSION_CONFLICT');
        }
        if (current.canReceive === body.canReceive) {
          throw new AppError('FINANCE_BANK_ACCOUNT_STATE_CONFLICT');
        }
        const row = await this.accounts.setReceiving(context, accountId, body.expectedVersion, body.canReceive);
        if (row === undefined) {
          throw new AppError('FINANCE_VERSION_CONFLICT');
        }
        await this.audit.append(context, {
          requestId: meta.requestId,
          actorType: locked.checked.membership.adminRole,
          actorId: known.userId,
          action: OPERATION_RECEIVING,
          resourceType: RESOURCE,
          resourceId: row.accountId,
          resourceVersion: row.version,
          outcome: 'SUCCESS',
          metadata: { bank_id: row.bankId, can_receive: row.canReceive },
        });
        await this.outbox.append(context, {
          eventType: EVENT_RECEIVING,
          eventSchemaVersion: 1,
          resourceType: RESOURCE,
          resourceId: row.accountId,
          resourceVersion: row.version,
          payload: { account_id: row.accountId, bank_id: row.bankId, can_receive: row.canReceive, version: row.version },
        });
        return { status: 200, replayGuard: { actor_user_id: known.userId }, payload: view(row) };
      },
    );
  }

  async #lockSystem(context: TransactionContext, known: SessionLookup, mode: 'read' | 'write'): Promise<LockedActor> {
    const locked = await this.actor.lock(context, known, { user: mode, factor: 'read' });
    this.actor.assertLive(locked, await freshClockMs(context));
    return locked;
  }
}

function view(row: SystemBankAccountRow): JsonObject {
  return {
    account_id: row.accountId,
    bank_id: row.bankId,
    account_number: row.accountNumber,
    account_holder: row.accountHolder,
    can_receive: row.canReceive,
    version: row.version,
    created_at: new Date(row.createdAtMs).toISOString(),
  };
}
