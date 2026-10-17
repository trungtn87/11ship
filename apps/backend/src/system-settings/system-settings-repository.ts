import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';
import {
  SYSTEM_SETTING_DEFAULTS,
  SYSTEM_SETTING_KEYS,
  SystemSettingKey,
} from './system-settings-constants';

export interface SettingState {
  readonly key: SystemSettingKey;
  readonly value: boolean;
  /** 0 = never written (the default applies). */
  readonly version: number;
  readonly updatedAtMs: number | null;
  readonly updatedBy: string | null;
}

export interface SettingChange {
  readonly changeId: string;
  readonly key: SystemSettingKey;
  readonly oldValue: boolean;
  readonly newValue: boolean;
  readonly changedBy: string;
  readonly changedAtMs: number;
}

interface RawSetting {
  setting_key: SystemSettingKey;
  bool_value: boolean;
  version: string;
  updated_ms: string;
  updated_by: string;
}

/** SQL for app.system_settings and app.system_setting_changes. Nothing else touches them. */
@Injectable()
export class SystemSettingsRepository {
  /** Every key, defaults filled in for rows that were never written. Plain read, no lock. */
  async readAll(context: TransactionContext): Promise<SettingState[]> {
    const result = await context.query<RawSetting>(
      `SELECT setting_key, bool_value, version::text AS version, (extract(epoch FROM updated_at) * 1000)::bigint::text AS updated_ms, updated_by::text AS updated_by
         FROM app.system_settings WHERE setting_key = ANY($1::text[])`,
      [[...SYSTEM_SETTING_KEYS]],
    );
    return withDefaults(result.rows);
  }

  /** Same as readAll, rows locked FOR UPDATE (the writer). Keys are always taken in the fixed SYSTEM_SETTING_KEYS order. */
  async lockAll(context: TransactionContext): Promise<SettingState[]> {
    const result = await context.query<RawSetting>(
      `SELECT setting_key, bool_value, version::text AS version, (extract(epoch FROM updated_at) * 1000)::bigint::text AS updated_ms, updated_by::text AS updated_by
         FROM app.system_settings WHERE setting_key = ANY($1::text[]) ORDER BY setting_key FOR UPDATE`,
      [[...SYSTEM_SETTING_KEYS]],
    );
    return withDefaults(result.rows);
  }

  async readOne(context: TransactionContext, key: SystemSettingKey): Promise<boolean> {
    const result = await context.query<{ bool_value: boolean }>('SELECT bool_value FROM app.system_settings WHERE setting_key = $1', [key]);
    return result.rows[0]?.bool_value ?? SYSTEM_SETTING_DEFAULTS[key];
  }

  /** Writes a value that differs from the current one: version + 1 (or the first row), database time. */
  async write(context: TransactionContext, input: { key: SystemSettingKey; value: boolean; actorUserId: string }): Promise<void> {
    await context.query(
      `INSERT INTO app.system_settings (setting_key, bool_value, version, updated_by, updated_at)
       VALUES ($1, $2, 1, $3::uuid, date_trunc('milliseconds', clock_timestamp()))
       ON CONFLICT (setting_key) DO UPDATE
         SET bool_value = EXCLUDED.bool_value, version = app.system_settings.version + 1,
             updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
      [input.key, input.value, input.actorUserId],
    );
  }

  async appendChange(
    context: TransactionContext,
    input: { changeId: string; key: SystemSettingKey; oldValue: boolean; newValue: boolean; actorUserId: string; requestId: string | undefined },
  ): Promise<void> {
    await context.query(
      `INSERT INTO app.system_setting_changes (change_id, setting_key, old_value, new_value, changed_by, changed_at, request_id)
       VALUES ($1::uuid, $2, $3, $4, $5::uuid, date_trunc('milliseconds', clock_timestamp()), $6::uuid)`,
      [input.changeId, input.key, input.oldValue, input.newValue, input.actorUserId, input.requestId ?? null],
    );
  }

  /** Newest first. */
  async recentChanges(context: TransactionContext, limit: number): Promise<SettingChange[]> {
    const result = await context.query<{
      change_id: string;
      setting_key: SystemSettingKey;
      old_value: boolean;
      new_value: boolean;
      changed_by: string;
      changed_ms: string;
    }>(
      `SELECT change_id::text AS change_id, setting_key, old_value, new_value, changed_by::text AS changed_by,
              (extract(epoch FROM changed_at) * 1000)::bigint::text AS changed_ms
         FROM app.system_setting_changes ORDER BY changed_at DESC, change_id LIMIT $1::int`,
      [limit],
    );
    return result.rows.map((row) => ({
      changeId: row.change_id,
      key: row.setting_key,
      oldValue: row.old_value,
      newValue: row.new_value,
      changedBy: row.changed_by,
      changedAtMs: Number(row.changed_ms),
    }));
  }
}

function withDefaults(rows: readonly RawSetting[]): SettingState[] {
  return SYSTEM_SETTING_KEYS.map((key): SettingState => {
    const row = rows.find((item) => item.setting_key === key);
    return row === undefined
      ? { key, value: SYSTEM_SETTING_DEFAULTS[key], version: 0, updatedAtMs: null, updatedBy: null }
      : { key, value: row.bool_value, version: Number(row.version), updatedAtMs: Number(row.updated_ms), updatedBy: row.updated_by };
  });
}
