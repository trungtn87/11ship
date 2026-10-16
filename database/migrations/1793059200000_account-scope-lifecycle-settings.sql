-- Up Migration
-- M01 final package (Owner decisions 2026-10-14): account scopes, account lock reasons, accounts registered without a phone
-- proof, and the SYSTEM-managed settings (OTP switches).
--
-- 1. account_scope. Two independent identity scopes live in app.users:
--      ADMIN_WEB  SYSTEM and ADMIN (the only scope the administration web signs in), always account_origin ADMIN_PROVISIONED;
--      APP_USER   CUSTOMER / SHOP_OWNER / DRIVER (the only scope 11Food and 11Ship sign in).
--    A phone number is unique INSIDE a scope and may appear once in each scope. The column is GENERATED from account_origin
--    (ADMIN_PROVISIONED -> ADMIN_WEB, every other origin -> APP_USER): nothing, neither the application nor a request, can
--    write it, and an administration membership is only ever allowed on an ADMIN_PROVISIONED account (the origin guard of
--    1792454400000), so a membership holder is always ADMIN_WEB. Existing rows keep their user_id, roles, sessions and
--    relations; the unique constraint on the phone alone is replaced by the unique pair (scope, phone). The scope an entry
--    point serves is chosen by the code of that entry point (administration module or application module), never by a request.
-- 2. lock_reason / locked_at. A DISABLED account says why: DELETE_REQUEST (the only reason the owner may undo by recovering
--    the account through an OTP-proven re-registration), VIOLATION or SECURITY (never self-recovered). Existing DISABLED rows
--    were locked by an administrator and become VIOLATION, the conservative choice. The column is nullable and the check is
--    one-directional on purpose: a DISABLED row without a reason is read as "not self-recoverable" by the application.
-- 3. PHONE_UNVERIFIED account_origin: an ACTIVE account registered while the SYSTEM setting otp_registration_enabled was off.
--    phone_verified_at stays NULL (nothing invents a proof). It carries no privilege and cannot hold an administration
--    membership (the membership origin guard of 1792454400000 admits ADMIN_PROVISIONED only).
-- 4. app.system_settings / app.system_setting_changes: boolean settings with an append-only change log (old value, new value,
--    actor, time). An absent row means the default (true); the migration writes no row.
--
-- No IF [NOT] EXISTS, no CASCADE: schema drift fails and rolls the whole migration back. Applied migrations are never edited.

ALTER TABLE app.users
  ADD COLUMN account_scope varchar(16)
  GENERATED ALWAYS AS (CASE WHEN account_origin = 'ADMIN_PROVISIONED' THEN 'ADMIN_WEB' ELSE 'APP_USER' END) STORED;

ALTER TABLE app.users DROP CONSTRAINT users_phone_normalized_uq;
ALTER TABLE app.users
  ADD CONSTRAINT users_scope_phone_uq UNIQUE (account_scope, phone_normalized);

ALTER TABLE app.users
  ADD COLUMN lock_reason varchar(16),
  ADD COLUMN locked_at timestamptz;

UPDATE app.users SET lock_reason = 'VIOLATION', locked_at = updated_at WHERE status = 'DISABLED';

ALTER TABLE app.users
  ADD CONSTRAINT users_lock_reason_ck CHECK (lock_reason IS NULL OR lock_reason IN ('DELETE_REQUEST', 'VIOLATION', 'SECURITY')),
  ADD CONSTRAINT users_lock_state_ck CHECK (lock_reason IS NULL OR status = 'DISABLED'),
  ADD CONSTRAINT users_locked_at_ck CHECK ((lock_reason IS NULL) = (locked_at IS NULL));

ALTER TABLE app.users DROP CONSTRAINT users_origin_verified_ck;
ALTER TABLE app.users DROP CONSTRAINT users_account_origin_ck;

ALTER TABLE app.users
  ADD CONSTRAINT users_account_origin_ck
  CHECK (account_origin IN ('PHONE_VERIFIED', 'ADMIN_PROVISIONED', 'STAGING_FIXTURE', 'TEST_UNVERIFIED', 'PHONE_UNVERIFIED'));

