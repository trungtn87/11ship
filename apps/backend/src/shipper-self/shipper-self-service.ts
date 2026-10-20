import { WalletReadRepository } from '../wallet/wallet-read-repository';
import { Injectable } from '@nestjs/common';
import { AuditWriter } from '../audit/audit-writer';
import { AuthPrincipal } from '../auth/auth-principal';
import { ClientSessionAuthority } from '../client-auth/client-session-authority';
import { AppError, TechnicalError } from '../common/app-errors';
import { DriverBankRepository } from '../driver/driver-bank-repository';
import { DriverEventRepository } from '../driver/driver-event-repository';
import { DriverPatch, DriverRepository, DriverRow, NOW } from '../driver/driver-repository';
import { holderMatchesName, SHIPPER_BANKS } from '../driver/shipper-banks';
import { ShipperWalletParametersReader } from '../driver/shipper-wallet-parameters';
import { IdempotencyExecutor, JsonObject } from '../idempotency/idempotency-executor';
import { OutboxWriter } from '../outbox/outbox-writer';
import { isCanonicalUuid } from '../shared/identifiers';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { AcceptingInput, BankUpdateInput, ClosureRequestInput, ProfileUpdateInput, VersionOnlyInput } from './shipper-self-validation';
import { ShipperViewBuilder } from '../driver/shipper-view';

const SCOPE_TYPE = 'user';
const RESOURCE = 'driver';
const EVENT_STATE_CHANGED = 'driver.state_changed.v1';

type Command = 'profile' | 'bank' | 'submit' | 'accepting' | 'closure_request' | 'closure_cancel';
const OPERATION: Readonly<Record<Command, string>> = {
  profile: 'driver.profile.update.v1',
  bank: 'driver.bank.update.v1',
  submit: 'driver.profile.submit.v1',
  accepting: 'driver.accepting.set.v1',
  closure_request: 'driver.closure.request.v1',
  closure_cancel: 'driver.closure.cancel.v1',
};

/** What a command did, for the history, the audit row and the outbox event. */
interface Applied {
  readonly driver: DriverRow;
  /** Short name of the change, e.g. `submitted`. Also the suffix of the history event type. */
  readonly change: string;
  readonly detail?: Readonly<Record<string, string | number | boolean | null>>;
}

/**
 * The Shipper's own M03 commands (profile, bank account, submit for review, accepting switch, closure request). The caller is the
 * authenticated principal only. Each command is ONE transaction opened by the idempotency executor: record -> user row -> CURRENT
 * session row -> driver row FOR UPDATE -> (bank row) -> writes -> history -> audit -> outbox -> the executor's record. The state
 * is decided from the locked rows (never from the client or the UI); a wrong expected_version is VERSION_CONFLICT; a state that does
 * not allow the action is DRIVER_STATE_CONFLICT, so a double submit or two racing commands cannot both succeed.
 */
