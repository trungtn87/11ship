import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';
import { DeployStatus, IngestKeyScope, ReleaseComponent, ReleasePriority, ReleaseStatus } from './ops-constants';
import { redactText } from './ops-redact';
import { CLOCK, fromMs, ms, num, numOrNull } from './ops-sql';

// SQL of releases, what devices reported running, deploys as reported by the pipeline, backup reports, ingest credentials and the gateway telemetry.

export interface ReleaseRow {
  readonly releaseId: string;
  readonly component: ReleaseComponent;
  readonly versionName: string;
  readonly versionCode: number | null;
  readonly releaseNotes: string;
  readonly artifactName: string | null;
  readonly artifactSha256: string | null;
  readonly artifactSizeBytes: number | null;
  readonly minBackendVersion: string | null;
  readonly minSupportedVersionCode: number | null;
  readonly compatibilityNote: string | null;
  readonly priority: ReleasePriority;
  readonly requiredReason: string | null;
  readonly status: ReleaseStatus;
  readonly releasedAtMs: number | null;
  readonly hasDbMigration: boolean;
  readonly rollbackNote: string | null;
  readonly createdAtMs: number;
  readonly version: number;
}

const RELEASE_COLUMNS = `release_id, component, version_name, version_code, release_notes, artifact_name, artifact_sha256, artifact_size_bytes::text AS artifact_size, min_backend_version,
  min_supported_version_code, compatibility_note, priority, required_reason, status,
  CASE WHEN released_at IS NULL THEN NULL ELSE (extract(epoch FROM released_at) * 1000)::bigint::text END AS released_ms, has_db_migration, rollback_note, ${ms('created_at', 'created_ms')}, version::text AS version`;

interface ReleaseDbRow {
  release_id: string;
  component: ReleaseComponent;
  version_name: string;
  version_code: number | null;
  release_notes: string;
  artifact_name: string | null;
  artifact_sha256: string | null;
  artifact_size: string | null;
  min_backend_version: string | null;
  min_supported_version_code: number | null;
  compatibility_note: string | null;
  priority: ReleasePriority;
  required_reason: string | null;
  status: ReleaseStatus;
  released_ms: string | null;
  has_db_migration: boolean;
  rollback_note: string | null;
  created_ms: string;
  version: string;
}

const releaseOf = (r: ReleaseDbRow): ReleaseRow => ({
  releaseId: r.release_id,
  component: r.component,
  versionName: r.version_name,
  versionCode: r.version_code,
  releaseNotes: r.release_notes,
  artifactName: r.artifact_name,
  artifactSha256: r.artifact_sha256,
  artifactSizeBytes: numOrNull(r.artifact_size),
  minBackendVersion: r.min_backend_version,
  minSupportedVersionCode: r.min_supported_version_code,
  compatibilityNote: r.compatibility_note,
  priority: r.priority,
  requiredReason: r.required_reason,
  status: r.status,
  releasedAtMs: numOrNull(r.released_ms),
  hasDbMigration: r.has_db_migration,
  rollbackNote: r.rollback_note,
  createdAtMs: num(r.created_ms),
  version: num(r.version),
});

export interface NewRelease {
  readonly releaseId: string;
  readonly component: ReleaseComponent;
  readonly versionName: string;
  readonly versionCode: number | null;
  readonly releaseNotes: string;
  readonly artifact: { readonly name: string; readonly sha256: string; readonly sizeBytes: number } | null;
  readonly minBackendVersion: string | null;
  readonly minSupportedVersionCode: number | null;
  readonly compatibilityNote: string | null;
  readonly priority: ReleasePriority;
  readonly requiredReason: string | null;
  readonly hasDbMigration: boolean;
  readonly rollbackNote: string | null;
  readonly createdBy: string;
}

export interface VersionCount {
  readonly component: ReleaseComponent;
  readonly versionName: string;
  readonly versionCode: number | null;
  readonly reporters: number;
  readonly lastReportedAtMs: number;
}