ALTER TABLE app.users
  ADD CONSTRAINT users_origin_verified_ck CHECK (
    (account_origin = 'PHONE_VERIFIED' AND phone_verified_at IS NOT NULL)
    OR (account_origin IN ('ADMIN_PROVISIONED', 'STAGING_FIXTURE', 'TEST_UNVERIFIED', 'PHONE_UNVERIFIED') AND phone_verified_at IS NULL)
  );

CREATE TABLE app.system_settings (
  setting_key varchar(48) NOT NULL,
  bool_value boolean NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL,

  CONSTRAINT system_settings_pkey PRIMARY KEY (setting_key),
  CONSTRAINT system_settings_updated_by_fk FOREIGN KEY (updated_by) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT system_settings_key_ck CHECK (setting_key IN ('otp_registration_enabled', 'otp_password_reset_enabled')),
  CONSTRAINT system_settings_version_ck CHECK (version >= 1)
);

CREATE TABLE app.system_setting_changes (
  change_id uuid NOT NULL,
  setting_key varchar(48) NOT NULL,
  old_value boolean NOT NULL,
  new_value boolean NOT NULL,
  changed_by uuid NOT NULL,
  changed_at timestamptz NOT NULL,
  request_id uuid,

  CONSTRAINT system_setting_changes_pkey PRIMARY KEY (change_id),
  CONSTRAINT system_setting_changes_actor_fk FOREIGN KEY (changed_by) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT system_setting_changes_key_ck CHECK (setting_key IN ('otp_registration_enabled', 'otp_password_reset_enabled')),
  CONSTRAINT system_setting_changes_diff_ck CHECK (old_value <> new_value)
);

CREATE INDEX system_setting_changes_time_idx ON app.system_setting_changes (changed_at DESC, change_id);

-- 5. Permanent deletion of an APP_USER with no business data (Owner decision 2026-10-14). The runtime role is NOT given DELETE on any of
--    the account tables; the only way to remove an account is this function, owned by the migration role (SECURITY DEFINER) and
--    executable by the runtime role only. It refuses an administration account, a shop owner with a shop membership and a driver
--    with a driver profile (business data: the account is locked instead of deleted), then removes the account's OWN rows: sessions
--    with their device bindings and the device keys nothing else links to, consents, customer profile, roles and the user row.
--    The consent history is append-only for every role; the single exemption is a DELETE whose user is the one this function
--    announced through a transaction-local setting. Audit logs, outbox events, OTP challenges and idempotency records are kept.
CREATE OR REPLACE FUNCTION app.user_consents_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.purging_user', true) = OLD.user_id::text THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'user consents are immutable' USING ERRCODE = '23001';
END $$;

