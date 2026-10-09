-- Up Migration
-- M01-D-LOGIN-BE: administration authentication (web, cookie based, TOTP second factor). Tables only: no seed data,
-- no secret and no configuration row (the limiter configuration is written by the operator command
-- admin-auth:init-limit-config, never by this migration and never by application start). It follows
-- docs/tasks/M01-D-LOGIN-backend-handoff.md and references only app.users (Auth Core + account-origin migration).
--
-- Nothing secret is stored in plaintext: the preauth/session cookie values are stored as SHA-256 digests, the
-- password is represented only by a keyed digest (the "binding"), the TOTP secret is AEAD ciphertext, and rate-limit
-- buckets are keyed digests, never phone numbers or addresses.
--
-- No IF [NOT] EXISTS anywhere: if any of these objects already exists the migration must fail (and be rolled back as
-- a whole, with no history row) instead of hiding schema drift. No CASCADE anywhere: deleting a user never silently
-- removes administration state or its audit trail.

-- ---------------------------------------------------------------------------------------------------
-- app.admin_memberships
-- ---------------------------------------------------------------------------------------------------
-- Who is an administrator, and of which kind. The membership - not the account origin - decides the right.
CREATE TABLE app.admin_memberships (
  user_id uuid NOT NULL,
  admin_role varchar(16) NOT NULL,
  status varchar(16) NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,

  CONSTRAINT admin_memberships_pkey PRIMARY KEY (user_id),
  CONSTRAINT admin_memberships_user_fk FOREIGN KEY (user_id) REFERENCES app.users (user_id),
  CONSTRAINT admin_memberships_role_ck CHECK (admin_role IN ('SYSTEM', 'ADMIN')),
  CONSTRAINT admin_memberships_status_ck CHECK (status IN ('ACTIVE', 'DISABLED')),
  CONSTRAINT admin_memberships_version_ck CHECK (version >= 1),
  CONSTRAINT admin_memberships_time_order_ck CHECK (updated_at >= created_at)
);

-- There is never a second SYSTEM, whatever its status.
CREATE UNIQUE INDEX admin_memberships_single_system_uq
  ON app.admin_memberships (admin_role)
  WHERE admin_role = 'SYSTEM';

