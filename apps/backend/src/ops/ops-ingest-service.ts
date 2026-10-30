import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, lstatSync, ReadStream } from 'node:fs';
import path from 'node:path';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { AuthPrincipal } from '../auth/auth-principal';
import { AppError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DEFAULT_OPS_CONFIG } from '../config/ops-config';
import { TransactionManager } from '../transaction/transaction-manager';
import { ANDROID_COMPONENTS, CHECK_BACKUP, CHECK_EXTERNAL_PROBE, CHECK_PUBLIC_API, CHECK_RESTORE_TEST, ClientLogKind, IngestKeyScope, OpsSource, ReleaseComponent } from './ops-constants';
import { APP_COMPAT, APP_COMPAT_MATRIX, APP_COMPONENTS, CompatMatrix, artifactReady, decideCompat } from './ops-compat';
import { OpsEngine } from './ops-engine';
import { evaluateBackup, evaluateRestoreTest } from './ops-monitors';
import { OpsReleaseRepository, ReleaseRow } from './ops-release-repository';
import { OpsRepository } from './ops-repository';
import { OpsSettingsService } from './ops-settings-service';
import { ClientLogEntry, DeployBody, ProbeBody } from './ops-validation';
import { releaseView, iso } from './ops-views';
import { JsonObject } from '../idempotency/idempotency-executor';

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const KIND_SOURCE: Readonly<Record<ClientLogKind, (app: 'FOOD' | 'SHIP') => OpsSource>> = {
  CRASH: (app) => (app === 'FOOD' ? 'APP_FOOD' : 'APP_SHIP'),
  ACTION_ERROR: (app) => (app === 'FOOD' ? 'APP_FOOD' : 'APP_SHIP'),
  MAP_ERROR: () => 'M14',
  ROUTE_ERROR: () => 'M14',
  GPS_STALE: () => 'M14',
  PUSH_ERROR: () => 'NOTIFICATIONS',
};
/** One account may add this many log lines per hour (a runaway app cannot fill the log; what is over the limit is counted and dropped, not queued). */
const CLIENT_LOGS_PER_HOUR = 300;
const PROBE_PUBLIC_API_TITLE = 'Không truy cập được hệ thống từ bên ngoài';
const PROBE_IMPACT = 'App 11Food, 11Ship và Web Admin có thể không dùng được từ Internet. Chưa chứng minh VPS đã ngừng (chỉ biết API công khai không truy cập được).';

export interface ArtifactStream {
  readonly stream: ReadStream;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly fileName: string;
}

const DEPLOY_START_REPLAY_MS = 30 * 60_000;

/**
 * Everything that is reported TO M13 rather than read from it: the independent probe, the backup job, the deploy pipeline (each with its own hashed machine
 * credential, one scope each), the apps' log batches and version reports (the client session), and the release files devices download. Nothing here changes an
 * order, wallet, fee or delivery, runs a command, or opens a path the request chose.
 */
