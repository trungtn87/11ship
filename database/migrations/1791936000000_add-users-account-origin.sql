-- Up Migration
-- M01-D-LOGIN-BE: account origin of app.users. Administration accounts (SYSTEM bootstrap, created by an operator
-- command) are NOT phone-verified: there is no OTP, no proof and no verification timestamp for them, and none is
-- ever invented. The column records where the account came from; it carries NO privilege. Administration rights
-- come only from app.admin_memberships (+ MFA), never from the origin.
--
-- Additive and forward-only: existing rows are backfilled by the DEFAULT as PHONE_VERIFIED (their
-- phone_verified_at is already NOT NULL, so the pairing CHECK below holds for every existing row), and the
-- default keeps the existing registration INSERT working unchanged.
--
-- No IF [NOT] EXISTS anywhere: if the column or a constraint already exists (for example because another
-- account_origin migration was applied first) the migration must fail and roll back as a whole instead of
-- hiding schema drift. Applied migrations are never edited; a later migration that needs another origin value
-- (for example STAGING_FIXTURE) must only replace the CHECK constraint below, never add the column again.

ALTER TABLE app.users
  ADD COLUMN account_origin varchar(24) NOT NULL DEFAULT 'PHONE_VERIFIED';

ALTER TABLE app.users
  ALTER COLUMN phone_verified_at DROP NOT NULL;

ALTER TABLE app.users
  ADD CONSTRAINT users_account_origin_ck CHECK (account_origin IN ('PHONE_VERIFIED', 'ADMIN_PROVISIONED'));

-- Pairing: a phone-verified account has a verification time, an admin-provisioned account has none.
ALTER TABLE app.users
  ADD CONSTRAINT users_origin_verified_ck CHECK (
    (account_origin = 'PHONE_VERIFIED' AND phone_verified_at IS NOT NULL)
    OR (account_origin = 'ADMIN_PROVISIONED' AND phone_verified_at IS NULL)
  );

-- Down Migration
-- Only for disposable test or experimental databases. It refuses to run while any ADMIN_PROVISIONED account
-- exists: restoring NOT NULL on phone_verified_at would otherwise need an invented timestamp or the deletion of an
-- administration user. It fails loudly and changes nothing in that case.
DO $$
BEGIN
  IF (SELECT count(*) FROM app.users WHERE account_origin <> 'PHONE_VERIFIED') > 0 THEN
    RAISE EXCEPTION 'cannot roll back users.account_origin: non-PHONE_VERIFIED accounts exist';
  END IF;
END
$$;

ALTER TABLE app.users DROP CONSTRAINT users_origin_verified_ck;
ALTER TABLE app.users DROP CONSTRAINT users_account_origin_ck;
ALTER TABLE app.users ALTER COLUMN phone_verified_at SET NOT NULL;
ALTER TABLE app.users DROP COLUMN account_origin;
