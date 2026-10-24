-- Up Migration
-- Issue #117 (Owner 2026-10-15 and 2026-10-24): the SMS OTP limits are one SYSTEM-managed policy in PostgreSQL, read by the application on every
-- request (no restart), with a version against overwrites and an append-only change history. Six values: cooldown between OTP requests of one phone
-- (shared by REGISTER / RESET_PASSWORD / RESET_PASSWORD_ADMIN / RECOVER_ACCOUNT and by both apps), wrong attempts per challenge, requests per phone per
-- rolling hour and day, requests per client IP per rolling hour, SMS of the whole gateway per rolling day. Every value has safe bounds: none can be 0.
-- Forward-only: no existing table is touched. The old backend ignores the new tables and keeps its environment limits.

CREATE TABLE app.otp_policy (
  policy_id smallint NOT NULL,
  cooldown_seconds integer NOT NULL,
  max_wrong_attempts integer NOT NULL,
  phone_per_hour integer NOT NULL,
  phone_per_day integer NOT NULL,
  ip_per_hour integer NOT NULL,
  global_per_day integer NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  updated_by uuid,
  updated_at timestamptz NOT NULL,

  CONSTRAINT otp_policy_pkey PRIMARY KEY (policy_id),
  CONSTRAINT otp_policy_single_ck CHECK (policy_id = 1),
  CONSTRAINT otp_policy_cooldown_ck CHECK (cooldown_seconds BETWEEN 10 AND 600),
  CONSTRAINT otp_policy_attempts_ck CHECK (max_wrong_attempts BETWEEN 1 AND 10),
  CONSTRAINT otp_policy_phone_hour_ck CHECK (phone_per_hour BETWEEN 1 AND 20),
  CONSTRAINT otp_policy_phone_day_ck CHECK (phone_per_day BETWEEN 1 AND 100),
  CONSTRAINT otp_policy_phone_order_ck CHECK (phone_per_hour <= phone_per_day),
  CONSTRAINT otp_policy_ip_hour_ck CHECK (ip_per_hour BETWEEN 1 AND 1000),
  CONSTRAINT otp_policy_global_day_ck CHECK (global_per_day BETWEEN 1 AND 10000),
  CONSTRAINT otp_policy_version_ck CHECK (version >= 1),
  CONSTRAINT otp_policy_updated_by_fk FOREIGN KEY (updated_by) REFERENCES app.users (user_id)
);

INSERT INTO app.otp_policy (policy_id, cooldown_seconds, max_wrong_attempts, phone_per_hour, phone_per_day, ip_per_hour, global_per_day, version, updated_by, updated_at)
VALUES (1, 60, 3, 3, 5, 10, 30, 1, NULL, date_trunc('milliseconds', clock_timestamp()));

CREATE TABLE app.otp_policy_changes (
  change_id uuid NOT NULL,
  version bigint NOT NULL,
  old_values jsonb NOT NULL,
  new_values jsonb NOT NULL,
  reason text,
  changed_by uuid NOT NULL,
  changed_at timestamptz NOT NULL,
  request_id uuid,

  CONSTRAINT otp_policy_changes_pkey PRIMARY KEY (change_id),
  CONSTRAINT otp_policy_changes_by_fk FOREIGN KEY (changed_by) REFERENCES app.users (user_id),
  CONSTRAINT otp_policy_changes_diff_ck CHECK (old_values <> new_values)
);
CREATE INDEX otp_policy_changes_idx ON app.otp_policy_changes (changed_at DESC, change_id);

CREATE FUNCTION app.otp_policy_changes_reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app.otp_policy_changes is append-only (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER otp_policy_changes_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON app.otp_policy_changes
  FOR EACH STATEMENT EXECUTE FUNCTION app.otp_policy_changes_reject_mutation();

-- Durable, multi-process counter of OTP requests per client address. The address is never stored: only an HMAC of its limiter identity (IPv4 as is,
-- IPv6 as its /64 prefix). One row per accepted request; the sliding window counts rows, old rows are deleted by the requests themselves.
CREATE TABLE app.otp_ip_requests (
  request_id uuid NOT NULL,
  ip_hmac char(64) NOT NULL,
  created_at timestamptz NOT NULL,

  CONSTRAINT otp_ip_requests_pkey PRIMARY KEY (request_id),
  CONSTRAINT otp_ip_requests_hmac_ck CHECK (ip_hmac ~ '^[0-9a-f]{64}$')
);
CREATE INDEX otp_ip_requests_window_idx ON app.otp_ip_requests (ip_hmac, created_at DESC);
CREATE INDEX otp_ip_requests_age_idx ON app.otp_ip_requests (created_at);

-- Phone quota windows count the challenges of a phone across purposes.
CREATE INDEX phone_verifications_phone_window_idx ON app.phone_verifications (phone_normalized, created_at DESC);

-- Down Migration
-- Preserve immutable history; use a corrective migration after release.
DO $$ BEGIN RAISE EXCEPTION 'Issue #117: rollback requires a forward corrective migration'; END $$;