-- ---------------------------------------------------------------------------------------------------
-- app.admin_auth_challenges
-- ---------------------------------------------------------------------------------------------------
-- One preauth step (password accepted, TOTP pending). factor_id / factor_version are a scalar snapshot (no foreign
-- key): the factor points at its pending challenge, not the other way round, so there is no foreign-key cycle.
CREATE TABLE app.admin_auth_challenges (
  challenge_id uuid NOT NULL,
  user_id uuid NOT NULL,
  token_digest char(64) NOT NULL,
  csrf_nonce bytea NOT NULL,
  csrf_key_id varchar(64) NOT NULL,
  password_binding char(64) NOT NULL,
  password_key_id varchar(64) NOT NULL,
  membership_version bigint NOT NULL,
  factor_id uuid,
  factor_version bigint,
  device_id varchar(128) NOT NULL,
  expires_at timestamptz NOT NULL,
  attempt_count smallint NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL,

  CONSTRAINT admin_auth_challenges_pkey PRIMARY KEY (challenge_id),
  CONSTRAINT admin_auth_challenges_token_digest_uq UNIQUE (token_digest),
  CONSTRAINT admin_auth_challenges_user_fk FOREIGN KEY (user_id) REFERENCES app.users (user_id),
  CONSTRAINT admin_auth_challenges_token_digest_ck CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT admin_auth_challenges_csrf_nonce_ck CHECK (octet_length(csrf_nonce) = 32),
  CONSTRAINT admin_auth_challenges_csrf_key_id_ck CHECK (csrf_key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  CONSTRAINT admin_auth_challenges_password_binding_ck CHECK (password_binding ~ '^[0-9a-f]{64}$'),
  CONSTRAINT admin_auth_challenges_password_key_id_ck CHECK (password_key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  CONSTRAINT admin_auth_challenges_membership_version_ck CHECK (membership_version >= 1),
  CONSTRAINT admin_auth_challenges_factor_snapshot_ck CHECK (
    (factor_id IS NULL AND factor_version IS NULL)
    OR (factor_id IS NOT NULL AND factor_version IS NOT NULL AND factor_version >= 1)
  ),
  CONSTRAINT admin_auth_challenges_device_id_ck CHECK (device_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT admin_auth_challenges_expiry_ck CHECK (expires_at > created_at),
  CONSTRAINT admin_auth_challenges_attempt_ck CHECK (attempt_count BETWEEN 0 AND 5),
  CONSTRAINT admin_auth_challenges_consumed_ck CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX admin_auth_challenges_user_idx ON app.admin_auth_challenges (user_id);

-- ---------------------------------------------------------------------------------------------------
-- app.admin_totp_factors
-- ---------------------------------------------------------------------------------------------------
-- At most one factor per administrator. factor_id + version identify one generation of the secret and are part of
-- the AEAD associated data; they do not change when the factor is activated or used. The secret is stored as
-- AES-GCM ciphertext only.
CREATE TABLE app.admin_totp_factors (
  user_id uuid NOT NULL,
  factor_id uuid NOT NULL,
  state varchar(16) NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  key_id varchar(64) NOT NULL,
  ciphertext bytea NOT NULL,
  iv bytea NOT NULL,
  tag bytea NOT NULL,
  last_accepted_step bigint,
  pending_challenge_id uuid,
  created_at timestamptz NOT NULL,
  activated_at timestamptz,

  CONSTRAINT admin_totp_factors_pkey PRIMARY KEY (user_id),
  CONSTRAINT admin_totp_factors_factor_id_uq UNIQUE (factor_id),
  CONSTRAINT admin_totp_factors_membership_fk FOREIGN KEY (user_id) REFERENCES app.admin_memberships (user_id),
  CONSTRAINT admin_totp_factors_pending_challenge_fk FOREIGN KEY (pending_challenge_id)
    REFERENCES app.admin_auth_challenges (challenge_id),
  CONSTRAINT admin_totp_factors_state_ck CHECK (state IN ('PENDING', 'ACTIVE')),
  CONSTRAINT admin_totp_factors_version_ck CHECK (version >= 1),
  CONSTRAINT admin_totp_factors_key_id_ck CHECK (key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  CONSTRAINT admin_totp_factors_secret_shape_ck CHECK (
    octet_length(ciphertext) BETWEEN 1 AND 256 AND octet_length(iv) = 12 AND octet_length(tag) = 16
  ),
  CONSTRAINT admin_totp_factors_step_ck CHECK (last_accepted_step IS NULL OR last_accepted_step >= 0),
  CONSTRAINT admin_totp_factors_state_binding_ck CHECK (
    (state = 'PENDING' AND pending_challenge_id IS NOT NULL AND activated_at IS NULL AND last_accepted_step IS NULL)
    OR (state = 'ACTIVE' AND pending_challenge_id IS NULL AND activated_at IS NOT NULL AND last_accepted_step IS NOT NULL)
  ),
  CONSTRAINT admin_totp_factors_activated_ck CHECK (activated_at IS NULL OR activated_at >= created_at)
);

-- A challenge owns at most one pending factor.
CREATE UNIQUE INDEX admin_totp_factors_pending_challenge_uq
  ON app.admin_totp_factors (pending_challenge_id)
  WHERE pending_challenge_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------------------
-- app.admin_sessions
-- ---------------------------------------------------------------------------------------------------
-- A fully authenticated (password + TOTP) administration session, absolute lifetime. At most one unrevoked session
-- per administrator: a new one revokes the old one in the same transaction, and this index is the final net.
CREATE TABLE app.admin_sessions (
  session_id uuid NOT NULL,
  user_id uuid NOT NULL,
  token_digest char(64) NOT NULL,
  csrf_nonce bytea NOT NULL,
  csrf_key_id varchar(64) NOT NULL,
  password_binding char(64) NOT NULL,
  password_key_id varchar(64) NOT NULL,
  membership_version bigint NOT NULL,
  factor_id uuid NOT NULL,
  factor_version bigint NOT NULL,
  device_id varchar(128) NOT NULL,
  mfa_completed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL,

  CONSTRAINT admin_sessions_pkey PRIMARY KEY (session_id),
  CONSTRAINT admin_sessions_token_digest_uq UNIQUE (token_digest),
  CONSTRAINT admin_sessions_user_fk FOREIGN KEY (user_id) REFERENCES app.users (user_id),
  CONSTRAINT admin_sessions_token_digest_ck CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT admin_sessions_csrf_nonce_ck CHECK (octet_length(csrf_nonce) = 32),
  CONSTRAINT admin_sessions_csrf_key_id_ck CHECK (csrf_key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  CONSTRAINT admin_sessions_password_binding_ck CHECK (password_binding ~ '^[0-9a-f]{64}$'),
  CONSTRAINT admin_sessions_password_key_id_ck CHECK (password_key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  CONSTRAINT admin_sessions_membership_version_ck CHECK (membership_version >= 1),
  CONSTRAINT admin_sessions_factor_version_ck CHECK (factor_version >= 1),
  CONSTRAINT admin_sessions_device_id_ck CHECK (device_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT admin_sessions_expiry_ck CHECK (expires_at > created_at),
  CONSTRAINT admin_sessions_mfa_ck CHECK (mfa_completed_at >= created_at),
  CONSTRAINT admin_sessions_revoked_ck CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX admin_sessions_user_idx ON app.admin_sessions (user_id);

CREATE UNIQUE INDEX admin_sessions_active_per_user_uq
  ON app.admin_sessions (user_id)
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------------------------------
-- app.admin_auth_limit_config
-- ---------------------------------------------------------------------------------------------------
-- Singleton: which limiter key (by id) the buckets below were written with, and a keyed check value proving the
-- configured secret is the same one. Written only by the operator command, never by this migration or at start.
CREATE TABLE app.admin_auth_limit_config (
  singleton_id smallint NOT NULL,
  limiter_key_id varchar(64) NOT NULL,
  key_check char(64) NOT NULL,
  created_at timestamptz NOT NULL,

  CONSTRAINT admin_auth_limit_config_pkey PRIMARY KEY (singleton_id),
  CONSTRAINT admin_auth_limit_config_singleton_ck CHECK (singleton_id = 1),
  CONSTRAINT admin_auth_limit_config_key_id_ck CHECK (limiter_key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  CONSTRAINT admin_auth_limit_config_key_check_ck CHECK (key_check ~ '^[0-9a-f]{64}$')
);

-- ---------------------------------------------------------------------------------------------------
-- app.admin_auth_limits
-- ---------------------------------------------------------------------------------------------------
-- Shared, atomic rate-limit state. bucket_key is a keyed digest of (kind, identity): no phone number or address is
-- ever stored. For the *_REQUEST_* kinds failure_count counts requests of a fixed window; for the other kinds it
-- counts failures.
CREATE TABLE app.admin_auth_limits (
  bucket_key char(64) NOT NULL,
  kind varchar(24) NOT NULL,
  window_started_at timestamptz NOT NULL,
  failure_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL,

  CONSTRAINT admin_auth_limits_pkey PRIMARY KEY (bucket_key),
  CONSTRAINT admin_auth_limits_bucket_key_ck CHECK (bucket_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT admin_auth_limits_kind_ck CHECK (
    kind IN ('LOGIN_PHONE', 'LOGIN_IP', 'LOGIN_REQUEST_IP', 'TOTP_USER', 'TOTP_REQUEST_IP')
  ),
  CONSTRAINT admin_auth_limits_count_ck CHECK (failure_count >= 0),
  CONSTRAINT admin_auth_limits_time_order_ck CHECK (updated_at >= window_started_at)
);

-- Down Migration
-- Only for disposable test or experimental databases. Reverse dependency order; indexes go with their table. No
-- CASCADE and no IF EXISTS: it fails loudly if anything is missing instead of hiding drift. It must run BEFORE the
-- account-origin and Auth Core down migrations because these tables reference app.users.
DROP TABLE app.admin_auth_limits;
DROP TABLE app.admin_auth_limit_config;
DROP TABLE app.admin_sessions;
DROP TABLE app.admin_totp_factors;
DROP TABLE app.admin_auth_challenges;
DROP TABLE app.admin_memberships;
