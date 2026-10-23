-- Up Migration
-- M13 (operations, alerts and updates): docs/current/M13-implementation-20261018.md, design 11Ship-M13-Functional-UI-LOCKED-v1.0.md.
--
-- It only ADDS tables, three functions and their triggers. No business table (order, wallet, fee, delivery, account) is touched or read by a
-- constraint; nothing is dropped; no CASCADE; no seed data (an absent app.ops_config row means "documented defaults"). Rules shared with
-- every migration of this repository: no IF [NOT] EXISTS on DDL, no GRANT (runtime grants live in ops/selfhosted/02-runtime-grants.sql and
-- ops/runbooks/render-supabase-staging.md). Append-only: nothing earlier is edited.
--
-- What is stored here is operational evidence, never a secret: the Discord webhook is sealed (AES-256-GCM, purpose subkey of the keyring) and is the
-- only sensitive value; OTPs, passwords, tokens and full phone numbers are never written to any column below (the application redacts before INSERT).

-- 1. The single settings row (thresholds, retention, Discord switch). Absent = documented defaults; the application validates every key and bound.
CREATE TABLE app.ops_config (
  config_id            smallint     NOT NULL,
  version              bigint       NOT NULL,
  settings             jsonb        NOT NULL,
  discord_enabled      boolean      NOT NULL,
  discord_min_severity varchar(8)   NOT NULL,
  webhook_iv           bytea,
  webhook_tag          bytea,
  webhook_ciphertext   bytea,
  webhook_key_id       varchar(64),
  webhook_updated_at   timestamptz,
  updated_by           uuid,
  updated_at           timestamptz  NOT NULL,
  CONSTRAINT ops_config_pkey PRIMARY KEY (config_id),
  CONSTRAINT ops_config_single_ck CHECK (config_id = 1),
  CONSTRAINT ops_config_version_ck CHECK (version >= 1),
  CONSTRAINT ops_config_settings_ck CHECK (jsonb_typeof(settings) = 'object'),
  CONSTRAINT ops_config_severity_ck CHECK (discord_min_severity IN ('WARNING', 'CRITICAL')),
  CONSTRAINT ops_config_webhook_ck CHECK (
    (webhook_ciphertext IS NULL AND webhook_iv IS NULL AND webhook_tag IS NULL AND webhook_key_id IS NULL AND webhook_updated_at IS NULL)
    OR (webhook_ciphertext IS NOT NULL AND webhook_iv IS NOT NULL AND webhook_tag IS NOT NULL AND webhook_key_id IS NOT NULL AND webhook_updated_at IS NOT NULL)
  ),
  CONSTRAINT ops_config_updated_by_fk FOREIGN KEY (updated_by) REFERENCES app.users (user_id) ON DELETE RESTRICT
);

-- 2. Which ADMIN may see (VIEW) or handle (HANDLE: acknowledge, note, snooze, close) incidents. SYSTEM has everything implicitly and never has a row.
--    Default deny: an ADMIN without a row (or with NONE) sees nothing of M13. Never deleted; each change is +1 version and audited.
CREATE TABLE app.ops_admin_scopes (
  user_id     uuid         NOT NULL,
  level       varchar(6)   NOT NULL,
  version     bigint       NOT NULL,
  updated_by  uuid         NOT NULL,
  updated_at  timestamptz  NOT NULL,
  CONSTRAINT ops_admin_scopes_pkey PRIMARY KEY (user_id),
  CONSTRAINT ops_admin_scopes_membership_fk FOREIGN KEY (user_id) REFERENCES app.admin_memberships (user_id) ON DELETE RESTRICT,
  CONSTRAINT ops_admin_scopes_updated_by_fk FOREIGN KEY (updated_by) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT ops_admin_scopes_level_ck CHECK (level IN ('NONE', 'VIEW', 'HANDLE')),
  CONSTRAINT ops_admin_scopes_version_ck CHECK (version >= 1)
);

