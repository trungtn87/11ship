-- Up Migration
-- Issue #102 (SMS Gateway phase 2): paired Android gateway devices, a control row (kill switch) and the PostgreSQL SMS queue
-- that delivers REGISTER / RESET_PASSWORD / ADMIN_ACTIVATION OTPs (the last one: Owner decision 2026-10-14, admin invitation activation;
-- the migration had not been applied to any database when that purpose was added). Nothing here sends anything by itself: the feature stays OFF until the backend
-- flag SMS_GATEWAY_ENABLED=true AND the control row says sending_enabled (both default off / absent).
--
-- Rules shared with every migration of this repository: no IF [NOT] EXISTS on DDL, no CASCADE, no seed data and no GRANT
-- (runtime grants live in ops/runbooks/render-supabase-staging.md). Append-only: nothing earlier is edited.

-- A gateway device. The credential is 256 random bits shown ONCE by the operator pairing tool; only its SHA-256 is stored
-- (the secret has full entropy, so a plain digest is enough). Revocation is a one-way status change; rotation = pair a new
-- device row and revoke the old one.
CREATE TABLE app.sms_gateway_devices (
  device_id         uuid         NOT NULL,
  label             varchar(64)  NOT NULL,
  credential_digest char(64)     NOT NULL,
  status            varchar(8)   NOT NULL,
  created_at        timestamptz  NOT NULL,
  revoked_at        timestamptz,
  last_seen_at      timestamptz,
  app_version       varchar(32),
  sms_permission    boolean,
  paused            boolean,
  CONSTRAINT sms_gateway_devices_pkey PRIMARY KEY (device_id),
  CONSTRAINT sms_gateway_devices_digest_uq UNIQUE (credential_digest),
  CONSTRAINT sms_gateway_devices_digest_ck CHECK (credential_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT sms_gateway_devices_label_ck CHECK (label ~ '^[A-Za-z0-9 ._-]{1,64}$'),
  CONSTRAINT sms_gateway_devices_status_ck CHECK (status IN ('ACTIVE', 'REVOKED')),
  CONSTRAINT sms_gateway_devices_revoked_ck CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);

-- Backend kill switch. A single row; ABSENT = sending disabled (fail closed). Toggled only by the operator tool.
CREATE TABLE app.sms_gateway_control (
  singleton       boolean      NOT NULL DEFAULT true,
  sending_enabled boolean      NOT NULL,
  updated_at      timestamptz  NOT NULL,
  CONSTRAINT sms_gateway_control_pkey PRIMARY KEY (singleton),
  CONSTRAINT sms_gateway_control_singleton_ck CHECK (singleton)
);

-- The queue. The sensitive message (recipient + text, which contains the OTP) lives ONLY in the AES-256-GCM envelope below
-- while the job can still be sent, and the three columns are set to NULL the moment the job reaches a final state. Nothing in
-- this table, the audit or the logs holds the OTP in clear.
--   QUEUED   waiting for the gateway
--   CLAIMED  handed to ONE gateway attempt (attempt_id, lease): never handed out again
--   SENT     Android reported that the radio accepted the message (sent intent OK)
--   FAILED   Android reported that it was not sent
--   UNKNOWN  no usable acknowledgement (lease ran out / gateway reported it): NEVER resent automatically
--   EXPIRED  the OTP expired before the job was claimed: nothing is sent
CREATE TABLE app.sms_jobs (
  job_id             uuid         NOT NULL,
  verification_id    uuid,
  activation_challenge_id uuid,
  purpose            varchar(32)  NOT NULL,
  phone_normalized   varchar(16)  NOT NULL,
  status             varchar(8)   NOT NULL,
  payload_iv         bytea,
  payload_tag        bytea,
  payload_ciphertext bytea,
  crypto_key_id      varchar(64)  NOT NULL,
  attempt_id         uuid,
  claimed_by         uuid,
  claimed_at         timestamptz,
  lease_expires_at   timestamptz,
  created_at         timestamptz  NOT NULL,
  expires_at         timestamptz  NOT NULL,
  finished_at        timestamptz,
  delivered_at       timestamptz,
  result_code        varchar(24),
  CONSTRAINT sms_jobs_pkey PRIMARY KEY (job_id),
  CONSTRAINT sms_jobs_verification_uq UNIQUE (verification_id),
  CONSTRAINT sms_jobs_activation_challenge_uq UNIQUE (activation_challenge_id),
  CONSTRAINT sms_jobs_attempt_uq UNIQUE (attempt_id),
  CONSTRAINT sms_jobs_verification_fk FOREIGN KEY (verification_id) REFERENCES app.phone_verifications (verification_id) ON DELETE RESTRICT,
  CONSTRAINT sms_jobs_activation_challenge_fk FOREIGN KEY (activation_challenge_id) REFERENCES app.admin_activation_otp_challenges (challenge_id) ON DELETE RESTRICT,
  CONSTRAINT sms_jobs_device_fk FOREIGN KEY (claimed_by) REFERENCES app.sms_gateway_devices (device_id) ON DELETE RESTRICT,
  CONSTRAINT sms_jobs_purpose_ck CHECK (purpose IN ('REGISTER', 'RESET_PASSWORD', 'ADMIN_ACTIVATION')),
  -- exactly one owner of the job: an account challenge (REGISTER / RESET_PASSWORD) or an admin activation challenge
  CONSTRAINT sms_jobs_owner_ck CHECK (
    (purpose = 'ADMIN_ACTIVATION' AND activation_challenge_id IS NOT NULL AND verification_id IS NULL)
    OR (purpose <> 'ADMIN_ACTIVATION' AND verification_id IS NOT NULL AND activation_challenge_id IS NULL)
  ),
  CONSTRAINT sms_jobs_phone_ck CHECK (phone_normalized ~ '^\+84[0-9]{9}$'),
  CONSTRAINT sms_jobs_status_ck CHECK (status IN ('QUEUED', 'CLAIMED', 'SENT', 'FAILED', 'UNKNOWN', 'EXPIRED')),
  CONSTRAINT sms_jobs_result_code_ck CHECK (result_code IS NULL OR result_code ~ '^[A-Z0-9_]{1,24}$'),
  -- the sensitive envelope exists exactly while the job can still be handed out or is in flight
  CONSTRAINT sms_jobs_payload_ck CHECK (
    (status IN ('QUEUED', 'CLAIMED')) = (payload_ciphertext IS NOT NULL AND payload_iv IS NOT NULL AND payload_tag IS NOT NULL)
    AND (payload_ciphertext IS NOT NULL OR (payload_iv IS NULL AND payload_tag IS NULL))
  ),
  CONSTRAINT sms_jobs_claim_ck CHECK (
    (status IN ('QUEUED', 'EXPIRED')) = (attempt_id IS NULL)
    AND (attempt_id IS NULL) = (claimed_by IS NULL)
    AND (attempt_id IS NULL) = (lease_expires_at IS NULL)
  ),
  CONSTRAINT sms_jobs_final_ck CHECK ((status IN ('QUEUED', 'CLAIMED')) = (finished_at IS NULL)),
  CONSTRAINT sms_jobs_time_ck CHECK (expires_at > created_at)
);
CREATE INDEX sms_jobs_open_idx ON app.sms_jobs (created_at) WHERE status IN ('QUEUED', 'CLAIMED');
CREATE INDEX sms_jobs_created_idx ON app.sms_jobs (created_at);

-- Down Migration
DROP TABLE app.sms_jobs;
DROP TABLE app.sms_gateway_control;
DROP TABLE app.sms_gateway_devices;
