-- Up Migration
-- M01.02: customer storage. Adds app.customer_profiles and app.user_consents, backfills the CUSTOMER storage role and an
-- empty profile for ordinary phone-verified accounts, and states the prerequisites it depends on.
-- Contract: docs/design/system-v2-20261011/10-m01-client-contract.md sections 1, 2, 6, 7 (design PR #48, head
-- 3f26112e88e16011117b9c6f3a3e58b946b76c80) and 04-data-api.md section 4.2. Contract10 wins over older wording.
--
-- Deviations from the contract text, found by reading main (f415668105136d2452c325c030696c406cc5ec77):
--   * The primary key of app.users is user_id, not id. Both foreign keys reference app.users (user_id).
--   * user_roles_role_ck is already the bounded token ^[A-Z][A-Z0-9_]{0,31}$ (M01-A1), so the CUSTOMER role is already
--     storable. No ALTER is needed and none is made: the prerequisite block below fails the migration if that
--     constraint is not exactly what main created, instead of replacing it silently.
--
-- Rules shared with every migration of this repository: no IF [NOT] EXISTS on DDL, no CASCADE, no seed data, and no
-- GRANT (runtime grants live in ops/runbooks/render-supabase-staging.md and are verified under a restricted role).
-- If any object here already exists, or a prerequisite is missing, the migration fails and rolls back as a whole.
--
-- The SHOP storage role is untouched. SHOP_OWNER is a public alias of the NEW client API only and is never stored.

-- ---------------------------------------------------------------------------------------------------
-- Prerequisites. They fail the whole migration with a fixed message; nothing is created before they pass.
-- Remote account_origin drift between #27/#34/#42 is NOT repaired here (it belongs to issue #49).
-- ---------------------------------------------------------------------------------------------------
DO $$
DECLARE
  v_definition text;
