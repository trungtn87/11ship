-- Up Migration
-- M01-A1: Auth Core schema (users, user_roles, phone_verifications, verification_proofs, sessions).
-- It follows ADR-002, ADR-003 section 13.2 and docs/tasks/M01-A1-auth-core.md section 5. Auth-owned tables
-- only: no Shop/Driver/Wallet/Order tables and no seed data.
--
-- No IF [NOT] EXISTS anywhere: if any of these objects already exists the migration must fail (and be
-- rolled back as a whole, with no history row) instead of hiding schema drift. Applied migrations are
-- never edited; this is a new file after all M00 migrations.
--
-- Nothing secret is stored in plaintext: the password is an Argon2id PHC string, the OTP is an HMAC-SHA-256
-- hex digest, and the verification-proof token and the session access token are SHA-256 hex digests.

-- ---------------------------------------------------------------------------------------------------
-- app.users
-- ---------------------------------------------------------------------------------------------------
-- One row per verified phone number. The UNIQUE constraint on phone_normalized is the FINAL invariant
-- behind "one phone, one account": the application checks first, this constraint decides a race.
CREATE TABLE app.users (
  user_id uuid NOT NULL,
  -- E.164 shaped. A1 only produces +84 numbers; the application owns that narrower rule.
  phone_normalized varchar(16) NOT NULL,
  -- Argon2id PHC string. Never plaintext.
  password_hash text NOT NULL,
  -- When the phone number was proven (the verification that backed the registration).
  phone_verified_at timestamptz NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE',
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,

  CONSTRAINT users_pkey PRIMARY KEY (user_id),
  CONSTRAINT users_phone_normalized_uq UNIQUE (phone_normalized),
  CONSTRAINT users_phone_normalized_ck CHECK (phone_normalized ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT users_password_hash_ck CHECK (
    password_hash ~ '^\$argon2id\$' AND length(password_hash) <= 512
  ),
  CONSTRAINT users_status_ck CHECK (status IN ('ACTIVE', 'DISABLED')),
  CONSTRAINT users_version_ck CHECK (version >= 1),
  CONSTRAINT users_time_order_ck CHECK (updated_at >= created_at)
);

-- ---------------------------------------------------------------------------------------------------
-- app.user_roles
-- ---------------------------------------------------------------------------------------------------
-- Business roles a user holds. Register never writes here (a new account is roleless). The role column
-- is a bounded UPPER_SNAKE token and deliberately NOT limited to SHOP/DRIVER here: which roles may be
-- SELECTED is a service rule of A1, and later modules add roles without a schema change. PLATFORM and
-- EXTERNAL are driver classifications, not roles, and ADMIN/SYSTEM are never provisioned by Auth Core.
CREATE TABLE app.user_roles (
  user_id uuid NOT NULL,
  role varchar(32) NOT NULL,
  created_at timestamptz NOT NULL,

  -- The composite primary key is the UNIQUE (user_id, role) rule.
  CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role),
  CONSTRAINT user_roles_user_fk FOREIGN KEY (user_id) REFERENCES app.users (user_id),
  CONSTRAINT user_roles_role_ck CHECK (role ~ '^[A-Z][A-Z0-9_]{0,31}$')
);

