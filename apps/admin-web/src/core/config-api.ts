// HTTP client of the central configuration (M12-D): GET /v1/admin/config/groups and /history, and the OWNERS' own write routes (never a route of M12's own: a value is
// written only by the module that owns it). Cookie-only; the CSRF token is passed in from memory. Every answer is parsed strictly.

import { CsrfPort, failureOf } from './accounts-api.js';
import { ApiClient, ApiResult, record, str } from './api.js';
import { CommandResult, commandResultOf } from './commands.js';
import { ConfigChange, ConfigGroup, ConfigGroupKey, ConfigKind, ConfigRead, ConfigSave, ConfigSource, ConfigValue, GROUP_ORDER, HistoryRead } from './config.js';

export const CONFIG_BASE = '/v1';
const KINDS: readonly string[] = ['OTP', 'WALLET', 'ELIGIBILITY', 'NOTIFICATION'];
const iso = (value: unknown): string | undefined => {
  const text = str(value);
  return text !== undefined && !Number.isNaN(Date.parse(text)) ? text : undefined;
};

function parseValue(value: unknown): ConfigValue | undefined {
  const raw = record(value);
  const key = str(raw?.key);
  const label = str(raw?.label);
  if (raw === undefined || key === undefined || label === undefined || (typeof raw.value !== 'number' && typeof raw.value !== 'boolean' && typeof raw.value !== 'string') || (raw.unit !== undefined && typeof raw.unit !== 'string')) {
    return undefined;
  }
  return { key, label, value: raw.value, ...(raw.unit === undefined ? {} : { unit: raw.unit as string }) };
}

function parseList(value: unknown): ConfigValue[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out: ConfigValue[] = [];
  for (const entry of value) {
    const parsed = parseValue(entry);
    if (parsed === undefined) {
      return undefined;
    }
    out.push(parsed);
  }
  return out;
}

export function parseGroup(value: unknown): ConfigGroup | undefined {
  const raw = record(value);
  const title = str(raw?.title);
  const owner = str(raw?.owner);
  const updatedAt = raw?.updated_at === null ? null : iso(raw?.updated_at);
  const values = parseList(raw?.values);
  const fixed = parseList(raw?.fixed_rules);
  const editRaw = raw?.edit === null ? null : record(raw?.edit);
  if (
    raw === undefined || typeof raw.key !== 'string' || !(GROUP_ORDER as readonly string[]).includes(raw.key) || title === undefined || owner === undefined || updatedAt === undefined || values === undefined || fixed === undefined ||
    editRaw === undefined || (raw.version !== null && (typeof raw.version !== 'number' || !Number.isSafeInteger(raw.version) || raw.version < 0))
  ) {
    return undefined;
  }
  let edit: ConfigGroup['edit'] = null;
  if (editRaw !== null) {
    if (typeof editRaw.kind !== 'string' || !KINDS.includes(editRaw.kind) || (editRaw.note !== undefined && typeof editRaw.note !== 'string')) {
      return undefined;
    }
    edit = { kind: editRaw.kind as ConfigKind, note: typeof editRaw.note === 'string' ? editRaw.note : null };
  }
  return { key: raw.key as ConfigGroupKey, title, owner, version: raw.version as number | null, updatedAt, values, fixedRules: fixed, edit };
}

export function parseGroups(data: Record<string, unknown>): { groups: ConfigGroup[]; editable: boolean; generatedAt: string } | undefined {
  const generatedAt = iso(data.generated_at);
  if (generatedAt === undefined || typeof data.editable !== 'boolean' || !Array.isArray(data.groups)) {
    return undefined;
  }
  const groups: ConfigGroup[] = [];
  for (const entry of data.groups) {
    const parsed = parseGroup(entry);
    if (parsed === undefined) {
      return undefined;
    }
    groups.push(parsed);
  }
  return { groups, editable: data.editable, generatedAt };
}