@Injectable()
export class OpsIngestService {
  readonly #artifactDir: string | undefined;
  readonly #environment: string;
  readonly #version: string;
  readonly #compat: CompatMatrix;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly repo: OpsRepository,
    private readonly releases: OpsReleaseRepository,
    private readonly engine: OpsEngine,
    private readonly settings: OpsSettingsService,
    @Inject(APP_CONFIG) appConfig: AppConfig,
    @Optional() @Inject(APP_COMPAT_MATRIX) compat?: CompatMatrix,
  ) {
    this.#compat = compat ?? APP_COMPAT;
    const ops = appConfig.ops ?? DEFAULT_OPS_CONFIG;
    this.#artifactDir = ops.artifactDir;
    this.#environment = appConfig.appEnv;
    this.#version = ops.backendVersion;
  }

  // ---- machine credentials ----

  /** A new reporting credential: 256 random bits shown once (to the operator tool), only its SHA-256 stored. */
  async createKey(label: string, scope: IngestKeyScope): Promise<{ keyId: string; secret: string }> {
    const secret = randomBytes(32).toString('base64url');
    const keyId = randomUUID();
    await this.transactions.withTransaction((context) => this.releases.insertIngestKey(context, { keyId, label, scope, digest: sha256(secret) }));
    return { keyId, secret };
  }

  async revokeKey(keyId: string): Promise<boolean> {
    return this.transactions.withTransaction((context) => this.releases.revokeIngestKey(context, keyId));
  }

  async authenticate(authorization: string | undefined, scope: IngestKeyScope): Promise<string> {
    const m = typeof authorization === 'string' ? /^Bearer ([A-Za-z0-9_-]{40,64})$/.exec(authorization) : null;
    if (m === null) {
      throw new AppError('OPS_INGEST_UNAUTHORIZED');
    }
    const found = await this.transactions.withTransaction(async (context) => {
      const key = await this.releases.findActiveIngestKey(context, sha256(m[1] as string));
      if (key !== undefined) {
        await this.releases.touchIngestKey(context, key.keyId);
      }
      return key;
    });
    // The same answer for "unknown", "revoked" and "wrong scope": a credential of one reporter never opens another reporter's door.
    if (found === undefined || found.scope !== scope) {
      throw new AppError('OPS_INGEST_UNAUTHORIZED');
    }
    return found.keyId;
  }

  // ---- independent probe ----

  async probe(body: ProbeBody): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      let created = 0;
      let open = false;
      for (const r of body.reports) {
        const out = await this.engine.recordOutage(context, {
          episodeId: r.episodeId,
          checkKey: CHECK_PUBLIC_API,
          source: 'EXTERNAL_PROBE',
          detectedBy: 'EXTERNAL_PROBE',
          title: PROBE_PUBLIC_API_TITLE,
          impact: PROBE_IMPACT,
          firstFailedAtMs: r.firstFailedAtMs,
          recoveredAtMs: r.recoveredAtMs,
          failures: r.failures,
          evidenceCode: 'PUBLIC_API_DOWN',
          notifiedBy: r.notified ? 'PROBE' : null,
        });
        if (out.created) created += 1;
        if (r.recoveredAtMs === null) open = true;
      }
      // The check mirrors what the probe last said; the probe's own clock is only recorded, the server's clock decides freshness.
      // Only the check row is written here: the outage incident itself is recorded above (one per episode), so this must not open a second one.
      await this.repo.observe(context, {
        checkKey: CHECK_PUBLIC_API,
        source: 'EXTERNAL_PROBE',
        state: open ? 'CRITICAL' : 'OK',
        value: { probe_reported_at: iso(body.reportedAtMs), reports: body.reports.length },
        evidenceCode: open ? 'PUBLIC_API_DOWN' : 'PUBLIC_API_OK',
        staleAfterSeconds: 20 * 60,
      });
      await this.engine.observe(context, {
        checkKey: CHECK_EXTERNAL_PROBE,
        source: 'EXTERNAL_PROBE',
        state: 'OK',
        value: { reported_at: new Date().toISOString(), probe_clock_at: iso(body.reportedAtMs) },
        evidenceCode: 'PROBE_ALIVE',
        staleAfterSeconds: 20 * 60,
        title: 'Giám sát ngoài VPS không báo cáo',
        impact: 'Nếu VPS ngừng hoạt động, sẽ không có cảnh báo từ bên ngoài',
      });
      return { accepted: body.reports.length, incidents_created: created };
    });
  }

  // ---- backup ----

  async backup(b: { kind: 'BACKUP' | 'RESTORE_TEST'; ok: boolean; finishedAtMs: number; sizeBytes: number | null; detailCode: string | null }): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      await this.releases.insertBackupReport(context, { reportId: randomUUID(), ...b });
      await this.repo.insertEvent(context, { category: 'TECHNICAL', level: b.ok ? 'INFO' : 'ERROR', source: 'BACKUP', environment: this.#environment, appVersion: this.#version, code: b.ok ? `${b.kind}_OK` : `${b.kind}_FAILED`, kind: b.kind, message: b.ok ? `${b.kind === 'BACKUP' ? 'Sao lưu' : 'Thử khôi phục'} thành công` : `${b.kind === 'BACKUP' ? 'Sao lưu' : 'Thử khôi phục'} thất bại`, detail: { size_bytes: b.sizeBytes, detail_code: b.detailCode } }, randomUUID());
      const eff = await this.settings.load(context);
      const nowMs = Date.now();
      const summary = await this.releases.backupSummary(context, b.kind);
      // Evaluated now (not at the next minute) so the overview and a failure incident follow the report at once; the two results stay two separate checks.
      if (b.kind === 'BACKUP') {
        await this.engine.observe(context, evaluateBackup({ nowMs, latest: summary.latest, lastOkAtMs: summary.lastOkAtMs }, eff.settings));
      } else {
        await this.engine.observe(context, evaluateRestoreTest({ nowMs, latest: summary.latest, lastOkAtMs: summary.lastOkAtMs }));
      }
      return { recorded: true, check: b.kind === 'BACKUP' ? CHECK_BACKUP : CHECK_RESTORE_TEST };
    });
  }

  // ---- deploy pipeline ----

  async deploy(b: DeployBody): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      if (b.action === 'start') {
        const latest = await this.releases.latestDeploy(context, b.component);
        // A CI retry of the same start (same component and target, still RUNNING, recent) returns the open record instead of a duplicate.
        if (latest !== undefined && latest.status === 'RUNNING' && latest.toVersion === b.toVersion && Date.now() - latest.startedAtMs <= DEPLOY_START_REPLAY_MS) {
          return { deploy_id: latest.deployId, status: latest.status };
        }
        const release = await context.query<{ release_id: string }>(`SELECT release_id FROM app.ops_releases WHERE component = $1 AND version_name = $2`, [b.component, b.toVersion]);
        const row = await this.releases.insertDeploy(context, { deployId: randomUUID(), component: b.component, fromVersion: b.fromVersion ?? (latest?.status === 'SUCCEEDED' ? latest.toVersion : null), toVersion: b.toVersion, releaseId: release.rows[0]?.release_id ?? null, hasDbMigration: b.hasDbMigration, note: b.note });
        await this.repo.insertEvent(context, { category: 'TECHNICAL', level: 'INFO', source: 'DEPLOY', environment: this.#environment, code: 'DEPLOY_STARTED', kind: 'DEPLOY', message: `Bắt đầu triển khai ${b.component} ${b.toVersion}`, detail: { deploy_id: row.deployId, has_db_migration: b.hasDbMigration } }, randomUUID());
        return { deploy_id: row.deployId, status: row.status };
      }
      const current = await this.releases.findDeploy(context, b.deployId, true);
      if (current === undefined) {
        throw new AppError('OPS_DEPLOY_NOT_FOUND');
      }
      const done = await this.releases.finishDeploy(context, b.deployId, { status: b.status, healthResult: b.healthResult, healthDetail: b.healthDetail, note: b.note });
      if (done === undefined) {
        throw new AppError('OPS_DEPLOY_STATE_CONFLICT');
      }
      const failed = b.status !== 'SUCCEEDED' || b.healthResult === 'FAILED';
      await this.repo.insertEvent(context, { category: 'TECHNICAL', level: failed ? 'ERROR' : 'INFO', source: 'DEPLOY', environment: this.#environment, code: failed ? 'DEPLOY_FAILED' : 'DEPLOY_SUCCEEDED', kind: 'DEPLOY', message: `Triển khai ${done.component} ${done.toVersion}: ${b.status}${b.healthResult === null ? '' : `, health check ${b.healthResult}`}`, detail: { deploy_id: done.deployId, has_db_migration: done.hasDbMigration } }, randomUUID());
      // The result goes to Discord once (dedupe per deploy). A failed deploy says nothing about an automatic database rollback: there is none.
      await this.engine.enqueueFreeNotice(
        context,
        'DEPLOY',
        failed ? 'WARNING' : 'INFO',
        {
          title: `Triển khai ${done.component} ${done.toVersion}: ${failed ? 'không thành công' : 'thành công'}`,
          source: 'Triển khai',
          impact: failed ? (done.hasDbMigration ? 'Bản này có thay đổi cơ sở dữ liệu: quay lại bản trước cần đánh giá riêng, không tự khôi phục cơ sở dữ liệu.' : 'Hệ thống có thể đang chạy bản cũ hoặc bản lỗi, cần kiểm tra.') : 'Health check đạt.',
          detail: b.healthDetail ?? undefined,
        },
        `deploy:${done.deployId}`,
      );
      return { deploy_id: done.deployId, status: done.status };
    });
  }

  // ---- apps ----

  /** A batch of log lines from the signed-in app. At most 300 lines per account per hour are kept; duplicates (a retried batch) are dropped; text is redacted when stored. */
  async clientLogs(principal: AuthPrincipal, entries: readonly ClientLogEntry[]): Promise<JsonObject> {
    const app = principal.app === 'FOOD' || principal.app === 'SHIP' ? principal.app : null;
    if (app === null) {
      throw new AppError('SESSION_INVALID');
    }
    return this.transactions.withTransaction(async (context) => {
      let room = Math.max(0, CLIENT_LOGS_PER_HOUR - (await this.repo.recentEventsOfUser(context, principal.userId, Date.now() - 3_600_000)));
      let accepted = 0;
      let duplicate = 0;
      for (const e of entries) {
        const ref = sha256(`${principal.userId}|${e.kind}|${e.code}|${e.atMs}|${e.appVersion}`).slice(0, 40);
        if (await this.repo.clientEntryKnown(context, principal.userId, ref)) {
          duplicate += 1;
          continue;
        }
        if (room <= 0) {
          continue;
        }
        room -= 1;
        await this.repo.insertEvent(
          context,
          { category: 'TECHNICAL', level: 'ERROR', source: KIND_SOURCE[e.kind](app), environment: this.#environment, appVersion: e.appVersion, code: e.code, kind: e.kind, message: e.message === '' ? e.kind : e.message, requestRef: ref, deliveryCode: e.deliveryCode, userId: principal.userId, detail: e.context, occurredAtMs: e.atMs },
          randomUUID(),
        );
        accepted += 1;
      }
      return { accepted, duplicate, dropped: entries.length - accepted - duplicate };
    });
  }

  async versionReport(principal: AuthPrincipal, r: { component: 'FOOD' | 'SHIP'; versionName: string; versionCode: number }): Promise<JsonObject> {
    if (principal.app !== r.component) {
      throw new AppError('SESSION_INVALID');
    }
    await this.transactions.withTransaction((context) => this.releases.recordVersionReport(context, { component: r.component, reporterRef: sha256(`${principal.userId}:${r.component}`).slice(0, 32), versionName: r.versionName, versionCode: r.versionCode }));
    return { recorded: true };
  }

  /**
   * What a phone is told at start-up and while it runs. Only a PUBLISHED release whose file is really in the artifact directory is ever offered; a
   * withdrawn, draft or missing-file release is not. When the deployed contract (app-compatibility.json) demands a build that cannot be downloaded the answer is
   * UPDATE_REQUIRED_UNAVAILABLE, never "up to date"; the operations check `app_compat.*` raises the same fault for SYSTEM.
   */
  async updateCheck(component: 'FOOD' | 'SHIP', versionCode: number | null): Promise<JsonObject> {
    const latest = await this.transactions.withTransaction((context) => this.releases.latestPublished(context, component));
    const d = decideCompat(component, this.#compat, versionCode, { release: latest, artifactReady: artifactReady(this.#artifactDir, latest) });
    return {
      status: d.status,
      compatible: d.compatible,
      contract_revision: this.#compat.contractRevision,
      min_supported_version_code: d.minSupportedVersionCode,
      latest_version_code: d.offer?.versionCode ?? null,
      update_available: d.offer !== null,
      required: d.required,
      priority: latest?.priority ?? null,
      reason: d.required ? d.reason : null,
      release: d.offer === null ? null : this.#publicRelease(d.offer),
    };
  }

  /** What the deploy preflight reads: the contract minimum and the newest downloadable build of each app, no phone involved. */
  async compatibilityView(): Promise<JsonObject> {
    const components: JsonObject = {};
    for (const component of APP_COMPONENTS) {
      const latest = await this.transactions.withTransaction((context) => this.releases.latestPublished(context, component));
      const ready = artifactReady(this.#artifactDir, latest);
      components[component] = {
        min_client_version_code: this.#compat.components[component].minClientVersionCode,
        published_version_code: latest?.versionCode ?? null,
        published_version_name: latest?.versionName ?? null,
        artifact_ready: ready,
        satisfied: latest !== undefined && latest.versionCode !== null && latest.versionCode >= this.#compat.components[component].minClientVersionCode && ready,
      };
    }
    return { contract_revision: this.#compat.contractRevision, backend_version: this.#version, components };
  }

  #publicRelease(r: ReleaseRow): JsonObject {
    return {
      release_id: r.releaseId,
      version_name: r.versionName,
      version_code: r.versionCode,
      release_notes: r.releaseNotes,
      released_at: iso(r.releasedAtMs),
      size_bytes: r.artifactSizeBytes,
      sha256: r.artifactSha256,
      min_supported_version_code: r.minSupportedVersionCode,
      compatibility_note: r.compatibilityNote,
      download_path: `/v1/app-updates/download/${r.releaseId}`,
    };
  }

  /** Gateway: the update the heartbeat offers (null when none). `ready` is the server's own reading of "no work in flight". */
  async gatewayOffer(context: Parameters<OpsReleaseRepository['latestPublished']>[0], deviceVersionCode: number | null, ready: boolean): Promise<JsonObject | null> {
    const latest = await this.releases.latestPublished(context, 'GATEWAY');
    if (latest === undefined || latest.versionCode === null || latest.artifactName === null || (deviceVersionCode !== null && latest.versionCode <= deviceVersionCode)) {
      return null;
    }
    return { ...this.#publicRelease(latest), download_path: `/v1/sms-gateway/update/${latest.releaseId}`, priority: latest.priority, ready };
  }

  /** Opens a published release file. The name comes from the release row (never the request), must be a plain file directly inside the artifact directory, and must still have the registered size. */
  async openArtifact(releaseId: string, components: readonly ReleaseComponent[]): Promise<ArtifactStream> {
    if (this.#artifactDir === undefined) {
      throw new AppError('OPS_ARTIFACT_UNAVAILABLE');
    }
    const release = await this.transactions.withTransaction((context) => this.releases.findRelease(context, releaseId));
    if (release === undefined || release.status !== 'PUBLISHED' || !components.includes(release.component) || !ANDROID_COMPONENTS.includes(release.component) || release.artifactName === null || release.artifactSha256 === null) {
      throw new AppError('OPS_RELEASE_NOT_FOUND');
    }
    const dir = path.resolve(this.#artifactDir);
    const full = path.resolve(dir, release.artifactName);
    if (path.dirname(full) !== dir) {
      throw new AppError('OPS_ARTIFACT_INVALID');
    }
    try {
      const stat = lstatSync(full);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== release.artifactSizeBytes) {
        throw new AppError('OPS_ARTIFACT_INVALID');
      }
    } catch (error) {
      throw error instanceof AppError ? error : new AppError('OPS_ARTIFACT_INVALID');
    }
    return { stream: createReadStream(full), sizeBytes: release.artifactSizeBytes as number, sha256: release.artifactSha256, fileName: release.artifactName };
  }

  releaseSummary(r: ReleaseRow): JsonObject {
    return releaseView(r, {});
  }
}