BEGIN
  IF to_regclass('app.users') IS NULL OR to_regclass('app.user_roles') IS NULL OR to_regclass('app.admin_memberships') IS NULL THEN
    RAISE EXCEPTION 'M01.02 prerequisite failed: app.users, app.user_roles and app.admin_memberships must exist';
  END IF;

  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'app' AND table_name = 'users'
         AND ((column_name = 'user_id' AND data_type = 'uuid' AND is_nullable = 'NO')
           OR (column_name = 'account_origin' AND data_type = 'character varying' AND is_nullable = 'NO')
           OR (column_name = 'phone_verified_at' AND data_type = 'timestamp with time zone' AND is_nullable = 'YES')
           OR (column_name = 'status' AND data_type = 'character varying' AND is_nullable = 'NO'))) <> 4 THEN
    RAISE EXCEPTION 'M01.02 prerequisite failed: app.users has not the expected user_id, account_origin, phone_verified_at, status columns';
  END IF;

  IF (SELECT count(*) FROM pg_constraint
       WHERE conrelid = 'app.users'::regclass
         AND conname IN ('users_pkey', 'users_account_origin_ck', 'users_origin_verified_ck')) <> 3 THEN
    RAISE EXCEPTION 'M01.02 prerequisite failed: app.users is missing users_pkey, users_account_origin_ck or users_origin_verified_ck';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_definition
    FROM pg_constraint WHERE conrelid = 'app.users'::regclass AND conname = 'users_account_origin_ck';
  IF position('PHONE_VERIFIED' IN v_definition) = 0 OR position('ADMIN_PROVISIONED' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'M01.02 prerequisite failed: users_account_origin_ck must allow PHONE_VERIFIED and ADMIN_PROVISIONED';
  END IF;

  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'app' AND table_name = 'admin_memberships' AND column_name = 'user_id' AND data_type = 'uuid') <> 1 THEN
    RAISE EXCEPTION 'M01.02 prerequisite failed: app.admin_memberships has not the expected user_id column';
  END IF;

  IF (SELECT count(*) FROM pg_constraint
       WHERE conrelid = 'app.user_roles'::regclass AND conname IN ('user_roles_pkey', 'user_roles_user_fk', 'user_roles_role_ck')) <> 3 THEN
    RAISE EXCEPTION 'M01.02 prerequisite failed: app.user_roles is missing user_roles_pkey, user_roles_user_fk or user_roles_role_ck';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_definition
    FROM pg_constraint WHERE conrelid = 'app.user_roles'::regclass AND conname = 'user_roles_role_ck';
  IF position('^[A-Z][A-Z0-9_]{0,31}$' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'M01.02 prerequisite failed: user_roles_role_ck is not the bounded token constraint created by Auth Core';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------------
-- app.customer_profiles
-- ---------------------------------------------------------------------------------------------------
-- The customer profile of one user. full_name is NULL for every backfilled account: the name of a driver or of a
-- shop owner is never copied here, and no name is invented. version starts at 1; every later profile update raises it by
-- exactly 1 under the user/profile lock and checks expected_version (a service rule). Normalization of full_name
-- (NFC, whitespace, control characters) is also a service rule; the CHECK below only bounds the length.
CREATE TABLE app.customer_profiles (
  user_id uuid NOT NULL,
  full_name varchar(120),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),

  CONSTRAINT customer_profiles_pkey PRIMARY KEY (user_id),
  CONSTRAINT customer_profiles_user_fk FOREIGN KEY (user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  -- 9007199254740991 is Number.MAX_SAFE_INTEGER: the version always fits a JavaScript integer.
  CONSTRAINT customer_profiles_version_ck CHECK (version BETWEEN 1 AND 9007199254740991),
  CONSTRAINT customer_profiles_full_name_ck CHECK (full_name IS NULL OR char_length(full_name) BETWEEN 1 AND 120),
  CONSTRAINT customer_profiles_time_order_ck CHECK (updated_at >= created_at)
);

-- ---------------------------------------------------------------------------------------------------
-- app.user_consents
-- ---------------------------------------------------------------------------------------------------
-- One acceptance of one (terms_version, privacy_version) pair by one user. Append-only: a trigger refuses UPDATE and
-- DELETE for every role, so a changed pair is a NEW row. Holds no OTP, password, token, IP address or customer name.
-- accepted_at is the database time of the acceptance; the client never supplies it. The table is created empty: no
-- acceptance is ever fabricated, and the production consent content is decided before register/UI acceptance.
CREATE TABLE app.user_consents (
  id uuid NOT NULL,
  user_id uuid NOT NULL,
  terms_version varchar(64) NOT NULL,
  privacy_version varchar(64) NOT NULL,
  accepted_at timestamptz NOT NULL,
  client_app varchar(4) NOT NULL,

  CONSTRAINT user_consents_pkey PRIMARY KEY (id),
  CONSTRAINT user_consents_user_fk FOREIGN KEY (user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT user_consents_terms_version_ck CHECK (terms_version ~ '^[A-Za-z0-9._-]{1,64}$'),
  CONSTRAINT user_consents_privacy_version_ck CHECK (privacy_version ~ '^[A-Za-z0-9._-]{1,64}$'),
  CONSTRAINT user_consents_client_app_ck CHECK (client_app IN ('FOOD', 'SHIP')),
  -- One acceptance per pair of versions; a different pair is a different row.
  CONSTRAINT user_consents_versions_uq UNIQUE (user_id, terms_version, privacy_version)
);

-- Own history, oldest first.
CREATE INDEX user_consents_user_accepted_idx ON app.user_consents (user_id, accepted_at, id);

CREATE FUNCTION app.user_consents_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'user consents are immutable' USING ERRCODE = '23001';
END $$;
CREATE TRIGGER user_consents_immutable BEFORE UPDATE OR DELETE ON app.user_consents
  FOR EACH ROW EXECUTE FUNCTION app.user_consents_immutable();

-- ---------------------------------------------------------------------------------------------------
-- Backfill (idempotent). The integration tests re-run exactly this block to prove a repeat adds nothing and
-- overwrites nothing; keep it self-contained.
-- ---------------------------------------------------------------------------------------------------
-- Eligible: account_origin = PHONE_VERIFIED AND phone_verified_at IS NOT NULL AND no admin membership at all (whatever
-- its status, and even a membership that should not exist). DISABLED ordinary users are eligible: the role does not mean
-- ACTIVE, access is refused by the guards. ADMIN_PROVISIONED accounts and fixture origins are never granted CUSTOMER here.
-- Existing roles (SHOP, DRIVER) are neither read nor changed. No consent row is written. The notice prints numbers only.
DO $$
DECLARE
  v_users bigint;
  v_eligible bigint;
  v_roles_inserted bigint;
  v_profiles_inserted bigint;
BEGIN
  SELECT count(*) INTO v_users FROM app.users;

  SELECT count(*) INTO v_eligible
    FROM app.users u
   WHERE u.account_origin = 'PHONE_VERIFIED'
     AND u.phone_verified_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM app.admin_memberships m WHERE m.user_id = u.user_id);

  INSERT INTO app.user_roles (user_id, role, created_at)
  SELECT u.user_id, 'CUSTOMER', transaction_timestamp()
    FROM app.users u
   WHERE u.account_origin = 'PHONE_VERIFIED'
     AND u.phone_verified_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM app.admin_memberships m WHERE m.user_id = u.user_id)
  ON CONFLICT (user_id, role) DO NOTHING;
  GET DIAGNOSTICS v_roles_inserted = ROW_COUNT;

  -- full_name stays NULL and version takes its default 1. An existing profile is never touched.
  INSERT INTO app.customer_profiles (user_id)
  SELECT u.user_id
    FROM app.users u
   WHERE u.account_origin = 'PHONE_VERIFIED'
     AND u.phone_verified_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM app.admin_memberships m WHERE m.user_id = u.user_id)
  ON CONFLICT (user_id) DO NOTHING;
  GET DIAGNOSTICS v_profiles_inserted = ROW_COUNT;

  RAISE NOTICE 'M01.02 backfill: users=% eligible=% excluded=% customer_roles_inserted=% customer_profiles_inserted=%',
    v_users, v_eligible, v_users - v_eligible, v_roles_inserted, v_profiles_inserted;
END
$$;

-- Down Migration
-- Only for disposable test or experimental databases. Remote databases are fixed forward with a new migration; never run
-- this there. It refuses to run once the data is no longer a pure backfill (a consent row exists, or a profile has a name
-- or a version other than 1): dropping them would destroy customer data. It then removes the CUSTOMER role rows (this
-- migration introduced that role) and drops the objects in reverse dependency order, without CASCADE.
DO $$
BEGIN
  IF (SELECT count(*) FROM app.user_consents) > 0 THEN
    RAISE EXCEPTION 'cannot roll back M01.02: consent rows exist';
  END IF;
  IF (SELECT count(*) FROM app.customer_profiles WHERE full_name IS NOT NULL OR version <> 1) > 0 THEN
    RAISE EXCEPTION 'cannot roll back M01.02: customer profiles hold names or versions beyond the backfill';
  END IF;
END
$$;

DELETE FROM app.user_roles WHERE role = 'CUSTOMER';
DROP TABLE app.user_consents;
DROP FUNCTION app.user_consents_immutable();
DROP TABLE app.customer_profiles;
