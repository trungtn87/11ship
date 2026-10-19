import { Inject, Injectable, Optional } from '@nestjs/common';
import { safeErrorCode } from '../common/safe-error';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { JsonLogger } from '../logging/json-logger';
import { APP_LOGGER } from '../logging/logging.module';
import { TransactionManager } from '../transaction/transaction-manager';
import { DISCORD_WEBHOOK_HOSTS, DiscordSeverity, NotificationKind } from './ops-constants';
import { OpsEngine } from './ops-engine';
import { OpsIncidentRepository, NotificationRow } from './ops-incident-repository';
import { OpsSettingsService, isValidDiscordWebhook } from './ops-settings-service';

// Discord delivery (M13, design section 8). The message is built from the stored `content` of a row (never from anything a request supplied at send time),
// carries no OTP, password, token or customer detail, and disables every mention. "Sent" means Discord answered 2xx; every other outcome is recorded as it
// happened (retry with a limit, rate limit, rejected webhook), so a message that did not reach the channel is never reported as delivered.

export type DiscordResult =
  | { readonly ok: true; readonly status: number }
  | { readonly ok: false; readonly status: number | null; readonly code: string; readonly retryAfterSeconds?: number; readonly permanent: boolean };

export interface DiscordEmbed {
  readonly title: string;
  readonly description: string;
  readonly color: number;
  readonly fields: readonly { readonly name: string; readonly value: string; readonly inline: boolean }[];
  readonly timestamp: string;
  readonly footer: { readonly text: string };
}

export interface DiscordBody {
  readonly username: string;
  readonly allowed_mentions: { readonly parse: readonly string[] };
  readonly embeds: readonly DiscordEmbed[];
}

export interface DiscordClient {
  post(url: string, body: DiscordBody): Promise<DiscordResult>;
}

/** Injection token: tests bind a mock, production binds FetchDiscordClient. */
export const OPS_DISCORD_CLIENT = Symbol('OPS_DISCORD_CLIENT');

const COLOR: Readonly<Record<DiscordSeverity | 'RECOVERED', number>> = { CRITICAL: 0xd92d20, WARNING: 0xf79009, INFO: 0x3b82f6, RECOVERED: 0x12b76a };
const ICON: Readonly<Record<DiscordSeverity | 'RECOVERED', string>> = { CRITICAL: '🔴', WARNING: '🟠', INFO: 'ℹ️', RECOVERED: '🟢' };
const SEVERITY_LABEL: Readonly<Record<DiscordSeverity, string>> = { CRITICAL: 'Nghiêm trọng', WARNING: 'Cảnh báo', INFO: 'Thông tin' };
const KIND_LABEL: Readonly<Record<NotificationKind, string>> = {
  OPEN: 'Sự cố mới',
  REMINDER: 'Nhắc: chưa nhận xử lý',
  ESCALATION: 'Nâng mức',
  RECOVERY: 'Đã phục hồi',
  SNOOZE_END: 'Hết thời gian tạm hoãn',
  TEST: 'Gửi thử',
  DEPLOY: 'Triển khai',
  MAINTENANCE: 'Bảo trì',
};

const clip = (v: unknown, max: number): string => {
  const text = typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** "13:50 18/10/2026" in Vietnam time, from an ISO instant. */
export function vnTime(iso: unknown): string {
  const d = typeof iso === 'string' ? new Date(iso) : new Date(Number.NaN);
  if (Number.isNaN(d.getTime())) {
    return '-';
  }
  const parts = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric', hour12: false }).formatToParts(d);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('hour')}:${get('minute')} ${get('day')}/${get('month')}/${get('year')}`;
}

/** The Discord body of one stored notification. Pure: same row, same message. Every field comes from the row's already redacted `content`. */
export function buildDiscordBody(n: Pick<NotificationRow, 'kind' | 'severity' | 'content'>, environment: string): DiscordBody {
  const c = n.content;
  const recovered = n.kind === 'RECOVERY';
  const tone: DiscordSeverity | 'RECOVERED' = recovered ? 'RECOVERED' : n.severity;
  const code = typeof c.code === 'string' && c.code !== '' ? `[${c.code}] ` : '';
  const fields: { name: string; value: string; inline: boolean }[] = [{ name: 'Mức độ', value: recovered ? 'Đã phục hồi' : SEVERITY_LABEL[n.severity], inline: true }];
  if (typeof c.source === 'string') fields.push({ name: 'Nguồn', value: clip(c.source, 100), inline: true });
  if (typeof c.at === 'string') fields.push({ name: 'Thời điểm', value: vnTime(c.at), inline: true });
  if (typeof c.impact === 'string' && c.impact !== '') fields.push({ name: 'Ảnh hưởng', value: clip(c.impact, 300), inline: false });
  if (typeof c.occurrences === 'number' && c.occurrences > 1) fields.push({ name: 'Số lần', value: String(c.occurrences), inline: true });
  if (typeof c.code === 'string' && c.code !== '') fields.push({ name: 'Mã sự cố', value: clip(c.code, 32), inline: true });
  if (typeof c.detail === 'string' && c.detail !== '') fields.push({ name: 'Chi tiết', value: clip(c.detail, 300), inline: false });
  if (typeof c.link === 'string' && c.link !== '') fields.push({ name: 'Mở sự cố (cần đăng nhập Admin)', value: clip(c.link, 300), inline: false });
  return {
    username: '11Ship',
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: clip(`${ICON[tone]} ${code}${typeof c.title === 'string' ? c.title : KIND_LABEL[n.kind]}`, 250),
        description: clip(KIND_LABEL[n.kind], 200),
        color: COLOR[tone],
        fields: fields.slice(0, 20),
        timestamp: typeof c.at === 'string' && !Number.isNaN(Date.parse(c.at)) ? new Date(c.at).toISOString() : new Date().toISOString(),
        footer: { text: clip(`11Ship • ${environment}`, 100) },
      },
    ],
  };
}