CREATE FUNCTION app.purge_app_user(p_user_id uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_keys uuid[];
BEGIN
  PERFORM 1 FROM app.users WHERE user_id = p_user_id AND account_scope = 'APP_USER' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM app.admin_memberships WHERE user_id = p_user_id)
     OR EXISTS (SELECT 1 FROM app.shop_members WHERE user_id = p_user_id)
     OR EXISTS (SELECT 1 FROM app.drivers WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION 'account has related data' USING ERRCODE = '23503';
  END IF;
  PERFORM set_config('app.purging_user', p_user_id::text, true);

  SELECT COALESCE(array_agg(key_id), ARRAY[]::uuid[]) INTO v_keys FROM app.client_device_key_links WHERE user_id = p_user_id;
  DELETE FROM app.client_session_bindings WHERE session_id IN (SELECT session_id FROM app.sessions WHERE user_id = p_user_id);
  DELETE FROM app.client_device_registration_grants WHERE join_binding_id IN (SELECT binding_id FROM app.client_device_bindings WHERE user_id = p_user_id);
  DELETE FROM app.client_device_key_links WHERE user_id = p_user_id;
  DELETE FROM app.client_device_bindings WHERE user_id = p_user_id;
  DELETE FROM app.client_device_request_nonces n
   WHERE n.key_id = ANY (v_keys) AND NOT EXISTS (SELECT 1 FROM app.client_device_key_links l WHERE l.key_id = n.key_id);
  DELETE FROM app.client_device_challenges c
   WHERE c.key_id = ANY (v_keys) AND NOT EXISTS (SELECT 1 FROM app.client_device_key_links l WHERE l.key_id = c.key_id);
  DELETE FROM app.client_device_registration_grants g
   WHERE g.key_id = ANY (v_keys) AND NOT EXISTS (SELECT 1 FROM app.client_device_key_links l WHERE l.key_id = g.key_id);
  DELETE FROM app.client_device_keys k
   WHERE k.key_id = ANY (v_keys)
     AND NOT EXISTS (SELECT 1 FROM app.client_device_key_links l WHERE l.key_id = k.key_id)
     AND NOT EXISTS (SELECT 1 FROM app.client_device_registration_grants g WHERE g.key_id = k.key_id OR g.authorizer_key_id = k.key_id);
  DELETE FROM app.sessions WHERE user_id = p_user_id;
  DELETE FROM app.user_consents WHERE user_id = p_user_id;
  DELETE FROM app.customer_profiles WHERE user_id = p_user_id;
  DELETE FROM app.user_roles WHERE user_id = p_user_id;
  DELETE FROM app.users WHERE user_id = p_user_id;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION app.purge_app_user(uuid) FROM PUBLIC;

-- Down Migration
-- Only for disposable test or experimental databases. It REFUSES to run while data exists that the older shape cannot hold
-- (a phone used in both scopes, a PHONE_UNVERIFIED account, a recorded lock reason of an account the older shape would keep, or a
-- stored setting change); it never deletes or rewrites an account to make itself succeed. No CASCADE, no IF EXISTS.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM app.users GROUP BY phone_normalized HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'cannot roll back account scopes: a phone number exists in both scopes';
  END IF;
  IF EXISTS (SELECT 1 FROM app.users WHERE account_origin = 'PHONE_UNVERIFIED') THEN
    RAISE EXCEPTION 'cannot roll back phone-unverified origin: phone-unverified accounts exist';
  END IF;
  IF EXISTS (SELECT 1 FROM app.system_setting_changes) THEN
    RAISE EXCEPTION 'cannot roll back system settings: recorded changes exist';
  END IF;
END
$$;

DROP FUNCTION app.purge_app_user(uuid);
CREATE OR REPLACE FUNCTION app.user_consents_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'user consents are immutable' USING ERRCODE = '23001';
END $$;

DROP TABLE app.system_setting_changes;
DROP TABLE app.system_settings;

ALTER TABLE app.users DROP CONSTRAINT users_origin_verified_ck;
ALTER TABLE app.users DROP CONSTRAINT users_account_origin_ck;
ALTER TABLE app.users
  ADD CONSTRAINT users_account_origin_ck CHECK (account_origin IN ('PHONE_VERIFIED', 'ADMIN_PROVISIONED', 'STAGING_FIXTURE', 'TEST_UNVERIFIED'));
ALTER TABLE app.users
  ADD CONSTRAINT users_origin_verified_ck CHECK (
    (account_origin = 'PHONE_VERIFIED' AND phone_verified_at IS NOT NULL)
    OR (account_origin IN ('ADMIN_PROVISIONED', 'STAGING_FIXTURE', 'TEST_UNVERIFIED') AND phone_verified_at IS NULL)
  );

ALTER TABLE app.users DROP CONSTRAINT users_locked_at_ck;
ALTER TABLE app.users DROP CONSTRAINT users_lock_state_ck;
ALTER TABLE app.users DROP CONSTRAINT users_lock_reason_ck;
ALTER TABLE app.users DROP COLUMN locked_at;
ALTER TABLE app.users DROP COLUMN lock_reason;

ALTER TABLE app.users DROP CONSTRAINT users_scope_phone_uq;
ALTER TABLE app.users ADD CONSTRAINT users_phone_normalized_uq UNIQUE (phone_normalized);
ALTER TABLE app.users DROP COLUMN account_scope;
