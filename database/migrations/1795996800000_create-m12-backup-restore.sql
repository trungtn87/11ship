-- Up Migration
-- M12-F (docs/current/M12-spec-20261016.md section 6): the record of backups and of restore requests. ADDITIVE: two new tables; nothing existing is touched.
--
-- backup_records is written by the backup job of the operating team (ops/backup/backup.sh, with the database owner role), NOT by the application: the Web Admin only READS it. A
-- backup is SUCCEEDED only when it was also verified (restored into a scratch database and checked), encrypted and finished; "offsite" says whether a copy exists outside the VPS.
-- restore_requests records that SYSTEM asked for a restore of a verified backup, with the reason. The application NEVER performs a restore: an operator does, following
-- ops/runbooks/m12-backup-restore-20261023.md, and records the outcome here.

CREATE TABLE app.backup_records (
  backup_id uuid NOT NULL,
  kind varchar(16) NOT NULL,
  state varchar(10) NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  size_bytes bigint,
  sha256 char(64),
  schema_version varchar(128),
  encrypted boolean NOT NULL DEFAULT false,
  offsite boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  verify_note varchar(500),
  error_code varchar(40),
  -- How far the run got (the page shows each step apart): STARTED -> LOCAL (encrypted bundle made and restore-checked on the VPS) -> UPLOADED (copied to Google Drive)
  -- -> VERIFIED (the copy on Drive was checked against the local size and MD5). A failure keeps the stage it stopped at in failed_stage.
  stage varchar(8) NOT NULL DEFAULT 'STARTED',
  failed_stage varchar(8),
  trigger_kind varchar(8) NOT NULL DEFAULT 'MANUAL',
  release_version varchar(64),
  commit_sha varchar(40),
  offsite_verified_at timestamptz,
  CONSTRAINT backup_records_pkey PRIMARY KEY (backup_id),
  CONSTRAINT backup_records_kind_ck CHECK (kind IN ('DAILY', 'WEEKLY', 'PRE_MIGRATION', 'PRE_RESTORE', 'MANUAL')),
  CONSTRAINT backup_records_state_ck CHECK (state IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
  -- "Succeeded" is never claimed for a backup that was not finished, measured, encrypted and verified.
  CONSTRAINT backup_records_success_ck CHECK (
    state <> 'SUCCEEDED' OR (finished_at IS NOT NULL AND size_bytes IS NOT NULL AND size_bytes > 0 AND sha256 IS NOT NULL AND schema_version IS NOT NULL AND encrypted AND verified_at IS NOT NULL)
  ),
  CONSTRAINT backup_records_failed_ck CHECK ((state = 'FAILED') = (error_code IS NOT NULL)),
  CONSTRAINT backup_records_stage_ck CHECK (stage IN ('STARTED', 'LOCAL', 'UPLOADED', 'VERIFIED') AND (failed_stage IS NULL OR failed_stage IN ('STARTED', 'LOCAL', 'UPLOADED', 'VERIFIED'))),
  CONSTRAINT backup_records_trigger_ck CHECK (trigger_kind IN ('TIMER', 'DEPLOY', 'MANUAL', 'WEB')),
  -- "Outside the VPS" is claimed only for a copy that was uploaded AND checked there.
  CONSTRAINT backup_records_offsite_ck CHECK (NOT offsite OR (stage = 'VERIFIED' AND offsite_verified_at IS NOT NULL AND state = 'SUCCEEDED'))
);
CREATE INDEX backup_records_started_idx ON app.backup_records (started_at DESC);

CREATE FUNCTION app.backup_records_reject_delete() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app.backup_records is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER backup_records_no_delete BEFORE DELETE OR TRUNCATE ON app.backup_records
  FOR EACH STATEMENT EXECUTE FUNCTION app.backup_records_reject_delete();

-- "Sao lưu ngay": SYSTEM asks from the Web Admin; the backup job of the operating team claims it (as the database owner role) and runs ops/backup/backup.sh. At most one job is
-- open at any time (unique index), so a double click or two administrators can never queue two runs. The application never starts a process.
CREATE TABLE app.backup_jobs (
  job_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  state varchar(8) NOT NULL DEFAULT 'QUEUED',
  backup_id uuid,
  error_code varchar(40),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  CONSTRAINT backup_jobs_pkey PRIMARY KEY (job_id),
  CONSTRAINT backup_jobs_user_fk FOREIGN KEY (requested_by) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT backup_jobs_backup_fk FOREIGN KEY (backup_id) REFERENCES app.backup_records (backup_id) ON DELETE RESTRICT,
  CONSTRAINT backup_jobs_state_ck CHECK (state IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED')),
  CONSTRAINT backup_jobs_failed_ck CHECK ((state = 'FAILED') = (error_code IS NOT NULL)),
  CONSTRAINT backup_jobs_version_ck CHECK (version >= 1)
);
CREATE UNIQUE INDEX backup_jobs_open_uq ON app.backup_jobs ((true)) WHERE state IN ('QUEUED', 'RUNNING');
CREATE INDEX backup_jobs_created_idx ON app.backup_jobs (created_at DESC);

CREATE FUNCTION app.backup_jobs_reject_delete() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app.backup_jobs is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER backup_jobs_no_delete BEFORE DELETE OR TRUNCATE ON app.backup_jobs
  FOR EACH STATEMENT EXECUTE FUNCTION app.backup_jobs_reject_delete();

CREATE TABLE app.restore_requests (
  request_id uuid NOT NULL,
  backup_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  reason varchar(500) NOT NULL,
  state varchar(12) NOT NULL DEFAULT 'REQUESTED',
  operator_note varchar(500),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT restore_requests_pkey PRIMARY KEY (request_id),
  CONSTRAINT restore_requests_backup_fk FOREIGN KEY (backup_id) REFERENCES app.backup_records (backup_id) ON DELETE RESTRICT,
  CONSTRAINT restore_requests_user_fk FOREIGN KEY (requested_by) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT restore_requests_state_ck CHECK (state IN ('REQUESTED', 'CANCELLED', 'IN_PROGRESS', 'COMPLETED', 'ABORTED')),
  CONSTRAINT restore_requests_reason_ck CHECK (length(btrim(reason)) >= 10),
  CONSTRAINT restore_requests_version_ck CHECK (version >= 1)
);
-- At most one restore is open at any time: two people cannot start two restores of one system.
CREATE UNIQUE INDEX restore_requests_open_uq ON app.restore_requests ((true)) WHERE state IN ('REQUESTED', 'IN_PROGRESS');
CREATE INDEX restore_requests_created_idx ON app.restore_requests (created_at DESC);

CREATE FUNCTION app.restore_requests_reject_delete() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app.restore_requests is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER restore_requests_no_delete BEFORE DELETE OR TRUNCATE ON app.restore_requests
  FOR EACH STATEMENT EXECUTE FUNCTION app.restore_requests_reject_delete();

-- Down Migration
DROP TABLE app.restore_requests;
DROP TABLE app.backup_jobs;
DROP FUNCTION app.backup_jobs_reject_delete();
DROP FUNCTION app.restore_requests_reject_delete();
DROP TABLE app.backup_records;
DROP FUNCTION app.backup_records_reject_delete();