-- 3. Incidents. One OPEN incident per fingerprint (source + check + failure kind): a repeat updates occurrences, it never duplicates.
--    NEW -> ACKNOWLEDGED -> IN_PROGRESS -> RECOVERED -> CLOSED ("read" is NOT a status: first_viewed_* only records that someone opened it).
CREATE TABLE app.ops_incidents (
  incident_id          uuid          NOT NULL,
  code_seq             bigint        GENERATED ALWAYS AS IDENTITY,
  fingerprint          varchar(96)   NOT NULL,
  source               varchar(24)   NOT NULL,
  check_key            varchar(64)   NOT NULL,
  severity             varchar(8)    NOT NULL,
  status               varchar(12)   NOT NULL,
  title                varchar(160)  NOT NULL,
  impact               varchar(240)  NOT NULL,
  detected_by          varchar(16)   NOT NULL,
  first_seen_at        timestamptz(3) NOT NULL,
  last_seen_at         timestamptz(3) NOT NULL,
  occurrences          integer       NOT NULL,
  evidence             jsonb         NOT NULL,
  assignee_user_id     uuid,
  acknowledged_at      timestamptz(3),
  first_viewed_at      timestamptz(3),
  first_viewed_by      uuid,
  recovered_at         timestamptz(3),
  closed_at            timestamptz(3),
  closed_by            uuid,
  closed_while_failing boolean       NOT NULL DEFAULT false,
  reopens_incident_id  uuid,
  snoozed_until        timestamptz(3),
  snooze_notice_pending boolean      NOT NULL DEFAULT false,
  last_notified_at     timestamptz(3),
  last_reminder_at     timestamptz(3),
  success_streak       integer       NOT NULL DEFAULT 0,
  in_maintenance       boolean       NOT NULL DEFAULT false,
  external_notified    boolean       NOT NULL DEFAULT false,
  version              bigint        NOT NULL,
  created_at           timestamptz(3) NOT NULL,
  updated_at           timestamptz(3) NOT NULL,
  CONSTRAINT ops_incidents_pkey PRIMARY KEY (incident_id),
  CONSTRAINT ops_incidents_assignee_fk FOREIGN KEY (assignee_user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT ops_incidents_viewed_by_fk FOREIGN KEY (first_viewed_by) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT ops_incidents_closed_by_fk FOREIGN KEY (closed_by) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT ops_incidents_reopens_fk FOREIGN KEY (reopens_incident_id) REFERENCES app.ops_incidents (incident_id) ON DELETE RESTRICT,
  CONSTRAINT ops_incidents_severity_ck CHECK (severity IN ('WARNING', 'CRITICAL')),
  CONSTRAINT ops_incidents_status_ck CHECK (status IN ('NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RECOVERED', 'CLOSED')),
  CONSTRAINT ops_incidents_detected_by_ck CHECK (detected_by IN ('INTERNAL', 'EXTERNAL_PROBE', 'APP_REPORT')),
  CONSTRAINT ops_incidents_source_ck CHECK (source ~ '^[A-Z][A-Z0-9_]{1,23}$'),
  CONSTRAINT ops_incidents_check_key_ck CHECK (check_key ~ '^[a-z][a-z0-9_.:-]{0,63}$'),
  CONSTRAINT ops_incidents_occurrences_ck CHECK (occurrences >= 1),
  CONSTRAINT ops_incidents_time_ck CHECK (last_seen_at >= first_seen_at),
  CONSTRAINT ops_incidents_evidence_ck CHECK (jsonb_typeof(evidence) = 'object'),
  CONSTRAINT ops_incidents_closed_ck CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
  CONSTRAINT ops_incidents_version_ck CHECK (version >= 1)
);
CREATE UNIQUE INDEX ops_incidents_open_fingerprint_uq ON app.ops_incidents (fingerprint) WHERE status <> 'CLOSED';
CREATE INDEX ops_incidents_status_idx ON app.ops_incidents (status, severity, last_seen_at DESC);
CREATE INDEX ops_incidents_first_seen_idx ON app.ops_incidents (first_seen_at DESC);
CREATE INDEX ops_incidents_fingerprint_idx ON app.ops_incidents (fingerprint, closed_at DESC);

-- 4. The log, in three groups: TECHNICAL (API, gateway, app, worker, M14), INCIDENT (the timeline of an incident) and ADMIN (who changed which M13 setting, with the
--    reason and without any secret: the audit table is write-only for the runtime role, so the Administration reads this copy). Append-only: UPDATE is always refused; DELETE only inside the retention pass (it sets app.ops_purge locally). The incident
--    timeline (detected, escalated, acknowledged, note, Discord result, recovered, closed) is the INCIDENT category of this same table.
CREATE TABLE app.ops_events (
  event_id       uuid          NOT NULL,
  seq            bigint        GENERATED ALWAYS AS IDENTITY,
  occurred_at    timestamptz(3) NOT NULL,
  category       varchar(10)   NOT NULL,
  level          varchar(5)    NOT NULL,
  source         varchar(24)   NOT NULL,
  environment    varchar(16)   NOT NULL,
  app_version    varchar(32),
  code           varchar(48),
  kind           varchar(24),
  message        varchar(300)  NOT NULL,
  request_ref    varchar(64),
  delivery_code  varchar(32),
  transaction_ref varchar(64),
  user_id        uuid,
  incident_id    uuid,
  actor_user_id  uuid,
  detail         jsonb         NOT NULL,
  CONSTRAINT ops_events_pkey PRIMARY KEY (event_id),
  CONSTRAINT ops_events_incident_fk FOREIGN KEY (incident_id) REFERENCES app.ops_incidents (incident_id) ON DELETE RESTRICT,
  CONSTRAINT ops_events_category_ck CHECK (category IN ('TECHNICAL', 'INCIDENT', 'ADMIN')),
  CONSTRAINT ops_events_level_ck CHECK (level IN ('INFO', 'WARN', 'ERROR')),
  CONSTRAINT ops_events_source_ck CHECK (source ~ '^[A-Z][A-Z0-9_]{1,23}$'),
  CONSTRAINT ops_events_code_ck CHECK (code IS NULL OR code ~ '^[A-Z0-9_.:-]{1,48}$'),
  CONSTRAINT ops_events_incident_link_ck CHECK (category <> 'INCIDENT' OR incident_id IS NOT NULL),
  CONSTRAINT ops_events_detail_ck CHECK (jsonb_typeof(detail) = 'object')
);
CREATE INDEX ops_events_time_idx ON app.ops_events (occurred_at DESC);
CREATE INDEX ops_events_source_idx ON app.ops_events (source, occurred_at DESC);
CREATE INDEX ops_events_code_idx ON app.ops_events (code, occurred_at DESC) WHERE code IS NOT NULL;
CREATE INDEX ops_events_delivery_idx ON app.ops_events (delivery_code) WHERE delivery_code IS NOT NULL;
CREATE INDEX ops_events_user_idx ON app.ops_events (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX ops_events_incident_idx ON app.ops_events (incident_id, seq) WHERE incident_id IS NOT NULL;

CREATE FUNCTION app.ops_events_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'app.ops_events is append-only (UPDATE rejected)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' AND COALESCE(current_setting('app.ops_purge', true), '') <> 'on' THEN
    RAISE EXCEPTION 'app.ops_events rows are removed only by the retention pass (DELETE rejected)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ops_events_guard BEFORE UPDATE OR DELETE ON app.ops_events
  FOR EACH ROW EXECUTE FUNCTION app.ops_events_guard();
CREATE FUNCTION app.ops_events_reject_truncate() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app.ops_events is never truncated' USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER ops_events_no_truncate BEFORE TRUNCATE ON app.ops_events
  FOR EACH STATEMENT EXECUTE FUNCTION app.ops_events_reject_truncate();

-- 5. The latest state of each check (what the overview shows). UNKNOWN = "Chưa có dữ liệu": never painted as healthy.
CREATE TABLE app.ops_checks (
  check_key             varchar(64)   NOT NULL,
  source                varchar(24)   NOT NULL,
  state                 varchar(8)    NOT NULL,
  observed_at           timestamptz(3) NOT NULL,
  since_at              timestamptz(3) NOT NULL,
  consecutive_failures  integer       NOT NULL,
  consecutive_successes integer       NOT NULL,
  value                 jsonb         NOT NULL,
  evidence_code         varchar(48),
  stale_after_seconds   integer       NOT NULL,
  CONSTRAINT ops_checks_pkey PRIMARY KEY (check_key),
  CONSTRAINT ops_checks_key_ck CHECK (check_key ~ '^[a-z][a-z0-9_.:-]{0,63}$'),
  CONSTRAINT ops_checks_source_ck CHECK (source ~ '^[A-Z][A-Z0-9_]{1,23}$'),
  CONSTRAINT ops_checks_state_ck CHECK (state IN ('OK', 'WARNING', 'CRITICAL', 'UNKNOWN')),
  CONSTRAINT ops_checks_counters_ck CHECK (consecutive_failures >= 0 AND consecutive_successes >= 0),
  CONSTRAINT ops_checks_stale_ck CHECK (stale_after_seconds BETWEEN 30 AND 31536000),
  CONSTRAINT ops_checks_value_ck CHECK (jsonb_typeof(value) = 'object')
);

-- 6. Measurements: raw 7 days, hourly aggregate 90 days (both configurable); the retention pass folds raw rows into the hourly table.
CREATE TABLE app.ops_metrics (
  metric_id    bigint         GENERATED ALWAYS AS IDENTITY,
  metric_key   varchar(48)    NOT NULL,
  observed_at  timestamptz(3) NOT NULL,
  value        double precision NOT NULL,
  CONSTRAINT ops_metrics_pkey PRIMARY KEY (metric_id),
  CONSTRAINT ops_metrics_key_ck CHECK (metric_key ~ '^[a-z][a-z0-9_.:-]{0,47}$')
);
CREATE INDEX ops_metrics_key_time_idx ON app.ops_metrics (metric_key, observed_at DESC);
CREATE TABLE app.ops_metrics_hourly (
  metric_key  varchar(48)    NOT NULL,
  hour_at     timestamptz(3) NOT NULL,
  samples     integer        NOT NULL,
  avg_value   double precision NOT NULL,
  max_value   double precision NOT NULL,
  CONSTRAINT ops_metrics_hourly_pkey PRIMARY KEY (metric_key, hour_at),
  CONSTRAINT ops_metrics_hourly_samples_ck CHECK (samples >= 1)
);

-- 7. Discord messages: one row per message to send, with the real outcome. "Sent" = Discord accepted the request (2xx); a message that was
--    not delivered is never shown as delivered. dedupe_key makes one fact one message.
CREATE TABLE app.ops_notifications (
  notification_id   uuid          NOT NULL,
  incident_id       uuid,
  kind              varchar(16)   NOT NULL,
  severity          varchar(8)    NOT NULL,
  content           jsonb         NOT NULL,
  dedupe_key        varchar(120)  NOT NULL,
  status            varchar(8)    NOT NULL,
  skip_reason       varchar(24),
  attempts          integer       NOT NULL,
  next_attempt_at   timestamptz(3) NOT NULL,
  lease_until       timestamptz(3),
  last_attempt_at   timestamptz(3),
  last_error_code   varchar(32),
  last_http_status  smallint,
  sent_at           timestamptz(3),
  created_at        timestamptz(3) NOT NULL,
  CONSTRAINT ops_notifications_pkey PRIMARY KEY (notification_id),
  CONSTRAINT ops_notifications_dedupe_uq UNIQUE (dedupe_key),
  CONSTRAINT ops_notifications_incident_fk FOREIGN KEY (incident_id) REFERENCES app.ops_incidents (incident_id) ON DELETE RESTRICT,
  CONSTRAINT ops_notifications_kind_ck CHECK (kind IN ('OPEN', 'REMINDER', 'ESCALATION', 'RECOVERY', 'SNOOZE_END', 'TEST', 'DEPLOY', 'MAINTENANCE')),
  CONSTRAINT ops_notifications_severity_ck CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  CONSTRAINT ops_notifications_status_ck CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED')),
  CONSTRAINT ops_notifications_skip_ck CHECK ((status = 'SKIPPED') = (skip_reason IS NOT NULL)),
  CONSTRAINT ops_notifications_sent_ck CHECK ((status = 'SENT') = (sent_at IS NOT NULL)),
  CONSTRAINT ops_notifications_attempts_ck CHECK (attempts >= 0),
  CONSTRAINT ops_notifications_content_ck CHECK (jsonb_typeof(content) = 'object')
);
CREATE INDEX ops_notifications_due_idx ON app.ops_notifications (next_attempt_at) WHERE status = 'PENDING';
CREATE INDEX ops_notifications_incident_idx ON app.ops_notifications (incident_id, created_at) WHERE incident_id IS NOT NULL;

-- 8. Maintenance windows: scoped, with an end time. After ends_at the alerts are on again by themselves (no job has to switch them back on).
CREATE TABLE app.ops_maintenance (
  maintenance_id uuid          NOT NULL,
  scopes         jsonb         NOT NULL,
  reason         varchar(200)  NOT NULL,
  starts_at      timestamptz(3) NOT NULL,
  ends_at        timestamptz(3) NOT NULL,
  created_by     uuid          NOT NULL,
  created_at     timestamptz(3) NOT NULL,
  cancelled_at   timestamptz(3),
  cancelled_by   uuid,
  CONSTRAINT ops_maintenance_pkey PRIMARY KEY (maintenance_id),
  CONSTRAINT ops_maintenance_created_by_fk FOREIGN KEY (created_by) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT ops_maintenance_cancelled_by_fk FOREIGN KEY (cancelled_by) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT ops_maintenance_scopes_ck CHECK (jsonb_typeof(scopes) = 'array' AND jsonb_array_length(scopes) BETWEEN 1 AND 16),
  CONSTRAINT ops_maintenance_time_ck CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '72 hours'),
  CONSTRAINT ops_maintenance_cancel_ck CHECK ((cancelled_at IS NULL) = (cancelled_by IS NULL))
);
CREATE INDEX ops_maintenance_window_idx ON app.ops_maintenance (ends_at DESC);

-- 9. What the gateway phone reports besides the heartbeat the OTP queue already stores (battery, charging, SIM, results waiting). Only values
--    the phone itself proved: NULL = not reported = "Chưa xác định". SIM balance has no column on purpose (Android cannot read it); the last
--    top-up date is written by hand by SYSTEM.
CREATE TABLE app.ops_gateway_telemetry (
  device_id          uuid         NOT NULL,
  reported_at        timestamptz(3) NOT NULL,
  battery_percent    smallint,
  charging           boolean,
  power_changed_at   timestamptz(3),
  sim_state          varchar(12),
  pending_reports    smallint,
  current_task       varchar(10),
  last_error_code    varchar(24),
  last_error_at      timestamptz(3),
  topup_noted_on     date,
  topup_noted_by     uuid,
  CONSTRAINT ops_gateway_telemetry_pkey PRIMARY KEY (device_id),
  CONSTRAINT ops_gateway_telemetry_device_fk FOREIGN KEY (device_id) REFERENCES app.sms_gateway_devices (device_id) ON DELETE RESTRICT,
  CONSTRAINT ops_gateway_telemetry_noted_by_fk FOREIGN KEY (topup_noted_by) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT ops_gateway_telemetry_battery_ck CHECK (battery_percent IS NULL OR battery_percent BETWEEN 0 AND 100),
  CONSTRAINT ops_gateway_telemetry_sim_ck CHECK (sim_state IS NULL OR sim_state IN ('READY', 'ABSENT', 'LOCKED', 'UNKNOWN')),
  CONSTRAINT ops_gateway_telemetry_pending_ck CHECK (pending_reports IS NULL OR pending_reports BETWEEN 0 AND 100),
  CONSTRAINT ops_gateway_telemetry_task_ck CHECK (current_task IS NULL OR current_task IN ('IDLE', 'SENDING', 'REPORTING')),
  CONSTRAINT ops_gateway_telemetry_error_ck CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z0-9_]{1,24}$')
);