export interface DeployRow {
  readonly deployId: string;
  readonly component: string;
  readonly fromVersion: string | null;
  readonly toVersion: string;
  readonly releaseId: string | null;
  readonly status: DeployStatus;
  readonly hasDbMigration: boolean;
  readonly startedAtMs: number;
  readonly finishedAtMs: number | null;
  readonly healthResult: 'PASSED' | 'FAILED' | null;
  readonly healthCheckedAtMs: number | null;
  readonly healthDetail: string | null;
  readonly note: string | null;
}

const DEPLOY_COLUMNS = `deploy_id, component, from_version, to_version, release_id, status, has_db_migration, ${ms('started_at', 'started_ms')},
  CASE WHEN finished_at IS NULL THEN NULL ELSE (extract(epoch FROM finished_at) * 1000)::bigint::text END AS finished_ms, health_result,
  CASE WHEN health_checked_at IS NULL THEN NULL ELSE (extract(epoch FROM health_checked_at) * 1000)::bigint::text END AS health_ms, health_detail, note`;

interface DeployDbRow {
  deploy_id: string;
  component: string;
  from_version: string | null;
  to_version: string;
  release_id: string | null;
  status: DeployStatus;
  has_db_migration: boolean;
  started_ms: string;
  finished_ms: string | null;
  health_result: 'PASSED' | 'FAILED' | null;
  health_ms: string | null;
  health_detail: string | null;
  note: string | null;
}

const deployOf = (r: DeployDbRow): DeployRow => ({
  deployId: r.deploy_id,
  component: r.component,
  fromVersion: r.from_version,
  toVersion: r.to_version,
  releaseId: r.release_id,
  status: r.status,
  hasDbMigration: r.has_db_migration,
  startedAtMs: num(r.started_ms),
  finishedAtMs: numOrNull(r.finished_ms),
  healthResult: r.health_result,
  healthCheckedAtMs: numOrNull(r.health_ms),
  healthDetail: r.health_detail,
  note: r.note,
});

@Injectable()
export class OpsReleaseRepository {
  // ---- releases ----

  async insertRelease(context: TransactionContext, r: NewRelease): Promise<ReleaseRow | undefined> {
    const result = await context.query<ReleaseDbRow>(
      `INSERT INTO app.ops_releases (release_id, component, version_name, version_code, release_notes, artifact_name, artifact_sha256, artifact_size_bytes, min_backend_version, min_supported_version_code,
         compatibility_note, priority, required_reason, status, released_at, has_db_migration, rollback_note, created_by, created_at, updated_at, version)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'DRAFT', NULL, $14, $15, $16::uuid, ${CLOCK}, ${CLOCK}, 1)
       ON CONFLICT (component, version_name) DO NOTHING RETURNING ${RELEASE_COLUMNS}`,
      [
        r.releaseId,
        r.component,
        r.versionName,
        r.versionCode,
        redactText(r.releaseNotes, 2000),
        r.artifact?.name ?? null,
        r.artifact?.sha256 ?? null,
        r.artifact?.sizeBytes ?? null,
        r.minBackendVersion,
        r.minSupportedVersionCode,
        r.compatibilityNote === null ? null : redactText(r.compatibilityNote, 300),
        r.priority,
        r.requiredReason === null ? null : redactText(r.requiredReason, 200),
        r.hasDbMigration,
        r.rollbackNote === null ? null : redactText(r.rollbackNote, 300),
        r.createdBy,
      ],
    );
    return result.rows[0] === undefined ? undefined : releaseOf(result.rows[0]);
  }

  async findRelease(context: TransactionContext, releaseId: string, lock = false): Promise<ReleaseRow | undefined> {
    const result = await context.query<ReleaseDbRow>(`SELECT ${RELEASE_COLUMNS} FROM app.ops_releases WHERE release_id = $1::uuid${lock ? ' FOR UPDATE' : ''}`, [releaseId]);
    return result.rows[0] === undefined ? undefined : releaseOf(result.rows[0]);
  }