export function parseHistory(data: Record<string, unknown>): ConfigChange[] | undefined {
  if (!Array.isArray(data.items)) {
    return undefined;
  }
  const out: ConfigChange[] = [];
  for (const entry of data.items) {
    const raw = record(entry);
    const at = iso(raw?.at);
    const action = str(raw?.action);
    const actor = str(raw?.actor_name);
    const metadata = record(raw?.metadata);
    if (raw === undefined || at === undefined || action === undefined || actor === undefined || metadata === undefined || typeof raw.group !== 'string' || !(GROUP_ORDER as readonly string[]).includes(raw.group)) {
      return undefined;
    }
    out.push({ at, group: raw.group as ConfigGroupKey, action, actorName: actor, metadata });
  }
  return out;
}

/** The owner's route and body for one kind. The path is fixed here, never taken from the server's answer. */
function ownerRequest(save: ConfigSave): { path: string; body: Record<string, unknown> } {
  const v = save.values;
  switch (save.kind) {
    case 'OTP':
      return { path: '/admin/system-settings/phone-verification', body: { expected_version: save.version, otp_registration_enabled: v.otp_registration_enabled, otp_password_reset_enabled: v.otp_password_reset_enabled, reason: save.reason } };
    case 'WALLET':
      return { path: '/admin/system-settings/shipper-wallet', body: { expected_version: save.version, topup_min_vnd: v.topup_min_vnd, withdraw_min_vnd: v.withdraw_min_vnd, reason: save.reason } };
    case 'ELIGIBILITY':
      return {
        path: '/admin/shipping-eligibility-policy',
        body: { expected_version: save.version, external_max_deliveries: v.external_max_deliveries, batch_max_delay_seconds: v.batch_max_delay_seconds, pickup_service_seconds: v.pickup_service_seconds, handoff_service_seconds: v.handoff_service_seconds, reason: save.reason },
      };
    case 'NOTIFICATION':
      return {
        path: '/admin/notifications/config',
        body: { expected_version: save.version, push_enabled: v.push_enabled, default_sound: v.default_sound, visible_days: v.visible_days, purge_days: v.purge_days, retry_max_attempts: v.retry_max_attempts, retry_base_seconds: v.retry_base_seconds, reason: save.reason },
      };
  }
}

export class AdminConfigApi extends ApiClient {
  groups(): Promise<ApiResult<{ groups: ConfigGroup[]; editable: boolean; generatedAt: string }>> {
    return this.call({ method: 'GET', path: '/admin/config/groups' }, parseGroups);
  }

  history(group: ConfigGroupKey | null): Promise<ApiResult<ConfigChange[]>> {
    return this.call({ method: 'GET', path: `/admin/config/history?limit=30${group === null ? '' : `&group=${group}`}` }, parseHistory);
  }

  save(csrf: string, save: ConfigSave): Promise<ApiResult<Record<string, unknown>>> {
    const request = ownerRequest(save);
    return this.call({ method: 'POST', path: request.path, body: request.body, csrf, idempotencyKey: save.key }, (data) => data);
  }
}

export function createConfigSource(api: AdminConfigApi, session?: CsrfPort): ConfigSource {
  return {
    async read(): Promise<ConfigRead> {
      const result = await api.groups();
      return result.kind === 'ok' ? { kind: 'ready', groups: result.data.groups, editable: result.data.editable, generatedAt: result.data.generatedAt } : failureOf(result);
    },
    async history(group): Promise<HistoryRead> {
      const result = await api.history(group);
      return result.kind === 'ok' ? { kind: 'ready', items: result.data } : failureOf(result);
    },
    async save(save): Promise<CommandResult> {
      if (session === undefined) {
        return { kind: 'not-wired' };
      }
      const csrf = session.csrf();
      if (csrf === undefined) {
        return { kind: 'session-expired' };
      }
      return commandResultOf(await api.save(csrf, save), session);
    },
  };
}