-- 10. Machine credentials for the reporters that are not a person and not a phone: the independent probe, the backup job and the deploy
--     pipeline. 256 random bits shown ONCE; only the SHA-256 is stored. Revocation is one-way.
CREATE TABLE app.ops_ingest_keys (
  key_id             uuid         NOT NULL,
  label              varchar(64)  NOT NULL,
  scope              varchar(10)  NOT NULL,
  credential_digest  char(64)     NOT NULL,
  status             varchar(8)   NOT NULL,
  created_at         timestamptz(3) NOT NULL,
  revoked_at         timestamptz(3),
  last_used_at       timestamptz(3),
  CONSTRAINT ops_ingest_keys_pkey PRIMARY KEY (key_id),
  CONSTRAINT ops_ingest_keys_digest_uq UNIQUE (credential_digest),
  CONSTRAINT ops_ingest_keys_digest_ck CHECK (credential_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ops_ingest_keys_label_ck CHECK (label ~ '^[A-Za-z0-9 ._-]{1,64}$'),
  CONSTRAINT ops_ingest_keys_scope_ck CHECK (scope IN ('PROBE', 'BACKUP', 'DEPLOY')),
  CONSTRAINT ops_ingest_keys_status_ck CHECK (status IN ('ACTIVE', 'REVOKED')),
  CONSTRAINT ops_ingest_keys_revoked_ck CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);

-- 11. Releases. artifact_name is a plain file name inside the server's artifact directory (never a path or URL); the SHA-256 and the size are
--     computed by the server from the file when SYSTEM registers the release. PUBLISHED is what devices are offered; "what a device runs" is
--     NOT stored here (see ops_version_reports).
CREATE TABLE app.ops_releases (
  release_id          uuid          NOT NULL,
  component           varchar(12)   NOT NULL,
  version_name        varchar(32)   NOT NULL,
  version_code        integer,
  release_notes       varchar(2000) NOT NULL,
  artifact_name       varchar(96),
  artifact_sha256     char(64),
  artifact_size_bytes bigint,
  min_backend_version varchar(32),
  min_supported_version_code integer,
  compatibility_note  varchar(300),
  priority            varchar(12)   NOT NULL,
  required_reason     varchar(200),
  status              varchar(10)   NOT NULL,
  released_at         timestamptz(3),
  has_db_migration    boolean       NOT NULL,
  rollback_note       varchar(300),
  created_by          uuid          NOT NULL,
  created_at          timestamptz(3) NOT NULL,
  updated_at          timestamptz(3) NOT NULL,
  version             bigint        NOT NULL,
  CONSTRAINT ops_releases_pkey PRIMARY KEY (release_id),
  CONSTRAINT ops_releases_component_version_uq UNIQUE (component, version_name),
  CONSTRAINT ops_releases_created_by_fk FOREIGN KEY (created_by) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT ops_releases_component_ck CHECK (component IN ('FOOD', 'SHIP', 'GATEWAY', 'WEB_ADMIN', 'BACKEND', 'M14', 'MAP_PACK')),
  CONSTRAINT ops_releases_version_name_ck CHECK (version_name ~ '^[0-9A-Za-z][0-9A-Za-z.+_-]{0,31}$'),
  CONSTRAINT ops_releases_priority_ck CHECK (priority IN ('NORMAL', 'RECOMMENDED', 'REQUIRED')),
  CONSTRAINT ops_releases_status_ck CHECK (status IN ('DRAFT', 'PUBLISHED', 'WITHDRAWN')),
  CONSTRAINT ops_releases_artifact_name_ck CHECK (artifact_name IS NULL OR artifact_name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$'),
  CONSTRAINT ops_releases_artifact_ck CHECK (
    (artifact_name IS NULL AND artifact_sha256 IS NULL AND artifact_size_bytes IS NULL)
    OR (artifact_name IS NOT NULL AND artifact_sha256 ~ '^[0-9a-f]{64}$' AND artifact_size_bytes BETWEEN 1 AND 1073741824)
  ),
  CONSTRAINT ops_releases_published_ck CHECK ((status = 'DRAFT') = (released_at IS NULL)),
  CONSTRAINT ops_releases_android_ck CHECK (component NOT IN ('FOOD', 'SHIP', 'GATEWAY') OR version_code IS NOT NULL),
  CONSTRAINT ops_releases_required_reason_ck CHECK (priority <> 'REQUIRED' OR required_reason IS NOT NULL),
  CONSTRAINT ops_releases_version_ck CHECK (version >= 1)
);
CREATE INDEX ops_releases_component_idx ON app.ops_releases (component, status, released_at DESC);

-- 12. What devices and services REPORTED running (one row per component and reporter, replaced in place). A release that exists but was never
--     reported is "available", not "installed".
CREATE TABLE app.ops_version_reports (
  component      varchar(12)   NOT NULL,
  reporter_ref   varchar(64)   NOT NULL,
  version_name   varchar(32)   NOT NULL,
  version_code   integer,
  reported_at    timestamptz(3) NOT NULL,
  CONSTRAINT ops_version_reports_pkey PRIMARY KEY (component, reporter_ref),
  CONSTRAINT ops_version_reports_component_ck CHECK (component IN ('FOOD', 'SHIP', 'GATEWAY', 'WEB_ADMIN', 'BACKEND', 'M14', 'MAP_PACK')),
  CONSTRAINT ops_version_reports_version_ck CHECK (version_name ~ '^[0-9A-Za-z][0-9A-Za-z.+_-]{0,31}$')
);
CREATE INDEX ops_version_reports_time_idx ON app.ops_version_reports (reported_at DESC);

-- 13. Deploy history as REPORTED by the existing pipeline (the runbook procedure). M13 records and watches; it does not run a deploy.
CREATE TABLE app.ops_deploys (
  deploy_id         uuid          NOT NULL,
  component         varchar(12)   NOT NULL,
  from_version      varchar(32),
  to_version        varchar(32)   NOT NULL,
  release_id        uuid,
  status            varchar(12)   NOT NULL,
  has_db_migration  boolean       NOT NULL,
  started_at        timestamptz(3) NOT NULL,
  finished_at       timestamptz(3),
  health_result     varchar(8),
  health_checked_at timestamptz(3),
  health_detail     varchar(200),
  note              varchar(300),
  discord_notification_id uuid,
  CONSTRAINT ops_deploys_pkey PRIMARY KEY (deploy_id),
  CONSTRAINT ops_deploys_release_fk FOREIGN KEY (release_id) REFERENCES app.ops_releases (release_id) ON DELETE RESTRICT,
  CONSTRAINT ops_deploys_component_ck CHECK (component IN ('BACKEND', 'WEB_ADMIN', 'M14', 'GATEWAY', 'FOOD', 'SHIP', 'MAP_PACK')),
  CONSTRAINT ops_deploys_status_ck CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'ROLLED_BACK')),
  CONSTRAINT ops_deploys_health_ck CHECK (health_result IS NULL OR health_result IN ('PASSED', 'FAILED')),
  CONSTRAINT ops_deploys_finished_ck CHECK ((status = 'RUNNING') = (finished_at IS NULL))
);
CREATE INDEX ops_deploys_started_idx ON app.ops_deploys (started_at DESC);

