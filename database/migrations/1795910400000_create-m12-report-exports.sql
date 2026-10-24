-- Up Migration
-- M12-E (docs/current/M12-spec-20261016.md): export jobs of the administration reports. ADDITIVE: two new tables; nothing existing is touched, dropped or rewritten.
--
-- A job is created by an administrator who holds the export right (checked again when the job runs and when the file is downloaded), is processed in the background and
-- ends DONE (the file exists, its size and digest are stored with it in the same transaction) or FAILED (a code, never a partial file). A file is kept for a limited time
-- (expires_at) and its bytes are then removed; the job row stays as the record of who exported what, and is never deleted. The filter is stored as it was asked, so the
-- audit can say exactly which data left the system.

CREATE TABLE app.report_export_jobs (
  job_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  report_kind varchar(16) NOT NULL,
  format varchar(4) NOT NULL,
  filter jsonb NOT NULL,
  state varchar(8) NOT NULL DEFAULT 'QUEUED',
  error_code varchar(40),
  row_count integer,
  file_name varchar(120),
  file_bytes bigint,
  file_sha256 char(64),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  expires_at timestamptz,
  CONSTRAINT report_export_jobs_pkey PRIMARY KEY (job_id),
  CONSTRAINT report_export_jobs_user_fk FOREIGN KEY (requested_by) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT report_export_jobs_kind_ck CHECK (report_kind IN ('deliveries', 'shops', 'shippers', 'quality', 'money')),
  CONSTRAINT report_export_jobs_format_ck CHECK (format IN ('csv', 'xlsx')),
  CONSTRAINT report_export_jobs_state_ck CHECK (state IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'EXPIRED')),
  CONSTRAINT report_export_jobs_version_ck CHECK (version >= 1),
  -- DONE carries the whole file facts; FAILED carries a code and no file; the other states carry neither.
  CONSTRAINT report_export_jobs_done_ck CHECK (
    (state IN ('DONE', 'EXPIRED')) = (file_name IS NOT NULL AND file_bytes IS NOT NULL AND file_sha256 IS NOT NULL AND row_count IS NOT NULL AND expires_at IS NOT NULL AND finished_at IS NOT NULL)
    OR (state IN ('QUEUED', 'RUNNING', 'FAILED') AND file_name IS NULL AND file_bytes IS NULL AND file_sha256 IS NULL)
  ),
  CONSTRAINT report_export_jobs_failed_ck CHECK ((state = 'FAILED') = (error_code IS NOT NULL))
);
CREATE INDEX report_export_jobs_queue_idx ON app.report_export_jobs (created_at) WHERE state IN ('QUEUED', 'RUNNING');
CREATE INDEX report_export_jobs_user_idx ON app.report_export_jobs (requested_by, created_at DESC);

CREATE TABLE app.report_export_files (
  job_id uuid NOT NULL,
  content bytea NOT NULL,
  CONSTRAINT report_export_files_pkey PRIMARY KEY (job_id),
  CONSTRAINT report_export_files_job_fk FOREIGN KEY (job_id) REFERENCES app.report_export_jobs (job_id) ON DELETE RESTRICT,
  CONSTRAINT report_export_files_size_ck CHECK (octet_length(content) > 0)
);

-- A job row is a record of who exported what: it is never deleted.
CREATE FUNCTION app.report_export_jobs_reject_delete() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app.report_export_jobs is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER report_export_jobs_no_delete BEFORE DELETE OR TRUNCATE ON app.report_export_jobs
  FOR EACH STATEMENT EXECUTE FUNCTION app.report_export_jobs_reject_delete();

-- Down Migration
-- Only for disposable test or experimental databases. No CASCADE, no IF EXISTS: it fails loudly on drift.
DROP TRIGGER report_export_jobs_no_delete ON app.report_export_jobs;
DROP FUNCTION app.report_export_jobs_reject_delete();
DROP TABLE app.report_export_files;
DROP TABLE app.report_export_jobs;