  async listReleases(context: TransactionContext, filter: { component: string | null; limit: number; offset: number }): Promise<{ rows: ReleaseRow[]; total: number }> {
    const args: unknown[] = [];
    let clause = '';
    if (filter.component !== null) {
      args.push(filter.component);
      clause = 'WHERE component = $1';
    }
    const total = await context.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.ops_releases ${clause}`, args);
    const rows = await context.query<ReleaseDbRow>(
      `SELECT ${RELEASE_COLUMNS} FROM app.ops_releases ${clause} ORDER BY COALESCE(released_at, created_at) DESC LIMIT ${Number(filter.limit)} OFFSET ${Number(filter.offset)}`,
      args,
    );
    return { rows: rows.rows.map(releaseOf), total: num(total.rows[0]?.n ?? '0') };
  }

  /** The newest PUBLISHED release of a component (highest version code for Android, newest date otherwise). */
  async latestPublished(context: TransactionContext, component: ReleaseComponent): Promise<ReleaseRow | undefined> {
    const result = await context.query<ReleaseDbRow>(
      `SELECT ${RELEASE_COLUMNS} FROM app.ops_releases WHERE component = $1 AND status = 'PUBLISHED' ORDER BY version_code DESC NULLS LAST, released_at DESC LIMIT 1`,
      [component],
    );
    return result.rows[0] === undefined ? undefined : releaseOf(result.rows[0]);
  }

  async setReleaseStatus(context: TransactionContext, releaseId: string, expectedVersion: number, status: ReleaseStatus): Promise<ReleaseRow | undefined> {
    const result = await context.query<ReleaseDbRow>(
      `UPDATE app.ops_releases SET status = $3, released_at = CASE WHEN $3 = 'PUBLISHED' AND released_at IS NULL THEN ${CLOCK} ELSE released_at END, version = version + 1, updated_at = ${CLOCK}
        WHERE release_id = $1::uuid AND version = $2 RETURNING ${RELEASE_COLUMNS}`,
      [releaseId, expectedVersion, status],
    );
    return result.rows[0] === undefined ? undefined : releaseOf(result.rows[0]);
  }

  // ---- what devices run ----

  async recordVersionReport(context: TransactionContext, r: { component: ReleaseComponent; reporterRef: string; versionName: string; versionCode: number | null }): Promise<void> {
    await context.query(
      `INSERT INTO app.ops_version_reports (component, reporter_ref, version_name, version_code, reported_at) VALUES ($1, $2, $3, $4, ${CLOCK})
       ON CONFLICT (component, reporter_ref) DO UPDATE SET version_name = EXCLUDED.version_name, version_code = EXCLUDED.version_code, reported_at = EXCLUDED.reported_at`,
      [r.component, r.reporterRef, r.versionName, r.versionCode],
    );
  }

  /** Reporters per component and version (reports newer than `sinceDays`; a device that has not reported for long is not "running" anything we know of). */
  async versionCounts(context: TransactionContext, sinceDays: number): Promise<VersionCount[]> {
    const result = await context.query<{ component: ReleaseComponent; version_name: string; version_code: number | null; reporters: string; last_ms: string }>(
      `SELECT component, version_name, max(version_code) AS version_code, count(*)::text AS reporters, (extract(epoch FROM max(reported_at)) * 1000)::bigint::text AS last_ms
         FROM app.ops_version_reports WHERE reported_at > ${CLOCK} - make_interval(days => $1::int) GROUP BY component, version_name ORDER BY component, max(reported_at) DESC`,
      [sinceDays],
    );
    return result.rows.map((r) => ({ component: r.component, versionName: r.version_name, versionCode: r.version_code, reporters: num(r.reporters), lastReportedAtMs: num(r.last_ms) }));
  }

  // ---- deploys ----

  async insertDeploy(context: TransactionContext, d: { deployId: string; component: string; fromVersion: string | null; toVersion: string; releaseId: string | null; hasDbMigration: boolean; note: string | null }): Promise<DeployRow> {
    const result = await context.query<DeployDbRow>(
      `INSERT INTO app.ops_deploys (deploy_id, component, from_version, to_version, release_id, status, has_db_migration, started_at, note)
       VALUES ($1::uuid, $2, $3, $4, $5::uuid, 'RUNNING', $6, ${CLOCK}, $7) RETURNING ${DEPLOY_COLUMNS}`,
      [d.deployId, d.component, d.fromVersion, d.toVersion, d.releaseId, d.hasDbMigration, d.note === null ? null : redactText(d.note, 300)],
    );
    return deployOf(result.rows[0] as DeployDbRow);
  }

  async findDeploy(context: TransactionContext, deployId: string, lock = false): Promise<DeployRow | undefined> {
    const result = await context.query<DeployDbRow>(`SELECT ${DEPLOY_COLUMNS} FROM app.ops_deploys WHERE deploy_id = $1::uuid${lock ? ' FOR UPDATE' : ''}`, [deployId]);
    return result.rows[0] === undefined ? undefined : deployOf(result.rows[0]);
  }

  async finishDeploy(context: TransactionContext, deployId: string, f: { status: Exclude<DeployStatus, 'RUNNING'>; healthResult: 'PASSED' | 'FAILED' | null; healthDetail: string | null; note: string | null }): Promise<DeployRow | undefined> {
    const result = await context.query<DeployDbRow>(
      `UPDATE app.ops_deploys SET status = $2, finished_at = ${CLOCK}, health_result = $3, health_checked_at = CASE WHEN $3::text IS NULL THEN NULL ELSE ${CLOCK} END, health_detail = $4, note = COALESCE($5, note)
        WHERE deploy_id = $1::uuid AND status = 'RUNNING' RETURNING ${DEPLOY_COLUMNS}`,
      [deployId, f.status, f.healthResult, f.healthDetail === null ? null : redactText(f.healthDetail, 200), f.note === null ? null : redactText(f.note, 300)],
    );
    return result.rows[0] === undefined ? undefined : deployOf(result.rows[0]);
  }

  async listDeploys(context: TransactionContext, filter: { limit: number; offset: number }): Promise<{ rows: DeployRow[]; total: number }> {
    const total = await context.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.ops_deploys`);
    const rows = await context.query<DeployDbRow>(`SELECT ${DEPLOY_COLUMNS} FROM app.ops_deploys ORDER BY started_at DESC LIMIT ${Number(filter.limit)} OFFSET ${Number(filter.offset)}`);
    return { rows: rows.rows.map(deployOf), total: num(total.rows[0]?.n ?? '0') };
  }

  async latestDeploy(context: TransactionContext, component: string): Promise<DeployRow | undefined> {
    const result = await context.query<DeployDbRow>(`SELECT ${DEPLOY_COLUMNS} FROM app.ops_deploys WHERE component = $1 ORDER BY started_at DESC LIMIT 1`, [component]);
    return result.rows[0] === undefined ? undefined : deployOf(result.rows[0]);
  }

  // ---- backups ----

  async insertBackupReport(context: TransactionContext, r: { reportId: string; kind: 'BACKUP' | 'RESTORE_TEST'; ok: boolean; finishedAtMs: number; sizeBytes: number | null; detailCode: string | null }): Promise<void> {
    await context.query(
      `INSERT INTO app.ops_backup_reports (report_id, kind, ok, finished_at, size_bytes, detail_code, reported_at) VALUES ($1::uuid, $2, $3, ${fromMs('$4')}, $5, $6, ${CLOCK})`,
      [r.reportId, r.kind, r.ok, r.finishedAtMs, r.sizeBytes, r.detailCode],
    );
  }

  /** Latest result of a kind, and the latest SUCCESSFUL one (the age that matters). */
  async backupSummary(context: TransactionContext, kind: 'BACKUP' | 'RESTORE_TEST'): Promise<{ latest: { ok: boolean; finishedAtMs: number; detailCode: string | null } | null; lastOkAtMs: number | null; lastOkSizeBytes: number | null }> {
    const latest = await context.query<{ ok: boolean; finished_ms: string; detail_code: string | null }>(
      `SELECT ok, ${ms('finished_at', 'finished_ms')}, detail_code FROM app.ops_backup_reports WHERE kind = $1 ORDER BY finished_at DESC LIMIT 1`,
      [kind],
    );
    const ok = await context.query<{ finished_ms: string; size: string | null }>(
      `SELECT ${ms('finished_at', 'finished_ms')}, size_bytes::text AS size FROM app.ops_backup_reports WHERE kind = $1 AND ok ORDER BY finished_at DESC LIMIT 1`,
      [kind],
    );
    const l = latest.rows[0];
    return {
      latest: l === undefined ? null : { ok: l.ok, finishedAtMs: num(l.finished_ms), detailCode: l.detail_code },
      lastOkAtMs: ok.rows[0] === undefined ? null : num(ok.rows[0].finished_ms),
      lastOkSizeBytes: ok.rows[0] === undefined ? null : numOrNull(ok.rows[0].size),
    };
  }

  // ---- ingest credentials ----

  async insertIngestKey(context: TransactionContext, k: { keyId: string; label: string; scope: IngestKeyScope; digest: string }): Promise<void> {
    await context.query(`INSERT INTO app.ops_ingest_keys (key_id, label, scope, credential_digest, status, created_at) VALUES ($1::uuid, $2, $3, $4, 'ACTIVE', ${CLOCK})`, [k.keyId, k.label, k.scope, k.digest]);
  }

  async findActiveIngestKey(context: TransactionContext, digest: string): Promise<{ keyId: string; scope: IngestKeyScope } | undefined> {
    const result = await context.query<{ key_id: string; scope: IngestKeyScope }>(`SELECT key_id, scope FROM app.ops_ingest_keys WHERE credential_digest = $1 AND status = 'ACTIVE'`, [digest]);
    return result.rows[0] === undefined ? undefined : { keyId: result.rows[0].key_id, scope: result.rows[0].scope };
  }

  async touchIngestKey(context: TransactionContext, keyId: string): Promise<void> {
    await context.query(`UPDATE app.ops_ingest_keys SET last_used_at = ${CLOCK} WHERE key_id = $1::uuid`, [keyId]);
  }

  async revokeIngestKey(context: TransactionContext, keyId: string): Promise<boolean> {
    const result = await context.query(`UPDATE app.ops_ingest_keys SET status = 'REVOKED', revoked_at = ${CLOCK} WHERE key_id = $1::uuid AND status = 'ACTIVE'`, [keyId]);
    return result.rowCount === 1;
  }

  async listIngestKeys(context: TransactionContext): Promise<{ keyId: string; label: string; scope: IngestKeyScope; status: 'ACTIVE' | 'REVOKED'; createdAtMs: number; lastUsedAtMs: number | null }[]> {
    const result = await context.query<{ key_id: string; label: string; scope: IngestKeyScope; status: 'ACTIVE' | 'REVOKED'; created_ms: string; used_ms: string | null }>(
      `SELECT key_id, label, scope, status, ${ms('created_at', 'created_ms')}, CASE WHEN last_used_at IS NULL THEN NULL ELSE (extract(epoch FROM last_used_at) * 1000)::bigint::text END AS used_ms FROM app.ops_ingest_keys ORDER BY created_at`,
    );
    return result.rows.map((r) => ({ keyId: r.key_id, label: r.label, scope: r.scope, status: r.status, createdAtMs: num(r.created_ms), lastUsedAtMs: numOrNull(r.used_ms) }));
  }
}