-- 14. Backup and restore-test results are two separate facts, each reported by the job that did it.
CREATE TABLE app.ops_backup_reports (
  report_id    uuid          NOT NULL,
  kind         varchar(12)   NOT NULL,
  ok           boolean       NOT NULL,
  finished_at  timestamptz(3) NOT NULL,
  size_bytes   bigint,
  detail_code  varchar(32),
  reported_at  timestamptz(3) NOT NULL,
  CONSTRAINT ops_backup_reports_pkey PRIMARY KEY (report_id),
  CONSTRAINT ops_backup_reports_kind_ck CHECK (kind IN ('BACKUP', 'RESTORE_TEST')),
  CONSTRAINT ops_backup_reports_detail_ck CHECK (detail_code IS NULL OR detail_code ~ '^[A-Z0-9_]{1,32}$'),
  CONSTRAINT ops_backup_reports_size_ck CHECK (size_bytes IS NULL OR size_bytes >= 0)
);
CREATE INDEX ops_backup_reports_kind_idx ON app.ops_backup_reports (kind, finished_at DESC);

-- Down Migration
DROP TABLE app.ops_backup_reports;
DROP TABLE app.ops_deploys;
DROP TABLE app.ops_version_reports;
DROP TABLE app.ops_releases;
DROP TABLE app.ops_ingest_keys;
DROP TABLE app.ops_gateway_telemetry;
DROP TABLE app.ops_maintenance;
DROP TABLE app.ops_notifications;
DROP TABLE app.ops_metrics_hourly;
DROP TABLE app.ops_metrics;
DROP TABLE app.ops_checks;
DROP TRIGGER ops_events_no_truncate ON app.ops_events;
DROP TRIGGER ops_events_guard ON app.ops_events;
DROP FUNCTION app.ops_events_reject_truncate();
DROP FUNCTION app.ops_events_guard();
DROP TABLE app.ops_events;
DROP TABLE app.ops_incidents;
DROP TABLE app.ops_admin_scopes;
DROP TABLE app.ops_config;
