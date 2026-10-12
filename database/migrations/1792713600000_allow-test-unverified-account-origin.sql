-- Up Migration
-- M01 Food registration without OTP in the test build: the TEST_UNVERIFIED account origin.
--
-- A TEST_UNVERIFIED account is an ACTIVE user created through POST /v1/client-auth/register while
-- CLIENT_AUTH_PHONE_VERIFICATION_MODE=DISABLED_TEST (APP_ENV development/test, loopback bind only). Its phone number was
-- never proven and nothing pretends it was: phone_verified_at stays NULL and account_origin says why. It carries NO
-- privilege: administration rights come only from app.admin_memberships (+ MFA), and the membership origin guard
-- (1792454400000) admits ADMIN_PROVISIONED accounts only, so it can never become ADMIN or SYSTEM. The application Auth
-- accepts the origin only while the mode is on in the running process (AccountOriginPolicy); this migration only widens
-- what the table may store.
--
-- New, append-only migration after the last one on the integration branch (1792627200000). It replaces the same two CHECK
-- constraints that 1792627200000 replaced; applied migrations are never edited. Existing rows stay valid: every row is
-- PHONE_VERIFIED (with a verification time), ADMIN_PROVISIONED or STAGING_FIXTURE (without one), all still accepted below.
-- No IF [NOT] EXISTS: schema drift (a missing or renamed constraint) must fail and roll the migration back as a whole.

ALTER TABLE app.users DROP CONSTRAINT users_origin_verified_ck;
ALTER TABLE app.users DROP CONSTRAINT users_account_origin_ck;

ALTER TABLE app.users
  ADD CONSTRAINT users_account_origin_ck
  CHECK (account_origin IN ('PHONE_VERIFIED', 'ADMIN_PROVISIONED', 'STAGING_FIXTURE', 'TEST_UNVERIFIED'));

-- Pairing: a phone-verified account has a verification time; every other origin never has one (nothing invents it).
ALTER TABLE app.users
  ADD CONSTRAINT users_origin_verified_ck CHECK (
    (account_origin = 'PHONE_VERIFIED' AND phone_verified_at IS NOT NULL)
    OR (account_origin IN ('ADMIN_PROVISIONED', 'STAGING_FIXTURE', 'TEST_UNVERIFIED') AND phone_verified_at IS NULL)
  );

-- Down Migration
-- Only for disposable test or experimental databases. It REFUSES to run while a TEST_UNVERIFIED account exists (it never
-- deletes or rewrites a user to make itself succeed), fails loudly and changes nothing in that case. No CASCADE, no IF EXISTS.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM app.users WHERE account_origin = 'TEST_UNVERIFIED') THEN
    RAISE EXCEPTION 'cannot roll back test-unverified origin: test-unverified accounts exist';
  END IF;
END
$$;

ALTER TABLE app.users DROP CONSTRAINT users_origin_verified_ck;
ALTER TABLE app.users DROP CONSTRAINT users_account_origin_ck;

ALTER TABLE app.users
  ADD CONSTRAINT users_account_origin_ck CHECK (account_origin IN ('PHONE_VERIFIED', 'ADMIN_PROVISIONED', 'STAGING_FIXTURE'));

ALTER TABLE app.users
  ADD CONSTRAINT users_origin_verified_ck CHECK (
    (account_origin = 'PHONE_VERIFIED' AND phone_verified_at IS NOT NULL)
    OR (account_origin IN ('ADMIN_PROVISIONED', 'STAGING_FIXTURE') AND phone_verified_at IS NULL)
  );