export interface FetchDiscordOptions {
  /** Tests and local rehearsal only: allow an http://127.0.0.1 stand-in instead of Discord. */
  readonly allowLoopbackHttp?: boolean;
  readonly timeoutMs?: number;
}

/** The real client: one HTTPS POST, a timeout, no redirect. It cannot be pointed at any host but Discord's (a stand-in is allowed only when the option says so). */
export class FetchDiscordClient implements DiscordClient {
  readonly #loopback: boolean;
  readonly #timeoutMs: number;

  constructor(options: FetchDiscordOptions = {}) {
    this.#loopback = options.allowLoopbackHttp === true;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
  }

  async post(url: string, body: DiscordBody): Promise<DiscordResult> {
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      return { ok: false, status: null, code: 'URL_INVALID', permanent: true };
    }
    const local = this.#loopback && (host === '127.0.0.1' || host === 'localhost') && url.startsWith('http://');
    if (!local && !(isValidDiscordWebhook(url) && DISCORD_WEBHOOK_HOSTS.includes(host))) {
      return { ok: false, status: null, code: 'URL_INVALID', permanent: true };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: controller.signal });
      await response.arrayBuffer().catch(() => undefined);
      if (response.status >= 200 && response.status < 300) {
        return { ok: true, status: response.status };
      }
      if (response.status === 429) {
        const header = Number(response.headers.get('retry-after'));
        return { ok: false, status: 429, code: 'RATE_LIMITED', retryAfterSeconds: Number.isFinite(header) && header > 0 ? Math.min(3600, Math.ceil(header)) : 30, permanent: false };
      }
      if (response.status >= 500) {
        return { ok: false, status: response.status, code: `HTTP_${response.status}`, permanent: false };
      }
      // 4xx other than 429: the webhook was deleted, revoked or the request refused: retrying cannot help.
      return { ok: false, status: response.status, code: `HTTP_${response.status}`, permanent: true };
    } catch {
      return { ok: false, status: null, code: controller.signal.aborted ? 'TIMEOUT' : 'NETWORK', permanent: false };
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface DispatchSummary {
  readonly claimed: number;
  readonly sent: number;
  readonly retried: number;
  readonly failed: number;
  readonly skipped: number;
  readonly rateLimited: boolean;
}

const LEASE_SECONDS = 90;
/** A reminder older than this when its turn comes is dropped (the channel gets the current state, not a backlog); the row stays, marked STALE. */
const STALE_AFTER_MS: Readonly<Partial<Record<NotificationKind, number>>> = { REMINDER: 2 * 3_600_000, SNOOZE_END: 6 * 3_600_000, MAINTENANCE: 6 * 3_600_000 };

/**
 * Sends the due Discord messages, a bounded number per run (anti-flood after an outage), highest severity first. One message at a time; a rate limit stops the
 * run; a transient failure schedules a retry with back-off up to the configured limit; a permanent failure ends the message as FAILED. Nothing is sent when the
 * channel is off or has no webhook: the rows are then closed as SKIPPED with the reason, never as sent.
 */
@Injectable()
export class OpsDiscordDispatcher {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly incidents: OpsIncidentRepository,
    private readonly engine: OpsEngine,
    private readonly settings: OpsSettingsService,
    @Inject(OPS_DISCORD_CLIENT) private readonly client: DiscordClient,
    @Inject(APP_CONFIG) appConfig: AppConfig,
    @Optional() @Inject(APP_LOGGER) private readonly logger?: JsonLogger,
  ) {
    this.environment = appConfig.appEnv;
  }

  readonly environment: string;

  async runOnce(): Promise<DispatchSummary> {
    const claim = await this.transactions.withTransaction(async (context) => {
      const effective = await this.settings.load(context);
      const url = this.settings.webhookUrl(effective.row);
      if (!effective.discordEnabled || url === undefined) {
        const reason = !effective.discordEnabled ? 'DISABLED' : 'NOT_CONFIGURED';
        const skipped = await this.incidents.skipAllPending(context, reason);
        return { skipped, rows: [] as NotificationRow[], url: undefined as string | undefined, effective };
      }
      const rows = await this.incidents.claimDue(context, effective.settings['alert.discord_max_per_run'] as number, LEASE_SECONDS);
      return { skipped: 0, rows, url, effective };
    });
    const summary = { claimed: claim.rows.length, sent: 0, retried: 0, failed: 0, skipped: claim.skipped, rateLimited: false };
    const max = claim.effective.settings['alert.discord_retry_max'] as number;
    const base = claim.effective.settings['alert.discord_retry_base_seconds'] as number;
    for (const row of claim.rows) {
      const url = claim.url as string;
      const staleMs = STALE_AFTER_MS[row.kind];
      if (staleMs !== undefined && Date.now() - row.createdAtMs > staleMs) {
        await this.transactions.withTransaction((context) => this.incidents.markSkipped(context, row.notificationId, 'STALE'));
        summary.skipped += 1;
        continue;
      }
      let result: DiscordResult;
      try {
        result = await this.client.post(url, buildDiscordBody(row, this.environment));
      } catch (error) {
        result = { ok: false, status: null, code: 'CLIENT_ERROR', permanent: false };
        this.logger?.log('warn', 'ops_discord_client_failed', { code: safeErrorCode(error) });
      }
      if (result.ok) {
        await this.transactions.withTransaction(async (context) => {
          await this.incidents.markSent(context, row.notificationId, result.status);
          if (row.incidentId !== null) {
            await this.engine.logIncident(context, row.incidentId, 'INFO', 'DISCORD_SENT', `Đã gửi Discord: ${KIND_LABEL[row.kind]}`, { notification_id: row.notificationId, attempts: row.attempts + 1 });
          }
        });
        summary.sent += 1;
        continue;
      }
      if (result.code === 'RATE_LIMITED') {
        // Discord asked us to wait: the message keeps its place, the attempt is not counted, and the run ends so the rest is not thrown at the same limit.
        await this.transactions.withTransaction((context) =>
          this.incidents.markAttemptFailed(context, row.notificationId, { errorCode: 'RATE_LIMITED', httpStatus: 429, giveUp: false, delaySeconds: (result.retryAfterSeconds ?? 30) + 1, countAttempt: false }),
        );
        summary.rateLimited = true;
        summary.retried += 1;
        break;
      }
      const attemptsAfter = row.attempts + 1;
      const giveUp = result.permanent || attemptsAfter >= max;
      const delay = Math.min(3600, base * 2 ** Math.min(row.attempts, 10));
      await this.transactions.withTransaction(async (context) => {
        await this.incidents.markAttemptFailed(context, row.notificationId, { errorCode: result.code, httpStatus: result.status, giveUp, delaySeconds: giveUp ? 0 : delay, countAttempt: true });
        if (row.incidentId !== null && (giveUp || row.attempts === 0)) {
          await this.engine.logIncident(context, row.incidentId, giveUp ? 'ERROR' : 'WARN', giveUp ? 'DISCORD_FAILED' : 'DISCORD_RETRY', giveUp ? `Gửi Discord thất bại (${result.code}), không gửi lại nữa` : `Gửi Discord lỗi (${result.code}), sẽ thử lại`, { notification_id: row.notificationId, attempts: attemptsAfter });
        }
      });
      if (giveUp) {
        summary.failed += 1;
      } else {
        summary.retried += 1;
      }
    }
    // What the channel itself is doing, as a check: a failed message ends as FAILED, a delivered one clears it. Silence (nothing sent) changes nothing.
    if (summary.failed > 0 || summary.sent > 0) {
      await this.transactions.withTransaction((context) =>
        this.engine.observe(context, {
          checkKey: 'discord_channel',
          source: 'OPS',
          state: summary.failed > 0 ? 'WARNING' : 'OK',
          value: { sent: summary.sent, failed: summary.failed },
          evidenceCode: summary.failed > 0 ? 'DISCORD_FAILED' : 'DISCORD_OK',
          staleAfterSeconds: 24 * 3600,
          title: 'Không gửi được cảnh báo qua Discord',
          impact: 'Cảnh báo chỉ hiển thị trong Admin Web cho đến khi kênh Discord hoạt động lại',
        }),
      );
    }
    return summary;
  }
}