@Injectable()
export class ShipperSelfService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly authority: ClientSessionAuthority,
    private readonly drivers: DriverRepository,
    private readonly banks: DriverBankRepository,
    private readonly events: DriverEventRepository,
    private readonly views: ShipperViewBuilder,
    private readonly limits: ShipperWalletParametersReader,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly walletReads: WalletReadRepository,
  ) {}

  /** GET /v1/driver/me. Reading grants nothing; a user without a Shipper profile reads null. */
  async read(principal: AuthPrincipal): Promise<JsonObject | null> {
    return this.transactions.withTransaction(async (context) => {
      const actor = await this.authority.lock(context, principal, 'share');
      const driver = await this.drivers.findByUserId(context, actor.userId);
      return driver === undefined ? null : this.views.build(context, driver);
    });
  }

  banksList(): JsonObject {
    return { banks: SHIPPER_BANKS.map((bank) => ({ code: bank.code, name: bank.name })) };
  }

  /** The minimum top-up / withdrawal per request, to show as a hint where M04 asks the Shipper for an amount. Not a setting page. */
  async walletLimits(principal: AuthPrincipal): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      await this.authority.lock(context, principal, 'share');
      const limits = await this.limits.limits(context);
      return { topup_min_vnd: limits.topupMinVnd, withdraw_min_vnd: limits.withdrawMinVnd };
    });
  }

  updateProfile(principal: AuthPrincipal, input: ProfileUpdateInput, key: string | readonly string[] | undefined, requestId: string) {
    return this.#command(principal, 'profile', { expected_version: input.expectedVersion, full_name: input.fullName, plate_number: input.plateNumber }, key, requestId, input.expectedVersion, async (context, driver) => {
      if (driver.status === 'CLOSING' || driver.status === 'CLOSED') {
        throw new AppError('DRIVER_STATE_CONFLICT');
      }
      const nameChanged = input.fullName !== driver.fullName;
      const plateChanged = input.plateNumber !== driver.plateNumber;
      if (nameChanged && !(driver.status === 'PENDING' && (driver.reviewState === 'DRAFT' || driver.reviewState === 'REJECTED'))) {
        // The name is what the bank holder must match and what the reviewer approved: it is not edited while under review or afterwards.
        throw new AppError('DRIVER_PROFILE_LOCKED');
      }
      if (!nameChanged && !plateChanged) {
        return undefined;
      }
      const updated = await this.#write(context, driver, { ...(nameChanged ? { fullName: input.fullName } : {}), ...(plateChanged ? { plateNumber: input.plateNumber } : {}) });
      if (nameChanged && (await this.banks.find(context, driver.driverId)) !== undefined) {
        // The name the account was checked against is gone: the account must be checked again.
        await this.banks.resetToUnverified(context, driver.driverId);
      }
      return { driver: updated, change: 'profile_updated', detail: { name_changed: nameChanged, plate_changed: plateChanged } };
    });
  }

  saveBank(principal: AuthPrincipal, input: BankUpdateInput, key: string | readonly string[] | undefined, requestId: string) {
    return this.#command(principal, 'bank', { expected_version: input.expectedVersion, bank_code: input.bank.code, account_number: input.accountNumber, account_holder: input.accountHolder }, key, requestId, input.expectedVersion, async (context, driver) => {
      if (driver.status === 'CLOSED') {
        throw new AppError('DRIVER_STATE_CONFLICT');
      }
      if ((await this.walletReads.openWithdrawalCountOfDriver(context, driver.driverId)) > 0) throw new AppError('DRIVER_WALLET_NOT_SETTLED');
      if (!holderMatchesName(driver.fullName, input.accountHolder)) {
        throw new AppError('BANK_HOLDER_MISMATCH');
      }
      const current = await this.banks.find(context, driver.driverId);
      if (
        current !== undefined &&
        current.bankCode === input.bank.code &&
        current.accountNumber === input.accountNumber &&
        current.accountHolder === input.accountHolder
      ) {
        return undefined;
      }
      await this.banks.upsertUnverified(context, driver.driverId, {
        bankCode: input.bank.code,
        bankName: input.bank.name,
        accountNumber: input.accountNumber,
        accountHolder: input.accountHolder,
      });
      // A new or changed account is not verified, so the Shipper stops taking new orders until it is (orders already taken stay).
      const stopAccepting = false;
      const updated = await this.#write(context, driver, stopAccepting ? { acceptingDeliveries: false } : {});
      return {
        driver: updated,
        change: 'bank_changed',
        detail: { bank_code: input.bank.code, was_verified: current?.verificationState === 'VERIFIED', accepting_stopped: stopAccepting },
      };
    });
  }

  submit(principal: AuthPrincipal, input: VersionOnlyInput, key: string | readonly string[] | undefined, requestId: string) {
    return this.#command(principal, 'submit', { expected_version: input.expectedVersion }, key, requestId, input.expectedVersion, async (context, driver) => {
      if (driver.status !== 'PENDING' || (driver.reviewState !== 'DRAFT' && driver.reviewState !== 'REJECTED')) {
        throw new AppError('DRIVER_STATE_CONFLICT');
      }
      const bank = await this.banks.find(context, driver.driverId);
      if (bank === undefined || !holderMatchesName(driver.fullName, bank.accountHolder)) {
        throw new AppError('DRIVER_PROFILE_INCOMPLETE');
      }
      const resubmission = driver.reviewState === 'REJECTED';
      const updated = await this.#write(context, driver, { reviewState: 'SUBMITTED', submittedAt: NOW, rejectionReason: null });
      return { driver: updated, change: 'submitted', detail: { resubmission } };
    });
  }

  setAccepting(principal: AuthPrincipal, input: AcceptingInput, key: string | readonly string[] | undefined, requestId: string) {
    return this.#command(principal, 'accepting', { expected_version: input.expectedVersion, accepting: input.accepting }, key, requestId, input.expectedVersion, async (context, driver) => {
      if (driver.acceptingDeliveries === input.accepting) {
        return undefined;
      }
      if (input.accepting) {
        // Every condition is decided here, under the locks, whatever the app showed.
        if (driver.status !== 'ACTIVE') {
          throw new AppError('DRIVER_NOT_ACTIVE');
        }
        const bank = await this.banks.find(context, driver.driverId);
        if (!(await this.views.readiness(context, driver, bank)).walletReady) {
          throw new AppError('DRIVER_WALLET_NOT_READY');
        }
      }
      // Switching off needs nothing and touches nothing but the switch: orders already taken are not cancelled or moved.
      const updated = await this.#write(context, driver, { acceptingDeliveries: input.accepting });
      return { driver: updated, change: input.accepting ? 'accepting_on' : 'accepting_off' };
    });
  }

  requestClosure(principal: AuthPrincipal, input: ClosureRequestInput, key: string | readonly string[] | undefined, requestId: string) {
    return this.#command(principal, 'closure_request', { expected_version: input.expectedVersion, note: input.note }, key, requestId, input.expectedVersion, async (context, driver) => {
      if (driver.status !== 'ACTIVE') {
        throw new AppError('DRIVER_STATE_CONFLICT');
      }
      // New orders stop at once; orders in progress are finished (nothing is cancelled); the wallet is untouched.
      const updated = await this.#write(context, driver, {
        status: 'CLOSING',
        acceptingDeliveries: false,
        statusBeforeClosing: 'ACTIVE',
        closureRequestedAt: NOW,
        closureNote: input.note,
      });
      return { driver: updated, change: 'closure_requested', detail: { accepting_stopped: driver.acceptingDeliveries } };
    });
  }

  cancelClosure(principal: AuthPrincipal, input: VersionOnlyInput, key: string | readonly string[] | undefined, requestId: string) {
    return this.#command(principal, 'closure_cancel', { expected_version: input.expectedVersion }, key, requestId, input.expectedVersion, async (context, driver) => {
      if (driver.status !== 'CLOSING' || driver.statusBeforeClosing === null) {
        throw new AppError('DRIVER_STATE_CONFLICT');
      }
      if ((await this.walletReads.openWithdrawalCountOfDriver(context, driver.driverId)) > 0) throw new AppError('DRIVER_WALLET_NOT_SETTLED');
      // Back to ACTIVE with the switch off: the Shipper turns receiving on again on purpose.
      const updated = await this.#write(context, driver, { status: driver.statusBeforeClosing, statusBeforeClosing: null, closureRequestedAt: null, closureNote: null });
      return { driver: updated, change: 'closure_cancelled' };
    });
  }

  async #write(context: TransactionContext, driver: DriverRow, patch: DriverPatch): Promise<DriverRow> {
    const updated = await this.drivers.update(context, driver.driverId, driver.version, patch);
    if (updated === undefined) {
      throw new AppError('VERSION_CONFLICT');
    }
    return updated;
  }

  /** The common shell of a command: executor, locks, version check, the change, then history + audit + outbox + the view. */
  async #command(
    principal: AuthPrincipal,
    command: Command,
    logicalRequest: JsonObject,
    idempotencyKey: string | readonly string[] | undefined,
    requestId: string,
    expectedVersion: number,
    apply: (context: TransactionContext, driver: DriverRow) => Promise<Applied | undefined>,
  ): Promise<JsonObject> {
    const outcome = await this.executor.execute(
      {
        scopeType: SCOPE_TYPE,
        scopeId: principal.userId,
        operationId: OPERATION[command],
        idempotencyKey,
        logicalRequest,
        replay: {
          kind: 'sensitive',
          authorize: async (context, guard) => {
            if (!isCanonicalUuid(guard.user_id) || guard.user_id !== principal.userId) {
              throw new TechnicalError('internal', 'Invalid replay guard');
            }
            await this.authority.lock(context, principal, 'update');
            return true;
          },
        },
      },
      async (context) => {
        const actor = await this.authority.lock(context, principal, 'update');
        const driver = await this.drivers.lockByUserId(context, actor.userId);
        if (driver === undefined) {
          throw new AppError('DRIVER_NOT_FOUND');
        }
        if (driver.version !== expectedVersion) {
          throw new AppError('VERSION_CONFLICT');
        }
        const applied = await apply(context, driver);
        if (applied === undefined) {
          // Nothing to change (the same data, the switch already in that position): the same answer, no new version, no history.
          return { status: 200, replayGuard: { user_id: actor.userId }, payload: await this.views.build(context, driver) };
        }
        const after = applied.driver;
        await this.events.append(context, {
          driverId: after.driverId,
          eventType: `driver.${applied.change}`,
          fromStatus: driver.status,
          toStatus: after.status,
          fromReviewState: driver.reviewState,
          toReviewState: after.reviewState,
          actorType: 'DRIVER',
          actorId: actor.userId,
          ...(applied.detail === undefined ? {} : { detail: applied.detail }),
        });
        await this.audit.append(context, {
          requestId,
          actorType: 'USER',
          actorId: actor.userId,
          action: OPERATION[command],
          resourceType: RESOURCE,
          resourceId: after.driverId,
          resourceVersion: after.version,
          outcome: 'SUCCESS',
          metadata: { change: applied.change, from_status: driver.status, to_status: after.status, from_review_state: driver.reviewState, to_review_state: after.reviewState, ...applied.detail },
        });
        await this.outbox.append(context, {
          eventType: EVENT_STATE_CHANGED,
          eventSchemaVersion: 1,
          resourceType: RESOURCE,
          resourceId: after.driverId,
          resourceVersion: after.version,
          payload: { driver_id: after.driverId, change: applied.change, status: after.status, review_state: after.reviewState, accepting_deliveries: after.acceptingDeliveries, version: after.version },
        });
        return { status: 200, replayGuard: { user_id: actor.userId }, payload: await this.views.build(context, after) };
      },
    );
    return outcome.payload as JsonObject;
  }
}

