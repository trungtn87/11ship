import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AdminSystemActor, LockedActor } from '../admin-provisioning/admin-system-actor';
import { setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { PROVISIONING_SCOPE_TYPE } from '../admin-provisioning/admin-provisioning-constants';
import { SessionLookup } from '../admin-auth/admin-session-repository';
import { AuditWriter } from '../audit/audit-writer';
import { AppError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { isCanonicalUuid } from '../shared/identifiers';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import {
  OTP_PASSWORD_RESET_ENABLED,
  OTP_REGISTRATION_ENABLED,
  SYSTEM_SETTING_AUDIT_ACTION,
  SYSTEM_SETTING_HISTORY_LIMIT,
  SYSTEM_SETTING_OPERATION_ID,
  SYSTEM_SETTING_RESOURCE,
  SystemSettingKey,
} from './system-settings-constants';
import { SettingState, SystemSettingsRepository } from './system-settings-repository';
import { PhoneVerificationBody } from './system-settings-validation';

const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * The "Xác thực số điện thoại" group of the system settings. SYSTEM only: the backend checks the membership under the actor's
 * locks on every read and every write (an ADMIN session gets ADMIN_FORBIDDEN, never a value). One transaction opened by the
 * idempotency executor: record -> actor locks -> settings rows FOR UPDATE -> version check -> writes -> change log (old value, new
 * value, actor, time) -> audit -> COMMIT. The effect is immediate: the application reads these rows on every request.
 *
 * The screen carries ONE version for the group (the sum of the row versions: it grows with every change of either switch), so a
 * second SYSTEM session that saved in between is a conflict, never a silent overwrite.
 */
@Injectable()
export class SystemSettingsService {
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actor: AdminSystemActor,
    private readonly settings: SystemSettingsRepository,
    private readonly audit: AuditWriter,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
  }

  async readPhoneVerification(sessionToken: string | undefined): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const locked = await this.actor.lock(context, known, { user: 'read', factor: 'read' });
      const nowMs = await freshClockMs(context);
      this.actor.assertLive(locked, nowMs);
      const states = await this.settings.readAll(context);
      const history = await this.settings.recentChanges(context, SYSTEM_SETTING_HISTORY_LIMIT);
      return view(states, history);
    });
  }

  async updatePhoneVerification(
    sessionToken: string | undefined,
    csrfHeader: unknown,
    body: PhoneVerificationBody,
    idempotencyKey: string | readonly string[] | undefined,
    meta: { requestId: string },
  ): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrfHeader });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE,
        scopeId: known.userId,
        operationId: SYSTEM_SETTING_OPERATION_ID,
        idempotencyKey,
        logicalRequest: {
          expected_version: body.expectedVersion,
          [OTP_REGISTRATION_ENABLED]: body.otpRegistrationEnabled,
          [OTP_PASSWORD_RESET_ENABLED]: body.otpPasswordResetEnabled,
          reason: body.reason,
        },
        replay: { kind: 'sensitive', authorize: (context, guard) => this.#authorizeReplay(context, guard, known) },
      },
      async (context) => {
        const locked = await this.#lockSystem(context, known);
        const states = await this.settings.lockAll(context);
        if (groupVersion(states) !== body.expectedVersion) {
          throw new AppError('SYSTEM_SETTING_VERSION_CONFLICT');
        }
        const wanted: Readonly<Record<SystemSettingKey, boolean>> = {
          [OTP_REGISTRATION_ENABLED]: body.otpRegistrationEnabled,
          [OTP_PASSWORD_RESET_ENABLED]: body.otpPasswordResetEnabled,
        };
        const changed: JsonObject[] = [];
        for (const state of states) {
          const next = wanted[state.key];
          if (state.value === next) {
            continue;
          }
          await this.settings.write(context, { key: state.key, value: next, actorUserId: known.userId });
          await this.settings.appendChange(context, {
            changeId: randomUUID(),
            key: state.key,
            oldValue: state.value,
            newValue: next,
            actorUserId: known.userId,
            requestId: isCanonicalUuid(meta.requestId) ? meta.requestId : undefined,
          });
          await this.audit.append(context, {
            requestId: meta.requestId,
            actorType: locked.checked.membership.adminRole,
            actorId: known.userId,
            action: SYSTEM_SETTING_AUDIT_ACTION,
            resourceType: SYSTEM_SETTING_RESOURCE,
            resourceId: null,
            outcome: 'SUCCESS',
            metadata: { setting_key: state.key, old_value: state.value, new_value: next, ...(body.reason === null ? {} : { reason: body.reason }) },
          });
          changed.push({ setting_key: state.key, old_value: state.value, new_value: next });
        }
        const after = await this.settings.readAll(context);
        const history = await this.settings.recentChanges(context, SYSTEM_SETTING_HISTORY_LIMIT);
        return {
          status: 200,
          replayGuard: { actor_user_id: known.userId },
          payload: { ...view(after, history), changed },
        };
      },
    );
  }

  /** The SYSTEM actor under the module's locks, the database clock read after them, then the SYSTEM-only rule. */
  async #lockSystem(context: TransactionContext, known: SessionLookup): Promise<LockedActor> {
    const locked = await this.actor.lock(context, known, { user: 'read', factor: 'read' });
    const nowMs = await freshClockMs(context);
    this.actor.assertLive(locked, nowMs);
    return locked;
  }

  async #authorizeReplay(context: TransactionContext, guard: JsonObject, known: SessionLookup): Promise<true> {
    if (guard.actor_user_id !== known.userId) {
      throw new AppError('ADMIN_SESSION_INVALID');
    }
    await this.#lockSystem(context, known);
    return true;
  }
}

function groupVersion(states: readonly SettingState[]): number {
  return states.reduce((sum, state) => sum + state.version, 0);
}

function view(states: readonly SettingState[], history: readonly { key: SystemSettingKey; oldValue: boolean; newValue: boolean; changedBy: string; changedAtMs: number; changeId: string }[]): JsonObject {
  const byKey = new Map(states.map((state) => [state.key, state]));
  const updated = states.map((state) => state.updatedAtMs).filter((ms): ms is number => ms !== null);
  return {
    version: groupVersion(states),
    otp_registration_enabled: byKey.get(OTP_REGISTRATION_ENABLED)?.value ?? true,
    otp_password_reset_enabled: byKey.get(OTP_PASSWORD_RESET_ENABLED)?.value ?? true,
    updated_at: updated.length === 0 ? null : iso(Math.max(...updated)),
    history: history.map((change) => ({
      change_id: change.changeId,
      setting_key: change.key,
      old_value: change.oldValue,
      new_value: change.newValue,
      changed_by: change.changedBy,
      changed_at: iso(change.changedAtMs),
    })),
  };
}