-- ---------------------------------------------------------------------------------------------------
-- app.phone_verifications
-- ---------------------------------------------------------------------------------------------------
-- One OTP challenge. Rows are never deleted by A1. PENDING_DELIVERY is committed BEFORE the OTP provider
-- is called (the provider is never called inside a transaction); only PENDING can be verified.
CREATE TABLE app.phone_verifications (
  verification_id uuid NOT NULL,
  phone_normalized varchar(16) NOT NULL,
  -- A1 only issues REGISTER. The column is a bounded token so later purposes need no schema change.
  purpose varchar(32) NOT NULL,
  -- HMAC-SHA-256 (hex) of the OTP under a key that is NOT in the database.
  otp_digest char(64) NOT NULL,
  status varchar(24) NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  resend_not_before timestamptz NOT NULL,
  verified_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL,

  CONSTRAINT phone_verifications_pkey PRIMARY KEY (verification_id),
  CONSTRAINT phone_verifications_phone_ck CHECK (phone_normalized ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT phone_verifications_purpose_ck CHECK (purpose ~ '^[A-Z][A-Z0-9_]{0,31}$'),
  CONSTRAINT phone_verifications_otp_digest_ck CHECK (otp_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT phone_verifications_status_ck CHECK (
    status IN ('PENDING_DELIVERY', 'PENDING', 'VERIFIED', 'LOCKED', 'INVALIDATED', 'DELIVERY_FAILED')
  ),
  CONSTRAINT phone_verifications_attempt_count_ck CHECK (attempt_count >= 0),
  CONSTRAINT phone_verifications_expiry_ck CHECK (expires_at > created_at),
  CONSTRAINT phone_verifications_resend_ck CHECK (resend_not_before >= created_at),
  -- The two markers and their statuses move together.
  CONSTRAINT phone_verifications_verified_ck CHECK ((status = 'VERIFIED') = (verified_at IS NOT NULL)),
  CONSTRAINT phone_verifications_invalidated_ck CHECK (
    (status = 'INVALIDATED') = (invalidated_at IS NOT NULL)
  )
);

-- Latest challenge of a lane (phone, purpose), newest first: cooldown check and supersession.
CREATE INDEX phone_verifications_lane_idx
  ON app.phone_verifications (phone_normalized, purpose, created_at DESC);

-- ---------------------------------------------------------------------------------------------------
-- app.verification_proofs
-- ---------------------------------------------------------------------------------------------------
-- The one-time proof a correct OTP earns. Rows are NEVER deleted: a proof must stay resolvable after it
-- is consumed or has expired, so a committed register can still be found and replayed (ADR-003 13.2).
CREATE TABLE app.verification_proofs (
  proof_id uuid NOT NULL,
  verification_id uuid NOT NULL,
  phone_normalized varchar(16) NOT NULL,
  purpose varchar(32) NOT NULL,
  -- SHA-256 (hex) of the proof token. The token is high-entropy random data; the plaintext is returned
  -- to the client once and never stored.
  token_digest char(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL,

  CONSTRAINT verification_proofs_pkey PRIMARY KEY (proof_id),
  -- Exactly one proof per verification.
  CONSTRAINT verification_proofs_verification_uq UNIQUE (verification_id),
  CONSTRAINT verification_proofs_token_digest_uq UNIQUE (token_digest),
  CONSTRAINT verification_proofs_verification_fk FOREIGN KEY (verification_id)
    REFERENCES app.phone_verifications (verification_id),
  CONSTRAINT verification_proofs_phone_ck CHECK (phone_normalized ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT verification_proofs_purpose_ck CHECK (purpose ~ '^[A-Z][A-Z0-9_]{0,31}$'),
  CONSTRAINT verification_proofs_token_digest_ck CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT verification_proofs_expiry_ck CHECK (expires_at > created_at),
  CONSTRAINT verification_proofs_consumed_ck CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  CONSTRAINT verification_proofs_invalidated_ck CHECK (invalidated_at IS NULL OR invalidated_at >= created_at)
);

-- ---------------------------------------------------------------------------------------------------
-- app.sessions
-- ---------------------------------------------------------------------------------------------------
-- Opaque bearer sessions (ADR-002): the access token is 32 random bytes and only its SHA-256 digest is
-- stored. The lifetime is absolute (expires_at); there is no refresh token and no sliding renewal.
CREATE TABLE app.sessions (
  session_id uuid NOT NULL,
  user_id uuid NOT NULL,
  token_digest char(64) NOT NULL,
  -- Client-provided labels. They are NOT an authentication factor and never grant anything.
  device_id varchar(128) NOT NULL,
  platform varchar(32) NOT NULL,
  app varchar(32) NOT NULL,
  -- NULL until the user selects a role. The role lives on the session, never on the user.
  active_role varchar(32),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,

  CONSTRAINT sessions_pkey PRIMARY KEY (session_id),
  CONSTRAINT sessions_token_digest_uq UNIQUE (token_digest),
  CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES app.users (user_id),
  CONSTRAINT sessions_token_digest_ck CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT sessions_device_id_ck CHECK (device_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT sessions_platform_ck CHECK (platform ~ '^[A-Z0-9_]{1,32}$'),
  CONSTRAINT sessions_app_ck CHECK (app ~ '^[A-Z0-9_]{1,32}$'),
  CONSTRAINT sessions_active_role_ck CHECK (active_role IS NULL OR active_role ~ '^[A-Z][A-Z0-9_]{0,31}$'),
  CONSTRAINT sessions_expiry_ck CHECK (expires_at > created_at),
  CONSTRAINT sessions_revoked_ck CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CONSTRAINT sessions_time_order_ck CHECK (updated_at >= created_at)
);

CREATE INDEX sessions_user_idx ON app.sessions (user_id);

-- Final safety net of the SHOP single-active-session rule: at most one unrevoked SHOP-context session per
-- user. Expiry is deliberately NOT part of the predicate (an expired but unrevoked SHOP session still
-- occupies the slot until SHOP selection revokes it). The service revokes the older SHOP session first;
-- this index only catches a bug or a race the service did not serialize.
CREATE UNIQUE INDEX sessions_active_shop_per_user_uq
  ON app.sessions (user_id)
  WHERE active_role = 'SHOP' AND revoked_at IS NULL;

-- Down Migration
-- Only for disposable test or experimental databases. Reverse dependency order (sessions and proofs and
-- roles reference other tables); indexes go with their table. No CASCADE and no IF EXISTS: it fails loudly
-- if anything is missing instead of hiding drift.
DROP TABLE app.sessions;
DROP TABLE app.verification_proofs;
DROP TABLE app.phone_verifications;
DROP TABLE app.user_roles;
DROP TABLE app.users;
