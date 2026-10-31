import { Inject, Injectable, Optional } from '@nestjs/common';
import { safeErrorCode } from '../common/safe-error';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DEFAULT_OPS_CONFIG, OpsConfig } from '../config/ops-config';
import { JsonLogger } from '../logging/json-logger';
import { APP_LOGGER } from '../logging/logging.module';
import { NotificationRepository } from '../notifications/notification-repository';
import { PUSH_PROVIDER, PushProvider } from '../notifications/push-provider';
import { SmsGatewayOpsReader } from '../sms-gateway/sms-gateway-ops-reader';
import { TransactionManager } from '../transaction/transaction-manager';
import { CHECK_API, CHECK_DATABASE, CHECK_EXTERNAL_PROBE, CHECK_M14, CHECK_NOTIFICATIONS, CHECK_WORKER } from './ops-constants';
import { APP_COMPAT, APP_COMPAT_MATRIX, APP_COMPONENTS, CompatMatrix, artifactReady, evaluateAppCompat } from './ops-compat';
import { DiscordClient, OPS_DISCORD_CLIENT, buildDiscordBody } from './ops-discord';
import { OpsEngine } from './ops-engine';
import { OpsIncidentRepository } from './ops-incident-repository';
import { evaluateBackup, evaluateDisk, evaluateErrorBurst, evaluateGateway, evaluateHttps, evaluateOtpQueue, evaluateQueue, evaluateRestoreTest, evaluateSustained } from './ops-monitors';
import { OpsReleaseRepository } from './ops-release-repository';
import { OpsRepository } from './ops-repository';
import { OpsSettingsService } from './ops-settings-service';
import { OPS_SYSTEM_PROBE, OpsSystemProbe } from './ops-system-probe';
import { OpsTelemetryRepository } from './ops-telemetry-repository';
import { OpsSettings, defaultSettings } from './ops-settings';
import { CHECK_VPS, snapshotValue } from './ops-vps';

/** Probe liveness: no report for this long (after at least one) is its own warning. The probe reports every few minutes (ops/external-probe). */
export const EXTERNAL_PROBE_STALE_SECONDS = 15 * 60;
const HTTPS_EVERY_MS = 55 * 60_000;
const CLIENT_KINDS = { app: ['CRASH', 'ACTION_ERROR'], m14: ['MAP_ERROR', 'ROUTE_ERROR', 'GPS_STALE'], push: ['PUSH_ERROR'] } as const;

interface DbOutage {
  readonly startedAtMs: number;
  failures: number;
  announced: boolean;
}

/**
 * One pass of the lightweight server monitoring (design section 5, about once a minute): the database, the process's own HTTP surface, CPU / memory / disk,
 * the event queue, the gateway phones and OTP queue, backups, HTTPS expiry, the independent probe's liveness, M08 and M14, and the app error bursts. Each step is
 * independent (one failing step never stops the others) and reports through the engine.
 *
 * The one thing a database-backed monitor cannot do is record that the database is down. So the database check is first: while it fails, the outage lives
 * in memory; once the third consecutive failure is reached the channel is told DIRECTLY (webhook cached from the last good pass, no database), and when the
 * database answers again the whole outage is written as one incident with its real start time. A failing database is never shown as healthy and never as
 * "no problem": the answer for the period is a recorded outage.
 */
@Injectable()
export class OpsCollector {
  readonly #config: OpsConfig;
  readonly #environment: string;
  readonly #compat: CompatMatrix;
  #outage: DbOutage | undefined;
  #cache: { url: string | undefined; enabled: boolean; minSeverity: 'WARNING' | 'CRITICAL'; settings: OpsSettings; maintenance: { scopes: string[]; endsAtMs: number }[] } = {
    url: undefined,
    enabled: false,
    minSeverity: 'WARNING',
    settings: defaultSettings(),
    maintenance: [],
  };
  #lastHttpsMs = 0;
  #lastDbLatencyMs: number | null = null;
  #lastApiLatencyMs: number | null = null;
  #running = false;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly engine: OpsEngine,
    private readonly repo: OpsRepository,
    private readonly incidents: OpsIncidentRepository,
    private readonly settingsService: OpsSettingsService,
    private readonly gateways: SmsGatewayOpsReader,
    private readonly telemetry: OpsTelemetryRepository,
    private readonly releases: OpsReleaseRepository,
    private readonly notifications: NotificationRepository,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
    @Inject(OPS_SYSTEM_PROBE) private readonly probe: OpsSystemProbe,
    @Inject(OPS_DISCORD_CLIENT) private readonly discord: DiscordClient,
    @Inject(APP_CONFIG) appConfig: AppConfig,
    @Optional() @Inject(APP_LOGGER) private readonly logger?: JsonLogger,
    @Optional() @Inject(APP_COMPAT_MATRIX) compat?: CompatMatrix,
  ) {
    this.#compat = compat ?? APP_COMPAT;
    this.#config = appConfig.ops ?? DEFAULT_OPS_CONFIG;
    this.#environment = appConfig.appEnv;
  }

  get outageInMemory(): boolean {
    return this.#outage !== undefined;
  }

  /** One full pass; never overlaps itself, never throws. */
  async collectOnce(): Promise<void> {
    if (this.#running) {
      return;
    }
    this.#running = true;
    try {
      const dbUp = await this.#database();
      if (!dbUp) {
        return;
      }
      await this.#step('machine', () => this.#machine());
      await this.#step('api', () => this.#api());
      await this.#step('vps', () => this.#vps());
      await this.#step('worker', () => this.#worker());
      await this.#step('gateway', () => this.#gateway());
      await this.#step('backup', () => this.#backup());
      await this.#step('app_compat', () => this.#appCompat());
      await this.#step('https', () => this.#https());
      await this.#step('probe', () => this.#externalProbe());
      await this.#step('notifications', () => this.#notificationsCheck());
      await this.#step('m14', () => this.#m14());
      await this.#step('clients', () => this.#clientBursts());
    } finally {
      this.#running = false;
    }
  }

  async #step(name: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.logger?.log('warn', 'ops_collect_step_failed', { code: safeErrorCode(error), kind: name });
    }
  }

  // ---- database (first: nothing else can be recorded without it) ----

  async #database(): Promise<boolean> {
    const started = Date.now();
    try {
      await this.transactions.withTransaction(async (context) => {
        await context.query('SELECT 1');
      });
    } catch (error) {
      await this.#databaseDown(error);
      return false;
    }
    const latency = Date.now() - started;
    this.#lastDbLatencyMs = latency;
    const outage = this.#outage;
    this.#outage = undefined;
    await this.#step('database', async () => {
      await this.transactions.withTransaction(async (context) => {
        const effective = await this.settingsService.load(context);
        this.#cache = {
          url: this.settingsService.webhookUrl(effective.row),
          enabled: effective.discordEnabled,
          minSeverity: effective.discordMinSeverity,
          settings: effective.settings,
          maintenance: (await this.incidents.activeMaintenance(context)).map((m) => ({ scopes: m.scopes, endsAtMs: m.endsAtMs })),
        };
        await this.engine.observe(context, {
          checkKey: CHECK_DATABASE,
          source: 'DATABASE',
          state: 'OK',
          value: { latency_ms: latency },
          evidenceCode: 'DB_OK',
          staleAfterSeconds: 300,
          title: 'Database không phản hồi',
          impact: 'Mọi chức năng cần dữ liệu (đăng nhập, đơn, ví, OTP) bị ảnh hưởng',
        });
        await this.repo.insertMetric(context, 'db_latency_ms', latency);
        if (outage !== undefined && outage.failures >= (this.#cache.settings['server.db_failures'] as number)) {
          await this.engine.recordOutage(context, {
            episodeId: `db-${outage.startedAtMs}`,
            detectedBy: 'INTERNAL',
            notifiedBy: outage.announced ? 'DIRECT' : null,
            checkKey: CHECK_DATABASE,
            source: 'DATABASE',
            title: 'Database không phản hồi',
            impact: 'Mọi chức năng cần dữ liệu (đăng nhập, đơn, ví, OTP) bị ảnh hưởng',
            firstFailedAtMs: outage.startedAtMs,
            recoveredAtMs: Date.now(),
            failures: outage.failures,
            evidenceCode: 'DB_UNREACHABLE',
          });
        }
      });
    });
    return true;
  }

  async #databaseDown(error: unknown): Promise<void> {
    const outage = (this.#outage ??= { startedAtMs: Date.now(), failures: 0, announced: false });
    outage.failures += 1;
    this.logger?.log('error', 'ops_database_unreachable', { code: safeErrorCode(error), status: outage.failures });
    const needed = this.#cache.settings['server.db_failures'] as number;
    if (outage.announced || outage.failures < needed) {
      return;
    }
    // Direct, in-memory notice: no database, no queue. Skipped (and said so in the log) when the channel is off, unconfigured, or a maintenance window covers the database.
    const now = Date.now();
    const silenced = this.#cache.maintenance.some((m) => m.endsAtMs > now && m.scopes.includes('DATABASE'));
    if (!this.#cache.enabled || this.#cache.url === undefined || silenced) {
      return;
    }
    const body = buildDiscordBody(
      {
        kind: 'OPEN',
        severity: 'CRITICAL',
        content: { title: 'Database không phản hồi', source: 'Database', impact: 'Mọi chức năng cần dữ liệu bị ảnh hưởng. Sự cố sẽ được ghi vào Admin khi database trở lại.', at: new Date(outage.startedAtMs).toISOString(), detail: `${outage.failures} lần kiểm tra liên tiếp thất bại` },
      },
      this.#environment,
    );
    try {
      const result = await this.discord.post(this.#cache.url, body);
      outage.announced = result.ok;
    } catch {
      outage.announced = false;
    }
  }

  // ---- machine ----

  async #machine(): Promise<void> {
    const cpu = this.probe.cpuPercent();
    const memory = this.probe.memoryPercent();
    const disks = this.#config.diskPaths.map((d) => ({ label: d.label, used: this.probe.diskPercent(d.path) }));
    await this.transactions.withTransaction(async (context) => {
      const settings = this.#cache.settings;
      const now = Date.now();
      if (cpu !== null) await this.repo.insertMetric(context, 'cpu_percent', cpu);
      if (memory !== null) await this.repo.insertMetric(context, 'memory_percent', memory);
      for (const d of disks) {
        if (d.used !== null) await this.repo.insertMetric(context, `disk.${d.label}`, d.used);
      }
      const since = now - (settings['server.sustain_seconds'] as number) * 1000 - 60_000;
      await this.engine.observe(context, evaluateSustained('cpu', await this.repo.recentMetrics(context, 'cpu_percent', since), now, settings));
      await this.engine.observe(context, evaluateSustained('memory', await this.repo.recentMetrics(context, 'memory_percent', since), now, settings));
      for (const d of disks) {
        await this.engine.observe(context, evaluateDisk(d.label, d.used, settings));
      }
    });
  }

  // ---- VPS (#247): the wider read-only picture of the host, kept as the latest snapshot plus the history metrics ----

  async #vps(): Promise<void> {
    const snap = this.probe.hostSnapshot(this.#config.diskPaths);
    await this.transactions.withTransaction(async (context) => {
      const db = await this.repo.databaseStats(context);
      const metrics: [string, number | null | undefined][] = [
        ['swap_percent', snap.swap?.usedPercent],
        ['load_1m', snap.loadAvg[0]],
        ['net_rx_bps', snap.network?.rxBytesPerSec],
        ['net_tx_bps', snap.network?.txBytesPerSec],
        ['db_connections', db.activeConnections],
        ['db_size_bytes', db.sizeBytes],
      ];
      for (const [key, value] of metrics) {
        if (value !== null && value !== undefined) await this.repo.insertMetric(context, key, value);
      }
      await this.engine.observe(context, {
        checkKey: CHECK_VPS,
        source: 'SERVER',
        state: 'OK',
        value: snapshotValue(snap, { postgres: { latencyMs: this.#lastDbLatencyMs, activeConnections: db.activeConnections, sizeBytes: db.sizeBytes }, apiLatencyMs: this.#lastApiLatencyMs }),
        evidenceCode: 'VPS_SNAPSHOT',
        staleAfterSeconds: 180,
        title: 'Bộ thu thập VPS mất tín hiệu',
        impact: 'Trang Giám sát VPS không còn số liệu mới',
      });
    });
  }

  // ---- API ----

  async #api(): Promise<void> {
    const result = await this.probe.selfHealth();
    this.#lastApiLatencyMs = result.ok ? result.latencyMs : null;
    await this.transactions.withTransaction(async (context) => {
      if (result.ok) await this.repo.insertMetric(context, 'api_latency_ms', result.latencyMs);
      await this.engine.observe(context, {
        checkKey: CHECK_API,
        source: 'API',
        state: result.ok ? 'OK' : 'CRITICAL',
        value: { latency_ms: result.latencyMs, status: result.status },
        evidenceCode: result.ok ? 'API_OK' : (result.code ?? 'API_FAILED'),
        staleAfterSeconds: 300,
        title: 'API không phục vụ được',
        impact: 'App 11Food, 11Ship và Web Admin có thể không dùng được',
        openAfterFailures: this.#cache.settings['server.api_failures'] as number,
      });
    });
  }

  // ---- worker and queue ----

  async #worker(): Promise<void> {
    await this.transactions.withTransaction(async (context) => {
      const stats = await this.repo.outboxStats(context);
      await this.repo.insertMetric(context, 'outbox_pending', stats.pending);
      // What this very process is: the one "running version" the server can state from evidence (a deploy report alone does not prove what runs).
      if (this.#config.backendVersion !== 'unknown') {
        await this.releases.recordVersionReport(context, { component: 'BACKEND', reporterRef: 'self', versionName: this.#config.backendVersion, versionCode: null });
      }
      const history = (await this.repo.recentMetrics(context, 'outbox_pending', Date.now() - 3_600_000, 60)).map((p) => p.value);
      await this.engine.observe(context, evaluateQueue({ pending: stats.pending, oldestDueAgeMs: stats.oldestDueAgeMs, history }, this.#cache.settings));
      // The worker's own beat: this very pass ran. (A second place — the external probe and the read-time staleness — notices when it stops.)
      await this.engine.observe(context, {
        checkKey: CHECK_WORKER,
        source: 'WORKER',
        state: 'OK',
        value: { beat_at: new Date().toISOString(), dead_events: stats.dead },
        evidenceCode: 'WORKER_BEAT',
        staleAfterSeconds: this.#cache.settings['server.worker_stale_seconds'] as number,
        title: 'Worker ngừng chạy',
        impact: 'Các việc nền (thông báo, nhắc việc, dọn dẹp) không được xử lý',
      });
    });
  }

  // ---- SMS gateway ----

  async #gateway(): Promise<void> {
    await this.transactions.withTransaction(async (context) => {
      const settings = this.#cache.settings;
      const nowMs = Date.now();
      const devices = await this.gateways.devices(context);
      const telemetry = new Map((await this.telemetry.listTelemetry(context)).map((t) => [t.deviceId, t]));
      const failN = settings['gateway.send_fail_count'] as number;
      for (const device of devices) {
        const t = telemetry.get(device.deviceId);
        const reports = evaluateGateway(
          {
            deviceId: device.deviceId,
            label: device.label,
            nowMs,
            lastSeenAtMs: device.lastSeenAtMs,
            paused: device.paused,
            smsPermission: device.smsPermission,
            telemetry: t === undefined ? null : { reportedAtMs: t.reportedAtMs, batteryPercent: t.batteryPercent, charging: t.charging, powerChangedAtMs: t.powerChangedAtMs, simState: t.simState },
            recentResults: await this.gateways.recentResults(context, device.deviceId, failN),
          },
          settings,
        );
        for (const r of reports) {
          await this.engine.observe(context, r);
        }
      }
      const summary = await this.gateways.summary(context);
      await this.engine.observe(context, evaluateOtpQueue({ nowMs, activeDevices: devices.length, oldestValidQueuedAtMs: summary.oldestValidQueuedAtMs, queued: summary.queued }, settings));
    });
  }

  // ---- backup, HTTPS ----

  async #backup(): Promise<void> {
    await this.transactions.withTransaction(async (context) => {
      const nowMs = Date.now();
      const b = await this.releases.backupSummary(context, 'BACKUP');
      const r = await this.releases.backupSummary(context, 'RESTORE_TEST');
      await this.engine.observe(context, evaluateBackup({ nowMs, latest: b.latest, lastOkAtMs: b.lastOkAtMs }, this.#cache.settings));
      await this.engine.observe(context, evaluateRestoreTest({ nowMs, latest: r.latest, lastOkAtMs: r.lastOkAtMs }));
    });
  }

  /** The deployed APK contract against what can really be downloaded (#193): a breaking minimum with no downloadable APK is a SYSTEM-visible fault, never silence. */
  async #appCompat(): Promise<void> {
    await this.transactions.withTransaction(async (context) => {
      for (const component of APP_COMPONENTS) {
        const release = await this.releases.latestPublished(context, component);
        await this.engine.observe(context, evaluateAppCompat(component, this.#compat, { release, artifactReady: artifactReady(this.#config.artifactDir, release) }));
      }
    });
  }

  async #https(): Promise<void> {
    if (this.#config.publicBaseUrl === undefined || Date.now() - this.#lastHttpsMs < HTTPS_EVERY_MS) {
      return;
    }
    this.#lastHttpsMs = Date.now();
    const days = await this.probe.certDaysLeft(this.#config.publicBaseUrl, 8000);
    await this.transactions.withTransaction((context) => this.engine.observe(context, evaluateHttps(days, this.#cache.settings)));
  }

  // ---- independent probe ----

  /** The probe reports through the ingest endpoint; here only its SILENCE is noticed, and only after it has reported at least once (never reporting = "not activated"). */
  async #externalProbe(): Promise<void> {
    await this.transactions.withTransaction(async (context) => {
      const row = await this.repo.findCheck(context, CHECK_EXTERNAL_PROBE);
      const reported = typeof row?.value.reported_at === 'string' ? Date.parse(row.value.reported_at) : Number.NaN;
      if (row === undefined || !Number.isFinite(reported)) {
        return;
      }
      if (Date.now() - reported > EXTERNAL_PROBE_STALE_SECONDS * 1000) {
        await this.engine.observe(context, {
          checkKey: CHECK_EXTERNAL_PROBE,
          source: 'EXTERNAL_PROBE',
          state: 'WARNING',
          value: { ...row.value, silent_minutes: Math.floor((Date.now() - reported) / 60_000) },
          evidenceCode: 'PROBE_SILENT',
          staleAfterSeconds: EXTERNAL_PROBE_STALE_SECONDS,
          title: 'Giám sát ngoài VPS không báo cáo',
          impact: 'Nếu VPS ngừng hoạt động, sẽ không có cảnh báo từ bên ngoài',
        });
      }
    });
  }

  // ---- M08 and M14 ----

  async #notificationsCheck(): Promise<void> {
    await this.transactions.withTransaction(async (context) => {
      const q = await this.notifications.workQueue(context);
      const backlog = q.deadOutbox > 0 || q.stuck > 0 || q.pendingReminders > 0;
      await this.engine.observe(context, {
        checkKey: CHECK_NOTIFICATIONS,
        source: 'NOTIFICATIONS',
        state: backlog ? 'WARNING' : 'OK',
        // Push is deferred by the Owner: "not configured" is a displayed fact about the optional push channel, not a failure of the inbox pipeline.
        value: { dead_events: q.deadOutbox, late_pushes: q.stuck, late_reminders: q.pendingReminders, push_provider: this.push.configured ? 'CONFIGURED' : 'NOT_CONFIGURED' },
        evidenceCode: backlog ? 'NOTIFY_BACKLOG' : 'NOTIFY_OK',
        staleAfterSeconds: 300,
        title: 'Thông báo nội bộ bị tồn',
        impact: 'Thông báo trong app (hộp thư, nhắc việc) có thể đến chậm',
      });
    });
  }

  async #m14(): Promise<void> {
    if (this.#config.m14HealthUrl === undefined) {
      return;
    }
    const result = await this.probe.get(this.#config.m14HealthUrl, 5000);
    await this.transactions.withTransaction((context) =>
      this.engine.observe(context, {
        checkKey: CHECK_M14,
        source: 'M14',
        state: result.ok ? 'OK' : 'WARNING',
        value: { latency_ms: result.latencyMs, status: result.status },
        evidenceCode: result.ok ? 'M14_OK' : (result.code ?? 'M14_FAILED'),
        staleAfterSeconds: 300,
        title: 'Dịch vụ bản đồ / định tuyến (M14) không phản hồi',
        impact: 'Tính khoảng cách, thời gian di chuyển và bản đồ có thể không dùng được',
        openAfterFailures: 3,
      }),
    );
  }

  // ---- errors the apps reported ----

  async #clientBursts(): Promise<void> {
    await this.transactions.withTransaction(async (context) => {
      const settings = this.#cache.settings;
      const windowMs = (settings['app.error_burst_minutes'] as number) * 60_000;
      const since = Date.now() - windowMs;
      const groups: { source: 'APP_FOOD' | 'APP_SHIP' | 'M14' | 'NOTIFICATIONS'; label: string; kinds: readonly string[]; perVersion: boolean }[] = [
        { source: 'APP_FOOD', label: 'App 11Food', kinds: CLIENT_KINDS.app, perVersion: true },
        { source: 'APP_SHIP', label: 'App 11Ship', kinds: CLIENT_KINDS.app, perVersion: true },
        { source: 'M14', label: 'GPS / bản đồ / định tuyến', kinds: CLIENT_KINDS.m14, perVersion: false },
        { source: 'NOTIFICATIONS', label: 'Đẩy thông báo trên app', kinds: CLIENT_KINDS.push, perVersion: false },
      ];
      // Versions that already have an open incident are evaluated again even with no new errors, so the incident can recover.
      const live = await this.incidents.listLive(context);
      for (const g of groups) {
        const versions = new Set<string | null>(g.perVersion ? await this.repo.clientErrorVersions(context, g.source, g.kinds, since) : [null]);
        for (const i of live) {
          if (i.source === g.source && i.checkKey.startsWith('client.')) {
            const v = (i.evidence.latest as { version?: string | null } | undefined)?.version;
            versions.add(g.perVersion ? (v ?? null) : null);
          }
        }
        for (const version of versions) {
          const burst = await this.repo.clientErrorBurst(context, g.source, version, g.kinds, since);
          await this.engine.observe(context, evaluateErrorBurst({ source: g.source, label: g.label, version, errors: burst.errors, reporters: burst.reporters }, settings));
        }
      }
    });
  }
}
